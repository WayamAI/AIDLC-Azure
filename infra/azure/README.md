# AIDLC Azure CLI deploy

## Target

**One Azure Container App** serving the React SPA and FastAPI (Playwright + long AI jobs) from the **repo-root Dockerfile**.

That matches the environment already running in East Asia (`aidlc` on ACR `vakyamcr20260820`). User-generated apps still deploy to **Vercel**, not Azure.

Do **not** use `backend/Dockerfile` for production — that image is API-only and has no SPA.

Plan notes: `docs/superpowers/plans/2026-08-23-azure-backend-hardening.md`

## Prerequisites

```bash
az login
az account set --subscription "<SUBSCRIPTION_ID>"
# Docker is not required; scripts use `az acr build`
```

## Env file

Copy `backend/.env.azure.example` → `backend/.env.azure`. The scripts load it as Container App secrets.

Required:

| Name | Purpose |
|------|---------|
| `MONGODB_URI` | Atlas / Cosmos / internal ACA Mongo |
| `MONGODB_DB` | e.g. `aidlc` |
| `SESSION_SECRET` | Strong random (≥32 chars) |
| `OLLAMA_BASE_URL` / `OLLAMA_API_KEY` / `OLLAMA_MODEL` | AI |
| `CORS_ORIGINS` | This Container App HTTPS origin |
| `FRONTEND_URL` | Same origin (cookie / redirects) |
| `APP_ENV` | `production` |

Recommended for product features:

| Name | Purpose |
|------|---------|
| `GITHUB_TOKEN` | Private repos, PR review, CI |
| `VERCEL_TOKEN` / `VERCEL_TEAM_ID` / `VERCEL_PROJECT_NAME` | Deploy to Production |

These can also be saved per-org in the app under **Settings → Connectors**.

## Deploy (new environment)

**Windows (PowerShell):**

```powershell
cd infra/azure
.\deploy.ps1 -ResourceGroup aidlc-rg -Location eastus
```

**Linux/macOS:**

```bash
cd infra/azure
chmod +x deploy.sh
./deploy.sh
```

Scripts build `Dockerfile` at the **repository root** and create app name `aidlc` (SPA+API on port 8000).

## Update the existing East Asia environment

```powershell
cd infra/azure
.\deploy.ps1 `
  -ResourceGroup vakyam-rg `
  -Location eastasia `
  -AcrName vakyamcr20260820 `
  -EnvName vakyam-env `
  -AppName aidlc `
  -ImageName aidlc
```

```bash
RESOURCE_GROUP=vakyam-rg LOCATION=eastasia ACR_NAME=vakyamcr20260820 \
  ACA_ENV=vakyam-env APP_NAME=aidlc IMAGE_NAME=aidlc ./deploy.sh
```

## Probes

- Liveness: `GET /health`
- Readiness: `GET /ready` (Mongo must ping)

## Fallback

IaaS VM + PM2: see `frontend/DEPLOY_AZURE_VM.md` (ports there may lag the current Vite 8081 / backend 8001 defaults).
