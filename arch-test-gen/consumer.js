'use strict';

const AdmZip               = require('adm-zip');
const { runTestAgent }     = require('./testAgent');
const { producer, consumer } = require('./kafkaClient');
const { ensureBucket, putObject } = require('./minioClient');

// ── DB handle set by server.js after MongoDB connects ─────────────────────────
let db;
function setDb(database) { db = database; }

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── Publish build.failed so architectai-api can update build status ───────────
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

// ── Main handler ──────────────────────────────────────────────────────────────
async function handleImplementationRequested(event) {
  const { buildId, userId, repoName, ecosystem } = event;
  log(`[${buildId}] Received implementation.requested repo=${repoName} user=${userId}`);

  // Look up Anthropic credentials — same users collection as architectai-api
  const userDoc = await db.collection('users').findOne({ userId });
  const apiKey  = userDoc?.anthropicApiKey;

  if (!apiKey) {
    await publishFailed(buildId, userId, 'No Anthropic API key configured for this user');
    return;
  }

  // Run test generation sessions (one per non-mock service)
  let workspace;
  try {
    workspace = await runTestAgent(
      ecosystem,
      apiKey,
      ({ type, message, service }) => {
        log(`[${buildId}] ${type}: ${message || ''} service=${service || ''}`);
      }
    );
  } catch (err) {
    await publishFailed(buildId, userId, `Test generation failed: ${err.message}`);
    return;
  }

  const fileCount = Object.keys(workspace).length;
  if (fileCount === 0) {
    // Non-fatal: an ecosystem with no testable services (edge case — still publish so github-provider can proceed)
    log(`[${buildId}] No test files generated (no testable services in ecosystem)`);
  }

  // Zip test files and upload to MinIO
  let objectKey;
  try {
    const zip = new AdmZip();
    for (const [filePath, content] of Object.entries(workspace)) {
      zip.addFile(filePath, Buffer.from(content, 'utf-8'));
    }
    objectKey = `${buildId}/tests.zip`;
    await putObject(objectKey, zip.toBuffer());
    log(`[${buildId}] Uploaded ${fileCount} test files → MinIO ${objectKey}`);
  } catch (err) {
    await publishFailed(buildId, userId, `Test artifact upload failed: ${err.message}`);
    return;
  }

  // Signal that tests are ready — github-provider waits for this alongside code.generated
  await producer.send({
    topic:    'architectai.tests.generated',
    messages: [{
      key:   buildId,
      value: JSON.stringify({ buildId, userId, repoName, objectKey }),
    }],
  });
  log(`[${buildId}] Published tests.generated (${objectKey})`);
}

// ── Consumer lifecycle ────────────────────────────────────────────────────────
async function startConsumer() {
  await ensureBucket();

  await producer.connect();
  log('Kafka producer connected');

  await consumer.connect();
  await consumer.subscribe({ topic: 'architectai.implementation.requested', fromBeginning: false });

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
        await handleImplementationRequested(event);
      } catch (err) {
        log(`[${event?.buildId ?? '?'}] Unhandled error: ${err.message}`);
        await publishFailed(event?.buildId, event?.userId, err.message);
      }
    },
  });

  log('Consumer started — listening on architectai.implementation.requested');
}

module.exports = { startConsumer, setDb };
