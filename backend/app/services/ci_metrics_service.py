"""
Shared GitHub reads and CI metrics.

Every page that shows CI numbers (CI Intelligence, Sprint Intelligence, Release
Gate, Pipeline) reads the same cached workflow runs through get_workflow_runs()
and computes its figures with summarise_runs(), so the same repository gives the
same pass rate everywhere.

The cache is the `github_cache` collection, keyed by org + repo + parameters, so
it is shared by all workers and survives restarts. A page load within the TTL
costs no GitHub request; callers pass refresh=True to bypass it.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from app.services import github_service

log = logging.getLogger("ci_metrics")

CACHE = "github_cache"
CACHE_TTL_SECONDS = 180
# A commit's file list never changes once the commit exists.
COMMIT_DETAIL_TTL_SECONDS = 7 * 24 * 3600

# One GitHub request returns at most this many runs; every page shares that one fetch.
RUNS_FETCHED = 100
# The headline figures (pass rate, failure rate, counts) cover this many most recent runs.
HEADLINE_RUNS = 30
# Concurrent GitHub requests one analysis may have in flight.
GITHUB_CONCURRENCY = 5


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def cached(
    db,
    org_id: str,
    kind: str,
    owner: str,
    repo: str,
    params: str,
    fetch: Callable[[], Awaitable[Any]],
    refresh: bool = False,
    ttl_seconds: int = CACHE_TTL_SECONDS,
) -> tuple[Any, dict[str, Any]]:
    """Return (data, cache_info) for one GitHub read, fetching only when the cache is cold.

    cache_info is {"cached": bool, "fetched_at": iso, "ttl_seconds": int}. The
    cache is an optimisation: if MongoDB cannot be read or written the data is
    still fetched and returned.
    """
    key = f"{org_id}:{kind}:{owner.lower()}/{repo.lower()}:{params}"
    if not refresh:
        try:
            doc = await db[CACHE].find_one({"_id": key})
        except Exception as exc:
            log.warning("github cache read failed: %s", exc)
            doc = None
        if doc and _aware(doc["expires_at"]) > _now():
            return doc["data"], {
                "cached": True,
                "fetched_at": _aware(doc["fetched_at"]).isoformat(),
                "ttl_seconds": ttl_seconds,
            }

    data = await fetch()
    fetched_at = _now()
    try:
        await db[CACHE].replace_one(
            {"_id": key},
            {
                "org_id": org_id,
                "kind": kind,
                "repo": f"{owner}/{repo}",
                "data": data,
                "fetched_at": fetched_at,
                "expires_at": fetched_at + timedelta(seconds=ttl_seconds),
            },
            upsert=True,
        )
    except Exception as exc:
        log.warning("github cache write failed: %s", exc)
    return data, {"cached": False, "fetched_at": fetched_at.isoformat(), "ttl_seconds": ttl_seconds}


async def ensure_indexes(db) -> None:
    # MongoDB removes entries once they expire.
    await db[CACHE].create_index("expires_at", expireAfterSeconds=0)
    await db[CACHE].create_index([("org_id", 1), ("repo", 1)])


async def get_workflow_runs(
    db, org_id: str, owner: str, repo: str, refresh: bool = False,
) -> tuple[list[dict], dict[str, Any]]:
    """The repository's most recent workflow runs (up to RUNS_FETCHED), newest first."""
    return await cached(
        db, org_id, "workflow_runs", owner, repo, f"per_page={RUNS_FETCHED}",
        lambda: github_service.get_workflow_runs(owner, repo, per_page=RUNS_FETCHED),
        refresh=refresh,
    )


async def get_commits(
    db, org_id: str, owner: str, repo: str, since_days: int, refresh: bool = False,
) -> tuple[list[dict], dict[str, Any]]:
    return await cached(
        db, org_id, "commits", owner, repo, f"since_days={since_days}",
        lambda: github_service.get_commits(owner, repo, since_days),
        refresh=refresh,
    )


async def get_commit_files(db, org_id: str, owner: str, repo: str, sha: str) -> list[dict]:
    """The files one commit changed: [{filename, additions, deletions}]."""
    async def _fetch() -> list[dict]:
        detail = await github_service.get_commit_detail(owner, repo, sha)
        return [
            {
                "filename": f["filename"],
                "additions": f.get("additions", 0),
                "deletions": f.get("deletions", 0),
            }
            for f in detail.get("files", [])
        ]

    files, _ = await cached(
        db, org_id, "commit_files", owner, repo, sha, _fetch, ttl_seconds=COMMIT_DETAIL_TTL_SECONDS,
    )
    return files


async def get_commit_files_many(
    db, org_id: str, owner: str, repo: str, shas: list[str],
) -> list[list[dict] | BaseException]:
    """get_commit_files for each sha, a few at a time. A failed fetch is returned as its exception.

    A GitHub rate-limit response stops the remaining fetches: they could only fail the same way.
    """
    semaphore = asyncio.Semaphore(GITHUB_CONCURRENCY)
    limited: list[github_service.GitHubRateLimitError] = []

    async def _one(sha: str) -> list[dict]:
        async with semaphore:
            if limited:
                raise limited[0]
            try:
                return await get_commit_files(db, org_id, owner, repo, sha)
            except github_service.GitHubRateLimitError as exc:
                limited.append(exc)
                raise

    return await asyncio.gather(*(_one(sha) for sha in shas), return_exceptions=True)


# ── Metrics ──────────────────────────────────────────────────────────────────

def _created_at(run: dict) -> datetime | None:
    try:
        return datetime.fromisoformat(str(run.get("created_at")).replace("Z", "+00:00"))
    except ValueError:
        return None


def runs_within(runs: list[dict], days: int, now: datetime | None = None) -> list[dict]:
    """Runs created in the last `days` days. A run with an unreadable date is left out."""
    now = now or _now()
    kept = []
    for run in runs:
        created = _created_at(run)
        if created is not None and (now - _aware(created)).days <= days:
            kept.append(run)
    return kept


def _rate(part: int, whole: int) -> float | None:
    return round(part / whole * 100, 1) if whole else None


def summarise_runs(runs: list[dict]) -> dict[str, Any]:
    """Counts and rates for a set of workflow runs.

    A run is *evaluated* when it concluded "success" or "failure". Cancelled,
    skipped and still-running runs are counted in `total_runs` but are neither a
    pass nor a failure, so:

        pass_rate    = success_count / evaluated_runs * 100
        failure_rate = failure_count / evaluated_runs * 100

    Both are None when no run was evaluated: there is nothing to measure.
    """
    success = sum(1 for r in runs if r.get("conclusion") == "success")
    failure = sum(1 for r in runs if r.get("conclusion") == "failure")
    cancelled = sum(1 for r in runs if r.get("conclusion") == "cancelled")
    evaluated = success + failure
    return {
        "total_runs": len(runs),
        "evaluated_runs": evaluated,
        "success_count": success,
        "failure_count": failure,
        "cancelled_count": cancelled,
        "pass_rate": _rate(success, evaluated),
        "failure_rate": _rate(failure, evaluated),
    }


def headline(runs: list[dict]) -> dict[str, Any]:
    """summarise_runs over the HEADLINE_RUNS most recent runs: the figures every page reports."""
    return {**summarise_runs(runs[:HEADLINE_RUNS]), "window_runs": HEADLINE_RUNS}


def successful_runs_last_week(runs: list[dict], now: datetime | None = None) -> int:
    """Successful workflow runs in the last 7 days (the deployment-frequency proxy)."""
    return summarise_runs(runs_within(runs, 7, now))["success_count"]
