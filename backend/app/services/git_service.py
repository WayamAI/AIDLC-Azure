"""
Git service commit, push, branch, status, log via GitPython.
Operates on workspaces managed by workspace_service.
"""
import asyncio
from time import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import git
from git import Actor

from app.services.workspace_service import get_workspace

# Cache git status with 5-second TTL to avoid redundant operations
_GIT_STATUS_CACHE = {}  # (org_id, workspace_id) → (data, timestamp)
_GIT_CACHE_TTL = 5


class WorkspaceNotFound(KeyError):
    """Raised when a workspace is missing or not owned by the org."""


def _require_workspace(org_id: str, workspace_id: str) -> dict:
    ws = get_workspace(org_id, workspace_id)
    if ws is None:
        raise WorkspaceNotFound(workspace_id)
    return ws


def _get_repo(org_id: str, workspace_id: str) -> tuple[git.Repo, Path]:
    ws = _require_workspace(org_id, workspace_id)
    clone_dir = ws["clone_dir"]
    repo = git.Repo(clone_dir)
    return repo, Path(clone_dir)


def _origin_url_with_pat(remote_url: str, pat: Optional[str]) -> str:
    if not pat:
        return remote_url
    if remote_url.startswith("https://github.com/"):
        return remote_url.replace("https://github.com/", f"https://{pat}@github.com/")
    return remote_url


async def get_status(org_id: str, workspace_id: str) -> dict:
    cache_key = (org_id, workspace_id)
    cached = _GIT_STATUS_CACHE.get(cache_key)
    if cached:
        data, ts = cached
        if time() - ts < _GIT_CACHE_TTL:
            return data

    def _do():
        repo, _ = _get_repo(org_id, workspace_id)
        staged = [item.a_path for item in repo.index.diff("HEAD")]
        unstaged = [item.a_path for item in repo.index.diff(None)]
        untracked = repo.untracked_files
        try:
            branch = repo.active_branch.name
        except TypeError:
            branch = "HEAD"
        return {
            "workspace_id": workspace_id,
            "branch": branch,
            "staged": staged,
            "unstaged": unstaged,
            "untracked": list(untracked),
        }

    result = await asyncio.to_thread(_do)
    _GIT_STATUS_CACHE[cache_key] = (result, time())
    return result


async def get_log(org_id: str, workspace_id: str, max_count: int = 20) -> list[dict]:
    def _do():
        repo, _ = _get_repo(org_id, workspace_id)
        entries = []
        for commit in repo.iter_commits(max_count=max_count):
            entries.append({
                "sha": commit.hexsha,
                "short_sha": commit.hexsha[:7],
                "message": commit.message.strip().splitlines()[0],
                "author": str(commit.author),
                "date": commit.committed_datetime.isoformat(),
            })
        return entries
    return await asyncio.to_thread(_do)


async def get_file_diff(org_id: str, workspace_id: str, file_path: str) -> str:
    def _do():
        repo, _ = _get_repo(org_id, workspace_id)
        try:
            return repo.git.diff("HEAD", "--", file_path)
        except Exception:
            return ""
    return await asyncio.to_thread(_do)


async def create_branch(
    org_id: str,
    workspace_id: str,
    branch_name: str,
    from_branch: str = "main",
) -> dict:
    def _do():
        repo, _ = _get_repo(org_id, workspace_id)
        try:
            repo.git.checkout(from_branch)
        except Exception:
            pass
        new_branch = repo.create_head(branch_name)
        new_branch.checkout()
        return {"branch": branch_name, "from": from_branch}
    return await asyncio.to_thread(_do)


async def commit_and_push(
    org_id: str,
    workspace_id: str,
    branch: str,
    files: list[str],
    message: str,
    new_file_contents: dict[str, str],
    author_name: str = "SDLC AI",
    author_email: str = "ai@sdlc.dev",
) -> dict:
    """
    Write new file contents, stage given files, commit, and push.
    Returns commit SHA + GitHub URL.
    """
    def _do():
        ws = _require_workspace(org_id, workspace_id)
        repo = git.Repo(ws["clone_dir"])
        base = Path(ws["clone_dir"])
        pat = ws.get("pat")

        for rel_path, content in new_file_contents.items():
            abs_path = base / rel_path
            abs_path.parent.mkdir(parents=True, exist_ok=True)
            abs_path.write_text(content, encoding="utf-8")

        try:
            repo.git.checkout(branch)
        except git.GitCommandError:
            repo.git.checkout("-b", branch)

        repo.index.add(files)

        actor = Actor(author_name, author_email)
        commit = repo.index.commit(message, author=actor, committer=actor)

        origin = repo.remotes.origin
        push_url = _origin_url_with_pat(origin.url, pat)
        if pat:
            with repo.remotes.origin.config_writer as cw:
                cw.set("url", push_url)
        try:
            push_info = origin.push(refspec=f"{branch}:{branch}")
            push_ok = all(not (info.flags & info.ERROR) for info in push_info)
        except Exception:
            push_ok = False

        remote_url = origin.url.rstrip("/")
        if remote_url.endswith(".git"):
            remote_url = remote_url[:-4]
        if "@github.com" in remote_url:
            remote_url = "https://github.com/" + remote_url.split("@github.com/")[-1]
        github_url = f"{remote_url}/commit/{commit.hexsha}"

        return {
            "sha": commit.hexsha,
            "message": message,
            "branch": branch,
            "github_url": github_url,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "push_ok": push_ok,
        }

    return await asyncio.to_thread(_do)
