import asyncio

import pytest

from app.services import analysis_runner


def test_fallback_playwright_tests_from_pages():
    tests = analysis_runner.fallback_playwright_tests(
        {
            "pages": [
                {"name": "Todos", "path": "/", "description": "Todo list"},
                {"name": "About", "path": "/about"},
            ]
        },
        "https://demo.playwright.dev/todomvc",
        num_tests=2,
    )
    assert len(tests) == 2
    assert tests[0]["name"] == "Open Todos"
    assert tests[0]["steps"][0]["action"] == "navigate"
    assert tests[0]["steps"][0]["value"].startswith("https://demo.playwright.dev/todomvc")


@pytest.mark.anyio
async def test_generate_tests_or_fallback_on_timeout(monkeypatch):
    async def hang(*_args, **_kwargs):
        await asyncio.sleep(30)

    monkeypatch.setattr(analysis_runner, "generate_playwright_tests", hang)
    monkeypatch.setattr(analysis_runner, "_GENERATE_TIMEOUT_S", 0.05)

    logs: list[str] = []
    tests, source = await analysis_runner._generate_tests_or_fallback(
        analysis_data={"pages": [{"name": "Home", "path": "/"}]},
        target_url="https://example.com",
        test_email=None,
        test_password=None,
        test_preferences=None,
        num_tests=1,
        log=logs.append,
    )
    assert source == "fallback"
    assert tests
    assert tests[0]["steps"][0]["action"] == "navigate"
    assert any("timed out" in line for line in logs)


@pytest.mark.anyio
async def test_generate_tests_or_fallback_on_invalid_json(monkeypatch):
    async def boom(*_args, **_kwargs):
        raise ValueError("bad json")

    monkeypatch.setattr(analysis_runner, "generate_playwright_tests", boom)

    tests, source = await analysis_runner._generate_tests_or_fallback(
        analysis_data={"pages": [{"name": "Login", "path": "/login"}]},
        target_url="https://example.com",
        test_email=None,
        test_password=None,
        test_preferences=None,
        num_tests=1,
        log=lambda _m: None,
    )
    assert source == "fallback"
    assert tests[0]["page_name"] == "Login"


@pytest.mark.anyio
async def test_analyze_or_fallback_on_invalid_json(monkeypatch):
    async def boom(*_args, **_kwargs):
        raise ValueError("bad json")

    monkeypatch.setattr(analysis_runner, "analyze_codebase", boom)

    logs: list[str] = []
    data, source = await analysis_runner._analyze_or_fallback(
        codebase_content="export default function App() {}",
        target_url="https://example.com",
        log=logs.append,
    )
    assert source == "fallback"
    assert isinstance(data, dict)
    assert data.get("pages")
    assert any("failed" in line.lower() for line in logs)
