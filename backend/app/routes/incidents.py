"""
Incident Intelligence routes.
Creates incidents from anomalies, runs AI root cause analysis, generates post-mortems.
"""
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Body, Depends

from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.services.ai_service import investigate_incident, AIQuotaError
from app.services import slack_service

router = APIRouter(prefix="/incidents", tags=["Incidents"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.post("", status_code=201)
async def create_incident(
    body: dict = Body(...),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Create an incident from an anomaly and trigger AI root cause analysis."""
    anomaly: dict = body.get("anomaly", {})
    column_comparison: list[dict] = body.get("column_comparison", [])
    recent_commits: list[str] = body.get("recent_commits", [])
    related_alerts: list[dict] = body.get("related_alerts", [])
    title: str = body.get("title") or f"Data Quality Anomaly {anomaly.get('dimension', 'unknown')} drop"

    incident_id = f"INC-{str(uuid.uuid4())[:8].upper()}"

    # Run AI RCA
    try:
        rca = await investigate_incident(anomaly, column_comparison, recent_commits, related_alerts)
    except AIQuotaError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except Exception as exc:
        rca = {
            "root_cause": "Unable to determine root cause automatically.",
            "evidence": [str(exc)],
            "immediate_action": "Manual investigation required.",
            "prevention_action": "Review upstream data pipelines.",
            "confidence": 0.0,
        }

    incident = {
        "_id": incident_id,
        "id": incident_id,
        "org_id": org.id,
        "title": title,
        "status": "investigating",
        "triggered_at": _now_iso(),
        "anomaly": anomaly,
        "root_cause": rca.get("root_cause", ""),
        "evidence": rca.get("evidence", []),
        "immediate_action": rca.get("immediate_action", ""),
        "prevention_action": rca.get("prevention_action", ""),
        "confidence": rca.get("confidence", 0.0),
        "timeline": [
            {"time": _now_iso(), "event": "Incident created", "type": "created"},
            {"time": _now_iso(), "event": f"AI RCA: {rca.get('root_cause', 'N/A')}", "type": "ai_analysis"},
        ],
    }

    await db.incidents.insert_one(dict(incident))

    # Notify Slack
    try:
        await slack_service.send_incident_created(
            incident_id=incident_id,
            title=title,
            root_cause=rca.get("root_cause", ""),
        )
    except Exception:
        pass

    return incident


@router.get("")
async def list_incidents(
    limit: int = 20,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    cursor = db.incidents.find({"org_id": org.id}).sort("triggered_at", -1).limit(limit)
    docs = await cursor.to_list(length=limit)
    for d in docs:
        d["id"] = d.pop("_id", d.get("id", ""))
    return docs


@router.get("/{incident_id}")
async def get_incident(
    incident_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    doc = await db.incidents.find_one({"_id": incident_id, "org_id": org.id})
    if not doc:
        raise HTTPException(status_code=404, detail="Incident not found")
    doc["id"] = doc.pop("_id")
    return doc


@router.put("/{incident_id}/resolve")
async def resolve_incident(
    incident_id: str,
    body: dict = Body(default={}),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    doc = await db.incidents.find_one({"_id": incident_id, "org_id": org.id})
    if not doc:
        raise HTTPException(status_code=404, detail="Incident not found")

    resolution_note = body.get("note", "Resolved.")
    update = {
        "status": "resolved",
        "resolved_at": _now_iso(),
        "$push": {
            "timeline": {"time": _now_iso(), "event": f"Resolved: {resolution_note}", "type": "resolved"}
        },
    }
    push_op = update.pop("$push")
    await db.incidents.update_one(
        {"_id": incident_id, "org_id": org.id}, {"$set": update, "$push": push_op}
    )
    updated = await db.incidents.find_one({"_id": incident_id, "org_id": org.id})
    updated["id"] = updated.pop("_id")
    return updated


@router.post("/{incident_id}/postmortem")
async def generate_postmortem(
    incident_id: str,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Generate a structured post-mortem report for an incident."""
    doc = await db.incidents.find_one({"_id": incident_id, "org_id": org.id})
    if not doc:
        raise HTTPException(status_code=404, detail="Incident not found")

    report = {
        "incident_id": incident_id,
        "title": doc.get("title", ""),
        "triggered_at": doc.get("triggered_at", ""),
        "resolved_at": doc.get("resolved_at", "Ongoing"),
        "root_cause": doc.get("root_cause", ""),
        "evidence": doc.get("evidence", []),
        "timeline": doc.get("timeline", []),
        "immediate_action": doc.get("immediate_action", ""),
        "prevention_action": doc.get("prevention_action", ""),
        "anomaly_details": doc.get("anomaly", {}),
        "generated_at": _now_iso(),
    }
    return report
