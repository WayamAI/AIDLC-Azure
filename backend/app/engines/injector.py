"""Route injection engine patches App.tsx markers without touching anything outside them."""
import json
import re

_IMPORTS_BLOCK = re.compile(r"// AUTO_IMPORTS_START.*?// AUTO_IMPORTS_END", re.DOTALL)
_ROUTES_BLOCK = re.compile(r"\{/\* AUTO_ROUTES_START \*/\}.*?\{/\* AUTO_ROUTES_END \*/\}", re.DOTALL)
_NAV_BLOCK = re.compile(r"// AUTO_NAV_START.*?// AUTO_NAV_END", re.DOTALL)
_APP_NAME_LINE = re.compile(r"^(const APP_NAME = ).*?(; // AUTO_APP_NAME)$", re.MULTILINE)
_ROUTES_START = "{/* AUTO_ROUTES_START */}"
# The original template declared its placeholder page as `path="/"` before the
# markers, which shadowed a generated home page. Such a placeholder becomes the
# catch-all once a generated route claims "/".
_LEGACY_PLACEHOLDER_ROUTE = re.compile(r'(<Route\s+path=)"/"')
_ICON_NAME = re.compile(r"[A-Z][A-Za-z0-9]{1,40}")


def _valid_routes(routes: list[dict]) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for r in routes:
        if not isinstance(r, dict):
            continue
        path, component, import_path = r.get("path"), r.get("component"), r.get("importPath")
        if not (isinstance(path, str) and isinstance(component, str) and isinstance(import_path, str)):
            continue
        if not re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", component):
            continue
        if path in seen:
            continue
        seen.add(path)
        out.append({**r, "path": path, "component": component, "importPath": import_path})
    return out


def _label_for(route: dict) -> str:
    label = route.get("label")
    if isinstance(label, str) and label.strip():
        return label.strip()[:40]
    # "RecipeDetail" -> "Recipe Detail"
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", route["component"])


def nav_items(routes: list[dict]) -> list[dict]:
    """Sidebar entries for the kit's AppShell; routes with parameters (/x/:id) are not menu items."""
    items = []
    for r in _valid_routes(routes):
        if ":" in r["path"] or "*" in r["path"]:
            continue
        item = {"to": r["path"], "label": _label_for(r)}
        icon = r.get("icon")
        if isinstance(icon, str) and _ICON_NAME.fullmatch(icon.strip()):
            item["icon"] = icon.strip()
        items.append(item)
    return items


def inject_routes(
    app_tsx: str,
    routes: list[dict],
    nav: list[dict] | None = None,
    app_name: str | None = None,
) -> str:
    routes = _valid_routes(routes)
    import_lines = "\n".join(
        f"import {r['component']} from '{r['importPath']}';"
        for r in routes
    )
    route_lines = "\n          ".join(
        f'<Route path="{r["path"]}" element={{<{r["component"]} />}} />'
        for r in routes
    )

    app_tsx = _IMPORTS_BLOCK.sub(
        lambda _m: f"// AUTO_IMPORTS_START\n{import_lines}\n// AUTO_IMPORTS_END",
        app_tsx,
    )
    app_tsx = _ROUTES_BLOCK.sub(
        lambda _m: f"{_ROUTES_START}\n          {route_lines}\n          {{/* AUTO_ROUTES_END */}}",
        app_tsx,
    )
    if nav is not None:
        nav_json = json.dumps(nav, ensure_ascii=False, indent=2)
        app_tsx = _NAV_BLOCK.sub(
            lambda _m: f"// AUTO_NAV_START\nconst NAV: NavItem[] = {nav_json};\n// AUTO_NAV_END",
            app_tsx,
        )
    if app_name:
        app_tsx = _APP_NAME_LINE.sub(lambda m: f"{m.group(1)}{json.dumps(app_name[:60])}{m.group(2)}", app_tsx)

    if any(r["path"] == "/" for r in routes) and _ROUTES_START in app_tsx:
        head, tail = app_tsx.split(_ROUTES_START, 1)
        head = _LEGACY_PLACEHOLDER_ROUTE.sub(r'\1"*"', head, count=1)
        app_tsx = head + _ROUTES_START + tail
    return app_tsx
