"""Marks: ids used by source are found, only known PNGs are served or written, binaries never load as text."""
import re

import pytest

from app.services import ai_ide_service as svc
from app.services import marks_service

PNG = b"\x89PNG\r\n\x1a\n" + b"fake-png-body"


@pytest.fixture
def marks_folder(tmp_path, monkeypatch):
    folder = tmp_path / "marks"
    folder.mkdir()
    (folder / "mark-gavel.png").write_bytes(PNG)
    monkeypatch.setenv("MARKS_DIR", str(folder))
    return folder


def test_used_marks_finds_known_ids_in_tsx_and_ignores_unknown(marks_folder):
    files = {
        "src/Hero.tsx": 'export const H = () => <img src="/marks/mark-gavel.png" alt="" data-s="status-open" />;\n'
                        'const x = "mark-not-a-real-mark";\n',
        "src/notes.py": '"mark-agent"',
    }
    assert marks_service.used_marks(files) == ["mark-gavel", "status-open"]


def test_mark_bytes_serves_only_known_ids(marks_folder):
    assert marks_service.mark_bytes("mark-gavel") == PNG
    assert marks_service.mark_bytes("../x") is None
    assert marks_service.mark_bytes("../../mark-gavel") is None
    assert marks_service.mark_bytes("mark-not-a-real-mark") is None


def test_materialize_writes_used_png_and_disk_load_skips_binaries(tmp_path, marks_folder, monkeypatch):
    monkeypatch.setattr(svc, "_ai_ide_root", tmp_path)
    ws = "ws-marks"
    root = tmp_path / ws
    (root / "src").mkdir(parents=True)
    (root / "src" / "Hero.tsx").write_text('<img src="/marks/mark-gavel.png" />', encoding="utf-8")
    svc._workspaces[ws] = {"src/Hero.tsx": '<img src="/marks/mark-gavel.png" />'}
    svc._workspace_meta[ws] = {"workspace_id": ws, "org_id": "o", "root_dir": str(root)}
    try:
        assert svc.materialize_marks(ws) == ["mark-gavel"]
        assert (root / "public" / "marks" / "mark-gavel.png").read_bytes() == PNG
        # Identical files are not rewritten.
        assert svc.materialize_marks(ws) == []

        loaded = svc._load_workspace_from_disk(ws)
        assert loaded is not None
        assert "public/marks/mark-gavel.png" not in loaded
        assert "src/Hero.tsx" in loaded
    finally:
        svc._workspaces.pop(ws, None)
        svc._workspace_meta.pop(ws, None)


ID_SHAPE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def test_manifest_has_unique_valid_ids_for_every_family():
    entries = marks_service.manifest()
    ids = [e["id"] for e in entries]
    assert len(entries) > 800
    assert len(ids) == len(set(ids))
    assert all(ID_SHAPE.match(i) for i in ids)
    sources = {e["source"] for e in entries}
    assert {"chronos", "icon3d", "manthan", "setu", "wayameye"} <= sources
    assert all(e["hint"].strip() and e["category"] for e in entries)


def test_every_manifest_id_has_a_png_on_disk():
    folder = marks_service.marks_dir()
    assert folder is not None
    missing = [e["id"] for e in marks_service.manifest() if not (folder / f"{e['id']}.png").is_file()]
    assert missing == []


def test_relevant_marks_returns_full_limit_and_surfaces_booking_or_money_icons():
    picked = marks_service.relevant_marks("hotel booking revenue occupancy")
    assert len(picked) == 40
    top = " ".join(f"{e['id']} {e['hint']}" for e in picked[:10]).lower()
    assert any(word in top for word in ("booking", "revenue", "money"))


def test_relevant_marks_fills_to_limit_without_overlap():
    picked = marks_service.relevant_marks("zzqx nothing matches this", limit=25)
    assert len(picked) == 25
    assert len({e["id"] for e in picked}) == 25


def test_prompt_catalog_is_capped_and_text_filtered():
    assert len(marks_service.prompt_catalog().splitlines()) == 40
    lines = marks_service.prompt_catalog("hotel booking revenue occupancy").splitlines()
    assert [line.split(": ", 1)[0] for line in lines] == [e["id"] for e in marks_service.relevant_marks("hotel booking revenue occupancy")]


def test_used_marks_finds_icon3d_id_in_tsx():
    tsx = 'export const Hero = () => <img src="/marks/icon3d-booking-ticket-pair.png" alt="" />;\n'
    assert marks_service.used_marks({"src/Hero.tsx": tsx}) == ["icon3d-booking-ticket-pair"]


def test_mark_id_regex_matches_every_family():
    text = "mark-gavel status-open icon3d-spark-orbit-rings manthan-blueprint-autonomy setu-mark-ai wayameye-analytics"
    assert marks_service.MARK_ID_RE.findall(text) == [
        "mark-gavel", "status-open", "icon3d-spark-orbit-rings", "manthan-blueprint-autonomy",
        "setu-mark-ai", "wayameye-analytics",
    ]
