import pytest

from app.auth.session import create_session_cookie
from app.services import organization_service, user_service


def _cookies(app_client, org_id: str, user_id: str) -> None:
    token = create_session_cookie(user_id=user_id, org_id=org_id)
    app_client.cookies.set("aidlc_session", token)


@pytest.mark.anyio
async def test_patch_me_persists_name_and_prefs(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    user = await user_service.create_user(
        db, email="ada@example.com", password="secret", org_id=org.id, name="Ada"
    )
    _cookies(app_client, org.id, str(user["_id"]))

    resp = await app_client.get("/api/auth/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Ada"
    assert body["email"] == "ada@example.com"
    assert body["notifications"] is True
    assert body["newsletter"] is False

    resp = await app_client.patch(
        "/api/auth/me",
        json={"name": "Ada Lovelace", "notifications": False, "newsletter": True},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Ada Lovelace"
    assert body["notifications"] is False
    assert body["newsletter"] is True
    assert body["email"] == "ada@example.com"

    resp = await app_client.get("/api/auth/me")
    body = resp.json()
    assert body["name"] == "Ada Lovelace"
    assert body["newsletter"] is True

    stored = await user_service.get_by_id(db, str(user["_id"]))
    assert stored["name"] == "Ada Lovelace"
    assert stored["notifications"] is False


@pytest.mark.anyio
async def test_patch_me_dev_user_uses_overlay(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="dev_org", name="Dev")
    _cookies(app_client, org.id, "dev:demo@example.com")

    resp = await app_client.patch("/api/auth/me", json={"name": "Demo User"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Demo User"

    resp = await app_client.get("/api/auth/me")
    assert resp.json()["name"] == "Demo User"
    assert resp.json()["email"] == "demo@example.com"


@pytest.mark.anyio
async def test_patch_me_requires_fields(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    _cookies(app_client, org.id, "dev:a@b.com")
    resp = await app_client.patch("/api/auth/me", json={})
    assert resp.status_code == 400


@pytest.mark.anyio
async def test_patch_me_rejects_empty_name(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    _cookies(app_client, org.id, "dev:a@b.com")
    resp = await app_client.patch("/api/auth/me", json={"name": "   "})
    assert resp.status_code == 400


@pytest.mark.anyio
async def test_seed_account_skipped_in_production(db, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "APP_ENV", "production")
    await user_service.seed_wayam_account(db)
    assert await user_service.get_by_email(db, user_service._SEED_EMAIL) is None
