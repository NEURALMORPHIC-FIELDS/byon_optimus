"""Tests for the isolated real-FCE-M observation adapter (commit 12).

Verifies:
  * adapter runs on both A and B candidate buckets
  * `theta_s = 0.28` and `tau_coag = 12` operator-locked
  * NO OmegaRecord created (result + AST)
  * NO `OmegaRegistry.register` call in package source
  * NO `ReferenceField` identifier in executable position
  * NO `is_omega_anchor` identifier in executable position
  * NO config mutation
  * NO production memory-service modification (no imports into that tree)
  * real FCE S_t / AR / B_t / kappa values are finite
  * report distinguishes surrogate from real FCE per bucket
  * both JSON and MD reports written to `reports/`
  * final report explicitly says Level 3 NOT declared and never emits
    forbidden verdict strings (`LEVEL_3_REACHED`, `OMEGA_CREATED`,
    `NATURAL_OMEGA_PROVEN`)
  * If real FCE temporal rule fires on a synthetic series, the verdict
    is `REAL_FCE_TEMPORAL_RULE_OBSERVED_NO_OMEGA_CREATED`, never any
    Level 3 / Omega-created variant.
"""

from __future__ import annotations

import ast
import json
import math
import re
import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest


_FORBIDDEN_VERDICTS = ("LEVEL_3_REACHED", "OMEGA_CREATED", "NATURAL_OMEGA_PROVEN")


def _contains_forbidden_token(text: str) -> str:
    """Return the first forbidden token that appears as a standalone
    identifier in `text`, or empty string if none. A token counts as
    standalone when it is surrounded by non-word characters (so
    `NO_OMEGA_CREATED` does NOT match `OMEGA_CREATED` because there is
    a `_` immediately before O).
    """
    for token in _FORBIDDEN_VERDICTS:
        pattern = r"(?<![A-Za-z0-9_])" + re.escape(token) + r"(?![A-Za-z0-9_])"
        if re.search(pattern, text):
            return token
    return ""


_HERE = Path(__file__).resolve().parent
_RESEARCH_ROOT = _HERE.parent
if str(_RESEARCH_ROOT) not in sys.path:
    sys.path.insert(0, str(_RESEARCH_ROOT))

from fce_observation_adapter import (  # noqa: E402
    AGENT_FIELD_DIM,
    CANDIDATE_BUCKETS,
    METRIC_SOURCE_REAL_FCE,
    SCHEMA_VERSION,
    TAU_COAG,
    THETA_S,
    isolated_temporal_rule,
    longest_run_above_threshold,
    render_json,
    render_markdown,
    run_real_fce_observation,
    write_reports,
)
from fce_observation_adapter import adapter as adapter_module  # noqa: E402
from fce_observation_adapter import report as report_module  # noqa: E402


REPORTS_DIR = _RESEARCH_ROOT / "reports"
JSON_PATH = REPORTS_DIR / "fce_observation_adapter_report.json"
MD_PATH = REPORTS_DIR / "fce_observation_adapter_report.md"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def observation() -> Dict[str, Any]:
    return run_real_fce_observation(commit_sha="test-fixture-sha")


@pytest.fixture(scope="module")
def disk_json() -> Dict[str, Any]:
    if not JSON_PATH.exists():
        pytest.skip(f"{JSON_PATH} not yet generated")
    return json.loads(JSON_PATH.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Helpers — AST identifier walker
# ---------------------------------------------------------------------------


def _walk_source_files() -> List[Path]:
    pkg_dir = Path(adapter_module.__file__).resolve().parent
    return sorted(p for p in pkg_dir.glob("*.py"))


def _identifiers_in_source(src: str):
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


# ---------------------------------------------------------------------------
# 1 — adapter runs on A/B candidate buckets
# ---------------------------------------------------------------------------


def test_01_adapter_runs_on_a_and_b(observation: Dict[str, Any]) -> None:
    labels = {t["label"] for t in observation["transcripts"]}
    assert labels == {"A", "B"}
    for t in observation["transcripts"]:
        assert t["n_rows"] == 500
        assert t["invariant_ok"] is True
        # Per-bucket observations exist for every candidate.
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


# ---------------------------------------------------------------------------
# 2 — theta_s = 0.28
# ---------------------------------------------------------------------------


def test_02_theta_s_operator_locked(observation: Dict[str, Any]) -> None:
    assert THETA_S == 0.28
    assert observation["theta_s_used"] == 0.28
    with pytest.raises(ValueError):
        run_real_fce_observation(theta_s=0.10)


# ---------------------------------------------------------------------------
# 3 — tau_coag = 12
# ---------------------------------------------------------------------------


def test_03_tau_coag_operator_locked(observation: Dict[str, Any]) -> None:
    assert TAU_COAG == 12
    assert observation["tau_coag_used"] == 12
    with pytest.raises(ValueError):
        run_real_fce_observation(tau_coag=6)


# ---------------------------------------------------------------------------
# 4 — no OmegaRecord created
# ---------------------------------------------------------------------------


def test_04_no_omega_record(observation: Dict[str, Any]) -> None:
    assert observation["level_3_declared"] is False
    assert observation["natural_omega_created"] is False
    assert observation["no_omega_record_created"] is True
    # Agent.Omega state must be 0 for every observed bucket.
    for t in observation["transcripts"]:
        for b in t["buckets"]:
            if b.get("insufficient_cycles"):
                continue
            assert b["agent_omega_state"] == 0, (
                f"{b['center_id']!r}: agent.Omega is {b['agent_omega_state']!r}"
            )


# ---------------------------------------------------------------------------
# 5 — no OmegaRegistry.register call in any package file (AST)
# ---------------------------------------------------------------------------


def test_05_no_omega_registry_register_call() -> None:
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
        # Identifier-level: `OmegaRegistry` must not be used as a code
        # identifier (Name/Attribute/etc.). Docstrings are excluded.
        for kind, name in _identifiers_in_source(src):
            assert name != "OmegaRegistry", (
                f"{path.name}: identifier `OmegaRegistry` appears as {kind!r}"
            )


# ---------------------------------------------------------------------------
# 6 — no ReferenceField identifier in executable position
# ---------------------------------------------------------------------------


def test_06_no_reference_field() -> None:
    for path in _walk_source_files():
        src = path.read_text(encoding="utf-8")
        for kind, name in _identifiers_in_source(src):
            assert name != "ReferenceField", (
                f"{path.name}: identifier `ReferenceField` appears as {kind!r}"
            )
        # Also guard against the registry class name.
        for kind, name in _identifiers_in_source(src):
            assert name != "ReferenceFieldRegistry", (
                f"{path.name}: identifier `ReferenceFieldRegistry` appears as {kind!r}"
            )


# ---------------------------------------------------------------------------
# 7 — no is_omega_anchor identifier
# ---------------------------------------------------------------------------


def test_07_no_is_omega_anchor() -> None:
    for path in _walk_source_files():
        src = path.read_text(encoding="utf-8")
        for kind, name in _identifiers_in_source(src):
            assert name != "is_omega_anchor", (
                f"{path.name}: identifier `is_omega_anchor` appears as {kind!r}"
            )


# ---------------------------------------------------------------------------
# 8 — no config mutation: agent.check_coagulation never called; FceOmegaObserver never imported
# ---------------------------------------------------------------------------


def test_08_no_check_coagulation_call_or_observer_import() -> None:
    for path in _walk_source_files():
        src = path.read_text(encoding="utf-8")
        tree = ast.parse(src)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                f = node.func
                # agent.check_coagulation(...) — attribute call.
                if isinstance(f, ast.Attribute) and f.attr == "check_coagulation":
                    pytest.fail(
                        f"{path.name}: attribute call `.check_coagulation(...)`"
                    )
                # bare check_coagulation(...) — name call.
                if isinstance(f, ast.Name) and f.id == "check_coagulation":
                    pytest.fail(
                        f"{path.name}: bare call `check_coagulation(...)`"
                    )
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                for a in node.names:
                    if a.name == "FceOmegaObserver":
                        pytest.fail(
                            f"{path.name}: imports `FceOmegaObserver` "
                            "(production registry-writing path)"
                        )
                    if a.name == "check_coagulation":
                        pytest.fail(
                            f"{path.name}: imports `check_coagulation`"
                        )
        # Identifier check.
        for kind, name in _identifiers_in_source(src):
            assert name != "FceOmegaObserver", (
                f"{path.name}: identifier `FceOmegaObserver` appears as {kind!r}"
            )


# ---------------------------------------------------------------------------
# 9 — no production memory-service modification (AST: no forbidden imports)
# ---------------------------------------------------------------------------


_FORBIDDEN_IMPORT_PREFIXES = (
    # Production code paths (orchestrator-side).
    "byon_orchestrator.src",
    "byon_orchestrator.scripts",
    # We DO read-only import from `unified_fragmergent_memory.sources.fce_omega`;
    # that is the vendored FCE-M which the adapter explicitly bridges to.
    # The forbidden FCE-M production submodules are the ones with side
    # effects: omega_registry, reference_field, fce_omega_observer.
    "unified_fragmergent_memory.runtime.omega_registry",
    "unified_fragmergent_memory.runtime.reference_field",
    "unified_fragmergent_memory.runtime.fce_omega_observer",
    # LLM / embedding imports.
    "anthropic",
    "openai",
    "torch",
    "sentence_transformers",
    "transformers",
)


def test_09_no_forbidden_imports() -> None:
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
                            f"{path.name}: forbidden import {n!r} (matched {prefix!r})"
                        )


# ---------------------------------------------------------------------------
# 10 — real FCE metrics are finite
# ---------------------------------------------------------------------------


def test_10_real_fce_metrics_finite(observation: Dict[str, Any]) -> None:
    for t in observation["transcripts"]:
        for b in t["buckets"]:
            if b.get("insufficient_cycles"):
                continue
            for field in (
                "max_S_t_real",
                "mean_S_t_real",
                "agent_final_kappa",
                "agent_final_alpha",
                "agent_final_rho",
                "agent_final_lambda_ar",
            ):
                v = b.get(field)
                assert v is not None
                assert isinstance(v, float)
                assert math.isfinite(v), (
                    f"{b['center_id']!r}: non-finite {field}={v}"
                )
            for grp in ("s_series_summary", "ar_t_summary", "b_t_summary", "z_norm_summary"):
                summary = b.get(grp)
                assert summary is not None
                for k, v in summary.items():
                    assert isinstance(v, float)
                    assert math.isfinite(v), (
                        f"{b['center_id']!r}: non-finite {grp}.{k}={v}"
                    )


# ---------------------------------------------------------------------------
# 11 — report distinguishes surrogate vs real FCE
# ---------------------------------------------------------------------------


def test_11_distinguishes_surrogate_vs_real(observation: Dict[str, Any]) -> None:
    assert observation["metric_source_real"] == METRIC_SOURCE_REAL_FCE
    assert observation["metric_source_real"] != observation["metric_source_surrogate"]
    for t in observation["transcripts"]:
        for b in t["buckets"]:
            if b.get("insufficient_cycles"):
                continue
            # Both fields must be present, separately labeled.
            assert "would_pass_temporal_rule_real_fce" in b
            assert "surrogate_would_pass" in b
            assert "surrogate_vs_real_diverge" in b
            # If they diverge, divergence_note must be non-empty.
            if b["surrogate_vs_real_diverge"]:
                assert b["divergence_note"], (
                    f"{b['center_id']!r}: surrogate vs real diverge but "
                    "divergence_note is empty"
                )


# ---------------------------------------------------------------------------
# 12 — JSON report generated
# ---------------------------------------------------------------------------


def test_12_json_report_generated(tmp_path: Path) -> None:
    out_dir = tmp_path / "reports"
    json_path, md_path = write_reports(out_dir, commit_sha="test")
    assert json_path.exists()
    data = json.loads(json_path.read_text(encoding="utf-8"))
    assert data["schema_version"] == SCHEMA_VERSION
    assert data["level_3_declared"] is False
    found = _contains_forbidden_token(json_path.read_text(encoding="utf-8"))
    assert not found, (
        f"forbidden verdict token {found!r} appears as standalone identifier in JSON"
    )


# ---------------------------------------------------------------------------
# 13 — Markdown report generated
# ---------------------------------------------------------------------------


def test_13_markdown_report_generated(tmp_path: Path) -> None:
    out_dir = tmp_path / "reports"
    json_path, md_path = write_reports(out_dir, commit_sha="test")
    assert md_path.exists()
    md = md_path.read_text(encoding="utf-8")
    assert md.startswith("# Isolated Real FCE-M Observation Adapter")
    found = _contains_forbidden_token(md)
    assert not found, (
        f"forbidden verdict token {found!r} appears as standalone identifier in MD"
    )
    assert "Level 3 is **NOT declared**" in md


# ---------------------------------------------------------------------------
# 14 — final report explicitly says Level 3 NOT declared
# ---------------------------------------------------------------------------


def test_14_final_report_says_level_3_not_declared(
    observation: Dict[str, Any],
) -> None:
    assert observation["level_3_declared"] is False
    md = render_markdown(observation)
    assert "Level 3 is **NOT declared**" in md
    j = render_json(observation)
    # Forbidden tokens must NOT appear as standalone identifiers in
    # either rendering. The legitimate compound `NO_OMEGA_CREATED` is
    # excluded because the leading `_` makes the boundary check fail.
    found = _contains_forbidden_token(j)
    assert not found, (
        f"forbidden verdict token {found!r} appears as standalone identifier in JSON"
    )
    found = _contains_forbidden_token(md)
    assert not found, (
        f"forbidden verdict token {found!r} appears as standalone identifier in MD"
    )
    if MD_PATH.exists():
        disk_md = MD_PATH.read_text(encoding="utf-8")
        assert "Level 3 is **NOT declared**" in disk_md
        found = _contains_forbidden_token(disk_md)
        assert not found, (
            f"forbidden verdict token {found!r} appears in disk MD"
        )


# ---------------------------------------------------------------------------
# 15 — if real-FCE temporal rule fires, verdict is the allowed string only
# ---------------------------------------------------------------------------


def test_15_real_fce_pass_verdict_is_no_omega_created() -> None:
    """Synthetic S_t series that passes the rule must produce the
    allowed verdict string, never any Level 3 / Omega-created variant.

    This test exercises the isolated_temporal_rule pure function plus
    the verdict-mapping logic by direct unit assertion: a 12-long run
    above threshold passes; an 11-long run does not.
    """
    # 12 cycles >= 0.28 → would pass.
    assert isolated_temporal_rule([0.30] * 12, THETA_S, TAU_COAG) is True
    # 11 cycles >= 0.28 → would NOT pass.
    assert isolated_temporal_rule([0.30] * 11, THETA_S, TAU_COAG) is False
    # If a bucket WOULD pass, the runner's bucket-verdict mapping is
    # `REAL_FCE_TEMPORAL_RULE_OBSERVED_NO_OMEGA_CREATED`. The literal
    # appears in the verdict_legend keys (operator-locked vocabulary).
    obs = run_real_fce_observation(commit_sha="test")
    legend = obs["verdict_legend"]
    # The legend must contain the allowed strings and NONE of the forbidden ones.
    allowed = {
        "REAL_FCE_NO_COAGULATION",
        "REAL_FCE_NEAR_THRESHOLD",
        "REAL_FCE_TEMPORAL_RULE_OBSERVED_NO_OMEGA_CREATED",
        "ADAPTER_INCONCLUSIVE",
    }
    assert set(legend.keys()) == allowed
    for forbidden in _FORBIDDEN_VERDICTS:
        # Forbidden token must not appear as a legend key.
        assert forbidden not in legend.keys()
        # And must not appear as a STANDALONE identifier in any legend
        # value (the compound `NO_OMEGA_CREATED` is allowed and reads
        # correctly due to the leading `_`).
        for v in legend.values():
            assert not _contains_forbidden_token(v), (
                f"forbidden verdict token {forbidden!r} appears in legend value: {v!r}"
            )
    assert obs["final_verdict"] in allowed
    # Per-bucket verdicts must also be in the allowed set.
    for t in obs["transcripts"]:
        for b in t["buckets"]:
            assert b["verdict"] in allowed, b["verdict"]


# ---------------------------------------------------------------------------
# Extra — longest_run_above_threshold helper
# ---------------------------------------------------------------------------


def test_extra_longest_run_helper() -> None:
    assert longest_run_above_threshold([0.30] * 5, 0.28) == 5
    assert longest_run_above_threshold([0.30, 0.10, 0.30, 0.30], 0.28) == 2
    assert longest_run_above_threshold([], 0.28) == 0
    assert longest_run_above_threshold([0.0, 0.0, 0.0], 0.28) == 0


# ---------------------------------------------------------------------------
# Extra — disk JSON shape
# ---------------------------------------------------------------------------


def test_extra_disk_json_shape(disk_json: Dict[str, Any]) -> None:
    for key in (
        "schema_version",
        "branch",
        "generated_at_commit_sha",
        "metric_source_real",
        "metric_source_surrogate",
        "theta_s_used",
        "tau_coag_used",
        "field_dim_used",
        "agent_init",
        "production_config_untouched",
        "fce_m_vendor_unmodified",
        "level_3_declared",
        "natural_omega_created",
        "no_omega_record_created",
        "no_omega_registry_write",
        "no_reference_field_created",
        "agent_check_coagulation_called",
        "isolation_notes",
        "candidate_buckets",
        "transcripts",
        "family_status",
        "final_verdict",
        "verdict_legend",
    ):
        assert key in disk_json, f"disk JSON missing key {key!r}"
    assert disk_json["agent_check_coagulation_called"] is False
    assert disk_json["fce_m_vendor_unmodified"] is True
    assert disk_json["final_verdict"] in (
        "REAL_FCE_NO_COAGULATION",
        "REAL_FCE_NEAR_THRESHOLD",
        "REAL_FCE_TEMPORAL_RULE_OBSERVED_NO_OMEGA_CREATED",
        "ADAPTER_INCONCLUSIVE",
    )
