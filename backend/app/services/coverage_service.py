"""
Coverage service static AST-based coverage gap analysis.
No test execution required; cross-references function names with test files.
"""
import ast
import re
from pathlib import Path
from typing import Optional

from app.services.workspace_service import require_workspace, _walk_tree


class _FunctionVisitor(ast.NodeVisitor):
    """Extract all top-level and class-level function/method definitions."""

    def __init__(self):
        self.functions: list[dict] = []
        self._class_stack: list[str] = []

    def visit_ClassDef(self, node: ast.ClassDef):
        self._class_stack.append(node.name)
        self.generic_visit(node)
        self._class_stack.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef | ast.AsyncFunctionDef):
        if node.name.startswith("__") and node.name != "__init__":
            self.generic_visit(node)
            return
        prefix = ".".join(self._class_stack)
        qualified = f"{prefix}.{node.name}" if prefix else node.name
        end_line = getattr(node, "end_lineno", node.lineno + 5)
        self.functions.append({
            "name": qualified,
            "type": "function",
            "line_start": node.lineno,
            "line_end": end_line,
        })
        self.generic_visit(node)

    visit_AsyncFunctionDef = visit_FunctionDef


def _find_test_files(clone_dir: str) -> list[str]:
    """Return paths of all test files in the repo."""
    base = Path(clone_dir)
    tests: list[str] = []
    for f in base.rglob("test_*.py"):
        tests.append(f.read_text(encoding="utf-8", errors="replace"))
    for f in base.rglob("*_test.py"):
        tests.append(f.read_text(encoding="utf-8", errors="replace"))
    for f in base.rglob("*.test.ts"):
        tests.append(f.read_text(encoding="utf-8", errors="replace"))
    for f in base.rglob("*.test.tsx"):
        tests.append(f.read_text(encoding="utf-8", errors="replace"))
    for f in base.rglob("*.spec.ts"):
        tests.append(f.read_text(encoding="utf-8", errors="replace"))
    return tests


def _is_called_in_tests(func_name: str, test_contents: list[str]) -> bool:
    """Heuristic: check if the function name appears in any test file."""
    # Get just the simple name (no class prefix)
    simple_name = func_name.split(".")[-1]
    for content in test_contents:
        if simple_name in content:
            return True
    return False


def analyze_python_coverage(org_id: str, workspace_id: str, file_path: str, content: str) -> dict:
    """Parse Python file with AST and check which functions appear in test files."""
    ws = require_workspace(org_id, workspace_id)
    test_contents = _find_test_files(ws["clone_dir"])

    try:
        tree = ast.parse(content)
    except SyntaxError:
        return {
            "file_path": file_path,
            "total_functions": 0,
            "covered_functions": 0,
            "coverage_pct": 0.0,
            "gaps": [],
        }

    visitor = _FunctionVisitor()
    visitor.visit(tree)
    functions = visitor.functions

    gaps = []
    covered = 0
    for fn in functions:
        is_covered = _is_called_in_tests(fn["name"], test_contents)
        if is_covered:
            covered += 1
        gaps.append({
            "name": fn["name"],
            "type": fn["type"],
            "line_start": fn["line_start"],
            "line_end": fn["line_end"],
            "covered": is_covered,
        })

    total = len(functions)
    pct = (covered / total * 100) if total > 0 else 0.0

    return {
        "file_path": file_path,
        "total_functions": total,
        "covered_functions": covered,
        "coverage_pct": round(pct, 1),
        "gaps": gaps,
    }


def analyze_ts_coverage(org_id: str, workspace_id: str, file_path: str, content: str) -> dict:
    """Lightweight regex-based coverage analysis for TypeScript/JavaScript."""
    ws = require_workspace(org_id, workspace_id)
    test_contents = _find_test_files(ws["clone_dir"])

    # Match: function foo(, const foo = (, async foo(, export function foo(
    fn_pattern = re.compile(
        r"(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\()",
        re.MULTILINE,
    )

    lines = content.splitlines()
    functions = []
    for i, line in enumerate(lines, 1):
        m = fn_pattern.search(line)
        if m:
            name = m.group(1) or m.group(2)
            if name and not name.startswith("_"):
                functions.append({"name": name, "type": "function", "line_start": i, "line_end": i + 5})

    gaps = []
    covered = 0
    for fn in functions:
        is_covered = _is_called_in_tests(fn["name"], test_contents)
        if is_covered:
            covered += 1
        gaps.append({**fn, "covered": is_covered})

    total = len(functions)
    pct = (covered / total * 100) if total > 0 else 0.0

    return {
        "file_path": file_path,
        "total_functions": total,
        "covered_functions": covered,
        "coverage_pct": round(pct, 1),
        "gaps": gaps,
    }


def analyze_coverage(workspace_id: str, file_path: str, content: str, *, org_id: str) -> dict:
    """Dispatch to the right analyzer based on file extension."""
    ext = Path(file_path).suffix.lower()
    if ext == ".py":
        return analyze_python_coverage(org_id, workspace_id, file_path, content)
    elif ext in {".ts", ".tsx", ".js", ".jsx"}:
        return analyze_ts_coverage(org_id, workspace_id, file_path, content)
    else:
        # Return empty analysis for unsupported types
        return {
            "file_path": file_path,
            "total_functions": 0,
            "covered_functions": 0,
            "coverage_pct": 0.0,
            "gaps": [],
        }
