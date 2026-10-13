"""JSON recovery for reasoning models that wrap or split structured output."""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.services import ai_service


def _client_returning(message) -> MagicMock:
    response = SimpleNamespace(
        choices=[SimpleNamespace(message=message)],
        usage=SimpleNamespace(prompt_tokens=1, completion_tokens=2),
    )
    client = MagicMock()
    client.chat.completions.create.return_value = response
    return client


def test_clean_json_extracts_object_from_thinking_prose():
    raw = (
        "I'll generate the tests now.\n"
        "```json\n"
        '{"tests": [{"name": "Login"}]}\n'
        "```\n"
        "Hope this helps."
    )
    cleaned = ai_service._clean_json(raw)
    parsed = json.loads(cleaned)
    assert parsed["tests"][0]["name"] == "Login"


def test_clean_json_extracts_object_when_prose_surrounds_json():
    raw = 'Thinking about pages...\n{"summary": "Todo app", "pages": []}\nDone.'
    cleaned = ai_service._clean_json(raw)
    parsed = json.loads(cleaned)
    assert parsed["summary"] == "Todo app"


def test_clean_json_fenced_block_only():
    assert json.loads(ai_service._clean_json('```json\n{"a": 1}\n```')) == {"a": 1}
    assert json.loads(ai_service._clean_json('```\n{"a": 1}\n```')) == {"a": 1}


def test_clean_json_leading_prose():
    raw = 'Here is the result you asked for: {"a": {"b": [1, 2]}}'
    assert json.loads(ai_service._clean_json(raw)) == {"a": {"b": [1, 2]}}


def test_clean_json_trailing_prose_with_braces_is_not_swallowed():
    # A greedy match would run on to the last "}" and fail to parse.
    raw = '{"a": 1}\nNote: I used the {placeholder} style and kept {"b": 2} out.'
    assert json.loads(ai_service._clean_json(raw)) == {"a": 1}


def test_clean_json_picks_first_of_two_objects():
    raw = 'First: {"a": 1} and then a second one: {"b": 2}'
    assert json.loads(ai_service._clean_json(raw)) == {"a": 1}


def test_clean_json_braces_and_quotes_inside_strings():
    raw = 'Sure. {"code": "if (x) { return \\"}\\"; }", "tail": "a]b[c"} Done {really}.'
    parsed = json.loads(ai_service._clean_json(raw))
    assert parsed == {"code": 'if (x) { return "}"; }', "tail": "a]b[c"}


def test_clean_json_array_with_prose():
    raw = 'The rows are:\n[{"id": 1}, {"id": 2}]\nLet me know if you need more.'
    assert json.loads(ai_service._clean_json(raw)) == [{"id": 1}, {"id": 2}]


def test_clean_json_skips_non_json_braces_in_leading_prose():
    raw = 'Using the {name} template, the answer is {"ok": true}.'
    assert json.loads(ai_service._clean_json(raw)) == {"ok": True}


def test_clean_json_returns_input_when_nothing_parses():
    raw = 'no json here {"a": '
    with pytest.raises(json.JSONDecodeError):
        json.loads(ai_service._clean_json(raw))


def test_call_openai_sync_returns_content_and_low_reasoning_effort(monkeypatch):
    client = _client_returning(SimpleNamespace(content='{"ok": true}', reasoning="thinking..."))
    monkeypatch.setattr(ai_service, "_get_client", lambda: client)
    monkeypatch.setattr(ai_service, "_ollama_cfg", lambda: ("https://ollama.com", "k", "kimi-k3:cloud"))

    content, prompt_tokens, completion_tokens = ai_service._call_openai_sync("prompt", json_mode=True)
    assert content == '{"ok": true}'
    assert prompt_tokens == 1
    assert completion_tokens == 2
    kwargs = client.chat.completions.create.call_args.kwargs
    extra = kwargs.get("extra_body") or {}
    assert extra.get("reasoning_effort") == "low" or kwargs.get("reasoning_effort") == "low"


@pytest.mark.parametrize("content", ["", "   ", None])
def test_reasoning_is_never_returned_as_the_answer(monkeypatch, content):
    # The reasoning text happens to be valid JSON; it still must not be used.
    message = SimpleNamespace(
        content=content,
        reasoning='{"ok": true}',
        model_dump=lambda: {"content": content, "reasoning": '{"ok": true}'},
    )
    client = _client_returning(message)
    monkeypatch.setattr(ai_service, "_get_client", lambda: client)
    monkeypatch.setattr(ai_service, "_ollama_cfg", lambda: ("https://ollama.com", "k", "kimi-k3:cloud"))

    with pytest.raises(ai_service.AIResponseError, match="empty answer"):
        ai_service._call_openai_sync("prompt", json_mode=True)
    assert client.chat.completions.create.call_count == 1


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
