"""
Repository service: clone a GitHub repo and extract relevant source files for LLM analysis.
"""
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

# File extensions we care about for UI understanding
RELEVANT_EXTENSIONS = {
    ".tsx", ".ts", ".jsx", ".js", ".vue", ".html", ".py",
    ".json",  # package.json, routes config, etc.
}

# Directories that contain no useful UI code
SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv",
    "dist", "build", ".next", ".nuxt", "coverage", ".cache",
    ".pytest_cache", "out", ".output", "public",
}

# Skip auto-generated, minified, or lock files
SKIP_FILENAMES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "bun.lockb", ".eslintrc.json", "tsconfig.json",
}

MAX_FILE_SIZE_BYTES = 40 * 1024      # 40 KB per file
MAX_TOTAL_CHARS = 90_000             # ~90 K chars sent to LLM

_PRIORITY_FILENAMES = {
    "App.tsx", "App.jsx", "App.vue", "main.tsx", "main.jsx",
    "index.tsx", "index.jsx", "router.tsx", "router.jsx",
    "routes.tsx", "routes.jsx", "package.json",
}


def detect_default_branch(github_url: str) -> str:
    """Return the remote HEAD branch (e.g. 'dev') without cloning the repo."""
    try:
        result = subprocess.run(
            ["git", "ls-remote", "--symref", github_url, "HEAD"],
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return "main"
    if result.returncode != 0:
        return "main"
    for line in result.stdout.splitlines():
        stripped = line.strip()
        if stripped.startswith("ref:"):
            ref = stripped.split("ref:", 1)[1].strip().split()[0]
            prefix = "refs/heads/"
            if ref.startswith(prefix):
                return ref[len(prefix):] or "main"
    return "main"


def clone_repo(github_url: str, *, with_history: bool = False) -> str:
    """
    Clone a GitHub repository into a temporary directory.

    By default this is a --depth=1 snapshot, which is all most callers need.

    Pass with_history=True when the clone will be diffed between two commits.
    A depth-1 clone contains exactly one commit, so `git diff <old> <new>` in it
    fails with "fatal: bad object" — which callers were silently treating as
    "nothing changed". --filter=blob:none keeps the clone cheap (no file blobs
    up front) while still fetching the full commit graph a diff needs.
    """
    temp_dir = tempfile.mkdtemp(prefix="aidlc_repo_")
    clone_cmd = ["git", "clone"]
    if with_history:
        clone_cmd += ["--filter=blob:none"]
    else:
        clone_cmd += ["--depth=1"]
    clone_cmd += ["--single-branch", github_url, temp_dir]
    try:
        result = subprocess.run(
            clone_cmd,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise ValueError(f"Git clone failed: {result.stderr[:600]}")
        return temp_dir
    except subprocess.TimeoutExpired:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise ValueError("Git clone timed out (120 s). Check the URL or try again.")
    except FileNotFoundError:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise ValueError("'git' command not found on this server.")


def _posix_rel(rel_path: str) -> str:
    return rel_path.replace("\\", "/").lower()


def _file_sort_key(filename: str, rel_path: str) -> tuple[int, int, str]:
    """Lower tuple sorts first. Prefer UI source over backend dumps."""
    posix = _posix_rel(rel_path)
    name_pri = 0 if filename in _PRIORITY_FILENAMES else 1
    if (
        posix.startswith(("web/src/", "frontend/src/", "src/pages/", "src/components/", "src/routes/", "app/"))
        or any(part in posix for part in ("/pages/", "/components/", "/routes/", "/views/"))
    ):
        path_pri = 0
    elif posix.startswith(("web/", "frontend/", "src/")):
        path_pri = 1
    elif posix.startswith(("api/", "backend/", "core/", "server/")):
        path_pri = 4
    else:
        path_pri = 2
    return (path_pri, name_pri, posix)


def extract_codebase(repo_path: str) -> str:
    """
    Walk the cloned repo and collect the contents of relevant source files.
    Returns a single formatted string suitable for sending to an LLM.
    """
    collected: list[tuple[tuple[int, int, str], str, str]] = []
    total_chars = 0

    for root, dirs, filenames in os.walk(repo_path):
        # Prune directories in-place so os.walk skips them
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]

        for filename in filenames:
            filepath = Path(root) / filename

            if filename in SKIP_FILENAMES:
                continue
            if filepath.suffix not in RELEVANT_EXTENSIONS:
                continue
            if filepath.stat().st_size > MAX_FILE_SIZE_BYTES:
                continue

            rel_path = str(filepath.relative_to(repo_path))

            try:
                content = filepath.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue

            collected.append((_file_sort_key(filename, rel_path), rel_path, content))

    collected.sort(key=lambda x: x[0])

    parts: list[str] = []
    for _, rel_path, content in collected:
        if total_chars >= MAX_TOTAL_CHARS:
            break
        remaining = MAX_TOTAL_CHARS - total_chars
        if len(content) > remaining:
            content = content[:remaining] + "\n... [file truncated]"
        parts.append(f"=== {rel_path} ===\n{content}")
        total_chars += len(content)

    return "\n\n".join(parts)


def cleanup_repo(repo_path: str) -> None:
    """Remove the temporary cloned directory."""
    shutil.rmtree(repo_path, ignore_errors=True)


def _inject_pat(github_url: str, pat: str | None = None) -> str:
    if not pat:
        return github_url
    url = github_url.rstrip("/")
    if url.startswith("https://"):
        return url.replace("https://", f"https://{pat}@", 1)
    return github_url


def get_repo_commits(github_url: str, n: int = 10, pat: str | None = None) -> list[dict]:
    """
    Shallow-clone a repo, read the last n commits, clean up.
    Returns a list of commit dicts: sha, short_sha, message, author, relative_date, date.
    """
    temp_dir = tempfile.mkdtemp(prefix="aidlc_commits_")
    try:
        clone_url = _inject_pat(github_url, pat)
        result = subprocess.run(
            ["git", "clone", f"--depth={n + 2}", "--single-branch", clone_url, temp_dir],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise ValueError(f"Git clone failed: {result.stderr[:400]}")

        log_result = subprocess.run(
            ["git", "log", f"-{n}", "--pretty=format:%H|||%s|||%an|||%ar|||%ai"],
            capture_output=True, text=True, cwd=temp_dir,
        )
        commits = []
        for line in log_result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            parts = line.split("|||", 4)
            if len(parts) < 4:
                continue
            commits.append({
                "sha": parts[0],
                "short_sha": parts[0][:7],
                "message": parts[1],
                "author": parts[2],
                "relative_date": parts[3],
                "date": parts[4].strip() if len(parts) > 4 else "",
            })
        return commits
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def get_commit_diff_content(github_url: str, commit_sha: str) -> dict:
    """
    Clone the repo with enough history, extract the diff for the selected commit
    and the current content of all changed files.

    Returns:
      {commit_info, changed_files, diff_text, file_contents}
    """
    temp_dir = tempfile.mkdtemp(prefix="aidlc_diff_")
    try:
        result = subprocess.run(
            ["git", "clone", "--depth=25", "--single-branch", github_url, temp_dir],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            shutil.rmtree(temp_dir, ignore_errors=True)
            raise ValueError(f"Git clone failed: {result.stderr[:400]}")

        # Verify the commit is present; if not, deepen the clone
        verify = subprocess.run(
            ["git", "cat-file", "-e", commit_sha], capture_output=True, cwd=temp_dir
        )
        if verify.returncode != 0:
            subprocess.run(
                ["git", "fetch", "--deepen=50"], capture_output=True, cwd=temp_dir
            )

        # Commit metadata
        info_result = subprocess.run(
            ["git", "show", "--pretty=format:%H|||%s|||%an|||%ar", "--no-patch", commit_sha],
            capture_output=True, text=True, cwd=temp_dir,
        )
        commit_info: dict = {}
        if info_result.stdout.strip():
            parts = info_result.stdout.strip().split("|||", 3)
            commit_info = {
                "sha": parts[0] if len(parts) > 0 else commit_sha,
                "message": parts[1] if len(parts) > 1 else "",
                "author": parts[2] if len(parts) > 2 else "",
                "relative_date": parts[3] if len(parts) > 3 else "",
            }

        # Changed file names
        files_result = subprocess.run(
            ["git", "diff", "--name-only", f"{commit_sha}^", commit_sha],
            capture_output=True, text=True, cwd=temp_dir,
        )
        changed_files = [f.strip() for f in files_result.stdout.strip().split("\n") if f.strip()]

        # Full diff text (limited)
        diff_result = subprocess.run(
            ["git", "diff", f"{commit_sha}^", commit_sha, "--unified=3"],
            capture_output=True, text=True, cwd=temp_dir,
        )
        diff_text = diff_result.stdout[:40_000]

        # Current content of changed source files
        relevant_exts = {".tsx", ".ts", ".jsx", ".js", ".vue", ".html", ".py", ".css"}
        file_parts: list[str] = []
        total_chars = 0
        max_chars = 50_000

        for rel_path in changed_files:
            filepath = Path(temp_dir) / rel_path
            if not filepath.exists():
                continue
            if filepath.suffix not in relevant_exts:
                continue
            try:
                content = filepath.read_text(encoding="utf-8", errors="ignore")
                if total_chars + len(content) > max_chars:
                    content = content[: max_chars - total_chars] + "\n... [truncated]"
                file_parts.append(f"=== {rel_path} ===\n{content}")
                total_chars += len(content)
                if total_chars >= max_chars:
                    break
            except OSError:
                continue

        return {
            "commit_info": commit_info,
            "changed_files": changed_files,
            "diff_text": diff_text,
            "file_contents": "\n\n".join(file_parts),
        }
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
