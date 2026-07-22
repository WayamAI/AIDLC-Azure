"""Route injection engine patches App.tsx markers without touching anything outside them."""
import re


def inject_routes(app_tsx: str, routes: list[dict]) -> str:
    import_lines = "\n".join(
        f"import {r['component']} from '{r['importPath']}';"
        for r in routes
    )
    route_lines = "\n          ".join(
        f'<Route path="{r["path"]}" element={{<{r["component"]} />}} />'
        for r in routes
    )

    app_tsx = re.sub(
        r"// AUTO_IMPORTS_START.*?// AUTO_IMPORTS_END",
        f"// AUTO_IMPORTS_START\n{import_lines}\n// AUTO_IMPORTS_END",
        app_tsx,
        flags=re.DOTALL,
    )
    app_tsx = re.sub(
        r"\{/\* AUTO_ROUTES_START \*/\}.*?\{/\* AUTO_ROUTES_END \*/\}",
        f"{{/* AUTO_ROUTES_START */}}\n          {route_lines}\n          {{/* AUTO_ROUTES_END */}}",
        app_tsx,
        flags=re.DOTALL,
    )
    return app_tsx
