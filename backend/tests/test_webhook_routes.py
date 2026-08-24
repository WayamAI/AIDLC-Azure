from unittest.mock import patch

import pytest


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
