'use strict';

// Load .env.local for local development (gitignored; silently skipped in prod).
require('dotenv').config({ path: require('path').join(__dirname, '.env.local') });

const express            = require('express');
const { MongoClient }    = require('mongodb');
const { startConsumer, setDb } = require('./consumer');

const app = express();
app.use(express.json());

// ── MongoDB ───────────────────────────────────────────────────────────────────
// Read-only access to the shared architectai database.
// Only the github_configs collection is used (PAT retrieval).
let db;
let dbReady = false;

function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  MongoClient.connect(uri)
    .then(client => {
      db = client.db('architectai');
      dbReady = true;
      console.log('MongoDB connected');
      setDb(db);
      startConsumer().catch(err => console.error('Consumer start failed:', err.message));
    })
    .catch(err => {
      console.error('MongoDB connection failed:', err.message);
      process.exit(1);
    });
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, db: dbReady }));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`github-provider listening on ${PORT}`);
  connectMongo();
});
