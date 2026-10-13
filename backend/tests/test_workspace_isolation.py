import pytest
from app.services import workspace_service


@pytest.mark.anyio
async def test_org_b_cannot_read_org_a_workspace():
    workspace_service._WORKSPACES.clear()
    workspace_service._WORKSPACES["ws_1"] = {"org_id": "org_a", "path": "/tmp/workspaces/ws_1"}

    result = workspace_service.get_workspace(org_id="org_b", workspace_id="ws_1")
    assert result is None

    result = workspace_service.get_workspace(org_id="org_a", workspace_id="ws_1")
    assert result is not None
    assert workspace_service.require_workspace("org_a", "ws_1") is result
