import pytest

from app.auth.session import create_session_cookie
from app.services import organization_service


@pytest.mark.anyio
async def test_current_org_requires_auth(app_client):
    resp = await app_client.get("/api/orgs/current")
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_current_org_returns_org_details(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_abc", name="Acme")
    token = create_session_cookie(user_id="user_1", org_id=org.id)
    app_client.cookies.set("aidlc_session", token)

    resp = await app_client.get("/api/orgs/current")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == org.id
    assert body["name"] == "Acme"
