"""Requirement creation: generated-case validation, failure status, and HTTP error mapping."""
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import httpx
import openai
import pytest

from app.auth.session import create_session_cookie
from app.services import ai_service, organization_service, requirement_service

REQ_TEXT = "Users can reset their password by email"
GENERATE = "app.services.requirement_service.ai_service.generate_test_cases"


def _case(tc_id: str = "TC-001", **overrides) -> dict:
    return {"tc_id": tc_id, "name": "Reset works", "description": "d", "severity": "High", "expected": "e", **overrides}


async def _login(app_client, db, name: str = "A") -> str:
    org = await organization_service.create_organization(db, workos_org_id=f"org_{name}", name=name)
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="user", org_id=org.id))
    return org.id


# ── _validate_test_cases ──────────────────────────────────────────────────

def test_valid_cases_are_kept_and_every_category_is_present():
    out = ai_service._validate_test_cases({"functional": [_case()], "api": [_case("TC-002")]})
    assert list(out) == ["functional", "edge", "api", "failure", "regression"]
    assert out["functional"] == [_case()]
    assert out["api"] == [_case("TC-002")]
    assert out["edge"] == out["failure"] == out["regression"] == []


def test_malformed_entries_and_categories_are_dropped():
    out = ai_service._validate_test_cases({
        "functional": [_case(), "not an object", None, {"tc_id": "TC-9"}, _case("TC-003", name="   ")],
        "edge": "should have been a list",
        "api": {"tc_id": "TC-004", "name": "an object, not a list"},
        "made_up_category": [_case("TC-005")],
    })
    assert out["functional"] == [_case()]
    assert out["edge"] == [] and out["api"] == []
    assert "made_up_category" not in out


def test_fields_are_coerced_to_what_the_app_stores():
    out = ai_service._validate_test_cases({
        "edge": [{"tc_id": 7, "name": " Boundary ", "severity": "critical", "expected": None}],
        "failure": [{"name": "No severity given", "severity": "urgent"}],
    })
    assert out["edge"] == [
        {"tc_id": "7", "name": "Boundary", "description": "", "severity": "Critical", "expected": ""}
    ]
    assert out["failure"][0]["severity"] == "Medium"
    assert out["failure"][0]["tc_id"] == ""


@pytest.mark.parametrize(
    "data",
    [
        {},
        [],
        "text",
        None,
        {"functional": [], "edge": []},
        {"functional": "nope", "edge": [None, {"description": "no name"}]},
    ],
)
def test_nothing_valid_raises_a_clear_error(data):
    with pytest.raises(ai_service.AIResponseError):
        ai_service._validate_test_cases(data)


async def test_generate_test_cases_validates_the_model_output(monkeypatch):
    async def fake_json(prompt, timeout=None, task_name=None):
        return {"functional": [_case(), "junk"], "edge": {"not": "a list"}}

    monkeypatch.setattr(ai_service, "_call_openai_json", fake_json)
    out = await ai_service.generate_test_cases(REQ_TEXT)
    assert out["functional"] == [_case()]
    assert out["edge"] == []


async def test_generate_test_cases_reports_unparseable_output_as_a_response_error(monkeypatch):
    async def fake_call(prompt, json_mode=True, timeout=None, task_name=None):
        return "I could not produce JSON"

    monkeypatch.setattr(ai_service, "_call_openai", fake_call)
    with pytest.raises(ai_service.AIResponseError, match="valid JSON"):
        await ai_service.generate_test_cases(REQ_TEXT)


# ── requirement status ────────────────────────────────────────────────────

async def test_failed_generation_marks_the_requirement_failed_and_reraises(db):
    error = ai_service.AIResponseError("The AI model returned no usable test cases.")
    with patch(GENERATE, new=AsyncMock(side_effect=error)):
        with pytest.raises(ai_service.AIResponseError):
            await requirement_service.create_requirement(db, "org-1", REQ_TEXT)

    doc = await db.requirements.find_one({"org_id": "org-1"})
    assert doc["status"] == "failed"
    assert "no usable test cases" in doc["error"]
    assert await db.test_cases.count_documents({}) == 0


async def test_stored_error_is_short(db):
    with patch(GENERATE, new=AsyncMock(side_effect=RuntimeError("x" * 5000))):
        with pytest.raises(RuntimeError):
            await requirement_service.create_requirement(db, "org-1", REQ_TEXT)
    doc = await db.requirements.find_one({"org_id": "org-1"})
    assert len(doc["error"]) <= 300


async def test_failure_while_storing_cases_also_marks_failed(db):
    with patch(GENERATE, new=AsyncMock(return_value={"functional": [_case()]})), \
         patch.object(requirement_service, "create_test_cases_from_ai", new=AsyncMock(side_effect=RuntimeError("insert failed"))):
        with pytest.raises(RuntimeError):
            await requirement_service.create_requirement(db, "org-1", REQ_TEXT)
    assert (await db.requirements.find_one({"org_id": "org-1"}))["status"] == "failed"


async def test_successful_generation_is_processed(db):
    with patch(GENERATE, new=AsyncMock(return_value={"functional": [_case()], "edge": []})):
        result = await requirement_service.create_requirement(db, "org-1", REQ_TEXT)
    assert result["status"] == "processed"
    assert result["total_tests"] == 1
    doc = await db.requirements.find_one({"org_id": "org-1"})
    assert doc["status"] == "processed"
    assert "error" not in doc


async def test_list_returns_only_processed_by_default(db):
    now = datetime(2026, 1, 1)
    await db.requirements.insert_many([
        {"org_id": "org-1", "text": "ok", "created_at": now, "status": "processed"},
        {"org_id": "org-1", "text": "stuck", "created_at": now - timedelta(minutes=1), "status": "pending"},
        {"org_id": "org-1", "text": "bad", "created_at": now - timedelta(minutes=2), "status": "failed",
         "error": "model down"},
    ])

    default = await requirement_service.list_requirements(db, "org-1")
    assert [r.text for r in default] == ["ok"]

    everything = await requirement_service.list_requirements(db, "org-1", status=None)
    assert [r.text for r in everything] == ["ok", "stuck", "bad"]

    failed = await requirement_service.list_requirements(db, "org-1", status="failed")
    assert [(r.text, r.error) for r in failed] == [("bad", "model down")]


# ── HTTP mapping ──────────────────────────────────────────────────────────

async def test_generation_failure_is_502_and_requirement_is_not_listed(app_client, db):
    org_id = await _login(app_client, db)
    with patch(GENERATE, new=AsyncMock(side_effect=ai_service.AIResponseError("no usable test cases"))):
        resp = await app_client.post("/api/requirements", json={"text": REQ_TEXT})
    assert resp.status_code == 502
    assert "no usable test cases" in resp.json()["detail"]

    assert (await db.requirements.find_one({"org_id": org_id}))["status"] == "failed"
    assert (await app_client.get("/api/requirements")).json() == []
    listed = (await app_client.get("/api/requirements", params={"status": "all"})).json()
    assert [r["status"] for r in listed] == ["failed"]


async def test_provider_error_is_502(app_client, db):
    await _login(app_client, db)
    request = httpx.Request("POST", "http://llm.test/v1/chat/completions")
    error = openai.InternalServerError("upstream down", response=httpx.Response(500, request=request), body=None)
    with patch(GENERATE, new=AsyncMock(side_effect=error)):
        resp = await app_client.post("/api/requirements", json={"text": REQ_TEXT})
    assert resp.status_code == 502


async def test_quota_error_is_429_and_marks_failed(app_client, db):
    org_id = await _login(app_client, db)
    with patch(GENERATE, new=AsyncMock(side_effect=ai_service.AIQuotaError("rate limited"))):
        resp = await app_client.post("/api/requirements", json={"text": REQ_TEXT})
    assert resp.status_code == 429
    assert (await db.requirements.find_one({"org_id": org_id}))["status"] == "failed"


async def test_non_list_category_from_the_model_no_longer_breaks_the_request(app_client, db, monkeypatch):
    org_id = await _login(app_client, db)

    async def fake_json(prompt, timeout=None, task_name=None):
        return {"functional": [_case()], "edge": 5, "api": None}

    monkeypatch.setattr(ai_service, "_call_openai_json", fake_json)
    resp = await app_client.post("/api/requirements", json={"text": REQ_TEXT})
    assert resp.status_code == 201
    assert resp.json()["total_tests"] == 1
    assert (await db.requirements.find_one({"org_id": org_id}))["status"] == "processed"


async def test_same_tc_id_in_two_requirements_is_addressed_by_document_id(app_client, db):
    await _login(app_client, db)
    with patch(GENERATE, new=AsyncMock(return_value={"functional": [_case(name="First")]})):
        first = (await app_client.post("/api/requirements", json={"text": REQ_TEXT})).json()
    with patch(GENERATE, new=AsyncMock(return_value={"functional": [_case(name="Second")]})):
        second = (await app_client.post("/api/requirements", json={"text": REQ_TEXT + " again"})).json()

    cases = (await app_client.get("/api/test-cases")).json()
    assert [c["tc_id"] for c in cases] == ["TC-001", "TC-001"]
    by_req = {c["requirement_id"]: c for c in cases}
    for req, name in ((first, "First"), (second, "Second")):
        case = by_req[req["id"]]
        fetched = (await app_client.get(f"/api/test-cases/{case['id']}")).json()
        assert fetched["name"] == name
    # tc_id is not an address: it cannot be used to fetch a case.
    assert (await app_client.get("/api/test-cases/TC-001")).status_code == 404
