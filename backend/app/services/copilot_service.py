"""
Copilot service AI-powered code generation, comments, and explanation.
Uses the existing Ollama client via ai_service helpers.
"""
import asyncio
import difflib
import json

from app.services.ai_service import _call_openai, _clean_json, AIQuotaError

# ── Prompt templates ────────────────────────────────────────────────────────

_SUGGEST_SYSTEM = """You are an expert software engineer.
You will be given a file's current content and an instruction. You MUST return a JSON object with:
- "modified": the COMPLETE modified file content (never partial always return the full file)
- "diff_summary": 1-2 sentence plain English summary of changes made
- "commit_message": conventional commit format message (feat/fix/refactor/docs: description)
- "explanation": detailed explanation of every change made and why
- "snippets": array of { "name": string, "code": string, "language": string, "tags": [string] } for any reusable utility patterns detected (can be empty)
- "confidence": float 0.0-1.0

Rules:
- Preserve all imports and existing logic unless explicitly told to change them
- Never remove comments unless replacing them with better ones
- Match the existing code style exactly
- Return ONLY valid JSON, no markdown fences"""

_COMMENTS_SYSTEM = """You are an expert software engineer specializing in code documentation.
You will be given a file's content. Add comprehensive docstrings and inline comments where missing.
Return a JSON object with:
- "modified": the COMPLETE file content with comments/docstrings added
- "diff_summary": 1-2 sentence summary of documentation added
- "commit_message": "docs: add docstrings and inline comments to {filename}"
- "explanation": what was documented and why it helps readers

For Python: use Google-style docstrings.
For TypeScript/JavaScript: use JSDoc blocks.
Preserve ALL existing code only add documentation, never remove or change logic.
Return ONLY valid JSON, no markdown fences."""

_EXPLAIN_SYSTEM = """You are an expert software engineer and teacher.
Explain the given code clearly and concisely.
Return a JSON object with:
- "explanation": clear plain-English explanation (3-6 sentences)
- "key_points": array of 3-5 bullet-point strings highlighting the most important aspects

Return ONLY valid JSON, no markdown fences."""


def _build_history_context(history: list[dict]) -> str:
    if not history:
        return ""
    lines = ["Previous conversation context:"]
    for msg in history[-5:]:  # last 5 messages max
        role = msg.get("role", "user")
        content = msg.get("content", "")[:500]  # truncate long messages
        lines.append(f"[{role}]: {content}")
    return "\n".join(lines) + "\n\n"


def _truncate_content(content: str, max_chars: int = 16000) -> str:
    """Truncate content to avoid token limits, keeping start and end.
    
    Reduced from 32000 to 16000 to save tokens and costs.
    """
    if len(content) <= max_chars:
        return content
    half = max_chars // 2
    return content[:half] + "\n\n... [truncated for length] ...\n\n" + content[-half:]


async def suggest_code(
    file_path: str,
    content: str,
    instruction: str,
    history: list[dict],
    language: str = "",
) -> dict:
    """Generate a code suggestion and return original/modified/diff."""
    history_ctx = _build_history_context(history)
    truncated = _truncate_content(content)

    prompt = f"""{_SUGGEST_SYSTEM}

{history_ctx}File: {file_path}
Language: {language or "auto-detect"}

CURRENT FILE CONTENT:
{truncated}

INSTRUCTION: {instruction}"""

    raw = await _call_openai(prompt, json_mode=True)
    data = json.loads(_clean_json(raw))

    modified = data.get("modified", content)
    snippets = data.get("snippets", [])

    return {
        "original": content,
        "modified": modified,
        "diff_summary": data.get("diff_summary", "Changes applied"),
        "explanation": data.get("explanation", ""),
        "commit_message": data.get("commit_message", "feat: apply AI suggestion"),
        "snippets": snippets if isinstance(snippets, list) else [],
        "confidence": float(data.get("confidence", 0.8)),
    }


async def add_comments(
    file_path: str,
    content: str,
    language: str = "",
    style: str = "google",
) -> dict:
    """Add docstrings and inline comments to a file."""
    truncated = _truncate_content(content)
    filename = file_path.split("/")[-1]

    prompt = f"""{_COMMENTS_SYSTEM}

File: {file_path} ({filename})
Language: {language or "auto-detect"}
Documentation style: {style}

CURRENT FILE CONTENT:
{truncated}"""

    raw = await _call_openai(prompt, json_mode=True)
    data = json.loads(_clean_json(raw))

    modified = data.get("modified", content)
    return {
        "original": content,
        "modified": modified,
        "diff_summary": data.get("diff_summary", "Documentation added"),
        "explanation": data.get("explanation", ""),
        "commit_message": data.get("commit_message", f"docs: add docstrings to {filename}"),
        "snippets": [],
        "confidence": 0.95,
    }


_WORKSPACE_SUGGEST_SYSTEM = """You are an expert software engineer working on a codebase.
You will be given the repository file tree, contents of key files, and an instruction.
You MUST return a JSON object with:
- "files": array of file changes, each with:
  - "file_path": relative path from repo root (e.g. "src/pages/Dashboard.tsx")
  - "modified": COMPLETE new file content (never partial always the full file)
  - "summary": 1-2 sentence summary of changes to this specific file
  - "is_new": boolean, true only if this is a brand-new file being created
- "overall_summary": 1-2 sentence summary of all changes combined
- "commit_message": conventional commit format (feat/fix/refactor/docs: description)
- "explanation": detailed explanation of all changes and why

Rules:
- Only include files that actually need to change
- For new files, provide complete file content including all imports
- For existing files, return the FULL modified content (not just changed parts)
- Match existing code style, indentation, and imports exactly
- Return ONLY valid JSON, no markdown fences"""


async def suggest_workspace(
    workspace_id: str,
    instruction: str,
    history: list[dict],
    context_files: list[str] = [],
    *,
    org_id: str,
) -> dict:
    """Generate multi-file changes based on a workspace-wide instruction."""
    from app.services.workspace_service import require_workspace, _walk_tree, get_file_content
    from pathlib import Path

    ws = require_workspace(org_id, workspace_id)
    clone_dir = ws["clone_dir"]
    base = Path(clone_dir)

    tree = _walk_tree(base)

    def flatten_tree(nodes: list) -> list[str]:
        paths: list[str] = []
        for node in nodes:
            if node["type"] == "file":
                paths.append(node["path"])
            elif node.get("children"):
                paths.extend(flatten_tree(node["children"]))
        return paths

    all_paths = flatten_tree(tree)
    files_to_read = context_files if context_files else all_paths[:40]

    file_contexts: list[str] = []
    total_chars = 0
    MAX_TOTAL = 30_000  # Reduced from 60k to 30k to save tokens

    for path in files_to_read:
        if total_chars >= MAX_TOTAL:
            break
        try:
            fc = get_file_content(workspace_id, path)
            content = fc["content"]
            chunk = content[: MAX_TOTAL - total_chars]
            file_contexts.append(f"=== {path} ===\n{chunk}")
            total_chars += len(chunk)
        except Exception:
            pass

    history_ctx = _build_history_context(history)
    tree_summary = "\n".join(all_paths[:150])

    prompt = f"""{_WORKSPACE_SUGGEST_SYSTEM}

{history_ctx}REPOSITORY FILE TREE:
{tree_summary}

FILE CONTENTS:
{chr(10).join(file_contexts)}

INSTRUCTION: {instruction}"""

    raw = await _call_openai(prompt, json_mode=True)
    data = json.loads(_clean_json(raw))

    files = []
    for f in data.get("files", []):
        file_path = f.get("file_path", "").lstrip("/")
        is_new = bool(f.get("is_new", False))
        original = ""
        if not is_new:
            try:
                fc = get_file_content(workspace_id, file_path)
                original = fc["content"]
            except Exception:
                pass
        files.append({
            "file_path": file_path,
            "original": original,
            "modified": f.get("modified", ""),
            "summary": f.get("summary", ""),
            "is_new": is_new,
        })

    return {
        "files": files,
        "overall_summary": data.get("overall_summary", "Workspace changes applied"),
        "commit_message": data.get("commit_message", "feat: apply AI workspace changes"),
        "explanation": data.get("explanation", ""),
    }


async def explain_code(
    file_path: str,
    content: str,
    selection: str = "",
    question: str = "",
) -> dict:
    """Explain code in plain English."""
    code_to_explain = selection if selection else _truncate_content(content, 16000)
    context = f"Question: {question}\n\n" if question else ""

    prompt = f"""{_EXPLAIN_SYSTEM}

{context}File: {file_path}

CODE TO EXPLAIN:
{code_to_explain}"""

    raw = await _call_openai(prompt, json_mode=True)
    data = json.loads(_clean_json(raw))

    return {
        "explanation": data.get("explanation", ""),
        "key_points": data.get("key_points", []),
    }
