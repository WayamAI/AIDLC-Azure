"""
Baseline analysis runner.

Orchestrates the full pipeline for the repo baseline system:
  1. Clone / fetch the repo
  2. Detect whether this is a full scan or incremental scan
  3. Call the appropriate AI generator
  4. Deduplicate and persist
  5. Keep the session status updated throughout so the frontend can poll
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import List

from app.models.repo_baseline import BaselineTest, RepoBaseline, ScanSession
from app.services import baseline_store, diff_service, repo_service
from app.services.ai_service import (
    AIQuotaError,
    generate_baseline_tests,
    generate_incremental_tests,
)

log = logging.getLogger("baseline_runner")


async def _run_blocking(fn, *args):
    return await asyncio.to_thread(fn, *args)


# ── helpers ──────────────────────────────────────────────────────────────────

def _chunk_codebase(codebase_text: str, max_chunk: int = 25_000) -> List[str]:
    """
    The existing repo_service.extract_codebase returns a single large string.
    We split the codebase text into smaller chunks for parallel processing.
    """
    if len(codebase_text) <= max_chunk:
        return [codebase_text]
    # simple split future: smarter file-boundary split
    chunks: List[str] = []
    while codebase_text:
        chunks.append(codebase_text[:max_chunk])
        codebase_text = codebase_text[max_chunk:]
    return chunks


# ── main orchestrator ────────────────────────────────────────────────────────

async def run_baseline_scan(
    repo_id: str,
    github_url: str,
    session: ScanSession,
    existing_baseline: "RepoBaseline | None",
) -> None:
    """
    Background task runs the complete baseline scan and writes all results to MongoDB.
    Updates session status at each step so the polling endpoint reflects real progress.
    """

    async def progress(msg: str) -> None:
        await baseline_store.update_session_status(
            repo_id, session.session_id, "running", progress_message=msg
        )
        log.info("[%s] %s", session.session_id[:8], msg)

    repo_path: str | None = None

    try:
        # ── Step 1: Clone ──────────────────────────────────────────────────
        await progress("Cloning repository…")
        try:
            repo_path = await _run_blocking(repo_service.clone_repo, github_url)
        except Exception as exc:
            raise RuntimeError(f"Git clone failed: {exc}") from exc

        # ── Step 2: Determine scan type ────────────────────────────────────
        current_sha = await _run_blocking(diff_service.get_current_commit_sha, repo_path)

        is_incremental = (
            existing_baseline is not None
            and bool(existing_baseline.last_commit_sha)
        )

        # Short-circuit: same commit, no changes
        if is_incremental and diff_service.unchanged_since_last_scan(
            current_sha, existing_baseline  # type: ignore[arg-type]
        ):
            await _run_blocking(repo_service.cleanup_repo, repo_path)
            repo_path = None
            await baseline_store.append_tests_and_finish_session(
                repo_id,
                session.session_id,
                new_tests=[],
                tests_total_after=len(existing_baseline.tests),  # type: ignore[union-attr]
                new_commit_sha=current_sha,
            )
            log.info("[%s] No changes detected, skipping scan", session.session_id[:8])
            return

        # ── Step 3: Extract code ───────────────────────────────────────────
        await progress("Extracting source files…")
        codebase_text = await _run_blocking(repo_service.extract_codebase, repo_path)

        changed_files: List[str] = []
        changed_code = ""

        if is_incremental:
            # Find changed files between stored SHA and current SHA
            changed_files = await _run_blocking(
                diff_service.get_changed_files,
                existing_baseline.last_commit_sha,  # type: ignore[union-attr]
                current_sha,
                repo_path,
            )
            if not changed_files:
                # git diff returned nothing fall back to full scan
                is_incremental = False
            else:
                # Build the "changed code" string from the diff service context
                # We re-use extract_codebase on the full text and extract only files
                # that appear in the changed_files list
                changed_code = _extract_changed_content(codebase_text, changed_files)

        # ── Step 4: AI generation ──────────────────────────────────────────
        if is_incremental and changed_files:
            await progress(
                f"Incremental scan {len(changed_files)} changed file(s). Generating new tests…"
            )
            existing_test_dicts = [
                t.model_dump(mode="json") for t in existing_baseline.tests  # type: ignore[union-attr]
            ]
            raw_new_tests = await generate_incremental_tests(
                changed_code=changed_code,
                existing_tests=existing_test_dicts,
                session_id=session.session_id,
            )
            # Final deduplication safety pass
            new_baseline_tests = _materialise_tests(raw_new_tests, session.session_id)
            new_baseline_tests = diff_service.deduplicate_tests(
                new_baseline_tests,
                existing_baseline.tests,  # type: ignore[union-attr]
            )
            all_tests_count = len(existing_baseline.tests) + len(new_baseline_tests)  # type: ignore[union-attr]
        else:
            # Full scan
            await progress("Full codebase scan generating baseline tests…")
            code_chunks = _chunk_codebase(codebase_text)
            raw_new_tests = await generate_baseline_tests(
                code_chunks=code_chunks,
                session_id=session.session_id,
            )
            new_baseline_tests = _materialise_tests(raw_new_tests, session.session_id)
            all_tests_count = (
                len(existing_baseline.tests) + len(new_baseline_tests)
                if existing_baseline
                else len(new_baseline_tests)
            )

        # ── Step 5: Persist ────────────────────────────────────────────────
        await progress(f"Persisting {len(new_baseline_tests)} new tests…")

        # Persist results and mark session as done
        await baseline_store.append_tests_and_finish_session(
            repo_id,
            session.session_id,
            new_tests=new_baseline_tests,
            tests_total_after=all_tests_count,
            new_commit_sha=current_sha,
        )

        log.info(
            "[%s] Done. %d new tests stored. Total: %d",
            session.session_id[:8],
            len(new_baseline_tests),
            all_tests_count,
        )

    except AIQuotaError as exc:
        log.error("[%s] AI quota error: %s", session.session_id[:8], exc)
        await baseline_store.mark_session_failed(repo_id, session.session_id, str(exc))
    except Exception as exc:
        log.exception("[%s] Scan failed: %s", session.session_id[:8], exc)
        await baseline_store.mark_session_failed(repo_id, session.session_id, str(exc))
    finally:
        if repo_path:
            repo_service.cleanup_repo(repo_path)


# ── private helpers ──────────────────────────────────────────────────────────

def _extract_changed_content(full_codebase: str, changed_files: List[str]) -> str:
    """
    Given the full codebase string (with === path === headers) and a list of
    changed file paths, return only the sections for those files.
    """
    changed_set = set(changed_files)
    sections: List[str] = []
    blocks = full_codebase.split("\n\n")
    current_path = None
    current_lines: List[str] = []

    for block in blocks:
        if block.startswith("=== ") and " ===" in block:
            # flush previous
            if current_path and current_path in changed_set:
                sections.append("\n\n".join(current_lines))
            path = block[4 : block.index(" ===", 4)]
            current_path = path
            current_lines = [block]
        else:
            current_lines.append(block)

    # flush last
    if current_path and current_path in changed_set:
        sections.append("\n\n".join(current_lines))

    return "\n\n".join(sections) if sections else full_codebase[:40_000]


def _materialise_tests(
    raw_dicts: List[dict],
    session_id: str,
) -> List[BaselineTest]:
    """Convert AI-returned validated dicts into BaselineTest Pydantic objects."""
    tests: List[BaselineTest] = []
    for raw in raw_dicts:
        try:
            raw["added_in_session"] = session_id
            tests.append(BaselineTest(**raw))
        except Exception as exc:
            log.debug("Discarding malformed test: %s", exc)
    return tests
