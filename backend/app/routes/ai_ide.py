"""AI IDE routes workspace creation (REST) + streaming generation (WebSocket)."""
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.config import settings
from app.auth.dependencies import get_current_org
from app.database import get_db
from app.engines.injector import inject_routes
from app.engines.planner import plan_files
from app.engines.generator import stream_file
from app.models.organization import OrganizationOut
from app.services import ai_ide_service
from app.services import ai_service
from app.services import connector_settings_service as connectors
from app.services import organization_service
from app.services import vercel_service
from app.services.workspace_service import WorkspaceExpiredError

router = APIRouter(prefix="/ai-ide", tags=["AI IDE"])


async def _attach_workspace(
    request: Request,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
) -> None:
    """Load the request's workspace from the registry; 410 when its files are gone."""
    workspace_id = request.path_params.get("workspace_id")
    if not workspace_id:
        try:
            body = await request.json()
        except ValueError:
            body = None
        workspace_id = body.get("workspace_id") if isinstance(body, dict) else None
    if isinstance(workspace_id, str) and workspace_id:
        await ai_ide_service.attach(db, org.id, workspace_id)


def _require_org_workspace(org: OrganizationOut, workspace_id: str) -> None:
    try:
        ai_ide_service.require_org_workspace(org.id, workspace_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Workspace not found")


class CreateFileRequest(BaseModel):
    workspace_id: str
    path: str
    content: str = ""


class UpdateFileRequest(BaseModel):
    workspace_id: str
    path: str
    content: str


class DeletePathRequest(BaseModel):
    workspace_id: str
    path: str


class RenamePathRequest(BaseModel):
    workspace_id: str
    from_path: str
    to_path: str


class MovePathRequest(BaseModel):
    workspace_id: str
    from_path: str
    to_path: str


class GitInitPushRequest(BaseModel):
    workspace_id: str
    github_token: str
    repo_name: str
    private: bool = True
    description: str = ""
    branch: str = "main"


class GitCommitPushRequest(BaseModel):
    workspace_id: str
    message: str = "chore: update AI IDE workspace"
    branch: str | None = None


class DeployWorkspaceRequest(BaseModel):
    workspace_id: str
    branch: str | None = None
    target: str = "production"


# ── REST ─────────────────────────────────────────────────────────────────────

@router.post("/workspace/create")
async def create_workspace(org: OrganizationOut = Depends(get_current_org), db=Depends(get_db)):
    workspace_id = await ai_ide_service.create_workspace(org.id, db=db)
    files = ai_ide_service.list_file_paths(workspace_id)
    return {"workspace_id": workspace_id, "file_paths": files}


@router.get("/workspace/{workspace_id}/files", dependencies=[Depends(_attach_workspace)])
async def get_files(workspace_id: str, org: OrganizationOut = Depends(get_current_org)):
    _require_org_workspace(org, workspace_id)
    return ai_ide_service.get_workspace_files(workspace_id)


@router.post("/file/create", dependencies=[Depends(_attach_workspace)])
async def create_file(payload: CreateFileRequest, org: OrganizationOut = Depends(get_current_org)):
    _require_org_workspace(org, payload.workspace_id)
    # An empty new file stays empty: nothing is written that the user did not provide.
    ai_ide_service.create_file(payload.workspace_id, payload.path, payload.content)
    return {"ok": True, "path": payload.path, "content": payload.content}


@router.post("/file/update", dependencies=[Depends(_attach_workspace)])
async def update_file(payload: UpdateFileRequest, org: OrganizationOut = Depends(get_current_org)):
    _require_org_workspace(org, payload.workspace_id)
    ai_ide_service.save_file(payload.workspace_id, payload.path, payload.content)
    return {"ok": True, "path": payload.path}


@router.post("/file/delete", dependencies=[Depends(_attach_workspace)])
async def delete_file(payload: DeletePathRequest, org: OrganizationOut = Depends(get_current_org)):
    _require_org_workspace(org, payload.workspace_id)
    deleted = ai_ide_service.delete_path(payload.workspace_id, payload.path)
    return {"ok": True, "deleted": deleted}


@router.post("/file/rename", dependencies=[Depends(_attach_workspace)])
async def rename_path(payload: RenamePathRequest, org: OrganizationOut = Depends(get_current_org)):
    _require_org_workspace(org, payload.workspace_id)
    updated = ai_ide_service.rename_or_move_path(
        payload.workspace_id,
        payload.from_path,
        payload.to_path,
    )
    return {"ok": True, "updated": updated}


@router.post("/file/move", dependencies=[Depends(_attach_workspace)])
async def move_path(payload: MovePathRequest, org: OrganizationOut = Depends(get_current_org)):
    _require_org_workspace(org, payload.workspace_id)
    updated = ai_ide_service.rename_or_move_path(
        payload.workspace_id,
        payload.from_path,
        payload.to_path,
    )
    return {"ok": True, "updated": updated}


@router.post("/git/init-and-push", dependencies=[Depends(_attach_workspace)])
async def ai_ide_git_init_and_push(
    payload: GitInitPushRequest,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    _require_org_workspace(org, payload.workspace_id)
    try:
        result = await ai_ide_service.init_git_and_create_repo(
            workspace_id=payload.workspace_id,
            github_token=payload.github_token,
            repo_name=payload.repo_name,
            private=payload.private,
            description=payload.description,
            branch=payload.branch,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    await ai_ide_service.register(db, payload.workspace_id)
    return result


@router.post("/git/commit-and-push", dependencies=[Depends(_attach_workspace)])
async def ai_ide_git_commit_and_push(
    payload: GitCommitPushRequest,
    org: OrganizationOut = Depends(get_current_org),
    db=Depends(get_db),
):
    _require_org_workspace(org, payload.workspace_id)
    try:
        result = await ai_ide_service.commit_and_push_workspace(
            workspace_id=payload.workspace_id,
            message=payload.message,
            branch=payload.branch,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    await ai_ide_service.register(db, payload.workspace_id)
    return result


@router.post("/deploy", dependencies=[Depends(_attach_workspace)])
async def ai_ide_deploy(payload: DeployWorkspaceRequest, org: OrganizationOut = Depends(get_current_org)):
    _require_org_workspace(org, payload.workspace_id)
    meta = ai_ide_service.get_workspace_meta(payload.workspace_id)
    repo_url = meta.get("repo_url")
    if not repo_url:
        raise HTTPException(status_code=400, detail="Initialize and push repository before deploying")

    branch = (payload.branch or meta.get("default_branch") or "main").strip() or "main"
    return await vercel_service.trigger_deployment(
        branch=branch,
        repo_url=repo_url,
        commit_sha=None,
        target=payload.target,
    )


# ── WebSocket ─────────────────────────────────────────────────────────────────

def _route_module(path: str) -> str:
    """'src/pages/Home.tsx' and './pages/Home' both become 'pages/Home'."""
    module = path.replace("\\", "/").strip()
    for prefix in ("./", "src/"):
        if module.startswith(prefix):
            module = module[len(prefix):]
    for suffix in (".tsx", ".ts", ".jsx", ".js"):
        if module.endswith(suffix):
            module = module[: -len(suffix)]
    return module


def _ws_session_payload(ws: WebSocket) -> dict | None:
    """Read and verify the session cookie. Does not touch the socket state."""
    import jwt
    from app.auth.session import COOKIE_NAME, decode_session_cookie

    token = ws.cookies.get(COOKIE_NAME)
    if not token:
        return None
    try:
        return decode_session_cookie(token)
    except jwt.InvalidTokenError:
        return None


def _ws_origin_allowed(ws: WebSocket) -> bool:
    """Browsers send the session cookie on cross-site WebSocket handshakes, so check who is asking.

    Allowed: the app's own origin (same host as the request), FRONTEND_URL and CORS_ORIGINS.
    A client that sends no Origin header (not a browser) still needs a valid session cookie.
    """
    origin = (ws.headers.get("origin") or "").rstrip("/").lower()
    if not origin:
        return True
    host = (ws.headers.get("host") or "").lower()
    if host and origin.split("://", 1)[-1] == host:
        return True
    allowed = {o.rstrip("/").lower() for o in settings.CORS_ORIGINS}
    if settings.FRONTEND_URL:
        allowed.add(settings.FRONTEND_URL.rstrip("/").lower())
    return origin in allowed


@router.websocket("/ws/generate/{workspace_id}")
async def generate(ws: WebSocket, workspace_id: str):
    """
    Protocol:
      client → server : plain text idea  (first message)
      server → client : typed JSON events (see WSEvent schema below)

    Events:
      {"type": "STATUS",         "message": str}
      {"type": "FILE_CREATE",    "path": str}
      {"type": "STREAM_TOKEN",   "path": str, "token": str}
      {"type": "FILE_DONE",      "path": str}
      {"type": "FILE_ERROR",     "path": str, "message": str}
      {"type": "FILE_UPDATE",    "path": str, "content": str}
      {"type": "GENERATION_DONE", "files_total": int, "files_generated": int,
                                  "files_failed": int, "failed_files": [{"path", "message"}]}
      {"type": "ERROR",          "message": str}

    FILE_ERROR means that file was not generated and nothing was written for
    it; generation continues with the next file. ERROR ends the generation.
    """
    # Accept first (ASGI-safe), then enforce session via cookie.
    await ws.accept()
    if not _ws_origin_allowed(ws):
        await ws.send_json({"type": "ERROR", "message": "This page is not allowed to open the generation channel"})
        await ws.close(code=1008)
        return
    payload = _ws_session_payload(ws)
    org_id = payload.get("org_id") if payload else None
    if not org_id:
        await ws.send_json({"type": "ERROR", "message": "Not authenticated"})
        await ws.close(code=1008)
        return

    # Same per-org context get_current_org sets for HTTP requests, so the org's
    # own model/key is used and usage is attributed to it.
    org_token = None
    conn_token = None
    try:
        db = get_db()
        org = await organization_service.get_by_id(db, org_id)
        if org is None:
            await ws.send_json({"type": "ERROR", "message": "Organization not yet provisioned"})
            await ws.close(code=1008)
            return
        org_token = ai_service.set_current_org_id(org.id)
        raw_connectors = await connectors.get_raw(db, org.id)
        conn_token = connectors.set_current_org_connectors(
            raw_connectors, platform=connectors.is_platform_org(org)
        )

        try:
            await ai_ide_service.attach(db, org_id, workspace_id)
            ai_ide_service.require_org_workspace(org_id, workspace_id)
        except WorkspaceExpiredError as exc:
            await ws.send_json({"type": "ERROR", "message": str(exc)})
            await ws.close(code=4010)
            return
        except KeyError:
            await ws.send_json({"type": "ERROR", "message": "Workspace not found"})
            await ws.close(code=4004)
            return

        # Step 1: receive idea
        idea = await ws.receive_text()
        if not idea.strip():
            await ws.send_json({"type": "ERROR", "message": "Empty idea"})
            return

        # Step 2: plan
        await ws.send_json({"type": "STATUS", "message": "Planning your app…"})
        try:
            plan = await asyncio.wait_for(plan_files(idea), timeout=90.0)
        except asyncio.TimeoutError:
            await ws.send_json({"type": "ERROR", "message": "Planner timed out after 90s. Try a shorter idea."})
            return
        except Exception as exc:
            await ws.send_json({"type": "ERROR", "message": f"Planner error: {exc}"})
            return

        files_list = plan.get("files", [])
        routes_list = plan.get("routes", [])

        if not files_list:
            await ws.send_json({"type": "ERROR", "message": "Planner returned no files"})
            return

        await ws.send_json({
            "type": "STATUS",
            "message": f"Plan ready generating {len(files_list)} file(s)…",
        })

        # Step 3: generate each file with streaming
        failed_files: list[dict] = []
        for file_spec in files_list:
            path = file_spec.get("path", "src/pages/Page.tsx")

            await ws.send_json({"type": "FILE_CREATE", "path": path})

            async def _collect_file() -> str:
                parts: list[str] = []
                async for token in stream_file(file_spec, org_id=org_id):
                    parts.append(token)
                    await ws.send_json({"type": "STREAM_TOKEN", "path": path, "token": token})
                return "".join(parts)

            error: str | None = None
            content = ""
            try:
                content = await asyncio.wait_for(_collect_file(), timeout=90.0)
            except asyncio.TimeoutError:
                error = "Generation timed out after 90s"
            except WebSocketDisconnect:
                raise
            except Exception as exc:
                error = f"Generation failed: {exc}"
            if error is None and not content.strip():
                error = "The model returned no content"

            if error is not None:
                # Nothing is written for a failed file: no placeholder is saved as generated code.
                failed_files.append({"path": path, "message": error})
                await ws.send_json({"type": "FILE_ERROR", "path": path, "message": error})
                await ws.send_json({"type": "STATUS", "message": f"Failed to generate {path}: {error}"})
                continue

            ai_ide_service.save_file(workspace_id, path, content)
            await ws.send_json({"type": "FILE_DONE", "path": path})

        # Step 4: inject routes into App.tsx, leaving out routes to files that were not generated
        failed_modules = {_route_module(f["path"]) for f in failed_files}
        routes_list = [
            r for r in routes_list
            if isinstance(r, dict) and _route_module(str(r.get("importPath", ""))) not in failed_modules
        ]
        if routes_list:
            try:
                app_tsx = ai_ide_service.read_file(workspace_id, "src/App.tsx")
                updated_app = inject_routes(app_tsx, routes_list)
                ai_ide_service.save_file(workspace_id, "src/App.tsx", updated_app)
                await ws.send_json({
                    "type": "FILE_UPDATE",
                    "path": "src/App.tsx",
                    "content": updated_app,
                })
            except Exception as exc:
                # Non-fatal: generation still completed, just routes not injected
                await ws.send_json({
                    "type": "STATUS",
                    "message": f"Warning: route injection failed {exc}",
                })

        await ws.send_json({
            "type": "GENERATION_DONE",
            "files_total": len(files_list),
            "files_generated": len(files_list) - len(failed_files),
            "files_failed": len(failed_files),
            "failed_files": failed_files,
        })

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await ws.send_json({"type": "ERROR", "message": str(exc)})
        except Exception:
            pass
    finally:
        if conn_token is not None:
            connectors.reset_current_org_connectors(conn_token)
        if org_token is not None:
            ai_service.reset_current_org_id(org_token)
