# github-provider

This service is a provider archetype — it contains no business logic. Its sole responsibility is adapting ArchitectAI's internal events to GitHub's external API and reporting results back.

It consumes `architectai.code.generated` events from Kafka, fetches the generated code artifact from MinIO, pushes the files to GitHub, monitors the GitHub Actions pipeline until completion, and publishes `architectai.build.complete` or `architectai.build.failed` events.

## Archetype Constraints

This service contains no business logic. It translates internal events to GitHub API calls and reports results. Any business decisions about what to build or how to structure code belong in ArchitectAI, not here.

## Environment

- Kafka: `kafka.kafka.svc.cluster.local:9092`
- MinIO: `http://minio.minio.svc.cluster.local:9000`
- MongoDB: shared with ArchitectAI, read-only access to `github_configs` collection for PAT retrieval
