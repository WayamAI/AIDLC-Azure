"""A file with nothing to measure has no coverage figure (not 0%)."""
from app.services import coverage_service


def _ws(monkeypatch, tmp_path):
    monkeypatch.setattr(coverage_service, "require_workspace", lambda org_id, workspace_id: {"clone_dir": str(tmp_path)})


def test_python_file_without_functions_has_no_percentage(monkeypatch, tmp_path):
    _ws(monkeypatch, tmp_path)
    result = coverage_service.analyze_coverage("ws", "settings.py", "TIMEOUT = 30\n", org_id="org")
    assert result["total_functions"] == 0 and result["coverage_pct"] is None


def test_unparseable_python_has_no_percentage(monkeypatch, tmp_path):
    _ws(monkeypatch, tmp_path)
    result = coverage_service.analyze_coverage("ws", "broken.py", "def (:\n", org_id="org")
    assert result["coverage_pct"] is None


def test_unsupported_file_type_has_no_percentage(monkeypatch, tmp_path):
    _ws(monkeypatch, tmp_path)
    assert coverage_service.analyze_coverage("ws", "readme.md", "# hi", org_id="org")["coverage_pct"] is None


def test_untested_function_is_zero_percent_not_none(monkeypatch, tmp_path):
    _ws(monkeypatch, tmp_path)
    result = coverage_service.analyze_coverage("ws", "calc.py", "def add(a, b):\n    return a + b\n", org_id="org")
    assert result["total_functions"] == 1 and result["coverage_pct"] == 0.0
