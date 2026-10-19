'use strict';

const express        = require('express');
const { MongoClient } = require('mongodb');
const { startConsumer, setDb } = require('./consumer');

const app  = express();
const PORT = process.env.PORT || 8000;

app.get('/health', (req, res) => res.json({ ok: true, service: 'arch-code-gen' }));

MongoClient.connect(process.env.MONGODB_URI)
  .then(client => {
    const db = client.db('architectai');
    setDb(db);
    console.log('MongoDB connected');
    return startConsumer();
  })
  .catch(err => {
    console.error('Startup failed:', err.message);
    process.exit(1);
  });

app.listen(PORT, () => console.log(`arch-code-gen listening on ${PORT}`));
