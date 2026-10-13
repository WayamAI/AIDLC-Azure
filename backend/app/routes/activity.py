"""Activity / search / repo-probe history API."""
from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.auth.dependencies import get_current_org, get_current_user_id
from app.database import get_db
from app.models.organization import OrganizationOut
from app.services import activity_history_service as svc

router = APIRouter(prefix="/activity", tags=["Activity History"])

Kind = Literal["search", "nav", "repo_probe"]


class HistoryPushIn(BaseModel):
    kind: Kind = "nav"
    title: str = Field(..., min_length=1, max_length=200)
    url: str = Field(..., min_length=1, max_length=500)
    section: Optional[str] = Field(None, max_length=120)
    payload: dict[str, Any] = Field(default_factory=dict)


class HistoryItemOut(BaseModel):
    id: str
    kind: str
    title: str
    url: str
    section: Optional[str] = None
    payload: dict[str, Any] = Field(default_factory=dict)
    visited_at: Optional[str] = None
    user_id: Optional[str] = None


class HistoryListOut(BaseModel):
    items: list[HistoryItemOut]


@router.get("/history", response_model=HistoryListOut)
async def get_history(
    kind: Optional[Kind] = Query(None),
    limit: int = Query(30, ge=1, le=100),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    items = await svc.list_history(db, org_id=org.id, kind=kind, limit=limit)
    return HistoryListOut(items=[HistoryItemOut(**i) for i in items])


@router.post("/history", response_model=HistoryItemOut)
async def push_history(
    body: HistoryPushIn,
    org: OrganizationOut = Depends(get_current_org),
    user_id: str = Depends(get_current_user_id),
    db=Depends(get_db),
):
    doc = await svc.push(
        db,
        org_id=org.id,
        user_id=user_id,
        kind=body.kind,
        title=body.title,
        url=body.url,
        section=body.section,
        payload=body.payload,
    )
    return HistoryItemOut(**doc)


@router.delete("/history")
async def clear_history(
    kind: Optional[Kind] = Query(None),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    deleted = await svc.clear(db, org_id=org.id, kind=kind)
    return {"deleted": deleted}
