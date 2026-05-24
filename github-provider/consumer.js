'use strict';

const { Kafka }    = require('kafkajs');
const AdmZip       = require('adm-zip');
const { getObject } = require('./minioClient');

// ── Environment ───────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS  = parseInt(process.env.GITHUB_POLL_INTERVAL_MS  || '10000', 10);
const MAX_POLL_ATTEMPTS = parseInt(process.env.GITHUB_MAX_POLL_ATTEMPTS || '30',    10);

// ── Kafka ─────────────────────────────────────────────────────────────────────
const kafka = new Kafka({
  clientId: 'github-provider',
  brokers:  (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
});
const consumer = kafka.consumer({ groupId: 'github-provider' });
const producer = kafka.producer();

// ── DB handle (set by server.js after MongoDB connects) ───────────────────────
let db;
function setDb(database) { db = database; }

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── GitHub credential lookup ──────────────────────────────────────────────────
// Reads the PAT and owner from the shared architectai database.
// The users collection is shared with architectai-api (read-only here).
async function getGithubCreds(userId) {
  const doc = await db.collection('users').findOne({ userId });
  if (!doc?.githubToken || !doc?.githubOwner) return null;
  return { token: doc.githubToken, owner: doc.githubOwner };
}

// ── Kafka publish helpers ─────────────────────────────────────────────────────
async function publishFailed(buildId, userId, reason) {
  try {
    await producer.send({
      topic:    'architectai.build.failed',
      messages: [{
        key:   buildId,
        value: JSON.stringify({ buildId, userId, error: reason, failedAt: new Date().toISOString() }),
      }],
    });
    log(`[${buildId}] Published build.failed: ${reason}`);
  } catch (err) {
    log(`[${buildId}] Could not publish build.failed: ${err.message}`);
  }
}

async function publishStatus(buildId, attempt, pipelineUrl) {
  try {
    await producer.send({
      topic:    'architectai.build.status',
      messages: [{
        key:   buildId,
        value: JSON.stringify({ buildId, status: 'building', pipelineUrl: pipelineUrl || null, attempt }),
      }],
    });
  } catch {}
}

// ── Step 1 — Create GitHub repo ───────────────────────────────────────────────
async function createRepo(creds, repoName, buildId) {
  const res = await fetch('https://api.github.com/user/repos', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${creds.token}`,
      Accept:         'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: repoName, private: false, auto_init: true }),
  });

  if (res.status === 422) {
    // Repo already exists — idempotent, treat as success
    log(`[${buildId}] Repo ${creds.owner}/${repoName} already exists — continuing`);
    return;
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`GitHub create-repo HTTP ${res.status}: ${data.message || 'unknown error'}`);
  }
  log(`[${buildId}] Created repo ${creds.owner}/${repoName}`);
}

// ── Step 2 — Fetch artifact from MinIO ───────────────────────────────────────
async function fetchArtifact(objectKey, buildId) {
  log(`[${buildId}] Fetching artifact ${objectKey} from MinIO`);
  const stream = await getObject(objectKey);

  // Collect the Node.js Readable into a Buffer
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const zipBuffer = Buffer.concat(chunks);

  const zip   = new AdmZip(zipBuffer);
  const files = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    files.push({ path: entry.entryName, content: entry.getData().toString('utf-8') });
  }

  if (!files.length) throw new Error('Zip contained no files');
  log(`[${buildId}] Unpacked ${files.length} files from artifact`);
  return files;
}

// ── Step 2b — Inject GitHub Actions workflows ─────────────────────────────────
// Detects service IDs from top-level directories in the unpacked zip and injects
// a .github/workflows/{serviceId}.yml for each one. This is the ONLY place in the
// system that knows about GitHub Actions YAML structure — swapping to a different
// CI system means replacing this function only.
function injectWorkflows(files, owner, repoName) {
  const serviceIds = [...new Set(
    files
      .map(f => f.path.split('/')[0])
      .filter(d => d && !d.startsWith('.')),
  )];

  for (const serviceId of serviceIds) {
    const workflowPath = `.github/workflows/${serviceId}.yml`;
    // Skip if a workflow was already included in the artifact
    if (files.some(f => f.path === workflowPath)) continue;

    const content = `name: Build ${serviceId}

on:
  push:
    branches: [main]
    paths:
      - '${serviceId}/**'
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: ./${serviceId}
          push: true
          tags: ghcr.io/${owner}/${repoName}/${serviceId}:main
`;
    files.push({ path: workflowPath, content });
  }

  return serviceIds;
}

// ── Step 3 — Push files to GitHub ─────────────────────────────────────────────
// Fetches each file's SHA before writing so repeated runs are idempotent.
// Collects failures but continues; caller decides the failure threshold.
async function pushFiles(creds, repoName, files, buildId) {
  const headers = {
    Authorization:  `Bearer ${creds.token}`,
    Accept:         'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };
  const failures = [];

  for (const file of files) {
    const url = `https://api.github.com/repos/${creds.owner}/${repoName}/contents/${file.path}`;
    try {
      // Fetch current SHA (404 → new file, any other non-OK → error)
      let sha;
      const getRes = await fetch(`${url}?ref=main`, { headers });
      if (getRes.ok) {
        sha = (await getRes.json()).sha;
      } else if (getRes.status !== 404) {
        const e = await getRes.json().catch(() => ({}));
        throw new Error(e.message || `SHA fetch HTTP ${getRes.status}`);
      }

      const putBody = {
        message: `chore: update ${file.path.split('/').pop()} via ArchitectAI`,
        content: Buffer.from(file.content, 'utf-8').toString('base64'),
        branch:  'main',
        ...(sha ? { sha } : {}),
      };
      const putRes = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(putBody) });
      if (!putRes.ok) {
        const e = await putRes.json().catch(() => ({}));
        throw new Error(e.message || `PUT HTTP ${putRes.status}`);
      }
    } catch (err) {
      failures.push({ path: file.path, error: err.message });
    }
  }

  log(`[${buildId}] Pushed ${files.length - failures.length}/${files.length} files to ${creds.owner}/${repoName}`);
  return failures;
}

// ── Step 4 — Wait for GitHub Actions pipeline ─────────────────────────────────
// Polls every POLL_INTERVAL_MS up to MAX_POLL_ATTEMPTS times.
// Publishes an intermediate build.status message on each poll.
// Returns { success: bool, run: object|null, timedOut?: bool }
async function waitForPipeline(creds, repoName, buildId) {
  const url = `https://api.github.com/repos/${creds.owner}/${repoName}/actions/runs?branch=main&per_page=5`;
  const headers = {
    Authorization: `Bearer ${creds.token}`,
    Accept:        'application/vnd.github.v3+json',
  };

  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    let runs = [];
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        log(`[${buildId}] Actions poll HTTP ${res.status} (attempt ${attempt}/${MAX_POLL_ATTEMPTS}) — retrying`);
        await publishStatus(buildId, attempt, null);
        continue;
      }
      ({ workflow_runs: runs = [] } = await res.json());
    } catch (err) {
      log(`[${buildId}] Actions poll error: ${err.message} — retrying`);
      await publishStatus(buildId, attempt, null);
      continue;
    }

    const run = runs[0];
    if (!run) {
      log(`[${buildId}] No workflow runs yet (attempt ${attempt}/${MAX_POLL_ATTEMPTS})`);
      await publishStatus(buildId, attempt, null);
      continue;
    }

    log(`[${buildId}] Run ${run.id} status=${run.status} conclusion=${run.conclusion} (attempt ${attempt}/${MAX_POLL_ATTEMPTS})`);
    await publishStatus(buildId, attempt, run.html_url);

    if (run.status === 'completed') {
      return { success: run.conclusion === 'success', run };
    }
  }

  return { success: false, run: null, timedOut: true };
}

// ── Step 4b — Trigger workflow_dispatch for each injected workflow ────────────
// GitHub does not run a workflow on the push that first creates it, so we
// explicitly dispatch each one after the push. Requires the PAT to have the
// `workflow` scope.
async function triggerWorkflows(creds, repoName, serviceIds, buildId) {
  const headers = {
    Authorization:  `Bearer ${creds.token}`,
    Accept:         'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };

  // Give GitHub a moment to register the newly-pushed workflow files
  await new Promise(r => setTimeout(r, 3000));

  for (const serviceId of serviceIds) {
    const workflowFile = `${serviceId}.yml`;
    const url = `https://api.github.com/repos/${creds.owner}/${repoName}/actions/workflows/${workflowFile}/dispatches`;
    const res = await fetch(url, {
      method:  'POST',
      headers,
      body:    JSON.stringify({ ref: 'main' }),
    });
    if (res.status === 204) {
      log(`[${buildId}] Triggered workflow_dispatch for ${workflowFile}`);
    } else {
      const data = await res.json().catch(() => ({}));
      log(`[${buildId}] Warning: could not trigger ${workflowFile} HTTP ${res.status}: ${data.message || 'unknown'}`);
    }
  }
}

// ── Step 5 — Extract image references ─────────────────────────────────────────
// Convention fallback: ghcr.io/{owner}/{repoName}/{serviceId}:main
// Service IDs are inferred from top-level directory names in the unpacked zip.
function extractImages(owner, repoName, files) {
  const serviceIds = [...new Set(
    files
      .map(f => f.path.split('/')[0])
      .filter(d => d && !d.startsWith('.')),
  )];
  return serviceIds.map(serviceId => ({
    serviceId,
    image: `ghcr.io/${owner}/${repoName}/${serviceId}:main`,
  }));
}

// ── Main per-message handler ───────────────────────────────────────────────────
async function handleCodeGenerated(event) {
  const { buildId, userId, repoName, objectKey } = event;
  log(`[${buildId}] Received code.generated repo=${repoName} user=${userId}`);

  // Step 1 — Create GitHub repo
  let creds;
  try {
    creds = await getGithubCreds(userId);
    if (!creds) {
      await publishFailed(buildId, userId, 'GitHub credentials not configured for this user');
      return;
    }
    await createRepo(creds, repoName, buildId);
  } catch (err) {
    await publishFailed(buildId, userId, `Repo creation failed: ${err.message}`);
    return;
  }

  // Step 2 — Fetch artifact from MinIO
  let files;
  try {
    files = await fetchArtifact(objectKey, buildId);
  } catch (err) {
    await publishFailed(buildId, userId, `Artifact fetch failed: ${err.message}`);
    return;
  }

  // Step 2b — Inject CI workflows for each detected service
  const injectedServices = injectWorkflows(files, creds.owner, repoName);
  log(`[${buildId}] Injected ${injectedServices.length} GitHub Actions workflow(s): ${injectedServices.join(', ')}`);

  // Step 3 — Push files to GitHub
  let failures;
  try {
    failures = await pushFiles(creds, repoName, files, buildId);
  } catch (err) {
    await publishFailed(buildId, userId, `File push failed: ${err.message}`);
    return;
  }
  // Workflow files failing to push means the PAT lacks the `workflow` scope —
  // there is no point proceeding since no pipeline will ever run.
  const workflowFailures = failures.filter(f => f.path.startsWith('.github/workflows/'));
  if (workflowFailures.length > 0) {
    const detail = workflowFailures.map(f => `${f.path}: ${f.error}`).join('; ');
    await publishFailed(buildId, userId,
      `Workflow files could not be pushed (PAT may be missing the 'workflow' scope): ${detail}`);
    return;
  }

  const failRate = files.length > 0 ? failures.length / files.length : 0;
  if (failRate > 0.2) {
    const detail = failures.slice(0, 5).map(f => `${f.path}: ${f.error}`).join('; ');
    await publishFailed(buildId, userId,
      `Too many push failures (${failures.length}/${files.length}): ${detail}`);
    return;
  }
  if (failures.length > 0) {
    log(`[${buildId}] ${failures.length} non-fatal push failures — continuing`);
  }

  // Step 3b — Trigger workflow_dispatch (GitHub won't auto-run a workflow on the
  // push that first creates it)
  try {
    await triggerWorkflows(creds, repoName, injectedServices, buildId);
  } catch (err) {
    await publishFailed(buildId, userId, `Workflow dispatch failed: ${err.message}`);
    return;
  }

  // Step 4 — Wait for GitHub Actions pipeline
  let pipelineResult;
  try {
    pipelineResult = await waitForPipeline(creds, repoName, buildId);
  } catch (err) {
    await publishFailed(buildId, userId, `Pipeline polling failed: ${err.message}`);
    return;
  }
  if (!pipelineResult.success) {
    const reason = pipelineResult.timedOut
      ? `Pipeline timed out after ${MAX_POLL_ATTEMPTS} poll attempts`
      : `Pipeline failed (conclusion=${pipelineResult.run?.conclusion ?? 'unknown'})`;
    await publishFailed(buildId, userId, reason);
    return;
  }

  // Step 5 — Extract image references (convention-based)
  const images = extractImages(creds.owner, repoName, files);
  log(`[${buildId}] Extracted ${images.length} image reference(s)`);

  // Step 6 — Publish build.complete
  await producer.send({
    topic:    'architectai.build.complete',
    messages: [{
      key:   buildId,
      value: JSON.stringify({
        buildId,
        userId,
        repoName,
        status:      'success',
        pipelineUrl: pipelineResult.run.html_url,
        images,
        completedAt: new Date().toISOString(),
      }),
    }],
  });
  log(`[${buildId}] Published build.complete`);
}

// ── Consumer start ─────────────────────────────────────────────────────────────
async function startConsumer() {
  await producer.connect();
  log('Kafka producer connected');

  await consumer.connect();
  await consumer.subscribe({ topic: 'architectai.code.generated', fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      let event;
      try {
        event = JSON.parse(message.value.toString());
      } catch (err) {
        log(`Skipping unparseable message: ${err.message}`);
        return;
      }

      try {
        await handleCodeGenerated(event);
      } catch (err) {
        // Never let an unhandled error bubble up and kill the consumer loop
        log(`[${event?.buildId ?? '?'}] Unhandled error in handler: ${err.message}`);
        await publishFailed(event?.buildId, event?.userId, err.message);
      }
    },
  });

  log('Consumer started — listening on architectai.code.generated');
}

module.exports = { startConsumer, setDb };
