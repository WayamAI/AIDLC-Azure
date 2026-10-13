"""Typed service errors reach the client with the right status, from the app-level handlers."""
import asyncio
from unittest.mock import AsyncMock, patch

import httpx
import openai
import pytest

from app.auth.session import create_session_cookie
from app.services import ai_service, jira_service, organization_service
from app.services.impact_service import AIGenerationError

STORIES = [
    {"key": f"P-{n}", "summary": f"Story {n}", "description": "d", "priority": "High"} for n in range(1, 6)
]


@pytest.fixture
async def client(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_e", name="E")
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="u", org_id=org.id))
    return app_client


def _provider_error() -> openai.APIError:
    request = httpx.Request("POST", "http://llm.test/v1/chat/completions")
    return openai.InternalServerError("upstream down", response=httpx.Response(500, request=request), body=None)


@pytest.mark.parametrize("error,status", [
    (ai_service.AIQuotaError("rate limited"), 429),
    (ai_service.AIResponseError("The AI model did not return valid JSON: x"), 502),
    (_provider_error(), 502),
])
async def test_llm_failures_map_to_429_and_502_on_routes_without_their_own_handling(client, error, status):
    body = {"summary": "As a user I can reset my password"}
    with patch("app.routes.jira.generate_acceptance_criteria", new=AsyncMock(side_effect=error)):
        assert (await client.post("/api/jira/analyze-manual", json=body)).status_code == status
    with patch("app.routes.prd.prd_service.generate_prd", new=AsyncMock(side_effect=error)):
        resp = await client.post("/api/prd/generate", json={"product_name": "P", "description": "D"})
        assert resp.status_code == status
    with patch("app.routes.copilot.copilot_service.explain_code", new=AsyncMock(side_effect=error)):
        resp = await client.post(
            "/api/copilot/explain", json={"workspace_id": "w", "file_path": "a.py", "content": "x = 1"}
        )
        assert resp.status_code == status


async def test_unusable_ai_output_for_generated_tests_is_502(client):
    with patch("app.routes.impact.impact_service.generate_tests_from_scenarios",
               new=AsyncMock(side_effect=AIGenerationError("The AI response contained no JSON array."))):
        resp = await client.post("/api/impact/generate-from-docs", json={"scenarios": [], "framework": "playwright"})
    assert resp.status_code == 502
    assert "no JSON array" in resp.json()["detail"]


async def test_malformed_json_from_the_model_is_an_ai_response_error_not_a_value_error(monkeypatch):
    async def garbage(*_a, **_k):
        return "Sure! Here is what I think {not json"

    monkeypatch.setattr(ai_service, "_call_openai", garbage)
    with pytest.raises(ai_service.AIResponseError, match="valid JSON"):
        await ai_service.explain_ci_failure("step", "err", "trace", "Python")
    with pytest.raises(ai_service.AIResponseError):
        await ai_service.generate_requirement_based_data("requirement text", 3)

    async def a_list(*_a, **_k):
        return "[1, 2, 3]"

    monkeypatch.setattr(ai_service, "_call_openai", a_list)
    with pytest.raises(ai_service.AIResponseError, match="JSON object"):
        await ai_service.investigate_incident({}, [], [], [])


async def test_jira_not_configured_is_503_with_what_to_do(client):
    with patch.object(jira_service.connectors, "active", return_value={}):
        for path in ("/api/jira/projects", "/api/jira/stories?project=P", "/api/jira/bugs?project=P"):
            resp = await client.get(path)
            assert resp.status_code == 503, path
            assert "Settings" in resp.json()["detail"]
        resp = await client.post("/api/jira/analyze-sprint", json={"project": "P"})
        assert resp.status_code == 503


async def test_jira_upstream_failure_is_502_naming_the_host(client):
    request = httpx.Request("GET", "https://acme.atlassian.net/rest/api/3/project/search")
    error = httpx.HTTPStatusError("401", request=request, response=httpx.Response(401, request=request))
    with patch("app.routes.jira.jira_service.list_projects", new=AsyncMock(side_effect=error)):
        resp = await client.get("/api/jira/projects")
    assert resp.status_code == 502
    assert resp.json()["detail"] == "acme.atlassian.net returned HTTP 401"


async def test_missing_story_is_still_404(client):
    with patch("app.routes.jira.jira_service.get_sprint_stories", new=AsyncMock(return_value=STORIES)):
        resp = await client.post("/api/jira/stories/P-99/generate-ac", json={})
    assert resp.status_code == 404


async def test_vercel_not_configured_is_503(client):
    with patch("app.services.vercel_service._vercel_cfg", return_value={}):
        resp = await client.get("/api/deployments/dpl_123/status")
    assert resp.status_code == 503
    assert "VERCEL_TOKEN" in resp.json()["detail"]


async def test_bad_ids_are_404_not_500(client):
    assert (await client.delete("/api/copilot/snippets/not-an-object-id")).status_code == 404
    resp = await client.post("/api/synthetic-data/preview", json={"requirement_id": "nope", "count": 5})
    assert resp.status_code == 404


# ── sprint story analysis ─────────────────────────────────────────────────

async def test_sprint_stories_are_analysed_concurrently_and_failures_carry_their_reason(client):
    in_flight = {"now": 0, "peak": 0}

    async def analyse(story, existing):
        in_flight["now"] += 1
        in_flight["peak"] = max(in_flight["peak"], in_flight["now"])
        await asyncio.sleep(0.02)
        in_flight["now"] -= 1
        if story["key"] == "P-2":
            raise ai_service.AIResponseError("The AI model did not return valid JSON")
        return {"risk_score": 40, "story": story["key"], "others": len(existing)}

    with patch("app.routes.jira.jira_service.get_sprint_stories", new=AsyncMock(return_value=STORIES)), \
         patch("app.routes.jira.generate_acceptance_criteria", new=analyse):
        resp = await client.post("/api/jira/analyze-sprint", json={"project": "P"})

    assert resp.status_code == 200
    body = resp.json()
    assert in_flight["peak"] > 1
    assert [s["story"]["key"] for s in body["stories"]] == [s["key"] for s in STORIES]  # order kept
    assert (body["total"], body["failed"]) == (5, 1)
    failed = body["stories"][1]
    assert failed["ai_analysis"] is None and "did not return valid JSON" in failed["error"]
    assert body["stories"][0]["ai_analysis"] == {"risk_score": 40, "story": "P-1", "others": 4}


async def test_sprint_analysis_is_429_when_every_story_hit_the_quota(client):
    with patch("app.routes.jira.jira_service.get_sprint_stories", new=AsyncMock(return_value=STORIES)), \
         patch("app.routes.jira.generate_acceptance_criteria",
               new=AsyncMock(side_effect=ai_service.AIQuotaError("rate limited"))):
        resp = await client.post("/api/jira/analyze-sprint", json={"project": "P"})
    assert resp.status_code == 429


async def test_rejected_jira_bug_query_is_an_error_not_zero_open_bugs():
    request = httpx.Request("POST", "https://acme.atlassian.net/rest/api/3/search/jql")
    rejected = httpx.HTTPStatusError("400", request=request, response=httpx.Response(400, request=request))
    with patch.object(jira_service, "_search", new=AsyncMock(side_effect=rejected)):
        with pytest.raises(httpx.HTTPStatusError):
            await jira_service.get_open_bugs("PROJ", "v9.9-not-in-jira")


def test_github_errors_are_described_for_people_not_as_api_paths():
    from app.services.github_service import describe_github_error

    logs = describe_github_error(403, "/repos/o/r/actions/runs/7/logs", "Must have admin rights to Repository.", False)
    assert "Settings → Connectors" in logs and "o/r" in logs
    assert "/repos/" not in logs and "403" not in logs

    missing = describe_github_error(404, "/repos/o/nope/actions/runs", "Not Found", False)
    assert "o/nope" in missing and "private" in missing and "/repos/" not in missing

    with_token = describe_github_error(404, "/repos/o/nope", "Not Found", True)
    assert "token has no access" in with_token

    assert "Try again" in describe_github_error(502, "/repos/o/r", "", True)
