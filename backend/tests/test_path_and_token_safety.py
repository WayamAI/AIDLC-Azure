"""Workspace paths stay inside the workspace, out of .git, and tokens never reach disk."""
import subprocess
from pathlib import Path

import git
import pytest

from app.services import ai_ide_service as svc
from app.services import workspace_service


# ── App Builder workspace paths ─────────────────────────────────────────────

def test_safe_abs_path_rejects_a_sibling_that_shares_the_prefix(tmp_path):
    root = tmp_path / "abc"
    root.mkdir()
    with pytest.raises(svc.WorkspacePathError):
        svc._safe_abs_path(root, "../abcevil/x.txt")
    assert svc._safe_abs_path(root, "src/a.tsx") == (root / "src/a.tsx").resolve()


@pytest.mark.parametrize("bad", ["", ".", "./", "/"])
def test_delete_and_rename_refuse_the_workspace_root(tmp_path, monkeypatch, bad):
    monkeypatch.setattr(svc, "_ai_ide_root", tmp_path)
    ws = "ws-root"
    root = tmp_path / ws
    (root / "src").mkdir(parents=True)
    (root / "src" / "a.tsx").write_text("x", encoding="utf-8")
    svc._workspaces[ws] = {"src/a.tsx": "x"}
    svc._workspace_meta[ws] = {"workspace_id": ws, "org_id": "o", "root_dir": str(root)}
    try:
        with pytest.raises(svc.WorkspacePathError):
            svc.delete_path(ws, bad)
        with pytest.raises(svc.WorkspacePathError):
            svc.rename_or_move_path(ws, bad, "elsewhere")
        assert (root / "src" / "a.tsx").is_file()
    finally:
        svc._workspaces.pop(ws, None)
        svc._workspace_meta.pop(ws, None)


def test_scrub_removes_raw_base64_and_url_tokens():
    token = "ghp_secret123"
    import base64

    b64 = base64.b64encode(f"x-access-token:{token}".encode()).decode()
    text = f"fatal: https://{token}@github.com/a/b {b64} {token}"
    out = svc._scrub(text, token)
    assert token not in out and b64 not in out


# ── App Builder push: token is never written to .git/config ────────────────

def _bare_remote(tmp_path: Path) -> Path:
    remote = tmp_path / "remote.git"
    git.Repo.init(remote, bare=True)
    return remote


async def test_commit_and_push_keeps_the_token_off_disk_and_reports_rejections(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "_ai_ide_root", tmp_path)
    remote = _bare_remote(tmp_path)
    ws = "ws-push"
    root = tmp_path / ws
    root.mkdir()
    (root / "index.html").write_text("<html></html>", encoding="utf-8")
    repo = git.Repo.init(root)
    repo.git.symbolic_ref("HEAD", "refs/heads/main")
    repo.git.add(A=True)
    repo.index.commit("init")
    # An older version stored the token in the remote URL; it must be rewritten.
    repo.create_remote("origin", str(remote).replace("\\", "/"))

    svc._workspaces[ws] = {"index.html": "<html></html>"}
    svc._workspace_meta[ws] = {
        "workspace_id": ws, "org_id": "o", "root_dir": str(root),
        "repo_url": str(remote), "default_branch": "main", "github_token": None,
    }
    try:
        # No token after a restart: a clear error, not a git failure.
        with pytest.raises(ValueError, match="GitHub token"):
            await svc.commit_and_push_workspace(ws, "msg", "main")

        result = await svc.commit_and_push_workspace(ws, "msg", "main", github_token="tok-SECRET")
        assert result["push_ok"] is True
        config = (root / ".git" / "config").read_text(encoding="utf-8")
        assert "tok-SECRET" not in config
        assert git.Repo(remote).heads.main.commit.hexsha == result["sha"]

        # A clean tree still pushes (no stale "success"), and reports it is up to date.
        again = await svc.commit_and_push_workspace(ws, "msg", "main")
        assert again["committed"] is False and again["push_ok"] is True

        # Someone else pushed to the remote: the push is rejected and reported, not "ok".
        other = tmp_path / "other"
        clone = git.Repo.clone_from(str(remote), other, branch="main")
        (other / "x.txt").write_text("x", encoding="utf-8")
        clone.git.add(A=True)
        clone.index.commit("theirs")
        clone.git.push("origin", "main")
        (root / "index.html").write_text("<html>2</html>", encoding="utf-8")
        with pytest.raises(svc.GitPushError, match="rejected"):
            await svc.commit_and_push_workspace(ws, "msg", "main")
    finally:
        svc._workspaces.pop(ws, None)
        svc._workspace_meta.pop(ws, None)


# ── Connected workspaces (code review / impact): .git is off limits ────────

@pytest.mark.parametrize("bad", [".git/config", ".GIT/config", "../outside.txt"])
def test_workspace_files_cannot_touch_git_or_escape(tmp_path, bad):
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "config").write_text("[core]", encoding="utf-8")
    with pytest.raises(PermissionError):
        workspace_service._workspace_file(str(tmp_path), bad)
    assert workspace_service._workspace_file(str(tmp_path), "src/a.py") == (tmp_path / "src/a.py").resolve()


@pytest.mark.parametrize("bad", ["file:///etc", "/srv/repo", "--upload-pack=x", "http://github.com/a/b", "ssh://git@x/y"])
def test_only_https_repository_urls_are_cloned(bad):
    with pytest.raises(ValueError):
        workspace_service.validate_repo_url(bad)
    assert workspace_service.validate_repo_url(" https://github.com/a/b ") == "https://github.com/a/b"


def test_chain_analysis_skips_paths_outside_the_clone(tmp_path, monkeypatch):
    from app.services import test_gen_service

    clone = tmp_path / "clone"
    clone.mkdir()
    (clone / "a.py").write_text("print(1)", encoding="utf-8")
    (tmp_path / "secret.env").write_text("API_KEY=leak", encoding="utf-8")
    monkeypatch.setattr(test_gen_service, "require_workspace", lambda org, ws: {"clone_dir": str(clone)})
    captured = {}

    async def fake_call(prompt, *a, **k):
        captured["prompt"] = prompt
        raise RuntimeError("stop")

    for name in ("_call_openai_json", "_call_openai"):
        if hasattr(test_gen_service, name):
            monkeypatch.setattr(test_gen_service, name, fake_call)

    import asyncio
    try:
        asyncio.run(test_gen_service.analyze_chain_for_tests(
            org_id="o", workspace_id="w", chain=["a.py", "../secret.env"], changed_files=["a.py"],
        ))
    except Exception:
        pass
    assert "leak" not in captured.get("prompt", "")
