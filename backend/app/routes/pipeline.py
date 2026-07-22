"""
Pipeline report route.
Aggregates CI + live test results + code review verdict into a single GO/NO-GO.
"""
import uuid
from fastapi import APIRouter, HTTPException, Body
from app.services import github_service, jira_service
from app.services.ai_service import analyze_release_readiness, AIQuotaError
from app.database import get_db

router = APIRouter(prefix="/pipeline", tags=["Pipeline"])


def _pipeline_score(
    ci_pass_rate: float,
    live_pass_rate: float,
    review_recommendation: str,
    open_critical_bugs: int,
    unresolved_security: int,
    has_live_results: bool,
) -> int:
    """Weighted score out of 100."""
    # Code review points
    review_pts = {"GO": 20, "CONDITIONAL": 10, "NO-GO": 0, "NO_GO": 0}.get(
        (review_recommendation or "CONDITIONAL").upper().replace("-", "_"), 10
    )
    if has_live_results:
        score = (
            (ci_pass_rate / 100) * 25
            + (live_pass_rate / 100) * 35
            + review_pts
            + max(0, (1 - open_critical_bugs / 10)) * 10
            + max(0, (1 - unresolved_security / 5)) * 10
        )
    else:
        # No live test data rely on CI + review + bugs
        score = (
            (ci_pass_rate / 100) * 50
            + review_pts
            + max(0, (1 - open_critical_bugs / 10)) * 15
            + max(0, (1 - unresolved_security / 5)) * 15
        )
    return min(100, max(0, round(score)))


@router.post("/report")
async def generate_pipeline_report(body: dict = Body(...)):
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
      review_recommendation  "GO"|"CONDITIONAL"|"NO-GO"  (optional)
      review_critical_count  int  (optional)
    """
    owner = body.get("owner", "")
    repo = body.get("repo", "")
    version = body.get("version", "HEAD")
    commit_sha = body.get("commit_sha")
    jira_project = body.get("jira_project", "")

    live_passed = body.get("live_test_passed", 0)
    live_failed = body.get("live_test_failed", 0)
    live_total = body.get("live_test_total", 0)
    has_live = live_total > 0
    live_pass_rate = round((live_passed / live_total) * 100, 1) if has_live else 0.0

    review_rec = body.get("review_recommendation", "CONDITIONAL") or "CONDITIONAL"
    review_critical = body.get("review_critical_count", 0) or 0

    if not owner or not repo:
        raise HTTPException(status_code=400, detail="owner and repo are required")

    signals: dict = {
        "ci_pass_rate": 0.0,
        "live_test_pass_rate": live_pass_rate,
        "live_test_passed": live_passed,
        "live_test_failed": live_failed,
        "live_test_total": live_total,
        "review_recommendation": review_rec,
        "review_critical_findings": review_critical,
        "open_critical_bugs": [],
        "unresolved_security_findings": review_critical,
        "workflow_summary": {},
    }
    errors = []

    # 1. GitHub CI pass rate
    try:
        runs = await github_service.get_workflow_runs(owner, repo, per_page=20)
        recent = [r for r in runs[:10] if r["conclusion"] in ("success", "failure")]
        if recent:
            passed = sum(1 for r in recent if r["conclusion"] == "success")
            signals["ci_pass_rate"] = round(passed / len(recent) * 100, 1)
        signals["workflow_summary"] = {
            "total_runs": len(runs),
            "recent_evaluated": len(recent),
        }
    except Exception as exc:
        errors.append(f"GitHub CI fetch failed: {exc}")

    # 2. Jira open critical bugs (optional)
    if jira_project:
        try:
            bugs = await jira_service.get_open_bugs(
                jira_project, version if version != "HEAD" else None
            )
            critical = [b for b in bugs if b["priority"] in ("Critical", "Highest", "High", "Blocker")]
            signals["open_critical_bugs"] = critical[:10]
        except Exception as exc:
            errors.append(f"Jira fetch failed: {exc}")

    # 3. Score
    score = _pipeline_score(
        ci_pass_rate=signals["ci_pass_rate"],
        live_pass_rate=live_pass_rate,
        review_recommendation=review_rec,
        open_critical_bugs=len(signals["open_critical_bugs"]),
        unresolved_security=review_critical,
        has_live_results=has_live,
    )

    # 4. AI verdict (reuse existing function)
    try:
        verdict_data = await analyze_release_readiness(
            version=version,
            test_pass_rate=live_pass_rate if has_live else signals["ci_pass_rate"],
            open_critical_bugs=signals["open_critical_bugs"],
            unresolved_security_findings=review_critical,
            high_risk_files=[],
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
            "recommendation": f"Pipeline score: {score}/100. Review each stage for details.",
            "conditions": [],
        }

    # 5. Persist to MongoDB
    pipeline_run_id = str(uuid.uuid4())
    try:
        db = get_db()
        await db["pipeline_runs"].insert_one({
            "_id": pipeline_run_id,
            "owner": owner,
            "repo": repo,
            "version": version,
            "commit_sha": commit_sha,
            "score": score,
            "verdict": verdict_data.get("verdict"),
            "signals": signals,
            "errors": errors,
        })
    except Exception:
        pass  # non-fatal

    return {
        "pipeline_run_id": pipeline_run_id,
        "version": version,
        "commit_sha": commit_sha,
        "score": score,
        "verdict": verdict_data,
        "signals": signals,
        "errors": errors,
    }


@router.get("/runs")
async def list_pipeline_runs():
    """Recent pipeline run history."""
    try:
        db = get_db()
        cursor = db["pipeline_runs"].find({}, {"_id": 1, "owner": 1, "repo": 1, "version": 1, "score": 1, "verdict": 1}).sort("_id", -1).limit(20)
        runs = []
        async for doc in cursor:
            doc["id"] = doc.pop("_id")
            runs.append(doc)
        return runs
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
