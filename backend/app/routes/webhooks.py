from fastapi import APIRouter, Request, HTTPException, Depends

from app.auth.workos_client import verify_webhook
from app.database import get_db
from app.services import organization_service

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])


@router.post("/workos")
async def workos_webhook(request: Request, db=Depends(get_db)):
    payload = await request.body()
    signature = request.headers.get("workos-signature", "")

    try:
        event = verify_webhook(payload, signature)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    if event.get("event") == "organization.created":
        data = event.get("data", {})
        existing = await organization_service.get_by_workos_id(db, data["id"])
        if existing is None:
            await organization_service.create_organization(db, workos_org_id=data["id"], name=data.get("name", ""))

    return {"status": "ok"}
