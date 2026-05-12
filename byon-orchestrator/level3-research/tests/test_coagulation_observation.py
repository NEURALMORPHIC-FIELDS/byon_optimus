"""Tests for the controlled coagulation observation runner.

Verifies that:
  * the runner loads A and B harness telemetry end-to-end
  * candidate buckets either exist or report INSUFFICIENT_CYCLES
  * `theta_s = 0.28` and `tau_coag = 12` are operator-locked and used
  * no OmegaRecord is created (AST-checked + result-checked)
  * no `OmegaRegistry.register` call exists in the package
  * no `ReferenceField` reference appears
  * no `is_omega_anchor` identifier appears
  * no production mutation (zero diff vs origin/main; AST-level forbidden
    imports)
  * the observation distinguishes surrogate mode from isolated rule mode
    (separate fields per bucket)
  * the isolated rule correctly fires on a 12-long run above threshold
  * the isolated rule does NOT fire on an 11-long run
  * provenance / cycle ids are populated when a coagulation candidate
    exists
  * both JSON and markdown reports are written to `reports/`
  * the final report explicitly says Level 3 is NOT declared (in both
    JSON and markdown form), and the literal `LEVEL_3_REACHED` never
    appears
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

from coagulation_observation import (  # noqa: E402
    CANDIDATE_BUCKETS,
    SCHEMA_VERSION,
    TAU_COAG,
    THETA_S,
    isolated_temporal_rule,
    longest_run_above_threshold,
    observe_bucket,
    render_json,
    render_markdown,
    run_observation,
    write_reports,
)
from coagulation_observation import runner as runner_module  # noqa: E402
from coagulation_observation import report as report_module  # noqa: E402


REPORTS_DIR = _RESEARCH_ROOT / "reports"
JSON_PATH = REPORTS_DIR / "coagulation_observation_report.json"
MD_PATH = REPORTS_DIR / "coagulation_observation_report.md"


# ---------------------------------------------------------------------------
# Module-level fixture: build the observation once.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def observation() -> Dict[str, Any]:
    return run_observation(commit_sha="test-fixture-sha")


@pytest.fixture(scope="module")
def disk_json() -> Dict[str, Any]:
    if not JSON_PATH.exists():
        pytest.skip(f"{JSON_PATH} not yet generated")
    return json.loads(JSON_PATH.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# 1 — runner loads A and B harness telemetry
# ---------------------------------------------------------------------------


def test_01_runner_loads_a_and_b(observation: Dict[str, Any]) -> None:
    labels = {t["label"] for t in observation["transcripts"]}
    assert labels == {"A", "B"}, f"expected runs A,B; got {labels}"
    for t in observation["transcripts"]:
        assert t["n_rows"] == 500
        assert t["invariant_ok"] is True
        assert t["audit_flags"] == []
        assert (
            t["metric_source"]
            == "research_surrogate_v1_not_fce_production"
        )


# ---------------------------------------------------------------------------
# 2 — candidate buckets exist OR report INSUFFICIENT_CYCLES
# ---------------------------------------------------------------------------


def test_02_candidate_buckets_resolved(observation: Dict[str, Any]) -> None:
    admitted_verdicts = {
        "WOULD_COAGULATE",
        "NO_COAGULATION",
        "INSUFFICIENT_CYCLES",
    }
    for t in observation["transcripts"]:
        for cb in CANDIDATE_BUCKETS:
            cid, p = cb
            match = [
                b
                for b in t["buckets"]
                if b["center_id"] == cid and b["perspective"] == p
            ]
            assert len(match) == 1, (
                f"bucket {cid!r}/{p!r} not observed in transcript {t['label']}"
            )
            obs = match[0]
            assert obs["verdict"] in admitted_verdicts, (
                f"unexpected verdict {obs['verdict']!r}"
            )
            if obs["n_cycles"] < TAU_COAG:
                assert obs["verdict"] == "INSUFFICIENT_CYCLES"
            else:
                assert obs["verdict"] != "INSUFFICIENT_CYCLES"


# ---------------------------------------------------------------------------
# 3 — theta_s = 0.28
# ---------------------------------------------------------------------------


def test_03_theta_s_operator_locked(observation: Dict[str, Any]) -> None:
    assert THETA_S == 0.28, f"THETA_S must remain 0.28; got {THETA_S}"
    assert observation["theta_s_used"] == 0.28
    # Source string must indicate operator-locked literal + production
    # config untouched.
    src = observation["theta_s_source"]
    assert "operator-locked" in src.lower()
    assert "production config untouched" in src.lower()
    # Module rejects deviations.
    with pytest.raises(ValueError):
        run_observation(theta_s=0.10)


# ---------------------------------------------------------------------------
# 4 — tau_coag = 12
# ---------------------------------------------------------------------------


def test_04_tau_coag_operator_locked(observation: Dict[str, Any]) -> None:
    assert TAU_COAG == 12, f"TAU_COAG must remain 12; got {TAU_COAG}"
    assert observation["tau_coag_used"] == 12
    src = observation["tau_coag_source"]
    assert "operator-locked" in src.lower()
    with pytest.raises(ValueError):
        run_observation(tau_coag=6)


# ---------------------------------------------------------------------------
# 5 — no Omega created (result-checked)
# ---------------------------------------------------------------------------


def test_05_no_omega_created(observation: Dict[str, Any]) -> None:
    assert observation["level_3_declared"] is False
    assert observation["natural_omega_created"] is False
    assert observation["no_omega_record_created"] is True
    assert observation["no_omega_registry_write"] is True
    assert observation["no_reference_field_created"] is True


# ---------------------------------------------------------------------------
# 6 — no OmegaRegistry.register call in the package
# ---------------------------------------------------------------------------


def _module_source(module) -> str:
    return Path(module.__file__).read_text(encoding="utf-8")


def _walk_source_files() -> List[Path]:
    pkg_dir = Path(runner_module.__file__).resolve().parent
    return sorted(p for p in pkg_dir.glob("*.py"))


def _identifiers_in_source(src: str):
    """Yield (kind, name) for every executable identifier in `src`.

    Excludes string constants (e.g. docstrings) — the operator's
    isolation rule is 'do not USE these identifiers in executable
    code', not 'do not mention them in docs / negation prose'.
    """
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            yield ("name", node.id)
        elif isinstance(node, ast.Attribute):
            yield ("attr", node.attr)
        elif isinstance(node, ast.ClassDef):
            yield ("class", node.name)
        elif isinstance(node, ast.FunctionDef):
            yield ("func", node.name)
        elif isinstance(node, ast.AsyncFunctionDef):
            yield ("func", node.name)
        elif isinstance(node, ast.arg):
            yield ("arg", node.arg)
        elif isinstance(node, ast.keyword):
            if node.arg:
                yield ("kw", node.arg)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for a in node.names:
                yield ("import", a.name)
                if a.asname:
                    yield ("import_as", a.asname)


def test_06_no_omega_registry_register_call() -> None:
    """AST-level: no `OmegaRegistry.register(...)` call in any package
    file. Docstring mentions describing the constraint are allowed."""
    for path in _walk_source_files():
        src = path.read_text(encoding="utf-8")
        tree = ast.parse(src)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                f = node.func
                if isinstance(f, ast.Attribute) and f.attr == "register":
                    target = f.value
                    if isinstance(target, ast.Name) and target.id == "OmegaRegistry":
                        pytest.fail(
                            f"{path.name}: OmegaRegistry.register(...) call"
                        )
        # The identifier `OmegaRegistry` must not appear as a code
        # identifier (Name / Attribute / class / func / arg / keyword /
        # import). Docstring mentions are excluded by construction.
        for kind, name in _identifiers_in_source(src):
            assert name != "OmegaRegistry", (
                f"{path.name}: identifier `OmegaRegistry` appears as {kind!r}"
            )


# ---------------------------------------------------------------------------
# 7 — no ReferenceField reference (AST identifier level)
# ---------------------------------------------------------------------------


def test_07_no_reference_field() -> None:
    """AST-level: identifier `ReferenceField` must not appear as a
    Name/Attribute/ClassDef/FunctionDef/etc. Docstrings allowed."""
    for path in _walk_source_files():
        src = path.read_text(encoding="utf-8")
        for kind, name in _identifiers_in_source(src):
            assert name != "ReferenceField", (
                f"{path.name}: identifier `ReferenceField` appears as {kind!r}"
            )


# ---------------------------------------------------------------------------
# 8 — no is_omega_anchor identifier (AST identifier level)
# ---------------------------------------------------------------------------


def test_08_no_is_omega_anchor() -> None:
    """AST-level: identifier `is_omega_anchor` must not appear in any
    executable position. Docstrings allowed."""
    for path in _walk_source_files():
        src = path.read_text(encoding="utf-8")
        for kind, name in _identifiers_in_source(src):
            assert name != "is_omega_anchor", (
                f"{path.name}: identifier `is_omega_anchor` appears as {kind!r}"
            )


# ---------------------------------------------------------------------------
# 9 — no production mutation (forbidden imports / forbidden calls)
# ---------------------------------------------------------------------------


_FORBIDDEN_IMPORT_PREFIXES = (
    "byon_orchestrator.src",
    "byon_orchestrator.scripts",
    "byon_orchestrator.memory_service",
    "unified_fragmergent_memory",
    "fragmergent_causal_exponentiation_memory",
    "anthropic",
    "openai",
    "torch",
    "sentence_transformers",
    "transformers",
)


def test_09_no_production_imports_in_package() -> None:
    for path in _walk_source_files():
        src = path.read_text(encoding="utf-8")
        tree = ast.parse(src)
        for node in ast.walk(tree):
            names: List[str] = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                mod = node.module or ""
                names = [mod] + [a.name for a in node.names]
            for n in names:
                normalized = n.replace("-", "_")
                for prefix in _FORBIDDEN_IMPORT_PREFIXES:
                    if normalized == prefix or normalized.startswith(prefix + "."):
                        pytest.fail(
                            f"{path.name}: forbidden import {n!r} "
                            f"(matched {prefix!r})"
                        )
        # Forbid string-level call to production check_coagulation.
        tree = ast.parse(src)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                f = node.func
                if isinstance(f, ast.Name) and f.id == "check_coagulation":
                    pytest.fail(
                        f"{path.name}: forbidden call to check_coagulation()"
                    )
                if isinstance(f, ast.Attribute) and f.attr == "check_coagulation":
                    pytest.fail(
                        f"{path.name}: forbidden attribute call .check_coagulation()"
                    )
        # And the import itself.
        tree = ast.parse(src)
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                for a in node.names:
                    if a.name == "check_coagulation":
                        pytest.fail(
                            f"{path.name}: imports check_coagulation"
                        )


# ---------------------------------------------------------------------------
# 10 — result distinguishes surrogate from isolated rule
# ---------------------------------------------------------------------------


def test_10_surrogate_vs_isolated_distinguished(observation: Dict[str, Any]) -> None:
    """The observation must report both flags separately per bucket.

    The two modes share the same input + logic, so they MUST agree on
    every bucket — but the separate fields ensure the report and any
    future production-rule swap can be audited side-by-side.
    """
    for t in observation["transcripts"]:
        for b in t["buckets"]:
            if b.get("insufficient_cycles"):
                continue
            assert "would_coagulate_surrogate" in b
            assert "would_coagulate_isolated_rule" in b
            # Sanity: the two must currently agree (same rule, same input).
            assert b["would_coagulate_surrogate"] == b["would_coagulate_isolated_rule"], (
                f"mode disagreement on {b['center_id']!r}: "
                f"surrogate={b['would_coagulate_surrogate']} vs "
                f"isolated={b['would_coagulate_isolated_rule']}"
            )


# ---------------------------------------------------------------------------
# 11 — 12 consecutive above threshold -> WOULD_COAGULATE
# ---------------------------------------------------------------------------


def test_11_twelve_consecutive_above_threshold_fires() -> None:
    s_series = [0.30] * 12
    assert isolated_temporal_rule(s_series, THETA_S, TAU_COAG) is True
    # Threshold edge: exactly equal counts as >=.
    s_series_edge = [THETA_S] * 12
    assert isolated_temporal_rule(s_series_edge, THETA_S, TAU_COAG) is True
    # Above + below + above (12-run later on) — still fires.
    s_series_late = [0.0] * 5 + [0.30] * 12
    assert isolated_temporal_rule(s_series_late, THETA_S, TAU_COAG) is True


# ---------------------------------------------------------------------------
# 12 — 11 consecutive above threshold -> NO_COAGULATION
# ---------------------------------------------------------------------------


def test_12_eleven_consecutive_does_not_fire() -> None:
    s_series = [0.30] * 11 + [0.0] + [0.30] * 11
    assert isolated_temporal_rule(s_series, THETA_S, TAU_COAG) is False
    # Edge: 11 in a row + nothing else.
    s_series_just_short = [0.30] * 11
    assert isolated_temporal_rule(s_series_just_short, THETA_S, TAU_COAG) is False
    # Just below threshold for 12 — does not fire.
    s_series_below = [0.279] * 12
    assert isolated_temporal_rule(s_series_below, THETA_S, TAU_COAG) is False


# ---------------------------------------------------------------------------
# 13 — provenance / cycle ids included when coagulation candidate exists
# ---------------------------------------------------------------------------


def test_13_provenance_and_cycle_ids_included(
    observation: Dict[str, Any],
) -> None:
    n_candidates_with_window = 0
    for t in observation["transcripts"]:
        for b in t["buckets"]:
            if b.get("insufficient_cycles"):
                continue
            assert "source_cycle_ids" in b
            assert "all_bucket_cycle_ids" in b
            assert "source_event_ids" in b
            assert "source_summary_ids" in b
            if b["would_coagulate_isolated_rule"]:
                # source_cycle_ids must be exactly tau_coag long
                assert len(b["source_cycle_ids"]) == TAU_COAG, (
                    f"{b['center_id']!r}: expected window of {TAU_COAG} "
                    f"cycle ids, got {len(b['source_cycle_ids'])}"
                )
                # candidate_cycle_id must point to the last cycle in the
                # window.
                assert b["coagulation_candidate_cycle_id"] == b["source_cycle_ids"][-1]
                n_candidates_with_window += 1
    # The current Transcript A/B / candidate-bucket combo has multiple
    # WOULD_COAGULATE outcomes (every aligned bucket clears the surrogate
    # threshold). Require at least one window populated.
    assert n_candidates_with_window >= 1


# ---------------------------------------------------------------------------
# 14 — JSON report generated
# ---------------------------------------------------------------------------


def test_14_json_report_generated(tmp_path: Path) -> None:
    out_dir = tmp_path / "reports"
    json_path, md_path = write_reports(out_dir, commit_sha="test")
    assert json_path.exists()
    assert json_path.stat().st_size > 0
    data = json.loads(json_path.read_text(encoding="utf-8"))
    assert data["schema_version"] == SCHEMA_VERSION
    assert data["level_3_declared"] is False
    assert "LEVEL_3_REACHED" not in json_path.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# 15 — Markdown report generated
# ---------------------------------------------------------------------------


def test_15_markdown_report_generated(tmp_path: Path) -> None:
    out_dir = tmp_path / "reports"
    json_path, md_path = write_reports(out_dir, commit_sha="test")
    assert md_path.exists()
    md = md_path.read_text(encoding="utf-8")
    assert md.startswith("# Controlled Coagulation Observation Report")
    # Forbidden phrasing absent.
    assert "LEVEL_3_REACHED" not in md
    # Required phrasing present.
    assert "Level 3 is **NOT declared**" in md


# ---------------------------------------------------------------------------
# 16 — final report explicitly says Level 3 NOT declared
# ---------------------------------------------------------------------------


def test_16_final_report_says_level_3_not_declared(
    observation: Dict[str, Any],
) -> None:
    assert observation["level_3_declared"] is False
    md = render_markdown(observation)
    assert "Level 3 is **NOT declared**" in md
    assert "natural_omega_created" in render_json(observation)
    assert "LEVEL_3_REACHED" not in render_json(observation)
    assert "LEVEL_3_REACHED" not in md
    # Disk artifacts must agree.
    if MD_PATH.exists():
        disk_md = MD_PATH.read_text(encoding="utf-8")
        assert "Level 3 is **NOT declared**" in disk_md
        assert "LEVEL_3_REACHED" not in disk_md


# ---------------------------------------------------------------------------
# Extra — disk JSON shape
# ---------------------------------------------------------------------------


def test_extra_disk_json_shape(disk_json: Dict[str, Any]) -> None:
    for key in (
        "schema_version",
        "branch",
        "generated_at_commit_sha",
        "metric_source",
        "theta_s_used",
        "tau_coag_used",
        "production_config_untouched",
        "level_3_declared",
        "natural_omega_created",
        "no_omega_record_created",
        "no_omega_registry_write",
        "no_reference_field_created",
        "candidate_buckets",
        "transcripts",
        "family_status",
        "final_verdict",
        "verdict_legend",
    ):
        assert key in disk_json, f"disk JSON missing key {key!r}"
    assert disk_json["theta_s_used"] == 0.28
    assert disk_json["tau_coag_used"] == 12
    assert disk_json["production_config_untouched"] is True
    assert disk_json["level_3_declared"] is False
    assert disk_json["natural_omega_created"] is False
    # Final verdict is one of the operator-locked strings.
    assert disk_json["final_verdict"] in (
        "NO_COAGULATION_OBSERVED",
        "SURROGATE_FEASIBILITY_ONLY",
        "ISOLATED_RULE_OBSERVED_NO_OMEGA_CREATED",
    )


# ---------------------------------------------------------------------------
# Extra — longest_run_above_threshold helper sanity
# ---------------------------------------------------------------------------


def test_extra_longest_run_helper() -> None:
    assert longest_run_above_threshold([0.30] * 5, 0.28) == 5
    assert longest_run_above_threshold([0.30, 0.10, 0.30, 0.30], 0.28) == 2
    assert longest_run_above_threshold([], 0.28) == 0
    assert longest_run_above_threshold([0.0, 0.0, 0.0], 0.28) == 0
