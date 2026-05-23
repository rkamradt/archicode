'use strict';

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const BUCKET = process.env.MINIO_BUCKET || 'architectai-builds';

const s3 = new S3Client({
  endpoint:       process.env.MINIO_ENDPOINT,
  region:         'us-east-1',
  credentials: {
    accessKeyId:     process.env.MINIO_ACCESS_KEY,
    secretAccessKey: process.env.MINIO_SECRET_KEY,
  },
  forcePathStyle: true,
});

// Returns a Node.js Readable stream — caller collects chunks.
async function getObject(key) {
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return Body;
}

module.exports = { getObject };
