"""
Workspace service manages cloned repos in /tmp/workspaces/.
Handles: connect (shallow clone), file tree walking, file read/write.
"""
import asyncio
import re
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import git

from app.config import settings
from app.services.repo_service import detect_default_branch

# ── Workspace registry (workspace_id → metadata) ───────────────────────────
# MongoDB (`workspaces`) holds the registry; this dict is the per-process cache
# the synchronous file/git helpers read. ensure_attached() fills it from MongoDB
# after a restart or on another worker. The PAT lives only here, never in MongoDB.
_WORKSPACES: dict[str, dict] = {}

REGISTRY = "workspaces"


class WorkspaceExpiredError(Exception):
    """The workspace is registered but its clone directory is no longer on this server."""

    def __init__(self, workspace_id: str):
        super().__init__("Workspace expired: its files are no longer on the server. Open the repository again.")
        self.workspace_id = workspace_id

# Extensions we care about (extend as needed)
_CODE_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx",
    # module variants the dependency graph also tracks — without these, such a
    # file shows up as a graph node that cannot be selected in the file tree
    ".mjs", ".cjs", ".mts", ".cts", ".vue",
    ".json", ".yaml", ".yml", ".toml",
    ".md", ".txt", ".html", ".css", ".scss",
    ".sh", ".env.example",
}

# Directories to skip entirely
_SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv",
    ".mypy_cache", ".pytest_cache", "dist", "build", ".next",
    ".nuxt", "coverage", ".coverage", "htmlcov",
}

MAX_FILE_SIZE_BYTES = getattr(settings, "MAX_FILE_SIZE_KB", 500) * 1024
WORKSPACE_TEMP_DIR = getattr(settings, "WORKSPACE_TEMP_DIR", "/tmp/workspaces")


def _get_language(path: str) -> str:
    ext = Path(path).suffix.lower()
    mapping = {
        ".py": "python", ".ts": "typescript", ".tsx": "typescript",
        ".js": "javascript", ".jsx": "javascript", ".json": "json",
        ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
        ".md": "markdown", ".html": "html", ".css": "css",
        ".scss": "scss", ".sh": "shell",
    }
    return mapping.get(ext, "plaintext")


def _walk_tree(base: Path, rel_path: Path = Path(".")) -> list[dict]:
    """Recursively walk directory, return tree as list of dicts."""
    entries = []
    target = base / rel_path

    try:
        items = sorted(target.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
    except PermissionError:
        return entries

    for item in items:
        name = item.name
        rel = rel_path / name

        if item.is_dir():
            if name in _SKIP_DIRS or name.startswith("."):
                continue
            children = _walk_tree(base, rel)
            if children:  # only include dirs that have code files
                entries.append({
                    "name": name,
                    "path": rel.as_posix(),
                    "type": "directory",
                    "language": None,
                    "children": children,
                })
        elif item.is_file():
            if item.suffix.lower() not in _CODE_EXTENSIONS:
                continue
            if item.stat().st_size > MAX_FILE_SIZE_BYTES:
                continue
            entries.append({
                "name": name,
                "path": rel.as_posix(),
                "type": "file",
                "language": _get_language(name),
                "children": None,
            })

    return entries


_CREDENTIAL_URL_RE = re.compile(r"(https?://)[^/\s@]+@")


def _redact_credentials(text: str) -> str:
    """Replace any "user:token@" in a URL with "***@"."""
    return _CREDENTIAL_URL_RE.sub(lambda m: m.group(1) + "***@", text)


def _sanitize_git_error(exc: Exception, repo_url: str, clone_dir: str) -> str:
    """
    Turn a GitCommandError into a message safe to return over the API.

    GitPython puts the whole command line in the exception, and when a PAT is
    injected into the clone URL that command line contains the token. It also
    exposes the server-side clone path. Both are stripped here.
    """
    def _scrub(text: str) -> str:
        text = _redact_credentials(text)
        text = text.replace(clone_dir, "<workspace>")
        return text.replace(WORKSPACE_TEMP_DIR, "<workspaces>")

    detail = _scrub(str(exc))

    stderr = getattr(exc, "stderr", "") or ""
    stderr = _scrub(str(stderr))
    # GitPython formats this as: stderr: 'fatal: <the actual reason>', often
    # preceded by progress noise. The last line carries the real reason.
    for prefix in ("stderr:", "fatal:"):
        stderr = stderr.strip().strip("'\"").removeprefix(prefix)
    tail = [ln for ln in stderr.splitlines() if ln.strip()]
    reason = (tail[-1] if tail else "").strip().strip("'\"").removeprefix("fatal:").strip()
    reason = reason or detail.splitlines()[0]
    return f"Could not clone {repo_url}: {reason}"


def validate_repo_url(repo_url: str) -> str:
    """Only https repository URLs are cloned: no file://, local paths or git options."""
    url = (repo_url or "").strip()
    if url.startswith("-") or not url.lower().startswith("https://") or any(c.isspace() for c in url):
        raise ValueError("Repository URL must be an https:// URL, e.g. https://github.com/owner/repo")
    return url


def _clone_with_pat(repo_url: str, clone_dir: str, branch: str, pat: Optional[str]) -> None:
    """Clone repo (shallow depth=1). The PAT is used for the clone only and not left in .git/config."""
    repo_url = validate_repo_url(repo_url)
    url = repo_url.rstrip("/")
    if pat:
        # Inject PAT: https://PAT@github.com/owner/repo
        if url.startswith("https://"):
            url = url.replace("https://", f"https://{pat}@")
    try:
        repo = git.Repo.clone_from(
            url,
            clone_dir,
            depth=1,
            branch=branch,
            single_branch=True,
        )
    except git.GitCommandError as exc:
        raise ValueError(_sanitize_git_error(exc, repo_url, clone_dir)) from exc
    if pat:
        # clone_from stores the URL it was given as origin; keep the token out of it.
        repo.git.remote("set-url", "origin", repo_url.rstrip("/"))


async def connect_repo(
    org_id: str, repo_url: str, branch: str = "main", pat: Optional[str] = None, db=None,
) -> dict:
    """Clone repo and return workspace_id + file tree. With `db`, the workspace is registered in MongoDB."""
    workspace_id = str(uuid.uuid4())
    clone_dir = os.path.join(WORKSPACE_TEMP_DIR, workspace_id)
    os.makedirs(WORKSPACE_TEMP_DIR, exist_ok=True)
    requested = (branch or "").strip()
    if not requested:
        requested = await asyncio.to_thread(detect_default_branch, repo_url)

    def _do_clone():
        _clone_with_pat(repo_url, clone_dir, requested, pat)

    await asyncio.to_thread(_do_clone)

    base = Path(clone_dir)
    tree = _walk_tree(base)

    _WORKSPACES[workspace_id] = {
        "workspace_id": workspace_id,
        "org_id": org_id,
        "repo_url": repo_url,
        "branch": requested,
        "clone_dir": clone_dir,
        "pat": pat,  # kept server-side only
    }
    if db is not None:
        now = datetime.now(timezone.utc)
        await db[REGISTRY].insert_one({
            "_id": workspace_id,
            "org_id": org_id,
            "repo_url": _redact_credentials(repo_url),
            "branch": requested,
            "clone_dir": clone_dir,
            "created_at": now,
            "last_used_at": now,
        })

    return {
        "workspace_id": workspace_id,
        "repo_url": repo_url,
        "branch": requested,
        "tree": tree,
    }


async def ensure_attached(db, org_id: str, workspace_id: str) -> None:
    """Make an org's registered workspace usable in this process.

    A workspace opened before a restart (or on another worker) is re-attached to
    its clone directory. Raises WorkspaceExpiredError when the directory is gone.
    An unknown or other-org id is left alone: the caller reports it as not found.
    """
    entry = _WORKSPACES.get(workspace_id)
    if entry is None:
        doc = await db[REGISTRY].find_one({"_id": workspace_id, "org_id": org_id})
        if doc is None:
            return
        entry = {
            "workspace_id": workspace_id,
            "org_id": org_id,
            "repo_url": doc.get("repo_url"),
            "branch": doc.get("branch"),
            "clone_dir": doc.get("clone_dir"),
            "pat": None,  # never stored; pushing to a private repo needs the repository opened again
        }
        if entry["clone_dir"] and os.path.isdir(entry["clone_dir"]):
            _WORKSPACES[workspace_id] = entry
            await db[REGISTRY].update_one(
                {"_id": workspace_id}, {"$set": {"last_used_at": datetime.now(timezone.utc)}}
            )
    if entry.get("org_id") != org_id:
        return
    clone_dir = entry.get("clone_dir")
    if clone_dir and not os.path.isdir(clone_dir):
        _WORKSPACES.pop(workspace_id, None)
        raise WorkspaceExpiredError(workspace_id)


async def ensure_indexes(db) -> None:
    await db[REGISTRY].create_index([("org_id", 1), ("last_used_at", -1)])


def get_workspace(org_id: str, workspace_id: str) -> dict | None:
    """Returns the workspace's metadata only if it's owned by org_id, else None."""
    entry = _WORKSPACES.get(workspace_id)
    if entry is None or entry.get("org_id") != org_id:
        return None
    return entry


def require_workspace(org_id: str, workspace_id: str) -> dict:
    """Return org-owned workspace metadata or raise KeyError."""
    ws = get_workspace(org_id, workspace_id)
    if ws is None:
        raise KeyError(f"Workspace {workspace_id} not found")
    return ws


def _workspace_file(clone_dir: str, file_path: str) -> Path:
    """A path inside the clone and outside .git (which holds config git executes)."""
    from app.services.git_service import _safe_workspace_path

    try:
        return _safe_workspace_path(Path(clone_dir), file_path)
    except ValueError as exc:
        raise PermissionError(str(exc)) from None


def get_file_content(org_id: str, workspace_id: str, file_path: str) -> dict:
    ws = require_workspace(org_id, workspace_id)
    abs_path = _workspace_file(ws["clone_dir"], file_path)

    if not abs_path.exists() or not abs_path.is_file():
        raise FileNotFoundError(f"File not found: {file_path}")

    content = abs_path.read_text(encoding="utf-8", errors="replace")
    return {
        "path": file_path,
        "content": content,
        "language": _get_language(file_path),
        "size_bytes": abs_path.stat().st_size,
    }


def save_file_content(org_id: str, workspace_id: str, file_path: str, content: str) -> None:
    ws = get_workspace(org_id, workspace_id)
    if ws is None:
        raise KeyError(f"Workspace {workspace_id} not found")
    abs_path = _workspace_file(ws["clone_dir"], file_path)

    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_text(content, encoding="utf-8")


def get_file_tree(org_id: str, workspace_id: str) -> list[dict]:
    ws = get_workspace(org_id, workspace_id)
    if ws is None:
        raise KeyError(f"Workspace {workspace_id} not found")
    base = Path(ws["clone_dir"])
    return _walk_tree(base)


async def delete_workspace(org_id: str, workspace_id: str, db=None) -> None:
    ws = get_workspace(org_id, workspace_id)
    if ws is None:
        raise KeyError(f"Workspace {workspace_id} not found")
    _WORKSPACES.pop(workspace_id, None)
    await asyncio.to_thread(shutil.rmtree, ws["clone_dir"], ignore_errors=True)
    if db is not None:
        await db[REGISTRY].delete_one({"_id": workspace_id, "org_id": org_id})
