"""Rules that keep test execution honest: no plan, no proof, no pass."""
import pytest

from app.services import execution_service
from app.services.execution_service import (
    InvalidTargetError, PASSWORD_TOKEN, USERNAME_TOKEN,
    _check_plan, _with_credentials, validate_target_url,
)
from app.services.prioritization_service import score_case

_ASSERT = {"action": "assert_text", "value": "Welcome", "description": "sees welcome"}
_NAV = {"action": "navigate", "value": "/login", "description": "open login"}


def test_missing_plan_is_skipped_not_run():
    steps, reason = _check_plan(None)
    assert steps == [] and "no plan" in reason


def test_not_automatable_plan_keeps_the_models_reason():
    steps, reason = _check_plan({"automatable": False, "reason": "Needs an email inbox", "steps": []})
    assert steps == [] and reason == "Needs an email inbox"


def test_plan_without_an_assertion_cannot_pass():
    steps, reason = _check_plan({"automatable": True, "steps": [_NAV, {"action": "click", "selector": "button"}]})
    assert steps == [] and "no assertion" in reason


def test_plan_with_unsupported_action_is_skipped():
    steps, reason = _check_plan({"automatable": True, "steps": [_NAV, {"action": "eval_js"}, _ASSERT]})
    assert steps == [] and "eval_js" in reason


def test_valid_plan_is_returned_for_execution():
    steps, reason = _check_plan({"automatable": True, "steps": [_NAV, _ASSERT]})
    assert reason is None and steps == [_NAV, _ASSERT]


def test_credentials_are_substituted_only_at_run_time():
    planned = [{"action": "fill", "selector": "#e", "value": USERNAME_TOKEN}, {"action": "fill", "selector": "#p", "value": PASSWORD_TOKEN}]
    live = _with_credentials(planned, "qa@example.com", "s3cret")
    assert [s["value"] for s in live] == ["qa@example.com", "s3cret"]
    assert planned[1]["value"] == PASSWORD_TOKEN  # the stored plan never holds the secret


@pytest.mark.parametrize("url", ["", "ftp://x", "localhost:3000", "javascript:alert(1)"])
def test_target_url_must_be_http(url):
    with pytest.raises(InvalidTargetError):
        validate_target_url(url)


def test_production_refuses_private_targets(monkeypatch):
    monkeypatch.setattr(execution_service.settings, "APP_ENV", "production")
    with pytest.raises(InvalidTargetError):
        validate_target_url("http://127.0.0.1:8001")
    with pytest.raises(InvalidTargetError):
        validate_target_url("http://169.254.169.254/latest/meta-data")


def test_development_allows_localhost(monkeypatch):
    monkeypatch.setattr(execution_service.settings, "APP_ENV", "development")
    assert validate_target_url("http://localhost:8081/") == "http://localhost:8081"


# ── risk score ───────────────────────────────────────────────────────────────

def test_critical_case_failing_every_run_scores_100_and_is_a_known_failure():
    priority, status, known, reason = score_case("Critical", ["FAIL", "FAIL", "FAIL"])
    assert (priority, status, known) == (100, "failed", True)
    assert reason == "Failed 3 of last 3 runs; failing now"


def test_recovered_case_scores_lower_than_one_failing_now():
    recovered, status, known, _ = score_case("High", ["PASS", "FAIL"])
    failing, *_ = score_case("High", ["FAIL", "PASS"])
    assert status == "warning" and known is False
    assert recovered < failing


def test_always_passing_case_scores_zero():
    assert score_case("Critical", ["PASS", "PASS"])[:2] == (0, "stable")


def test_skips_do_not_count_as_passes():
    priority, status, known, reason = score_case("Critical", ["SKIP", "SKIP"])
    assert priority == 30 and status == "warning" and known is False
    assert "Never verified" in reason


def test_severity_scales_the_score():
    assert score_case("Low", ["FAIL"])[0] < score_case("Critical", ["FAIL"])[0]


# ── platform safety ──────────────────────────────────────────────────────────

def test_production_refuses_a_placeholder_session_secret():
    from pydantic import ValidationError
    from app.config import Settings

    for weak in ("", "change-me-in-production", "replace-with-long-random-string", "generate-a-long-random-string", "short"):
        with pytest.raises(ValidationError):
            Settings(APP_ENV="production", SESSION_SECRET=weak)
    Settings(APP_ENV="production", SESSION_SECRET="k3Jf9vQ2xT7mZ1pL8sR4wY6uB0nH5cD_aE-gV")


def test_non_platform_org_cannot_borrow_env_credentials(monkeypatch):
    from app.services import connector_settings_service as connectors

    monkeypatch.setattr(connectors.settings, "APP_ENV", "production")
    monkeypatch.setattr(connectors.settings, "PLATFORM_ORG_IDS", ["owner-org"])
    monkeypatch.setattr(connectors.settings, "GITHUB_TOKEN", "ghp_operator")
    monkeypatch.setattr(connectors.settings, "OLLAMA_API_KEY", "operator-ai-key")

    class Org:
        def __init__(self, id): self.id, self.workos_org_id = id, f"w_{id}"

    stranger = {connectors._PLATFORM_KEY: connectors.is_platform_org(Org("someone-else"))}
    owner = {connectors._PLATFORM_KEY: connectors.is_platform_org(Org("owner-org"))}

    assert connectors.resolve(stranger, "github")["token"] == ""
    assert connectors.resolve(owner, "github")["token"] == "ghp_operator"
    # The org's own saved token still works, and the AI key is shared with everyone.
    assert connectors.resolve({**stranger, "github": {"token": "ghp_own"}}, "github")["token"] == "ghp_own"
    assert connectors.resolve(stranger, "ollama")["api_key"] == "operator-ai-key"


def test_production_signup_is_closed_unless_the_domain_is_allowed(monkeypatch):
    from app.routes import auth

    monkeypatch.setattr(auth.settings, "APP_ENV", "production")
    monkeypatch.setattr(auth.settings, "ALLOW_OPEN_SIGNUP", False)
    monkeypatch.setattr(auth.settings, "SIGNUP_ALLOWED_DOMAINS", ["wayam.ai"])
    assert auth._signup_allowed("new@wayam.ai") is True
    assert auth._signup_allowed("stranger@example.com") is False


# ── choosing which pages to scan ─────────────────────────────────────────────

def test_scan_prefers_pages_named_like_the_test_cases():
    from types import SimpleNamespace
    from app.services.execution_service import _keywords, _relevance

    cases = [SimpleNamespace(name="Run button disabled until valid URL entered",
                             description="On the Test Execution page the Run tests button stays disabled")]
    keywords = _keywords(cases)
    assert "execution" in keywords and "page" not in keywords  # generic words are ignored

    relevant = {"href": "http://app/test-execution", "text": "Test Execution"}
    unrelated = {"href": "http://app/code-review", "text": "Code Reviewer"}
    assert _relevance(relevant, keywords) > _relevance(unrelated, keywords)
