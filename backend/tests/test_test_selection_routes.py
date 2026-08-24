import pytest
from app.auth.session import create_session_cookie
from app.services import organization_service


def _cookies(app_client, org_id: str, user_id: str = "user") -> None:
    token = create_session_cookie(user_id=user_id, org_id=org_id)
    app_client.cookies.set("aidlc_session", token)


@pytest.mark.anyio
async def test_analyze_with_no_baseline_returns_empty_selection(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_ts1", name="TS1")
    _cookies(app_client, org.id)
    resp = await app_client.post(
        "/api/testing/test-selection/analyze",
        json={"repo_id": "no-such-repo", "github_url": "https://github.com/x/y"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"]["total_tests"] == 0
    assert body["diff_available"] is False


@pytest.mark.anyio
async def test_optimization_report_reflects_real_baseline_tests(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_ts2", name="TS2")
    _cookies(app_client, org.id)
    # Built the way real code (baseline_store.create_repo) builds it: no
    # explicit `_id` Mongo assigns its own ObjectId, identity lives in
    # `repo_id`.
    await db.repo_baselines.insert_one({
        "repo_id": "repo1", "org_id": org.id, "github_url": "https://github.com/x/y",
        "sessions": [],
        "tests": [
            {"test_id": "TC-1", "name": "n1", "description": "d", "category": "auth",
             "source_file": "a.py", "severity": "medium", "steps": [], "playwright_code": "",
             "added_in_session": "s1", "is_active": True},
        ],
    })
    resp = await app_client.get("/api/testing/test-selection/optimization", params={"repo_id": "repo1"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_tests"] == 1
    assert body["flaky_tests"] is None
    assert any(f["kind"] == "flaky" and f["available"] is False for f in body["findings"])


@pytest.mark.anyio
async def test_history_and_get_run_and_execute(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_ts3", name="TS3")
    _cookies(app_client, org.id)
    await db.repo_baselines.insert_one({
        "repo_id": "repo2", "org_id": org.id, "github_url": "https://github.com/x/y",
        "sessions": [],
        "tests": [
            {"test_id": "TC-1", "name": "n1", "description": "d", "category": "auth",
             "source_file": "a.py", "severity": "medium",
             "steps": [{"action": "navigate", "target": "/login"}],
             "playwright_code": "",
             "added_in_session": "s1", "is_active": True},
        ],
    })
    # Sanity-check the fixture was built the way real code builds it (repo_id
    # field, Mongo-assigned _id) this is what fix #1 relies on to look up
    # the baseline in /execute.
    baseline_doc = await db.repo_baselines.find_one({"repo_id": "repo2", "org_id": org.id})
    assert baseline_doc is not None
    assert baseline_doc["_id"] != "repo2"

    analyze_resp = await app_client.post(
        "/api/testing/test-selection/analyze",
        json={"repo_id": "repo2", "github_url": "https://github.com/x/y"},
    )
    assert analyze_resp.status_code == 200
    run_id = analyze_resp.json()["id"]

    history_resp = await app_client.get("/api/testing/test-selection/history", params={"repo_id": "repo2"})
    assert history_resp.status_code == 200
    history_body = history_resp.json()
    assert "runs" in history_body
    assert any(r["id"] == run_id for r in history_body["runs"])

    history_no_params_resp = await app_client.get("/api/testing/test-selection/history")
    assert history_no_params_resp.status_code == 200
    assert any(r["id"] == run_id for r in history_no_params_resp.json()["runs"])

    get_resp = await app_client.get(f"/api/testing/test-selection/{run_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == run_id

    exec_resp = await app_client.post(
        f"/api/testing/test-selection/{run_id}/execute",
        json={"target_url": "https://example.com"},
    )
    assert exec_resp.status_code == 200
    exec_body = exec_resp.json()
    assert exec_body["status"] == "started"
    assert exec_body["test_count"] == 1

    missing_target_resp = await app_client.post(
        f"/api/testing/test-selection/{run_id}/execute",
        json={},
    )
    assert missing_target_resp.status_code == 400
