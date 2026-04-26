# ArchitectAI — Claude Code Context

This directory contains the source for two new services being added to the
kamradtfamily.net home Kubernetes platform. Read DEPLOYMENT.md for the full
deployment runbook. Read the platform docs at https://rkamradt.github.io/rkamradt-docs/
before making infrastructure decisions.

## What is here

| File | Destination | Purpose |
|------|-------------|---------|
| `architect-ai.jsx` | `rkamradt/architectai` → `src/App.jsx` | React SPA — the full ArchitectAI UI |
| `Dockerfile.frontend` | `rkamradt/architectai` → `Dockerfile` | Two-stage nginx build for the SPA |
| `nginx.conf` | `rkamradt/architectai` → `nginx.conf` | SPA routing + asset caching |
| `server.js` | `rkamradt/architectai-api` → `server.js` | Express backend — Anthropic proxy, MongoDB, GitHub proxy |
| `architectai-api-package.json` | `rkamradt/architectai-api` → `package.json` | Backend dependencies |
| `Dockerfile.api` | `rkamradt/architectai-api` → `Dockerfile` | Node 20 alpine image |
| `DEPLOYMENT.md` | reference | Full step-by-step deployment guide |

## Two repos to create

### 1. `rkamradt/architectai` — React SPA (frontend)

Scaffold a Vite React project, then drop in the files above:

```bash
npm create vite@latest architectai -- --template react
cd architectai
npm install
npm install @auth0/auth0-react
```

Place `architect-ai.jsx` as `src/App.jsx`.
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

**Update `src/App.jsx`** — make four changes:

1. Add Auth0 hook and login gate at the top of the default export component:
```jsx
import { useAuth0 } from '@auth0/auth0-react'

// inside the component, before any other logic:
const { isAuthenticated, isLoading, loginWithRedirect, logout, getAccessTokenSilently, user } = useAuth0();

if (isLoading) return (
  <div style={{ color: '#64748b', padding: '40px', fontFamily: 'IBM Plex Mono' }}>Loading…</div>
)
if (!isAuthenticated) return (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#07101f', gap: '16px' }}>
    <div style={{ color: '#3b82f6', fontFamily: 'IBM Plex Mono', fontSize: '24px', fontWeight: 700 }}>◈ ARCHITECTAI</div>
    <button onClick={() => loginWithRedirect()} style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px 28px', fontFamily: 'IBM Plex Mono', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
      SIGN IN
    </button>
  </div>
)
```

2. Add a logout button in the header (next to the reset button):
```jsx
<button onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
  style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: '4px', color: C.dim, cursor: 'pointer', fontSize: '11px', fontFamily: 'IBM Plex Mono', padding: '2px 8px' }}>
  sign out
</button>
```

3. Add this `api` helper inside the component (after the Auth0 hook line):
```js
const api = async (path, method = 'GET', body = null) => {
  const token = await getAccessTokenSilently();
  const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
};
```

4. Replace the three `window.storage` persistence calls with backend API calls:
   - Load on mount: replace `window.storage.get('architect-services')` and
     `window.storage.get('architect-project')` with a single `api('/api/ecosystem')` call
     that reads `{ services, projectName }` from the response.
   - Save on change: replace `window.storage.set('architect-services', ...)` and
     `window.storage.set('architect-project', ...)` with `api('/api/ecosystem', 'PUT', { services, projectName })`.

5. Replace the Anthropic fetch in the `send()` function:
   - Change `fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ... })`
   - To `api('/api/messages', 'POST', { model, max_tokens, system, messages })`
   - Remove the `Authorization: Bearer` header from that call — it's handled by `api()`.

6. Replace the GitHub direct calls in `ghPull()`, `ghPush()`, and `ghPushFile()`:
   - `ghPull()`: call `api('/api/github/pull', 'POST')` instead of fetching GitHub directly.
   - `ghPush()`: call `api('/api/github/push', 'POST', { files: [{ path, content, sha }] })`.
   - GitHub config save/load: call `api('/api/github/config', 'PUT', cfg)` and `api('/api/github/config')`.
   - The PAT field in the config panel can show `••••••••` when a token is already stored
     (the backend returns the masked value). Only send a new value when the user types one.

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
ANTHROPIC_API_KEY=sk-ant-...
MONGODB_URI=mongodb://localhost:27017/architectai
AUTH0_ISSUER_BASE_URL=https://YOUR_TENANT.auth0.com/
AUTH0_AUDIENCE=https://api.architect.kamradtfamily.net
FRONTEND_URL=http://localhost:5173
PORT=3001
```

Run locally with `node -r dotenv/config server.js` or add `dotenv` to package.json scripts.

---

## Platform deployment (after pushing both repos)

Follow DEPLOYMENT.md steps 2–8 in order:
1. Auth0: create SPA application + API audience
2. Kubernetes: create `architectai-api-secrets` secret
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
kubectl port-forward -n rkamradt-platform svc/mongodb 27017:27017
```

