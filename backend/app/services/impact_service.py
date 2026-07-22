"""
Code Impact + Test Intelligence service.

Responsibilities:
 1. Fetch changed files from GitHub (PR or commit)
 2. Fetch file contents & parse imports to build a dependency graph
 3. Compute root→leaf impact paths (topological layers)
 4. AI-powered test generation from impacted code
 5. AI-powered document parsing → scenario extraction → test generation
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import uuid
from pathlib import PurePosixPath
from typing import Any, Dict, List, Optional, Set, Tuple

import httpx
import pathlib
import git
from asyncio import gather

from app.config import settings
from app.services.ai_service import call_ai
from app.models.impact_models import (
    DocScenario,
    GeneratedTest,
    GraphEdge,
    GraphNode,
    ImpactPlaywrightTest,
)

log = logging.getLogger("impact_service")

# ── GitHub helpers ─────────────────────────────────────────────────────────────

_GITHUB_API = "https://api.github.com"
_GH_HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}

RELEVANT_EXTS = {
    ".ts", ".tsx", ".js", ".jsx", ".py", ".vue",
    ".mts", ".cts", ".mjs", ".cjs",
}

SKIP_PATTERNS = {
    "node_modules", ".git", "dist", "build", ".next", "__pycache__",
    ".venv", "coverage", "test", "tests", "__tests__", "spec",
    ".test.", ".spec.", "*.min.js",
}

_WORKSPACE_GRAPH_CACHE: Dict[str, Dict[str, Any]] = {}
_IMPORT_RESOLUTION_CACHE: Dict[tuple, Optional[str]] = {}  # (raw, from_file) → resolved_path
_GIT_STATUS_CACHE: Dict[str, Dict[str, Any]] = {}  # workspace_id → status_data


def _gh_headers() -> Dict[str, str]:
    h = dict(_GH_HEADERS)
    if settings.GITHUB_TOKEN:
        h["Authorization"] = f"Bearer {settings.GITHUB_TOKEN}"
    return h


async def _gh_get(path: str, params: Optional[dict] = None) -> Any:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{_GITHUB_API}{path}", headers=_gh_headers(), params=params)
        r.raise_for_status()
        return r.json()


# ── Changed-file fetching ──────────────────────────────────────────────────────

async def get_pr_changed_files(owner: str, repo: str, pr_number: int) -> Tuple[List[dict], dict]:
    """Return (changed_files, pr_meta)."""
    pr_data = await _gh_get(f"/repos/{owner}/{repo}/pulls/{pr_number}")
    files = await _gh_get(
        f"/repos/{owner}/{repo}/pulls/{pr_number}/files",
        {"per_page": 100},
    )
    changed = [
        {
            "path": f["filename"],
            "status": f["status"],
            "patch": f.get("patch", ""),
            "ref": pr_data["head"]["sha"],
        }
        for f in files
        if _is_relevant(f["filename"])
    ]
    meta = {
        "title": pr_data["title"],
        "url": pr_data["html_url"],
        "ref": pr_data["head"]["sha"],
    }
    return changed, meta


async def get_commit_changed_files(owner: str, repo: str, sha: str) -> Tuple[List[dict], dict]:
    """Return (changed_files, commit_meta)."""
    data = await _gh_get(f"/repos/{owner}/{repo}/commits/{sha}")
    changed = [
        {
            "path": f["filename"],
            "status": f.get("status", "modified"),
            "patch": f.get("patch", ""),
            "ref": sha,
        }
        for f in data.get("files", [])
        if _is_relevant(f["filename"])
    ]
    msg = data["commit"]["message"].splitlines()[0]
    meta = {"title": msg, "url": data["html_url"], "ref": sha}
    return changed, meta


def _is_relevant(path: str) -> bool:
    p = PurePosixPath(path)
    if p.suffix not in RELEVANT_EXTS:
        return False
    parts = set(p.parts)
    for skip in SKIP_PATTERNS:
        if skip in parts:
            return False
    name = p.name
    if ".test." in name or ".spec." in name or ".min." in name:
        return False
    return True


# ── File content ───────────────────────────────────────────────────────────────

async def fetch_file_content(owner: str, repo: str, path: str, ref: Optional[str] = None) -> str:
    """Fetch raw file content from GitHub API."""
    params = {"ref": ref} if ref else {}
    try:
        data = await _gh_get(f"/repos/{owner}/{repo}/contents/{path}", params)
        raw = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
        return raw
    except Exception:
        return ""


# ── Import parsing ─────────────────────────────────────────────────────────────

_TS_IMPORT_RE = re.compile(
    r'''(?:import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+|from\s+)['"]([^'"]+)['"]''',
    re.MULTILINE,
)
_REQUIRE_RE = re.compile(r'''require\s*\(\s*['"]([^'"]+)['"]\s*\)''')
# Matches: from module.sub import X  OR  import module.sub
_PY_IMPORT_RE = re.compile(r'''(?:from\s+([a-zA-Z0-9_\.]+)\s+import)|(?:import\s+([a-zA-Z0-9_\.]+))''')


def _parse_imports(content: str, file_ext: str) -> List[str]:
    imports: List[str] = []
    if file_ext in {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue"}:
        for m in _TS_IMPORT_RE.finditer(content):
            s = m.group(1)
            if s and (s.startswith(".") or s.startswith("@/")):
                imports.append(s)
        for m in _REQUIRE_RE.finditer(content):
            s = m.group(1)
            if s and s.startswith("."):
                imports.append(s)
    elif file_ext == ".py":
        for m in _PY_IMPORT_RE.finditer(content):
            s = m.group(1) or m.group(2)
            if s:
                imports.append(s)
    return imports


def _resolve_import(raw: str, from_file: str, all_paths: Set[str]) -> Optional[str]:
    """Resolve a relative or absolute import specifier to an actual file path in all_paths."""
    base_dir = str(PurePosixPath(from_file).parent)

    # 1. Handle @/ alias → treat as src/ prefix
    if raw.startswith("@/"):
        raw = "src/" + raw[2:]
        base_dir = ""

    # 2. Convert absolute dot-notation (Python) to slashes
    if "." in raw and not raw.startswith("."):
        slash_candidate = raw.replace(".", "/")
        for ext in (".py", ".ts", ".tsx", ".js", "/__init__.py"):
            if slash_candidate + ext in all_paths:
                return slash_candidate + ext

    # 3. Handle relative imports
    if from_file.endswith(".py") and raw.startswith("."):
        # Python relative imports: .module, ..module, etc.
        dots = len(raw) - len(raw.lstrip("."))
        module_name = raw.lstrip(".")
        
        parts = list(PurePosixPath(base_dir).parts) if base_dir and base_dir != "." else []
        for _ in range(dots - 1):
            if parts:
                parts.pop()
                
        if module_name:
            parts.extend(module_name.split("."))
            
        candidate = "/".join(parts)
    elif raw.startswith("."):
        # JS/TS relative imports: ./module, ../module
        candidate = str(PurePosixPath(base_dir) / raw) if base_dir and base_dir != "." else raw
        # lstrip("./") is problematic if the directory starts with a character 'a'... wait no, 
        # it strips characters. Let's just resolve via PurePosixPath
        candidate = str(PurePosixPath(candidate))
    else:
        candidate = raw

    # 4. Try exact match then common extensions
    for ext in ("", ".ts", ".tsx", ".js", ".jsx", ".py", "/index.ts", "/index.tsx", "/index.js", "/__init__.py"):
        full = candidate + ext
        if full in all_paths:
            return full
        
        # Also try replacing dots with slashes for the whole candidate
        full_slash = candidate.replace(".", "/") + ext
        if full_slash in all_paths:
            return full_slash
            
    return None


def _resolve_import_cached(raw: str, from_file: str, all_paths: Set[str]) -> Optional[str]:
    """Cached version of import resolution to avoid redundant work."""
    cache_key = (raw, from_file)
    if cache_key in _IMPORT_RESOLUTION_CACHE:
        return _IMPORT_RESOLUTION_CACHE[cache_key]
    result = _resolve_import(raw, from_file, all_paths)
    _IMPORT_RESOLUTION_CACHE[cache_key] = result
    # Limit cache size to prevent memory bloat
    if len(_IMPORT_RESOLUTION_CACHE) > 5000:
        # Clear half of the cache
        keys_to_delete = list(_IMPORT_RESOLUTION_CACHE.keys())[:2500]
        for k in keys_to_delete:
            del _IMPORT_RESOLUTION_CACHE[k]
    return result


def _collect_workspace_source_files(ws_path: pathlib.Path, max_files: int = 5000) -> Set[str]:
    """Collect workspace source files with limit to prevent scanning huge monorepos."""
    all_files: Set[str] = set()
    file_count = 0
    for root, dirs, files in os.walk(ws_path):
        dirs[:] = [
            d for d in dirs
            if d not in {
                "node_modules", "__pycache__", ".git", "dist", "build",
                ".venv", "venv", ".next", "coverage", ".mypy_cache", "vendor",
            }
            and not d.startswith(".")
        ]
        for fname in files:
            if file_count >= max_files:
                log.warning(f"Reached file limit ({max_files}) during workspace scan, returning partial results")
                return all_files
            fpath = pathlib.Path(root) / fname
            rel = str(fpath.relative_to(ws_path))
            if _is_relevant(rel):
                all_files.add(rel)
                file_count += 1
    return all_files


def _workspace_graph_signature(ws_path: pathlib.Path, all_files: Set[str]) -> Tuple[Tuple[str, int], ...]:
    pairs: List[Tuple[str, int]] = []
    for rel in sorted(all_files):
        try:
            mtime_ns = (ws_path / rel).stat().st_mtime_ns
        except Exception:
            mtime_ns = 0
        pairs.append((rel, mtime_ns))
    return tuple(pairs)


def _build_workspace_adjacency(
    ws_path: pathlib.Path,
    all_files: Set[str],
) -> Tuple[Dict[str, List[str]], Dict[str, List[str]]]:
    cache_key = str(ws_path)
    signature = _workspace_graph_signature(ws_path, all_files)
    cached = _WORKSPACE_GRAPH_CACHE.get(cache_key)
    if cached and cached.get("signature") == signature:
        return cached["adjacency"], cached["reverse_adjacency"]

    file_contents: Dict[str, str] = {}
    for rel in all_files:
        try:
            file_contents[rel] = (ws_path / rel).read_text(errors="replace")[:40_000]
        except Exception:
            file_contents[rel] = ""

    adjacency: Dict[str, List[str]] = {}
    reverse_adjacency: Dict[str, List[str]] = {f: [] for f in all_files}
    for rel in all_files:
        ext = pathlib.Path(rel).suffix
        raw_imports = _parse_imports(file_contents.get(rel, ""), ext)
        resolved: List[str] = []
        for imp in raw_imports:
            dep = _resolve_import(imp, rel, all_files)
            if dep and dep != rel:
                resolved.append(dep)
                reverse_adjacency.setdefault(dep, []).append(rel)
        adjacency[rel] = sorted(set(resolved))

    _WORKSPACE_GRAPH_CACHE[cache_key] = {
        "signature": signature,
        "adjacency": adjacency,
        "reverse_adjacency": reverse_adjacency,
    }
    return adjacency, reverse_adjacency


def _map_porcelain_status(code: str) -> Optional[str]:
    x = code[0] if len(code) > 0 else " "
    y = code[1] if len(code) > 1 else " "
    if x == "?" and y == "?":
        return "U"
    if x in {"A", "C"}:
        return "A"
    if x == "D" or y == "D":
        return "D"
    if x in {"M", "R"} or y in {"M", "R"}:
        return "M"
    return None


def _parse_git_porcelain_status(repo: git.Repo) -> Dict[str, str]:
    status_map: Dict[str, str] = {}
    output = repo.git.status("--porcelain")
    for raw_line in output.splitlines():
        line = raw_line.rstrip()
        if len(line) < 3:
            continue
        code = line[:2]
        path_part = line[3:].strip()
        if "->" in path_part:
            path_part = path_part.split("->", 1)[1].strip()
        if path_part.startswith('"') and path_part.endswith('"'):
            path_part = path_part[1:-1]

        if not path_part:
            continue
        status = _map_porcelain_status(code)
        if not status:
            continue
        if _is_relevant(path_part):
            status_map[path_part] = status
    return status_map


def build_workspace_commit_impact_tree(
    workspace_id: str,
    max_depth: int = 4,
) -> Dict[str, Any]:
    """
    Build a root-to-leaf impact tree for the commit view.
    Roots are changed files (M/U/A). Children are import dependencies.
    """
    from app.services.workspace_service import get_workspace

    ws = get_workspace(workspace_id)
    ws_path = pathlib.Path(ws["clone_dir"])
    if not ws_path.exists():
        raise ValueError(f"Workspace {workspace_id} not found")

    repo = git.Repo(str(ws_path))
    status_map = _parse_git_porcelain_status(repo)

    all_files = _collect_workspace_source_files(ws_path)
    if not all_files:
        return {
            "workspace_id": workspace_id,
            "roots": [],
            "summary": {
                "root_count": 0,
                "node_count": 0,
                "max_depth": 0,
                "status_counts": {"M": 0, "U": 0, "A": 0, "D": 0},
            },
        }

    adjacency, reverse_adjacency = _build_workspace_adjacency(ws_path, all_files)

    root_paths = sorted(
        p for p, s in status_map.items()
        if s in {"M", "U", "A"} and p in all_files
    )

    def build_node(path: str, depth: int, trail: Set[str]) -> Dict[str, Any]:
        deps = adjacency.get(path, [])
        children: List[Dict[str, Any]] = []
        if depth < max_depth:
            for child in deps:
                if child in trail:
                    continue
                children.append(build_node(child, depth + 1, trail | {path}))

        status = status_map.get(path, " ")
        return {
            "id": path,
            "path": path,
            "name": PurePosixPath(path).name,
            "status": status,
            "depth": depth,
            "is_entry": depth == 0,
            "imports_count": len(deps),
            "impacted_by_count": len(reverse_adjacency.get(path, [])),
            "children": children,
        }

    roots = [build_node(path, 0, set()) for path in root_paths]

    def count_nodes(nodes: List[Dict[str, Any]]) -> int:
        total = 0
        for node in nodes:
            total += 1 + count_nodes(node.get("children", []))
        return total
    
    def tree_max_depth(nodes: List[Dict[str, Any]]) -> int:
        deepest = 0
        for node in nodes:
            node_depth = int(node.get("depth", 0))
            child_depth = tree_max_depth(node.get("children", []))
            deepest = max(deepest, node_depth, child_depth)
        return deepest
    
    # OPTIMIZATION: Compute both in single pass
    node_count = count_nodes(roots)
    max_depth = tree_max_depth(roots)

    status_counts = {"M": 0, "U": 0, "A": 0, "D": 0}
    for status in status_map.values():
        if status in status_counts:
            status_counts[status] += 1

    return {
        "workspace_id": workspace_id,
        "roots": roots,
        "summary": {
            "root_count": len(roots),
            "node_count": node_count,
            "max_depth": max_depth,
            "status_counts": status_counts,
        },
    }


# ── Dependency graph builder ───────────────────────────────────────────────────

async def build_dependency_graph(
    owner: str,
    repo: str,
    changed_files: List[dict],
    ref: str,
) -> Tuple[List[GraphNode], List[GraphEdge], Dict[str, Any]]:
    """
    Build a dependency graph by:
     1. Starting from changed files
     2. Fetching their content + parsing imports
     3. BFS outward to discover direct dependencies (1 hop upstream/downstream)
     4. Assigning topological layers + layout positions
    """
    # Collect all repo source files for resolving imports
    try:
        tree_data = await _gh_get(
            f"/repos/{owner}/{repo}/git/trees/{ref}",
            {"recursive": "1"},
        )
        all_paths: Set[str] = {
            item["path"] for item in tree_data.get("tree", [])
            if item["type"] == "blob" and _is_relevant(item["path"])
        }
    except Exception:
        all_paths = {f["path"] for f in changed_files}

    # BFS: start from changed files, explore up to 2 hops
    visited: Set[str] = set()
    adjacency: Dict[str, List[str]] = {}   # file → files it imports
    reverse_adj: Dict[str, List[str]] = {} # file → files that import it

    queue: List[Tuple[str, int, Optional[str]]] = [
        (f["path"], 0, f.get("ref", ref)) for f in changed_files
    ]
    changed_set: Set[str] = {f["path"] for f in changed_files}

    while queue:
        # Batch fetch: collect unvisited files at current depth for concurrent fetching
        current_batch = []
        next_queue = []
        
        for path, depth, file_ref in queue:
            if path not in visited and depth < 2:
                current_batch.append((path, depth, file_ref or ref))
            elif path not in visited:
                next_queue.append((path, depth, file_ref))
        
        # Concurrent fetch instead of sequential
        if current_batch:
            fetch_tasks = [
                fetch_file_content(owner, repo, path, file_ref)
                for path, _, file_ref in current_batch
            ]
            contents = await gather(*fetch_tasks, return_exceptions=True)
            
            for (path, depth, file_ref), content in zip(current_batch, contents):
                if path in visited:
                    continue
                visited.add(path)
                adjacency[path] = []
                reverse_adj.setdefault(path, [])
                
                if isinstance(content, Exception):
                    log.debug(f"Failed to fetch {path}: {content}")
                    continue
                    
                ext = PurePosixPath(path).suffix
                raw_imports = _parse_imports(content, ext)

                for raw in raw_imports:
                    resolved = _resolve_import_cached(raw, path, all_paths)
                    if resolved and resolved != path:
                        adjacency[path].append(resolved)
                        reverse_adj.setdefault(resolved, [])
                        reverse_adj[resolved].append(path)
                        if resolved not in visited:
                            next_queue.append((resolved, depth + 1, ref))
        
        queue = next_queue

    # Topological layer assignment (BFS from roots)
    # Root = no incoming edges in our subgraph
    in_degree: Dict[str, int] = {p: 0 for p in visited}
    for src, targets in adjacency.items():
        for tgt in targets:
            if tgt in in_degree:
                in_degree[tgt] = in_degree.get(tgt, 0) + 1

    layer: Dict[str, int] = {}
    roots = [p for p, d in in_degree.items() if d == 0]
    bfs = [(r, 0) for r in roots]
    while bfs:
        node, lyr = bfs.pop(0)
        layer[node] = max(layer.get(node, 0), lyr)
        for child in adjacency.get(node, []):
            if child in visited:
                bfs.append((child, lyr + 1))

    # Ensure every node has a layer
    for p in visited:
        layer.setdefault(p, 0)

    # Sort nodes per layer
    layers: Dict[int, List[str]] = {}
    for p, lyr in layer.items():
        layers.setdefault(lyr, []).append(p)
    for lyr_nodes in layers.values():
        lyr_nodes.sort()

    # Layout constants
    NODE_W, NODE_H = 200, 44
    H_GAP, V_GAP = 40, 80
    max_per_layer = max((len(v) for v in layers.values()), default=1)
    canvas_w = max_per_layer * (NODE_W + H_GAP) + H_GAP

    # Build GraphNode list
    impacted_set: Set[str] = set(changed_set)
    for ch in changed_set:
        for dep in reverse_adj.get(ch, []):
            impacted_set.add(dep)

    nodes: List[GraphNode] = []
    for lyr, lyr_nodes in sorted(layers.items()):
        total = len(lyr_nodes)
        row_w = total * NODE_W + (total - 1) * H_GAP
        start_x = (canvas_w - row_w) / 2
        for i, path in enumerate(lyr_nodes):
            x = start_x + i * (NODE_W + H_GAP)
            y = lyr * (NODE_H + V_GAP) + V_GAP
            p = PurePosixPath(path)
            nodes.append(GraphNode(
                id=path,
                path=path,
                name=p.name,
                ext=p.suffix,
                is_changed=path in changed_set,
                is_impacted=path in impacted_set and path not in changed_set,
                layer=lyr,
                layer_index=i,
                x=x,
                y=y,
            ))

    # Build edges
    edges: List[GraphEdge] = []
    seen_edges: Set[Tuple[str, str]] = set()
    for src, targets in adjacency.items():
        for tgt in targets:
            if tgt in visited:
                key = (src, tgt)
                if key not in seen_edges:
                    seen_edges.add(key)
                    edges.append(GraphEdge(source=src, target=tgt))

    # Build sidebar tree
    tree = _build_tree(list(visited))

    return nodes, edges, tree


# ── Workspace dependency graph (local files) ──────────────────────────────────

def build_workspace_dependency_graph(
    workspace_id: str,
    focus_paths: Optional[List[str]] = None,
) -> Tuple[List[GraphNode], List[GraphEdge]]:
    """
    Build a dependency graph for a cloned workspace.
    focus_paths: list of changed/selected file paths to centre the graph on.
    If omitted, uses all workspace source files.
    Returns (nodes, edges) with x/y layout positions set.
    """
    ws_dir = PurePosixPath("/tmp/workspaces") / workspace_id
    ws_path = pathlib.Path(str(ws_dir))
    if not ws_path.exists():
        raise ValueError(f"Workspace {workspace_id} not found")

    # ── Gather all source files with limit ─────────────────────────────────────
    all_files: Set[str] = set()
    file_count = 0
    max_file_scan = 5000
    for root, dirs, files in os.walk(ws_path):
        dirs[:] = [
            d for d in dirs
            if d not in {"node_modules", "__pycache__", ".git", "dist", "build",
                         ".venv", "venv", ".next", "coverage", ".mypy_cache", "vendor"}
            and not d.startswith(".")
        ]
        for fname in files:
            if file_count >= max_file_scan:
                log.warning(f"Workspace scan limit ({max_file_scan}) reached")
                break
            fpath = pathlib.Path(root) / fname
            if fpath.suffix in RELEVANT_EXTS:
                rel = str(fpath.relative_to(ws_path))
                all_files.add(rel)
                file_count += 1

    # ── Read file contents (lazy: only focus files + sample) ──────────────────
    # Load only focus files or a small sample to avoid memory bloat
    file_contents: Dict[str, str] = {}
    focus_set_initial = (set(focus_paths) & all_files) if focus_paths else set()
    files_to_load = focus_set_initial or list(all_files)[:200]  # Load focus files OR sample 200
    
    for f in files_to_load:
        try:
            file_contents[f] = (ws_path / f).read_text(errors="replace")[:20_000]
        except Exception:
            file_contents[f] = ""

    # ── Build import adjacency (file → files it imports) ──────────────────────
    adjacency: Dict[str, List[str]] = {}
    for f in all_files:
        ext = pathlib.Path(f).suffix
        raw = _parse_imports(file_contents.get(f, ""), ext)
        resolved = [
            r for raw_s in raw
            for r in [_resolve_import(raw_s, f, all_files)]
            if r and r != f
        ]
        adjacency[f] = resolved

    # ── Determine focus set ────────────────────────────────────────────────────
    focus_set: Set[str] = (set(focus_paths) & all_files) if focus_paths else all_files

    # ── Build 1-hop neighbourhood subgraph ────────────────────────────────────
    subgraph: Set[str] = set(focus_set)
    for f in focus_set:
        subgraph.update(adjacency.get(f, []))           # children
        for other, deps in adjacency.items():
            if f in deps:
                subgraph.add(other)                     # parents

    subgraph &= all_files
    if not subgraph:
        return [], []

    # ── Topological layer assignment ──────────────────────────────────────────
    # in-degree within subgraph
    in_deg: Dict[str, int] = {f: 0 for f in subgraph}
    for src in subgraph:
        for tgt in adjacency.get(src, []):
            if tgt in subgraph:
                in_deg[tgt] = in_deg.get(tgt, 0) + 1

    layer: Dict[str, int] = {}
    queue_bfs: List[Tuple[str, int]] = [(f, 0) for f, d in in_deg.items() if d == 0]
    while queue_bfs:
        node, lyr = queue_bfs.pop(0)
        layer[node] = max(layer.get(node, 0), lyr)
        for child in adjacency.get(node, []):
            if child in subgraph:
                queue_bfs.append((child, lyr + 1))
    for f in subgraph:
        layer.setdefault(f, 0)

    # ── Layout positions ──────────────────────────────────────────────────────
    layers_map: Dict[int, List[str]] = {}
    for f, lyr in layer.items():
        layers_map.setdefault(lyr, []).append(f)
    for lyr_nodes in layers_map.values():
        lyr_nodes.sort()

    NODE_W, NODE_H = 220, 50
    H_GAP, V_GAP = 60, 100
    max_per_layer = max((len(v) for v in layers_map.values()), default=1)
    canvas_w = max_per_layer * (NODE_W + H_GAP) + H_GAP

    # Compute which non-focus files are directly used by focus files (impacted)
    impacted_set: Set[str] = set()
    for f in focus_set:
        for tgt in adjacency.get(f, []):
            if tgt in subgraph:
                impacted_set.add(tgt)
        for other in subgraph:
            if f in adjacency.get(other, []) and other not in focus_set:
                impacted_set.add(other)

    nodes: List[GraphNode] = []
    for lyr, lyr_nodes in sorted(layers_map.items()):
        total = len(lyr_nodes)
        row_w = total * NODE_W + (total - 1) * H_GAP
        start_x = (canvas_w - row_w) / 2
        for i, path in enumerate(lyr_nodes):
            x = start_x + i * (NODE_W + H_GAP)
            y = lyr * (NODE_H + V_GAP) + V_GAP
            p = PurePosixPath(path)
            nodes.append(GraphNode(
                id=path,
                path=path,
                name=p.name,
                ext=p.suffix,
                is_changed=path in focus_set,
                is_impacted=path in impacted_set and path not in focus_set,
                layer=lyr,
                layer_index=i,
                x=x,
                y=y,
            ))

    # ── Edges within subgraph ─────────────────────────────────────────────────
    seen_e: Set[Tuple[str, str]] = set()
    edges: List[GraphEdge] = []
    for src in subgraph:
        for tgt in adjacency.get(src, []):
            if tgt in subgraph and (src, tgt) not in seen_e:
                seen_e.add((src, tgt))
                edges.append(GraphEdge(source=src, target=tgt))

    return nodes, edges


def _build_tree(paths: List[str]) -> Dict[str, Any]:
    root: Dict[str, Any] = {}
    for p in sorted(paths):
        parts = PurePosixPath(p).parts
        node = root
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = {"__file__": p}
    return root


# ── Impact path resolver ───────────────────────────────────────────────────────

def compute_impact_path(
    nodes: List[GraphNode],
    edges: List[GraphEdge],
    focus_file: str,
) -> Dict[str, Any]:
    """Find the root→leaf path through focus_file."""
    # Build adjacency
    children: Dict[str, List[str]] = {}
    parents: Dict[str, List[str]] = {}
    node_ids = {n.id for n in nodes}

    for e in edges:
        if e.source in node_ids and e.target in node_ids:
            children.setdefault(e.source, []).append(e.target)
            parents.setdefault(e.target, []).append(e.source)

    # BFS upstream (from focus → root)
    def ancestors(start: str) -> List[str]:
        visited, queue, result = set(), [start], []
        while queue:
            node = queue.pop(0)
            if node in visited:
                continue
            visited.add(node)
            result.append(node)
            for p in parents.get(node, []):
                queue.append(p)
        return result[1:]  # exclude focus itself

    # BFS downstream (from focus → leaves)
    def descendants(start: str) -> List[str]:
        visited, queue, result = set(), [start], []
        while queue:
            node = queue.pop(0)
            if node in visited:
                continue
            visited.add(node)
            result.append(node)
            for c in children.get(node, []):
                queue.append(c)
        return result[1:]

    upstream = ancestors(focus_file)
    downstream = descendants(focus_file)

    # Simple path: one root → focus → one leaf
    root_path = list(reversed(upstream)) + [focus_file] if upstream else [focus_file]
    leaf_path = [focus_file] + downstream if downstream else [focus_file]
    full_path = list(dict.fromkeys(root_path + downstream))

    return {
        "focus_file": focus_file,
        "root_path": root_path,
        "leaf_path": leaf_path,
        "full_path": full_path,
        "upstream": upstream,
        "downstream": downstream,
    }


# ── AI test generation ─────────────────────────────────────────────────────────

async def generate_tests_from_code(
    file_path: str,
    file_content: str,
    language: str,
    impact_context: Optional[List[str]] = None,
) -> List[GeneratedTest]:
    """Use AI to generate test cases for a specific file."""
    ext_map = {
        ".ts": "TypeScript/Jest", ".tsx": "TypeScript/Jest",
        ".js": "JavaScript/Jest", ".jsx": "JavaScript/Jest",
        ".py": "Python/pytest",
        ".vue": "Vue/Vitest",
    }
    ext = PurePosixPath(file_path).suffix
    framework = ext_map.get(ext, "Jest")

    context_str = ""
    if impact_context:
        context_str = f"\nThis file is impacted by changes in: {', '.join(impact_context[:5])}"

    prompt = f"""You are an expert software engineer generating production-quality test cases.

File: {file_path}
Language/Framework: {framework}
{context_str}

Source code:
```
{file_content[:2500]}
```

Generate 4-6 high-quality test cases covering:
1. Happy path (normal functionality)
2. Edge cases (boundary values, empty inputs)
3. Error cases (invalid inputs, failures)
4. Integration points (if applicable)

Return ONLY a JSON array of test objects, no other text:
[
  {{
    "name": "descriptive test name",
    "description": "what this test verifies",
    "code": "complete test code here",
    "test_type": "unit|integration|e2e",
    "tags": ["tag1", "tag2"]
  }}
]"""

    try:
        response = await call_ai(prompt, max_tokens=2500)
        # Extract JSON from response
        json_match = re.search(r'\[.*\]', response, re.DOTALL)
        if not json_match:
            return _fallback_tests(file_path, framework)
        raw_tests = json.loads(json_match.group())
        results = []
        for i, t in enumerate(raw_tests[:6]):
            results.append(GeneratedTest(
                id=str(uuid.uuid4()),
                name=t.get("name", f"test_{i+1}"),
                description=t.get("description", ""),
                code=t.get("code", ""),
                framework=framework,
                file_target=file_path,
                test_type=t.get("test_type", "unit"),
                tags=t.get("tags", []),
            ))
        return results
    except Exception as e:
        log.warning("AI test generation failed: %s", e)
        return _fallback_tests(file_path, framework)


def _fallback_tests(file_path: str, framework: str) -> List[GeneratedTest]:
    name = PurePosixPath(file_path).stem
    return [
        GeneratedTest(
            id=str(uuid.uuid4()),
            name=f"renders {name} without errors",
            description=f"Verify {name} component/module renders without throwing",
            code=f'it("renders {name} without errors", () => {{\n  expect(true).toBe(true);\n}});',
            framework=framework,
            file_target=file_path,
            test_type="unit",
            tags=["smoke"],
        )
    ]


# ── Document parsing → scenarios ───────────────────────────────────────────────

async def parse_document_to_scenarios(content: str, filename: str) -> List[DocScenario]:
    """Extract test scenarios from a document using AI."""
    prompt = f"""You are a QA engineer extracting test scenarios from documentation.

Document: {filename}
Content:
```
{content[:3000]}
```

Extract 4-8 testable scenarios from this document.
Return ONLY a JSON array:
[
  {{
    "title": "scenario title",
    "description": "what to test",
    "acceptance_criteria": ["criterion 1", "criterion 2"],
    "priority": "high|medium|low"
  }}
]"""

    try:
        response = await call_ai(prompt, max_tokens=2000)
        json_match = re.search(r'\[.*\]', response, re.DOTALL)
        if not json_match:
            return _fallback_scenarios(filename)
        raw = json.loads(json_match.group())
        return [
            DocScenario(
                id=str(uuid.uuid4()),
                title=s.get("title", f"Scenario {i+1}"),
                description=s.get("description", ""),
                acceptance_criteria=s.get("acceptance_criteria", []),
                priority=s.get("priority", "medium"),
            )
            for i, s in enumerate(raw[:8])
        ]
    except Exception as e:
        log.warning("Document parsing failed: %s", e)
        return _fallback_scenarios(filename)


def _fallback_scenarios(filename: str) -> List[DocScenario]:
    return [
        DocScenario(
            id=str(uuid.uuid4()),
            title=f"Core functionality from {filename}",
            description="Verify the primary use case described in the document",
            acceptance_criteria=["Feature works as described", "No errors on happy path"],
            priority="high",
        )
    ]


# ── Test generation from doc scenarios ────────────────────────────────────────

async def generate_tests_from_scenarios(
    scenarios: List[DocScenario],
    framework: str = "playwright",
) -> List[ImpactPlaywrightTest]:
    """Generate Live Runner-style Playwright test cases from document scenarios."""
    all_tests: List[ImpactPlaywrightTest] = []

    scenarios_text = "\n".join(
        f"- {s.title}: {s.description}\n  Criteria: {'; '.join(s.acceptance_criteria)}"
        for s in scenarios[:6]
    )

    prompt = f"""You are a senior Playwright test automation engineer.

Scenarios:
{scenarios_text}

Generate one focused Playwright test per scenario.

Return ONLY a JSON array with this exact shape:
[
  {{
    "name": "Descriptive test case name",
    "description": "What this test validates",
    "page_name": "Page or module under test",
    "severity": "Critical|High|Medium|Low",
    "steps": [
      {{"action": "navigate", "selector": null, "value": "/route", "description": "Navigate"}},
      {{"action": "screenshot", "selector": null, "value": null, "description": "Capture initial state"}},
      {{"action": "assert_text", "selector": null, "value": "Expected text", "description": "Verify expected output"}},
      {{"action": "screenshot", "selector": null, "value": null, "description": "Capture final state"}}
    ]
  }}
]

Rules:
- Create exactly one test per scenario provided.
- Use only supported Playwright actions:
  navigate, click, fill, assert_text, screenshot, wait, hover, hover_and_click,
  press, check, uncheck, select_option, drag_and_drop, dblclick, type_into, scroll, clear.
- Each test must include at least 4 steps and at least two screenshot steps.
- Severity must be one of: Critical, High, Medium, Low.
"""

    try:
        response = await call_ai(prompt, max_tokens=3000)
        json_match = re.search(r'\[.*\]', response, re.DOTALL)
        if not json_match:
            return [_scenario_playwright_fallback_test(s) for s in scenarios]
        raw = json.loads(json_match.group())

        for i, s in enumerate(scenarios):
            t = raw[i] if i < len(raw) and isinstance(raw[i], dict) else {}

            severity = str(t.get("severity", "Medium")).strip().title() or "Medium"
            if severity not in {"Critical", "High", "Medium", "Low"}:
                severity = "Medium"

            steps_raw = t.get("steps", [])
            steps: List[Dict[str, Any]] = []
            if isinstance(steps_raw, list):
                for step in steps_raw:
                    if not isinstance(step, dict):
                        continue
                    action = str(step.get("action", "")).strip()
                    if not action:
                        continue
                    steps.append({
                        "action": action,
                        "selector": step.get("selector"),
                        "value": step.get("value"),
                        "description": str(step.get("description", action)).strip() or action,
                    })

            if len(steps) < 2:
                fallback = _scenario_playwright_fallback_test(s)
                steps = [
                    {"action": st.action, "selector": st.selector, "value": st.value, "description": st.description}
                    for st in fallback.steps
                ]

            all_tests.append(ImpactPlaywrightTest(
                id=str(uuid.uuid4()),
                name=t.get("name", s.title),
                description=t.get("description", s.description),
                page_name=t.get("page_name", s.title[:40] or "Scenario"),
                severity=severity,
                steps=steps,
                file_target="generated_from_docs",
            ))
    except Exception as e:
        log.warning("Doc-driven test gen failed: %s", e)
        all_tests = [_scenario_playwright_fallback_test(s) for s in scenarios]

    return all_tests


def _scenario_playwright_fallback_test(s: DocScenario) -> ImpactPlaywrightTest:
    route_slug = re.sub(r"[^a-z0-9]+", "-", s.title.lower()).strip("-")
    route = f"/{route_slug}" if route_slug else "/"
    expected = s.acceptance_criteria[0] if s.acceptance_criteria else s.title

    severity_map = {
        "high": "High",
        "medium": "Medium",
        "low": "Low",
    }

    return ImpactPlaywrightTest(
        id=str(uuid.uuid4()),
        name=s.title,
        description=s.description,
        page_name=s.title[:40] or "Scenario",
        severity=severity_map.get((s.priority or "medium").lower(), "Medium"),
        steps=[
            {
                "action": "navigate",
                "selector": None,
                "value": route,
                "description": "Navigate to scenario page",
            },
            {
                "action": "screenshot",
                "selector": None,
                "value": None,
                "description": "Capture initial state",
            },
            {
                "action": "assert_text",
                "selector": None,
                "value": expected,
                "description": "Validate expected behavior",
            },
            {
                "action": "screenshot",
                "selector": None,
                "value": None,
                "description": "Capture final state",
            },
        ],
        file_target="generated_from_docs",
    )
