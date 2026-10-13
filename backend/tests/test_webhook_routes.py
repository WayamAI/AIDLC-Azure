from unittest.mock import patch

import pytest

from app.config import settings


@pytest.fixture(autouse=True)
def _webhook_secret(monkeypatch):
    monkeypatch.setattr(settings, "WORKOS_WEBHOOK_SECRET", "whsec_test")


@pytest.mark.anyio
async def test_webhook_is_refused_when_no_secret_is_configured(app_client, monkeypatch):
    # An empty signing key would let anyone forge a valid signature.
    monkeypatch.setattr(settings, "WORKOS_WEBHOOK_SECRET", "")
    resp = await app_client.post("/api/webhooks/workos", content=b"{}", headers={"workos-signature": "x"})
    assert resp.status_code == 503


@pytest.mark.anyio
async def test_invalid_signature_rejected(app_client):
    with patch("app.routes.webhooks.verify_webhook", side_effect=ValueError("bad sig")):
        resp = await app_client.post(
            "/api/webhooks/workos",
            content=b'{"event": "organization.created"}',
            headers={"workos-signature": "bad"},
        )
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_organization_created_event_creates_local_org(app_client, db):
    event = {
        "event": "organization.created",
        "data": {"id": "org_workos_789", "name": "New Co"},
    }
    with patch("app.routes.webhooks.verify_webhook", return_value=event):
        resp = await app_client.post(
            "/api/webhooks/workos",
            content=b'{}',
            headers={"workos-signature": "valid"},
        )
    assert resp.status_code == 200

    org_doc = await db.organizations.find_one({"workos_org_id": "org_workos_789"})
    assert org_doc is not None
    assert org_doc["name"] == "New Co"


@pytest.mark.anyio
async def test_unhandled_event_type_is_ignored_gracefully(app_client):
    event = {"event": "some.other.event", "data": {}}
    with patch("app.routes.webhooks.verify_webhook", return_value=event):
        resp = await app_client.post(
            "/api/webhooks/workos",
            content=b'{}',
            headers={"workos-signature": "valid"},
        )
    assert resp.status_code == 200
