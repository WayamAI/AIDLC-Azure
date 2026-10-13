from unittest.mock import patch, MagicMock

import pytest

from app.auth.workos_client import WorkOSIdentity


@pytest.mark.anyio
async def test_login_redirects_to_workos(app_client):
    # GET /auth/login is the WorkOS SSO entrypoint and 503s unless WorkOS is
    # configured, so the redirect path has to opt in to a configured environment.
    with patch("app.routes.auth._workos_configured", return_value=True), patch(
        "app.routes.auth.get_authorization_url", return_value="https://auth.workos.com/some-url"
    ):
        resp = await app_client.get("/api/auth/login", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"] == "https://auth.workos.com/some-url"


@pytest.mark.anyio
async def test_login_without_workos_configured_returns_503(app_client):
    with patch("app.routes.auth._workos_configured", return_value=False):
        resp = await app_client.get("/api/auth/login", follow_redirects=False)
    assert resp.status_code == 503


@pytest.mark.anyio
async def test_callback_new_org_creates_local_org_and_sets_cookie(app_client, db):
    identity = WorkOSIdentity(user_id="user_123", email="a@b.com", organization_id="org_workos_456")
    with patch("app.routes.auth.authenticate_with_code", return_value=identity):
        resp = await app_client.get("/api/auth/callback?code=abc", follow_redirects=False)

    assert resp.status_code == 302
    assert "aidlc_session" in resp.cookies

    org_doc = await db.organizations.find_one({"workos_org_id": "org_workos_456"})
    assert org_doc is not None


@pytest.mark.anyio
async def test_callback_existing_org_does_not_duplicate(app_client, db):
    from app.services import organization_service
    await organization_service.create_organization(db, workos_org_id="org_workos_456", name="a@b.com")

    identity = WorkOSIdentity(user_id="user_123", email="a@b.com", organization_id="org_workos_456")
    with patch("app.routes.auth.authenticate_with_code", return_value=identity):
        await app_client.get("/api/auth/callback?code=abc", follow_redirects=False)

    count = await db.organizations.count_documents({"workos_org_id": "org_workos_456"})
    assert count == 1


@pytest.mark.anyio
async def test_logout_clears_cookie(app_client):
    resp = await app_client.post("/api/auth/logout")
    assert resp.status_code == 200
    set_cookie = resp.headers.get("set-cookie", "")
    assert "aidlc_session=" in set_cookie


@pytest.mark.anyio
async def test_me_requires_auth(app_client):
    resp = await app_client.get("/api/auth/me")
    assert resp.status_code == 401
