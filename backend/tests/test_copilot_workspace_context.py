"""Multi-file copilot must actually read workspace files into the prompt."""
import json

import pytest

from app.services import copilot_service, workspace_service


@pytest.fixture
def workspace(tmp_path):
    (tmp_path / "app.py").write_text("def greet():\n    return 'hello-marker'\n", encoding="utf-8")
    workspace_service._WORKSPACES["ws_copilot"] = {
        "workspace_id": "ws_copilot",
        "org_id": "org_a",
        "clone_dir": str(tmp_path),
    }
    yield "ws_copilot"
    workspace_service._WORKSPACES.pop("ws_copilot", None)


def _fake_ai(captured: dict, files: list[dict]):
    async def _call(prompt, json_mode=False):
        captured["prompt"] = prompt
        return json.dumps({"files": files})

    return _call


async def test_file_contents_reach_the_prompt_and_originals_are_returned(workspace, monkeypatch):
    captured: dict = {}
    monkeypatch.setattr(
        copilot_service,
        "_call_openai",
        _fake_ai(captured, [{"file_path": "app.py", "modified": "new", "is_new": False}]),
    )

    result = await copilot_service.suggest_workspace(
        workspace, "rename greet", [], ["app.py", "missing.py"], org_id="org_a"
    )

    assert "hello-marker" in captured["prompt"]
    assert "=== missing.py ===" not in captured["prompt"]
    assert "hello-marker" in result["files"][0]["original"]


async def test_programming_errors_are_not_swallowed(workspace, monkeypatch):
    def _broken(*args, **kwargs):
        raise TypeError("wrong arguments")

    monkeypatch.setattr(workspace_service, "get_file_content", _broken)
    monkeypatch.setattr(copilot_service, "_call_openai", _fake_ai({}, []))

    with pytest.raises(TypeError):
        await copilot_service.suggest_workspace(workspace, "x", [], ["app.py"], org_id="org_a")
