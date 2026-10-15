"""Shared 3D icon ("mark") library for the App Builder.

The PNGs live in the frontend's public folder (served at /marks/<id>.png) and the
manifest in app/templates/marks_manifest.json lists each id with a short hint for
the LLM. Generated code refers to a mark by its id; the backend copies the PNG into
the workspace so the project renders it, and the zip download includes it.
"""
import functools
import json
import os
import re
from pathlib import Path

MARK_ID_RE = re.compile(r"\b(?:mark|status|icon3d|manthan|setu|wayameye)-[a-z0-9-]+\b")
_SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".jsx"}
_APP_DIR = Path(__file__).resolve().parents[1]  # backend/app
_MANIFEST_PATH = _APP_DIR / "templates" / "marks_manifest.json"


def marks_dir() -> Path | None:
    """First existing folder of mark PNGs: $MARKS_DIR, the dev frontend, then the production static build."""
    candidates = [
        os.getenv("MARKS_DIR") or "",
        # backend/app/services -> repo root -> frontend/public/marks (dev and tests)
        str(_APP_DIR.parents[1] / "frontend" / "public" / "marks"),
        # Docker: /app/app/services -> /app -> /app/static/marks (copied frontend build)
        str(_APP_DIR.parent / "static" / "marks"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_dir():
            return Path(candidate)
    return None


@functools.lru_cache(maxsize=1)
def manifest() -> list[dict]:
    data = json.loads(_MANIFEST_PATH.read_text(encoding="utf-8"))
    return list(data.get("marks", []))


def known_ids() -> set[str]:
    return {entry["id"] for entry in manifest()}


def used_marks(files: dict[str, str]) -> list[str]:
    """Known mark ids referenced by source files (.ts/.tsx/.js/.jsx), sorted."""
    known = known_ids()
    found: set[str] = set()
    for path, content in files.items():
        if Path(path).suffix.lower() not in _SOURCE_SUFFIXES:
            continue
        found.update(m for m in MARK_ID_RE.findall(content) if m in known)
    return sorted(found)


def mark_bytes(mark_id: str) -> bytes | None:
    """PNG bytes for a known mark id; None for anything else (no path traversal)."""
    if mark_id not in known_ids():
        return None
    folder = marks_dir()
    if folder is None:
        return None
    path = folder / f"{mark_id}.png"
    return path.read_bytes() if path.is_file() else None


_STOPWORDS = {"and", "the", "for", "with", "that", "this", "from", "into", "your", "about", "icon", "icons"}
_TOKEN_RE = re.compile(r"[a-z0-9]+")
_SOURCE_RANK = {"icon3d": 0, "chronos": 1}
# Top-up pool when the text overlaps too little: generic 3D icons and the Chronos marks.
_DEFAULT_CATEGORIES = {"analytics-and-charts", "data-and-databases", "interface-actions", "automation-and-workflow"}


def _stem(word: str) -> str:
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    if word.endswith("s") and not word.endswith("ss") and len(word) > 3:
        return word[:-1]
    return word


def _tokens(text: str) -> set[str]:
    words = (_stem(w) for w in _TOKEN_RE.findall(text.lower()) if len(w) >= 3)
    return {w for w in words if w not in _STOPWORDS}


def relevant_marks(text: str, limit: int = 40) -> list[dict]:
    """The `limit` manifest entries that best match `text`, most relevant first.

    Score = shared word tokens between `text` and the entry's id, hint and category. Ties prefer
    icon3d, then chronos, then the other families, then manifest order. When fewer than `limit`
    entries overlap, the rest come from a stable default set so the result is always full.
    """
    wanted = _tokens(text or "")
    ranked = []
    for index, entry in enumerate(manifest()):
        overlap = len(wanted & _tokens(f"{entry['id']} {entry['hint']} {entry['category']}"))
        if overlap:
            rank = _SOURCE_RANK.get(entry.get("source", ""), 2)
            ranked.append((-overlap, rank, index, entry))
    ranked.sort(key=lambda item: item[:3])
    chosen = [item[3] for item in ranked[:limit]]

    if len(chosen) < limit:
        taken = {entry["id"] for entry in chosen}
        for entry in manifest():
            if len(chosen) >= limit:
                break
            generic = entry.get("source") == "chronos" or (
                entry.get("source") == "icon3d" and entry.get("category") in _DEFAULT_CATEGORIES
            )
            if generic and entry["id"] not in taken:
                chosen.append(entry)
                taken.add(entry["id"])
    return [dict(entry) for entry in chosen[:limit]]


def prompt_catalog(text: str | None = None, limit: int = 40) -> str:
    """One line per mark, `id: hint`, for an LLM prompt.

    With `text`, only the marks relevant to it (see relevant_marks). Without it, the first
    `limit` manifest entries.
    """
    entries = relevant_marks(text, limit) if text is not None else manifest()[:limit]
    return "\n".join(f"{entry['id']}: {entry['hint']}" for entry in entries)
