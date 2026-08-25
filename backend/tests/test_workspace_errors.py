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
