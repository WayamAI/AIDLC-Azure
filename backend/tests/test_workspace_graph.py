from pathlib import Path

from app.services import impact_service, workspace_service


def test_require_workspace_enforces_org():
    workspace_service._WORKSPACES.clear()
    workspace_service._WORKSPACES["ws_1"] = {
        "org_id": "org_a",
        "clone_dir": "/tmp/workspaces/ws_1",
    }

    assert workspace_service.require_workspace("org_a", "ws_1")["org_id"] == "org_a"
    try:
        workspace_service.require_workspace("org_b", "ws_1")
        assert False, "expected KeyError for other org"
    except KeyError:
        pass


def test_workspace_graph_uses_clone_dir(tmp_path: Path):
    src = tmp_path / "src"
    src.mkdir()
    (src / "a.ts").write_text("import { b } from './b';\nexport const a = 1;\n", encoding="utf-8")
    (src / "b.ts").write_text("export const b = 2;\n", encoding="utf-8")

    workspace_service._WORKSPACES.clear()
    workspace_service._WORKSPACES["ws_graph"] = {
        "org_id": "org_a",
        "clone_dir": str(tmp_path),
    }
    impact_service._WORKSPACE_GRAPH_CACHE.clear()

    nodes, edges = impact_service.build_workspace_dependency_graph(
        "ws_graph",
        org_id="org_a",
    )
    paths = {n.path for n in nodes}
    assert "src/a.ts" in paths
    assert "src/b.ts" in paths
    # Node ids are always posix, on every platform.
    assert all("\\" not in n.path for n in nodes)
    assert ("src/a.ts", "src/b.ts") in {(e.source, e.target) for e in edges}

    try:
        impact_service.build_workspace_dependency_graph("ws_graph", org_id="org_other")
        assert False, "expected KeyError for other org"
    except KeyError:
        pass


def test_workspace_graph_resolves_nested_imports(tmp_path: Path):
    """Nested paths regressed on Windows: relative imports resolved against
    backslash-separated ids and every edge was silently dropped."""
    (tmp_path / "src" / "lib").mkdir(parents=True)
    (tmp_path / "src" / "pages").mkdir(parents=True)
    (tmp_path / "src" / "lib" / "api.ts").write_text(
        "export const api = 1;\n", encoding="utf-8"
    )
    (tmp_path / "src" / "pages" / "home.tsx").write_text(
        "import { api } from '../lib/api';\nexport const Home = () => api;\n",
        encoding="utf-8",
    )

    workspace_service._WORKSPACES.clear()
    workspace_service._WORKSPACES["ws_nested"] = {
        "org_id": "org_a",
        "clone_dir": str(tmp_path),
    }
    impact_service._WORKSPACE_GRAPH_CACHE.clear()
    impact_service._IMPORT_RESOLUTION_CACHE.clear()

    nodes, edges = impact_service.build_workspace_dependency_graph(
        "ws_nested",
        org_id="org_a",
    )

    assert {n.path for n in nodes} == {"src/lib/api.ts", "src/pages/home.tsx"}
    assert [(e.source, e.target) for e in edges] == [("src/pages/home.tsx", "src/lib/api.ts")]


def test_workspace_graph_resolves_tsconfig_path_aliases(tmp_path: Path):
    """Repos that alias something other than "@/" must still link up."""
    (tmp_path / "web" / "src" / "lib").mkdir(parents=True)
    (tmp_path / "web" / "tsconfig.json").write_text(
        """{
  // JSONC: comments and trailing commas are legal here
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "~/*": ["src/*"] },
  }
}""",
        encoding="utf-8",
    )
    (tmp_path / "web" / "src" / "lib" / "client.ts").write_text(
        "export const client = 1;\n", encoding="utf-8"
    )
    (tmp_path / "web" / "src" / "app.ts").write_text(
        "import { client } from '~/lib/client';\nexport const app = client;\n",
        encoding="utf-8",
    )

    workspace_service._WORKSPACES.clear()
    workspace_service._WORKSPACES["ws_alias"] = {
        "org_id": "org_a",
        "clone_dir": str(tmp_path),
    }
    impact_service._WORKSPACE_GRAPH_CACHE.clear()
    impact_service._IMPORT_RESOLUTION_CACHE.clear()
    impact_service._ALIAS_CACHE.clear()

    assert impact_service._load_path_aliases(tmp_path)["~"] == ["web/src"]

    nodes, edges = impact_service.build_workspace_dependency_graph("ws_alias", org_id="org_a")
    assert {n.path for n in nodes} == {"web/src/app.ts", "web/src/lib/client.ts"}
    assert [(e.source, e.target) for e in edges] == [("web/src/app.ts", "web/src/lib/client.ts")]


def test_workspace_graph_includes_tests_flagged(tmp_path: Path):
    """Tests belong in the graph — a test's imports are the coverage signal —
    but they must be flagged so the UI can filter them out."""
    (tmp_path / "src").mkdir()
    (tmp_path / "tests").mkdir()
    (tmp_path / "src" / "calc.py").write_text("def add(a, b):\n    return a + b\n", encoding="utf-8")
    (tmp_path / "tests" / "test_calc.py").write_text(
        "from src.calc import add\n\n\ndef test_add():\n    assert add(1, 2) == 3\n",
        encoding="utf-8",
    )

    workspace_service._WORKSPACES.clear()
    workspace_service._WORKSPACES["ws_tests"] = {"org_id": "org_a", "clone_dir": str(tmp_path)}
    impact_service._WORKSPACE_GRAPH_CACHE.clear()
    impact_service._IMPORT_RESOLUTION_CACHE.clear()
    impact_service._ALIAS_CACHE.clear()

    nodes, edges = impact_service.build_workspace_dependency_graph("ws_tests", org_id="org_a")
    by_path = {n.path: n for n in nodes}

    assert by_path["tests/test_calc.py"].is_test is True
    assert by_path["src/calc.py"].is_test is False
    assert ("tests/test_calc.py", "src/calc.py") in {(e.source, e.target) for e in edges}


def test_is_test_path_does_not_flag_domain_modules():
    # app/models/test_case.py is a model, not a test suite.
    assert impact_service._is_test_path("backend/app/models/test_case.py") is False
    assert impact_service._is_test_path("backend/tests/test_calc.py") is True
    assert impact_service._is_test_path("frontend/src/lib/api.test.ts") is True
    assert impact_service._is_test_path("frontend/src/lib/api.ts") is False


def test_layering_terminates_on_circular_imports():
    """A cycle used to either pin every node to the layer cap (collapsing the
    graph into one column) or loop forever in the PR/commit path."""
    members = {"a.py", "b.py", "c.py"}
    adjacency = {"a.py": ["b.py"], "b.py": ["c.py"], "c.py": ["a.py"]}  # a -> b -> c -> a
    in_degree = {"a.py": 1, "b.py": 1, "c.py": 1}  # no zero-in-degree seed

    layers = impact_service._assign_layers(members, adjacency, in_degree)

    assert set(layers) == members
    assert max(layers.values()) < len(members)


def test_layering_spreads_a_chain_across_layers():
    members = {"a.py", "b.py", "c.py"}
    adjacency = {"a.py": ["b.py"], "b.py": ["c.py"]}
    in_degree = {"a.py": 0, "b.py": 1, "c.py": 1}

    assert impact_service._assign_layers(members, adjacency, in_degree) == {
        "a.py": 0,
        "b.py": 1,
        "c.py": 2,
    }
