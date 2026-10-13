"""Repo clone/extract helpers used by Live Tests."""
import subprocess
from pathlib import Path

from app.services import repo_service


def test_extract_codebase_prefers_web_ui_over_backend_api(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(repo_service, "MAX_TOTAL_CHARS", 400)

    (tmp_path / "api").mkdir()
    (tmp_path / "web" / "src" / "pages").mkdir(parents=True)
    (tmp_path / "api" / "routes.py").write_text("BACKEND_PAD = '" + ("x" * 500) + "'\n", encoding="utf-8")
    (tmp_path / "web" / "src" / "pages" / "Login.tsx").write_text(
        "export default function Login() { return <form>Sign In</form> }\n",
        encoding="utf-8",
    )
    (tmp_path / "web" / "src" / "App.tsx").write_text(
        "export default function App() { return <div>Novel OS</div> }\n",
        encoding="utf-8",
    )

    blob = repo_service.extract_codebase(str(tmp_path))
    assert "Login.tsx" in blob
    assert "App.tsx" in blob
    assert blob.index("App.tsx") < blob.index("routes.py") if "routes.py" in blob else True


def test_detect_default_branch_parses_symref(monkeypatch):
    def fake_run(*_args, **_kwargs):
        class Result:
            returncode = 0
            stdout = "ref: refs/heads/dev\tHEAD\n1bd4b57\tHEAD\n"
            stderr = ""
        return Result()

    monkeypatch.setattr(subprocess, "run", fake_run)
    assert repo_service.detect_default_branch("https://github.com/mrigankad/Novel-OS.git") == "dev"
