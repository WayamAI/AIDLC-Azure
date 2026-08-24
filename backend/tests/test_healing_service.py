import pytest

from app.services import healing_service as svc


def test_build_healing_diff_shows_before_after():
    diff = svc.build_healing_diff("#login-btn", "#sign-in-btn")
    assert "- " in diff and "#login-btn" in diff
    assert "+ " in diff and "#sign-in-btn" in diff


@pytest.mark.asyncio
async def test_scan_page_elements_unreachable_url_returns_empty_list():
    result = await svc.scan_page_elements("http://127.0.0.1:1", "/")
    assert result == []


@pytest.mark.asyncio
async def test_validate_candidate_unreachable_url_reports_honest_failure():
    result = await svc.validate_candidate("http://127.0.0.1:1", "/", "#sign-in-btn")
    assert result.attempted is True
    assert result.selector_found_on_page is False
    assert result.error is not None
