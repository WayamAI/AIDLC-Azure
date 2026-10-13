"""Incident post-mortem generation and the demo-source marker."""
from unittest.mock import AsyncMock, patch

import pytest

from app.auth.session import create_session_cookie
from app.routes import incidents
from app.services import organization_service

RCA = {
    "root_cause": "Upstream export dropped the email column.",
    "evidence": ["completeness fell 15pp on 2026-03-06"],
    "immediate_action": "Re-run the export.",
    "prevention_action": "Add a schema check.",
    "confidence": 0.7,
}
ANOMALY = {"date": "2026-03-06", "dimension": "completeness", "value": 71.0, "drop": 17.0}


def _cookies(app_client, org_id: str, user_id: str = "user") -> None:
    token = create_session_cookie(user_id=user_id, org_id=org_id)
    app_client.cookies.set("aidlc_session", token)


async def _create(app_client, **extra) -> dict:
    with patch.object(incidents, "investigate_incident", new=AsyncMock(return_value=RCA)), \
         patch.object(incidents.slack_service, "send_incident_created", new=AsyncMock(return_value=True)):
        resp = await app_client.post("/api/incidents", json={"anomaly": ANOMALY, "title": "Completeness drop", **extra})
    assert resp.status_code == 201
    return resp.json()


@pytest.mark.anyio
async def test_source_defaults_to_manual_and_accepts_demo(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_i1", name="I1")
    _cookies(app_client, org.id)

    assert (await _create(app_client))["source"] == "manual"
    demo = await _create(app_client, source="demo")
    assert demo["source"] == "demo"
    stored = await db.incidents.find_one({"_id": demo["id"]})
    assert stored["source"] == "demo"

    resp = await app_client.post("/api/incidents", json={"anomaly": ANOMALY, "source": "production"})
    assert resp.status_code == 400


@pytest.mark.anyio
async def test_postmortem_is_written_from_stored_facts(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_i2", name="I2")
    _cookies(app_client, org.id)
    incident = await _create(app_client)
    await app_client.put(f"/api/incidents/{incident['id']}/resolve", json={"note": "Export re-run, column restored."})

    narrative = "## Summary\nCompleteness dropped.\n\n## Resolution\nExport re-run, column restored."
    writer = AsyncMock(return_value=narrative)
    with patch.object(incidents, "generate_incident_postmortem", new=writer):
        resp = await app_client.post(f"/api/incidents/{incident['id']}/postmortem")

    assert resp.status_code == 200
    body = resp.json()
    # The model was given the stored timeline, hypothesis and resolution note.
    facts = writer.await_args.args[0]
    assert facts["root_cause_hypothesis"] == RCA["root_cause"]
    assert facts["resolution_note"] == "Export re-run, column restored."
    assert [e["type"] for e in facts["timeline"]] == ["created", "ai_analysis", "resolved"]

    assert body["ai_written"] is True
    assert body["generation_error"] is None
    assert narrative in body["markdown"]
    assert body["markdown"].startswith("# Post-mortem: Completeness drop")
    assert "## Recorded facts" in body["markdown"]
    # Existing response fields are still present.
    for key in ("incident_id", "title", "triggered_at", "resolved_at", "root_cause", "evidence",
                "timeline", "immediate_action", "prevention_action", "anomaly_details", "generated_at"):
        assert key in body


@pytest.mark.anyio
async def test_postmortem_falls_back_to_marked_facts_when_ai_fails(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_i3", name="I3")
    _cookies(app_client, org.id)
    incident = await _create(app_client, source="demo")

    with patch.object(incidents, "generate_incident_postmortem", new=AsyncMock(side_effect=RuntimeError("model down"))):
        resp = await app_client.post(f"/api/incidents/{incident['id']}/postmortem")

    assert resp.status_code == 200
    body = resp.json()
    assert body["ai_written"] is False
    assert "model down" in body["generation_error"]
    markdown = body["markdown"]
    assert "**Not AI-written.**" in markdown
    assert "demo simulation" in markdown
    assert RCA["root_cause"] in markdown
    assert "Incident created" in markdown
    assert "Not resolved" in markdown
