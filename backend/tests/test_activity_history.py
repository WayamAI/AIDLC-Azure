"""Activity history route tests."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_activity_history_crud(app_client):
    # login via fixture cookie if available fall back to seed login
    login = await app_client.post(
        "/api/auth/login",
        json={"email": "mriganka.dey@wayam.ai", "password": "wayam"},
    )
    if login.status_code != 200:
        pytest.skip(f"seed login unavailable: {login.status_code} {login.text}")

    push = await app_client.post(
        "/api/activity/history",
        json={
            "kind": "search",
            "title": "Dashboard",
            "url": "/dashboard",
            "section": "Overview",
        },
    )
    assert push.status_code == 200, push.text
    body = push.json()
    assert body["title"] == "Dashboard"
    assert body["kind"] == "search"

    listed = await app_client.get("/api/activity/history", params={"kind": "search"})
    assert listed.status_code == 200
    items = listed.json()["items"]
    assert any(i["url"] == "/dashboard" for i in items)

    cleared = await app_client.delete("/api/activity/history", params={"kind": "search"})
    assert cleared.status_code == 200
    assert cleared.json()["deleted"] >= 1
