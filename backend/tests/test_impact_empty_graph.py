from unittest.mock import AsyncMock, patch

import pytest

from app.auth.session import create_session_cookie
from app.services import organization_service


def _cookies(app_client, org_id: str, user_id: str = "dev:probe@example.com") -> None:
    token = create_session_cookie(user_id=user_id, org_id=org_id)
    app_client.cookies.set("aidlc_session", token)


@pytest.mark.anyio
async def test_impact_graph_docs_only_commit_returns_200(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_graph", name="G")
    _cookies(app_client, org.id)

    with patch(
        "app.routes.impact.impact_service.get_commit_changed_files",
        new=AsyncMock(return_value=([], {"title": "docs: changelog", "url": "https://example.com"})),
    ):
        resp = await app_client.post(
            "/api/impact/graph",
            json={"owner": "pallets", "repo": "click", "commit_sha": "2c8cd3ac958a"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["nodes"] == []
    assert body["changed_files"] == []
    assert "source files" in (body.get("message") or "")
