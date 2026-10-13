from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.models.test_execution import RunRequest
from app.services import execution_service

router = APIRouter(prefix="/test-execution", tags=["Test Execution"])


@router.post("/run", status_code=201)
async def run_tests(
    body: RunRequest,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Run a requirement's test cases in a real browser against target_url."""
    try:
        return await execution_service.start_run(
            db,
            org.id,
            requirement_id=body.requirement_id,
            target_url=body.target_url,
            username=body.username,
            password=body.password,
            replan=body.replan,
            replan_skipped=body.replan_skipped,
        )
    except execution_service.InvalidTargetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/results")
async def get_results(
    run_id: Optional[str] = Query(default=None),
    limit: int = Query(default=100, le=500),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    return await execution_service.get_results(db, org.id, run_id=run_id, limit=limit)


@router.get("/runs")
async def list_runs(
    requirement_id: Optional[str] = Query(default=None),
    limit: int = Query(default=20, le=100),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    return await execution_service.list_runs(db, org.id, requirement_id=requirement_id, limit=limit)


@router.get("/runs/{run_id}")
async def get_run_summary(
    run_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    summary = await execution_service.get_run_summary(db, org.id, run_id)
    if not summary:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    return summary
