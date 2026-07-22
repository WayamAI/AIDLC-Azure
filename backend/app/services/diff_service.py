"""
Diff detection service.

Given an existing RepoBaseline and a freshly-cloned repo path, determines:
  1. Whether anything changed (SHA comparison first)
  2. Which files changed (git diff)
  3. Which existing tests cover the changed files (source_file matching)
  4. Final deduplication of newly-generated tests vs the existing set
"""
from __future__ import annotations

import hashlib
import logging
import subprocess
from difflib import SequenceMatcher
from typing import List, Tuple

from app.models.repo_baseline import BaselineTest, RepoBaseline

log = logging.getLogger("diff_service")

# ─────────────────────────────────────────────────────────────────────────────

DEDUP_THRESHOLD = 0.85   # SequenceMatcher ratio above which we consider dupes


def get_repo_id(github_url: str) -> str:
    """Stable 16-char identifier for a repo URL (SHA-256 prefix)."""
    normalised = github_url.lower().rstrip("/").replace(".git", "")
    return hashlib.sha256(normalised.encode()).hexdigest()[:16]


def get_current_commit_sha(repo_path: str) -> str:
    """Return HEAD SHA of the cloned repo. Empty string on failure."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repo_path,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.stdout.strip() if result.returncode == 0 else ""
    except Exception:
        return ""


def unchanged_since_last_scan(
    current_sha: str, baseline: RepoBaseline
) -> bool:
    """
    If we know the last commit SHA and it hasn't changed, there is nothing to do.
    Returns True iff we can confidently skip the scan.
    """
    if not current_sha or not baseline.last_commit_sha:
        return False
    return current_sha == baseline.last_commit_sha


def get_changed_files(
    old_sha: str, new_sha: str, repo_path: str
) -> List[str]:
    """
    Return a list of relative file paths that changed between two commits.
    Falls back to an empty list if git diff fails.
    """
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", old_sha, new_sha],
            cwd=repo_path,
            capture_output=True,
            text=True,
            timeout=20,
        )
        if result.returncode == 0:
            return [f.strip() for f in result.stdout.splitlines() if f.strip()]
    except Exception as exc:
        log.warning("git diff failed, falling back to full scan: %s", exc)
    return []


def build_existing_tests_context(
    changed_files: List[str],
    all_existing: List[BaselineTest],
) -> Tuple[List[BaselineTest], List[BaselineTest]]:
    """
    Split existing tests into:
      - related: tests whose source_file appears in the changed set  
        (AI needs to know these to avoid duplicating them)
      - unrelated: everything else (not sent to AI saves tokens)
    """
    changed_set = set(changed_files)
    related, unrelated = [], []
    for t in all_existing:
        if t.source_file and t.source_file in changed_set:
            related.append(t)
        else:
            unrelated.append(t)
    return related, unrelated


def deduplicate_tests(
    new_candidates: List[BaselineTest],
    existing_tests: List[BaselineTest],
) -> List[BaselineTest]:
    """
    Final safety net: drop any candidate that is semantically duplicate of an
    existing test.  Uses SequenceMatcher on lowercased test names.

    Also drops exact (endpoint, page_path) pair matches.
    """
    existing_names = [t.name.lower() for t in existing_tests]
    existing_pairs = {
        (t.endpoint or "", t.page_path or "") for t in existing_tests
    }
    truly_new: List[BaselineTest] = []

    for candidate in new_candidates:
        cname = candidate.name.lower()

        # Name similarity check
        is_dup = False
        for ename in existing_names:
            if SequenceMatcher(None, cname, ename).ratio() > DEDUP_THRESHOLD:
                is_dup = True
                break

        # Exact pair check (only when both are non-empty)
        if not is_dup:
            pair = (candidate.endpoint or "", candidate.page_path or "")
            if pair != ("", "") and pair in existing_pairs:
                is_dup = True

        if not is_dup:
            truly_new.append(candidate)

    return truly_new
