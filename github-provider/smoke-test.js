'use strict';

/**
 * smoke-test.js — end-to-end smoke test for the github-provider pipeline
 *
 * 1. Builds a minimal Node.js "hello-world" app in memory
 * 2. Zips it and uploads to MinIO
 * 3. Publishes architectai.code.generated to Kafka
 * 4. Subscribes to architectai.build.complete and architectai.build.failed
 * 5. Waits up to WAIT_TIMEOUT_MS for a terminal event, then exits
 *
 * Usage (local, with Kafka + MinIO port-forwarded):
 *   npm run smoke
 *
 *   kubectl port-forward -n kafka  svc/kafka  9092:9092
 *   kubectl port-forward -n minio  svc/minio  9000:9000
 *   kubectl port-forward -n mongodb svc/mongodb 27017:27017
 *
 * Config (.env.local):
 *   MINIO_ACCESS_KEY, MINIO_SECRET_KEY  — required; match your MinIO deployment
 *   TEST_USER_ID                        — Auth0 sub of a user with githubToken in MongoDB
 *   REPO_NAME                           — override the auto-generated repo name
 *   WAIT_TIMEOUT_MS                     — how long to wait (default 300000 = 5 min)
 *
 * All other values default to localhost port-forwarded addresses.
 */

// Load .env.local for local dev (gitignored); silently skip if absent.
require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });

const { Kafka }       = require('kafkajs');
const AdmZip          = require('adm-zip');
const {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
} = require('@aws-sdk/client-s3');
const crypto = require('crypto');

// ── Config ─────────────────────────────────────────────────────────────────────
const BUILD_ID        = `smoke-${crypto.randomBytes(4).toString('hex')}`;
const USER_ID         = process.env.TEST_USER_ID   || (() => { throw new Error('TEST_USER_ID is required — set it in .env.local to the Auth0 sub of a user with GitHub creds in MongoDB'); })();
const REPO_NAME       = process.env.REPO_NAME      || `smoke-test-${BUILD_ID}`;
const BUCKET          = process.env.MINIO_BUCKET   || 'architectai-builds';
const WAIT_TIMEOUT_MS = parseInt(process.env.WAIT_TIMEOUT_MS || '300000', 10); // 5 min default
const OBJECT_KEY      = `builds/${BUILD_ID}.zip`;

// ── MinIO ──────────────────────────────────────────────────────────────────────
const s3 = new S3Client({
  endpoint:    process.env.MINIO_ENDPOINT    || 'http://localhost:9000',
  region:      'us-east-1',
  credentials: {
    accessKeyId:     process.env.MINIO_ACCESS_KEY || (() => { throw new Error('MINIO_ACCESS_KEY is required'); })(),
    secretAccessKey: process.env.MINIO_SECRET_KEY || (() => { throw new Error('MINIO_SECRET_KEY is required'); })(),
  },
  forcePathStyle: true,
});

// ── Kafka ──────────────────────────────────────────────────────────────────────
const kafka = new Kafka({ clientId: 'smoke-test', brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',') });
const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: `smoke-test-${BUILD_ID}` });

// ── Logging ────────────────────────────────────────────────────────────────────
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── Step 1 — Build minimal app in memory ──────────────────────────────────────
function buildArtifact() {
  const zip = new AdmZip();

  // hello-world service: a single-file Express server
  zip.addFile('hello-world/server.js', Buffer.from(`'use strict';
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, message: 'Hello from smoke-test!' }));
}).listen(PORT, () => console.log(\`Listening on \${PORT}\`));
`));

  zip.addFile('hello-world/package.json', Buffer.from(JSON.stringify({
    name:    'hello-world',
    version: '1.0.0',
    scripts: { start: 'node server.js' },
  }, null, 2)));

  zip.addFile('hello-world/Dockerfile', Buffer.from(`FROM node:20-alpine
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
`));

  log(`Built in-memory artifact: hello-world service (3 files)`);
  return zip.toBuffer();
}

// ── Step 2 — Upload to MinIO ───────────────────────────────────────────────────
async function uploadArtifact(zipBuffer) {
  // Ensure bucket exists
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
      log(`Created MinIO bucket "${BUCKET}"`);
    } else {
      throw err;
    }
  }

  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: OBJECT_KEY, Body: zipBuffer }));
  log(`Uploaded artifact to MinIO: ${BUCKET}/${OBJECT_KEY}`);
}

// ── Step 3 — Publish Kafka event ───────────────────────────────────────────────
async function publishCodeGenerated() {
  await producer.connect();
  await producer.send({
    topic:    'architectai.code.generated',
    messages: [{
      key:   BUILD_ID,
      value: JSON.stringify({
        buildId:   BUILD_ID,
        userId:    USER_ID,
        repoName:  REPO_NAME,
        objectKey: OBJECT_KEY,
      }),
    }],
  });
  log(`Published architectai.code.generated (buildId=${BUILD_ID}, repo=${REPO_NAME})`);
}

// ── Step 4 — Wait for terminal event ──────────────────────────────────────────
function waitForResult() {
  return new Promise(async (resolve) => {
    let timer;

    const finish = (result) => {
      clearTimeout(timer);
      resolve(result);
    };

    timer = setTimeout(() => {
      log(`Timed out after ${WAIT_TIMEOUT_MS / 1000}s waiting for build result`);
      finish({ outcome: 'timeout' });
    }, WAIT_TIMEOUT_MS);

    await consumer.connect();
    await consumer.subscribe({
      topics: ['architectai.build.complete', 'architectai.build.failed', 'architectai.build.status'],
      fromBeginning: false,
    });

    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        let payload;
        try { payload = JSON.parse(message.value.toString()); } catch { return; }

        // Only care about our build
        if (payload.buildId !== BUILD_ID) return;

        if (topic === 'architectai.build.status') {
          log(`  [status] attempt=${payload.attempt} pipelineUrl=${payload.pipelineUrl || '—'}`);
          return;
        }

        if (topic === 'architectai.build.complete') {
          log(`  [complete] pipelineUrl=${payload.pipelineUrl}`);
          (payload.images || []).forEach(img => log(`    image: ${img.serviceId} → ${img.image}`));
          finish({ outcome: 'success', payload });
        } else if (topic === 'architectai.build.failed') {
          log(`  [failed] error=${payload.error}`);
          finish({ outcome: 'failure', payload });
        }
      },
    });
  });
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  log(`=== github-provider smoke test ===`);
  log(`buildId=${BUILD_ID}  userId=${USER_ID}  repo=${REPO_NAME}`);

  try {
    const zip = buildArtifact();
    await uploadArtifact(zip);
    await publishCodeGenerated();

    log(`Waiting up to ${WAIT_TIMEOUT_MS / 1000}s for build result…`);
    const result = await waitForResult();

    log(`=== Result: ${result.outcome.toUpperCase()} ===`);
    process.exit(result.outcome === 'success' ? 0 : 1);
  } catch (err) {
    log(`Fatal error: ${err.message}`);
    console.error(err);
    process.exit(2);
  } finally {
    await producer.disconnect().catch(() => {});
    await consumer.disconnect().catch(() => {});
  }
}

main();
