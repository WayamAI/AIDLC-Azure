import pytest
from fastapi import FastAPI, Depends, Request
from httpx import AsyncClient, ASGITransport

from app.auth.session import create_session_cookie
from app.auth.dependencies import get_current_user_id, get_current_org
from app.services import organization_service


def test_create_and_decode_session_cookie_roundtrip():
    from app.auth.session import decode_session_cookie
    token = create_session_cookie(user_id="user_123", org_id="org_456")
    payload = decode_session_cookie(token)
    assert payload["user_id"] == "user_123"
    assert payload["org_id"] == "org_456"


def test_decode_invalid_token_raises():
    from app.auth.session import decode_session_cookie
    import jwt
    with pytest.raises(jwt.InvalidTokenError):
        decode_session_cookie("not-a-real-token")


@pytest.mark.anyio
async def test_get_current_user_id_missing_cookie_is_401():
    app = FastAPI()

    @app.get("/whoami")
    async def whoami(user_id: str = Depends(get_current_user_id)):
        return {"user_id": user_id}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/whoami")
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_get_current_user_id_valid_cookie_resolves(db):
    app = FastAPI()

    @app.get("/whoami")
    async def whoami(user_id: str = Depends(get_current_user_id)):
        return {"user_id": user_id}

    token = create_session_cookie(user_id="user_123", org_id="org_456")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", cookies={"aidlc_session": token}) as client:
        resp = await client.get("/whoami")
    assert resp.status_code == 200
    assert resp.json() == {"user_id": "user_123"}


@pytest.mark.anyio
async def test_get_current_org_unprovisioned_org_is_403(db, monkeypatch):
    import app.database as database_module
    monkeypatch.setattr(database_module, "get_db", lambda: db)

    app = FastAPI()

    @app.get("/org")
    async def org_route(org=Depends(get_current_org)):
        return {"org_id": org.id}

    token = create_session_cookie(user_id="user_123", org_id="000000000000000000000000")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", cookies={"aidlc_session": token}) as client:
        resp = await client.get("/org")
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_get_current_org_provisioned_org_resolves(db, monkeypatch):
    import app.database as database_module
    monkeypatch.setattr(database_module, "get_db", lambda: db)

    created = await organization_service.create_organization(db, workos_org_id="org_abc", name="Acme")

    app = FastAPI()

    @app.get("/org")
    async def org_route(org=Depends(get_current_org)):
        return {"org_id": org.id}

    token = create_session_cookie(user_id="user_123", org_id=created.id)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", cookies={"aidlc_session": token}) as client:
        resp = await client.get("/org")
    assert resp.status_code == 200
    assert resp.json() == {"org_id": created.id}
