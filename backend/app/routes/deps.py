"""Dependencies shared by several routers."""
from fastapi import Depends, Request

from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.services import workspace_service


async def attach_workspace(
    request: Request,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
) -> None:
    """Re-attach the request's workspace from the MongoDB registry.

    The workspace id is taken from the path, the query string or the JSON body,
    wherever the route declares it. Responds 410 when the clone directory is gone.
    """
    workspace_id = request.path_params.get("workspace_id") or request.query_params.get("workspace_id")
    if not workspace_id and "application/json" in request.headers.get("content-type", ""):
        try:
            body = await request.json()
        except ValueError:
            body = None
        if isinstance(body, dict):
            workspace_id = body.get("workspace_id")
    if isinstance(workspace_id, str) and workspace_id:
        await workspace_service.ensure_attached(db, org.id, workspace_id)
