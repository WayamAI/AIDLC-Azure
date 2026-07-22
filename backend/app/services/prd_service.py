"""
PRD Generator service generates a structured Product Requirements Document
from a product name and description using Ollama.
"""
import json
import uuid
from datetime import datetime, timezone

from app.services.ai_service import _call_openai, _clean_json


_PRD_PROMPT = """You are a senior product manager and technical writer with 10+ years of experience writing PRDs for software products.

Given the product name and description below, generate a comprehensive, professional Product Requirements Document.

PRODUCT NAME: {product_name}

PRODUCT DESCRIPTION:
{description}

Return ONLY valid JSON (no markdown fences) with this exact structure:

{{
  "executive_summary": "2-3 sentence overview of the product and its value proposition",
  "problem_statement": "2-3 sentences describing the core problem this product solves",
  "goals": [
    "Goal 1 specific, measurable objective",
    "Goal 2",
    "Goal 3",
    "Goal 4",
    "Goal 5"
  ],
  "target_users": [
    {{"role": "User Role Name", "description": "Who they are and how they use the product"}},
    {{"role": "...", "description": "..."}}
  ],
  "use_cases": [
    {{
      "title": "Use Case Title",
      "actor": "Actor Name",
      "description": "Brief description of the use case",
      "preconditions": "What must be true before this flow starts",
      "steps": [
        "Step 1: ...",
        "Step 2: ...",
        "Step 3: ...",
        "Step 4: ...",
        "Step 5: ..."
      ],
      "postcondition": "What is true after the flow completes successfully"
    }}
  ],
  "user_stories": [
    {{
      "as_a": "user role",
      "i_want": "action or capability",
      "so_that": "benefit or outcome",
      "acceptance_criteria": [
        "Criterion 1",
        "Criterion 2",
        "Criterion 3"
      ],
      "priority": "Must Have"
    }}
  ],
  "functional_requirements": [
    {{"id": "FR-01", "title": "Feature Title", "description": "Detailed description of what the system must do"}},
    {{"id": "FR-02", "title": "...", "description": "..."}}
  ],
  "non_functional_requirements": [
    {{"category": "Performance", "requirement": "Specific measurable NFR"}},
    {{"category": "Security", "requirement": "..."}},
    {{"category": "Scalability", "requirement": "..."}},
    {{"category": "Availability", "requirement": "..."}},
    {{"category": "Usability", "requirement": "..."}},
    {{"category": "Data Privacy", "requirement": "..."}}
  ],
  "out_of_scope": [
    "Item 1 that will NOT be built in v1",
    "Item 2",
    "Item 3",
    "Item 4"
  ],
  "success_metrics": [
    {{"metric": "KPI Name", "target": "Specific measurable target"}},
    {{"metric": "...", "target": "..."}}
  ],
  "assumptions": [
    "Assumption 1",
    "Assumption 2",
    "Assumption 3",
    "Assumption 4"
  ]
}}

Rules:
- Generate 3–4 use_cases, each with 5–7 realistic flow steps
- Generate 5–6 user_stories; priority must be one of: "Must Have", "Should Have", "Nice to Have"
- Generate 8–10 functional_requirements with detailed descriptions
- Generate exactly 6 non_functional_requirements with specific measurable targets
- Generate 4–5 out_of_scope items
- Generate 4–5 success_metrics with measurable targets
- All content must be specific to the product described no generic filler
- Return ONLY valid JSON, no markdown, no explanation
"""


async def generate_prd(product_name: str, description: str) -> dict:
    prompt = _PRD_PROMPT.format(
        product_name=product_name,
        description=description,
    )

    raw = await _call_openai(prompt)
    text = _clean_json(raw)
    data = json.loads(text)

    # Build markdown from structured data
    markdown = _build_markdown(product_name, data)

    return {
        "id": str(uuid.uuid4()),
        "product_name": product_name,
        "version": "1.0",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "executive_summary": data.get("executive_summary", ""),
        "problem_statement": data.get("problem_statement", ""),
        "goals": data.get("goals", []),
        "target_users": data.get("target_users", []),
        "use_cases": data.get("use_cases", []),
        "user_stories": data.get("user_stories", []),
        "functional_requirements": data.get("functional_requirements", []),
        "non_functional_requirements": data.get("non_functional_requirements", []),
        "out_of_scope": data.get("out_of_scope", []),
        "success_metrics": data.get("success_metrics", []),
        "assumptions": data.get("assumptions", []),
        "markdown": markdown,
    }


def _build_markdown(product_name: str, d: dict) -> str:
    now = datetime.now(timezone.utc).strftime("%d %B %Y")
    lines = []

    lines.append(f"# Product Requirements Document {product_name}")
    lines.append(f"**Version:** 1.0  |  **Date:** {now}  |  **Status:** Draft")
    lines.append("")
    lines.append("---")
    lines.append("")

    lines.append("## 1. Executive Summary")
    lines.append("")
    lines.append(d.get("executive_summary", ""))
    lines.append("")

    lines.append("## 2. Problem Statement")
    lines.append("")
    lines.append(d.get("problem_statement", ""))
    lines.append("")

    lines.append("## 3. Goals & Objectives")
    lines.append("")
    for i, g in enumerate(d.get("goals", []), 1):
        lines.append(f"{i}. {g}")
    lines.append("")

    lines.append("## 4. Target Users")
    lines.append("")
    for u in d.get("target_users", []):
        lines.append(f"### {u.get('role', '')}")
        lines.append(u.get("description", ""))
        lines.append("")

    lines.append("## 5. Use Cases")
    lines.append("")
    for i, uc in enumerate(d.get("use_cases", []), 1):
        lines.append(f"### UC-{i:02d} {uc.get('title', '')}")
        lines.append("")
        lines.append(f"| Field | Detail |")
        lines.append(f"|---|---|")
        lines.append(f"| **Actor** | {uc.get('actor', '')} |")
        lines.append(f"| **Description** | {uc.get('description', '')} |")
        lines.append(f"| **Preconditions** | {uc.get('preconditions', '')} |")
        lines.append(f"| **Postcondition** | {uc.get('postcondition', '')} |")
        lines.append("")
        lines.append("**Main Flow:**")
        lines.append("")
        for j, step in enumerate(uc.get("steps", []), 1):
            lines.append(f"{j}. {step}")
        lines.append("")

    lines.append("## 6. User Stories")
    lines.append("")
    for i, s in enumerate(d.get("user_stories", []), 1):
        lines.append(f"### US-{i:02d} · {s.get('priority', 'Must Have')}")
        lines.append("")
        lines.append(f"> As a **{s.get('as_a', '')}**, I want to **{s.get('i_want', '')}**, so that **{s.get('so_that', '')}**.")
        lines.append("")
        lines.append("**Acceptance Criteria:**")
        lines.append("")
        for ac in s.get("acceptance_criteria", []):
            lines.append(f"- [ ] {ac}")
        lines.append("")

    lines.append("## 7. Functional Requirements")
    lines.append("")
    lines.append("| ID | Title | Description |")
    lines.append("|---|---|---|")
    for fr in d.get("functional_requirements", []):
        lines.append(f"| **{fr.get('id', '')}** | {fr.get('title', '')} | {fr.get('description', '')} |")
    lines.append("")

    lines.append("## 8. Non-Functional Requirements")
    lines.append("")
    lines.append("| Category | Requirement |")
    lines.append("|---|---|")
    for nfr in d.get("non_functional_requirements", []):
        lines.append(f"| **{nfr.get('category', '')}** | {nfr.get('requirement', '')} |")
    lines.append("")

    lines.append("## 9. Out of Scope")
    lines.append("")
    for item in d.get("out_of_scope", []):
        lines.append(f"- {item}")
    lines.append("")

    lines.append("## 10. Success Metrics / KPIs")
    lines.append("")
    lines.append("| Metric | Target |")
    lines.append("|---|---|")
    for m in d.get("success_metrics", []):
        lines.append(f"| {m.get('metric', '')} | {m.get('target', '')} |")
    lines.append("")

    lines.append("## 11. Assumptions")
    lines.append("")
    for a in d.get("assumptions", []):
        lines.append(f"- {a}")
    lines.append("")

    lines.append("---")
    lines.append(f"*Generated by SDLC PRD Generator on {now}*")

    return "\n".join(lines)
