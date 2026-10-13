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
from app.services.ai_service import investigate_incident, generate_incident_postmortem, AIQuotaError
from app.services import slack_service

router = APIRouter(prefix="/incidents", tags=["Incidents"])

# "demo" marks incidents raised from the monitoring demo simulation (synthetic data).
INCIDENT_SOURCES = ("manual", "demo")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolution_note(doc: dict) -> str:
    """The stored resolution note; older incidents only have it inside the timeline."""
    if doc.get("resolution_note"):
        return str(doc["resolution_note"])
    for entry in reversed(doc.get("timeline") or []):
        if entry.get("type") == "resolved":
            return str(entry.get("event", "")).removeprefix("Resolved: ").strip()
    return ""


def _postmortem_facts(doc: dict) -> dict:
    """The stored incident fields a post-mortem is written from."""
    return {
        "incident_id": doc.get("_id") or doc.get("id", ""),
        "title": doc.get("title", ""),
        "status": doc.get("status", ""),
        "source": doc.get("source", "manual"),
        "triggered_at": doc.get("triggered_at", ""),
        "resolved_at": doc.get("resolved_at"),
        "anomaly": doc.get("anomaly", {}),
        "root_cause_hypothesis": doc.get("root_cause", ""),
        "root_cause_confidence": doc.get("confidence"),
        "evidence": doc.get("evidence", []),
        "timeline": doc.get("timeline", []),
        "resolution_note": _resolution_note(doc),
        "immediate_action": doc.get("immediate_action", ""),
        "prevention_action": doc.get("prevention_action", ""),
    }


def _render_facts_markdown(facts: dict) -> str:
    """Plain Markdown rendering of the stored facts. No generation involved."""
    def bullets(items: list) -> str:
        return "\n".join(f"- {item}" for item in items) or "- Not recorded"

    anomaly = facts["anomaly"] or {}
    timeline = [
        f"`{e.get('time', '?')}` {e.get('event', '')}" for e in facts["timeline"] if isinstance(e, dict)
    ]
    lines = [
        "## Recorded facts",
        "",
        f"- **Incident:** {facts['incident_id']}",
        f"- **Status:** {facts['status'] or 'Not recorded'}",
        f"- **Source:** {facts['source']}",
        f"- **Triggered:** {facts['triggered_at'] or 'Not recorded'}",
        f"- **Resolved:** {facts['resolved_at'] or 'Not resolved'}",
        "",
        "### Anomaly",
        "",
        bullets([f"{key}: {value}" for key, value in anomaly.items()]),
        "",
        "### Root-cause hypothesis (automated analysis, unconfirmed)",
        "",
        facts["root_cause_hypothesis"] or "Not recorded",
        "",
        "### Evidence",
        "",
        bullets(facts["evidence"]),
        "",
        "### Timeline",
        "",
        bullets(timeline),
        "",
        "### Resolution note",
        "",
        facts["resolution_note"] or ("Not recorded" if facts["resolved_at"] else "Not resolved"),
        "",
        "### Recorded actions",
        "",
        f"- **Immediate:** {facts['immediate_action'] or 'Not recorded'}",
        f"- **Prevention:** {facts['prevention_action'] or 'Not recorded'}",
    ]
    return "\n".join(lines)


@router.post("", status_code=201)
async def create_incident(
    body: dict = Body(...),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Create an incident from an anomaly and trigger AI root cause analysis.

    Optional body field `source`: "manual" (default) or "demo" for incidents
    raised from the monitoring demo simulation.
    """
    source = body.get("source") or "manual"
    if source not in INCIDENT_SOURCES:
        raise HTTPException(status_code=400, detail=f"source must be one of: {', '.join(INCIDENT_SOURCES)}")
    anomaly: dict = body.get("anomaly", {})
    column_comparison: list[dict] = body.get("column_comparison", [])
    recent_commits: list[str] = body.get("recent_commits", [])
    related_alerts: list[dict] = body.get("related_alerts", [])
    title: str = body.get("title") or f"Data Quality Anomaly {anomaly.get('dimension', 'unknown')} drop"

    incident_id = f"INC-{str(uuid.uuid4())[:8].upper()}"

    # Run AI RCA. If it fails the incident is still recorded, with no analysis:
    # the fields stay empty and `rca_error` says why.
    rca: dict = {}
    rca_error = None
    try:
        rca = await investigate_incident(anomaly, column_comparison, recent_commits, related_alerts)
    except AIQuotaError:
        raise
    except Exception as exc:
        rca_error = str(exc)[:500] or type(exc).__name__

    incident = {
        "_id": incident_id,
        "id": incident_id,
        "org_id": org.id,
        "title": title,
        "source": source,
        "status": "investigating",
        "triggered_at": _now_iso(),
        "anomaly": anomaly,
        "root_cause": rca.get("root_cause", ""),
        "evidence": rca.get("evidence", []),
        "immediate_action": rca.get("immediate_action", ""),
        "prevention_action": rca.get("prevention_action", ""),
        "confidence": rca.get("confidence"),
        "rca_error": rca_error,
        "timeline": [
            {"time": _now_iso(), "event": "Incident created", "type": "created"},
            (
                {"time": _now_iso(), "event": f"AI RCA unavailable: {rca_error}", "type": "ai_analysis_failed"}
                if rca_error else
                {"time": _now_iso(), "event": f"AI RCA: {rca.get('root_cause', 'N/A')}", "type": "ai_analysis"}
            ),
        ],
    }

    await db.incidents.insert_one(dict(incident))

    # Notify Slack. Never for a demo incident: its data is synthetic.
    if source != "demo":
        try:
            await slack_service.send_incident_created(
                incident_id=incident_id,
                title=title,
                root_cause=rca.get("root_cause") or "AI root-cause analysis unavailable",
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
        "resolution_note": resolution_note,
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
    """Generate a post-mortem document for an incident.

    `markdown` is the document: an AI-written narrative built only from the
    stored timeline, root-cause hypothesis and resolution note, followed by the
    recorded facts. If the AI call fails, `markdown` is the recorded facts alone,
    marked as not AI-written, with `ai_written` false and the reason in
    `generation_error`. The other fields are the stored values, as before.
    """
    doc = await db.incidents.find_one({"_id": incident_id, "org_id": org.id})
    if not doc:
        raise HTTPException(status_code=404, detail="Incident not found")

    facts = _postmortem_facts(doc)
    facts_markdown = _render_facts_markdown(facts)
    generated_at = _now_iso()
    title_line = f"# Post-mortem: {facts['title'] or incident_id}"
    demo_line = (
        "> This incident was raised from the monitoring demo simulation. Its data is synthetic.\n\n"
        if facts["source"] == "demo" else ""
    )

    generation_error = None
    try:
        narrative = await generate_incident_postmortem(facts)
    except Exception as exc:
        narrative = None
        generation_error = str(exc)

    if narrative:
        markdown = (
            f"{title_line}\n\n{demo_line}"
            f"_Narrative written by AI on {generated_at} from the recorded facts listed at the end. "
            "The root cause is an automated hypothesis and has not been confirmed._\n\n"
            f"{narrative}\n\n---\n\n{facts_markdown}\n"
        )
    else:
        markdown = (
            f"{title_line}\n\n{demo_line}"
            "> **Not AI-written.** The narrative could not be generated, so this document "
            "contains only the recorded facts.\n\n"
            f"{facts_markdown}\n"
        )

    report = {
        "incident_id": incident_id,
        "title": doc.get("title", ""),
        "source": facts["source"],
        "triggered_at": doc.get("triggered_at", ""),
        "resolved_at": doc.get("resolved_at", "Ongoing"),
        "root_cause": doc.get("root_cause", ""),
        "evidence": doc.get("evidence", []),
        "timeline": doc.get("timeline", []),
        "resolution_note": facts["resolution_note"],
        "immediate_action": doc.get("immediate_action", ""),
        "prevention_action": doc.get("prevention_action", ""),
        "anomaly_details": doc.get("anomaly", {}),
        "markdown": markdown,
        "ai_written": narrative is not None,
        "generation_error": generation_error,
        "generated_at": generated_at,
    }
    return report
