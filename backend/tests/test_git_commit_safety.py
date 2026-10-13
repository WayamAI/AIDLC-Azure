"""Commit must not write outside the clone, and must report failed pushes."""
import git
import pytest

from app.models.workspace_models import CommitResponse
from app.services import git_service, workspace_service

PAT = "ghp_SECRETTOKEN123"


@pytest.fixture
def workspace(tmp_path):
    clone = tmp_path / "clone"
    clone.mkdir()
    repo = git.Repo.init(clone)
    (clone / "README.md").write_text("hi\n", encoding="utf-8")
    repo.index.add(["README.md"])
    actor = git.Actor("t", "t@example.com")
    repo.index.commit("init", author=actor, committer=actor)
    # A remote that cannot be reached, so every push fails locally.
    repo.create_remote("origin", str(tmp_path / "no-such-remote.git"))
    branch = repo.active_branch.name
    repo.close()

    workspace_service._WORKSPACES["ws_git"] = {
        "workspace_id": "ws_git",
        "org_id": "org_a",
        "clone_dir": str(clone),
        "pat": PAT,
    }
    yield clone, branch
    workspace_service._WORKSPACES.pop("ws_git", None)


@pytest.mark.parametrize(
    "bad_path",
    ["../escaped.txt", "sub/../../escaped.txt", ".git/config", ".git/hooks/pre-commit", ".GIT/config", ""],
)
async def test_commit_rejects_paths_outside_workspace_or_in_git_dir(workspace, bad_path):
    clone, branch = workspace
    config_before = (clone / ".git" / "config").read_text(encoding="utf-8")

    with pytest.raises(ValueError):
        await git_service.commit_and_push(
            "org_a", "ws_git", branch, [], "msg", {"ok.txt": "fine", bad_path: "pwned"}
        )

    assert not (clone.parent / "escaped.txt").exists()
    assert not (clone / "ok.txt").exists()  # nothing is written when any path is bad
    assert (clone / ".git" / "config").read_text(encoding="utf-8") == config_before


async def test_failed_push_is_reported_without_leaking_the_token(workspace):
    clone, branch = workspace

    result = await git_service.commit_and_push(
        "org_a", "ws_git", branch, ["src/new.txt"], "add file", {"src/new.txt": "content"}
    )

    assert (clone / "src" / "new.txt").read_text(encoding="utf-8") == "content"
    assert result["push_ok"] is False
    assert result["push_error"]
    assert PAT not in result["push_error"]
    assert str(clone) not in result["push_error"]

    response = CommitResponse(**result)
    assert response.push_ok is False
    assert response.push_error == result["push_error"]


def test_push_error_text_is_scrubbed():
    exc = git.GitCommandError(
        ["git", "push", f"https://{PAT}@github.com/o/r"],
        128,
        f"stderr: 'fatal: Authentication failed for 'https://{PAT}@github.com/o/r/''",
    )
    reason = git_service._push_error_reason(exc, PAT, "/tmp/workspaces/ws")

    assert PAT not in reason
    assert "Authentication failed" in reason


def test_safe_error_text_drops_command_line_token_and_server_paths():
    import tempfile

    from git import GitCommandError

    from app.services import git_service

    clone = f"{tempfile.gettempdir()}/aidlc_workspaces/ws-1"
    exc = GitCommandError(
        ["git", "push", "https://x-access-token:ghp_secret123@github.com/o/r.git"], 128,
        stderr=f"fatal: unable to write {clone}/.git/index.lock\n",
    )
    text = git_service.safe_error_text(exc)
    assert "ghp_secret123" not in text and "git push" not in text
    assert tempfile.gettempdir() not in text
    assert "unable to write" in text

    plain = git_service.safe_error_text(ValueError("clone https://user:tok3n@github.com/o/r failed"))
    assert "tok3n" not in plain
