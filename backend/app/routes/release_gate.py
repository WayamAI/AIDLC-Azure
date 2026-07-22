"""
Release Gate routes.
Aggregates signals from GitHub + Jira and produces a go/no-go verdict.
"""
from fastapi import APIRouter, HTTPException, Body

from app.services import github_service, jira_service
from app.services.ai_service import analyze_release_readiness, AIQuotaError
from app.services import slack_service

router = APIRouter(prefix="/release-gate", tags=["Release Gate"])


def _compute_score(
    test_pass_rate: float,
    open_critical_bugs: int,
    unresolved_security: int,
    avg_defect_risk: float,
) -> int:
    score = (
        (test_pass_rate / 100) * 30 +
        max(0, (1 - open_critical_bugs / 10)) * 25 +
        max(0, (1 - unresolved_security / 5)) * 25 +
        max(0, (1 - avg_defect_risk / 100)) * 20
    )
    return min(100, max(0, round(score)))


@router.post("/evaluate")
async def evaluate_release(body: dict = Body(...)):
    """
    Evaluate release readiness.

    Body:
      version: str
      owner: str  (GitHub owner)
      repo: str
      jira_project: str
      branch: str (optional)
    """
    version = body.get("version", "HEAD")
    owner = body.get("owner", "")
    repo = body.get("repo", "")
    jira_project = body.get("jira_project", "")

    if not owner or not repo:
        raise HTTPException(status_code=400, detail="owner and repo are required")

    signals: dict = {
        "test_pass_rate": 0.0,
        "open_critical_bugs": [],
        "unresolved_security_findings": 0,
        "high_risk_files": [],
        "workflow_summary": {},
    }
    errors = []

    # 1. GitHub workflow runs → test pass rate
    try:
        runs = await github_service.get_workflow_runs(owner, repo, per_page=20)
        recent = [r for r in runs[:10] if r["conclusion"] in ("success", "failure")]
        if recent:
            passed = sum(1 for r in recent if r["conclusion"] == "success")
            signals["test_pass_rate"] = round(passed / len(recent) * 100, 1)
        signals["workflow_summary"] = {
            "total_runs": len(runs),
            "recent_evaluated": len(recent),
        }
    except Exception as exc:
        errors.append(f"GitHub workflow fetch failed: {exc}")

    # 2. Jira open critical/high bugs
    if jira_project:
        try:
            bugs = await jira_service.get_open_bugs(jira_project, version if version != "HEAD" else None)
            critical_bugs = [b for b in bugs if b["priority"] in ("Critical", "Highest", "High", "Blocker")]
            signals["open_critical_bugs"] = critical_bugs[:10]
        except Exception as exc:
            errors.append(f"Jira fetch failed: {exc}")

    # 3. Compute score
    score = _compute_score(
        test_pass_rate=signals["test_pass_rate"],
        open_critical_bugs=len(signals["open_critical_bugs"]),
        unresolved_security=signals["unresolved_security_findings"],
        avg_defect_risk=50.0,  # default; caller can override with defect prediction data
    )

    # 4. AI verdict
    try:
        verdict_data = await analyze_release_readiness(
            version=version,
            test_pass_rate=signals["test_pass_rate"],
            open_critical_bugs=signals["open_critical_bugs"],
            unresolved_security_findings=signals["unresolved_security_findings"],
            high_risk_files=signals["high_risk_files"],
            score=score,
        )
    except AIQuotaError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except Exception as exc:
        errors.append(f"AI verdict failed: {exc}")
        verdict_data = {
            "verdict": "NO-GO" if score < 50 else "CONDITIONAL" if score < 75 else "GO",
            "confidence": 0.5,
            "primary_blocker": None,
            "recommendation": f"Score: {score}/100. Manual review recommended.",
            "conditions": [],
        }

    # 5. Notify Slack if blocked
    if verdict_data.get("verdict") == "NO-GO":
        try:
            await slack_service.send_release_blocked(
                version=version,
                reason=verdict_data.get("primary_blocker") or verdict_data.get("recommendation", ""),
                score=score,
            )
        except Exception:
            pass

    return {
        "version": version,
        "score": score,
        "verdict": verdict_data,
        "signals": signals,
        "errors": errors,
    }
