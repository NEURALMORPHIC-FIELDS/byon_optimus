"""Tests for the Level 3 A/B comparison report generator.

Verifies that:
  * the report generation script runs end-to-end
  * both JSON and markdown artifacts exist on disk
  * both Transcript A and Transcript B are represented
  * canonical seeds (42 / 1337) are recorded
  * `metric_source` is the surrogate label
  * `invariant_ok` is True for both runs
  * Level 3 is NOT declared in the report
  * no Omega is created during audit generation
  * audit module does not import or call `check_coagulation`
  * audit module does not import production code paths
  * the L3 gate matrix contains a mix of PASS / PARTIAL /
    NOT_TESTED_YET statuses (not blanket PASS)
"""

from __future__ import annotations

import ast
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest


_HERE = Path(__file__).resolve().parent
_RESEARCH_ROOT = _HERE.parent
if str(_RESEARCH_ROOT) not in sys.path:
    sys.path.insert(0, str(_RESEARCH_ROOT))

from harness import audit as audit_module  # noqa: E402
from harness.audit import (  # noqa: E402
    L3_GATE_IDS,
    REPORT_VERSION,
    build_audit,
    render_json,
    render_markdown,
    write_reports,
)


REPORTS_DIR = _RESEARCH_ROOT / "reports"
JSON_PATH = REPORTS_DIR / "level3_ab_comparison_report.json"
MD_PATH = REPORTS_DIR / "level3_ab_comparison_report.md"


# ---------------------------------------------------------------------------
# Module-level fixture: build the audit once for the suite.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def audit() -> Dict[str, Any]:
    return build_audit(commit_sha="test-fixture-sha")


@pytest.fixture(scope="module")
def disk_json() -> Dict[str, Any]:
    """The JSON report as currently on disk (built by `python -m
    harness.audit`). If absent, the test that asserts existence will
    flag it; downstream tests that read it should skip rather than
    crash."""
    if not JSON_PATH.exists():
        pytest.skip(f"{JSON_PATH} not yet generated")
    return json.loads(JSON_PATH.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# 1 — report generation runs
# ---------------------------------------------------------------------------


def test_01_report_generation_runs(tmp_path: Path) -> None:
    out_dir = tmp_path / "reports"
    json_path, md_path = write_reports(out_dir, commit_sha="test-sha")
    assert json_path.exists()
    assert md_path.exists()
    assert json_path.stat().st_size > 0
    assert md_path.stat().st_size > 0


# ---------------------------------------------------------------------------
# 2 — JSON report exists on disk
# ---------------------------------------------------------------------------


def test_02_json_report_exists_on_disk() -> None:
    assert JSON_PATH.exists(), (
        f"{JSON_PATH} missing. Run `python -m harness.audit` first."
    )
    assert JSON_PATH.stat().st_size > 0


# ---------------------------------------------------------------------------
# 3 — markdown report exists on disk
# ---------------------------------------------------------------------------


def test_03_markdown_report_exists_on_disk() -> None:
    assert MD_PATH.exists(), (
        f"{MD_PATH} missing. Run `python -m harness.audit` first."
    )
    assert MD_PATH.stat().st_size > 0


# ---------------------------------------------------------------------------
# 4 — A and B both included
# ---------------------------------------------------------------------------


def test_04_a_and_b_both_included(audit: Dict[str, Any]) -> None:
    assert "A" in audit["runs"]
    assert "B" in audit["runs"]
    assert audit["runs"]["A"]["transcript_id"] == "transcript_A_byon_arch_v1_500"
    assert audit["runs"]["B"]["transcript_id"] == "transcript_B_byon_arch_v1_500"
    # Both runs should produce the headline counts.
    for run in (audit["runs"]["A"], audit["runs"]["B"]):
        assert run["n_rows"] == 500
        assert run["n_events"] >= 500
        assert run["n_centers"] > 0


# ---------------------------------------------------------------------------
# 5 — A seed=42, B seed=1337
# ---------------------------------------------------------------------------


def test_05_seeds_are_canonical(audit: Dict[str, Any]) -> None:
    assert audit["runs"]["A"]["seed"] == 42
    assert audit["runs"]["B"]["seed"] == 1337


# ---------------------------------------------------------------------------
# 6 — metric_source is research_surrogate_v1_not_fce_production
# ---------------------------------------------------------------------------


def test_06_metric_source_surrogate_label(audit: Dict[str, Any]) -> None:
    expected = "research_surrogate_v1_not_fce_production"
    assert audit["metric_source"] == expected
    assert audit["runs"]["A"]["metric_source"] == expected
    assert audit["runs"]["B"]["metric_source"] == expected


# ---------------------------------------------------------------------------
# 7 — invariant_ok True for both runs
# ---------------------------------------------------------------------------


def test_07_invariant_ok_both_runs(audit: Dict[str, Any]) -> None:
    assert audit["z_metabolism"]["A"]["invariant_ok"] is True
    assert audit["z_metabolism"]["B"]["invariant_ok"] is True
    assert audit["z_metabolism"]["A"]["conservation_holds"] is True
    assert audit["z_metabolism"]["B"]["conservation_holds"] is True
    assert audit["z_metabolism"]["A"]["audit_flags"] == []
    assert audit["z_metabolism"]["B"]["audit_flags"] == []


# ---------------------------------------------------------------------------
# 8 — Level 3 is NOT declared
# ---------------------------------------------------------------------------


def test_08_level_3_not_declared(audit: Dict[str, Any]) -> None:
    c = audit["conclusion"]
    assert c["level_3_declared"] is False
    assert c["natural_omega_proven"] is False
    assert c["main_remains_level_2_of_4"] is True

    # Cross-check the markdown rendering — the literal phrasing must
    # appear in the report.
    md = render_markdown(audit)
    assert "Level 3 is **NOT declared**" in md
    assert "Natural Omega is **NOT proven**" in md
    assert "Main remains **Level 2 of 4**" in md


# ---------------------------------------------------------------------------
# 9 — no Omega created during audit
# ---------------------------------------------------------------------------


def test_09_no_omega_created(audit: Dict[str, Any]) -> None:
    # The harness telemetry only exposes PotentialOmegaSignal entries,
    # never OmegaRecord. The detector contract enforces advisory_only.
    # Audit cross-checks via the signal_analysis section.
    siga = audit["potential_omega_signals"]["A"]
    sigb = audit["potential_omega_signals"]["B"]
    assert siga["advisory_only_validation_passes"] is True
    assert sigb["advisory_only_validation_passes"] is True
    # The conclusion must restate that natural_omega is NOT proven.
    assert audit["conclusion"]["natural_omega_proven"] is False


# ---------------------------------------------------------------------------
# 10 — no check_coagulation import / call in the audit module
# ---------------------------------------------------------------------------


def test_10_no_check_coagulation_in_audit_module() -> None:
    src_path = Path(audit_module.__file__)
    src = src_path.read_text(encoding="utf-8")
    # AST-level check: no Call to a name `check_coagulation`, no
    # Attribute access ending in `.check_coagulation`, no Import that
    # binds the name.
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            f = node.func
            if isinstance(f, ast.Name) and f.id == "check_coagulation":
                pytest.fail("audit module calls check_coagulation()")
            if isinstance(f, ast.Attribute) and f.attr == "check_coagulation":
                pytest.fail(
                    "audit module calls *.check_coagulation() via attribute"
                )
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                if alias.name == "check_coagulation":
                    pytest.fail("audit module imports check_coagulation")
    # String-level check: even mentioning the name in source is allowed
    # only in comments / docstrings (we use the name in rationale text).
    # We don't assert absence in source — only the AST guarantees there
    # is no executable call.


# ---------------------------------------------------------------------------
# 11 — no production imports in the audit module
# ---------------------------------------------------------------------------


_FORBIDDEN_IMPORT_PREFIXES = (
    # Production code paths.
    "byon_orchestrator.src",
    "byon_orchestrator.scripts",
    "byon_orchestrator.memory_service",
    # FCE-M production (the vendored copy is only allowed inside
    # memory-service).
    "unified_fragmergent_memory",
    "fragmergent_causal_exponentiation_memory",
    # LLM / embeddings imports.
    "anthropic",
    "openai",
    "torch",
    "sentence_transformers",
    "transformers",
)


def test_11_no_production_imports_in_audit_module() -> None:
    src_path = Path(audit_module.__file__)
    src = src_path.read_text(encoding="utf-8")
    tree = ast.parse(src)
    for node in ast.walk(tree):
        names: List[str] = []
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            names = [mod] + [alias.name for alias in node.names]
        for n in names:
            for prefix in _FORBIDDEN_IMPORT_PREFIXES:
                # Match the literal prefix or the dotted form.
                normalized = n.replace("-", "_")
                if normalized == prefix or normalized.startswith(prefix + "."):
                    pytest.fail(
                        f"audit module has forbidden import {n!r} "
                        f"(matched prefix {prefix!r})"
                    )


# ---------------------------------------------------------------------------
# 12 — L3 gates include a mix of PASS / PARTIAL / NOT_TESTED_YET (not all PASS)
# ---------------------------------------------------------------------------


def test_12_l3_gates_not_blanket_pass(audit: Dict[str, Any]) -> None:
    gates = audit["l3_gates"]
    # Every admitted gate id is present.
    for gid in L3_GATE_IDS:
        assert gid in gates, f"missing gate {gid}"
        status = gates[gid]["status"]
        assert status in ("PASS", "PARTIAL", "NOT_TESTED_YET", "FAIL"), (
            f"gate {gid}: invalid status {status!r}"
        )
        assert gates[gid]["rationale"], f"gate {gid}: rationale empty"

    statuses = {gid: gates[gid]["status"] for gid in L3_GATE_IDS}
    distinct_statuses = set(statuses.values())
    assert len(distinct_statuses) >= 2, (
        f"gate matrix is uniformly {distinct_statuses}; expected a mix"
    )
    # Concretely: at least one NOT_TESTED_YET is required, otherwise
    # the audit is overclaiming coverage for gates that depend on
    # OmegaRecord existence.
    assert "NOT_TESTED_YET" in distinct_statuses, (
        "audit must mark at least one gate NOT_TESTED_YET (G7/G8/G9 "
        "depend on Omega / production benchmarks that are out of scope here)"
    )
    # And it must not declare any gate FAIL.
    assert "FAIL" not in distinct_statuses, (
        f"unexpected FAIL in gate matrix: {statuses}"
    )


# ---------------------------------------------------------------------------
# Extra — disk JSON matches the build_audit output shape
# ---------------------------------------------------------------------------


def test_extra_disk_json_has_expected_shape(disk_json: Dict[str, Any]) -> None:
    for key in (
        "report_version",
        "branch",
        "generated_at_commit_sha",
        "metric_source",
        "runs",
        "z_metabolism",
        "summary_behavior",
        "potential_omega_signals",
        "cross_run_overlap",
        "l3_gates",
        "conclusion",
    ):
        assert key in disk_json, f"disk JSON missing top-level key {key!r}"
    assert disk_json["report_version"] == REPORT_VERSION
    # The disk artifact must NOT mark Level 3 declared.
    assert disk_json["conclusion"]["level_3_declared"] is False
    assert disk_json["conclusion"]["natural_omega_proven"] is False


# ---------------------------------------------------------------------------
# Extra — markdown contains every gate ID with a status badge
# ---------------------------------------------------------------------------


def test_extra_markdown_contains_every_gate(audit: Dict[str, Any]) -> None:
    md = render_markdown(audit)
    for gid in L3_GATE_IDS:
        assert gid in md, f"gate id {gid!r} missing from markdown"
    # The L3 gate audit section must be present.
    assert "## F. L3 gate audit" in md
    # The conclusion section must be present.
    assert "## G. Conclusion" in md
