from pathlib import Path

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import connect_db, close_db, ensure_connected, get_db
from app.routes import (
    requirements, test_cases, test_execution, synthetic_data,
    prioritization, dashboard, repo_analysis,
    github, jira, ci_intelligence, defect_prediction, release_gate,
    monitoring, incidents, sprint,
    workspace, copilot, git_ops, coverage, test_gen,
    pipeline, impact, commit, deployments, prd, cost_logs,
    root_cause, test_selection, healing,
)
from app.routes import ai_ide
from app.routes import baseline as baseline_router
from app.routes import auth as auth_router
from app.routes import webhooks as webhooks_router
from app.routes import organizations as organizations_router
from app.routes import activity as activity_router
from app.services import organization_service
from app.services import activity_history_service
import httpx
from fastapi import status
import logging

logger = logging.getLogger("aidlc")

STATIC_DIR = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.APP_ENV == "production" and settings.SESSION_SECRET in {
        "",
        "dev-only-insecure-secret-change-me",
        "change-me",
        "dev-only-insecure-secret-change-me",
    }:
        raise RuntimeError("SESSION_SECRET must be set to a strong value when APP_ENV=production")

    await connect_db()
    # Ensure repo_baselines collection indexes exist
    try:
        from app.services.baseline_store import ensure_indexes
        await ensure_indexes(get_db())
    except Exception as exc:
        print(f"[DB] baseline index creation failed (non-fatal): {exc}")
    try:
        await organization_service.ensure_indexes(get_db())
    except Exception as exc:
        print(f"[DB] organization index creation failed (non-fatal): {exc}")
    try:
        from app.services.root_cause_service import ensure_indexes as ensure_rc_indexes
        await ensure_rc_indexes(get_db())
    except Exception as exc:
        print(f"[DB] root_cause index creation failed (non-fatal): {exc}")
    try:
        from app.services.test_selection_service import ensure_indexes as ensure_ts_indexes
        await ensure_ts_indexes(get_db())
    except Exception as exc:
        print(f"[DB] test_selection index creation failed (non-fatal): {exc}")
    try:
        from app.services import user_service
        await user_service.ensure_indexes(get_db())
        await user_service.seed_wayam_account(get_db())
    except Exception as exc:
        print(f"[DB] user seed/index failed (non-fatal): {exc}")
    try:
        from app.services.healing_service import ensure_indexes as ensure_healing_indexes
        await ensure_healing_indexes(get_db())
    except Exception as exc:
        print(f"[DB] healing index creation failed (non-fatal): {exc}")
    try:
        await activity_history_service.ensure_indexes(get_db())
    except Exception as exc:
        print(f"[DB] activity_history index creation failed (non-fatal): {exc}")
    yield
    await close_db()


app = FastAPI(
    title="AIDLC API",
    description="AI-powered SDLC & Data Quality platform backend.",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS – Vite, Vercel, Azure Container Apps / Static Web Apps
_cors_regex = r"https://.*\.(vercel\.app|azurecontainerapps\.io|azurestaticapps\.net)"
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=_cors_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def serverless_db_warmup(request: Request, call_next):
    """Ensure MongoDB is reachable on cold starts (Vercel serverless)."""
    if request.url.path.startswith("/api") or request.url.path == "/health":
        await ensure_connected()
    return await call_next(request)


# Register all routers under /api prefix
API_PREFIX = "/api"

# Existing routes
app.include_router(requirements.router, prefix=API_PREFIX)
app.include_router(test_cases.router, prefix=API_PREFIX)
app.include_router(test_execution.router, prefix=API_PREFIX)
app.include_router(synthetic_data.router, prefix=API_PREFIX)
app.include_router(prioritization.router, prefix=API_PREFIX)
app.include_router(dashboard.router, prefix=API_PREFIX)
app.include_router(repo_analysis.router, prefix=API_PREFIX)

# New SDLC Intelligence routes
app.include_router(github.router, prefix=API_PREFIX)
app.include_router(jira.router, prefix=API_PREFIX)
app.include_router(ci_intelligence.router, prefix=API_PREFIX)
app.include_router(defect_prediction.router, prefix=API_PREFIX)
app.include_router(release_gate.router, prefix=API_PREFIX)
app.include_router(monitoring.router, prefix=API_PREFIX)
app.include_router(incidents.router, prefix=API_PREFIX)
app.include_router(sprint.router, prefix=API_PREFIX)

# AI Workspace routes
app.include_router(workspace.router, prefix=API_PREFIX)
app.include_router(copilot.router, prefix=API_PREFIX)
app.include_router(git_ops.router, prefix=API_PREFIX)
app.include_router(commit.router, prefix=API_PREFIX)
app.include_router(coverage.router, prefix=API_PREFIX)
app.include_router(test_gen.router, prefix=API_PREFIX)
app.include_router(pipeline.router, prefix=API_PREFIX)
app.include_router(deployments.router, prefix=API_PREFIX)

# Code Impact + Test Intelligence routes (Flow 1 & 2)
app.include_router(impact.router, prefix=API_PREFIX)

# AI Root Cause Analysis
app.include_router(root_cause.router, prefix=API_PREFIX)
# Intelligent Test Selection & Optimization
app.include_router(test_selection.router, prefix=API_PREFIX)
# Self-Healing Tests
app.include_router(healing.router, prefix=API_PREFIX)

# PRD Generator
app.include_router(prd.router, prefix=API_PREFIX)

# API Cost Logs (hidden admin route)
app.include_router(cost_logs.router, prefix=API_PREFIX)

# AI IDE streaming code generation workspace
app.include_router(ai_ide.router, prefix=API_PREFIX)

# Repo Baseline smart categorised test generation with incremental diff
app.include_router(baseline_router.router, prefix=API_PREFIX)

# Auth routes
app.include_router(auth_router.router, prefix=API_PREFIX)

# Webhook routes
app.include_router(webhooks_router.router, prefix=API_PREFIX)

# Organizations routes
app.include_router(organizations_router.router, prefix=API_PREFIX)

# Activity / search / repo-probe history (server-side, org-scoped)
app.include_router(activity_router.router, prefix=API_PREFIX)


@app.get("/api", tags=["Health"])
async def api_root():
    return {"status": "ok", "service": "AIDLC API", "version": "2.0.0"}


@app.get("/health", tags=["Health"])
async def health():
    """Liveness process is up (Azure probe)."""
    return {"status": "healthy"}


@app.get("/ready", tags=["Health"])
async def ready():
    """Readiness Mongo required; Ollama optional signal."""
    checks: dict = {"mongo": False, "ollama": None}
    try:
        db = get_db()
        await db.command("ping")
        checks["mongo"] = True
    except Exception as exc:
        logger.warning("ready mongo ping failed: %s", exc)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "not_ready", "checks": checks, "detail": str(exc)},
        )

    try:
        base = settings.OLLAMA_BASE_URL.rstrip("/")
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{base}/api/tags")
            checks["ollama"] = r.status_code < 500
    except Exception:
        checks["ollama"] = False

    return {"status": "ready", "checks": checks}


# Serve built SPA (Azure unified container). API routes take precedence above.
if STATIC_DIR.is_dir():
    assets = STATIC_DIR / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/", include_in_schema=False)
    async def spa_index():
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        if full_path.startswith("api/") or full_path in {"health", "ready", "docs", "openapi.json", "redoc"}:
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        candidate = STATIC_DIR / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
else:

    @app.get("/", tags=["Health"])
    async def root_no_spa():
        return {"status": "ok", "service": "AIDLC API", "version": "2.0.0", "spa": False}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
