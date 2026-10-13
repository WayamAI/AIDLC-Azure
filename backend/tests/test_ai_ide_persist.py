from pathlib import Path

import pytest

from app.services import ai_ide_service


def test_hydrate_workspace_from_disk(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(ai_ide_service, "_ai_ide_root", tmp_path)
    ai_ide_service._workspaces.clear()
    ai_ide_service._workspace_meta.clear()

    ws_id = "ws-disk-1"
    root = tmp_path / ws_id
    (root / "src").mkdir(parents=True)
    (root / "src" / "App.tsx").write_text("export default function App() { return null; }\n", encoding="utf-8")
    (root / "_meta.json").write_text('{"repo_url": "https://github.com/acme/demo"}', encoding="utf-8")

    files = ai_ide_service.get_workspace_files(ws_id)
    assert "src/App.tsx" in files
    meta = ai_ide_service.get_workspace_meta(ws_id)
    assert meta["repo_url"] == "https://github.com/acme/demo"
    assert "github_token" not in (files)

    ai_ide_service._workspaces.clear()
    ai_ide_service._workspace_meta.clear()
    files_again = ai_ide_service.get_workspace_files(ws_id)
    assert files_again["src/App.tsx"].startswith("export default")


def test_require_org_workspace_rejects_other_org(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(ai_ide_service, "_ai_ide_root", tmp_path)
    ai_ide_service._workspaces.clear()
    ai_ide_service._workspace_meta.clear()

    ws_id = "ws-org-a"
    root = tmp_path / ws_id
    (root / "src").mkdir(parents=True)
    (root / "src" / "App.tsx").write_text("export default function App() { return null; }\n", encoding="utf-8")
    (root / "_meta.json").write_text(
        '{"org_id": "org_a", "repo_url": "https://github.com/acme/demo"}',
        encoding="utf-8",
    )

    meta = ai_ide_service.require_org_workspace("org_a", ws_id)
    assert meta["org_id"] == "org_a"

    with pytest.raises(KeyError):
        ai_ide_service.require_org_workspace("org_b", ws_id)


def test_legacy_workspace_without_org_id_is_inaccessible(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(ai_ide_service, "_ai_ide_root", tmp_path)
    ai_ide_service._workspaces.clear()
    ai_ide_service._workspace_meta.clear()

    ws_id = "ws-legacy"
    root = tmp_path / ws_id
    (root / "src").mkdir(parents=True)
    (root / "src" / "App.tsx").write_text("export default function App() { return null; }\n", encoding="utf-8")
    (root / "_meta.json").write_text("{}", encoding="utf-8")

    with pytest.raises(KeyError):
        ai_ide_service.require_org_workspace("org_a", ws_id)
