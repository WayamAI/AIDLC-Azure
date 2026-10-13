import pytest
from app.services import test_selection_service as svc
from app.models.repo_baseline import BaselineTest, BaselineTestStep


def _test(test_id, source_file, category="api", severity="medium"):
    return BaselineTest(
        test_id=test_id, name=f"Test {test_id}", description="d",
        category=category, source_file=source_file, severity=severity,
        steps=[BaselineTestStep(action="navigate", target="/x")],
    )


def test_score_test_direct_file_match_scores_high():
    t = _test("TC-1", "backend/app/services/payment_service.py")
    changed = {"backend/app/services/payment_service.py"}
    score, reasons, has_relevance = svc.score_test(t, changed, risk_scores={})
    assert score >= 40
    assert has_relevance is True
    assert any(r.matched and "changed" in r.label.lower() for r in reasons)


def test_score_test_no_match_scores_low():
    # Different directory too, so this genuinely has no relevance signal
    # (same-directory would count as a proximity match, which IS a relevance signal).
    t = _test("TC-2", "backend/app/models/unrelated.py")
    changed = {"backend/app/services/payment_service.py"}
    score, reasons, has_relevance = svc.score_test(t, changed, risk_scores={})
    assert score < 40
    assert has_relevance is False
    assert any(not r.matched for r in reasons)


def test_score_test_no_source_file_scores_zero_with_honest_reason():
    t = _test("TC-3", None)
    score, reasons, has_relevance = svc.score_test(t, {"a.py"}, risk_scores={})
    assert score == 0
    assert has_relevance is False
    assert any("no source file" in r.label.lower() for r in reasons)


def test_score_test_defect_risk_adds_points():
    t = _test("TC-4", "backend/app/services/x.py")
    changed = set()
    score_no_risk, _, _ = svc.score_test(t, changed, risk_scores={})
    score_with_risk, reasons, has_relevance = svc.score_test(
        t, changed, risk_scores={"backend/app/services/x.py": 80}
    )
    assert score_with_risk > score_no_risk
    assert any(r.matched and "risk" in r.label.lower() for r in reasons)
    # Risk/severity alone must not create a relevance signal.
    assert has_relevance is False


def test_score_test_risk_and_severity_alone_do_not_confer_relevance():
    """A test with only risk/severity signal (no file relevance) must not be
    selectable is_selected in run_selection() is driven by
    has_relevance_signal, not by score > 0."""
    t = _test("TC-9", "backend/app/models/unrelated.py", severity="critical")
    changed = {"backend/app/services/payment_service.py"}
    score, reasons, has_relevance = svc.score_test(
        t, changed, risk_scores={"backend/app/models/unrelated.py": 100}
    )
    assert score > 0  # critical severity + risk still contribute to score
    assert has_relevance is False  # but no file/proximity match => not selected


def test_score_test_critical_severity_adds_points():
    t_medium = _test("TC-5", "a.py", severity="medium")
    t_critical = _test("TC-6", "a.py", severity="critical")
    changed = set()
    score_medium, _, _ = svc.score_test(t_medium, changed, risk_scores={})
    score_critical, _, _ = svc.score_test(t_critical, changed, risk_scores={})
    assert score_critical > score_medium


def test_baseline_test_to_playwright_dict_maps_expect_to_assert_text():
    t = BaselineTest(
        test_id="TC-7", name="n", description="d", category="api",
        steps=[
            BaselineTestStep(action="navigate", target="/login"),
            BaselineTestStep(action="expect", target="h1", assertion="Welcome"),
        ],
    )
    d = svc.baseline_test_to_playwright_dict(t)
    assert d["_id"] == "TC-7"
    assert d["steps"][0]["action"] == "navigate"
    # navigate steps must carry the destination URL/path in `value`, since
    # playwright_service._run_step's navigate branch reads from `value`, not
    # `selector`.
    assert d["steps"][0]["value"] == "/login"
    assert not d["steps"][0]["selector"]
    assert d["steps"][1]["action"] == "assert_text"
    assert d["steps"][1]["selector"] == "h1"
    assert d["steps"][1]["value"] == "Welcome"


def test_baseline_test_to_playwright_dict_wait_step_gets_numeric_value_only():
    """A `wait` step must only ever pull from `value`, never fall back to
    `assertion` _run_step calls float(value) for wait, which would throw
    on non-numeric text."""
    t = BaselineTest(
        test_id="TC-8", name="n", description="d", category="api",
        steps=[
            BaselineTestStep(action="wait", target="", value="2", assertion="should be loaded by now"),
        ],
    )
    d = svc.baseline_test_to_playwright_dict(t)
    assert d["steps"][0]["value"] == "2"
    float(d["steps"][0]["value"])  # must not raise
