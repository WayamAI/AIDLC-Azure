"""Release gate: deterministic scoring/verdict and honest handling of missing signals."""
from unittest.mock import AsyncMock, patch

import pytest

from app.auth.session import create_session_cookie
from app.routes import release_gate
from app.routes.release_gate import evaluate_signals
from app.services import organization_service


def _cookies(app_client, org_id: str, user_id: str = "user") -> None:
    token = create_session_cookie(user_id=user_id, org_id=org_id)
    app_client.cookies.set("aidlc_session", token)


def _runs(*conclusions: str) -> list[dict]:
    return [{"id": i, "conclusion": c} for i, c in enumerate(conclusions)]


# ── evaluate_signals ──────────────────────────────────────────────────────

def test_no_ci_signal_is_insufficient_data_not_a_score():
    result = evaluate_signals(None, [], 0, 10.0)
    assert result["verdict"] == "INSUFFICIENT_DATA"
    assert result["score"] is None
    assert result["scored_signals"] == []


def test_unevaluated_signals_earn_no_points_and_are_not_listed():
    # Only CI was measured: the score is CI's health alone, not CI plus free
    # points for bugs/security/defect risk that nobody looked at.
    result = evaluate_signals(60.0, None, None, None)
    assert result["scored_signals"] == ["test_pass_rate"]
    assert result["score"] == 60
    assert result["verdict"] == "CONDITIONAL"


def test_score_is_weighted_mean_over_evaluated_signals():
    # CI 100% (weight 30, health 1.0) + 5 high bugs (weight 25, health 0.5)
    # = (30 + 12.5) / 55 = 77.27 -> 77
    bugs = [{"key": f"P-{i}", "priority": "High"} for i in range(5)]
    result = evaluate_signals(100.0, bugs, None, None)
    assert result["scored_signals"] == ["test_pass_rate", "open_critical_bugs"]
    assert result["score"] == 77
    assert result["verdict"] == "GO"


def test_all_signals_scored_matches_full_weighting():
    # 30*0.9 + 25*1 + 25*0.6 + 20*0.5 = 77 over total weight 100
    result = evaluate_signals(90.0, [], 2, 50.0)
    assert result["scored_signals"] == [
        "test_pass_rate", "open_critical_bugs", "unresolved_security_findings", "avg_defect_risk",
    ]
    assert result["score"] == 77


@pytest.mark.parametrize(
    "pass_rate, expected",
    [(100.0, "GO"), (75.0, "GO"), (74.0, "CONDITIONAL"), (50.0, "CONDITIONAL")],
)
def test_verdict_thresholds(pass_rate, expected):
    assert evaluate_signals(pass_rate, None, None, None)["verdict"] == expected


def test_low_ci_pass_rate_is_a_blocker():
    result = evaluate_signals(40.0, [], 0, 0.0)
    assert result["verdict"] == "NO-GO"
    assert result["blockers"] and "CI pass rate" in result["blockers"][0]


def test_score_below_threshold_without_blocker_is_no_go():
    # CI is above the blocker floor, but risk signals drag the score under 50.
    result = evaluate_signals(55.0, [{"key": f"P-{i}", "priority": "High"} for i in range(10)], 5, 100.0)
    assert result["blockers"] == []
    assert result["score"] < 50
    assert result["verdict"] == "NO-GO"


def test_blocker_priority_bug_forces_no_go_even_with_high_score():
    result = evaluate_signals(100.0, [{"key": "P-1", "priority": "Blocker"}], 0, 0.0)
    assert result["score"] >= 75
    assert result["verdict"] == "NO-GO"
    assert "P-1" in result["blockers"][0]


def test_conditions_only_reported_for_conditional():
    conditional = evaluate_signals(60.0, [{"key": "P-1", "priority": "High"}], None, None)
    assert conditional["verdict"] == "CONDITIONAL"
    assert conditional["conditions"]
    go = evaluate_signals(100.0, [], None, None)
    assert go["conditions"] == []


# ── /release-gate/evaluate ────────────────────────────────────────────────

@pytest.mark.anyio
async def test_github_failure_returns_insufficient_data_without_calling_ai(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_rg1", name="RG1")
    _cookies(app_client, org.id)
    ai = AsyncMock()
    with patch.object(release_gate.github_service, "get_workflow_runs", new=AsyncMock(side_effect=RuntimeError("404 Not Found"))), \
         patch.object(release_gate, "analyze_release_readiness", new=ai):
        resp = await app_client.post("/api/release-gate/evaluate", json={"owner": "o", "repo": "r"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["score"] is None
    assert body["verdict"]["verdict"] == "INSUFFICIENT_DATA"
    assert "404 Not Found" in body["verdict"]["reason"]
    assert body["signals"]["test_pass_rate"] is None
    assert body["scored_signals"] == []
    assert "confidence" not in body["verdict"]
    ai.assert_not_awaited()


@pytest.mark.anyio
async def test_zero_completed_runs_is_insufficient_data(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_rg2", name="RG2")
    _cookies(app_client, org.id)
    with patch.object(release_gate.github_service, "get_workflow_runs", new=AsyncMock(return_value=_runs(None, "cancelled"))):
        resp = await app_client.post("/api/release-gate/evaluate", json={"owner": "o", "repo": "r"})

    body = resp.json()
    assert body["verdict"]["verdict"] == "INSUFFICIENT_DATA"
    assert body["score"] is None
    assert "test_pass_rate" in body["not_evaluated"]


@pytest.mark.anyio
async def test_unscanned_signals_are_null_and_excluded(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_rg3", name="RG3")
    _cookies(app_client, org.id)
    ai = AsyncMock(return_value={"recommendation": "Ship it."})
    with patch.object(release_gate.github_service, "get_workflow_runs", new=AsyncMock(return_value=_runs("success", "success", "success", "failure"))), \
         patch.object(release_gate, "analyze_release_readiness", new=ai):
        resp = await app_client.post("/api/release-gate/evaluate", json={"owner": "o", "repo": "r"})

    body = resp.json()
    assert body["signals"]["test_pass_rate"] == 75.0
    assert body["signals"]["unresolved_security_findings"] is None
    assert body["signals"]["avg_defect_risk"] is None
    assert body["signals"]["open_critical_bugs"] is None
    assert body["scored_signals"] == ["test_pass_rate"]
    assert set(body["not_evaluated"]) == {"unresolved_security_findings", "avg_defect_risk", "open_critical_bugs"}
    assert body["score"] == 75
    assert body["verdict"]["verdict"] == "GO"
    assert body["verdict"]["recommendation"] == "Ship it."
    # The model is told the verdict; it does not choose it.
    assert ai.await_args.kwargs["verdict"] == "GO"
    assert ai.await_args.kwargs["unresolved_security_findings"] is None


@pytest.mark.anyio
async def test_ai_failure_keeps_deterministic_verdict_with_empty_narrative(app_client, db):
    org = await organization_service.create_organization(db, workos_org_id="org_rg4", name="RG4")
    _cookies(app_client, org.id)
    with patch.object(release_gate.github_service, "get_workflow_runs", new=AsyncMock(return_value=_runs("success", "failure", "failure"))), \
         patch.object(release_gate, "analyze_release_readiness", new=AsyncMock(side_effect=RuntimeError("model down"))), \
         patch.object(release_gate.slack_service, "send_release_blocked", new=AsyncMock(return_value=True)) as slack:
        resp = await app_client.post("/api/release-gate/evaluate", json={"owner": "o", "repo": "r"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["verdict"]["verdict"] == "NO-GO"
    assert body["verdict"]["recommendation"] == ""
    assert body["score"] == 33
    assert any("model down" in e for e in body["errors"])
    slack.assert_awaited_once()
