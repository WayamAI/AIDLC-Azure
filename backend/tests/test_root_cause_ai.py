import json
import pytest
from unittest.mock import patch, AsyncMock
from app.services import ai_service


@pytest.mark.asyncio
async def test_analyze_test_failure_root_cause_parses_valid_json():
    fake_response = json.dumps({
        "root_cause_summary": "Selector #pay-btn no longer exists after a UI refactor.",
        "root_cause_explanation": "commit a91f2c renamed #pay-btn to #checkout-submit.",
        "confidence": 88,
        "likely_commit_sha": "a91f2c1",
        "affected_files": ["frontend/src/pages/Checkout.tsx"],
        "affected_tests": ["Checkout flow"],
        "affected_services": ["checkout"],
        "recommendation": "Update the selector to #checkout-submit.",
    })
    with patch.object(ai_service, "_call_openai", new=AsyncMock(return_value=fake_response)):
        result = await ai_service.analyze_test_failure_root_cause(
            evidence={"error_message": "Timeout waiting for selector #pay-btn", "recent_commits": []},
            test_name="Checkout flow",
        )
    assert result["confidence"] == 88
    assert "selector" in result["root_cause_summary"].lower()
    assert result["affected_files"] == ["frontend/src/pages/Checkout.tsx"]


@pytest.mark.asyncio
async def test_analyze_test_failure_root_cause_handles_malformed_ai_output():
    with patch.object(ai_service, "_call_openai", new=AsyncMock(return_value="not json at all")):
        result = await ai_service.analyze_test_failure_root_cause(
            evidence={"error_message": "boom"}, test_name="X",
        )
    assert result["confidence"] == 0
    assert result["root_cause_summary"] is None
    assert "error" in result
