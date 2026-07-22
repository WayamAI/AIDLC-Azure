# Deploying AIDLC on Vercel

AIDLC supports two Vercel deployment modes. **Option A (recommended)** deploys frontend + API in one project with a single domain.

---

## Prerequisites

1. [Vercel account](https://vercel.com)
2. [MongoDB Atlas](https://www.mongodb.com/atlas) cluster (serverless functions cannot use `localhost`)
3. [Ollama Cloud](https://ollama.com) API key (or another OpenAI-compatible endpoint)
4. GitHub repo connected to Vercel

---

## Option A — One-click full stack (recommended)

Deploys the React app and FastAPI API on **one domain**. The frontend calls `/api` on the same host — no CORS setup needed.

### Steps

1. **Import the repo** on [vercel.com/new](https://vercel.com/new)
2. Select **WayamAI/AIDLC**
3. Leave **Root Directory** as `.` (repository root)
4. Vercel reads the root `vercel.json` automatically:
   - Builds `frontend/` → static files
   - Runs `api/index.py` → FastAPI at `/api/*`
5. **Add environment variables** (Settings → Environment Variables):

   | Variable | Value |
   |----------|-------|
   | `MONGODB_URI` | Your Atlas connection string |
   | `MONGODB_DB` | `aidlc` |
   | `OLLAMA_BASE_URL` | `https://ollama.com` |
   | `OLLAMA_API_KEY` | Your Ollama API key |
   | `OLLAMA_MODEL` | e.g. `gpt-oss:120b` |
   | `APP_ENV` | `production` |

   See [`.env.vercel.example`](../.env.vercel.example) for optional integrations.

6. **Deploy** — no `VITE_API_URL` needed (defaults to `/api`)

### Verify

- App: `https://your-project.vercel.app`
- API health: `https://your-project.vercel.app/health`
- API docs: `https://your-project.vercel.app/api` (routes listed at `/docs` won't work on serverless — use `/health`)

### CLI deploy

```bash
npm i -g vercel
vercel login
vercel --prod
```

---

## Option B — Split projects (frontend + backend)

Use this if you want separate scaling or custom domains per service.

### Backend project

1. New Vercel project → Root Directory: **`backend`**
2. Uses `backend/vercel.json` (Python serverless)
3. Set all env vars from `.env.vercel.example`
4. Note the deployment URL, e.g. `https://aidlc-api.vercel.app`

### Frontend project

1. New Vercel project → Root Directory: **`frontend`**
2. Uses `frontend/vercel.json` (Vite static)
3. Set build env:

   | Variable | Value |
   |----------|-------|
   | `VITE_API_URL` | `https://aidlc-api.vercel.app/api` |

4. On the **backend** project, add your frontend URL to `CORS_ORIGINS`:

   ```json
   ["https://aidlc-web.vercel.app"]
   ```

---

## MongoDB Atlas setup

1. Create a free M0 cluster
2. Database Access → create user
3. Network Access → **Allow access from anywhere** (`0.0.0.0/0`) for Vercel serverless
4. Connect → copy connection string → set as `MONGODB_URI`

---

## Known limitations on Vercel

| Feature | Status |
|---------|--------|
| Requirements → AI test generation | ✅ Works |
| GitHub / CI / Jira integrations | ✅ Works (with tokens) |
| Dashboard, PRD, Code Review | ✅ Works |
| **Live Playwright test execution** | ❌ Playwright cannot run in serverless |
| **AI IDE WebSocket streaming** | ❌ Vercel serverless does not support WebSockets |
| Long AI jobs (>60s) | ⚠️ Upgrade to Pro for `maxDuration` up to 300s |

For full Playwright + WebSocket support, use local dev or the [Azure VM guide](frontend/DEPLOY_AZURE_VM.md).

---

## Troubleshooting

### `FUNCTION_INVOCATION_FAILED`
- Check Vercel → Deployments → Functions → Logs
- Verify `MONGODB_URI` is Atlas (not `localhost`)
- Ensure `requirements.txt` at repo root is present for unified deploy

### API returns 404
- Unified deploy: requests must go to `/api/...` (frontend handles this automatically)
- Split deploy: confirm `VITE_API_URL` ends with `/api`

### CORS errors (split deploy only)
- Add frontend URL to backend `CORS_ORIGINS`
- `*.vercel.app` preview URLs are allowed by regex in `main.py`

### Cold starts
- First request after idle may take 3–10s
- MongoDB Atlas free tier adds latency — consider M10 for production

---

## File reference

| File | Purpose |
|------|---------|
| `vercel.json` | Root full-stack config |
| `api/index.py` | Serverless FastAPI entrypoint |
| `requirements.txt` | Python deps for Vercel (no Playwright) |
| `frontend/vercel.json` | Frontend-only config |
| `backend/vercel.json` | Backend-only config |
| `.vercelignore` | Excludes venv, node_modules, secrets |
