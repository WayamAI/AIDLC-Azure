from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services import vercel_service

router = APIRouter(prefix="/deployments", tags=["Deployments"])


class TriggerDeploymentRequest(BaseModel):
    repo_url: str | None = Field(default=None, max_length=400)
    branch: str = Field(default="main", min_length=1, max_length=120)
    commit_sha: str | None = Field(default=None, max_length=100)
    target: str = Field(default="production", min_length=1, max_length=32)


@router.post("/trigger")
async def trigger_deployment(body: TriggerDeploymentRequest):
    try:
        return await vercel_service.trigger_deployment(
            branch=body.branch.strip(),
            repo_url=(body.repo_url or "").strip() or None,
            commit_sha=(body.commit_sha or "").strip() or None,
            target=body.target.strip(),
        )
    except vercel_service.VercelServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/repo-options")
async def deployment_repo_options(
    repo_url: str = Query(..., min_length=5, max_length=400),
    branch: str | None = Query(default=None, min_length=1, max_length=120),
):
    try:
        return await vercel_service.get_repo_options(repo_url=repo_url, branch=branch)
    except vercel_service.VercelServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/{deployment_id}/status")
async def deployment_status(deployment_id: str):
    if not deployment_id.strip():
        raise HTTPException(status_code=400, detail="deployment_id is required")

    try:
        return await vercel_service.get_deployment_status(deployment_id.strip())
    except vercel_service.VercelServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/{deployment_id}/events")
async def deployment_events(
    deployment_id: str,
    limit: int = Query(default=120, ge=10, le=300),
):
    if not deployment_id.strip():
        raise HTTPException(status_code=400, detail="deployment_id is required")

    try:
        return await vercel_service.get_deployment_events(deployment_id.strip(), limit=limit)
    except vercel_service.VercelServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/health")
async def deployment_health():
    return vercel_service.deployment_config_health()