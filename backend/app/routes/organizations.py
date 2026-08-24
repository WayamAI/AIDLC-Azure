from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Any, Optional

from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.services import connector_settings_service as connectors

router = APIRouter(prefix="/orgs", tags=["Organizations"])


@router.get("/current", response_model=OrganizationOut)
async def current_organization(org: OrganizationOut = Depends(get_current_org)):
    return org


class ConnectorsUpdateIn(BaseModel):
    github: Optional[dict[str, Any]] = None
    jira: Optional[dict[str, Any]] = None
    vercel: Optional[dict[str, Any]] = None
    ollama: Optional[dict[str, Any]] = None
    slack: Optional[dict[str, Any]] = None
    datadog: Optional[dict[str, Any]] = None


@router.get("/current/connectors")
async def get_connectors(org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    raw = await connectors.get_raw(db, org.id)
    return connectors.public_view(raw)


@router.put("/current/connectors")
async def put_connectors(
    body: ConnectorsUpdateIn,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    try:
        return await connectors.update(db, org.id, body.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
