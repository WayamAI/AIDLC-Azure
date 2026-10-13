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
async def test_seed_account_needs_configuration(db, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "SEED_USER_EMAIL", "")
    monkeypatch.setattr(settings, "SEED_USER_PASSWORD", "")
    assert await user_service.seed_configured_account(db) is False
    assert await db.users.count_documents({}) == 0


@pytest.mark.anyio
async def test_seed_account_is_created_once_and_can_sign_in(db, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "APP_ENV", "production")
    monkeypatch.setattr(settings, "SEED_USER_EMAIL", "Demo@Example.com")
    monkeypatch.setattr(settings, "SEED_USER_PASSWORD", "a-long-demo-password")
    monkeypatch.setattr(settings, "SEED_USER_NAME", "Demo User")
    monkeypatch.setattr(settings, "SEED_ORG_NAME", "Example Org")

    assert await user_service.seed_configured_account(db) is True
    assert await user_service.seed_configured_account(db) is False      # already there
    assert await db.users.count_documents({}) == 1

    user = await user_service.authenticate(db, "demo@example.com", "a-long-demo-password")
    assert user is not None
    org = await db.organizations.find_one({"workos_org_id": user_service.seed_org_key("demo@example.com")})
    assert org["name"] == "Example Org" and str(org["_id"]) == user["org_id"]
    assert await user_service.authenticate(db, "demo@example.com", "wrong") is None


@pytest.mark.anyio
async def test_signup_is_disabled_by_default(app_client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "SIGNUP_ENABLED", False)
    resp = await app_client.post("/api/auth/signup", json={"email": "new@example.com", "password": "long-enough-pw"})
    assert resp.status_code == 403
    assert "disabled" in resp.json()["detail"]
