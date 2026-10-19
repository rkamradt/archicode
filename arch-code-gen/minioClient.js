'use strict';

const {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
} = require('@aws-sdk/client-s3');

const BUCKET = process.env.MINIO_BUCKET || 'architectai-builds';

const s3 = new S3Client({
  endpoint:    process.env.MINIO_ENDPOINT,
  region:      'us-east-1',
  credentials: {
    accessKeyId:     process.env.MINIO_ACCESS_KEY,
    secretAccessKey: process.env.MINIO_SECRET_KEY,
  },
  forcePathStyle: true,
});

async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
      console.log(`MinIO bucket "${BUCKET}" created`);
    } else {
      console.error('MinIO bucket check failed:', err.message);
    }
  }
}

async function putObject(key, body) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body }));
}

module.exports = { ensureBucket, putObject };
