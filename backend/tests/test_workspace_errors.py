"""Clone failures must not leak the PAT or server-side paths into the API."""
import git
import pytest

from app.services import workspace_service


class _FakeGitError(git.GitCommandError):
    def __init__(self, stderr: str):
        super().__init__(["git", "clone", "https://ghp_TOKEN@github.com/o/r"], 128, stderr)


def test_sanitize_git_error_redacts_pat_and_paths():
    err = _FakeGitError(
        "stderr: 'Cloning into '/tmp/workspaces/ws_1'...\n"
        "fatal: could not read Password for 'https://ghp_TOKEN@github.com': terminal prompts disabled'"
    )
    msg = workspace_service._sanitize_git_error(
        err, "https://github.com/o/r", "/tmp/workspaces/ws_1"
    )

    assert "ghp_TOKEN" not in msg
    assert "/tmp/workspaces/ws_1" not in msg
    assert "***@github.com" in msg
    assert msg.startswith("Could not clone https://github.com/o/r:")


def test_sanitize_git_error_keeps_the_useful_reason():
    err = _FakeGitError("fatal: repository 'not-a-url' does not exist")
    msg = workspace_service._sanitize_git_error(err, "not-a-url", "/tmp/workspaces/ws_2")
    assert msg == "Could not clone not-a-url: repository 'not-a-url' does not exist"


def test_redact_credentials_leaves_clean_urls_alone():
    assert workspace_service._redact_credentials("https://github.com/o/r") == "https://github.com/o/r"
    assert workspace_service._redact_credentials("https://tok@github.com/o/r") == "https://***@github.com/o/r"


def test_push_credentials_are_never_persisted_to_git_config(tmp_path):
    """The PAT must stay in memory: baking it into .git/config leaves the
    credential on disk for the life of the workspace."""
    from app.services import git_service

    work = tmp_path / "work"
    repo = git.Repo.init(work)
    repo.create_remote("origin", "https://github.com/o/r.git")

    pat = "ghp_LEAKCANARY0123456789"
    # Simulate a workspace polluted by the previous implementation.
    with repo.remotes.origin.config_writer as cw:
        cw.set("url", f"https://{pat}@github.com/o/r.git")
    assert pat in (work / ".git" / "config").read_text()

    git_service._strip_persisted_credentials(repo)

    assert pat not in (work / ".git" / "config").read_text()
    assert repo.remotes.origin.url == "https://github.com/o/r.git"
    # The tokenised URL is still available for the push itself, in memory only.
    assert git_service._origin_url_with_pat(repo.remotes.origin.url, pat) == (
        f"https://{pat}@github.com/o/r.git"
    )
    assert pat not in (work / ".git" / "config").read_text()


def test_strip_persisted_credentials_leaves_clean_remotes_alone(tmp_path):
    from app.services import git_service

    repo = git.Repo.init(tmp_path / "clean")
    repo.create_remote("origin", "https://github.com/o/r.git")
    git_service._strip_persisted_credentials(repo)
    assert repo.remotes.origin.url == "https://github.com/o/r.git"
