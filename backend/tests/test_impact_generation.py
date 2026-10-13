"""Impact/doc test generation: AI failures raise instead of returning invented output."""
import json
import re
from unittest.mock import AsyncMock, patch

import pytest

from app.models.impact_models import DocScenario
from app.services import impact_service
from app.services.impact_service import AIGenerationError


def _scenario(n: int) -> DocScenario:
    return DocScenario(id=f"s{n}", title=f"Scenario {n}", description=f"desc {n}", acceptance_criteria=[f"c{n}"])


def _test_for(number: int, name: str) -> dict:
    return {
        "scenario": number,
        "name": name,
        "description": "d",
        "page_name": "Page",
        "severity": "High",
        "steps": [
            {"action": "navigate", "selector": None, "value": "/x", "description": "go"},
            {"action": "assert_text", "selector": None, "value": name, "description": "check"},
        ],
    }


async def test_code_test_generation_raises_when_ai_returns_no_json():
    with patch.object(impact_service, "call_ai", new=AsyncMock(return_value="Sorry, I cannot help.")):
        with pytest.raises(AIGenerationError):
            await impact_service.generate_tests_from_code("src/a.ts", "export const a = 1", "typescript")


async def test_code_test_generation_propagates_ai_errors():
    with patch.object(impact_service, "call_ai", new=AsyncMock(side_effect=RuntimeError("model down"))):
        with pytest.raises(RuntimeError, match="model down"):
            await impact_service.generate_tests_from_code("src/a.ts", "export const a = 1", "typescript")


async def test_document_parsing_raises_instead_of_inventing_a_scenario():
    with patch.object(impact_service, "call_ai", new=AsyncMock(return_value="no scenarios here")):
        with pytest.raises(AIGenerationError):
            await impact_service.parse_document_to_scenarios("some doc", "spec.md")


async def test_document_parsing_sends_more_than_the_first_3000_characters():
    marker = "UNIQUE-REQUIREMENT-NEAR-THE-END"
    content = "x" * 20_000 + marker
    ai = AsyncMock(return_value=json.dumps([{"title": "T", "description": "d", "acceptance_criteria": ["a"]}]))
    with patch.object(impact_service, "call_ai", new=ai):
        scenarios = await impact_service.parse_document_to_scenarios(content, "spec.md")

    assert marker in ai.await_args.args[0]
    assert [s.title for s in scenarios] == ["T"]


async def test_all_scenarios_get_a_generated_test_across_batches():
    scenarios = [_scenario(n) for n in range(1, 9)]  # 8 scenarios -> batches of 6 and 2
    prompts: list[str] = []

    async def fake_ai(prompt: str, **_kwargs) -> str:
        prompts.append(prompt)
        listed = re.findall(r"^(\d+)\. (Scenario \d+):", prompt, flags=re.MULTILINE)
        return json.dumps([_test_for(int(number), f"test for {title}") for number, title in listed])

    with patch.object(impact_service, "call_ai", new=fake_ai):
        tests = await impact_service.generate_tests_from_scenarios(scenarios)

    assert len(prompts) == 2
    assert [t.name for t in tests] == [f"test for Scenario {n}" for n in range(1, 9)]
    # No scenario fell back to a made-up route derived from its title.
    assert all(step.value != "/scenario-7" for t in tests for step in t.steps)


async def test_scenario_without_usable_test_raises_instead_of_fabricating():
    scenarios = [_scenario(1), _scenario(2)]

    async def fake_ai(prompt: str, **_kwargs) -> str:
        # Only ever answers for a scenario titled "Scenario 1".
        listed = re.findall(r"^(\d+)\. (Scenario \d+):", prompt, flags=re.MULTILINE)
        return json.dumps([_test_for(int(n), "ok") for n, title in listed if title == "Scenario 1"])

    with patch.object(impact_service, "call_ai", new=fake_ai):
        with pytest.raises(AIGenerationError, match="Scenario 2"):
            await impact_service.generate_tests_from_scenarios(scenarios)
