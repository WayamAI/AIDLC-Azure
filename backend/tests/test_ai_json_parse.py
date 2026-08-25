"""JSON recovery for reasoning models that wrap or split structured output."""
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.services import ai_service


def test_clean_json_extracts_object_from_thinking_prose():
    raw = (
        "I'll generate the tests now.\n"
        "```json\n"
        '{"tests": [{"name": "Login"}]}\n'
        "```\n"
        "Hope this helps."
    )
    cleaned = ai_service._clean_json(raw)
    parsed = __import__("json").loads(cleaned)
    assert parsed["tests"][0]["name"] == "Login"


def test_clean_json_extracts_object_when_prose_surrounds_json():
    raw = 'Thinking about pages...\n{"summary": "Todo app", "pages": []}\nDone.'
    cleaned = ai_service._clean_json(raw)
    parsed = __import__("json").loads(cleaned)
    assert parsed["summary"] == "Todo app"


def test_call_openai_sync_uses_reasoning_when_content_empty(monkeypatch):
    message = SimpleNamespace(
        content="",
        reasoning='{"ok": true}',
        model_dump=lambda: {"content": "", "reasoning": '{"ok": true}'},
    )
    response = SimpleNamespace(
        choices=[SimpleNamespace(message=message)],
        usage=SimpleNamespace(prompt_tokens=1, completion_tokens=2),
    )
    client = MagicMock()
    client.chat.completions.create.return_value = response
    monkeypatch.setattr(ai_service, "_get_client", lambda: client)
    monkeypatch.setattr(ai_service, "_ollama_cfg", lambda: ("https://ollama.com", "k", "kimi-k3:cloud"))

    content, prompt_tokens, completion_tokens = ai_service._call_openai_sync("prompt", json_mode=True)
    assert content == '{"ok": true}'
    assert prompt_tokens == 1
    assert completion_tokens == 2
    kwargs = client.chat.completions.create.call_args.kwargs
    extra = kwargs.get("extra_body") or {}
    assert extra.get("reasoning_effort") == "low" or kwargs.get("reasoning_effort") == "low"


@pytest.mark.anyio
async def test_generate_playwright_tests_from_source_retries_invalid_json(monkeypatch):
    valid = '{"tests": [{"name": "Open login", "description": "d", "page_name": "Login", "severity": "High", "steps": []}]}'
    calls = {"n": 0}

    async def fake_call(prompt, json_mode=True, timeout=None, task_name=None):
        calls["n"] += 1
        if calls["n"] == 1:
            return "not json at all"
        return valid

    monkeypatch.setattr(ai_service, "_call_openai", fake_call)
    tests = await ai_service.generate_playwright_tests_from_source(
        "src/Login.tsx",
        "export default function Login() { return null }",
        num_tests=1,
    )
    assert calls["n"] == 2
    assert tests[0]["name"] == "Open login"
