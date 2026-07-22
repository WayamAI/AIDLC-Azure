"""
Workspace service manages cloned repos in /tmp/workspaces/.
Handles: connect (shallow clone), file tree walking, file read/write.
"""
import asyncio
import os
import shutil
import uuid
from pathlib import Path
from typing import Optional

import git

from app.config import settings

# ── In-memory workspace registry (workspace_id → metadata) ─────────────────
# In production this should be persisted to MongoDB; for now, memory is fine
# since we only need it per process lifetime.
_WORKSPACES: dict[str, dict] = {}

# Extensions we care about (extend as needed)
_CODE_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx",
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
                    "path": str(rel),
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
                "path": str(rel),
                "type": "file",
                "language": _get_language(name),
                "children": None,
            })

    return entries


def _clone_with_pat(repo_url: str, clone_dir: str, branch: str, pat: Optional[str]) -> None:
    """Clone repo (shallow depth=1). Injects PAT into URL if provided."""
    url = repo_url.rstrip("/")
    if pat:
        # Inject PAT: https://PAT@github.com/owner/repo
        if url.startswith("https://"):
            url = url.replace("https://", f"https://{pat}@")
    git.Repo.clone_from(
        url,
        clone_dir,
        depth=1,
        branch=branch,
        single_branch=True,
    )


async def connect_repo(repo_url: str, branch: str = "main", pat: Optional[str] = None) -> dict:
    """Clone repo and return workspace_id + file tree."""
    workspace_id = str(uuid.uuid4())
    clone_dir = os.path.join(WORKSPACE_TEMP_DIR, workspace_id)
    os.makedirs(WORKSPACE_TEMP_DIR, exist_ok=True)

    def _do_clone():
        _clone_with_pat(repo_url, clone_dir, branch, pat)

    await asyncio.to_thread(_do_clone)

    base = Path(clone_dir)
    tree = _walk_tree(base)

    _WORKSPACES[workspace_id] = {
        "workspace_id": workspace_id,
        "repo_url": repo_url,
        "branch": branch,
        "clone_dir": clone_dir,
        "pat": pat,  # kept server-side only
    }

    return {
        "workspace_id": workspace_id,
        "repo_url": repo_url,
        "branch": branch,
        "tree": tree,
    }


def get_workspace(workspace_id: str) -> dict:
    ws = _WORKSPACES.get(workspace_id)
    if not ws:
        raise KeyError(f"Workspace {workspace_id} not found")
    return ws


def get_file_content(workspace_id: str, file_path: str) -> dict:
    ws = get_workspace(workspace_id)
    abs_path = Path(ws["clone_dir"]) / file_path

    # Security: ensure path stays inside the workspace
    try:
        abs_path.resolve().relative_to(Path(ws["clone_dir"]).resolve())
    except ValueError:
        raise PermissionError("Path traversal attempt detected")

    if not abs_path.exists() or not abs_path.is_file():
        raise FileNotFoundError(f"File not found: {file_path}")

    content = abs_path.read_text(encoding="utf-8", errors="replace")
    return {
        "path": file_path,
        "content": content,
        "language": _get_language(file_path),
        "size_bytes": abs_path.stat().st_size,
    }


def save_file_content(workspace_id: str, file_path: str, content: str) -> None:
    ws = get_workspace(workspace_id)
    abs_path = Path(ws["clone_dir"]) / file_path

    try:
        abs_path.resolve().relative_to(Path(ws["clone_dir"]).resolve())
    except ValueError:
        raise PermissionError("Path traversal attempt detected")

    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_text(content, encoding="utf-8")


def get_file_tree(workspace_id: str) -> list[dict]:
    ws = get_workspace(workspace_id)
    base = Path(ws["clone_dir"])
    return _walk_tree(base)


def delete_workspace(workspace_id: str) -> None:
    ws = _WORKSPACES.pop(workspace_id, None)
    if ws:
        shutil.rmtree(ws["clone_dir"], ignore_errors=True)
