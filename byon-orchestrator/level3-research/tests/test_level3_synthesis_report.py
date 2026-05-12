"""Presence + content validation for the Level 3 synthesis report.

Document-only validator. Does NOT import production. Does NOT run FCE
experiments. Does NOT instantiate the harness. Does NOT create Omega.
Only reads the synthesis report artifacts and asserts that operator-
specified sections, keys, and constraints are present.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List

import pytest


_HERE = Path(__file__).resolve().parent
_RESEARCH_ROOT = _HERE.parent
REPORTS_DIR = _RESEARCH_ROOT / "reports"
MD_PATH = REPORTS_DIR / "level3_research_synthesis_after_real_fce.md"
JSON_PATH = REPORTS_DIR / "level3_research_synthesis_after_real_fce.json"

_REQUIRED_MD_SECTIONS = (
    "## 1. What was demonstrated",
    "## 2. Real result",
    "## 3. Technical cause",
    "## 4. What CANNOT be claimed",
    "## 5. What comes next",
    "## 6. L3 gate status after commit 12",
    "## 7. Final conclusion",
)

_REQUIRED_JSON_KEYS = (
    "report_version",
    "branch",
    "as_of_commit_sha",
    "advisory_only",
    "theta_s",
    "tau_coag",
    "thresholds_unchanged_in_research_branch",
    "level_3_declared",
    "natural_omega_proven",
    "reference_field_created",
    "production_loop_test_run",
    "claim_thresholds_are_wrong",
    "section_1_demonstrated",
    "section_2_real_result",
    "section_3_technical_cause_probable",
    "section_4_cannot_be_claimed",
    "section_5_what_comes_next",
    "section_6_l3_gate_status_after_commit_12",
    "section_7_final_conclusion",
)

_REQUIRED_L3_GATES = (
    "L3-G1",
    "L3-G2",
    "L3-G3",
    "L3-G4",
    "L3-G5",
    "L3-G6",
    "L3-G7",
    "L3-G8",
    "L3-G9",
    "L3-G10",
)

_FORBIDDEN_VERDICTS = ("LEVEL_3_REACHED", "OMEGA_CREATED", "NATURAL_OMEGA_PROVEN")


def _contains_forbidden_token(text: str) -> str:
    """Standalone-identifier check (word-boundary aware). Returns the
    first forbidden token found as a standalone identifier, or ''."""
    for token in _FORBIDDEN_VERDICTS:
        pattern = r"(?<![A-Za-z0-9_])" + re.escape(token) + r"(?![A-Za-z0-9_])"
        if re.search(pattern, text):
            return token
    return ""


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def md_text() -> str:
    assert MD_PATH.exists(), f"missing synthesis MD: {MD_PATH}"
    return MD_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def json_data() -> Dict[str, Any]:
    assert JSON_PATH.exists(), f"missing synthesis JSON: {JSON_PATH}"
    return json.loads(JSON_PATH.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# 1 — both report files exist
# ---------------------------------------------------------------------------


def test_01_synthesis_reports_exist() -> None:
    assert MD_PATH.exists(), f"missing {MD_PATH}"
    assert JSON_PATH.exists(), f"missing {JSON_PATH}"
    assert MD_PATH.stat().st_size > 0
    assert JSON_PATH.stat().st_size > 0


# ---------------------------------------------------------------------------
# 2 — MD has every required section heading
# ---------------------------------------------------------------------------


def test_02_md_has_all_required_sections(md_text: str) -> None:
    for section in _REQUIRED_MD_SECTIONS:
        assert section in md_text, f"MD missing section heading {section!r}"


# ---------------------------------------------------------------------------
# 3 — MD says Level 3 NOT declared
# ---------------------------------------------------------------------------


def test_03_md_says_level_3_not_declared(md_text: str) -> None:
    # The operator-locked phrasing for "Level 3 not declared" appears
    # in multiple variations across the synthesis report. We require at
    # least one of the canonical phrasings to be present.
    canonical_negations = (
        "Level 3 is NOT declared",
        "Level 3 not reached",
        "No Level 3 declaration on main",
        "Level 3 NOT declared",
    )
    assert any(phrase in md_text for phrase in canonical_negations), (
        "MD must explicitly say Level 3 is NOT declared / not reached"
    )


# ---------------------------------------------------------------------------
# 4 — MD says no natural Omega / no Omega creation
# ---------------------------------------------------------------------------


def test_04_md_says_no_natural_omega(md_text: str) -> None:
    canonical = (
        "No natural Omega",
        "Natural Omega is NOT proven",
        "no OmegaRecord exists",
        "No `OmegaRecord` exists",
        "no Omega",
    )
    assert any(p in md_text for p in canonical), (
        "MD must explicitly state no natural Omega / no OmegaRecord"
    )


# ---------------------------------------------------------------------------
# 5 — MD includes both commit 11 surrogate verdict and commit 12 real verdict
# ---------------------------------------------------------------------------


def test_05_md_includes_both_verdicts(md_text: str) -> None:
    assert "ISOLATED_RULE_OBSERVED_NO_OMEGA_CREATED" in md_text, (
        "MD must reference commit 11 surrogate verdict"
    )
    assert "REAL_FCE_NO_COAGULATION" in md_text, (
        "MD must reference commit 12 real-FCE verdict"
    )


# ---------------------------------------------------------------------------
# 6 — MD includes theta_s = 0.28 and tau_coag = 12, marked unchanged
# ---------------------------------------------------------------------------


def test_06_md_includes_operator_locked_thresholds(md_text: str) -> None:
    assert "theta_s" in md_text.lower() or "θ_s" in md_text or "theta_s" in md_text
    assert "0.28" in md_text
    assert "tau_coag" in md_text.lower() or "τ_coag" in md_text or "tau_coag" in md_text
    assert "12" in md_text


# ---------------------------------------------------------------------------
# 7 — MD does NOT use forbidden verdict tokens as standalone identifiers
# ---------------------------------------------------------------------------


def test_07_md_has_no_forbidden_verdict_tokens(md_text: str) -> None:
    found = _contains_forbidden_token(md_text)
    assert not found, (
        f"forbidden verdict token {found!r} appears as standalone identifier in MD"
    )


# ---------------------------------------------------------------------------
# 8 — MD names the next experiment
# ---------------------------------------------------------------------------


def test_08_md_names_next_experiment(md_text: str) -> None:
    assert "Semantic Vector Observation Adapter" in md_text, (
        "MD must name the next valid experiment (Semantic Vector "
        "Observation Adapter)"
    )


# ---------------------------------------------------------------------------
# 9 — MD lists every L3 gate (G1..G10)
# ---------------------------------------------------------------------------


def test_09_md_lists_all_l3_gates(md_text: str) -> None:
    for gid in _REQUIRED_L3_GATES:
        assert gid in md_text, f"MD missing gate id {gid!r}"


# ---------------------------------------------------------------------------
# 10 — JSON has every required top-level key
# ---------------------------------------------------------------------------


def test_10_json_has_all_required_keys(json_data: Dict[str, Any]) -> None:
    for key in _REQUIRED_JSON_KEYS:
        assert key in json_data, f"JSON missing key {key!r}"


# ---------------------------------------------------------------------------
# 11 — JSON disables every Level-3 / Omega claim
# ---------------------------------------------------------------------------


def test_11_json_disables_l3_and_omega_claims(json_data: Dict[str, Any]) -> None:
    assert json_data["level_3_declared"] is False
    assert json_data["natural_omega_proven"] is False
    assert json_data["reference_field_created"] is False
    assert json_data["production_loop_test_run"] is False
    assert json_data["claim_thresholds_are_wrong"] is False
    assert json_data["advisory_only"] is True
    assert json_data["theta_s"] == 0.28
    assert json_data["tau_coag"] == 12
    assert json_data["thresholds_unchanged_in_research_branch"] is True


# ---------------------------------------------------------------------------
# 12 — JSON L3 gate map covers every gate with operator-admitted status
# ---------------------------------------------------------------------------


def test_12_json_l3_gate_map_complete(json_data: Dict[str, Any]) -> None:
    gates = json_data["section_6_l3_gate_status_after_commit_12"]
    for gid in _REQUIRED_L3_GATES:
        assert gid in gates, f"JSON L3 gate map missing {gid!r}"
        entry = gates[gid]
        assert "status" in entry and entry["status"], (
            f"gate {gid} missing status"
        )
        assert "notes" in entry and entry["notes"], (
            f"gate {gid} missing notes"
        )
        status = entry["status"]
        # G10 carries the operator-locked compound status string.
        admitted_simple = {"PASS", "PARTIAL", "NOT_TESTED_YET", "FAIL"}
        admitted_compound_g10 = "PARTIAL / BLOCKED_BY_REAL_FCE_NO_COAGULATION"
        if gid == "L3-G10":
            assert status == admitted_compound_g10, (
                f"L3-G10 must carry operator-locked compound status, got {status!r}"
            )
        else:
            assert status in admitted_simple, (
                f"gate {gid}: invalid status {status!r}"
            )


# ---------------------------------------------------------------------------
# 13 — JSON final-conclusion headline matches operator-locked text
# ---------------------------------------------------------------------------


def test_13_json_final_conclusion_headline(json_data: Dict[str, Any]) -> None:
    expected = (
        "Positive research infrastructure; Level 3 not reached; next "
        "bottleneck is semantic assimilation fidelity I_t."
    )
    headline = json_data["section_7_final_conclusion"]["headline"]
    assert headline == expected, (
        f"final-conclusion headline must match operator-locked text;\n"
        f"got: {headline!r}\nexpected: {expected!r}"
    )


# ---------------------------------------------------------------------------
# 14 — JSON does NOT contain forbidden verdict tokens
# ---------------------------------------------------------------------------


def test_14_json_has_no_forbidden_verdict_tokens(json_data: Dict[str, Any]) -> None:
    serialized = json.dumps(json_data, ensure_ascii=False)
    found = _contains_forbidden_token(serialized)
    assert not found, (
        f"forbidden verdict token {found!r} appears in JSON"
    )


# ---------------------------------------------------------------------------
# 15 — This test module itself imports nothing from production / FCE-M /
#       harness / adapters / observation. Document-only by construction.
# ---------------------------------------------------------------------------


def test_15_test_module_is_document_only() -> None:
    """Open this test file and verify it imports NOTHING from production
    code, FCE-M vendor, the research harness, the coagulation observation
    runner, the FCE observation adapter, or any LLM / embedding library.

    This protects the operator constraint that the synthesis commit
    introduces no new experiments — only document validation.
    """
    src = Path(__file__).read_text(encoding="utf-8")
    forbidden_imports = (
        "byon_orchestrator",
        "byon-orchestrator",
        "unified_fragmergent_memory",
        "fce_omega",
        "harness",
        "coagulation_observation",
        "fce_observation_adapter",
        "anthropic",
        "openai",
        "torch",
        "sentence_transformers",
        "transformers",
    )
    # Match `import X` or `from X import ...` at the top of any line.
    for tok in forbidden_imports:
        # Allow the token appearing inside a string literal (we mention
        # several of these names in the docstring above) but NOT as an
        # import statement.
        import_patterns = (
            re.compile(r"^\s*import\s+" + re.escape(tok) + r"\b", re.MULTILINE),
            re.compile(r"^\s*from\s+" + re.escape(tok) + r"\b", re.MULTILINE),
        )
        for pat in import_patterns:
            assert not pat.search(src), (
                f"synthesis test module must not import {tok!r}; matched {pat.pattern!r}"
            )
