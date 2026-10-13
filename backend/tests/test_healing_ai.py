import json
from unittest.mock import AsyncMock, patch

import pytest

from app.services import ai_service


@pytest.mark.asyncio
async def test_suggest_selector_repair_returns_valid_index():
    candidates = [
        {"selector": "#sign-in-btn", "tag": "button", "text": "Sign In", "role": None},
        {"selector": "#cancel-btn", "tag": "button", "text": "Cancel", "role": None},
    ]
    fake = json.dumps(
        {"selected_index": 0, "confidence": 95, "reasoning": "Same login-flow button, renamed"}
    )
    with patch.object(ai_service, "_call_openai", new=AsyncMock(return_value=fake)):
        result = await ai_service.suggest_selector_repair(
            "#login-btn", "click the login button", candidates
        )
    assert result["selected_index"] == 0
    assert result["confidence"] == 95


@pytest.mark.asyncio
async def test_suggest_selector_repair_out_of_range_index_is_rejected():
    candidates = [{"selector": "#a", "tag": "button", "text": "A", "role": None}]
    fake = json.dumps({"selected_index": 5, "confidence": 90, "reasoning": "x"})
    with patch.object(ai_service, "_call_openai", new=AsyncMock(return_value=fake)):
        result = await ai_service.suggest_selector_repair("#login-btn", "click", candidates)
    assert result["selected_index"] is None
    assert result["confidence"] == 0


@pytest.mark.asyncio
async def test_suggest_selector_repair_handles_malformed_ai_output():
    with patch.object(ai_service, "_call_openai", new=AsyncMock(return_value="not json")):
        result = await ai_service.suggest_selector_repair(
            "#login-btn",
            "click",
            [{"selector": "#a", "tag": "button", "text": "A", "role": None}],
        )
    assert result["selected_index"] is None
    assert result["confidence"] == 0
    assert "error" in result
