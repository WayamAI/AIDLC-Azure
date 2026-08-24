"""
AI Root Cause Analysis routes.

POST /api/testing/root-cause/analyze        analyze a specific failed test from a run
GET  /api/testing/root-cause                 list analyses + summary counts
GET  /api/testing/root-cause/failures        list failed tests not yet analyzed
GET  /api/testing/root-cause/{id}            full investigation detail
POST /api/testing/root-cause/{id}/rerun      re-run the underlying test via existing Playwright engine
"""
import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException

from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.models.root_cause import (
    confidence_label, RootCauseOut, RootCauseListResponse, UnanalyzedFailuresResponse, RerunOut,
)
from app.services import ai_service, root_cause_service, playwright_service

log = logging.getLogger("root_cause_routes")

router = APIRouter(prefix="/testing/root-cause", tags=["Root Cause Analysis"])


def _to_out(doc: dict) -> dict:
    return {
        **doc,
        "id": doc["_id"],
        "confidence_label": confidence_label(doc.get("confidence", 0)),
        "created_at": doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
        "updated_at": doc["updated_at"].isoformat() if isinstance(doc.get("updated_at"), datetime) else doc.get("updated_at"),
    }


@router.post("/analyze", response_model=RootCauseOut)
async def analyze_failure(
    body: dict = Body(...),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    run_id = (body.get("run_id") or "").strip()
    test_id = (body.get("test_id") or "").strip()
    if not run_id or not test_id:
        raise HTTPException(status_code=400, detail="run_id and test_id are required")

    run_doc, test_result = await root_cause_service.collect_evidence(db, org.id, run_id, test_id)
    if not run_doc or not test_result:
        raise HTTPException(status_code=404, detail="Run or test not found for this organization")
    if test_result.get("status") != "failed":
        raise HTTPException(status_code=400, detail="Only failed tests can be analyzed for root cause")

    repo_doc = None
    analysis_id = run_doc.get("analysis_id")
    if analysis_id and analysis_id != "uploaded":
        repo_doc = await db.repo_analyses.find_one({"_id": analysis_id, "org_id": org.id})

    evidence = await root_cause_service.build_evidence(test_result, repo_doc)
    failure_type = root_cause_service.classify_failure_type(evidence.error_message)
    severity = root_cause_service.severity_for(failure_type, evidence.error_message)

    existing = await root_cause_service.find_existing_analysis(db, org.id, run_id, test_id)
    doc_id = existing["_id"] if existing else str(uuid.uuid4())
    now = datetime.utcnow()
    doc = {
        "_id": doc_id,
        "org_id": org.id,
        "run_id": run_id,
        "test_id": test_id,
        "test_name": test_result.get("test_name", "Unnamed test"),
        "repository": repo_doc.get("github_url") if repo_doc else None,
        "commit_sha": evidence.recent_commits[0].sha if evidence.recent_commits else None,
        "analysis_id": analysis_id,
        "failure_type": failure_type,
        "severity": severity,
        "status": "analyzing",
        "evidence": evidence.model_dump(),
        "confidence": 0.0,
        "root_cause_summary": None, "root_cause_explanation": None, "likely_commit": None,
        "affected_files": [], "affected_tests": [], "affected_services": [],
        "recommendation": None, "ai_error": None,
        "created_at": now, "updated_at": now,
    }

    ai_result = await ai_service.analyze_test_failure_root_cause(evidence.model_dump(), doc["test_name"])
    doc["confidence"] = float(ai_result.get("confidence", 0))
    doc["root_cause_summary"] = ai_result.get("root_cause_summary")
    doc["root_cause_explanation"] = ai_result.get("root_cause_explanation")
    doc["affected_files"] = ai_result.get("affected_files", [])
    doc["affected_tests"] = ai_result.get("affected_tests", [])
    doc["affected_services"] = ai_result.get("affected_services", [])
    doc["recommendation"] = ai_result.get("recommendation")
    doc["ai_error"] = ai_result.get("error")
    sha = ai_result.get("likely_commit_sha")
    if sha:
        match = next((c for c in evidence.recent_commits if c.sha.startswith(sha[:7])), None)
        if match:
            doc["likely_commit"] = match.model_dump()
    doc["status"] = "failed" if ai_result.get("error") else "completed"
    doc["updated_at"] = datetime.utcnow()

    await root_cause_service.save_analysis(db, doc)
    return _to_out(doc)


@router.get("", response_model=RootCauseListResponse)
async def list_root_causes(org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    docs = await root_cause_service.list_analyses(db, org.id)
    summary = await root_cause_service.compute_summary(db, org.id)
    return {
        "summary": summary,
        "items": [
            {
                "id": d["_id"], "test_name": d["test_name"], "repository": d.get("repository"),
                "failure_type": d["failure_type"], "severity": d["severity"], "status": d["status"],
                "confidence": d.get("confidence", 0), "confidence_label": confidence_label(d.get("confidence", 0)),
                "created_at": d["created_at"].isoformat() if isinstance(d["created_at"], datetime) else d["created_at"],
            }
            for d in docs
        ],
    }


@router.get("/failures", response_model=UnanalyzedFailuresResponse)
async def unanalyzed_failures(org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    failures = await root_cause_service.list_unanalyzed_failures(db, org.id)
    for f in failures:
        completed_at = f.get("completed_at")
        if isinstance(completed_at, datetime):
            f["completed_at"] = completed_at.isoformat()
    return {"failures": failures}


@router.get("/{analysis_id}", response_model=RootCauseOut)
async def get_root_cause(analysis_id: str, org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    doc = await root_cause_service.get_analysis(db, org.id, analysis_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return _to_out(doc)


@router.post("/{analysis_id}/rerun", response_model=RerunOut)
async def rerun_test(
    analysis_id: str,
    background_tasks: BackgroundTasks,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    doc = await root_cause_service.get_analysis(db, org.id, analysis_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Analysis not found")

    analysis = await db.repo_analyses.find_one({"_id": doc.get("analysis_id"), "org_id": org.id})
    test_doc = await db.playwright_tests.find_one({"_id": doc["test_id"], "org_id": org.id})
    if not test_doc or not analysis:
        raise HTTPException(
            status_code=409,
            detail="Cannot re-run: original test or repository analysis no longer exists",
        )

    new_run_id = str(uuid.uuid4())
    background_tasks.add_task(
        playwright_service.execute_playwright_tests,
        db, org.id, [test_doc], analysis["target_url"], new_run_id, analysis["_id"],
    )
    return {"run_id": new_run_id, "status": "started"}
