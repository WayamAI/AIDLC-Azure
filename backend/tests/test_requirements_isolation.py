import pytest
from unittest.mock import patch

from app.auth.session import create_session_cookie
from app.services import organization_service


FAKE_AI_RESULT = {"functional": [{"tc_id": "TC-1", "name": "t", "description": "d", "severity": "High", "expected": "e"}]}


@pytest.mark.anyio
async def test_org_a_cannot_see_org_b_requirements(app_client, db):
    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    org_b = await organization_service.create_organization(db, workos_org_id="org_b", name="B")

    token_a = create_session_cookie(user_id="user_a", org_id=org_a.id)
    token_b = create_session_cookie(user_id="user_b", org_id=org_b.id)

    with patch("app.services.requirement_service.ai_service.generate_test_cases", return_value=FAKE_AI_RESULT):
        app_client.cookies.set("aidlc_session", token_a)
        await app_client.post("/api/requirements", json={"text": "Org A's requirement text goes here"})

    app_client.cookies.set("aidlc_session", token_b)
    resp = await app_client.get("/api/requirements")
    assert resp.status_code == 200
    assert resp.json() == []

    app_client.cookies.set("aidlc_session", token_a)
    resp = await app_client.get("/api/requirements")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


@pytest.mark.anyio
async def test_requirements_endpoint_requires_auth(app_client):
    resp = await app_client.get("/api/requirements")
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_generated_test_cases_are_org_scoped(app_client, db):
    org_a = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    token_a = create_session_cookie(user_id="user_a", org_id=org_a.id)
    app_client.cookies.set("aidlc_session", token_a)

    with patch("app.services.requirement_service.ai_service.generate_test_cases", return_value=FAKE_AI_RESULT):
        await app_client.post("/api/requirements", json={"text": "Org A's requirement text goes here"})

    doc = await db.test_cases.find_one({"tc_id": "TC-1"})
    assert doc is not None
    assert doc["org_id"] == org_a.id
