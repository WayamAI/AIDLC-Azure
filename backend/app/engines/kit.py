"""The Chronos UI kit shipped inside every generated app, and its reference for the LLM.

Generated pages compose these ready-made components instead of hand-writing
cards, tables, charts and navigation, so each file the model writes is short
and every app has the same client-facing look.

Kit sources live in app/templates/chronos_kit/src/** (copied into each new
workspace); KIT_API.md is the compact reference given to the model.
"""
from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

KIT_ROOT = Path(__file__).resolve().parent.parent / "templates" / "chronos_kit"


@lru_cache(maxsize=1)
def kit_files() -> dict[str, str]:
    """Workspace path -> text for every kit source file (empty when the kit is missing)."""
    src = KIT_ROOT / "src"
    if not src.is_dir():
        logger.warning("[Kit] %s not found; generated apps will not include the Chronos kit", src)
        return {}
    files: dict[str, str] = {}
    for path in sorted(src.rglob("*")):
        if path.is_file() and (path.suffix in {".ts", ".tsx", ".css", ".json"} or path.name == "VERSION"):
            files[path.relative_to(KIT_ROOT).as_posix()] = path.read_text(encoding="utf-8")
    return files


def has_kit() -> bool:
    return bool(kit_files())


def kit_version(files: dict[str, str]) -> int:
    """The kit version recorded in a file set (0 when unknown)."""
    try:
        return int((files.get("src/chronos/VERSION") or "0").strip() or 0)
    except ValueError:
        return 0


def outdated_kit_files(workspace_files: dict[str, str]) -> dict[str, str]:
    """Kit files to write into an app built with an older kit ({} when current or not a kit app).

    Only apps that already contain the kit are updated; the kit's own files are replaced
    wholesale, so edits made directly inside src/chronos are lost on a kit upgrade.
    """
    current = kit_files()
    if not current or "src/chronos/index.ts" not in workspace_files:
        return {}
    if kit_version(workspace_files) >= kit_version(current):
        return {}
    return {path: text for path, text in current.items() if workspace_files.get(path) != text}


@lru_cache(maxsize=1)
def kit_api() -> str:
    path = KIT_ROOT / "KIT_API.md"
    return path.read_text(encoding="utf-8").strip() if path.is_file() else ""


def marks_catalog(context: str | None = None, limit: int = 40) -> str:
    """`id: hint` lines for the 3D icons most relevant to `context` ('' when unavailable).

    The library holds ~900 icons; listing all of them would cost far more prompt tokens
    than the page itself, so each prompt gets the best matches only.
    """
    try:
        from app.services import marks_service

        return marks_service.prompt_catalog(context, limit)
    except Exception:  # noqa: BLE001 - the catalogue is optional prompt context
        return ""
