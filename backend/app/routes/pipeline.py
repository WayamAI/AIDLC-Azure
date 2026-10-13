"""
Pipeline report route.
Aggregates CI + live test results + code review verdict into a single GO/NO-GO.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Body, Depends
from app.auth.dependencies import get_current_org
from app.models.organization import OrganizationOut
from app.routes.release_gate import (
    BLOCKER_PRIORITIES,
    CONDITIONAL_MIN_SCORE,
    CRITICAL_BUG_PRIORITIES,
    GO_MIN_SCORE,
    MIN_CI_PASS_RATE,
)
from app.services import ci_metrics_service, github_service, jira_service
from app.services.ai_service import analyze_release_readiness, AIQuotaError
from app.database import get_db

router = APIRouter(prefix="/pipeline", tags=["Pipeline"])
log = logging.getLogger("pipeline")


# ── Scoring and verdict rules ────────────────────────────────────────────────
# Same rule as the release gate (app.routes.release_gate), whose thresholds are
# reused: the score is the weighted mean of the evaluated signals' health,
# scaled to 0-100. A signal that was not evaluated (None) contributes neither
# points nor weight.
#
#   ci_pass_rate                 health = rate / 100
#   live_test_pass_rate          health = rate / 100
#   review_recommendation        health = 1 (APPROVE / GO), 0.5 (COMMENT / CONDITIONAL),
#                                0 (REQUEST_CHANGES / NO-GO); INCOMPLETE is not evaluated
#   open_critical_bugs           health = 1 - count / 10   (floor 0)
#   unresolved_security_findings health = 1 - count / 5    (floor 0)
#
# Verdict, in order:
#   INSUFFICIENT_DATA  neither a CI signal nor live-test results
#   NO-GO              any blocker, or score < CONDITIONAL_MIN_SCORE
#   GO                 score >= GO_MIN_SCORE
#   CONDITIONAL        otherwise
PIPELINE_SIGNAL_WEIGHTS: dict[str, int] = {
    "ci_pass_rate": 25,
    "live_test_pass_rate": 35,
    "review_recommendation": 20,
    "open_critical_bugs": 10,
    "unresolved_security_findings": 10,
}
# Every review verdict the report accepts, as (canonical spelling, health). The
# code-review stage's vocabulary and the older release vocabulary are both
# accepted and reported back in the vocabulary they arrived in. INCOMPLETE and
# NEEDS_DISCUSSION have no health: the review gave no pass/fail verdict, so
# they are reported and left out of the score.
_REVIEW_VERDICTS: dict[str, tuple[str, float | None]] = {
    "APPROVE": ("APPROVE", 1.0),
    "COMMENT": ("COMMENT", 0.5),
    "REQUEST_CHANGES": ("REQUEST_CHANGES", 0.0),
    "INCOMPLETE": ("INCOMPLETE", None),
    "NEEDS_DISCUSSION": ("NEEDS_DISCUSSION", None),
    "GO": ("GO", 1.0),
    "CONDITIONAL": ("CONDITIONAL", 0.5),
    "NO_GO": ("NO-GO", 0.0),
    "NOGO": ("NO-GO", 0.0),
}
ACCEPTED_REVIEW_VERDICTS = (
    "APPROVE", "REQUEST_CHANGES", "COMMENT", "INCOMPLETE", "NEEDS_DISCUSSION", "GO", "CONDITIONAL", "NO-GO",
)
REVIEW_INCOMPLETE_REASON = "The code review was incomplete, so its verdict was not evaluated"
REVIEW_NOT_SCORED_REASONS = {
    "INCOMPLETE": REVIEW_INCOMPLETE_REASON,
    "NEEDS_DISCUSSION": "The code review asked for discussion and gave no pass/fail verdict, so it was not scored",
}


def normalise_review_verdict(raw: Any) -> tuple[str, float | None] | None:
    """The one place a review verdict is interpreted.

    Returns (canonical value, health), where health is None for a verdict that
    is recognised but not evaluated (INCOMPLETE). Returns None when no verdict
    was supplied. Raises ValueError for a value that is not accepted.
    """
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    key = raw.strip().upper().replace("-", "_").replace(" ", "_") if isinstance(raw, str) else None
    if key not in _REVIEW_VERDICTS:
        raise ValueError(
            f"review_recommendation must be one of {', '.join(ACCEPTED_REVIEW_VERDICTS)}; got {raw!r}"
        )
    return _REVIEW_VERDICTS[key]


def _review_health(review_recommendation: str | None) -> float | None:
    """Health of a review verdict; None when it is missing, unrecognised or not evaluated."""
    try:
        verdict = normalise_review_verdict(review_recommendation)
    except ValueError:
        return None
    return verdict[1] if verdict else None


def evaluate_pipeline_signals(
    ci_pass_rate: float | None,
    live_pass_rate: float | None,
    review_recommendation: str | None,
    open_critical_bugs: list[dict] | None,
    unresolved_security: int | None,
) -> dict[str, Any]:
    """Score the evaluated signals and derive the verdict. Pure; no I/O."""
    if ci_pass_rate is None and live_pass_rate is None:
        return {
            "score": None,
            "verdict": "INSUFFICIENT_DATA",
            "reason": "No CI signal and no live-test results: the pipeline cannot be scored.",
            "blockers": [],
            "conditions": [],
            "scored_signals": [],
        }

    health: dict[str, float] = {}
    if ci_pass_rate is not None:
        health["ci_pass_rate"] = min(1.0, max(0.0, ci_pass_rate / 100))
    if live_pass_rate is not None:
        health["live_test_pass_rate"] = min(1.0, max(0.0, live_pass_rate / 100))
    review = _review_health(review_recommendation)
    if review is not None:
        health["review_recommendation"] = review
    if open_critical_bugs is not None:
        health["open_critical_bugs"] = max(0.0, 1 - len(open_critical_bugs) / 10)
    if unresolved_security is not None:
        health["unresolved_security_findings"] = max(0.0, 1 - unresolved_security / 5)

    scored_signals = [name for name in PIPELINE_SIGNAL_WEIGHTS if name in health]
    total_weight = sum(PIPELINE_SIGNAL_WEIGHTS[name] for name in scored_signals)
    score = round(
        sum(PIPELINE_SIGNAL_WEIGHTS[name] * health[name] for name in scored_signals) / total_weight * 100
    )

    blockers: list[str] = []
    conditions: list[str] = []
    if ci_pass_rate is not None:
        if ci_pass_rate < MIN_CI_PASS_RATE:
            blockers.append(f"CI pass rate is {ci_pass_rate:.1f}%, below the {MIN_CI_PASS_RATE:.0f}% minimum")
        elif ci_pass_rate < 100:
            conditions.append(f"Investigate the failing CI runs (pass rate {ci_pass_rate:.1f}%)")
    if live_pass_rate is not None and live_pass_rate < 100:
        conditions.append(f"Investigate the failing live tests (pass rate {live_pass_rate:.1f}%)")

    blocker_bugs = [b for b in (open_critical_bugs or []) if b.get("priority") in BLOCKER_PRIORITIES]
    other_bugs = len(open_critical_bugs or []) - len(blocker_bugs)
    if blocker_bugs:
        keys = ", ".join(str(b.get("key", "?")) for b in blocker_bugs[:5])
        blockers.append(f"{len(blocker_bugs)} open blocker/critical bug(s): {keys}")
    if other_bugs:
        conditions.append(f"Resolve or defer {other_bugs} open high-priority bug(s)")
    if unresolved_security:
        conditions.append(f"Resolve {unresolved_security} critical review finding(s)")

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


def _count(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


@router.post("/report")
async def generate_pipeline_report(
    body: dict = Body(...),
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """
    Aggregate all pipeline stage signals into a single GO/NO-GO report.

    Body:
      owner               str
      repo                str
      version             str  (default "HEAD")
      commit_sha          str  (optional)
      jira_project        str  (optional)
      live_test_passed    int  (optional)
      live_test_failed    int  (optional)
      live_test_total     int  (optional)
      review_recommendation  "APPROVE"|"REQUEST_CHANGES"|"COMMENT"|"INCOMPLETE"|"NEEDS_DISCUSSION"
                             (code review), or "GO"|"CONDITIONAL"|"NO-GO" (older clients).
                             Optional; any other value is a 422. INCOMPLETE and
                             NEEDS_DISCUSSION are reported, never scored.
      review_critical_count  int  (optional)

    Signals that could not be evaluated are returned as null and listed in
    `not_evaluated` with the reason; `scored_signals` lists what the score used.
    With neither a CI signal nor live-test results the verdict is
    INSUFFICIENT_DATA and the score is null.
    """
    owner = body.get("owner", "")
    repo = body.get("repo", "")
    version = body.get("version", "HEAD")
    commit_sha = body.get("commit_sha")
    jira_project = body.get("jira_project", "")

    live_passed = _count(body.get("live_test_passed"))
    live_failed = _count(body.get("live_test_failed"))
    live_total = _count(body.get("live_test_total"))
    has_live = live_total > 0
    live_pass_rate = round((live_passed / live_total) * 100, 1) if has_live else None

    try:
        review = normalise_review_verdict(body.get("review_recommendation"))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    review_rec = review[0] if review else None
    review_critical = body.get("review_critical_count")
    review_critical = _count(review_critical) if review_critical is not None else None

    if not owner or not repo:
        raise HTTPException(status_code=400, detail="owner and repo are required")

    signals: dict = {
        "ci_pass_rate": None,
        "live_test_pass_rate": live_pass_rate,
        "live_test_passed": live_passed,
        "live_test_failed": live_failed,
        "live_test_total": live_total,
        "review_recommendation": review_rec,
        "review_critical_findings": review_critical,
        "open_critical_bugs": None,
        "open_critical_bug_count": None,
        "unresolved_security_findings": review_critical,
        "workflow_summary": {},
    }
    not_evaluated: dict[str, str] = {}
    errors = []

    if not has_live:
        not_evaluated["live_test_pass_rate"] = "No live-test results were provided"
    if review is None:
        not_evaluated["review_recommendation"] = "No code review verdict was provided"
    elif review[1] is None:
        not_evaluated["review_recommendation"] = REVIEW_NOT_SCORED_REASONS[review[0]]
    if review_critical is None:
        not_evaluated["unresolved_security_findings"] = "No critical review finding count was provided"

    # 1. GitHub CI pass rate
    cache = None
    try:
        runs, cache = await ci_metrics_service.get_workflow_runs(
            db, org.id, owner, repo, refresh=bool(body.get("refresh"))
        )
        ci = ci_metrics_service.headline(runs)
        signals["ci_pass_rate"] = ci["pass_rate"]
        if ci["pass_rate"] is None:
            not_evaluated["ci_pass_rate"] = (
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
        errors.append(f"GitHub CI fetch failed: {exc}")
        not_evaluated["ci_pass_rate"] = f"GitHub CI fetch failed: {exc}"

    # 2. Jira open critical bugs (optional)
    all_critical_bugs: list[dict] | None = None
    if jira_project:
        try:
            bugs = await jira_service.get_open_bugs(
                jira_project, version if version != "HEAD" else None
            )
            all_critical_bugs = [b for b in bugs if b["priority"] in CRITICAL_BUG_PRIORITIES]
            signals["open_critical_bugs"] = all_critical_bugs[:10]
            signals["open_critical_bug_count"] = len(all_critical_bugs)
        except Exception as exc:
            errors.append(f"Jira fetch failed: {exc}")
            not_evaluated["open_critical_bugs"] = f"Jira fetch failed: {exc}"
    else:
        not_evaluated["open_critical_bugs"] = "No Jira project key was provided"

    # 3. Score + verdict (deterministic)
    result = evaluate_pipeline_signals(
        ci_pass_rate=signals["ci_pass_rate"],
        live_pass_rate=live_pass_rate,
        review_recommendation=review_rec,
        open_critical_bugs=all_critical_bugs,
        unresolved_security=review_critical,
    )
    score = result["score"]
    verdict = result["verdict"]
    reason = result["reason"]
    if verdict == "INSUFFICIENT_DATA":
        reason = (
            f"No CI signal ({not_evaluated['ci_pass_rate']}) and no live-test results: "
            "the pipeline cannot be scored."
        )

    # 4. The AI call only writes the recommendation text; the verdict above stands.
    verdict_data = {
        "verdict": verdict,
        "reason": reason,
        "primary_blocker": result["blockers"][0] if result["blockers"] else None,
        "blockers": result["blockers"],
        # With nothing to narrate, the reason is shown where clients read the recommendation.
        "recommendation": reason if verdict == "INSUFFICIENT_DATA" else "",
        "conditions": result["conditions"],
    }
    if verdict != "INSUFFICIENT_DATA":
        try:
            narrative = await analyze_release_readiness(
                version=version,
                test_pass_rate=live_pass_rate if has_live else signals["ci_pass_rate"],
                open_critical_bugs=all_critical_bugs,
                unresolved_security_findings=review_critical,
                high_risk_files=None,
                score=score,
                verdict=verdict,
                blockers=result["blockers"],
            )
            verdict_data["recommendation"] = narrative.get("recommendation", "")
        except AIQuotaError as exc:
            raise HTTPException(status_code=429, detail=str(exc))
        except Exception as exc:
            errors.append(f"AI recommendation unavailable: {exc}")

    # 5. Persist to MongoDB
    pipeline_run_id = str(uuid.uuid4())
    try:
        await db["pipeline_runs"].insert_one({
            "_id": pipeline_run_id,
            "org_id": org.id,
            "owner": owner,
            "repo": repo,
            "version": version,
            "commit_sha": commit_sha,
            "score": score,
            "verdict": verdict,
            "signals": signals,
            "scored_signals": result["scored_signals"],
            "not_evaluated": not_evaluated,
            "errors": errors,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as exc:
        log.exception("Failed to persist pipeline run %s", pipeline_run_id)
        errors.append(f"Failed to persist pipeline report: {exc}")

    return {
        "pipeline_run_id": pipeline_run_id,
        "version": version,
        "commit_sha": commit_sha,
        "score": score,
        "verdict": verdict_data,
        "signals": signals,
        "scored_signals": result["scored_signals"],
        "not_evaluated": not_evaluated,
        "errors": errors,
        "cache": cache,
    }


@router.get("/runs")
async def list_pipeline_runs(
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    """Recent pipeline run history."""
    cursor = db["pipeline_runs"].find(
        {"org_id": org.id},
        {
            "_id": 1, "owner": 1, "repo": 1, "version": 1, "score": 1,
            "verdict": 1, "commit_sha": 1, "created_at": 1,
        },
    ).sort("created_at", -1).limit(20)
    runs = []
    async for doc in cursor:
        doc["id"] = doc.pop("_id")
        runs.append(doc)
    return runs
