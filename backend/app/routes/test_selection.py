"""
Intelligent Test Selection & Optimization routes.

POST /api/testing/test-selection/analyze          run a selection scan for a repo's baseline suite
GET  /api/testing/test-selection/history            list past selection runs for a repo
GET  /api/testing/test-selection/optimization       duplicate/coverage-gap/flaky/long-running report
GET  /api/testing/test-selection/{run_id}           full selection run detail
POST /api/testing/test-selection/{run_id}/execute   run the selected tests via the Playwright engine
"""
import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException

from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.models.test_selection import (
    TestOptimizationReportOut, TestSelectionHistoryOut, TestSelectionRunOut,
)
from app.services import baseline_store
from app.services import test_selection_service as svc
from app.services import playwright_service

router = APIRouter(prefix="/testing/test-selection", tags=["Intelligent Test Selection"])


def _run_to_out(doc: dict) -> dict:
    total_tests = doc.get("total_tests", 0)
    skipped_count = doc.get("skipped_count", 0)
    selected_tests = doc.get("selected_tests", [])
    selected_count = sum(1 for t in selected_tests if t.get("selected"))
    estimated_savings_pct = (
        round(skipped_count / total_tests * 100, 1) if total_tests > 0 else None
    )
    created_at = doc.get("created_at")
    return {
        "id": doc["_id"],
        "repo_id": doc["repo_id"],
        "github_url": doc["github_url"],
        "old_sha": doc.get("old_sha"),
        "new_sha": doc.get("new_sha"),
        "changed_files": doc.get("changed_files", []),
        "diff_available": doc.get("diff_available", False),
        "summary": {
            "total_tests": total_tests,
            "relevant_tests": selected_count,
            "selected_tests": selected_count,
            "skipped_tests": skipped_count,
            "estimated_savings_pct": estimated_savings_pct,
        },
        "tests": selected_tests,
        "status": doc.get("status", "completed"),
        "error": doc.get("error"),
        "created_at": created_at.isoformat() if isinstance(created_at, datetime) else created_at,
    }


@router.post("/analyze", response_model=TestSelectionRunOut)
async def analyze(
    body: dict = Body(...),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    repo_id = (body.get("repo_id") or "").strip()
    github_url = (body.get("github_url") or "").strip()
    if not repo_id or not github_url:
        raise HTTPException(status_code=400, detail="repo_id and github_url are required")

    old_sha = body.get("old_sha")
    new_sha = body.get("new_sha")

    run = await svc.run_selection(db, org.id, repo_id, github_url, old_sha=old_sha, new_sha=new_sha)
    await svc.save_run(db, run)
    doc = run.model_dump(by_alias=True)
    return _run_to_out(doc)


@router.get("/history", response_model=TestSelectionHistoryOut)
async def history(
    repo_id: str | None = None,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    docs = await svc.list_runs(db, org.id)
    if repo_id:
        docs = [d for d in docs if d.get("repo_id") == repo_id]
    return {"runs": [_run_to_out(d) for d in docs]}


@router.get("/optimization", response_model=TestOptimizationReportOut)
async def optimization(
    repo_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    return await svc.compute_optimization_report(db, org.id, repo_id)


@router.get("/{run_id}", response_model=TestSelectionRunOut)
async def get_run(
    run_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    doc = await svc.get_run(db, org.id, run_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Selection run not found")
    return _run_to_out(doc)


@router.post("/{run_id}/execute")
async def execute(
    run_id: str,
    background_tasks: BackgroundTasks,
    body: dict = Body(default={}),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    target_url = (body.get("target_url") or "").strip()
    if not target_url:
        raise HTTPException(status_code=400, detail="target_url is required")

    run_doc = await svc.get_run(db, org.id, run_id)
    if not run_doc:
        raise HTTPException(status_code=404, detail="Selection run not found")

    baseline = await baseline_store.get_repo(db, org.id, run_doc["repo_id"])
    if not baseline:
        raise HTTPException(status_code=409, detail="Cannot execute: repo baseline no longer exists")

    selected_ids = {t["test_id"] for t in run_doc.get("selected_tests", []) if t.get("selected")}
    baseline_tests_by_id = {t.test_id: t for t in baseline.tests}

    playwright_tests = []
    for test_id in selected_ids:
        test = baseline_tests_by_id.get(test_id)
        if not test:
            continue
        playwright_tests.append(svc.baseline_test_to_playwright_dict(test))

    if not playwright_tests:
        raise HTTPException(status_code=409, detail="No selected tests available to execute")

    new_run_id = str(uuid.uuid4())
    background_tasks.add_task(
        playwright_service.execute_playwright_tests,
        db, org.id, playwright_tests, target_url, new_run_id, run_doc["repo_id"],
    )
    return {"run_id": new_run_id, "status": "started", "test_count": len(playwright_tests)}
