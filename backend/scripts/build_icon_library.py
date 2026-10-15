"""Build the unified App Builder icon library (frontend/public/marks + marks_manifest.json).

Sources (read-only):
  icon3d    Wayam 3D icon library: transparent 256px exports, described by MANIFEST.csv
            (only rows with status == accepted whose PNG exists)
  manthan   Manthan 3D icons, already 256px transparent
  setu      Setu PNGs (512px) resized to 256px; JPG/MD skipped; PNGs with no transparent
            pixel are skipped
  wayameye  WayamEye 2048px icons resized to 256px; the icon-3d- prefix is dropped from the id

The Chronos marks (mark-*, status-*) already in the manifest are kept. Every written PNG is
saved with optimize=True. Re-running is idempotent.

Usage (from backend/):
  .venv/Scripts/python.exe scripts/build_icon_library.py [--dry-run]

ICON_SOURCES_ROOT overrides the default source root (the Desktop folder that holds
"Wayam Asset Prompts", "Manthan", "Setu" and "Wayam AI").
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
from pathlib import Path

from PIL import Image

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent
MARKS_OUT = REPO_DIR / "frontend" / "public" / "marks"
MANIFEST_OUT = BACKEND_DIR / "app" / "templates" / "marks_manifest.json"

ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
CHRONOS_PREFIXES = ("mark-", "status-")
TARGET_PX = 256
MAX_HINT_WORDS = 10

SOURCES_ROOT = Path(os.getenv("ICON_SOURCES_ROOT") or Path.home() / "Desktop")
ICON3D_DIR = SOURCES_ROOT / "Wayam Asset Prompts" / "icon-library" / "exports-transparent" / "256"
ICON3D_MANIFEST = SOURCES_ROOT / "Wayam Asset Prompts" / "icon-library" / "MANIFEST.csv"
MANTHAN_DIR = SOURCES_ROOT / "Manthan" / "public" / "images" / "icons" / "3d"
SETU_DIR = SOURCES_ROOT / "Setu" / "frontend" / "public" / "images" / "setu"
WAYAMEYE_DIR = SOURCES_ROOT / "Wayam AI" / "Presentations" / "WayamEye" / "icons"


def normalise_id(raw: str) -> str:
    """Lowercase; each run of characters outside [a-z0-9] becomes one hyphen."""
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]", "-", raw.lower())).strip("-")


def trim_words(text: str, limit: int = MAX_HINT_WORDS) -> str:
    """First clause of the MANIFEST object text (when it has 3+ words), capped at `limit` words."""
    clause = re.split(r"[,;:(]", text.strip(), maxsplit=1)[0].strip()
    if len(clause.split()) < 3:
        clause = text.strip()
    return " ".join(clause.rstrip(".").split()[:limit])


def hint_from_stem(stem: str, label: str) -> str:
    """Short hint derived from the id words, e.g. 'Blueprint autonomy icon, Manthan'."""
    words = " ".join(stem.replace("-", " ").split())
    return f"{words[:1].upper()}{words[1:]} icon, {label}"


def load_chronos_entries() -> list[dict]:
    """Chronos entries from the existing manifest, kept as they are (category/source set)."""
    if not MANIFEST_OUT.exists():
        return []
    data = json.loads(MANIFEST_OUT.read_text(encoding="utf-8"))
    return [
        {"id": e["id"], "hint": e["hint"], "category": "chronos", "source": "chronos"}
        for e in data.get("marks", [])
        if e.get("source", "chronos") == "chronos" and e["id"].startswith(CHRONOS_PREFIXES)
    ]


def icon3d_entries() -> list[tuple[dict, Path]]:
    """Accepted MANIFEST rows whose PNG exists -> (manifest entry, source PNG)."""
    out = []
    with ICON3D_MANIFEST.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            if row["status"].strip() != "accepted":
                continue
            src = ICON3D_DIR / Path(row["file"]).name
            if not src.is_file():
                continue
            mark_id = normalise_id(src.stem)
            if mark_id != src.stem:
                raise SystemExit(f"icon3d stem is not a valid id: {src.stem}")
            entry = {
                "id": mark_id,
                "hint": trim_words(row["object"]) or hint_from_stem(src.stem, "3D"),
                "category": normalise_id(row["category"]),
                "source": "icon3d",
            }
            out.append((entry, src))
    return out


def write_png(image: Image.Image, mark_id: str, dry_run: bool) -> None:
    if dry_run:
        return
    MARKS_OUT.mkdir(parents=True, exist_ok=True)
    image.save(MARKS_OUT / f"{mark_id}.png", format="PNG", optimize=True)


def fit_256(image: Image.Image) -> Image.Image:
    if image.size == (TARGET_PX, TARGET_PX):
        return image
    return image.resize((TARGET_PX, TARGET_PX), Image.Resampling.LANCZOS)


def family_entries(src_dir: Path, family: str, label: str, strip_prefix: str = "") -> tuple[list[dict], int]:
    """Resize (if needed), write and describe every PNG of a plain family. Skips JPG and other types."""
    entries, skipped = [], 0
    for src in sorted(src_dir.glob("*.png")):
        stem = src.stem[len(strip_prefix):] if strip_prefix and src.stem.startswith(strip_prefix) else src.stem
        with Image.open(src) as opened:
            image = opened.convert("RGBA")
        if family == "setu" and image.getchannel("A").getextrema()[0] == 255:
            skipped += 1  # no transparent pixel at all: not an icon cut-out
            continue
        mark_id = normalise_id(f"{family}-{stem}")
        write_png(fit_256(image), mark_id, DRY_RUN)
        entries.append({"id": mark_id, "hint": hint_from_stem(stem, label), "category": family, "source": family})
    return entries, skipped


def write_icon3d(jobs: list[tuple[dict, Path]]) -> None:
    for _, src in jobs:
        with Image.open(src) as opened:
            image = opened.convert("RGBA")
        write_png(fit_256(image), normalise_id(src.stem), DRY_RUN)


DRY_RUN = False


def main() -> int:
    global DRY_RUN
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="report only; write nothing")
    DRY_RUN = parser.parse_args().dry_run

    chronos = load_chronos_entries()
    icon_jobs = icon3d_entries()
    write_icon3d(icon_jobs)
    manthan, _ = family_entries(MANTHAN_DIR, "manthan", "Manthan")
    wayameye, _ = family_entries(WAYAMEYE_DIR, "wayameye", "WayamEye", strip_prefix="icon-3d-")
    setu, setu_skipped = family_entries(SETU_DIR, "setu", "Setu")

    entries = chronos + [e for e, _ in icon_jobs] + manthan + setu + wayameye
    ids = [e["id"] for e in entries]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        raise SystemExit(f"duplicate ids: {dupes[:10]}")
    bad = [i for i in ids if not ID_RE.match(i)]
    if bad:
        raise SystemExit(f"invalid ids: {bad[:10]}")

    counts: dict[str, int] = {}
    for e in entries:
        counts[e["source"]] = counts.get(e["source"], 0) + 1
    print("entries per source:", counts)
    print(f"setu PNGs skipped (no transparency): {setu_skipped}")

    if not DRY_RUN:
        MANIFEST_OUT.write_text(
            json.dumps({"version": 2, "marks": entries}, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        pngs = list(MARKS_OUT.glob("*.png"))
        print(f"manifest entries: {len(entries)} -> {MANIFEST_OUT}")
        print(f"marks folder: {len(pngs)} PNGs, {sum(p.stat().st_size for p in pngs) / 1_048_576:.1f} MiB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
