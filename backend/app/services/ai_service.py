"""
Ollama client wrapper (OpenAI-compatible API).
All prompts live here so every other service just calls helpers.
"""
import asyncio
import inspect
import json
import re
import time
import uuid
from contextvars import ContextVar, Token
from datetime import datetime, timezone
from typing import Any

from openai import OpenAI, RateLimitError, APIStatusError

from app.config import settings
from app.services import connector_settings_service as connectors

# ── Org attribution for cost logging ────────────────────────────────────────
# Set by app.auth.dependencies.get_current_org for the duration of a request,
# and explicitly by background-task entrypoints (analysis_runner, playwright_
# service, baseline_runner) that carry org_id but run detached from request
# scope. Read by _log_cost() so api_cost_logs documents can be attributed to
# an org without threading org_id through every one of the ~20 ai_service
# call sites individually.
_current_org_id: ContextVar[str | None] = ContextVar("_current_org_id", default=None)


def set_current_org_id(org_id: str | None) -> Token:
    """Set the org_id attributed to AI calls made in the current context. Returns a reset token."""
    return _current_org_id.set(org_id)


def reset_current_org_id(token: Token) -> None:
    _current_org_id.reset(token)


def _ollama_cfg() -> tuple[str, str, str]:
    cfg = connectors.active("ollama")
    base = (cfg.get("base_url") or settings.OLLAMA_BASE_URL or "http://localhost:11434").rstrip("/")
    key = cfg.get("api_key") or settings.OLLAMA_API_KEY or "ollama"
    model = cfg.get("model") or settings.OLLAMA_MODEL or "llama3.1"
    return base, key, model


def _get_client() -> OpenAI:
    base, key, _ = _ollama_cfg()
    return OpenAI(
        base_url=f"{base}/v1",
        api_key=key,
        timeout=600.0,
        max_retries=3,
    )


_client = OpenAI(
    base_url=f"{settings.OLLAMA_BASE_URL.rstrip('/')}/v1",
    api_key=settings.OLLAMA_API_KEY or "ollama",
    timeout=600.0,
    max_retries=3,
)
_MODEL = settings.OLLAMA_MODEL

# Ollama has no per-token billing; costs are recorded as zero but token
# counts are still logged for usage visibility.
_COST_INPUT_PER_TOKEN = 0.0
_COST_OUTPUT_PER_TOKEN = 0.0

_TASK_LABELS: dict[str, str] = {
    "generate_test_cases": "Generate Test Cases",
    "generate_requirement_based_data": "Generate Test Data (Requirement)",
    "generate_column_based_data": "Generate Test Data (Columns)",
    "analyze_codebase": "Analyze Codebase",
    "generate_playwright_tests": "Generate Playwright Tests",
    "analyze_commit_and_generate_tests": "Analyze Commit & Generate Tests",
    "prioritize_tests": "Prioritize Tests",
    "review_pull_request": "Review Pull Request",
    "explain_ci_failure": "Explain CI Failure",
    "generate_defect_risk_narrative": "Generate Defect Risk Narrative",
    "analyze_release_readiness": "Analyze Release Readiness",
    "investigate_incident": "Investigate Incident",
    "generate_sprint_summary": "Generate Sprint Summary",
    "generate_acceptance_criteria": "Generate Acceptance Criteria",
    "generate_predictive_alert": "Generate Predictive Alert",
    "generate_playwright_tests_from_source": "Generate Playwright Tests (Source)",
    "call_ai": "AI Copilot / Workspace",
    "generate_baseline_tests": "Baseline Full Scan",
    "generate_incremental_tests": "Baseline Incremental Scan",
}

# --- rate-limit handling ---------------------------------------------------

class AIQuotaError(Exception):
    """Raised when the AI backend returns 429 after all retries are exhausted."""


def _is_quota_error(exc: Exception) -> bool:
    return isinstance(exc, RateLimitError) or "429" in str(exc) or "quota" in str(exc).lower()


def _call_openai_sync(prompt: str, json_mode: bool = True) -> tuple[str, int, int]:
    """Synchronous Ollama chat completion. Returns (content, prompt_tokens, completion_tokens)."""
    delays = [5, 15, 30]
    _, _, model = _ollama_cfg()
    client = _get_client()
    kwargs: dict = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    for attempt, delay in enumerate(delays, 1):
        try:
            response = client.chat.completions.create(**kwargs)
            content = response.choices[0].message.content or ""
            usage = response.usage
            prompt_tokens = usage.prompt_tokens if usage else 0
            completion_tokens = usage.completion_tokens if usage else 0
            return content, prompt_tokens, completion_tokens
        except Exception as exc:
            if _is_quota_error(exc):
                if attempt < len(delays):
                    time.sleep(delay)
                    continue
                raise AIQuotaError(
                    "AI backend quota exceeded or rate limited. "
                    "Please wait a moment and try again. "
                    f"Details: {exc}"
                ) from exc
            raise  # non-429 errors bubble up immediately


async def _log_cost(task_name: str, prompt_tokens: int, completion_tokens: int) -> None:
    """Persist a cost record to MongoDB. Never raises cost logging must not break AI calls."""
    try:
        input_cost = round(prompt_tokens * _COST_INPUT_PER_TOKEN, 6)
        output_cost = round(completion_tokens * _COST_OUTPUT_PER_TOKEN, 6)
        total_cost = round(input_cost + output_cost, 6)
        from app.database import get_db
        _, _, model = _ollama_cfg()
        db = get_db()
        await db["api_cost_logs"].insert_one({
            "org_id": _current_org_id.get(),
            "task_name": task_name,
            "model": model,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
            "input_cost_usd": input_cost,
            "output_cost_usd": output_cost,
            "total_cost_usd": total_cost,
            "created_at": datetime.now(timezone.utc),
        })
    except Exception:
        pass  # Never break the main AI call due to cost logging failure


async def _call_openai(prompt: str, json_mode: bool = True, task_name: str | None = None) -> str:
    """Async wrapper runs the sync call in a thread so the event loop isn't blocked."""
    if task_name is None:
        frame = inspect.currentframe()
        caller = frame.f_back.f_code.co_name if (frame and frame.f_back) else "unknown"
        task_name = _TASK_LABELS.get(caller, caller.replace("_", " ").title())

    content, prompt_tokens, completion_tokens = await asyncio.to_thread(_call_openai_sync, prompt, json_mode)
    asyncio.create_task(_log_cost(task_name, prompt_tokens, completion_tokens))
    return content


# Public alias used by impact_service and other services that prefer a shorter name
async def call_ai(prompt: str, max_tokens: int = 2000, task_name: str | None = None) -> str:
    """Public async helper: sends a prompt and returns the raw text response."""
    return await _call_openai(prompt, json_mode=False, task_name=task_name or _TASK_LABELS["call_ai"])

# --------------------------------------------------------------------------


def _clean_json(raw: str) -> str:
    """Strip markdown code fences the model sometimes adds."""
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    return raw.strip()


async def generate_test_cases(requirement: str, instructions: str = None) -> dict[str, list[dict[str, str]]]:
    """
    Returns a dict with keys: functional, edge, api, failure, regression.
    Each value is a list of test-case objects.
    """
    prompt = f"""
You are a senior QA engineer. Given the software requirement below, generate comprehensive test cases.
{f"USER INSTRUCTIONS: {instructions}" if instructions else ""}

REQUIREMENT:
{requirement}

Return ONLY valid JSON (no markdown) with this exact shape:
{{
  "functional": [
    {{"tc_id": "TC-001", "name": "...", "description": "...", "severity": "Critical|High|Medium|Low", "expected": "..."}}
  ],
  "edge": [ ... ],
  "api":  [ ... ],
  "failure": [ ... ],
  "regression": [ ... ]
}}

Rules:
- functional: 4-6 tests, core happy-path scenarios
- edge: 3-4 tests, boundary / unusual inputs
- api: 3-4 tests, HTTP-level validations
- failure: 2-3 tests, error and degraded-mode scenarios
- regression: 2-3 tests, backward-compat / migration
- severity must be exactly one of: Critical, High, Medium, Low
- tc_id must be unique across all categories, starting TC-001
"""
    raw = await _call_openai(prompt)
    text = _clean_json(raw)
    data: dict[str, Any] = json.loads(text)
    return data


async def generate_requirement_based_data(
    requirement_text: str,
    count: int,
) -> dict[str, Any]:
    """
    Given a software requirement, ask the model to:
      1. Decide the most relevant test-data schema (field names, types, descriptions).
      2. Generate `count` realistic rows for that schema.

    Returns:
    {
      "schema": [{"name": str, "type": str, "description": str}, ...],
      "rows":   [{field: value, ...}, ...]
    }
    """
    prompt = f"""You are a test-data engineer.

A software team is testing the following requirement:

REQUIREMENT:
{requirement_text}

Your job has two parts:

PART 1 SCHEMA DESIGN
Decide what data fields are needed to properly test this requirement.
Do NOT use generic or vehicle-specific fields unless the requirement is about vehicles.
Infer meaningful, domain-specific fields directly from the requirement text.
Give 5-10 fields. Each field must have:
  - name: snake_case column identifier
  - type: one of "string", "integer", "float", "boolean", "datetime"
  - description: one sentence describing what realistic values look like

PART 2 DATA GENERATION
Generate {count} realistic, varied test data rows using exactly the schema you designed above.
Each row must cover different realistic scenarios implied by the requirement
(normal cases, boundary cases, edge cases, failure-prone values).

Return ONLY valid JSON (no markdown, no explanation) in this exact shape:
{{
  "schema": [
    {{"name": "...", "type": "...", "description": "..."}}
  ],
  "rows": [
    {{"field_name": value, ...}},
    ...
  ]
}}

Rules:
- Every row must have every field from the schema.
- Vary values across the {count} rows do not repeat the same values.
- Values must be realistic and directly relevant to the requirement.
- Boolean fields use true/false (JSON), not strings.
- datetime fields use ISO 8601 format strings.
- Numbers must be JSON numbers, not strings.
"""
    raw = await _call_openai(prompt)
    text = _clean_json(raw)
    result: dict[str, Any] = json.loads(text)
    return result


async def generate_column_based_data(
    columns: list[str],
    count: int = 20,
    requirement: str | None = None,
) -> list[dict[str, Any]]:
    """
    Given a list of column names (and optional requirement context),
    ask the model to generate `count` realistic data rows for those columns.
    Returns a list of dicts keyed by the column names.
    """
    req_hint = f'\nRequirement context: "{requirement}"' if requirement else ""
    prompt = f"""You are a test data generator.{req_hint}

Generate {count} realistic test data rows for a dataset with these columns:
{columns}

Return ONLY a valid JSON object with a single key "rows" containing a JSON array.
Each element must be an object with exactly these keys: {columns}
Infer sensible data types and realistic value ranges from the column names.
Vary the values realistically across rows."""

    raw = await _call_openai(prompt)
    text = _clean_json(raw)
    parsed = json.loads(text)
    # Accept either a bare array or {"rows": [...]}
    rows: list[dict[str, Any]] = parsed if isinstance(parsed, list) else parsed.get("rows", parsed)
    return rows


async def analyze_codebase(codebase_content: str, target_url: str) -> dict[str, Any]:
    """
    Analyse an extracted codebase and return structured UI information:
    summary, tech_stack, pages (with key elements), and user flows.
    """
    prompt = f"""You are a senior QA engineer performing UI analysis on a web application codebase.

TARGET URL: {target_url}

CODEBASE (extracted source files):
{codebase_content[:70000]}

Carefully read the code and identify:
1. All distinct pages / views / routes in this application
2. The key interactive UI elements on each page (buttons, inputs, links, modals, forms)
3. The main user flows (sequences of actions a user would follow)
4. The technology stack being used

Return ONLY valid JSON (no markdown, no explanation) with exactly this shape:
{{
  "summary": "One-paragraph description of what this application does",
  "tech_stack": "e.g. React + TypeScript + Tailwind + React Router",
  "pages": [
    {{
      "name": "Human-readable page name",
      "path": "/route-path",
      "description": "What the user can do on this page",
      "key_elements": ["Login button", "Email input", "Password input", "Remember me checkbox"]
    }}
  ],
  "user_flows": [
    {{
      "name": "Flow name (e.g. User Registration)",
      "steps": ["Navigate to /register", "Fill name field", "Fill email field", "Submit form", "See confirmation"]
    }}
  ]
}}

Rules:
- Identify 3–8 pages. If the app has fewer pages, identify all of them.
- Identify 2–5 meaningful user flows.
- key_elements must name the actual UI text/labels visible in the code (e.g. "Sign In button" not "button").
- path must be the actual route path as defined in the router.
"""
    raw = await _call_openai(prompt)
    text = _clean_json(raw)
    return json.loads(text)


async def generate_playwright_tests(
    analysis: dict[str, Any],
    target_url: str,
    test_email: str | None = None,
    test_password: str | None = None,
    test_preferences: str | None = None,
    num_tests: int = 1,
) -> list[dict[str, Any]]:
    """
    Given a structured codebase analysis, generate Playwright test cases with
    specific, executable steps (navigate, click, fill, assert_text, screenshot).
    Real credentials (test_email / test_password) are injected so that login tests
    use actual values instead of placeholders.
    """
    # Build credentials hint for the prompt
    cred_section = ""
    if test_email and test_password:
        cred_section = f"""
REAL TEST CREDENTIALS (use these exact values in fill steps for login forms):
  Email:    {test_email}
  Password: {test_password}

IMPORTANT: Replace any placeholder email/password values with the credentials above.
Do NOT use "testuser@example.com" or "Password123!" use the real credentials provided.
"""
    elif test_email:
        cred_section = f"""
REAL TEST CREDENTIALS:
  Email:    {test_email}
  Password: (not provided skip tests that require a password)
"""
    else:
        cred_section = """
TEST CREDENTIALS: Not provided.
Use placeholder values but add a comment in the description that real credentials are needed.
"""

    pref_string = f"USER TEST PREFERENCES:\n{test_preferences}\n\nPrioritize generating tests that match the preferences above.\n" if test_preferences else ""

    prompt = f"""You are a senior Playwright test automation engineer with deep expertise in React, Radix UI, and modern component libraries.

TARGET URL: {target_url}
{cred_section}
APPLICATION ANALYSIS:
{json.dumps(analysis, indent=2)}

Generate comprehensive Playwright test cases that cover the pages and user flows above.

{pref_string}
Return ONLY valid JSON (no markdown) with exactly this shape:
{{
  "tests": [
    {{
      "name": "Descriptive test name",
      "description": "What this test verifies",
      "page_name": "Name of the page being tested",
      "severity": "Critical|High|Medium|Low",
      "steps": [
        {{
          "action": "navigate",
          "selector": null,
          "value": "/route-path",
          "description": "Navigate to the page"
        }},
        {{
          "action": "screenshot",
          "selector": null,
          "value": null,
          "description": "Capture page load state"
        }},
        {{
          "action": "fill",
          "selector": "input[type=\\"email\\"]",
          "value": "{test_email or 'user@example.com'}",
          "description": "Enter email address"
        }},
        {{
          "action": "fill",
          "selector": "input[type=\\"password\\"]",
          "value": "{test_password or 'yourpassword'}",
          "description": "Enter password"
        }},
        {{
          "action": "click",
          "selector": "button:has-text(\\"Sign In\\")",
          "value": null,
          "description": "Click the Sign In button"
        }},
        {{
          "action": "wait",
          "selector": null,
          "value": "4",
          "description": "Wait for redirect to complete"
        }},
        {{
          "action": "assert_text",
          "selector": null,
          "value": "Text expected to be visible after action",
          "description": "Verify the expected result"
        }},
        {{
          "action": "screenshot",
          "selector": null,
          "value": null,
          "description": "Capture final state"
        }}
      ]
    }}
  ]
}}

STRICT RULES follow every rule or tests will fail:

GENERAL:
- Generate EXACTLY {num_tests} test case(s). No more, no fewer.
- ALWAYS start each test with a "navigate" step.
- Include at least 2 "screenshot" steps per test (beginning and end).
- For login fill steps, use EXACTLY the credentials provided above (not placeholders).
- After clicking a submit/login button, add a "wait" step of "4" seconds before asserting.

SELECTOR RULES (critical):
- For button clicks: ALWAYS use button:has-text("Label") NEVER use text=Label.
- For link clicks: use a:has-text("Label") or [role="link"]:has-text("Label").
- For standard inputs: input[type="email"], input[type="password"].
- For dialog/modal inputs: use selector '[role="dialog"] input' (NOT input[type="text"] since type may be absent).
- For inputs with placeholder: ALWAYS quote: input[placeholder="Search tasks..."] NOT input[placeholder=Search tasks...].
- CSS attribute values with spaces or special chars MUST use double quotes.
- For role-based elements: [role="dialog"], [role="checkbox"], button[type="submit"].

RADIX UI / CUSTOM COMPONENTS (CRITICAL read carefully):
- Checkboxes in Radix UI are NOT native inputs. Use [role="checkbox"] or [data-state="unchecked"] NOT input[type="checkbox"].
- Radix UI <Select> triggers render with role="combobox", NOT as plain <button> elements.
  To click a Radix Select trigger:
    • Inside a dialog: use '[role="dialog"] [role="combobox"]'   ← NOT '[role="dialog"] button:has-text("Priority")'
    • On the page: use '[role="combobox"]' or '[role="combobox"]:has-text("placeholder text")'
  After clicking the combobox trigger, click the option: [role="option"]:has-text("Value")
- NEVER write 'button:has-text("Priority")' or 'button:has-text("Sort")' for Radix Select triggers they will ALWAYS timeout.
- For plain filter chips (All/Active/Completed toggle buttons that are real buttons): button:has-text("Completed") is fine.

LIST ITEMS (CRITICAL):
- Do NOT assume task/todo/item list entries are <li> elements. Modern React apps often use <div> or <article>.
- For hover_and_click containers, use: '[class*="item"]', '[class*="task"]', '[class*="card"]', 'article', '[role="listitem"]'
- Do NOT use bare 'li:has-text("...")' for task list items use '[class*="item"]:has-text("...")', 'article:has-text("...")', or '[role="listitem"]:has-text("...")'

HIDDEN ELEMENTS (hover-to-reveal):
- If a button only appears on hover (e.g. Delete, Edit on list items), use "hover_and_click" action:
  selector = a broad container selector to hover (e.g. "[class*='item']:has-text('Task Name')", "article:has-text('Task Name')")
  value = the button selector to click after hovering (e.g. "button:has-text(\\"Edit\\")")
- Alternative: use "hover" action first, then "click" action for the revealed button.

SUPPORTED ACTIONS:
navigate, click, fill, assert_text, screenshot, wait, hover, hover_and_click, press, check, uncheck, select_option, drag_and_drop, dblclick, type_into, scroll, clear

- "hover_and_click": selector=element to hover over, value=element to click after hover reveals it
- "press": value=key name e.g. "Enter", "Tab", "Escape"
- "check"/"uncheck": for native checkboxes only
- "select_option": for native <select> only; for custom selects use click+click pattern
- "drag_and_drop": selector=source, value=target
- "wait": value=seconds as string e.g. "4"
- "scroll": selector=element to scroll into view
- "clear": selector=input to clear

SEVERITY: Critical=auth/core, High=main feature, Medium=secondary, Low=cosmetic.
"""
    raw = await _call_openai(prompt)
    text = _clean_json(raw)
    parsed = json.loads(text)
    tests: list[dict[str, Any]] = parsed.get("tests", [])
    return tests


async def analyze_commit_and_generate_tests(
    commit_sha: str,
    commit_message: str,
    diff_text: str,
    file_contents: str,
    changed_files: list[str],
    target_url: str,
    test_email: str | None = None,
    test_password: str | None = None,
    num_tests: int = 1,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """
    Given the diff of a specific commit, first understand what user-facing
    functionality changed, then generate targeted Playwright tests for those changes.
    Returns (analysis_data, tests_list).
    """
    cred_section = ""
    if test_email and test_password:
        cred_section = f"""
REAL TEST CREDENTIALS (use these EXACT values in login fill steps):
  Email:    {test_email}
  Password: {test_password}
"""
    elif test_email:
        cred_section = f"""
REAL TEST CREDENTIALS:
  Email:    {test_email}
  Password: (not provided skip tests that require a password)
"""
    else:
        cred_section = "TEST CREDENTIALS: Not provided. Use placeholder values."

    prompt = f"""You are a senior QA engineer and Playwright automation engineer.

A developer just committed: "{commit_message}" (SHA: {commit_sha[:8]})
CHANGED FILES: {', '.join(changed_files[:20])}

TARGET APP URL: {target_url}
{cred_section}

GIT DIFF (what changed):
{diff_text[:25000]}

CURRENT FILE CONTENTS (after the commit):
{file_contents[:25000]}

Your task has TWO parts:

PART 1 UNDERSTAND THE CHANGE
Analyze what user-facing functionality changed in this commit. Focus on:
- Which pages/views are affected
- What new features or bug fixes were introduced
- What user interactions are affected

PART 2 GENERATE TARGETED PLAYWRIGHT TESTS
Generate EXACTLY {num_tests} targeted Playwright test case(s) that specifically verify the changed functionality.
These are REGRESSION tests confirm the commit's changes work correctly.

Return ONLY valid JSON (no markdown, no explanation):
{{
  "analysis": {{
    "summary": "One paragraph: what this commit changes from a user's perspective",
    "tech_stack": "Technology stack of the app",
    "pages": [
      {{
        "name": "Page name",
        "path": "/route",
        "description": "What changed on this page",
        "key_elements": ["Element 1", "Element 2"]
      }}
    ],
    "user_flows": [
      {{
        "name": "Affected user flow name",
        "steps": ["Step 1", "Step 2", "Step 3"]
      }}
    ]
  }},
  "tests": [
    {{
      "name": "Descriptive test name targeting the changed functionality",
      "description": "What specific change this test validates",
      "page_name": "Page being tested",
      "severity": "Critical|High|Medium|Low",
      "steps": [
        {{"action": "navigate", "selector": null, "value": "/", "description": "Open the app"}},
        {{"action": "screenshot", "selector": null, "value": null, "description": "Capture initial state"}},
        {{"action": "fill", "selector": "input[type=\\"email\\"]", "value": "{test_email or 'user@example.com'}", "description": "Enter email"}},
        {{"action": "fill", "selector": "input[type=\\"password\\"]", "value": "{test_password or 'password'}", "description": "Enter password"}},
        {{"action": "click", "selector": "button:has-text(\\"Sign In\\")", "value": null, "description": "Sign in"}},
        {{"action": "wait", "selector": null, "value": "4", "description": "Wait for redirect"}},
        {{"action": "assert_text", "selector": null, "value": "Expected text after action", "description": "Verify the change works"}},
        {{"action": "screenshot", "selector": null, "value": null, "description": "Capture final state"}}
      ]
    }}
  ]
}}

STRICT RULES for tests (all apply from the standard test generation):
- ALWAYS start each test with "navigate".
- Include at least 2 "screenshot" steps per test.
- For login steps, use EXACT credentials provided.
- After clicking login/submit, add "wait" step of "4" seconds.
- For Radix UI Select triggers: use [role="combobox"], NOT button:has-text("...").
- For Radix UI Checkboxes: use [role="checkbox"], NOT input[type="checkbox"].
- For hover-reveal buttons (opacity-0): use "hover_and_click" action.
  selector = container to hover, value = button selector to click.
- CSS attribute values with spaces MUST use double-quotes.
- severity: Critical=auth/core, High=main feature, Medium=secondary, Low=cosmetic.
SUPPORTED ACTIONS: navigate, click, fill, assert_text, screenshot, wait, hover, hover_and_click, press, check, uncheck, select_option, drag_and_drop, dblclick, type_into, scroll, clear
"""
    raw = await _call_openai(prompt)
    text = _clean_json(raw)
    parsed: dict[str, Any] = json.loads(text)

    analysis_data: dict[str, Any] = parsed.get("analysis", {})
    tests: list[dict[str, Any]] = parsed.get("tests", [])
    return analysis_data, tests


async def prioritize_tests(test_results_summary: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Given a summary of recent test results, ask the model to rank them by risk.
    Returns list ordered by priority desc.
    """
    prompt = f"""
You are a QA risk analyst. Based on the test execution history below, rank each test case
by execution priority (0-100, higher = run first).

TEST HISTORY (JSON):
{json.dumps(test_results_summary, indent=2)}

Return ONLY a valid JSON object with a single key "results" containing an array ordered by priority descending.
Each entry must have:
{{
  "tc_id": "...",
  "name": "...",
  "priority": <int 0-100>,
  "status": "failed" | "warning" | "stable",
  "known_failure": <bool>,
  "failure_count": <int>,
  "severity": "Critical|High|Medium|Low"
}}
Base priority on: failure frequency, severity, recent failures, and potential impact.
"""
    raw = await _call_openai(prompt)
    text = _clean_json(raw)
    parsed = json.loads(text)
    ranked: list[dict[str, Any]] = parsed if isinstance(parsed, list) else parsed.get("results", list(parsed.values())[0])
    return ranked


# ─── NEW: SDLC Intelligence prompts ────────────────────────────────────────


async def review_pull_request(pr_title: str, pr_body: str, files: list[dict], custom_rules: str | None = None) -> dict[str, Any]:
  """AI code review for a GitHub pull request with safe v2->legacy fallback."""
  if not settings.PR_REVIEW_V2_ENABLED:
    return await _review_pull_request_legacy(pr_title, pr_body, files, custom_rules)
  try:
    return await _review_pull_request_v2(pr_title, pr_body, files, custom_rules)
  except Exception:
    return await _review_pull_request_legacy(pr_title, pr_body, files, custom_rules)


_OSS_SUMMARIZE_FILE_DIFF_PROMPT = """## GitHub PR Title

`$title`

## Description

```
$description
```

## Diff

```diff
$file_diff
```

## Instructions

I would like you to succinctly summarize the diff within 100 words.
If applicable, your summary should include a note about alterations
to the signatures of exported functions, global data structures and
variables, and any changes that might affect the external interface or
behavior of the code.
"""

_OSS_TRIAGE_FILE_DIFF_PROMPT = """Below the summary, I would also like you to triage the diff as `NEEDS_REVIEW` or
`APPROVED` based on the following criteria:

- If the diff involves any modifications to the logic or functionality, even if they
  seem minor, triage it as `NEEDS_REVIEW`. This includes changes to control structures,
  function calls, or variable assignments that might impact the behavior of the code.
- If the diff only contains very minor changes that don't affect the code logic, such as
  fixing typos, formatting, or renaming variables for clarity, triage it as `APPROVED`.

Please evaluate the diff thoroughly and take into account factors such as the number of
lines changed, the potential impact on the overall system, and the likelihood of
introducing new bugs or security vulnerabilities.
When in doubt, always err on the side of caution and triage the diff as `NEEDS_REVIEW`.

You must strictly follow the format below for triaging the diff:
[TRIAGE]: <NEEDS_REVIEW or APPROVED>

Important:
- In your summary do not mention that the file needs a through review or caution about
  potential issues.
- Do not provide any reasoning why you triaged the diff as `NEEDS_REVIEW` or `APPROVED`.
- Do not mention that these changes affect the logic or functionality of the code in
  the summary. You must only use the triage status format above to indicate that.
"""

_OSS_REVIEW_FILE_DIFF_PROMPT = """## GitHub PR Title

`$title`

## Description

```
$description
```

## Summary of changes

```
$short_summary
```

## IMPORTANT Instructions

Input: New hunks annotated with line numbers and old hunks (replaced code). Hunks represent incomplete code fragments.
Additional Context: PR title, description, summaries and comment chains.
Task: Review new hunks for substantive issues using provided context and respond with comments if necessary.
Output: Review comments in markdown with exact line number ranges in new hunks. Start and end line numbers must be within the same hunk. For single-line comments, start=end line number. Must use example response format below.
Use fenced code blocks using the relevant language identifier where applicable.
Don't annotate code snippets with line numbers. Format and indent code correctly.
Do not use `suggestion` code blocks.
For fixes, use `diff` code blocks, marking changes with `+` or `-`. The line number range for comments with fix snippets must exactly match the range to replace in the new hunk.

- Do NOT provide general feedback, summaries, explanations of changes, or praises
  for making good additions.
- Focus solely on offering specific, objective insights based on the
  given context and refrain from making broad comments about potential impacts on
  the system or question intentions behind the changes.

If there are no issues found on a line range, you MUST respond with the
text `LGTM!` for that line range in the review section.

$custom_rules_section

## Changes made to `$filename` for your review

$patches
"""


def _render_oss_prompt(template: str, values: dict[str, str]) -> str:
  rendered = template
  for key, value in values.items():
    rendered = rendered.replace(f"${key}", value)
  return rendered


def _parse_patch_line_bounds(patch: str) -> tuple[int, int]:
  pattern = re.compile(r"^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@", re.MULTILINE)
  bounds: list[tuple[int, int]] = []
  for match in pattern.finditer(patch):
    start = int(match.group(1))
    length = int(match.group(2) or "1")
    end = start + max(length - 1, 0)
    bounds.append((start, end))
  if not bounds:
    return (1, 1)
  return min(x[0] for x in bounds), max(x[1] for x in bounds)


def _extract_hunks(patch: str, max_hunks: int) -> list[dict[str, Any]]:
  pattern = re.compile(
    r"^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@",
    re.MULTILINE,
  )
  hunks: list[dict[str, Any]] = []
  matches = list(pattern.finditer(patch))
  for idx, match in enumerate(matches):
    start_ix = match.start()
    end_ix = matches[idx + 1].start() if idx + 1 < len(matches) else len(patch)
    new_start = int(match.group(3))
    new_len = int(match.group(4) or "1")
    new_end = new_start + max(new_len - 1, 0)
    hunks.append(
      {
        "start_line": new_start,
        "end_line": new_end,
        "text": patch[start_ix:end_ix].strip(),
      }
    )
    if len(hunks) >= max_hunks:
      break
  return hunks


def _normalize_recommendation(value: str | None) -> str:
  normalized = (value or "").strip().upper()
  allowed = {"APPROVE", "REQUEST_CHANGES", "NEEDS_DISCUSSION", "CONDITIONAL"}
  if normalized in allowed:
    return normalized
  if normalized in {"COMMENT", "COMMENTS"}:
    return "CONDITIONAL"
  return "CONDITIONAL"


def _normalize_severity(value: str | None) -> str:
  normalized = (value or "").strip().lower()
  if normalized in {"critical", "high", "medium", "low"}:
    return normalized
  return "low"


def _normalize_category(value: str | None) -> str:
  normalized = (value or "").strip().lower()
  allowed = {
    "security",
    "bug",
    "performance",
    "style",
    "test-coverage",
    "maintainability",
  }
  return normalized if normalized in allowed else "maintainability"


def _normalize_findings(file_name: str, patch: str, findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
  min_line, max_line = _parse_patch_line_bounds(patch)
  normalized: list[dict[str, Any]] = []
  for raw in findings:
    message_text = str(raw.get("message") or "").strip()
    if message_text.lower() in {"lgtm", "lgtm!", "looks good", "looks good to me", "no changes needed."}:
      continue

    start_line = raw.get("start_line") or raw.get("line") or min_line
    end_line = raw.get("end_line") or start_line
    try:
      start_line = int(start_line)
    except (TypeError, ValueError):
      start_line = min_line
    try:
      end_line = int(end_line)
    except (TypeError, ValueError):
      end_line = start_line

    start_line = max(min_line, min(start_line, max_line))
    end_line = max(start_line, min(end_line, max_line))

    normalized.append(
      {
        "file": file_name,
        "line": start_line,
        "start_line": start_line,
        "end_line": end_line,
        "severity": _normalize_severity(raw.get("severity")),
        "category": _normalize_category(raw.get("category")),
        "message": message_text or "Potential issue identified.",
        "suggestion": str(raw.get("suggestion") or "Review this block and add safeguards."),
      }
    )
  return normalized


async def _review_pull_request_v2(pr_title: str, pr_body: str, files: list[dict], custom_rules: str | None = None) -> dict[str, Any]:
  files_limit = max(1, settings.PR_REVIEW_MAX_FILES)
  patch_limit = max(500, settings.PR_REVIEW_MAX_PATCH_CHARS)
  hunks_limit = max(1, settings.PR_REVIEW_MAX_HUNKS_PER_FILE)

  selected_files: list[dict[str, Any]] = []
  skipped_files = 0
  for file_obj in files[:files_limit]:
    patch = str(file_obj.get("patch") or "")
    if not patch.strip():
      skipped_files += 1
      continue
    selected_files.append(
      {
        "filename": str(file_obj.get("filename") or "unknown"),
        "additions": int(file_obj.get("additions") or 0),
        "deletions": int(file_obj.get("deletions") or 0),
        "patch": patch[:patch_limit],
      }
    )

  if not selected_files:
    return {
      "summary": {
        "overall_risk": "low",
        "what_changed": "No textual diff hunks were available for review.",
        "test_coverage_estimate": "Not enough code changes to evaluate.",
        "review_recommendation": "CONDITIONAL",
      },
      "findings": [],
      "security_flags": [],
      "positive_observations": [],
      "positives": [],
      "recommendation": "CONDITIONAL",
      "meta": {
        "files_reviewed": 0,
        "files_skipped": skipped_files,
        "engine_version": "v2",
      },
    }

  file_summaries: list[dict[str, str]] = []
  review_targets: list[dict[str, Any]] = []
  aggregated_security_flags: list[str] = []
  aggregated_positives: list[str] = []
  all_findings: list[dict[str, Any]] = []

  async def process_summary(file_obj):
    summary_prompt_base = _OSS_SUMMARIZE_FILE_DIFF_PROMPT + "\n\n" + _OSS_TRIAGE_FILE_DIFF_PROMPT
    if custom_rules:
      summary_prompt_base += f"\n\nIMPORTANT: Take into account these TEAM GROUND RULES when deciding triage. If the diff violates any of these, you MUST output NEEDS_REVIEW:\n{custom_rules}"

    summary_prompt = _render_oss_prompt(
      summary_prompt_base,
      {
        "title": pr_title,
        "description": pr_body[:1200] or "no description provided",
        "file_diff": file_obj["patch"],
      },
    ) + """

Return ONLY valid JSON:
{
  "summary": "Max 100 words",
  "triage": "NEEDS_REVIEW|APPROVED"
}
"""
    try:
      summary_raw = await _call_openai(summary_prompt, json_mode=True, task_name="Review Pull Request")
      summary_data = json.loads(_clean_json(summary_raw))
    except Exception:
      summary_data = {}
      
    triage = str(summary_data.get("triage") or "NEEDS_REVIEW").strip().upper()
    if triage not in {"NEEDS_REVIEW", "APPROVED"}:
      triage = "NEEDS_REVIEW"
    summary_text = str(summary_data.get("summary") or "Diff summarized.")
    return file_obj, triage, summary_text

  summary_results = await asyncio.gather(*(process_summary(f) for f in selected_files))
  for file_obj, triage, summary_text in summary_results:
    file_summaries.append({
      "file": file_obj["filename"],
      "summary": summary_text,
      "triage": triage,
    })
    if triage == "NEEDS_REVIEW":
      review_targets.append(file_obj)

  if not review_targets:
    review_targets = selected_files[: max(1, min(2, len(selected_files)))]

  short_summary_text = "\n".join([f"- {item['file']}: {item['summary']}" for item in file_summaries[:12]])

  async def process_review(file_obj):
    hunks = _extract_hunks(file_obj["patch"], hunks_limit)
    patches_text = "\n\n".join(
      [
        f"---new_hunk---\n```\n{h['text']}\n```\n\n---old_hunk---\n```\nUnavailable from provider patch payload\n```\n\n---end_change_section---"
        for h in hunks
      ]
    )
    custom_rules_section = f"## CRITICAL TEAM GROUND RULES\nThe team relies on you as the final gatekeeper for these rules. You MUST ruthlessly critique the diff hunks against these rules. If the updated code violates ANY of the following constraints, you must explicitly flag it as a finding with a HIGH or CRITICAL severity. DO NOT ignore these:\n\n{custom_rules}\n" if custom_rules else ""

    review_prompt = _render_oss_prompt(
      _OSS_REVIEW_FILE_DIFF_PROMPT,
      {
        "title": pr_title,
        "description": pr_body[:1200] or "no description provided",
        "short_summary": short_summary_text or "No summary available.",
        "filename": file_obj["filename"],
        "patches": patches_text,
        "custom_rules_section": custom_rules_section,
      },
    ) + """

Return ONLY valid JSON with exactly this shape:
{
  "findings": [
    {
      "start_line": 1,
      "end_line": 1,
      "severity": "critical|high|medium|low",
      "category": "security|bug|performance|style|test-coverage|maintainability",
      "message": "Issue detail",
      "suggestion": "Concrete fix"
    }
  ],
  "security_flags": ["string"],
  "positive_observations": ["string"]
}
"""
    try:
      review_raw = await _call_openai(review_prompt, json_mode=True, task_name="Review Pull Request")
      review_data = json.loads(_clean_json(review_raw))
    except Exception:
      review_data = {}
    return file_obj, review_data

  review_results = await asyncio.gather(*(process_review(f) for f in review_targets))
  
  for file_obj, review_data in review_results:
    findings = review_data.get("findings") or []
    if isinstance(findings, list):
      all_findings.extend(_normalize_findings(file_obj["filename"], file_obj["patch"], findings))

    security_flags = review_data.get("security_flags") or []
    positives = review_data.get("positive_observations") or []
    if isinstance(security_flags, list):
      aggregated_security_flags.extend([str(x) for x in security_flags if str(x).strip()])
    if isinstance(positives, list):
      aggregated_positives.extend([str(x) for x in positives if str(x).strip()])

  final_prompt = f"""You are a release-focused code reviewer.

PR TITLE: {pr_title}
PR DESCRIPTION: {pr_body[:1200]}

FILE SUMMARIES:
{json.dumps(file_summaries, indent=2)[:12000]}

FINDINGS:
{json.dumps(all_findings, indent=2)[:12000]}

Return ONLY valid JSON:
{{
  "overall_risk": "low|medium|high|critical",
  "what_changed": "1-2 sentence summary",
  "test_coverage_estimate": "Coverage note",
  "review_recommendation": "APPROVE|REQUEST_CHANGES|NEEDS_DISCUSSION|CONDITIONAL"
}}
"""
  final_raw = await _call_openai(final_prompt, json_mode=True, task_name="Review Pull Request")
  final_data = json.loads(_clean_json(final_raw))

  recommendation = _normalize_recommendation(str(final_data.get("review_recommendation") or "CONDITIONAL"))
  unique_security = list(dict.fromkeys(aggregated_security_flags))
  unique_positives = list(dict.fromkeys(aggregated_positives))

  return {
    "summary": {
      "overall_risk": str(final_data.get("overall_risk") or "medium").lower(),
      "what_changed": str(final_data.get("what_changed") or "Updated files and behavior in this pull request."),
      "test_coverage_estimate": str(final_data.get("test_coverage_estimate") or "Tests impact requires manual verification."),
      "review_recommendation": recommendation,
    },
    "findings": all_findings,
    "security_flags": unique_security,
    "positive_observations": unique_positives,
    "positives": unique_positives,
    "recommendation": recommendation,
    "meta": {
      "files_reviewed": len(selected_files),
      "files_skipped": skipped_files,
      "files_triaged_for_deep_review": len(review_targets),
      "engine_version": "v2",
      "file_summaries": file_summaries,
    },
  }


async def _review_pull_request_legacy(pr_title: str, pr_body: str, files: list[dict], custom_rules: str | None = None) -> dict[str, Any]:
  """Legacy single-pass PR review path kept for fallback compatibility."""
  diff_text = "\n\n".join(
    f"=== {f['filename']} (+{f['additions']} -{f['deletions']}) ===\n{f.get('patch', '')[:3000]}"
    for f in files[:15]
  )
  
  custom_rules_section = f"\nTEAM GROUND RULES TO ENFORCE:\n{custom_rules}\n" if custom_rules else ""
  
  prompt = f"""You are a senior software engineer performing a thorough code review.

PR TITLE: {pr_title}
PR DESCRIPTION: {pr_body[:1000]}
{custom_rules_section}
DIFF:
{diff_text[:20000]}

Analyse every file in the diff and return structured findings.

Return ONLY valid JSON (no markdown) with exactly this shape:
{{
  "summary": {{
  "overall_risk": "low|medium|high|critical",
  "what_changed": "1–2 sentence description",
  "test_coverage_estimate": "string (e.g. 'No tests included', 'Unit tests added for 3 functions')",
  "review_recommendation": "APPROVE|REQUEST_CHANGES|NEEDS_DISCUSSION"
  }},
  "findings": [
  {{
    "file": "relative/file/path.ts",
    "line": 42,
    "severity": "critical|high|medium|low",
    "category": "security|bug|performance|style|test-coverage|maintainability",
    "message": "Clear description of the issue",
    "suggestion": "Concrete fix or improvement"
  }}
  ],
  "security_flags": ["string"],
  "positive_observations": ["string"]
}}

Focus on: SQL injection, XSS, null dereferences, missing error handling, hardcoded secrets,
N+1 queries, missing input validation, unhandled promises, race conditions.
Return JSON only."""
  raw = await _call_openai(prompt)
  data = json.loads(_clean_json(raw))
  summary_field = data.get("summary", "")
  if isinstance(summary_field, dict):
    parts = []
    if summary_field.get("what_changed"):
      parts.append(summary_field["what_changed"])
    if summary_field.get("overall_risk"):
      parts.append(f"Risk: {summary_field['overall_risk']}")
    if summary_field.get("test_coverage_estimate"):
      parts.append(summary_field["test_coverage_estimate"])
    data["summary"] = " | ".join(parts) if parts else str(summary_field)
    if not data.get("recommendation") and summary_field.get("review_recommendation"):
      data["recommendation"] = summary_field["review_recommendation"]
  if "positive_observations" in data and "positives" not in data:
    data["positives"] = data.pop("positive_observations")
  return data


async def explain_ci_failure(step: str, error_message: str, stack_trace: str, repo_language: str) -> dict[str, Any]:
    """Explain a CI/CD build failure in plain English."""
    prompt = f"""You are a DevOps engineer. A CI build failed.

Repository language: {repo_language}
Failed step: {step}
Error message: {error_message[:2000]}
Stack trace (first 10 lines):
{stack_trace[:3000]}

Return ONLY valid JSON:
{{
  "explanation": "2–3 sentence plain-English explanation of what went wrong",
  "fix": "One concrete actionable fix",
  "category": "test|build|dependency|environment|flaky|lint|timeout",
  "confidence": 0.85,
  "is_flaky_candidate": false
}}"""
    raw = await _call_openai(prompt)
    return json.loads(_clean_json(raw))


async def generate_defect_risk_narrative(top_risk_files: list[dict]) -> str:
    """Write a risk summary narrative for the top high-risk files."""
    prompt = f"""You are a software engineering lead reviewing code quality metrics.
These are the top highest-risk files in the repository based on change frequency,
bug-fix association, code churn, and author diversity:

{json.dumps(top_risk_files, indent=2)[:8000]}

Write a 3-paragraph risk summary for an engineering manager:
1. Which files need immediate attention and why
2. Pattern analysis are these in the same module? Same author?
3. Recommended actions (add tests, refactor, code review gate)

Keep it concise and actionable. Plain text, no markdown headers."""
    raw = await _call_openai(prompt)
    return raw.strip()


async def analyze_release_readiness(
    version: str,
    test_pass_rate: float,
    open_critical_bugs: list[dict],
    unresolved_security_findings: int,
    high_risk_files: list[str],
    score: int,
) -> dict[str, Any]:
    """Compute a go/no-go verdict for a release."""
    bug_titles = [f"{b['key']}: {b['summary']}" for b in open_critical_bugs[:5]]
    prompt = f"""You are a release manager. Evaluate this release:

Version: {version}
Test pass rate: {test_pass_rate:.1f}%
Open critical/high bugs: {len(open_critical_bugs)} ({', '.join(bug_titles) or 'none'})
Unresolved security findings: {unresolved_security_findings}
High-risk files changed: {', '.join(high_risk_files[:8]) or 'none'}
Release readiness score: {score}/100

Return ONLY valid JSON:
{{
  "verdict": "GO|NO-GO|CONDITIONAL",
  "confidence": 0.85,
  "primary_blocker": "string or null",
  "recommendation": "2–3 sentence recommendation",
  "conditions": ["string (only if CONDITIONAL)"]
}}"""
    raw = await _call_openai(prompt)
    return json.loads(_clean_json(raw))


async def investigate_incident(
    anomaly: dict,
    column_comparison: list[dict],
    recent_commits: list[str],
    related_alerts: list[dict],
) -> dict[str, Any]:
    """AI root cause analysis for a data quality incident."""
    prompt = f"""You are an incident response engineer. A data quality anomaly has been detected.

Anomaly: {json.dumps(anomaly)}
Affected columns (current vs baseline): {json.dumps(column_comparison[:10])}
Recent commits: {json.dumps(recent_commits[:5])}
Related alerts: {json.dumps(related_alerts[:5])}

Provide a root cause analysis. Return ONLY valid JSON:
{{
  "root_cause": "One sentence most likely root cause",
  "evidence": ["bullet point 1", "bullet point 2", "bullet point 3"],
  "immediate_action": "Single most important remediation step",
  "prevention_action": "How to prevent recurrence",
  "confidence": 0.80
}}"""
    raw = await _call_openai(prompt)
    return json.loads(_clean_json(raw))


async def generate_sprint_summary(sprint_report: dict) -> str:
    """AI-generated sprint quality summary for an engineering manager."""
    prompt = f"""You are an engineering manager. Summarise this sprint's quality performance:

{json.dumps(sprint_report, indent=2)[:6000]}

Write an executive summary (3 paragraphs):
1. What went well (quality wins, story delivery, test coverage)
2. What needs attention (risks that materialised, production incidents, ambiguous stories)
3. Recommendations for next sprint

Keep it factual, reference specific story IDs and numbers where present.
Plain text, no markdown headers, no bullet points just 3 clean paragraphs."""
    raw = await _call_openai(prompt, json_mode=False)
    return raw.strip()


async def generate_acceptance_criteria(story: dict, existing_stories: list[dict]) -> dict[str, Any]:
    """Generate BDD acceptance criteria for a Jira user story."""
    context = "\n".join(f"- {s['key']}: {s['summary']}" for s in existing_stories[:10])
    prompt = f"""You are a senior QA engineer and business analyst.

USER STORY:
Key: {story.get('key', 'N/A')}
Summary: {story.get('summary', '')}
Description: {story.get('description', '')[:1500]}
Priority: {story.get('priority', 'Medium')}

EXISTING STORIES (for duplicate detection):
{context}

Generate structured acceptance criteria. Return ONLY valid JSON:
{{
  "acceptance_criteria": [
    {{
      "scenario": "Scenario name",
      "given": "Given context",
      "when": "When action",
      "then": "Then expected outcome"
    }}
  ],
  "ambiguity_flags": [
    {{
      "term": "ambiguous term",
      "question": "specific clarification question"
    }}
  ],
  "risk_score": 65,
  "risk_reasoning": "why this score",
  "duplicate_of": "PROJ-123 or null",
  "test_hints": ["key thing to test 1", "key thing to test 2"]
}}

Generate 3–5 Given/When/Then scenarios. Flag terms that are undefined or ambiguous."""
    raw = await _call_openai(prompt)
    return json.loads(_clean_json(raw))


async def generate_predictive_alert(time_series: list[dict], anomalies: list[dict]) -> dict[str, Any]:
    """Generate a predictive alert message from quality time series data."""
    prompt = f"""You are a data observability engineer.

30-day quality score time series (last 10 points):
{json.dumps(time_series[-10:], indent=2)}

Detected anomalies:
{json.dumps(anomalies, indent=2)[:3000]}

Predict which dimension is at risk in the next 48 hours and write a Slack-ready alert.

Return ONLY valid JSON:
{{
  "at_risk_dimension": "completeness|uniqueness|validity|consistency|overall",
  "predicted_breach_in_hours": 36,
  "severity": "critical|warning|info",
  "alert_message": "Slack-ready alert message (2–3 sentences)",
  "recommended_action": "Specific investigation step"
}}"""
    raw = await _call_openai(prompt)
    return json.loads(_clean_json(raw))


async def generate_playwright_tests_from_source(
    file_path: str,
    content: str,
    target_url: str | None = None,
  num_tests: int | None = None,
) -> list[dict[str, Any]]:
    """
    Given a React/TypeScript source file from the workspace, generate PlaywrightTestCase
    objects with structured steps. No running app required steps use relative paths.
    """
    url_line = (
        f"TARGET BASE URL: {target_url} (use as prefix for navigate steps)"
        if target_url
        else "TARGET BASE URL: not provided use relative paths like '/', '/login', '/dashboard'"
    )
    truncated = content[:10000]
    requested_tests = max(1, min(int(num_tests or 5), 20))

    prompt = f"""You are a senior Playwright E2E test automation engineer specializing in React, TypeScript, and Radix UI.

Given a React/TypeScript source file from a web application, generate comprehensive Playwright test cases.

FILE PATH: {file_path}
{url_line}

SOURCE FILE:
{truncated}

Analyze the component/page to identify:
- The page name and primary feature
- All interactive elements: buttons, forms, inputs, links, dialogs
- Key user flows (happy path, validation, error states)
- Navigation patterns

Return ONLY raw JSON no markdown fences, no extra text:
{{
  "tests": [
    {{
      "name": "Concise descriptive test name",
      "description": "One-sentence description of what is verified",
      "page_name": "Name of the page or feature (e.g. Login, Dashboard)",
      "severity": "Critical|High|Medium|Low",
      "steps": [
        {{
          "action": "navigate",
          "selector": null,
          "value": "/",
          "description": "Navigate to the page"
        }},
        {{
          "action": "screenshot",
          "selector": null,
          "value": null,
          "description": "Capture initial page state"
        }},
        {{
          "action": "click",
          "selector": "button:has-text(\\"Submit\\")",
          "value": null,
          "description": "Click the Submit button"
        }},
        {{
          "action": "assert_text",
          "selector": null,
          "value": "Expected text on page",
          "description": "Verify expected text is visible"
        }},
        {{
          "action": "screenshot",
          "selector": null,
          "value": null,
          "description": "Capture final state"
        }}
      ]
    }}
  ]
}}

SELECTOR RULES:
- Buttons: button:has-text("Label")
- Links: a:has-text("Label")
- Email input: input[type="email"]
- Password input: input[type="password"]
- Text input with placeholder: input[placeholder="Search..."]
- Radix Select trigger: [role="combobox"]
- Radix Select option: [role="option"]:has-text("Value")
- Radix Checkbox: [role="checkbox"]
- Dialog: [role="dialog"]

VALID ACTIONS: navigate, click, fill, assert_text, screenshot, wait, hover, hover_and_click, press, check, uncheck, select_option, dblclick, type_into, scroll, clear

SEVERITY: Critical=auth/core flows, High=main features, Medium=secondary features, Low=cosmetic

Rules:
- Always start each test with a "navigate" step
- Always include at least one "screenshot" step
- Generate EXACTLY {requested_tests} test cases covering different scenarios
- Each test should be independently executable
- "wait" value is seconds as a string e.g. "2"
- "hover_and_click": selector=element to hover, value=element to click after hover"""

    raw = await _call_openai(prompt, json_mode=True)
    data = json.loads(_clean_json(raw))
    tests: list[dict[str, Any]] = data.get("tests", [])

    for test in tests:
        test.setdefault("id", str(uuid.uuid4()))
        test.setdefault("analysis_id", "workspace")

    return tests


# ─── Repo Baseline: Full-Scan & Incremental Generators ─────────────────────
# These two functions power the new "smart baseline" pipeline:
#   generate_baseline_tests  → first scan of a repo (or forced full rescan)
#   generate_incremental_tests → re-scan only changed files

_BASELINE_SYSTEM_PROMPT = """You are a senior QA engineer who writes production-grade Playwright test cases.

RULES:
1. Read the actual code provided do NOT generate generic Lorem-ipsum tests.
2. Assign category from EXACTLY this list:
   auth, api, ui_form, ui_navigation, ui_component, crud, integration, edge_case, performance, accessibility
3. Choose the MOST PRECISE category:
   - auth → anything involving login, logout, sessions, JWT, protected routes
   - api → fetch calls, REST handlers, HTTP status validations
   - ui_form → <form>, handleSubmit, input validation, error messages
   - ui_navigation → <Link>, router.push, nav menus, breadcrumbs
   - ui_component → isolated components (modals, tables, dropdowns)
   - crud → create/read/update/delete operations on entities
   - integration → multiple services cooperating (e.g. API + DB + UI)
   - edge_case → null checks, empty states, 404, boundary values
   - performance → loading skeletons, debounce, lazy load, timeouts
   - accessibility → aria-*, role, keyboard navigation, focus management
   Do NOT default everything to ui_component.
4. page_path = the actual URL route (e.g. /dashboard/users), not a component name
5. component_name = React/Vue component name (e.g. UserEditModal)
6. endpoint = "METHOD /path" for API tests (e.g. "POST /api/orders")
7. severity: critical = auth/payment, high = core CRUD, medium = flows, low = edge cases
8. playwright_code must be valid, runnable Playwright TypeScript code wrapped in:
   test('...', async ({ page }) => { ... });
9. Return ONLY valid JSON. No markdown fences. No explanation outside the JSON."""

_FULL_SCAN_USER_PROMPT = """Analyse this codebase chunk and generate comprehensive Playwright test cases.

CODEBASE CHUNK:
{code_chunks}

Generate between 5 and 15 test cases covering the functionality found in this chunk.
Aim for good distribution across the categories that actually appear in this chunk.
Every test must be grounded in real code you can see above no hallucinated features.

Return JSON with EXACTLY this structure (no extra keys):
{{
  "tests": [
    {{
      "name": "Human-readable test name",
      "description": "One sentence: what this test verifies",
      "category": "auth",
      "page_path": "/login",
      "component_name": null,
      "endpoint": null,
      "severity": "critical",
      "source_file": "src/pages/Login.tsx",
      "steps": [
        {{"action": "navigate", "target": "/login", "value": null, "assertion": null}},
        {{"action": "fill", "target": "input[type=email]", "value": "test@example.com", "assertion": null}},
        {{"action": "fill", "target": "input[type=password]", "value": "password123", "assertion": null}},
        {{"action": "click", "target": "button[type=submit]", "value": null, "assertion": null}},
        {{"action": "expect", "target": "/dashboard", "value": null, "assertion": "url contains /dashboard"}}
      ],
      "playwright_code": "test('User can log in with valid credentials', async ({{ page }}) => {{\\n  await page.goto('/login');\\n  await page.fill('input[type=email]', 'test@example.com');\\n  await page.fill('input[type=password]', 'password123');\\n  await page.click('button[type=submit]');\\n  await page.waitForURL('**/dashboard');\\n  await expect(page).toHaveURL(/dashboard/);\\n}});"
    }}
  ]
}}"""

_INCREMENTAL_USER_PROMPT = """Analyse ONLY the changed files below and generate NEW Playwright test cases.

CHANGED FILES (what was modified in this commit/push):
{changed_code}

EXISTING TESTS ALREADY IN DATABASE (DO NOT duplicate any of these):
{existing_tests_summary}

TASK:
- Generate test cases ONLY for new/changed logic visible in the files above.
- Do NOT outputs tests already covered by the existing list, even if you rephrase the name.
- If the change is minor (typo fix, whitespace, comment-only), return {{"tests": []}}.
- Focus on: new API endpoints, new routes, new components, changed business logic, new validations.
- Same JSON structure and rules as a full scan apply.

Return {{"tests": []}} if nothing genuinely new was introduced."""


def _validate_ai_test(raw: dict[str, Any], session_id: str) -> "dict[str, Any] | None":
    """
    Validate and normalise a single AI-generated test dict.
    Returns None if the test should be discarded (malformed / empty).
    Never raises a bad test from the AI must not crash the whole run.
    """
    try:
        if not raw.get("name") or not raw.get("description"):
            return None
        steps = raw.get("steps", [])
        if not steps:
            return None

        from app.models.repo_baseline import coerce_category
        category = coerce_category(raw.get("category"))

        severity = (raw.get("severity") or "medium").strip().lower()
        if severity not in {"critical", "high", "medium", "low"}:
            severity = "medium"

        return {
            "test_id": f"TC-{uuid.uuid4().hex[:6].upper()}",
            "name": str(raw["name"])[:200],
            "description": str(raw.get("description", ""))[:500],
            "category": category,
            "page_path": raw.get("page_path") or None,
            "component_name": raw.get("component_name") or None,
            "endpoint": raw.get("endpoint") or None,
            "severity": severity,
            "source_file": raw.get("source_file") or None,
            "steps": steps,
            "playwright_code": str(raw.get("playwright_code", "")),
            "added_in_session": session_id,
            "is_active": True,
        }
    except Exception:
        return None


def _fix_json_response(raw: str) -> str:
    """Attempt to extract a JSON object/array from a response with extra prose."""
    import re as _re
    # Try to find the outermost { ... }
    m = _re.search(r'(\{.*\})', raw, _re.DOTALL)
    if m:
        return m.group(1)
    return raw


async def generate_baseline_tests(
    code_chunks: list[str],
    session_id: str,
    task_name: str = "generate_baseline_tests",
) -> list[dict[str, Any]]:
    """
    Full-repo scan: send extracted source file chunks to the AI concurrently and receive a complete
    set of categorised Playwright tests.

    Returns a list of validated test dicts ready to be stored in MongoDB.
    """
    async def process_chunk(chunk: str) -> list[dict[str, Any]]:
        prompt_text = f"{_BASELINE_SYSTEM_PROMPT}\n\n{_FULL_SCAN_USER_PROMPT.format(code_chunks=chunk)}"
        for attempt in range(3):
            try:
                raw_content, prompt_tokens, completion_tokens = await asyncio.to_thread(
                    _call_openai_sync, prompt_text, True
                )
                asyncio.create_task(_log_cost(task_name, prompt_tokens, completion_tokens))
                cleaned = _clean_json(raw_content)
                parsed = json.loads(cleaned)
                return parsed.get("tests", [])
            except json.JSONDecodeError:
                if attempt == 2:
                    return []
            except Exception:
                if attempt == 2:
                    return []
        return []

    # Run AI evaluation concurrently for all chunks
    tasks = [process_chunk(chunk) for chunk in code_chunks]
    chunk_results = await asyncio.gather(*tasks, return_exceptions=True)

    raw_tests: list[dict[str, Any]] = []
    for res in chunk_results:
        if isinstance(res, list):
            raw_tests.extend(res)

    validated = []
    for raw in raw_tests:
        clean = _validate_ai_test(raw, session_id)
        if clean:
            validated.append(clean)

    return validated


async def generate_incremental_tests(
    changed_code: str,
    existing_tests: list[dict[str, Any]],
    session_id: str,
    task_name: str = "generate_incremental_tests",
) -> list[dict[str, Any]]:
    """
    Incremental scan: send only changed file content + a compact summary of existing
    tests so the AI knows what NOT to generate.

    Returns a list of validated new test dicts.
    """
    # Compact summary: name + category + page_path only (saves tokens)
    summary = [
        {
            "name": t.get("name"),
            "category": t.get("category"),
            "page_path": t.get("page_path"),
            "endpoint": t.get("endpoint"),
        }
        for t in existing_tests
    ]

    prompt_text = (
        f"{_BASELINE_SYSTEM_PROMPT}\n\n"
        + _INCREMENTAL_USER_PROMPT.format(
            changed_code=changed_code,
            existing_tests_summary=json.dumps(summary, indent=2),
        )
    )

    raw_tests: list[dict[str, Any]] = []
    for attempt in range(3):
        try:
            raw_content, prompt_tokens, completion_tokens = await asyncio.to_thread(
                _call_openai_sync, prompt_text, True
            )
            asyncio.create_task(_log_cost(task_name, prompt_tokens, completion_tokens))
            cleaned = _clean_json(raw_content)
            parsed = json.loads(cleaned)
            raw_tests = parsed.get("tests", [])
            break
        except json.JSONDecodeError:
            if attempt == 2:
                raw_tests = []  # graceful empty on repeated failure
                break
            raw_content = _fix_json_response(raw_content)
        except Exception:
            raise

    validated = []
    for raw in raw_tests:
        clean = _validate_ai_test(raw, session_id)
        if clean:
            validated.append(clean)

    return validated


async def analyze_test_failure_root_cause(evidence: dict[str, Any], test_name: str) -> dict[str, Any]:
    """
    Correlate a real test-failure's evidence with real Git history and produce
    a root cause explanation. Returns a dict with confidence=0 and an "error"
    key on any AI failure callers must never treat that as a valid result.
    """
    commits_block = "\n".join(
        f"- {c.get('sha', '')[:12]} {c.get('message', '')} (by {c.get('author', 'unknown')})"
        for c in evidence.get("recent_commits", [])
    ) or "No recent commit history available."

    prompt = f"""You are a senior software engineer investigating a failed automated test.

Test name: {test_name}
Error message: {evidence.get('error_message') or 'Not available'}
Failed step: {(evidence.get('failed_step') or {}).get('step_description', 'Not available')}
Recent commits to this repository:
{commits_block}

Git diff of the most recent commit (may be truncated):
{(evidence.get('git_diff') or 'Not available')[:4000]}

Based ONLY on the information above, determine the most likely root cause. Do not invent
information that isn't present above if the evidence is insufficient, say so explicitly
in root_cause_explanation and lower the confidence score accordingly.

Return ONLY valid JSON (no markdown, no commentary) with this exact shape:
{{
  "root_cause_summary": "one sentence, plain language",
  "root_cause_explanation": "2-4 sentences explaining why, citing the specific commit/file/change if evident",
  "confidence": 0-100 integer,
  "likely_commit_sha": "short sha string or null if not evident",
  "affected_files": ["list", "of", "file", "paths", "or", "empty", "list"],
  "affected_tests": ["test names likely impacted, or just this test if unclear"],
  "affected_services": ["service/module names, or empty list"],
  "recommendation": "one concrete, actionable remediation suggestion"
}}"""

    try:
        raw = await _call_openai(prompt, json_mode=True, task_name="analyze_test_failure_root_cause")
        text = _clean_json(raw)
        try:
            data: dict[str, Any] = json.loads(text)
        except Exception as parse_err:
            return {
                "root_cause_summary": None, "root_cause_explanation": None, "confidence": 0,
                "likely_commit_sha": None, "affected_files": [], "affected_tests": [], "affected_services": [],
                "recommendation": None, "error": f"Invalid JSON from AI: {str(parse_err)[:300]}",
            }
        return {
            "root_cause_summary": data.get("root_cause_summary"),
            "root_cause_explanation": data.get("root_cause_explanation"),
            "confidence": max(0, min(100, int(data.get("confidence", 0) or 0))),
            "likely_commit_sha": data.get("likely_commit_sha") or None,
            "affected_files": data.get("affected_files") or [],
            "affected_tests": data.get("affected_tests") or [test_name],
            "affected_services": data.get("affected_services") or [],
            "recommendation": data.get("recommendation"),
        }
    except AIQuotaError:
        return {
            "root_cause_summary": None, "root_cause_explanation": None, "confidence": 0,
            "likely_commit_sha": None, "affected_files": [], "affected_tests": [], "affected_services": [],
            "recommendation": None, "error": "AI quota exceeded",
        }
    except Exception as exc:
        return {
            "root_cause_summary": None, "root_cause_explanation": None, "confidence": 0,
            "likely_commit_sha": None, "affected_files": [], "affected_tests": [], "affected_services": [],
            "recommendation": None, "error": str(exc)[:300],
        }


async def suggest_selector_repair(
    original_selector: str,
    step_description: str,
    candidates: list[dict],
) -> dict[str, Any]:
    """
    Picks the best-matching REAL candidate (by index) for a broken selector.
    The AI never invents a selector it can only choose an index into the
    candidates list that was actually observed on the live page, or return
    null to signal no safe match. Any index outside the real list's range
    is a hallucination and is rejected here, not trusted.
    """
    if not candidates:
        return {
            "selected_index": None,
            "confidence": 0,
            "reasoning": "No candidate elements were found on the live page.",
        }

    candidates_block = "\n".join(
        f"{i}: <{c.get('tag')}> text={c.get('text')!r} role={c.get('role')!r} selector={c.get('selector')!r}"
        for i, c in enumerate(candidates)
    )
    prompt = f"""A Playwright test step is failing because its selector no longer matches anything on the page.

Original (broken) selector: {original_selector}
Step description: {step_description}

Here are the real interactive elements actually found on the live page right now, indexed from 0:
{candidates_block}

Pick the index of the element most likely to be the intended replacement for the broken selector same
apparent purpose (e.g. same button in a login flow), even if the id/class/text changed. If nothing here
plausibly matches, say so.

Return ONLY valid JSON (no markdown) with this exact shape:
{{
  "selected_index": <integer index from the list above, or null if nothing plausibly matches>,
  "confidence": <0-100 integer>,
  "reasoning": "one or two sentences"
}}"""

    try:
        raw = await _call_openai(prompt, json_mode=True, task_name="suggest_selector_repair")
        text = _clean_json(raw)
        data: dict[str, Any] = json.loads(text)
        idx = data.get("selected_index")
        if idx is not None and (not isinstance(idx, int) or idx < 0 or idx >= len(candidates)):
            return {
                "selected_index": None,
                "confidence": 0,
                "reasoning": "AI returned an index outside the real candidate list; rejected.",
            }
        return {
            "selected_index": idx,
            "confidence": max(0, min(100, int(data.get("confidence", 0) or 0))) if idx is not None else 0,
            "reasoning": data.get("reasoning"),
        }
    except AIQuotaError:
        return {"selected_index": None, "confidence": 0, "reasoning": None, "error": "AI quota exceeded"}
    except Exception as exc:
        return {"selected_index": None, "confidence": 0, "reasoning": None, "error": str(exc)[:300]}
