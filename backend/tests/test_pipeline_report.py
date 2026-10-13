"""Pipeline report: unevaluated signals are null and unscored, never free or zero points."""
from unittest.mock import AsyncMock, patch

import pytest

from app.auth.session import create_session_cookie
from app.routes import pipeline, release_gate
from app.routes.pipeline import evaluate_pipeline_signals
from app.services import organization_service
from app.services.ai_service import AIQuotaError


def _runs(*conclusions: str) -> list[dict]:
    return [{"id": i, "conclusion": c} for i, c in enumerate(conclusions)]


async def _login(app_client, db) -> str:
    org = await organization_service.create_organization(db, workos_org_id="org_a", name="A")
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="user", org_id=org.id))
    return org.id


def _narrative(text: str = "Ship it.") -> AsyncMock:
    return AsyncMock(return_value={"recommendation": text})


# ── evaluate_pipeline_signals ─────────────────────────────────────────────

def test_no_ci_and_no_live_results_is_insufficient_data():
    result = evaluate_pipeline_signals(None, None, "GO", [], 0)
    assert result["verdict"] == "INSUFFICIENT_DATA"
    assert result["score"] is None
    assert result["scored_signals"] == []


def test_unevaluated_signals_earn_no_points():
    # Only CI was measured. Bugs/security/review that nobody looked at add nothing.
    result = evaluate_pipeline_signals(60.0, None, None, None, None)
    assert result["scored_signals"] == ["ci_pass_rate"]
    assert result["score"] == 60
    assert result["verdict"] == "CONDITIONAL"


def test_live_results_alone_are_enough_to_score():
    result = evaluate_pipeline_signals(None, 90.0, None, None, None)
    assert result["scored_signals"] == ["live_test_pass_rate"]
    assert result["score"] == 90
    assert result["verdict"] == "GO"


def test_score_is_weighted_mean_over_evaluated_signals():
    # CI 80 (w25) + live 100 (w35) + review CONDITIONAL 0.5 (w20) + 5 bugs 0.5 (w10) + 1 finding 0.8 (w10)
    # = 20 + 35 + 10 + 5 + 8 = 78 over total weight 100
    bugs = [{"key": f"P-{i}", "priority": "High"} for i in range(5)]
    result = evaluate_pipeline_signals(80.0, 100.0, "CONDITIONAL", bugs, 1)
    assert result["scored_signals"] == list(pipeline.PIPELINE_SIGNAL_WEIGHTS)
    assert result["score"] == 78
    assert result["verdict"] == "GO"


def test_thresholds_are_the_release_gates():
    assert evaluate_pipeline_signals(float(release_gate.GO_MIN_SCORE), None, None, None, None)["verdict"] == "GO"
    just_below = evaluate_pipeline_signals(release_gate.GO_MIN_SCORE - 1.0, None, None, None, None)
    assert just_below["verdict"] == "CONDITIONAL"
    low = evaluate_pipeline_signals(None, release_gate.CONDITIONAL_MIN_SCORE - 1.0, None, None, None)
    assert low["verdict"] == "NO-GO"


def test_ci_below_minimum_and_blocker_bugs_block():
    result = evaluate_pipeline_signals(release_gate.MIN_CI_PASS_RATE - 10, 100.0, "GO", [], 0)
    assert result["verdict"] == "NO-GO"
    assert "CI pass rate" in result["blockers"][0]

    bugs = [{"key": "P-1", "priority": "Blocker"}]
    result = evaluate_pipeline_signals(100.0, 100.0, "GO", bugs, 0)
    assert result["verdict"] == "NO-GO"
    assert "P-1" in result["blockers"][0]


def test_unrecognised_review_verdict_is_not_scored():
    result = evaluate_pipeline_signals(100.0, None, "LOOKS FINE", None, None)
    assert result["scored_signals"] == ["ci_pass_rate"]


# ── POST /pipeline/report ─────────────────────────────────────────────────

async def test_failed_github_fetch_is_not_scored_as_zero_percent(app_client, db):
    await _login(app_client, db)
    ai = _narrative()
    with patch.object(pipeline.github_service, "get_workflow_runs", new=AsyncMock(side_effect=RuntimeError("404 Not Found"))), \
         patch.object(pipeline, "analyze_release_readiness", new=ai):
        resp = await app_client.post("/api/pipeline/report", json={
            "owner": "acme", "repo": "app",
            "live_test_passed": 9, "live_test_failed": 1, "live_test_total": 10,
            "review_recommendation": "GO", "review_critical_count": 0,
        })
    assert resp.status_code == 200
    data = resp.json()
    assert data["signals"]["ci_pass_rate"] is None
    assert "GitHub CI fetch failed" in data["not_evaluated"]["ci_pass_rate"]
    assert "ci_pass_rate" not in data["scored_signals"]
    # live 90 (w35) + review GO (w20) + 0 findings (w10) = (31.5 + 20 + 10) / 65 = 94.6
    assert data["score"] == 95
    assert data["verdict"]["verdict"] == "GO"
    assert any("GitHub CI fetch failed" in e for e in data["errors"])


async def _report_with_review(app_client, review_recommendation):
    """CI at 50% (one success, one failure) plus the given review verdict."""
    with patch.object(pipeline.github_service, "get_workflow_runs", new=AsyncMock(return_value=_runs("success", "failure"))), \
         patch.object(pipeline, "analyze_release_readiness", new=_narrative()):
        return await app_client.post("/api/pipeline/report", json={
            "owner": "acme", "repo": "app", "review_recommendation": review_recommendation,
        })


@pytest.mark.parametrize(
    "sent, reported, score",
    [
        # CI 50 (w25) + review health (w20), over weight 45
        ("APPROVE", "APPROVE", 72),                  # (12.5 + 20) / 45
        ("COMMENT", "COMMENT", 50),                  # (12.5 + 10) / 45
        ("REQUEST_CHANGES", "REQUEST_CHANGES", 28),  # (12.5 + 0) / 45
        ("request_changes", "REQUEST_CHANGES", 28),
        # the older vocabulary still works and scores the same
        ("GO", "GO", 72),
        ("CONDITIONAL", "CONDITIONAL", 50),
        ("NO-GO", "NO-GO", 28),
        ("NO_GO", "NO-GO", 28),
    ],
)
async def test_review_verdicts_are_accepted_natively(app_client, db, sent, reported, score):
    await _login(app_client, db)
    resp = await _report_with_review(app_client, sent)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["signals"]["review_recommendation"] == reported
    assert "review_recommendation" in data["scored_signals"]
    assert "review_recommendation" not in data["not_evaluated"]
    assert data["score"] == score


async def test_incomplete_review_is_reported_as_not_evaluated_not_as_pass_or_fail(app_client, db):
    org_id = await _login(app_client, db)
    resp = await _report_with_review(app_client, "INCOMPLETE")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["signals"]["review_recommendation"] == "INCOMPLETE"
    assert data["not_evaluated"]["review_recommendation"] == pipeline.REVIEW_INCOMPLETE_REASON
    # Scored exactly as if no review had been supplied: CI alone.
    assert data["scored_signals"] == ["ci_pass_rate"]
    assert data["score"] == 50

    stored = await db.pipeline_runs.find_one({"org_id": org_id})
    assert stored["signals"]["review_recommendation"] == "INCOMPLETE"

    absent = (await _report_with_review(app_client, None)).json()
    assert absent["signals"]["review_recommendation"] is None
    assert absent["not_evaluated"]["review_recommendation"] == "No code review verdict was provided"
    assert absent["score"] == data["score"]


async def test_needs_discussion_review_is_reported_but_not_scored(app_client, db):
    # The review model can also answer NEEDS_DISCUSSION: no pass/fail verdict, so no points either way.
    await _login(app_client, db)
    resp = await _report_with_review(app_client, "NEEDS_DISCUSSION")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["signals"]["review_recommendation"] == "NEEDS_DISCUSSION"
    assert "gave no pass/fail verdict" in data["not_evaluated"]["review_recommendation"]
    assert data["scored_signals"] == ["ci_pass_rate"]
    assert data["score"] == 50


@pytest.mark.parametrize("bad", ["LOOKS FINE", "APPROVED", "PASS", 1, True, ["APPROVE"]])
async def test_invalid_review_verdict_is_a_clear_422(app_client, db, bad):
    org_id = await _login(app_client, db)
    ai = _narrative()
    with patch.object(pipeline.github_service, "get_workflow_runs", new=AsyncMock(return_value=_runs("success"))), \
         patch.object(pipeline, "analyze_release_readiness", new=ai):
        resp = await app_client.post("/api/pipeline/report", json={
            "owner": "acme", "repo": "app", "review_recommendation": bad,
        })
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert isinstance(detail, str)
    assert detail.startswith("review_recommendation must be one of APPROVE, REQUEST_CHANGES, COMMENT, INCOMPLETE, ")
    assert detail.count("GO, CONDITIONAL, NO-GO") == 1
    assert repr(bad) in detail
    ai.assert_not_awaited()
    assert await db.pipeline_runs.find_one({"org_id": org_id}) is None


def test_review_vocabularies_share_one_normalisation():
    assert pipeline.normalise_review_verdict(None) is None
    assert pipeline.normalise_review_verdict("  ") is None
    assert pipeline.normalise_review_verdict("approve") == ("APPROVE", 1.0)
    assert pipeline.normalise_review_verdict("INCOMPLETE") == ("INCOMPLETE", None)
    for native, legacy in (("APPROVE", "GO"), ("COMMENT", "CONDITIONAL"), ("REQUEST_CHANGES", "NO-GO")):
        assert pipeline.normalise_review_verdict(native)[1] == pipeline.normalise_review_verdict(legacy)[1]
    # INCOMPLETE earns nothing in the scorer either.
    assert evaluate_pipeline_signals(100.0, None, "INCOMPLETE", None, None)["scored_signals"] == ["ci_pass_rate"]


async def test_no_ci_and_no_live_results_returns_insufficient_data_without_calling_the_model(app_client, db):
    org_id = await _login(app_client, db)
    ai = _narrative()
    with patch.object(pipeline.github_service, "get_workflow_runs", new=AsyncMock(side_effect=RuntimeError("404 Not Found"))), \
         patch.object(pipeline, "analyze_release_readiness", new=ai):
        resp = await app_client.post("/api/pipeline/report", json={"owner": "acme", "repo": "app"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["score"] is None
    assert data["verdict"]["verdict"] == "INSUFFICIENT_DATA"
    assert "404 Not Found" in data["verdict"]["reason"]
    assert data["scored_signals"] == []
    assert set(data["not_evaluated"]) == {
        "ci_pass_rate", "live_test_pass_rate", "review_recommendation",
        "unresolved_security_findings", "open_critical_bugs",
    }
    ai.assert_not_awaited()

    stored = await db.pipeline_runs.find_one({"org_id": org_id})
    assert stored["verdict"] == "INSUFFICIENT_DATA"
    assert stored["score"] is None


async def test_repo_without_completed_runs_has_no_ci_signal(app_client, db):
    await _login(app_client, db)
    with patch.object(pipeline.github_service, "get_workflow_runs", new=AsyncMock(return_value=_runs(None, "cancelled"))):
        resp = await app_client.post("/api/pipeline/report", json={"owner": "acme", "repo": "app"})
    data = resp.json()
    assert data["signals"]["ci_pass_rate"] is None
    assert "No completed CI runs" in data["not_evaluated"]["ci_pass_rate"]
    assert data["verdict"]["verdict"] == "INSUFFICIENT_DATA"


async def test_bugs_are_not_scored_when_jira_is_not_queried(app_client, db):
    await _login(app_client, db)
    jira = AsyncMock()
    with patch.object(pipeline.github_service, "get_workflow_runs", new=AsyncMock(return_value=_runs("success", "failure"))), \
         patch.object(pipeline.jira_service, "get_open_bugs", new=jira), \
         patch.object(pipeline, "analyze_release_readiness", new=_narrative()):
        resp = await app_client.post("/api/pipeline/report", json={"owner": "acme", "repo": "app"})
    data = resp.json()
    jira.assert_not_awaited()
    assert data["signals"]["open_critical_bugs"] is None
    assert data["signals"]["open_critical_bug_count"] is None
    assert data["not_evaluated"]["open_critical_bugs"] == "No Jira project key was provided"
    # CI 50% is the only evaluated signal: no free points lift it.
    assert data["scored_signals"] == ["ci_pass_rate"]
    assert data["score"] == 50
    assert data["verdict"]["verdict"] == "CONDITIONAL"


async def test_failed_jira_fetch_is_not_scored_as_zero_bugs(app_client, db):
    await _login(app_client, db)
    with patch.object(pipeline.github_service, "get_workflow_runs", new=AsyncMock(return_value=_runs("success"))), \
         patch.object(pipeline.jira_service, "get_open_bugs", new=AsyncMock(side_effect=RuntimeError("503 not configured"))), \
         patch.object(pipeline, "analyze_release_readiness", new=_narrative()):
        resp = await app_client.post("/api/pipeline/report", json={"owner": "acme", "repo": "app", "jira_project": "P"})
    data = resp.json()
    assert data["signals"]["open_critical_bugs"] is None
    assert "Jira fetch failed" in data["not_evaluated"]["open_critical_bugs"]
    assert "open_critical_bugs" not in data["scored_signals"]


async def test_all_signals_evaluated_keeps_the_existing_response_fields(app_client, db):
    org_id = await _login(app_client, db)
    bugs = [
        {"key": "P-1", "priority": "High", "summary": "s"},
        {"key": "P-2", "priority": "Low", "summary": "s"},
    ]
    ai = _narrative("Looks good.")
    with patch.object(pipeline.github_service, "get_workflow_runs", new=AsyncMock(return_value=_runs("success", "success", "success", "failure"))), \
         patch.object(pipeline.jira_service, "get_open_bugs", new=AsyncMock(return_value=bugs)), \
         patch.object(pipeline, "analyze_release_readiness", new=ai):
        resp = await app_client.post("/api/pipeline/report", json={
            "owner": "acme", "repo": "app", "version": "1.2.0", "commit_sha": "abc", "jira_project": "P",
            "live_test_passed": 10, "live_test_failed": 0, "live_test_total": 10,
            "review_recommendation": "GO", "review_critical_count": 0,
        })
    assert resp.status_code == 200
    data = resp.json()
    assert set(data) >= {"pipeline_run_id", "version", "commit_sha", "score", "verdict", "signals", "errors"}
    assert set(data["verdict"]) >= {"verdict", "primary_blocker", "recommendation", "conditions"}
    signals = data["signals"]
    assert signals["ci_pass_rate"] == 75.0
    assert signals["live_test_pass_rate"] == 100.0
    assert (signals["live_test_passed"], signals["live_test_failed"], signals["live_test_total"]) == (10, 0, 10)
    assert signals["review_recommendation"] == "GO"
    assert signals["review_critical_findings"] == 0
    assert [b["key"] for b in signals["open_critical_bugs"]] == ["P-1"]
    assert signals["open_critical_bug_count"] == 1
    assert signals["workflow_summary"] == {"total_runs": 4, "recent_evaluated": 4}
    # 25*0.75 + 35*1 + 20*1 + 10*0.9 + 10*1 = 92.75
    assert data["score"] == 93
    assert data["verdict"]["verdict"] == "GO"
    assert data["verdict"]["recommendation"] == "Looks good."
    assert data["not_evaluated"] == {}
    assert data["scored_signals"] == list(pipeline.PIPELINE_SIGNAL_WEIGHTS)
    assert ai.await_args.kwargs["verdict"] == "GO"

    runs = (await app_client.get("/api/pipeline/runs")).json()
    assert [(r["id"], r["score"], r["verdict"]) for r in runs] == [(data["pipeline_run_id"], 93, "GO")]
    assert (await db.pipeline_runs.find_one({"org_id": org_id}))["not_evaluated"] == {}


async def test_ai_quota_is_429_and_other_ai_failures_keep_the_verdict(app_client, db):
    await _login(app_client, db)
    body = {"owner": "acme", "repo": "app"}
    with patch.object(pipeline.github_service, "get_workflow_runs", new=AsyncMock(return_value=_runs("success"))), \
         patch.object(pipeline, "analyze_release_readiness", new=AsyncMock(side_effect=AIQuotaError("slow down"))):
        assert (await app_client.post("/api/pipeline/report", json=body)).status_code == 429

    with patch.object(pipeline.github_service, "get_workflow_runs", new=AsyncMock(return_value=_runs("success"))), \
         patch.object(pipeline, "analyze_release_readiness", new=AsyncMock(side_effect=RuntimeError("model down"))):
        resp = await app_client.post("/api/pipeline/report", json=body)
    data = resp.json()
    assert resp.status_code == 200
    assert data["verdict"]["verdict"] == "GO"
    assert data["verdict"]["recommendation"] == ""
    assert any("AI recommendation unavailable" in e for e in data["errors"])


async def test_runs_are_listed_newest_first(app_client, db):
    org_id = await _login(app_client, db)
    await db.pipeline_runs.insert_many([
        {"_id": "zzz", "org_id": org_id, "score": 1, "verdict": "GO", "created_at": "2026-01-01T00:00:00+00:00"},
        {"_id": "aaa", "org_id": org_id, "score": 2, "verdict": "GO", "created_at": "2026-03-01T00:00:00+00:00"},
        {"_id": "mmm", "org_id": org_id, "score": 3, "verdict": "GO", "created_at": "2026-02-01T00:00:00+00:00"},
    ])
    runs = (await app_client.get("/api/pipeline/runs")).json()
    assert [r["id"] for r in runs] == ["aaa", "mmm", "zzz"]
