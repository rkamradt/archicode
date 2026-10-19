'use strict';

const AdmZip                    = require('adm-zip');
const { runImplementationAgent } = require('./agent');
const { producer, consumer }    = require('./kafkaClient');
const { ensureBucket, putObject } = require('./minioClient');

// ── DB handle set by server.js after MongoDB connects ─────────────────────────
let db;
function setDb(database) { db = database; }

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── Publish build.failed back so architectai-api can update build status ──────
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

  // Look up Anthropic credentials — stored per-user in MongoDB by architectai-api
  const userDoc = await db.collection('users').findOne({ userId });
  const apiKey  = userDoc?.anthropicApiKey;
  const model   = userDoc?.anthropicModel;

  if (!apiKey) {
    await publishFailed(buildId, userId, 'No Anthropic API key configured for this user');
    return;
  }

  // Run code generation agent sessions (one per service + root + mocks)
  let workspace;
  try {
    workspace = await runImplementationAgent(
      ecosystem,
      apiKey,
      ({ type, message, service }) => {
        log(`[${buildId}] ${type}: ${message || ''} service=${service || ''}`);
      },
      null,            // no disk output — files live in the workspace object
      async () => false, // no cancellation in async consumer context
      model
    );
  } catch (err) {
    await publishFailed(buildId, userId, `Code generation failed: ${err.message}`);
    return;
  }

  const fileCount = Object.keys(workspace).length;
  if (fileCount === 0) {
    await publishFailed(buildId, userId, 'Code generation produced no files');
    return;
  }

  // Zip all generated files and upload to MinIO
  let objectKey;
  try {
    const zip = new AdmZip();
    for (const [filePath, content] of Object.entries(workspace)) {
      zip.addFile(filePath, Buffer.from(content, 'utf-8'));
    }
    objectKey = `${buildId}/code.zip`;
    await putObject(objectKey, zip.toBuffer());
    log(`[${buildId}] Uploaded ${fileCount} files → MinIO ${objectKey}`);
  } catch (err) {
    await publishFailed(buildId, userId, `Artifact upload failed: ${err.message}`);
    return;
  }

  // Signal github-provider (and anyone else) that code is ready
  await producer.send({
    topic:    'architectai.code.generated',
    messages: [{
      key:   buildId,
      value: JSON.stringify({ buildId, userId, repoName, objectKey }),
    }],
  });
  log(`[${buildId}] Published code.generated (${objectKey})`);
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
