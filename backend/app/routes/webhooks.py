from fastapi import APIRouter, Request, HTTPException, Depends

from app.auth.workos_client import verify_webhook
from app.config import settings
from app.database import get_db
from app.services import organization_service

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])


@router.post("/workos")
async def workos_webhook(request: Request, db=Depends(get_db)):
    if not settings.WORKOS_WEBHOOK_SECRET.strip():
        raise HTTPException(status_code=503, detail="WorkOS webhooks are not configured")
    payload = await request.body()
    signature = request.headers.get("workos-signature", "")

    try:
        event = verify_webhook(payload, signature)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    if event.get("event") == "organization.created":
        data = event.get("data", {})
        if not data.get("id"):
            raise HTTPException(status_code=400, detail="organization.created event has no id")
        existing = await organization_service.get_by_workos_id(db, data["id"])
        if existing is None:
            await organization_service.create_organization(db, workos_org_id=data["id"], name=data.get("name", ""))

    return {"status": "ok"}
