# AIDLC Azure CLI deploy

## Target

**Azure Container Apps** + **ACR** for the FastAPI API (Playwright + long AI jobs).  
Frontend: Azure Static Web Apps or any static host; set `CORS_ORIGINS` / `FRONTEND_URL`.

Plan: `docs/superpowers/plans/2026-08-23-azure-backend-hardening.md`

## Prerequisites

```bash
az login
az account set --subscription "<SUBSCRIPTION_ID>"
# Optional: Docker not required scripts use `az acr build`
```

## Env file

Copy `backend/.env.azure.example` → `backend/.env.azure` (PowerShell script reads it).

Required secrets:

| Name | Purpose |
|------|---------|
| `MONGODB_URI` | Atlas / Cosmos Mongo connection string |
| `MONGODB_DB` | e.g. `aidlc` |
| `SESSION_SECRET` | Strong random (≥32 chars) |
| `OLLAMA_BASE_URL` / `OLLAMA_API_KEY` / `OLLAMA_MODEL` | AI |
| `GITHUB_TOKEN` | Repo probes |
| `CORS_ORIGINS` | Frontend origin(s), JSON list or comma form as configured |
| `FRONTEND_URL` | Cookie / redirect base |
| `APP_ENV` | `production` |

## Deploy

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

## Probes

- Liveness: `GET /health`
- Readiness: `GET /ready` (Mongo must ping)

## Fallback

IaaS VM + PM2: see `frontend/DEPLOY_AZURE_VM.md`.
