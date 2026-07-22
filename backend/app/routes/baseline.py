"""
Repo baseline routes.

POST /api/baseline/scan         start a scan (full or incremental, auto-detected)
GET  /api/baseline/status/{id}  poll session status
GET  /api/baseline/{repo_id}    get all tests + session history for a repo
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from app.models.repo_baseline import (
    RepoBaseline,
    ScanRepoRequest,
    ScanRepoResponse,
    ScanSession,
    SyncExternalTestsRequest,
)
from app.services import baseline_store, diff_service
from app.services.baseline_runner import run_baseline_scan

log = logging.getLogger("baseline_routes")

router = APIRouter(prefix="/baseline", tags=["Repo Baseline"])


# ── POST /baseline/scan ───────────────────────────────────────────────────────

@router.post("/scan", response_model=ScanRepoResponse, status_code=202)
async def scan_repo(payload: ScanRepoRequest, background_tasks: BackgroundTasks):
    """
    Single endpoint: submit a GitHub URL.
    - First time → full scan, 30-60 tests generated and stored.
    - Subsequent times → incremental scan, only truly new tests appended.
    Returns session_id immediately. Poll /baseline/status/{session_id} until done.
    """
    if not payload.github_url.strip():
        raise HTTPException(status_code=400, detail="github_url is required")

    repo_id = diff_service.get_repo_id(payload.github_url.strip())

    # Check if we already know this repo
    existing = await baseline_store.get_repo(repo_id)
    scan_type = "incremental" if existing else "full"

    # Create the session object (status=pending initially)
    session = ScanSession(
        github_url=payload.github_url.strip(),
        scan_type=scan_type,
    )

    if existing:
        # Append the new pending session to the existing document
        await baseline_store.add_session_to_repo(repo_id, session)
    else:
        # Create a skeletal baseline doc so we can update session status later
        skeleton = RepoBaseline(
            repo_id=repo_id,
            github_url=payload.github_url.strip(),
            sessions=[session],
        )
        await baseline_store.create_repo(skeleton)

    # Kick off background scan
    background_tasks.add_task(
        run_baseline_scan,
        repo_id,
        payload.github_url.strip(),
        session,
        existing,
    )

    return ScanRepoResponse(
        session_id=session.session_id,
        repo_id=repo_id,
        scan_type=scan_type,
        status="queued",
    )


# ── GET /baseline/status/{session_id} ────────────────────────────────────────

@router.get("/status/{session_id}")
async def get_session_status(session_id: str):
    """
    Poll this every 3 seconds until status == 'done' or 'failed'.
    Returns: session_id, repo_id, status, progress_message, tests_added, scan_type.
    """
    session = await baseline_store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "session_id": session.session_id,
        "scan_type": session.scan_type,
        "status": session.status,
        "progress_message": session.progress_message,
        "tests_added": session.tests_added,
        "tests_total_after": session.tests_total_after,
        "error": session.error,
    }


# ── GET /baseline/{repo_id} ───────────────────────────────────────────────────

@router.get("/{repo_id}")
async def get_repo_tests(
    repo_id: str,
    session_id: str = Query(default=None, description="Highlight tests from this session"),
):
    """
    Return all tests for a repo, all session history, and (if session_id is given)
    the list of test_ids that were added in that session so the frontend can highlight them.
    """
    baseline = await baseline_store.get_repo(repo_id)
    if not baseline:
        raise HTTPException(status_code=404, detail="Repo not found. Run /baseline/scan first.")

    # Determine new test ids for the requested session
    new_test_ids: list[str] = []
    if session_id:
        new_test_ids = [
            t.test_id
            for t in baseline.tests
            if t.added_in_session == session_id
        ]

    # Build serialised tests (only active ones)
    active_tests = [t.model_dump(mode="json") for t in baseline.tests if t.is_active]

    return {
        "repo_id": baseline.repo_id,
        "github_url": baseline.github_url,
        "total_tests": len(active_tests),
        "sessions": [s.model_dump(mode="json") for s in reversed(baseline.sessions)],
        "tests": active_tests,
        "new_test_ids": new_test_ids,
    }


@router.post("/sync")
async def sync_tests(payload: SyncExternalTestsRequest):
    """
    Called by AI IDE or Live Runner to merge ad-hoc generated tests into the baseline.
    Does not delete existing ones; only adds unique new tests.
    """
    added_count = await baseline_store.sync_external_tests(
        repo_id=payload.repo_id,
        new_tests=payload.tests,
        from_source=payload.source,
    )
    return {"status": "success", "added_count": added_count}
