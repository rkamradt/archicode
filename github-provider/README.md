# github-provider

Part of the **ArchitectAI** platform. Adapts internal code-generation events to GitHub API calls and reports build results back.

This service is a **provider archetype** — it contains no business logic. All decisions about what to build and how to structure code belong in ArchitectAI. This service only translates internal events into GitHub API operations and reports what happened.

## What it does

1. **Consumes** `architectai.code.generated` from Kafka
2. **Creates** the target GitHub repository (idempotent — continues if it already exists)
3. **Fetches** the generated code artifact (zip) from MinIO
4. **Pushes** all files to GitHub via the Contents API (SHA-aware, idempotent)
5. **Monitors** the GitHub Actions pipeline until it reaches a terminal state
6. **Publishes** `architectai.build.complete` or `architectai.build.failed` to Kafka

Intermediate pipeline status is published to `architectai.build.status` on each poll so the UI can show live progress.

## Kafka topics

| Direction | Topic | Description |
|-----------|-------|-------------|
| Consumes  | `architectai.code.generated` | Triggers the build pipeline |
| Produces  | `architectai.build.status`   | Intermediate pipeline progress |
| Produces  | `architectai.build.complete` | Build succeeded — includes image references |
| Produces  | `architectai.build.failed`   | Build failed — includes error and pipeline URL |

## Dependencies

| Service  | Access | Purpose |
|----------|--------|---------|
| Kafka    | Consumer + Producer | Event bus |
| MinIO    | Read-only | Fetch generated code artifact |
| MongoDB  | Read-only (`users` collection) | Retrieve GitHub PAT and owner per user |

## Environment variables

All configuration is injected via environment variables. In Kubernetes these come from the `github-provider-secrets` Secret.

| Variable | Description | Default |
|----------|-------------|---------|
| `KAFKA_BROKERS` | Comma-separated broker list | `localhost:9092` |
| `MINIO_ENDPOINT` | MinIO endpoint URL | — |
| `MINIO_ACCESS_KEY` | MinIO access key | — |
| `MINIO_SECRET_KEY` | MinIO secret key | — |
| `MINIO_BUCKET` | Bucket containing build artifacts | `architectai-builds` |
| `MONGODB_URI` | MongoDB connection string | — |
| `GITHUB_POLL_INTERVAL_MS` | Milliseconds between pipeline polls | `10000` |
| `GITHUB_MAX_POLL_ATTEMPTS` | Maximum poll attempts before timeout | `30` |
| `PORT` | HTTP port for the health endpoint | `3002` |

## Local development

```bash
cp .env.local .env   # fill in real values
npm install
npm run dev
```

Port-forward MongoDB and MinIO from the cluster if needed:

```bash
kubectl port-forward -n mongodb svc/mongodb 27017:27017
kubectl port-forward -n minio svc/minio 9000:9000
```

Kafka must be reachable at the address in `KAFKA_BROKERS`. For local testing, a Kafka instance at `localhost:9092` works.

## Health check

```
GET /health
```

Returns `{ ok: true, db: true|false }`. The `db` flag reflects whether MongoDB has connected. The health endpoint responds immediately on startup even before MongoDB is ready.

## Deployment

Deployed to the `rkamradt-platform` namespace via the Helm chart in `rkamradt-helm-charts/github-provider`. ArgoCD syncs automatically on push to that repo.

The GitHub Actions workflow (`.github/workflows/github-provider.yml` at the archicode repo root) builds and pushes `ghcr.io/rkamradt/github-provider` on every push that changes files under `github-provider/**`, then updates the Helm chart's `version-values.yaml` via `HELM_CHARTS_PAT`.

### Kubernetes secret

Create this before ArgoCD first syncs:

```bash
kubectl create secret generic github-provider-secrets \
  --namespace rkamradt-platform \
  --from-literal=KAFKA_BROKERS=kafka.kafka.svc.cluster.local:9092 \
  --from-literal=MINIO_ENDPOINT=http://minio.minio.svc.cluster.local:9000 \
  --from-literal=MINIO_ACCESS_KEY=<key> \
  --from-literal=MINIO_SECRET_KEY=<secret> \
  --from-literal=MINIO_BUCKET=architectai-builds \
  --from-literal=MONGODB_URI=mongodb://mongodb.mongodb:27017/architectai \
  --from-literal=GITHUB_POLL_INTERVAL_MS=10000 \
  --from-literal=GITHUB_MAX_POLL_ATTEMPTS=30
```
