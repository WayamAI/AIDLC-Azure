"""A clone failure must not hand the PAT back to the caller."""
import subprocess

import pytest

from app.services import repo_service

PAT = "ghp_SECRETTOKEN123"


def test_clone_failure_message_has_no_pat(monkeypatch):
    def fake_run(cmd, **kwargs):
        stderr = (
            "Cloning into 'x'...\n"
            f"fatal: repository 'https://{PAT}@github.com/owner/repo/' not found\n"
        )
        return subprocess.CompletedProcess(cmd, 128, stdout="", stderr=stderr)

    monkeypatch.setattr(repo_service.subprocess, "run", fake_run)

    with pytest.raises(ValueError) as excinfo:
        repo_service.get_repo_commits("https://github.com/owner/repo", 10, PAT)

    message = str(excinfo.value)
    assert PAT not in message
    assert "github.com/owner/repo" in message
    assert "https://***@github.com" in message
