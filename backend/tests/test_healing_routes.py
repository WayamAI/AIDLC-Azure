"""Route tests for Self-Healing Tests endpoints."""
from unittest.mock import AsyncMock, patch

import pytest

from app.auth.session import create_session_cookie
from app.services import organization_service


from app.routes.healing import _extract_selector


def test_extract_selector_prefers_playwright_locator():
    err = (
        "Locator.click: Timeout 12000ms exceeded.\n"
        "Call log:\n"
        '  - waiting for locator("#does-not-exist-aidlc").first'
    )
    assert _extract_selector(err, "click missing button") == "#does-not-exist-aidlc"


def _cookies(app_client, org_id: str, user_id: str = "user") -> None:
    token = create_session_cookie(user_id=user_id, org_id=org_id)
    app_client.cookies.set("aidlc_session", token)


@pytest.mark.anyio
async def test_analyze_missing_run_returns_404(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_h1", name="H1")
    _cookies(app_client, org.id)
    resp = await app_client.post(
        "/api/testing/healing/analyze",
        json={"run_id": "missing", "test_id": "t1", "target_url": "http://localhost:9"},
    )
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_analyze_success_path_persists_attempt(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_h2", name="H2")
    _cookies(app_client, org.id)
    await db.playwright_runs.insert_one(
        {
            "_id": "run1",
            "run_id": "run1",
            "org_id": org.id,
            "analysis_id": "uploaded",
            "status": "completed",
            "results": [
                {
                    "test_id": "t1",
                    "test_name": "Login flow",
                    "status": "failed",
                    "error": None,
                    "step_results": [
                        {
                            "step_description": "click #login-btn",
                            "status": "fail",
                            "error": 'Timeout waiting for selector "#login-btn"',
                        }
                    ],
                }
            ],
        }
    )
    with patch(
        "app.routes.healing.healing_service.scan_page_elements",
        new=AsyncMock(return_value=[]),
    ), patch(
        "app.routes.healing.healing_service.validate_candidate",
        new=AsyncMock(),
    ):
        resp = await app_client.post(
            "/api/testing/healing/analyze",
            json={"run_id": "run1", "test_id": "t1", "target_url": "http://localhost:9"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "failed"  # empty scan → honest failure
    assert body["confidence"] == 0


@pytest.mark.anyio
async def test_approve_requires_pending_attempt(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_h3", name="H3")
    _cookies(app_client, org.id)
    resp = await app_client.post("/api/testing/healing/nonexistent/approve")
    assert resp.status_code == 404
