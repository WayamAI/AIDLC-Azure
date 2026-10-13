"""POST /api/git/push: retry a push without creating a commit."""
import logging

import git
import pytest

from app.auth.session import create_session_cookie
from app.services import connector_settings_service as connectors
from app.services import git_service, organization_service, workspace_service

PAT = "ghp_SECRETTOKEN123"
ACTOR = git.Actor("t", "t@example.com")


@pytest.fixture(autouse=True)
def _clean_memory():
    workspace_service._WORKSPACES.clear()
    yield
    workspace_service._WORKSPACES.clear()


async def _login(app_client, db, name="org_a") -> str:
    org = await organization_service.create_organization(db, workos_org_id=name, name=name)
    app_client.cookies.set("aidlc_session", create_session_cookie(user_id="u", org_id=org.id))
    return org.id


def _make_clone(tmp_path, remote_url: str | None = None):
    """A clone with one commit. Without remote_url, origin is a local bare repository."""
    clone = tmp_path / "clone"
    clone.mkdir()
    repo = git.Repo.init(clone)
    (clone / "README.md").write_text("hi\n", encoding="utf-8")
    repo.index.add(["README.md"])
    repo.index.commit("init", author=ACTOR, committer=ACTOR)
    bare = None
    if remote_url is None:
        bare = tmp_path / "remote.git"
        git.Repo.init(bare, bare=True).close()
        remote_url = str(bare)
    repo.create_remote("origin", remote_url)
    branch = repo.active_branch.name
    sha = repo.head.commit.hexsha
    repo.close()
    return clone, branch, sha, bare


def _register(org_id: str, clone, pat: str | None = None, workspace_id: str = "ws_push") -> str:
    workspace_service._WORKSPACES[workspace_id] = {
        "workspace_id": workspace_id,
        "org_id": org_id,
        "clone_dir": str(clone),
        "pat": pat,
    }
    return workspace_id


def _remote_sha(bare, branch: str) -> str | None:
    repo = git.Repo(bare)
    try:
        return next((h.commit.hexsha for h in repo.heads if h.name == branch), None)
    finally:
        repo.close()


def _own_log(caplog) -> str:
    """What this app logged (GitPython's own DEBUG lines name the working directory)."""
    return " | ".join(r.getMessage() for r in caplog.records if r.name.startswith("app."))


def _fail_push(monkeypatch, stderr: str) -> list[tuple[str, str]]:
    """Replace the git push call with one that fails like git does; returns the recorded calls."""
    calls: list[tuple[str, str]] = []

    def fake(repo, target, refspec):
        calls.append((target, refspec))
        raise git.GitCommandError(["git", "push", "--porcelain", target, refspec], 128, stderr)

    monkeypatch.setattr(git_service, "_run_git_push", fake)
    return calls


# ── success ───────────────────────────────────────────────────────────────

async def test_push_sends_existing_commits_without_creating_one(app_client, db, tmp_path):
    org_id = await _login(app_client, db)
    clone, branch, sha, bare = _make_clone(tmp_path)
    ws_id = _register(org_id, clone)

    resp = await app_client.post("/api/git/push", json={"workspace_id": ws_id, "branch": branch})

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["workspace_id"] == ws_id
    assert data["branch"] == branch
    assert data["sha"] == sha
    assert data["pushed"] is True
    assert data["up_to_date"] is False
    assert sha[:7] in data["message"]
    assert data["github_url"].endswith(f"/commit/{sha}")
    assert _remote_sha(bare, branch) == sha

    repo = git.Repo(clone)
    try:
        assert repo.head.commit.hexsha == sha  # no new commit
        assert not repo.is_dirty(untracked_files=True)
    finally:
        repo.close()


async def test_branch_defaults_to_the_checked_out_branch(app_client, db, tmp_path):
    org_id = await _login(app_client, db)
    clone, branch, sha, bare = _make_clone(tmp_path)
    ws_id = _register(org_id, clone)

    resp = await app_client.post("/api/git/push", json={"workspace_id": ws_id})

    assert resp.status_code == 200, resp.text
    assert resp.json()["branch"] == branch
    assert _remote_sha(bare, branch) == sha


async def test_nothing_to_push_is_a_success_with_a_flag(app_client, db, tmp_path):
    org_id = await _login(app_client, db)
    clone, branch, sha, _ = _make_clone(tmp_path)
    ws_id = _register(org_id, clone)
    body = {"workspace_id": ws_id, "branch": branch}
    assert (await app_client.post("/api/git/push", json=body)).json()["pushed"] is True

    resp = await app_client.post("/api/git/push", json=body)

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["pushed"] is False
    assert data["up_to_date"] is True
    assert data["sha"] == sha
    assert "already up to date" in data["message"]


async def test_token_is_passed_for_one_push_and_never_persisted(app_client, db, tmp_path, monkeypatch):
    org_id = await _login(app_client, db)
    clone, branch, sha, _ = _make_clone(tmp_path, remote_url="https://github.com/o/r.git")
    ws_id = _register(org_id, clone, pat=PAT)
    calls: list[tuple[str, str]] = []

    def fake(repo, target, refspec):
        calls.append((target, refspec))
        return f"To {target}\n*\t{refspec}\t[new branch]\nDone"

    monkeypatch.setattr(git_service, "_run_git_push", fake)

    resp = await app_client.post("/api/git/push", json={"workspace_id": ws_id, "branch": branch})

    assert resp.status_code == 200, resp.text
    assert calls == [(f"https://{PAT}@github.com/o/r.git", f"refs/heads/{branch}:refs/heads/{branch}")]
    assert PAT not in resp.text
    assert resp.json()["github_url"] == f"https://github.com/o/r/commit/{sha}"
    assert PAT not in (clone / ".git" / "config").read_text(encoding="utf-8")


async def test_org_connector_token_is_used_when_the_workspace_has_none(app_client, db, tmp_path, monkeypatch):
    org_id = await _login(app_client, db)
    await connectors.update(db, org_id, {"github": {"token": "ghp_ORGCONNECTORTOKEN"}})
    clone, branch, _, _ = _make_clone(tmp_path, remote_url="https://github.com/o/r.git")
    ws_id = _register(org_id, clone, pat=None)
    calls: list[tuple[str, str]] = []

    def fake(repo, target, refspec):
        calls.append((target, refspec))
        return f"*\t{refspec}\t[new branch]"

    monkeypatch.setattr(git_service, "_run_git_push", fake)

    resp = await app_client.post("/api/git/push", json={"workspace_id": ws_id, "branch": branch})

    assert resp.status_code == 200, resp.text
    assert calls[0][0] == "https://ghp_ORGCONNECTORTOKEN@github.com/o/r.git"
    assert "ghp_ORGCONNECTORTOKEN" not in resp.text


# ── org isolation ─────────────────────────────────────────────────────────

async def test_requires_a_session(app_client, db, tmp_path):
    clone, branch, _, _ = _make_clone(tmp_path)
    _register("org_x", clone)
    resp = await app_client.post("/api/git/push", json={"workspace_id": "ws_push", "branch": branch})
    assert resp.status_code == 401


async def test_another_org_cannot_push_a_workspace(app_client, db, tmp_path, monkeypatch):
    owner_id = await _login(app_client, db, "org_a")
    clone, branch, _, bare = _make_clone(tmp_path)
    ws_id = _register(owner_id, clone, pat=PAT)
    calls = _fail_push(monkeypatch, "should never run")

    await _login(app_client, db, "org_b")
    resp = await app_client.post("/api/git/push", json={"workspace_id": ws_id, "branch": branch})

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Workspace not found"
    assert calls == []
    assert _remote_sha(bare, branch) is None


async def test_unknown_workspace_is_404_and_expired_workspace_is_410(app_client, db, tmp_path):
    org_id = await _login(app_client, db)
    resp = await app_client.post("/api/git/push", json={"workspace_id": "nope"})
    assert resp.status_code == 404

    # Registered, but the clone directory is gone: the same 410 every workspace route gives.
    _register(org_id, tmp_path / "gone", workspace_id="ws_gone")
    resp = await app_client.post("/api/git/push", json={"workspace_id": "ws_gone"})
    assert resp.status_code == 410
    assert isinstance(resp.json()["detail"], str)


# ── path / argument safety ────────────────────────────────────────────────

@pytest.mark.parametrize(
    "bad_branch",
    [
        "--force", "-f", "--receive-pack=touch pwned", "+main", "main:refs/heads/other", ":main",
        "../../etc/passwd", "a/../b", "refs/heads/..", ".git/config", "main lock", "main\nx", "a//b",
        "main/", "main.lock", "", "   ", "x" * 300,
    ],
)
async def test_branch_that_is_not_a_plain_name_is_rejected_before_git_runs(
    app_client, db, tmp_path, monkeypatch, bad_branch
):
    org_id = await _login(app_client, db)
    clone, _, _, bare = _make_clone(tmp_path)
    ws_id = _register(org_id, clone, pat=PAT)
    calls = _fail_push(monkeypatch, "should never run")
    config_before = (clone / ".git" / "config").read_text(encoding="utf-8")

    resp = await app_client.post("/api/git/push", json={"workspace_id": ws_id, "branch": bad_branch})

    assert resp.status_code == 400
    assert "Invalid branch name" in resp.json()["detail"]
    assert calls == []
    assert (clone / ".git" / "config").read_text(encoding="utf-8") == config_before
    assert list(bare.glob("refs/heads/*")) == []


@pytest.mark.parametrize("workspace_id", ["../clone", "..", "ws_push/../ws_push", "C:\\Windows"])
async def test_workspace_id_is_a_registry_key_not_a_path(app_client, db, tmp_path, monkeypatch, workspace_id):
    org_id = await _login(app_client, db)
    clone, branch, _, _ = _make_clone(tmp_path)
    _register(org_id, clone)
    calls = _fail_push(monkeypatch, "should never run")

    resp = await app_client.post("/api/git/push", json={"workspace_id": workspace_id, "branch": branch})

    assert resp.status_code == 404
    assert calls == []


async def test_caller_cannot_choose_the_remote_or_supply_files(app_client, db, tmp_path, monkeypatch):
    org_id = await _login(app_client, db)
    clone, branch, _, _ = _make_clone(tmp_path)
    ws_id = _register(org_id, clone)
    calls = _fail_push(monkeypatch, "should never run")

    for extra in ({"remote": "https://evil.example/x.git"}, {"new_file_contents": {"../x": "y"}}, {"files": ["a"]}):
        resp = await app_client.post("/api/git/push", json={"workspace_id": ws_id, "branch": branch, **extra})
        assert resp.status_code == 422

    assert calls == []
    assert not (tmp_path / "x").exists()


async def test_branch_missing_from_the_workspace_is_a_clear_400(app_client, db, tmp_path, monkeypatch):
    org_id = await _login(app_client, db)
    clone, _, _, _ = _make_clone(tmp_path)
    ws_id = _register(org_id, clone)
    calls = _fail_push(monkeypatch, "should never run")

    resp = await app_client.post("/api/git/push", json={"workspace_id": ws_id, "branch": "feat/not-here"})

    assert resp.status_code == 400
    assert resp.json()["detail"] == "Branch 'feat/not-here' does not exist in this workspace."
    assert calls == []


# ── failures ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "stderr",
    [
        "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
        "fatal: Authentication failed for 'https://github.com/o/r.git/'",
        "remote: Repository not found.\nfatal: repository 'https://github.com/o/r.git/' not found",
    ],
)
async def test_missing_token_tells_the_user_where_to_add_one(app_client, db, tmp_path, monkeypatch, stderr):
    org_id = await _login(app_client, db)
    clone, branch, _, _ = _make_clone(tmp_path, remote_url="https://github.com/o/r.git")
    ws_id = _register(org_id, clone, pat=None)
    calls = _fail_push(monkeypatch, stderr)

    resp = await app_client.post("/api/git/push", json={"workspace_id": ws_id, "branch": branch})

    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert detail == git_service.MISSING_TOKEN_MESSAGE
    assert "GitHub token" in detail and "Settings → Connectors" in detail
    assert calls[0][0] == "origin"  # no token: nothing is injected into the URL


async def test_rejected_token_is_reported_without_leaking_it(app_client, db, tmp_path, monkeypatch, caplog):
    org_id = await _login(app_client, db)
    clone, branch, _, _ = _make_clone(tmp_path, remote_url="https://github.com/o/r.git")
    ws_id = _register(org_id, clone, pat=PAT)
    _fail_push(
        monkeypatch,
        f"remote: Invalid username or password.\nfatal: Authentication failed for 'https://{PAT}@github.com/o/r.git/'",
    )

    with caplog.at_level(logging.DEBUG):
        resp = await app_client.post("/api/git/push", json={"workspace_id": ws_id, "branch": branch})

    assert resp.status_code == 502
    detail = resp.json()["detail"]
    assert isinstance(detail, str)
    assert "GitHub rejected the token" in detail and "Settings → Connectors" in detail
    assert "Authentication failed" in detail
    assert PAT not in resp.text
    assert PAT not in caplog.text
    assert PAT not in (clone / ".git" / "config").read_text(encoding="utf-8")


async def test_other_push_failures_are_scrubbed_of_token_and_server_paths(app_client, db, tmp_path, monkeypatch, caplog):
    org_id = await _login(app_client, db)
    clone, branch, _, _ = _make_clone(tmp_path, remote_url="https://github.com/o/r.git")
    ws_id = _register(org_id, clone, pat=PAT)
    _fail_push(
        monkeypatch,
        f"error: failed to push some refs to 'https://{PAT}@github.com/o/r.git' from {clone} using {PAT}",
    )

    with caplog.at_level(logging.DEBUG):
        resp = await app_client.post("/api/git/push", json={"workspace_id": ws_id, "branch": branch})

    assert resp.status_code == 502
    detail = resp.json()["detail"]
    assert detail.startswith("Push failed: ")
    assert "failed to push some refs" in detail
    assert PAT not in resp.text and str(clone) not in resp.text
    assert PAT not in caplog.text
    assert str(clone) not in _own_log(caplog)


async def test_unreachable_remote_is_a_502_with_a_string_detail(app_client, db, tmp_path):
    org_id = await _login(app_client, db)
    clone, branch, _, _ = _make_clone(tmp_path, remote_url=str(tmp_path / "no-such-remote.git"))
    ws_id = _register(org_id, clone, pat=PAT)

    resp = await app_client.post("/api/git/push", json={"workspace_id": ws_id, "branch": branch})

    assert resp.status_code == 502
    detail = resp.json()["detail"]
    assert isinstance(detail, str) and detail.startswith("Push failed: ")
    assert PAT not in resp.text and str(clone) not in resp.text


async def test_commit_reports_the_same_missing_token_message(tmp_path, monkeypatch):
    clone, branch, _, _ = _make_clone(tmp_path, remote_url="https://github.com/o/r.git")
    _register("org_a", clone, pat=None)
    _fail_push(monkeypatch, "fatal: could not read Username for 'https://github.com': terminal prompts disabled")

    result = await git_service.commit_and_push(
        "org_a", "ws_push", branch, ["new.txt"], "add file", {"new.txt": "content"}
    )

    assert result["push_ok"] is False
    assert result["push_error"] == git_service.MISSING_TOKEN_MESSAGE
