"""App Builder zip download: org-scoped, excludes build/VCS folders, names the folder after the app."""
import io
import zipfile
from pathlib import Path

from app.auth.session import COOKIE_NAME, create_session_cookie
from app.services import ai_ide_service
from app.services import organization_service


def _template() -> dict[str, str]:
    return {
        "package.json": '{"name": "Demo Shop!", "private": true}',
        "src/App.tsx": "export default function App() { return null; }\n",
        ".git/HEAD": "ref: refs/heads/main\n",
        "node_modules/left-pad/index.js": "module.exports = 1;\n",
        "dist/index.html": "<html></html>\n",
    }


def _reset(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(ai_ide_service, "_ai_ide_root", tmp_path)
    monkeypatch.setattr(ai_ide_service, "_template_cache", _template())
    ai_ide_service._workspaces.clear()
    ai_ide_service._workspace_meta.clear()


def _cookie(org_id: str) -> dict[str, str]:
    return {"Cookie": f"{COOKIE_NAME}={create_session_cookie(user_id='user', org_id=org_id)}"}


async def test_download_returns_app_zip_scoped_to_org(app_client, db, tmp_path, monkeypatch):
    _reset(tmp_path, monkeypatch)
    org = await organization_service.create_organization(db, workos_org_id="org_dl_a", name="A")
    other = await organization_service.create_organization(db, workos_org_id="org_dl_b", name="B")
    ws_id = await ai_ide_service.create_workspace(str(org.id), db=db)

    resp = await app_client.get(f"/api/ai-ide/workspace/{ws_id}/download", headers=_cookie(str(org.id)))
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    assert resp.headers["content-disposition"] == 'attachment; filename="demo-shop.zip"'

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        names = set(zf.namelist())
        assert "demo-shop/package.json" in names
        assert "demo-shop/src/App.tsx" in names
        # The README is added only because the template has none.
        assert "demo-shop/README.md" in names
        readme = zf.read("demo-shop/README.md").decode("utf-8").splitlines()
        assert len(readme) == 4 and readme[1] == "Install dependencies: npm install"
        assert not any(n.endswith("_meta.json") for n in names)
        assert not any(n.startswith("demo-shop/.git/") for n in names)
        assert not any(n.startswith("demo-shop/node_modules/") for n in names)
        assert not any(n.startswith("demo-shop/dist/") for n in names)

    other_resp = await app_client.get(f"/api/ai-ide/workspace/{ws_id}/download", headers=_cookie(str(other.id)))
    assert other_resp.status_code == 404


async def test_download_falls_back_to_chakram_app_without_package_name(app_client, db, tmp_path, monkeypatch):
    _reset(tmp_path, monkeypatch)
    monkeypatch.setattr(ai_ide_service, "_template_cache", {"index.html": "<html></html>", "README.md": "# Mine\n"})
    org = await organization_service.create_organization(db, workos_org_id="org_dl_c", name="C")
    ws_id = await ai_ide_service.create_workspace(str(org.id), db=db)

    resp = await app_client.get(f"/api/ai-ide/workspace/{ws_id}/download", headers=_cookie(str(org.id)))
    assert resp.status_code == 200
    assert resp.headers["content-disposition"] == 'attachment; filename="chakram-app.zip"'
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        names = set(zf.namelist())
        assert "chakram-app/index.html" in names
        # An existing README is kept as-is, not replaced.
        assert zf.read("chakram-app/README.md").decode("utf-8") == "# Mine\n"


async def test_download_includes_the_marks_the_app_uses(app_client, db, tmp_path, monkeypatch):
    _reset(tmp_path, monkeypatch)
    marks = tmp_path / "marks"
    marks.mkdir()
    (marks / "mark-gavel.png").write_bytes(b"\x89PNG-gavel")
    monkeypatch.setenv("MARKS_DIR", str(marks))
    monkeypatch.setattr(
        ai_ide_service,
        "_template_cache",
        {"package.json": '{"name": "Mark Shop"}', "src/App.tsx": 'export default () => <img src="/marks/mark-gavel.png" />;\n'},
    )
    org = await organization_service.create_organization(db, workos_org_id="org_dl_m", name="M")
    ws_id = await ai_ide_service.create_workspace(str(org.id), db=db)

    resp = await app_client.get(f"/api/ai-ide/workspace/{ws_id}/download", headers=_cookie(str(org.id)))
    assert resp.status_code == 200
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        assert zf.read("mark-shop/public/marks/mark-gavel.png") == b"\x89PNG-gavel"
        assert "mark-shop/src/App.tsx" in set(zf.namelist())
        assert "mark-shop/public/marks/mark-gavel.png" in set(zf.namelist())
