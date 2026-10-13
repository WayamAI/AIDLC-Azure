# Azure-Ready Backend Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden AIDLC FastAPI for Azure CLI container deploy, persist search/repo probe history server-side, and prove real-repo smoke outputs land in history.

**Architecture:** Keep FastAPI + Motor + Playwright as a long-lived container (Azure Container Apps preferred). Add org-scoped `activity_history` Mongo collection for global search + repo probes. Expose `/health` (liveness) and `/ready` (Mongo + optional Ollama). Ship Dockerfile + `az` scripts; SPA can stay on SWA/Blob.

**Tech Stack:** FastAPI, Motor/MongoDB, Playwright, Docker, Azure Container Apps + ACR, Azure CLI

**Spec:** Azure Container Apps target (not Functions); Playwright + workspace clones require persistent/ephemeral disk in container.

## Global Constraints

- Do not break existing `/api/*` contracts used by the Vite frontend
- Org isolation via `get_current_org` on all history writes/reads
- `APP_ENV=production` must reject weak `SESSION_SECRET` and disable insecure defaults
- Azure deploy path is **CLI-first** (no requirement for Bicep in v1)

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/app/services/activity_history_service.py` | Mongo CRUD for activity/search/repo history |
| `backend/app/routes/activity.py` | REST: list/push/clear history |
| `backend/main.py` | Register router; `/health` + `/ready` |
| `backend/app/config.py` | Azure-friendly CORS / production guards |
| `backend/Dockerfile` | Runtime image with Chromium deps |
| `infra/azure/deploy.ps1` + `deploy.sh` | Azure CLI: ACR + Container App |
| `infra/azure/README.md` | Operator runbook |
| `frontend/src/lib/search-history.ts` | Dual write: localStorage + API |
| `backend/scripts/repo_probe_history.py` | Probe public repos; persist history; print report |

---

### Task 1: Activity history service + API

- [ ] Create `activity_history_service` with indexes `(org_id, visited_at desc)`, `(org_id, kind, visited_at)`
- [ ] Routes under `/api/activity/history` GET list, POST push, DELETE clear
- [ ] Kinds: `search` \| `nav` \| `repo_probe`
- [ ] Unit/route tests for isolation + CRUD
- [ ] Commit

### Task 2: Health / ready / production guards

- [ ] `/health` → liveness only
- [ ] `/ready` → Mongo ping (+ optional Ollama HEAD); 503 when DB down
- [ ] Reject default `SESSION_SECRET` when `APP_ENV=production`
- [ ] Extend CORS regex for `*.azurecontainerapps.io` / custom domains via env
- [ ] Commit

### Task 3: Docker + Azure CLI

- [ ] `backend/Dockerfile` multi-stage: Python 3.12-slim + playwright chromium deps
- [ ] `infra/azure/deploy.ps1` / `deploy.sh`: resource group, ACR build/push, Container Apps env+app, env from Key Vault or `.env.azure`
- [ ] Document required env vars in `infra/azure/README.md`
- [ ] Commit

### Task 4: Frontend history sync

- [ ] On push: localStorage + `POST /api/activity/history` (best-effort)
- [ ] On open palette: merge GET server history with local
- [ ] Clear both on Clear
- [ ] Commit

### Task 5: Live repo probes → history

- [ ] Script logs in, probes 2–3 public repos (`repo-info`, commits, optional baseline status)
- [ ] Writes each probe into activity history with payload summary
- [ ] Prints table of outputs; dumps JSON report under `backend/reports/`
- [ ] Commit

### Task 6: Verification

- [ ] `pytest` for activity routes
- [ ] `tsc --noEmit` frontend
- [ ] Run `repo_probe_history.py` against live backend; confirm GET history returns entries
- [ ] Dry-run document Azure CLI commands (subscription may be unavailable in CI)

---

## Azure CLI target (summary)

```text
Resource group  → aidlc-rg
ACR             → aidlcregistry
Container App   → aidlc-api  (ingress external, targetPort 8000)
DB              → MongoDB Atlas (or Cosmos Mongo API) via MONGODB_URI
Secrets         → Container App secrets / Key Vault references
Frontend        → Static Web Apps or existing Vite host; CORS_ORIGINS includes SWA URL
```

Preferred over App Service Functions; VM+PM2 remains fallback (`frontend/DEPLOY_AZURE_VM.md`).
