"""One analysis must not burn an unauthenticated GitHub rate-limit quota."""
from unittest.mock import patch

from app.services import github_service


def test_budget_is_small_without_a_token():
    with patch.object(github_service.settings, "GITHUB_TOKEN", ""), patch(
        "app.services.connector_settings_service.active", return_value={}
    ):
        assert github_service.is_authenticated() is False
        # Unauthenticated GitHub allows 60 requests/hour; a single run must
        # leave room for the rest of the app.
        assert github_service.commit_detail_budget() < 60 / 2


def test_budget_is_full_with_a_token():
    with patch.object(github_service.settings, "GITHUB_TOKEN", "ghp_x"), patch(
        "app.services.connector_settings_service.active", return_value={}
    ):
        assert github_service.is_authenticated() is True
        assert github_service.commit_detail_budget() == 50
