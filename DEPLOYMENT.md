# ArchitectAI — Deployment Guide
## kamradtfamily.net platform

Deploys two services following the standard [Adding a Service runbook](https://rkamradt.github.io/rkamradt-docs/runbooks/adding-a-service/):
- **architectai** — React SPA served by nginx (`architect.kamradtfamily.net`)
- **architectai-api** — Node/Express backend (`api.architect.kamradtfamily.net`)

---

## Prerequisites

- Access to Auth0 dashboard (your existing tenant)
- Access to Cloudflare Zero Trust dashboard
- `kubectl` access to the cluster
- Write access to `rkamradt-helm-charts`

---

## Step 1 — Create GitHub repositories

```bash
# Two repos, matching your existing pattern
gh repo create rkamradt/architectai --public
gh repo create rkamradt/architectai-api --public
```

`architectai-api` gets the files from this guide (`server.js`, `package.json`, `Dockerfile`).
`architectai` gets the Vite project (`src/App.jsx` updated per Step 5, `Dockerfile.frontend`, `nginx.conf`).

Add the standard `publish.yml` GitHub Actions workflow to both repos (from the runbook).
For `architectai`, the workflow needs extra build args — see Step 4.

Also create a dedicated **spec repo**:
```bash
gh repo create rkamradt/architectai-specs --private
```
This is the GitHub SOT that ArchitectAI pushes `ecosystem.json` and `spec.md` to.

---

## Step 2 — Auth0: create a SPA application

In Auth0 dashboard → Applications → Create Application:

| Setting | Value |
|---------|-------|
| Name | ArchitectAI |
| Type | **Single Page Application** (not Regular Web App) |
| Allowed Callback URLs | `https://architect.kamradtfamily.net, http://localhost:5173` |
| Allowed Logout URLs | `https://architect.kamradtfamily.net, http://localhost:5173` |
| Allowed Web Origins | `https://architect.kamradtfamily.net, http://localhost:5173` |

Note the **Domain** and **Client ID** — you'll need them in Step 4.

### Create an API (for the backend audience)

Auth0 dashboard → Applications → APIs → Create API:

| Setting | Value |
|---------|-------|
| Name | ArchitectAI API |
| Identifier (audience) | `https://api.architect.kamradtfamily.net` |
| Signing Algorithm | RS256 |

The identifier is what goes in `AUTH0_AUDIENCE` and `VITE_AUTH0_AUDIENCE`.

---

## Step 3 — Kubernetes secrets

```bash
# Backend secrets
kubectl create secret generic architectai-api-secrets \
  --namespace=rkamradt-platform \
  --from-literal=MONGODB_URI=mongodb://architectai:PASSWORD@mongodb.rkamradt-platform:27017/architectai \
  --from-literal=AUTH0_ISSUER_BASE_URL=https://YOUR_TENANT.auth0.com/ \
  --from-literal=AUTH0_AUDIENCE=https://api.architect.kamradtfamily.net \
  --from-literal=FRONTEND_URL=https://architect.kamradtfamily.net

# MongoDB user for architectai (if using shared MongoDB)
# Connect to the mongo pod and run:
# db.createUser({ user: "architectai", pwd: "PASSWORD", roles: [{ role: "readWrite", db: "architectai" }] })
```

---

## Step 4 — Helm charts in rkamradt-helm-charts

Create two chart directories following the existing webapp pattern:

### `architectai-api/`

```
Chart.yaml:
  name: architectai-api
  description: ArchitectAI backend API
  version: 0.1.0

values.yaml:
  replicaCount: 1
  image:
    repository: ghcr.io/rkamradt/architectai-api
    tag: main
    pullPolicy: Always
  imagePullSecrets:
    - name: ghcr-secret
  service:
    type: ClusterIP
    port: 8080
  envFrom:
    - secretRef:
        name: architectai-api-secrets
  resources:
    requests:
      memory: "128Mi"
      cpu: "50m"
    limits:
      memory: "256Mi"
      cpu: "250m"
```

### `architectai/`

The frontend bakes its env vars at build time via Docker ARG.
The GitHub Actions workflow in `rkamradt/architectai` must pass them:

```yaml
# In publish.yml, update the build-push-action step:
- uses: docker/build-push-action@v5
  with:
    context: .
    push: true
    tags: ${{ steps.meta.outputs.tags }}
    build-args: |
      VITE_AUTH0_DOMAIN=YOUR_TENANT.auth0.com
      VITE_AUTH0_CLIENT_ID=YOUR_SPA_CLIENT_ID
      VITE_AUTH0_AUDIENCE=https://api.architect.kamradtfamily.net
      VITE_API_BASE_URL=https://api.architect.kamradtfamily.net
```

```
architectai/values.yaml:
  replicaCount: 1
  image:
    repository: ghcr.io/rkamradt/architectai
    tag: main
    pullPolicy: Always
  imagePullSecrets:
    - name: ghcr-secret
  service:
    type: ClusterIP
    port: 80
  resources:
    requests:
      memory: "32Mi"
      cpu: "10m"
    limits:
      memory: "64Mi"
      cpu: "100m"
```

### `apps/values.yaml` — add both entries

```yaml
apps:
  # ... existing entries ...
  - name: architectai-api
    path: architectai-api
    namespace: rkamradt-platform
  - name: architectai
    path: architectai
    namespace: rkamradt-platform
```

Commit and push. ArgoCD deploys both.

---

## Step 5 — Update App.jsx for Auth0 + backend API

Install dependencies in the `architectai` Vite project:

```bash
npm install @auth0/auth0-react
```

### `src/main.jsx`

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

### Changes to App.jsx

Replace `window.storage` persistence and direct API calls with backend calls.
The key change is adding this API client helper near the top of the component:

```js
import { useAuth0 } from '@auth0/auth0-react'

// Inside the component:
const { isAuthenticated, isLoading, loginWithRedirect, logout, getAccessTokenSilently, user } = useAuth0();

const api = async (path, method = 'GET', body = null) => {
  const token = await getAccessTokenSilently();
  const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
};
```

Then replace:
- `window.storage.get/set` → `api('/api/ecosystem')` / `api('/api/ecosystem', 'PUT', { projectName, services })`
- Direct `fetch('https://api.anthropic.com/v1/messages', ...)` → `api('/api/messages', 'POST', payload)`
- Direct GitHub fetch → `api('/api/github/pull', 'POST')` / `api('/api/github/push', 'POST', { files })`
- GitHub config → `api('/api/github/config')` / `api('/api/github/config', 'PUT', cfg)`

Add a login gate before the main render:

```jsx
if (isLoading) return <div style={{ color: '#64748b', padding: '40px', fontFamily: 'IBM Plex Mono' }}>Loading…</div>
if (!isAuthenticated) return (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#07101f', gap: '16px' }}>
    <div style={{ color: '#3b82f6', fontFamily: 'IBM Plex Mono', fontSize: '24px', fontWeight: 700 }}>◈ ARCHITECTAI</div>
    <button onClick={() => loginWithRedirect()} style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px 28px', fontFamily: 'IBM Plex Mono', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
      SIGN IN
    </button>
  </div>
)
```

---

## Step 6 — Cloudflare: tunnel hostnames

In Cloudflare Zero Trust → Networks → Tunnels → your tunnel → Public Hostnames:

| Hostname | Service URL |
|----------|-------------|
| `architect.kamradtfamily.net` | `http://architectai.rkamradt-platform:80` |
| `api.architect.kamradtfamily.net` | `http://architectai-api.rkamradt-platform:8080` |

---

## Step 7 — Cloudflare Access application

Protect the frontend (the backend validates JWTs independently, so it doesn't need an Access policy):

Zero Trust → Access → Applications → Add → Self-hosted:

| Setting | Value |
|---------|-------|
| Name | ArchitectAI |
| Domain | `architect.kamradtfamily.net` |
| Session duration | 24h |
| Identity provider | Auth0 OIDC connector |
| Policy | Allow — Email ends in your domain |

The API subdomain (`api.architect.kamradtfamily.net`) should be left **without** a Cloudflare Access policy — it's protected by Auth0 JWT validation in the Express middleware instead. Cloudflare Access and JWT validation would double-authenticate every API call.

---

## Step 8 — ArchitectAI spec repo config

Once deployed, open ArchitectAI → ⎔ GitHub settings:

| Field | Value |
|-------|-------|
| Owner | rkamradt |
| Repo | architectai-specs |
| Branch | main |
| File path | ecosystem.json |

The GitHub PAT you enter here is stored in MongoDB server-side — it never leaves the backend.

---

## Verification checklist

- [ ] `https://architect.kamradtfamily.net` redirects to Auth0 login
- [ ] After login, the canvas loads from MongoDB
- [ ] Chat messages reach Anthropic via the backend proxy
- [ ] ↑ push commits `ecosystem.json` + `spec.md` to `rkamradt/architectai-specs`
- [ ] ArgoCD shows both apps healthy
- [ ] `kubectl logs -n rkamradt-platform deploy/architectai-api` shows requests

---

## CLAUDE.md for Claude Code

Drop this in both repos to let Claude Code scaffold/iterate with full context:

```markdown
# architectai-api
Part of the kamradtfamily.net platform. See platform docs at https://rkamradt.github.io/rkamradt-docs/

## Purpose
Express backend for ArchitectAI. Proxies Anthropic API calls, persists ecosystems
per Auth0 user in MongoDB, and proxies GitHub push/pull keeping the PAT server-side.

## Auth
All routes (except /health) require Auth0 JWT via express-oauth2-jwt-bearer.
Audience: https://api.architect.kamradtfamily.net

## Environment variables (from K8s secret architectai-api-secrets)
- MONGODB_URI
- AUTH0_ISSUER_BASE_URL
- AUTH0_AUDIENCE
- FRONTEND_URL

Note: ANTHROPIC_API_KEY is no longer a server env var — each user stores their own
key in MongoDB via the onboarding flow. The /api/user/profile endpoints manage it.

## Build & deploy
push to main → GitHub Actions builds → pushes ghcr.io/rkamradt/architectai-api:main
→ ArgoCD detects new tag → redeploys in rkamradt-platform namespace

## Local dev
MONGODB_URI=... AUTH0_ISSUER_BASE_URL=... AUTH0_AUDIENCE=... npm run dev
```
