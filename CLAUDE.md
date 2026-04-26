# ArchitectAI — Claude Code Context

This directory contains the source for two services deployed on the
kamradtfamily.net home Kubernetes platform. Read DEPLOYMENT.md for the full
deployment runbook. Read the platform docs at https://rkamradt.github.io/rkamradt-docs/
before making infrastructure decisions.

## What is here

| File | Destination | Purpose |
|------|-------------|---------|
| `architect-ai.jsx` | `rkamradt/architectai` → `src/App.jsx` | React SPA — complete, production-ready UI |
| `Dockerfile.frontend` | `rkamradt/architectai` → `Dockerfile` | Two-stage nginx build for the SPA |
| `nginx.conf` | `rkamradt/architectai` → `nginx.conf` | SPA routing + asset caching |
| `server.js` | `rkamradt/architectai-api` → `server.js` | Express backend — per-user Anthropic proxy, MongoDB, GitHub proxy |
| `architectai-api-package.json` | `rkamradt/architectai-api` → `package.json` | Backend dependencies |
| `Dockerfile.api` | `rkamradt/architectai-api` → `Dockerfile` | Node 20 alpine image |
| `DEPLOYMENT.md` | reference | Full step-by-step deployment guide |

---

## Two repos to create

### 1. `rkamradt/architectai` — React SPA (frontend)

Scaffold a Vite React project, then drop in the files:

```bash
npm create vite@latest architectai -- --template react
cd architectai
npm install
npm install @auth0/auth0-react
```

Place `architect-ai.jsx` as `src/App.jsx` (it is complete — no further edits needed).
Place `Dockerfile.frontend` as `Dockerfile`.
Place `nginx.conf` at the repo root.

**Update `src/main.jsx`** to wrap with Auth0Provider:

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Auth0Provider } from '@auth0/auth0-react'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <Auth0Provider
    domain={import.meta.env.VITE_AUTH0_DOMAIN}
    clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
    authorizationParams={{
      redirect_uri: window.location.origin,
      audience: import.meta.env.VITE_AUTH0_AUDIENCE,
    }}
  >
    <App />
  </Auth0Provider>
)
```

Add a local `.env.local` for development (never commit this):
```
VITE_AUTH0_DOMAIN=YOUR_TENANT.auth0.com
VITE_AUTH0_CLIENT_ID=YOUR_SPA_CLIENT_ID
VITE_AUTH0_AUDIENCE=https://api.architect.kamradtfamily.net
VITE_API_BASE_URL=http://localhost:3001
```

Add `.github/workflows/publish.yml` following the platform runbook, with these build-args:
```yaml
build-args: |
  VITE_AUTH0_DOMAIN=YOUR_TENANT.auth0.com
  VITE_AUTH0_CLIENT_ID=YOUR_SPA_CLIENT_ID
  VITE_AUTH0_AUDIENCE=https://api.architect.kamradtfamily.net
  VITE_API_BASE_URL=https://api.architect.kamradtfamily.net
```

---

### 2. `rkamradt/architectai-api` — Express backend

```bash
mkdir architectai-api && cd architectai-api
# copy server.js, rename architectai-api-package.json → package.json, copy Dockerfile.api → Dockerfile
npm install
```

Add `.github/workflows/publish.yml` following the platform runbook exactly (no build-args needed).

Add `.env.local` for development (never commit):
```
MONGODB_URI=mongodb://localhost:27017/architectai
AUTH0_ISSUER_BASE_URL=https://YOUR_TENANT.auth0.com/
AUTH0_AUDIENCE=https://api.architect.kamradtfamily.net
FRONTEND_URL=http://localhost:5173
PORT=3001
```

Note: there is no `ANTHROPIC_API_KEY` env var. Each user supplies their own Anthropic
API key through the app's onboarding flow; keys are stored per-user in MongoDB.

Run locally with `node -r dotenv/config server.js` or add `dotenv` to package.json scripts.

---

## How the app works

### User onboarding
1. User signs in via Auth0.
2. Frontend calls `GET /api/user/profile` — if `hasApiKey` is false, an onboarding
   screen prompts for the user's Anthropic API key.
3. User submits key → `PUT /api/user/profile` stores it in MongoDB (server-side only,
   never returned to the browser).
4. All subsequent `/api/messages` calls use the calling user's stored key.
5. Users can update their key at any time via the `⚿` button in the app header.

### Ecosystem persistence
Each user's ecosystem (service list + project name) is stored in MongoDB via
`GET/PUT /api/ecosystem`. Data is loaded on login and saved on every change.

### GitHub integration
Users configure a GitHub repo (owner, repo, branch, file path, PAT) via the `⎔`
settings panel. The PAT is stored server-side in MongoDB and never returned to the
browser (displayed as `••••••••`).

**Push** (`↑ push` button) commits all ecosystem artifacts to the configured repo in
one operation:
- `ecosystem.json` — machine-readable service registry
- `spec.md` — human-readable living specification
- `CLAUDE.md` — spine context file for Claude Code
- `<service-id>/CLAUDE.md` — per-service context file for each service

The backend auto-fetches the current SHA for each file before pushing, so pushes are
idempotent across sessions (no stale-SHA errors).

**Pull** (`↓ pull` button) fetches `ecosystem.json` from the repo and restores the
service list and project name.

### Backend API surface

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | none | Liveness check |
| GET | `/api/user/profile` | JWT | Returns `{ hasApiKey: bool }` |
| PUT | `/api/user/profile` | JWT | Saves user's Anthropic API key |
| GET | `/api/ecosystem` | JWT | Load ecosystem for current user |
| PUT | `/api/ecosystem` | JWT | Save ecosystem for current user |
| GET | `/api/github/config` | JWT | Load GitHub config (token masked) |
| PUT | `/api/github/config` | JWT | Save GitHub config |
| POST | `/api/github/pull` | JWT | Fetch ecosystem.json from GitHub |
| POST | `/api/github/push` | JWT | Push all artifacts to GitHub |
| POST | `/api/messages` | JWT | Proxy to Anthropic using user's key |

### MongoDB collections

| Collection | Index | Contents |
|------------|-------|----------|
| `users` | `userId` (unique) | Anthropic API key per user |
| `ecosystems` | `userId` (unique) | Service list + project name per user |
| `github_configs` | `userId` (unique) | GitHub repo config + PAT per user |

---

## Platform deployment (after pushing both repos)

Follow DEPLOYMENT.md steps 2–8 in order:
1. Auth0: create SPA application + API audience
2. Kubernetes: create `architectai-api-secrets` secret (no Anthropic key needed)
3. Helm: add chart directories to `rkamradt-helm-charts`, add entries to `apps/values.yaml`
4. Cloudflare: add two tunnel hostnames, one Access application (frontend only)

## Architecture constraints (from platform docs)

- Traffic enters only via Cloudflare Tunnel — no NodePort or LoadBalancer services
- Auth0 is the only OIDC provider — do not introduce a second one
- Images publish to `ghcr.io/rkamradt/<repo-name>:main` via GitHub Actions
- ArgoCD watches `rkamradt-helm-charts` — changes deploy automatically on push
- MongoDB 4.4 is AVX-constrained — do not upgrade or replace it
- Namespace for all services: `rkamradt-platform`
- The API subdomain does NOT get a Cloudflare Access policy — Auth0 JWT handles it

## Local development (no Kubernetes required)

```bash
# Terminal 1 — backend
cd architectai-api
node -r dotenv/config server.js

# Terminal 2 — frontend
cd architectai
npm run dev
# Opens http://localhost:5173
# Calls backend at http://localhost:3001 (VITE_API_BASE_URL)
```

MongoDB must be running locally or pointed at the cluster via port-forward:
```bash
kubectl port-forward -n mongodb svc/mongodb 27017:27017
```
