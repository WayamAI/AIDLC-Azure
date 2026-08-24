# AIDLC AI-Powered SDLC Platform

## What this is

AIDLC is a full-stack platform that brings AI into every stage of the software
delivery lifecycle: requirement analysis, test generation, code review, defect
prediction, release gating, and production monitoring. It's built by WayamAI.

- **Frontend**: React 18 + TypeScript + Vite, Tailwind CSS + shadcn/ui,
  TanStack Query, React Router, Recharts, Monaco Editor, Sigma.js (dependency
  graphs). Dev server on port **8080**.
- **Backend**: FastAPI + Motor (async MongoDB) + Pydantic v2. Talks to an
  Ollama-compatible LLM (local or Ollama Cloud) for all AI features. Dev
  server default port **8000**.
- **Database**: MongoDB (run locally via Docker, or Atlas in production).
- **AI provider**: Ollama either local (`http://localhost:11434`) or Ollama
  Cloud (`https://ollama.com` with an API key, model e.g. `gpt-oss:120b`).

## Repo layout

```
AIDLC-main/
├── backend/
│   ├── main.py                 # FastAPI app, router registration, CORS, lifespan
│   ├── app/
│   │   ├── config.py            # pydantic-settings, reads backend/.env
│   │   ├── database.py          # Motor/MongoDB connection helpers
│   │   ├── routes/               # one file per feature area, all mounted under /api
│   │   │   ├── requirements.py, test_cases.py, test_execution.py,
│   │   │   ├── synthetic_data.py, prioritization.py, dashboard.py,
│   │   │   ├── repo_analysis.py, github.py, jira.py, ci_intelligence.py,
│   │   │   ├── defect_prediction.py, release_gate.py, monitoring.py,
│   │   │   ├── incidents.py, sprint.py, workspace.py, copilot.py,
│   │   │   ├── git_ops.py, coverage.py, test_gen.py, pipeline.py,
│   │   │   ├── impact.py, commit.py, deployments.py, prd.py,
│   │   │   ├── cost_logs.py, ai_ide.py, baseline.py
│   │   ├── services/             # business logic, AI calls, integrations
│   │   ├── engines/               # AI test-generation pipeline
│   │   └── models/                # Pydantic / DB models
│   └── .venv/                    # Python virtualenv (already created)
├── frontend/
│   ├── src/
│   │   ├── App.tsx                # all frontend routes defined here
│   │   ├── pages/                  # one component per route
│   │   ├── components/             # UI components (shadcn/ui based)
│   │   └── lib/                    # API client (lib/api.ts), design system
│   └── vite.config.ts             # dev server config incl. /api proxy
├── api/index.py                  # serverless FastAPI entrypoint (Vercel)
├── vercel.json                   # full-stack Vercel deploy config
├── requirements.txt              # slim Python deps for Vercel (no Playwright)
└── README.md / SETUP.md / VERCEL_DEPLOY.md
```

## Frontend routes (src/App.tsx)

`/dashboard` (default), `/requirements`, `/synthetic-data`, `/test-execution`,
`/prioritization`, `/live-testing` (`/live-test-runner` alias), `/code-review`,
`/ci-intelligence`, `/defect-prediction`, `/generated-tests`, `/incidents`,
`/monitoring`, `/release-gate`, `/requirements-intelligence`,
`/sprint-intelligence`, `/workspace`, `/pipeline`, `/deployments`,
`/code-impact`, `/doc-tests`, `/prd`, `/profile`, `/cost-tracker`, `/ai-ide`
(AI App Builder), `/repo-baseline`.

Guided 4-step core workflow (sidebar "Beta / In Progress" group):
Requirements → Test Suite → Test Execution → Risk Ranking, with Synthetic
Data as a supporting step.

## Running it locally

### Prerequisites already set up in this repo
- `backend/.venv` Python virtualenv with all deps installed
- `frontend/node_modules` npm deps installed
- `backend/.env` and `frontend/.env` already populated (see below)

### Start sequence

```bash
# 1. MongoDB (Docker container "aidlc-mongo" create once, then just `docker start`)
docker start aidlc-mongo   # or: docker run -d --name aidlc-mongo -p 27017:27017 -v aidlc-mongo-data:/data/db mongo:7

# 2. Backend
cd backend && source .venv/bin/activate
uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# 3. Frontend (separate terminal)
cd frontend && npm run dev
```

Open **http://localhost:8080**. The Vite dev server proxies `/api/*` to the
backend.

### ⚠️ Port 8000 conflict

This machine also runs another unrelated project, **Setu**
(`/Users/arkabera/Desktop/Wayam AI/Setu`), whose backend also defaults to
port 8000. **Never kill processes belonging to Setu.** If port 8000 is
already taken when you go to start AIDLC's backend:

```bash
uvicorn main:app --host 127.0.0.1 --port 8001 --reload
```

and start the frontend with `BACKEND_PORT=8001 npm run dev` `vite.config.ts`
reads `process.env.BACKEND_PORT` (falls back to `8000`) to set the `/api`
proxy target. This env-var indirection was added specifically to make the
backend port swappable without touching Setu.

**General rule for any process-killing command**: never use a broad pattern
like `pkill -f vite` or `pkill -f uvicorn` it will match and kill dev
servers belonging to *other* projects on this machine (this has happened
before). Always target a specific PID or a path-scoped pattern.

## Environment variables

`backend/.env` (already configured):
- `MONGODB_URI`, `MONGODB_DB=aidlc`
- `OLLAMA_BASE_URL` (currently set to `https://ollama.com`), `OLLAMA_API_KEY`,
  `OLLAMA_MODEL` (currently `gpt-oss:120b`)
- `GITHUB_TOKEN`, `GITHUB_REPO_ID` configured, GitHub features should work
- `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_NAME` configured
- `JIRA_DOMAIN` / `JIRA_EMAIL` / `JIRA_TOKEN` **not configured**, Jira
  endpoints will fail (this is expected, not a bug)
- `SLACK_WEBHOOK_URL`, `DATADOG_API_KEY` / `DATADOG_APP_KEY` not configured

`frontend/.env` exists, standard Vite env file.

## Known quirks / non-bugs

- `frontend/src/pages/SyntheticData.tsx` has a character-encoding issue (non-UTF-8
  em dash) that renders as `�` in the page description text. Cosmetic only,
  pre-existing, low priority.
- Breadcrumbs on some pages (e.g. CI Intelligence, Incidents, Sprint
  Intelligence, Requirements Intelligence) show a generic "AIDLC /" prefix
  instead of a proper category name cosmetic, auto-generated from route.
- Several pages show a greyed-out/disabled "step" UI until a prior step in
  the workflow has data (e.g. Test Execution / Risk Ranking before any
  requirement exists) this is intentional progressive-disclosure design,
  not a rendering bug.
- Vite's dev server (`watch: { usePolling: true }`) can crash with an
  `EACCES: permission denied, lstat '.../frontend/.vite/deps'` error when
  restarting after a config/`.env` change, if run inside a sandboxed shell
  that blocks filesystem access to that cache path. Fix: run the frontend
  start command with the sandbox disabled, or run it directly in a normal
  terminal (not through a sandboxed tool).

## Verified working (as of last full check)

- MongoDB container, backend, and frontend all start cleanly.
- All ~26 backend route modules mount without errors; core list/health
  endpoints (`/api/requirements`, `/api/dashboard/stats`, `/api/pipeline/runs`,
  etc.) return 200.
- All 25 frontend routes render without console errors.
- Full AI round trip confirmed live: submitting a requirement through
  `/requirements` → backend → Ollama Cloud (`gpt-oss:120b`) → returns a
  structured, relevant test suite (tested with a "password reset" requirement,
  got 17 well-formed test cases back).

## Deployment

Deploys to Vercel as a single project: `vercel.json` builds the frontend and
runs the FastAPI backend as a serverless function at `/api` via
`api/index.py`. See `VERCEL_DEPLOY.md` for the full walkthrough. Required
Vercel env vars: `MONGODB_URI` (Atlas), `OLLAMA_BASE_URL`, `OLLAMA_API_KEY`,
`OLLAMA_MODEL`.
