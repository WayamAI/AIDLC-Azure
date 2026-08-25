"""A diff that cannot be computed must not masquerade as 'nothing changed'.

Returning [] on git failure silently degraded incremental baseline scans and
intelligent test selection to full-suite behaviour, with no error surfaced.
"""
import subprocess

import pytest

from app.services import diff_service, repo_service


def _git(*args, cwd):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


@pytest.fixture
def repo(tmp_path):
    d = tmp_path / "r"
    d.mkdir()
    _git("init", "-q", cwd=d)
    _git("config", "user.email", "t@t.t", cwd=d)
    _git("config", "user.name", "t", cwd=d)
    (d / "a.txt").write_text("one", encoding="utf-8")
    _git("add", ".", cwd=d)
    _git("commit", "-qm", "first", cwd=d)
    first = subprocess.run(["git", "rev-parse", "HEAD"], cwd=d, capture_output=True, text=True).stdout.strip()
    (d / "b.txt").write_text("two", encoding="utf-8")
    _git("add", ".", cwd=d)
    _git("commit", "-qm", "second", cwd=d)
    second = subprocess.run(["git", "rev-parse", "HEAD"], cwd=d, capture_output=True, text=True).stdout.strip()
    return str(d), first, second


def test_returns_changed_files_between_two_commits(repo):
    path, first, second = repo
    assert diff_service.get_changed_files(first, second, path) == ["b.txt"]


def test_identical_commits_give_an_empty_diff_not_an_error(repo):
    path, first, _ = repo
    assert diff_service.get_changed_files(first, first, path) == []


def test_unknown_sha_raises_instead_of_returning_empty(repo):
    path, _, second = repo
    missing = "d8eaaba824655046958d1a97f11780de460c3271"
    with pytest.raises(diff_service.DiffUnavailable):
        diff_service.get_changed_files(missing, second, path)


def test_clone_requests_history_only_when_asked(monkeypatch):
    """with_history must drop --depth=1, which is what made diffs impossible."""
    seen = {}

    class R:
        returncode = 0
        stderr = ""

    def fake_run(cmd, **kw):
        seen["cmd"] = cmd
        return R()

    monkeypatch.setattr(repo_service.subprocess, "run", fake_run)

    repo_service.clone_repo("https://example.com/x.git")
    assert "--depth=1" in seen["cmd"] and "--filter=blob:none" not in seen["cmd"]

    repo_service.clone_repo("https://example.com/x.git", with_history=True)
    assert "--depth=1" not in seen["cmd"] and "--filter=blob:none" in seen["cmd"]
