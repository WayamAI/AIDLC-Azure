"""
Route tests for AI Root Cause Analysis endpoints (Task 4).

Uses the codebase's established end-to-end test pattern (real FastAPI app via
`app_client`, real in-memory MongoDB via `db`, real org + session cookie) rather
than patching `get_current_org` Depends(get_current_org) binds the function
object at route-decoration time, so patching the module attribute afterward
would not affect the already-registered dependency.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app.auth.session import create_session_cookie
from app.services import organization_service


def _cookies(app_client, org_id: str, user_id: str = "user") -> None:
    token = create_session_cookie(user_id=user_id, org_id=org_id)
    app_client.cookies.set("aidlc_session", token)


@pytest.mark.anyio
async def test_analyze_endpoint_missing_run_returns_404(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_x", name="X")
    _cookies(app_client, org.id)

    resp = await app_client.post(
        "/api/testing/root-cause/analyze",
        json={"run_id": "missing", "test_id": "t1"},
    )
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_analyze_endpoint_success_persists_and_returns_completed(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_y", name="Y")
    _cookies(app_client, org.id)

    await db.playwright_runs.insert_one({
        "_id": "run1",
        "run_id": "run1",
        "org_id": org.id,
        "analysis_id": "uploaded",
        "status": "completed",
        "results": [{
            "test_id": "t1",
            "test_name": "Checkout",
            "status": "failed",
            "error": None,
            "step_results": [{
                "step_description": "click #pay",
                "status": "fail",
                "error": "Timeout waiting for selector",
            }],
        }],
    })

    with patch(
        "app.services.ai_service.analyze_test_failure_root_cause",
        new=AsyncMock(return_value={
            "root_cause_summary": "Selector changed",
            "root_cause_explanation": "explained",
            "confidence": 91,
            "likely_commit_sha": None,
            "affected_files": [],
            "affected_tests": ["Checkout"],
            "affected_services": [],
            "recommendation": "fix selector",
        }),
    ):
        resp = await app_client.post(
            "/api/testing/root-cause/analyze",
            json={"run_id": "run1", "test_id": "t1"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "completed"
    assert body["confidence"] == 91
    assert body["confidence_label"] == "high"
    assert body["failure_type"] == "selector_not_found"


@pytest.mark.anyio
async def test_analyze_same_failure_twice_does_not_duplicate(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_z", name="Z")
    _cookies(app_client, org.id)

    await db.playwright_runs.insert_one({
        "_id": "run2",
        "run_id": "run2",
        "org_id": org.id,
        "analysis_id": "uploaded",
        "status": "completed",
        "results": [{
            "test_id": "t2",
            "test_name": "Login",
            "status": "failed",
            "error": None,
            "step_results": [{
                "step_description": "click #login",
                "status": "fail",
                "error": "Timeout waiting for selector",
            }],
        }],
    })

    with patch(
        "app.services.ai_service.analyze_test_failure_root_cause",
        new=AsyncMock(return_value={
            "root_cause_summary": "Selector changed",
            "root_cause_explanation": "explained",
            "confidence": 80,
            "likely_commit_sha": None,
            "affected_files": [],
            "affected_tests": ["Login"],
            "affected_services": [],
            "recommendation": "fix selector",
        }),
    ):
        first = await app_client.post(
            "/api/testing/root-cause/analyze",
            json={"run_id": "run2", "test_id": "t2"},
        )
        second = await app_client.post(
            "/api/testing/root-cause/analyze",
            json={"run_id": "run2", "test_id": "t2"},
        )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]

    count = await db.root_cause_analyses.count_documents({"org_id": org.id, "run_id": "run2", "test_id": "t2"})
    assert count == 1
