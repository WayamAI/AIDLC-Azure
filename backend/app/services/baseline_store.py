"""
MongoDB CRUD helpers for the repo baseline collection.
All functions use the shared async Motor client.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional

from app.database import get_db
from app.models.repo_baseline import BaselineTest, RepoBaseline, ScanSession

log = logging.getLogger("baseline_store")

COLLECTION = "repo_baselines"
SESSION_STATUS_COLLECTION = "baseline_scan_sessions"


# ── read ────────────────────────────────────────────────────────────────────

async def get_repo(repo_id: str) -> Optional[RepoBaseline]:
    db = get_db()
    doc = await db[COLLECTION].find_one({"repo_id": repo_id})
    if not doc:
        return None
    doc.pop("_id", None)
    return RepoBaseline(**doc)


async def get_session(session_id: str) -> Optional[ScanSession]:
    """
    Quick lookup of a single session searched across all repo documents.
    Used by the status-polling endpoint.
    """
    db = get_db()
    doc = await db[COLLECTION].find_one(
        {"sessions.session_id": session_id},
        {"sessions.$": 1, "repo_id": 1},
    )
    if not doc:
        return None
    sessions = doc.get("sessions", [])
    if not sessions:
        return None
    return ScanSession(**sessions[0])


# ── write ───────────────────────────────────────────────────────────────────

async def create_repo(baseline: RepoBaseline) -> None:
    """Insert a brand-new repo baseline document."""
    db = get_db()
    data = baseline.model_dump(mode="json")
    data["_id"] = baseline.repo_id
    try:
        await db[COLLECTION].insert_one(data)
    except Exception as exc:
        log.error("Failed to insert repo baseline: %s", exc)
        raise


async def update_session_status(
    repo_id: str,
    session_id: str,
    status: str,
    error: str | None = None,
    progress_message: str = "",
) -> None:
    """Patch a single session's status / progress_message in-place."""
    db = get_db()
    update = {
        "sessions.$.status": status,
        "sessions.$.progress_message": progress_message,
    }
    if error is not None:
        update["sessions.$.error"] = error
    await db[COLLECTION].update_one(
        {"repo_id": repo_id, "sessions.session_id": session_id},
        {"$set": update},
    )


async def append_tests_and_finish_session(
    repo_id: str,
    session_id: str,
    new_tests: List[BaselineTest],
    tests_total_after: int,
    new_commit_sha: str = "",
) -> None:
    """
    Atomically:
    - Push all new_tests into the top-level tests array
    - Mark the session as done, record counts
    - Update updated_at + last_commit_sha
    """
    db = get_db()
    test_dicts = [t.model_dump(mode="json") for t in new_tests]

    set_part: dict = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "sessions.$.status": "done",
        "sessions.$.tests_added": len(new_tests),
        "sessions.$.tests_total_after": tests_total_after,
    }
    if new_commit_sha:
        set_part["last_commit_sha"] = new_commit_sha
        set_part["sessions.$.commit_sha"] = new_commit_sha

    update_op: dict = {"$set": set_part}
    if test_dicts:
        update_op["$push"] = {"tests": {"$each": test_dicts}}

    await db[COLLECTION].update_one(
        {"repo_id": repo_id, "sessions.session_id": session_id},
        update_op,
    )


async def mark_session_failed(
    repo_id: str, session_id: str, error: str
) -> None:
    db = get_db()
    await db[COLLECTION].update_one(
        {"repo_id": repo_id, "sessions.session_id": session_id},
        {
            "$set": {
                "sessions.$.status": "failed",
                "sessions.$.error": error,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )


async def add_session_to_repo(repo_id: str, session: ScanSession) -> None:
    """Push a new ScanSession object onto an existing repo's sessions array."""
    db = get_db()
    await db[COLLECTION].update_one(
        {"repo_id": repo_id},
        {
            "$push": {"sessions": session.model_dump(mode="json")},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()},
        },
    )


async def sync_external_tests(
    repo_id: str,
    new_tests: List[BaselineTest],
    from_source: str = "workspace",
) -> int:
    """
    Merge externally generated tests into the baseline.
    Only unique tests are added. Returns the count of newly added tests.
    """
    db = get_db()
    existing = await get_repo(repo_id)
    if not existing:
        return 0

    from app.services.diff_service import deduplicate_tests
    unique_tests = deduplicate_tests(new_tests, existing.tests)

    if not unique_tests:
        return 0

    test_dicts = [t.model_dump(mode="json") for t in unique_tests]
    for d in test_dicts:
        d["added_in_session"] = f"manual_{from_source}"

    await db[COLLECTION].update_one(
        {"repo_id": repo_id},
        {
            "$push": {"tests": {"$each": test_dicts}},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()},
        },
    )
    return len(unique_tests)


# ── index creation ──────────────────────────────────────────────────────────

async def ensure_indexes() -> None:
    db = get_db()
    coll = db[COLLECTION]
    await coll.create_index("repo_id", unique=True)
    await coll.create_index("github_url")
    await coll.create_index("sessions.session_id")
    await coll.create_index("tests.test_id")
    await coll.create_index("tests.added_in_session")
    log.info("repo_baselines indexes ensured")
