"""App Builder generation runs.

A run plans an app and writes its files to the workspace in a background task.
It does not depend on the WebSocket that started it: when the page reloads or
the connection drops, the run keeps going and the client re-attaches to it.
A subscriber gets a snapshot of everything so far (plan, finished files, the
file streaming now, failures) and then the live events.

Runs live in this process, which is fine for the single-instance deployment;
`get()` on another worker simply finds no run.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

from app.engines.generator import stream_file, strip_code_fences
from app.engines.injector import inject_routes, nav_items
from app.engines.planner import plan_files
from app.services import ai_ide_service

logger = logging.getLogger(__name__)

PLANNER_TIMEOUT = 90.0
FILE_TIMEOUT = 90.0
_FINISHED_RUN_TTL = 30 * 60
# Pages only depend on the shared files written before them, so several stream at once.
PAGE_CONCURRENCY = 3

_runs: dict[str, "GenerationRun"] = {}

# A closing tag or a self-closing component tag: JSX, which a .ts file cannot contain.
# (TypeScript generics like Array<string> never close with "</" or "/>".)
_JSX_MARKERS = re.compile(r"</[A-Za-z][\w.]*\s*>|<[A-Z][\w.]*(?:\s[^<>]*)?/>")


def has_jsx(code: str) -> bool:
    return bool(_JSX_MARKERS.search(code))


def route_module(path: str) -> str:
    """'src/pages/Home.tsx' and './pages/Home' both become 'pages/Home'."""
    module = path.replace("\\", "/").strip()
    for prefix in ("./", "src/"):
        if module.startswith(prefix):
            module = module[len(prefix):]
    for suffix in (".tsx", ".ts", ".jsx", ".js"):
        if module.endswith(suffix):
            module = module[: -len(suffix)]
    return module


def normalize_plan_path(path: str) -> str:
    """'./src/pages/Home.tsx' and a backslash path both become 'src/pages/Home.tsx'."""
    path = path.strip().replace("\\", "/")
    while path.startswith("./"):
        path = path[2:]
    return path.lstrip("/")


@dataclass
class _FileState:
    status: str  # "streaming" | "done" | "error"
    content: str = ""
    message: str = ""


@dataclass
class GenerationRun:
    workspace_id: str
    org_id: str
    idea: str
    started_at: float = field(default_factory=time.monotonic)
    finished_at: float | None = None
    plan_event: dict | None = None
    files: dict[str, _FileState] = field(default_factory=dict)
    order: list[str] = field(default_factory=list)
    app_tsx: str | None = None
    last_status: str | None = None
    final_event: dict | None = None
    subscribers: list[asyncio.Queue] = field(default_factory=list)
    task: asyncio.Task | None = None

    @property
    def finished(self) -> bool:
        return self.final_event is not None

    # ── Events ────────────────────────────────────────────────────────────
    def emit(self, event: dict) -> None:
        self._record(event)
        for queue in list(self.subscribers):
            queue.put_nowait(event)

    def _record(self, event: dict) -> None:
        kind = event.get("type")
        path = event.get("path")
        if kind == "PLAN":
            self.plan_event = event
        elif kind == "STATUS":
            self.last_status = event.get("message")
        elif kind == "FILE_CREATE":
            self.files[path] = _FileState(status="streaming")
            if path not in self.order:
                self.order.append(path)
        elif kind == "STREAM_TOKEN":
            state = self.files.get(path)
            if state is not None:
                state.content += event.get("token", "")
        elif kind == "FILE_UPDATE":
            if path == "src/App.tsx":
                self.app_tsx = event.get("content", "")
            elif path in self.files:
                self.files[path].content = event.get("content", "")
        elif kind == "FILE_RENAMED":
            old, new = event.get("from"), event.get("to")
            state = self.files.pop(old, None) or _FileState(status="streaming")
            state.content = event.get("content", state.content)
            self.files[new] = state
            self.order = [new if p == old else p for p in self.order]
            if new not in self.order:
                self.order.append(new)
        elif kind == "FILE_DONE":
            state = self.files.setdefault(path, _FileState(status="done"))
            state.status = "done"
        elif kind == "FILE_ERROR":
            state = self.files.setdefault(path, _FileState(status="error"))
            state.status = "error"
            state.message = event.get("message", "")
        elif kind in ("GENERATION_DONE", "ERROR"):
            self.final_event = event
            self.finished_at = time.monotonic()

    def snapshot(self) -> list[dict]:
        """Events that bring a new subscriber up to date with the run so far."""
        events: list[dict] = []
        if self.plan_event is not None:
            events.append(self.plan_event)
        for path in self.order:
            state = self.files[path]
            events.append({"type": "FILE_CREATE", "path": path})
            if state.status == "done":
                events.append({"type": "FILE_UPDATE", "path": path, "content": state.content})
                events.append({"type": "FILE_DONE", "path": path})
            elif state.status == "error":
                events.append({"type": "FILE_ERROR", "path": path, "message": state.message})
            elif state.content:
                events.append({"type": "STREAM_TOKEN", "path": path, "token": state.content})
        if self.app_tsx is not None:
            events.append({"type": "FILE_UPDATE", "path": "src/App.tsx", "content": self.app_tsx})
        if self.last_status and self.final_event is None:
            events.append({"type": "STATUS", "message": self.last_status})
        if self.final_event is not None:
            events.append(self.final_event)
        return events

    def subscribe(self) -> asyncio.Queue:
        """A queue holding the snapshot, then every later event. Atomic: nothing is missed."""
        queue: asyncio.Queue = asyncio.Queue()
        for event in self.snapshot():
            queue.put_nowait(event)
        if not self.finished:
            self.subscribers.append(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        if queue in self.subscribers:
            self.subscribers.remove(queue)


def get(workspace_id: str) -> GenerationRun | None:
    return _runs.get(workspace_id)


def start(workspace_id: str, org_id: str, idea: str) -> GenerationRun:
    """Start a run for the workspace. An unfinished run is returned instead of started twice."""
    _evict_old()
    existing = _runs.get(workspace_id)
    if existing is not None and not existing.finished:
        return existing
    run = GenerationRun(workspace_id=workspace_id, org_id=org_id, idea=idea)
    _runs[workspace_id] = run
    # The task inherits the caller's context (the org's model and connectors).
    run.task = asyncio.get_running_loop().create_task(_execute(run))
    return run


def _evict_old() -> None:
    now = time.monotonic()
    for workspace_id, run in list(_runs.items()):
        if run.finished and run.finished_at is not None and now - run.finished_at > _FINISHED_RUN_TTL:
            del _runs[workspace_id]


async def _note(workspace_id: str, **fields: Any) -> None:
    """Record app info for the apps list; never allowed to break a build."""
    update = getattr(ai_ide_service, "update_app_info", None)
    if update is None:
        return
    try:
        await update(workspace_id, **fields)
    except Exception:  # noqa: BLE001
        logger.exception("[AI IDE] could not record app info for %s", workspace_id)


async def _execute(run: GenerationRun) -> None:
    try:
        await _note(run.workspace_id, idea=run.idea[:2000], status="generating")
        await _generate(run)
    except asyncio.CancelledError:
        run.emit({"type": "ERROR", "message": "Generation was cancelled"})
        raise
    except Exception as exc:  # noqa: BLE001 - the client gets the reason, whatever it is
        logger.exception("[AI IDE] generation failed for workspace %s", run.workspace_id)
        run.emit({"type": "ERROR", "message": str(exc)})
    finally:
        final = run.final_event or {}
        ok = final.get("type") == "GENERATION_DONE" and not final.get("files_failed")
        await _note(run.workspace_id, status="done" if ok else "error")


async def _generate(run: GenerationRun) -> None:
    workspace_id = run.workspace_id
    emit = run.emit

    emit({"type": "STATUS", "message": "Planning your app…"})
    try:
        plan = await asyncio.wait_for(plan_files(run.idea), timeout=PLANNER_TIMEOUT)
    except asyncio.TimeoutError:
        emit({"type": "ERROR", "message": f"Planner timed out after {int(PLANNER_TIMEOUT)}s. Try a shorter idea."})
        return
    except Exception as exc:
        emit({"type": "ERROR", "message": f"Planner error: {exc}"})
        return

    files_list = [
        f for f in plan.get("files", [])
        if isinstance(f, dict) and isinstance(f.get("path"), str) and f["path"].strip()
    ]
    routes_list = [
        r for r in plan.get("routes", [])
        if isinstance(r, dict) and all(isinstance(r.get(k), str) for k in ("path", "component", "importPath"))
    ]
    if not files_list:
        emit({"type": "ERROR", "message": "Planner returned no files"})
        return

    # Every file knows the app it belongs to, so each prompt carries the same name and look.
    app_name = str(plan.get("app_name") or "").strip()
    color_theme = str(plan.get("color_theme") or "").strip()
    component_names = [
        str(f.get("component_name") or "")
        for f in files_list
        if normalize_plan_path(f["path"]).startswith("src/components/") and f.get("component_name")
    ]
    for file_spec in files_list:
        file_spec["path"] = normalize_plan_path(file_spec["path"])
        if app_name:
            file_spec.setdefault("app_name", app_name)
        if color_theme:
            file_spec.setdefault("color_theme", color_theme)
        # So the Navbar links to real routes and pages import components that exist.
        file_spec["routes"] = routes_list
        file_spec["components"] = component_names

    if app_name:
        await _note(workspace_id, name=app_name)
    emit({
        "type": "PLAN",
        "app_name": app_name,
        "description": str(plan.get("description") or ""),
        "files": [f["path"] for f in files_list],
        "routes": routes_list,
    })
    emit({"type": "STATUS", "message": f"Plan ready: generating {len(files_list)} file(s)…"})

    def _wire_routes(done_modules: set[str], final: bool = False) -> None:
        """Point App.tsx at the pages generated so far; a failure here is reported, not fatal.

        The sidebar lists every planned page while the run is going (unbuilt ones show the
        shell's placeholder); the final pass keeps only pages that were generated.
        """
        wired = [r for r in routes_list if route_module(r["importPath"]) in done_modules]
        nav = nav_items(wired if final else routes_list)
        try:
            app_tsx = ai_ide_service.read_file(workspace_id, "src/App.tsx")
            updated_app = inject_routes(app_tsx, wired, nav=nav, app_name=app_name or None)
            if updated_app == app_tsx:
                return
            ai_ide_service.save_file(workspace_id, "src/App.tsx", updated_app)
            emit({"type": "FILE_UPDATE", "path": "src/App.tsx", "content": updated_app})
        except Exception as exc:
            emit({"type": "STATUS", "message": f"Warning: route injection failed {exc}"})

    failed_files: list[dict] = []
    generated_modules: set[str] = set()
    routed_modules = {route_module(r["importPath"]) for r in routes_list}

    # The app's name and full navigation are known from the plan: show them right away.
    _wire_routes(generated_modules)

    # Shared code written so far, shown to later prompts so pages match it.
    written_context: dict[str, str] = {}

    async def _generate_one(file_spec: dict) -> None:
        path = file_spec["path"]
        file_spec["context_files"] = dict(written_context)
        emit({"type": "FILE_CREATE", "path": path})

        async def _collect_file() -> str:
            parts: list[str] = []
            async for token in stream_file(file_spec, org_id=run.org_id):
                parts.append(token)
                emit({"type": "STREAM_TOKEN", "path": path, "token": token})
            return "".join(parts)

        error: str | None = None
        content = ""
        try:
            content = await asyncio.wait_for(_collect_file(), timeout=FILE_TIMEOUT)
        except asyncio.TimeoutError:
            error = f"Generation timed out after {int(FILE_TIMEOUT)}s"
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            error = f"Generation failed: {exc}"

        # Models sometimes wrap the file in a markdown fence despite the prompt;
        # the file on disk is the code, so the client gets the cleaned text.
        cleaned = strip_code_fences(content) if error is None else ""
        if error is None and not cleaned.strip():
            error = "The model returned no code"

        if error is not None:
            # Nothing is written for a failed file: no placeholder is saved as generated code.
            failed_files.append({"path": path, "message": error})
            emit({"type": "FILE_ERROR", "path": path, "message": error})
            emit({"type": "STATUS", "message": f"Failed to generate {path}: {error}"})
            return

        if path.endswith(".ts") and has_jsx(cleaned):
            # The model put JSX in a .ts file. As .tsx it compiles, and imports written
            # without an extension ('../data/store') still resolve.
            new_path = path[:-3] + ".tsx"
            ai_ide_service.save_file(workspace_id, new_path, cleaned)
            emit({"type": "FILE_RENAMED", "from": path, "to": new_path, "content": cleaned})
            path = new_path
        else:
            ai_ide_service.save_file(workspace_id, path, cleaned)
            if cleaned != content:
                emit({"type": "FILE_UPDATE", "path": path, "content": cleaned})
        emit({"type": "FILE_DONE", "path": path})
        if not path.startswith("src/pages/"):
            written_context[path] = cleaned

        # A finished page is routable right away, so the preview shows it as it lands.
        module = route_module(path)
        generated_modules.add(module)
        if module in routed_modules:
            _wire_routes(generated_modules)

    # Shared files first, one at a time (later ones may import earlier ones) ...
    shared = [f for f in files_list if not f["path"].startswith("src/pages/")]
    pages = [f for f in files_list if f["path"].startswith("src/pages/")]
    for file_spec in shared:
        await _generate_one(file_spec)

    # ... then pages in parallel: each sees all shared files and none depends on another page.
    gate = asyncio.Semaphore(max(1, PAGE_CONCURRENCY))

    async def _page(file_spec: dict) -> None:
        async with gate:
            await _generate_one(file_spec)

    await asyncio.gather(*(_page(f) for f in pages))

    # Final pass leaves out routes (and menu entries) for files that were not generated.
    _wire_routes(generated_modules, final=True)

    emit({
        "type": "GENERATION_DONE",
        "files_total": len(files_list),
        "files_generated": len(files_list) - len(failed_files),
        "files_failed": len(failed_files),
        "failed_files": failed_files,
    })


def reset_for_tests() -> None:
    _runs.clear()
