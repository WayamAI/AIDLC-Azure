"""
Test generation service generates pytest/jest test cases for coverage gaps.
Uses AI to produce complete, runnable test functions.
"""
import asyncio
import os
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.services.ai_service import _call_openai_json, generate_playwright_tests_from_source
from app.services.workspace_service import require_workspace


# ── Source extensions we care about for test generation ──────────────────────
_TESTABLE_EXTENSIONS = {".tsx", ".ts", ".jsx", ".js", ".py"}
_SKIP_PATTERNS = {
    "test", "spec", ".d.ts", "node_modules", "__pycache__",
    "dist", "build", ".next", "vite.config", "tailwind.config",
    "postcss.config", "jest.config", "playwright.config",
}

# ── In-memory suite storage (replace with MongoDB if needed) ─────────────────
_TEST_SUITES: dict[str, dict] = {}


_PYTEST_SYSTEM = """You are a senior QA engineer specializing in Python testing with pytest.
Given a source file and a list of uncovered functions/gaps, generate comprehensive test cases.

Return a JSON object with:
- "test_file_content": the COMPLETE test file as a string (import statements + all test functions)
- "tests": array of { "function_name": string, "code": string, "description": string, "gap_covered": string }

Rules:
- Each test function must be standalone and runnable
- Use pytest fixtures and parametrize where appropriate
- Use unittest.mock.patch and MagicMock for external dependencies
- Include both happy-path and edge-case tests for each gap
- Add clear docstrings explaining what each test validates
- Import the module under test correctly based on the file path
- Return ONLY valid JSON, no markdown fences"""

_JEST_SYSTEM = """You are a senior QA engineer specializing in TypeScript testing with Jest/Vitest.
Given a source file and a list of uncovered functions/gaps, generate comprehensive test cases.

Return a JSON object with:
- "test_file_content": the COMPLETE test file as a string (imports + all describe/it blocks)
- "tests": array of { "function_name": string, "code": string, "description": string, "gap_covered": string }

Rules:
- Use describe() blocks to group related tests
- Use jest.mock() or vi.mock() for dependencies
- Include both happy-path and edge cases
- Add clear comments explaining what each test validates
- Return ONLY valid JSON, no markdown fences"""


def _module_import_path(file_path: str) -> str:
    """Convert file_path like 'backend/app/services/foo.py' to 'app.services.foo'."""
    path = Path(file_path)
    # Remove common prefixes
    parts = list(path.with_suffix("").parts)
    # Drop 'backend' prefix if present
    if parts and parts[0] == "backend":
        parts = parts[1:]
    return ".".join(parts)


def _truncate_content(content: str, max_chars: int = 12000) -> str:
    """Reduced from 24k to 12k to save tokens."""
    if len(content) <= max_chars:
        return content
    half = max_chars // 2
    return content[:half] + "\n\n... [truncated] ...\n\n" + content[-half:]


async def generate_tests(
    workspace_id: str,
    file_path: str,
    content: str,
    gaps: list[str],
    framework: str = "pytest",
    existing_tests: Optional[str] = None,
) -> dict:
    """Generate test cases targeting the specified coverage gaps."""
    truncated = _truncate_content(content)
    is_python = file_path.endswith(".py")
    system = _PYTEST_SYSTEM if framework == "pytest" else _JEST_SYSTEM

    gaps_str = "\n".join(f"- {g}" for g in gaps) if gaps else "- (all uncovered functions)"
    existing_ctx = f"\nEXISTING TESTS (do not duplicate):\n{existing_tests[:4000]}\n" if existing_tests else ""
    module_path = _module_import_path(file_path) if is_python else file_path

    prompt = f"""{system}

Source file: {file_path}
Module import path: {module_path}
Test framework: {framework}

COVERAGE GAPS TO TEST:
{gaps_str}
{existing_ctx}
SOURCE FILE CONTENT:
{truncated}"""

    data = await _call_openai_json(prompt)
    if not isinstance(data, dict):
        data = {}

    # Derive test file path
    path = Path(file_path)
    if is_python:
        test_file_path = str(path.parent / f"test_{path.name}")
    else:
        test_file_path = str(path.parent / f"{path.stem}.test{path.suffix}")

    test_file_content = data.get("test_file_content", "# Generated tests\n")
    tests = data.get("tests", [])

    return {
        "test_file_path": test_file_path,
        "test_file_content": test_file_content,
        "tests": tests if isinstance(tests, list) else [],
    }


async def generate_playwright_tests(
    workspace_id: str,
    file_path: str,
    content: str,
    target_url: str | None = None,
    num_tests: int | None = None,
) -> dict:
    """Generate PlaywrightTestCase objects from a source file using AI."""
    tests = await generate_playwright_tests_from_source(
        file_path=file_path,
        content=content,
        target_url=target_url,
        num_tests=num_tests,
    )
    return {"tests": tests}


def export_playwright_tests_as_spec(
    tests: list[dict],
    target_url: str | None = None,
) -> str:
    """Convert PlaywrightTestCase objects to a Playwright .spec.ts file string."""
    base_url = target_url or "http://localhost:3000"

    lines: list[str] = [
        "import { test, expect } from '@playwright/test';",
        "",
        f"// Base URL: {base_url}",
        "// Generated by SDLC AI Workspace",
        "",
    ]

    for tc in tests:
        name = tc.get("name", "Unnamed test").replace("'", "\\'")
        description = tc.get("description", "")
        steps = tc.get("steps", [])

        lines.append(f"test('{name}', async ({{ page }}) => {{")
        if description:
            lines.append(f"  // {description}")

        for step in steps:
            action = step.get("action", "")
            selector = (step.get("selector") or "").replace("'", "\\'")
            value = step.get("value") or ""
            desc = step.get("description", "")

            if action == "navigate":
                url = value.strip()
                if url and not url.startswith("http"):
                    url = f"{base_url}{url}"
                lines.append(f"  await page.goto('{url}'); // {desc}")
            elif action == "click":
                lines.append(f"  await page.click('{selector}'); // {desc}")
            elif action == "fill":
                lines.append(f"  await page.fill('{selector}', '{value}'); // {desc}")
            elif action == "assert_text":
                lines.append(f"  await expect(page.locator('body')).toContainText('{value}'); // {desc}")
            elif action == "screenshot":
                lines.append(f"  await page.screenshot(); // {desc}")
            elif action == "wait":
                try:
                    ms = int(float(value)) * 1000
                except (ValueError, TypeError):
                    ms = 2000
                lines.append(f"  await page.waitForTimeout({ms}); // {desc}")
            elif action == "hover":
                lines.append(f"  await page.hover('{selector}'); // {desc}")
            elif action == "hover_and_click":
                click_sel = (value or "").replace("'", "\\'")
                lines.append(f"  await page.hover('{selector}'); // {desc}")
                lines.append(f"  await page.click('{click_sel}');")
            elif action == "press":
                lines.append(f"  await page.keyboard.press('{value}'); // {desc}")
            elif action == "check":
                lines.append(f"  await page.check('{selector}'); // {desc}")
            elif action == "uncheck":
                lines.append(f"  await page.uncheck('{selector}'); // {desc}")
            elif action == "select_option":
                lines.append(f"  await page.selectOption('{selector}', '{value}'); // {desc}")
            elif action == "dblclick":
                lines.append(f"  await page.dblclick('{selector}'); // {desc}")
            elif action == "type_into":
                lines.append(f"  await page.type('{selector}', '{value}'); // {desc}")
            elif action == "scroll":
                lines.append(f"  await page.evaluate(() => window.scrollBy(0, 500)); // {desc}")
            elif action == "clear":
                lines.append(f"  await page.fill('{selector}', ''); // {desc}")
            else:
                lines.append(f"  // TODO: {action} - {desc}")

        lines.append("});")
        lines.append("")

    return "\n".join(lines)


def _is_testable_file(rel_path: str) -> bool:
    """Return True if a file is a good candidate for Playwright test generation."""
    p = Path(rel_path)
    if p.suffix not in _TESTABLE_EXTENSIONS:
        return False
    lower = rel_path.lower()
    for skip in _SKIP_PATTERNS:
        if skip in lower:
            return False
    return True


def _score_file(rel_path: str) -> int:
    """Score a file higher = more important for UI testing."""
    lower = rel_path.replace("\\", "/").lower()
    score = 0
    if "pages/" in lower or "page/" in lower:
        score += 10
    if "components/" in lower:
        score += 7
    if "routes/" in lower or "router/" in lower:
        score += 6
    if "views/" in lower:
        score += 5
    if "app." in lower:
        score += 4
    if lower.startswith("web/") or "/web/" in lower:
        score += 8
    return score


async def generate_playwright_tests_batch(
    files: list[dict],
    target_url: str | None = None,
) -> dict:
    """Generate Playwright tests for a list of files (batch mode)."""
    all_tests: list[dict] = []
    for file in files[:10]:  # cap at 10 files to avoid timeout
        try:
            tests = await generate_playwright_tests_from_source(
                file_path=file["file_path"],
                content=file["content"],
                target_url=target_url,
            )
            all_tests.extend(tests)
        except Exception:
            continue
    return {"tests": all_tests}


async def generate_playwright_tests_for_app(
    workspace_id: str,
    target_url: str | None = None,
    *,
    org_id: str,
) -> dict:
    """Scan entire workspace, pick key source files, generate Playwright tests."""
    ws = require_workspace(org_id, workspace_id)
    clone_dir = Path(ws["clone_dir"])

    # Collect testable files
    candidates: list[tuple[int, str]] = []
    for path in clone_dir.rglob("*"):
        if path.is_file():
            rel = str(path.relative_to(clone_dir))
            if _is_testable_file(rel):
                candidates.append((_score_file(rel), rel))

    # Sort by score desc, take top 12
    candidates.sort(key=lambda x: -x[0])
    top_files = [rel for _, rel in candidates[:12]]

    files: list[dict] = []
    for rel in top_files:
        full = clone_dir / rel
        try:
            content = full.read_text(encoding="utf-8", errors="replace")
            files.append({"file_path": rel, "content": content})
        except Exception:
            continue

    return await generate_playwright_tests_batch(files, target_url)


async def generate_playwright_tests_for_commit(
    workspace_id: str,
    commit_sha: str,
    target_url: str | None = None,
    *,
    org_id: str,
) -> dict:
    """Generate tests for files changed in a specific git commit."""
    import git as gitlib

    ws = require_workspace(org_id, workspace_id)
    clone_dir = Path(ws["clone_dir"])

    def _get_changed_files() -> list[dict]:
        repo = gitlib.Repo(clone_dir)
        try:
            commit = repo.commit(commit_sha)
        except Exception:
            return []
        parent = commit.parents[0] if commit.parents else None
        diffs = parent.diff(commit) if parent else commit.diff(gitlib.NULL_TREE)
        result = []
        for diff in diffs:
            rel = diff.b_path or diff.a_path
            if not rel or not _is_testable_file(rel):
                continue
            full = clone_dir / rel
            if not full.exists():
                continue
            try:
                content = full.read_text(encoding="utf-8", errors="replace")
                result.append({"file_path": rel, "content": content})
            except Exception:
                continue
        return result

    files = await asyncio.to_thread(_get_changed_files)
    return await generate_playwright_tests_batch(files, target_url)


# ── Chain Analysis ────────────────────────────────────────────────────────────

async def analyze_chain_for_tests(
    workspace_id: str,
    chain: list[str],
    changed_files: list[str],
    *,
    org_id: str,
) -> list[dict]:
    """
    Send all files in the root→leaf chain to AI and get back per-file analysis:
    what changed, what the file does, and how many tests are warranted.
    """
    ws = require_workspace(org_id, workspace_id)
    clone_dir = Path(ws["clone_dir"])
    changed_set = set(changed_files)

    file_blocks: list[str] = []
    valid_paths: list[str] = []

    for path in chain:
        full = clone_dir / path
        if not full.exists():
            continue
        try:
            content = full.read_text(encoding="utf-8", errors="replace")
            truncated = content[:4000]  # Reduced from 6k to 4k
        except Exception:
            truncated = "(could not read)"

        status = "DIRECTLY CHANGED" if path in changed_set else "impacted (not directly changed)"
        file_blocks.append(
            f"--- FILE {len(file_blocks) + 1}: {path} [{status}] ---\n{truncated}\n"
        )
        valid_paths.append(path)

    if not file_blocks:
        return []

    chain_text = "\n".join(file_blocks)
    num_files = len(valid_paths)

    prompt = f"""You are a senior QA engineer reviewing a root-to-leaf dependency chain of source files from a web application.
A developer has just committed changes. You must analyse each file and decide how many Playwright E2E test cases to write.

CHAIN ORDER (root → leaf, {num_files} files):
Files marked "DIRECTLY CHANGED" had code actually modified in this commit.
Files marked "impacted" only import or depend on changed files they were not modified directly.

{chain_text}

For EACH file return a JSON object with:
- "file_path": exact path as given
- "summary": one sentence describing what this file does (component, hook, utility, etc.)
- "changes_description": what changed or why this file is included (be specific mention functions, hooks, props, logic)
- "suggested_count": integer 1–8, number of Playwright tests to write (higher for directly changed files with complex logic, lower for unmodified importers)
- "reason": one sentence justifying the count

Guidelines for suggested_count:
- Directly changed leaf file with complex logic: 4–8
- Directly changed file with moderate changes: 3–5
- Directly changed simple utility/hook: 2–3
- Impacted file (root/mid) with no direct changes: 1–2

Return ONLY a raw JSON object (no markdown):
{{
  "analyses": [
    {{
      "file_path": "...",
      "summary": "...",
      "changes_description": "...",
      "suggested_count": 3,
      "reason": "..."
    }}
  ]
}}"""

    data = await _call_openai_json(prompt)
    if not isinstance(data, dict):
        data = {}
    analyses = data.get("analyses", [])

    # Ensure every chain file has an entry (fill missing ones with defaults)
    returned = {a["file_path"]: a for a in analyses if isinstance(a, dict)}
    result = []
    for path in valid_paths:
        if path in returned:
            result.append(returned[path])
        else:
            result.append({
                "file_path": path,
                "summary": "Could not analyse this file.",
                "changes_description": "No analysis available.",
                "suggested_count": 2,
                "reason": "Defaulting to 2 tests.",
            })
    return result


# ── Suite persistence ──────────────────────────────────────────────────────────

def save_test_suite(
    org_id: str,
    workspace_id: str,
    name: str,
    scope: str,
    tests: list[dict],
    target_url: str | None = None,
    commit_sha: str | None = None,
) -> dict:
    suite_id = str(uuid.uuid4())
    suite = {
        "suite_id": suite_id,
        "org_id": org_id,
        "workspace_id": workspace_id,
        "name": name,
        "scope": scope,
        "tests": tests,
        "test_count": len(tests),
        "target_url": target_url,
        "commit_sha": commit_sha,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _TEST_SUITES[suite_id] = suite
    return {k: v for k, v in suite.items() if k != "tests"}


def list_test_suites(org_id: str, workspace_id: str) -> list[dict]:
    return [
        {k: v for k, v in suite.items() if k != "tests"}
        for suite in _TEST_SUITES.values()
        if suite["workspace_id"] == workspace_id and suite.get("org_id") == org_id
    ]


def get_test_suite(org_id: str, suite_id: str) -> dict | None:
    suite = _TEST_SUITES.get(suite_id)
    if suite is None or suite.get("org_id") != org_id:
        return None
    return suite


def delete_test_suite(org_id: str, suite_id: str) -> bool:
    suite = _TEST_SUITES.get(suite_id)
    if suite is not None and suite.get("org_id") == org_id:
        del _TEST_SUITES[suite_id]
        return True
    return False


async def run_tests(workspace_id: str, test_file_path: str, test_content: str) -> dict:
    """
    Write test content to a temp file and run pytest on it.
    Returns pass/fail counts + per-test results.
    """
    def _do():
        with tempfile.TemporaryDirectory() as tmpdir:
            test_file = os.path.join(tmpdir, Path(test_file_path).name)
            Path(test_file).write_text(test_content, encoding="utf-8")

            cmd = [
                "python", "-m", "pytest", test_file,
                "--tb=short", "-q", "--no-header",
                "--timeout=30",
            ]
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60,
                cwd=tmpdir,
            )
            output = result.stdout + result.stderr

            # Parse simple pytest output
            passed = output.count(" passed")
            failed = output.count(" failed")
            errors = output.count(" error")

            # Extract per-test results from output lines
            results = []
            for line in output.splitlines():
                if line.startswith("PASSED") or "PASSED" in line:
                    name = line.split("::")[1].split(" ")[0] if "::" in line else line
                    results.append({"name": name.strip(), "status": "passed", "duration_ms": None, "message": None})
                elif line.startswith("FAILED") or "FAILED" in line:
                    name = line.split("::")[1].split(" ")[0] if "::" in line else line
                    results.append({"name": name.strip(), "status": "failed", "duration_ms": None, "message": line})
                elif line.startswith("ERROR") or "ERROR" in line:
                    results.append({"name": "error", "status": "error", "duration_ms": None, "message": line})

            return {
                "passed": passed,
                "failed": failed,
                "errors": errors,
                "results": results,
                "output": output[:4000],  # cap output size
            }

    try:
        return await asyncio.to_thread(_do)
    except subprocess.TimeoutExpired:
        return {
            "passed": 0, "failed": 0, "errors": 1,
            "results": [{"name": "timeout", "status": "error", "duration_ms": None, "message": "Test execution timed out (30s)"}],
            "output": "Test execution timed out.",
        }
    except Exception as exc:
        return {
            "passed": 0, "failed": 0, "errors": 1,
            "results": [],
            "output": str(exc),
        }
