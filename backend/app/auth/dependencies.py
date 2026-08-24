import jwt
from fastapi import Request, HTTPException, Depends

from app.auth.session import COOKIE_NAME, decode_session_cookie
from app.database import get_db
from app.models.organization import OrganizationOut
from app.services import organization_service
from app.services import connector_settings_service as connectors
from app.services.ai_service import reset_current_org_id, set_current_org_id


def get_current_user_id(request: Request) -> str:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_session_cookie(token)
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return payload["user_id"]


async def get_current_org(request: Request, db=Depends(get_db)) -> OrganizationOut:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_session_cookie(token)
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    org = await organization_service.get_by_id(db, payload["org_id"])
    if org is None:
        raise HTTPException(status_code=403, detail="organization not yet provisioned")

    # Attribute any AI calls made during this request to this org, so
    # api_cost_logs entries can be scoped without threading org_id through
    # every ai_service call site individually.
    org_token = set_current_org_id(org.id)
    raw_connectors = await connectors.get_raw(db, org.id)
    conn_token = connectors.set_current_org_connectors(raw_connectors)
    try:
        yield org
    finally:
        connectors.reset_current_org_connectors(conn_token)
        reset_current_org_id(org_token)
