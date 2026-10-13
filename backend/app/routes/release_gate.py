"""
Release Gate routes.
Aggregates signals from GitHub + Jira and produces a go/no-go verdict.
"""
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from app.auth.dependencies import get_current_org
from app.database import get_db
from app.models.organization import OrganizationOut
from app.services import ci_metrics_service, github_service, jira_service
from app.services.ai_service import analyze_release_readiness
from app.services import slack_service

router = APIRouter(prefix="/release-gate", tags=["Release Gate"])


# ── Scoring and verdict rules ────────────────────────────────────────────────
# Each evaluated signal has a health in [0, 1] and a weight. The score is the
# weighted mean of the evaluated signals' health, scaled to 0-100. A signal that
# was not evaluated (None) contributes neither points nor weight.
#
#   test_pass_rate               health = rate / 100
#   open_critical_bugs           health = 1 - count / 10   (floor 0)
#   unresolved_security_findings health = 1 - count / 5    (floor 0)
#   avg_defect_risk              health = 1 - risk / 100   (floor 0)
#
# Verdict, in order:
#   INSUFFICIENT_DATA  no CI signal (test_pass_rate was not evaluated)
#   NO-GO              any blocker, or score < CONDITIONAL_MIN_SCORE
#   GO                 score >= GO_MIN_SCORE
#   CONDITIONAL        otherwise
#
# Blockers: CI pass rate below MIN_CI_PASS_RATE; any open bug whose priority is
# in BLOCKER_PRIORITIES.
SIGNAL_WEIGHTS: dict[str, int] = {
    "test_pass_rate": 30,
    "open_critical_bugs": 25,
    "unresolved_security_findings": 25,
    "avg_defect_risk": 20,
}
GO_MIN_SCORE = 75
CONDITIONAL_MIN_SCORE = 50
MIN_CI_PASS_RATE = 50.0
BLOCKER_PRIORITIES = ("Blocker", "Critical", "Highest")
# Jira priorities counted as the "open critical bugs" signal.
CRITICAL_BUG_PRIORITIES = BLOCKER_PRIORITIES + ("High",)


def evaluate_signals(
    test_pass_rate: float | None,
    open_critical_bugs: list[dict] | None,
    unresolved_security: int | None,
    avg_defect_risk: float | None,
) -> dict[str, Any]:
    """Score the evaluated signals and derive the verdict. Pure; no I/O."""
    health: dict[str, float] = {}
    if test_pass_rate is not None:
        health["test_pass_rate"] = min(1.0, max(0.0, test_pass_rate / 100))
    if open_critical_bugs is not None:
        health["open_critical_bugs"] = max(0.0, 1 - len(open_critical_bugs) / 10)
    if unresolved_security is not None:
        health["unresolved_security_findings"] = max(0.0, 1 - unresolved_security / 5)
    if avg_defect_risk is not None:
        health["avg_defect_risk"] = min(1.0, max(0.0, 1 - avg_defect_risk / 100))

    scored_signals = [name for name in SIGNAL_WEIGHTS if name in health]

    if test_pass_rate is None:
        return {
            "score": None,
            "verdict": "INSUFFICIENT_DATA",
            "reason": "No CI signal: a release cannot be scored without completed CI runs.",
            "blockers": [],
            "conditions": [],
            "scored_signals": [],
        }

    total_weight = sum(SIGNAL_WEIGHTS[name] for name in scored_signals)
    score = round(sum(SIGNAL_WEIGHTS[name] * health[name] for name in scored_signals) / total_weight * 100)

    blockers: list[str] = []
    conditions: list[str] = []
    if test_pass_rate < MIN_CI_PASS_RATE:
        blockers.append(f"CI pass rate is {test_pass_rate:.1f}%, below the {MIN_CI_PASS_RATE:.0f}% minimum")
    elif test_pass_rate < 100:
        conditions.append(f"Investigate the failing CI runs (pass rate {test_pass_rate:.1f}%)")

    blocker_bugs = [b for b in (open_critical_bugs or []) if b.get("priority") in BLOCKER_PRIORITIES]
    other_bugs = len(open_critical_bugs or []) - len(blocker_bugs)
    if blocker_bugs:
        keys = ", ".join(str(b.get("key", "?")) for b in blocker_bugs[:5])
        blockers.append(f"{len(blocker_bugs)} open blocker/critical bug(s): {keys}")
    if other_bugs:
        conditions.append(f"Resolve or defer {other_bugs} open high-priority bug(s)")
    if unresolved_security:
        conditions.append(f"Resolve {unresolved_security} unresolved security finding(s)")

    if blockers:
        verdict, reason = "NO-GO", blockers[0]
    elif score < CONDITIONAL_MIN_SCORE:
        verdict, reason = "NO-GO", f"Score {score} is below the NO-GO threshold of {CONDITIONAL_MIN_SCORE}"
    elif score >= GO_MIN_SCORE:
        verdict, reason = "GO", f"Score {score} meets the GO threshold of {GO_MIN_SCORE} with no blockers"
    else:
        verdict, reason = "CONDITIONAL", f"Score {score} is between {CONDITIONAL_MIN_SCORE} and {GO_MIN_SCORE}"

    return {
        "score": score,
        "verdict": verdict,
        "reason": reason,
        "blockers": blockers,
        "conditions": conditions if verdict == "CONDITIONAL" else [],
        "scored_signals": scored_signals,
    }


@router.post("/evaluate")
async def evaluate_release(
    body: dict = Body(...),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """
    Evaluate release readiness.

    Body:
      version: str
      owner: str  (GitHub owner)
      repo: str
      jira_project: str
      branch: str (optional)
      refresh: bool (optional, bypass the GitHub cache)

    Signals that could not be evaluated are returned as null and listed in
    `not_evaluated` with the reason; `scored_signals` lists what the score used.
    """
    version = body.get("version", "HEAD")
    owner = body.get("owner", "")
    repo = body.get("repo", "")
    jira_project = body.get("jira_project", "")

    if not owner or not repo:
        raise HTTPException(status_code=400, detail="owner and repo are required")

    signals: dict = {
        "test_pass_rate": None,
        "open_critical_bugs": None,
        "open_critical_bug_count": None,
        "unresolved_security_findings": None,
        "avg_defect_risk": None,
        "high_risk_files": None,
        "workflow_summary": {},
    }
    not_evaluated: dict[str, str] = {
        "unresolved_security_findings": "No security scanner is connected to the release gate",
        "avg_defect_risk": "Defect prediction is not connected to the release gate",
    }
    errors = []

    # 1. GitHub workflow runs → test pass rate
    cache = None
    try:
        runs, cache = await ci_metrics_service.get_workflow_runs(
            db, org.id, owner, repo, refresh=bool(body.get("refresh"))
        )
        ci = ci_metrics_service.headline(runs)
        signals["test_pass_rate"] = ci["pass_rate"]
        if ci["pass_rate"] is None:
            not_evaluated["test_pass_rate"] = (
                f"No completed CI runs among the {ci['total_runs']} most recent workflow runs"
                if runs else "The repository has no workflow runs"
            )
        signals["workflow_summary"] = {
            "total_runs": ci["total_runs"],
            "recent_evaluated": ci["evaluated_runs"],
        }
    except github_service.GitHubRateLimitError:
        raise
    except Exception as exc:
        errors.append(f"GitHub workflow fetch failed: {exc}")
        not_evaluated["test_pass_rate"] = f"GitHub workflow fetch failed: {exc}"

    # 2. Jira open critical/high bugs
    all_critical_bugs: list[dict] | None = None
    if jira_project:
        try:
            bugs = await jira_service.get_open_bugs(jira_project, version if version != "HEAD" else None)
            all_critical_bugs = [b for b in bugs if b["priority"] in CRITICAL_BUG_PRIORITIES]
            signals["open_critical_bugs"] = all_critical_bugs[:10]
            signals["open_critical_bug_count"] = len(all_critical_bugs)
        except Exception as exc:
            errors.append(f"Jira fetch failed: {exc}")
            not_evaluated["open_critical_bugs"] = f"Jira fetch failed: {exc}"
    else:
        not_evaluated["open_critical_bugs"] = "No Jira project key was provided"

    # 3. Score + verdict (deterministic)
    result = evaluate_signals(
        test_pass_rate=signals["test_pass_rate"],
        open_critical_bugs=all_critical_bugs,
        unresolved_security=signals["unresolved_security_findings"],
        avg_defect_risk=signals["avg_defect_risk"],
    )
    score = result["score"]
    verdict = result["verdict"]
    reason = result["reason"]
    if verdict == "INSUFFICIENT_DATA":
        reason = f"No CI signal: {not_evaluated['test_pass_rate']}"

    # 4. AI narrative only; the verdict above stands whether or not this succeeds
    recommendation = ""
    if verdict != "INSUFFICIENT_DATA":
        try:
            narrative = await analyze_release_readiness(
                version=version,
                test_pass_rate=signals["test_pass_rate"],
                open_critical_bugs=all_critical_bugs,
                unresolved_security_findings=signals["unresolved_security_findings"],
                high_risk_files=signals["high_risk_files"],
                score=score,
                verdict=verdict,
                blockers=result["blockers"],
            )
            recommendation = narrative.get("recommendation", "")
        except Exception as exc:
            errors.append(f"AI recommendation unavailable: {exc}")

    # 5. Notify Slack if blocked
    if verdict == "NO-GO":
        try:
            await slack_service.send_release_blocked(
                version=version,
                reason=reason,
                score=score,
            )
        except Exception:
            pass

    return {
        "version": version,
        "score": score,
        "verdict": {
            "verdict": verdict,
            "reason": reason,
            "primary_blocker": result["blockers"][0] if result["blockers"] else None,
            "blockers": result["blockers"],
            "recommendation": recommendation,
            "conditions": result["conditions"],
        },
        "signals": signals,
        "scored_signals": result["scored_signals"],
        "not_evaluated": not_evaluated,
        "errors": errors,
        "cache": cache,
    }
