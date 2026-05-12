"""Fixture validation for the Level 3 research transcripts.

Targets the hand-authored 500-turn Transcript A fixture
(`transcripts/transcript_A_byon_arch_500.jsonl`). Verifies schema,
phase boundaries, perspective coverage, adversarial / correction
density, receipt density, and that the deterministic harness can
replay it end-to-end without invariant violation.

These tests do NOT require any PotentialOmega signals to fire. They
validate the fixture as a research input, not as a coagulation
demonstration. The full Level 3 gate audit (L3-G1..L3-G10) is a
later commit.

Constraints honored by the fixture (verified here):

    * exactly 500 rows
    * turn_index 0..499 contiguous, strictly increasing
    * transcript_id constant across rows
    * required schema fields present
    * 5 phases x 100 rows
    * all 4 v1 perspectives represented
    * at least 20 adversarial/correction rows
    * at least 20 receipt rows
    * no empty text
    * deterministic harness can run first 50 rows
    * deterministic harness can run full 500 rows; invariant_ok=True
    * metric_source = "research_surrogate_v1_not_fce_production"
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List

import pytest


_HERE = Path(__file__).resolve().parent
_RESEARCH_ROOT = _HERE.parent
if str(_RESEARCH_ROOT) not in sys.path:
    sys.path.insert(0, str(_RESEARCH_ROOT))

from harness import LongNaturalTranscriptHarness, METRIC_SOURCE


TRANSCRIPT_A_500 = _RESEARCH_ROOT / "transcripts" / "transcript_A_byon_arch_500.jsonl"
EXPECTED_TRANSCRIPT_ID = "transcript_A_byon_arch_v1_500"
EXPECTED_PHASES = (
    "arch_recap",
    "trust_hierarchy",
    "contradictions",
    "receipts",
    "return_to_centers",
)
ADMITTED_PERSPECTIVES = frozenset({
    "factual",
    "project_state",
    "domain_verified",
    "security_boundary",
})


@pytest.fixture(scope="module")
def rows() -> List[Dict[str, Any]]:
    """Parse the JSONL once for all tests."""
    assert TRANSCRIPT_A_500.exists(), (
        f"transcript file missing: {TRANSCRIPT_A_500}"
    )
    out: List[Dict[str, Any]] = []
    with TRANSCRIPT_A_500.open("r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError as e:
                pytest.fail(f"bad JSON at line {line_num}: {e}")
    return out


# ---------------------------------------------------------------------------
# 1 — transcript exists
# ---------------------------------------------------------------------------


def test_01_transcript_a_500_exists() -> None:
    assert TRANSCRIPT_A_500.exists(), (
        f"Transcript A 500-turn fixture not found at {TRANSCRIPT_A_500}. "
        f"Run `python -m transcripts._build_transcript_A_500` first."
    )
    # Non-empty
    assert TRANSCRIPT_A_500.stat().st_size > 0


# ---------------------------------------------------------------------------
# 2 — exactly 500 rows
# ---------------------------------------------------------------------------


def test_02_exactly_500_rows(rows: List[Dict[str, Any]]) -> None:
    assert len(rows) == 500, f"expected 500 rows, got {len(rows)}"


# ---------------------------------------------------------------------------
# 3 — turn_index strictly increasing 0..499
# ---------------------------------------------------------------------------


def test_03_turn_index_strictly_increasing(rows: List[Dict[str, Any]]) -> None:
    indices = [r["turn_index"] for r in rows]
    assert indices == list(range(500)), (
        f"turn_index must be 0..499 contiguous; first 10: {indices[:10]}"
    )


# ---------------------------------------------------------------------------
# 4 — transcript_id constant
# ---------------------------------------------------------------------------


def test_04_transcript_id_constant(rows: List[Dict[str, Any]]) -> None:
    ids = {r["transcript_id"] for r in rows}
    assert ids == {EXPECTED_TRANSCRIPT_ID}, (
        f"transcript_id must be a single constant value; got {ids}"
    )


# ---------------------------------------------------------------------------
# 5 — required fields present on every row
# ---------------------------------------------------------------------------


REQUIRED_FIELDS = (
    "transcript_id",
    "turn_index",
    "phase",
    "speaker",
    "text",
    "expected_kind",
    "expected_perspective_hits",
    "intended_perspective",
)


def test_05_required_fields_present(rows: List[Dict[str, Any]]) -> None:
    for r in rows:
        for field in REQUIRED_FIELDS:
            assert field in r, (
                f"row {r.get('turn_index')!r} missing required field {field!r}"
            )


# ---------------------------------------------------------------------------
# 6 — all five phases represented, 100 rows each
# ---------------------------------------------------------------------------


def test_06_all_five_phases_100_rows_each(rows: List[Dict[str, Any]]) -> None:
    counts: Dict[str, int] = {}
    for r in rows:
        counts[r["phase"]] = counts.get(r["phase"], 0) + 1
    assert set(counts.keys()) == set(EXPECTED_PHASES), (
        f"expected phases {EXPECTED_PHASES}, got {sorted(counts.keys())}"
    )
    for phase in EXPECTED_PHASES:
        assert counts[phase] == 100, (
            f"phase {phase!r} must have exactly 100 rows, got {counts[phase]}"
        )


# Bonus: phase blocks are contiguous (turns 0-99 = arch_recap, etc.)


def test_06b_phase_blocks_contiguous(rows: List[Dict[str, Any]]) -> None:
    for i, phase in enumerate(EXPECTED_PHASES):
        block = rows[i * 100 : (i + 1) * 100]
        for r in block:
            assert r["phase"] == phase, (
                f"turn {r['turn_index']} in block {phase!r} has phase {r['phase']!r}"
            )


# ---------------------------------------------------------------------------
# 7 — at least 4 perspectives represented through metadata/intended_perspective
# ---------------------------------------------------------------------------


def test_07_four_perspectives_represented(rows: List[Dict[str, Any]]) -> None:
    primary = {r["intended_perspective"] for r in rows if r.get("intended_perspective")}
    primary.discard(None)
    assert primary >= ADMITTED_PERSPECTIVES, (
        f"expected all 4 v1 perspectives in intended_perspective field; "
        f"got {sorted(primary)}"
    )
    # Also confirm expected_perspective_hits stays within v1 set.
    for r in rows:
        for p in r["expected_perspective_hits"]:
            assert p in ADMITTED_PERSPECTIVES, (
                f"turn {r['turn_index']}: unknown perspective {p!r} "
                f"(must be one of {sorted(ADMITTED_PERSPECTIVES)})"
            )


# ---------------------------------------------------------------------------
# 8 — at least 20 adversarial / correction rows
# ---------------------------------------------------------------------------


def test_08_at_least_20_adversarial_or_correction(rows: List[Dict[str, Any]]) -> None:
    n_adv_or_corr = sum(
        1
        for r in rows
        if r["expected_kind"] in ("contested", "tensioned", "correction")
        or r.get("adversarial_expected") is True
    )
    assert n_adv_or_corr >= 20, (
        f"expected >=20 adversarial / correction / tensioned rows; "
        f"got {n_adv_or_corr}"
    )


# ---------------------------------------------------------------------------
# 9 — at least 20 receipt rows
# ---------------------------------------------------------------------------


def test_09_at_least_20_receipt_rows(rows: List[Dict[str, Any]]) -> None:
    n_receipts = sum(
        1
        for r in rows
        if r["expected_kind"].startswith("receipt_")
        or r.get("receipt_status") in ("success", "partial", "failure")
    )
    assert n_receipts >= 20, (
        f"expected >=20 receipt rows; got {n_receipts}"
    )


# ---------------------------------------------------------------------------
# 10 — no empty text
# ---------------------------------------------------------------------------


def test_10_no_empty_text(rows: List[Dict[str, Any]]) -> None:
    for r in rows:
        assert isinstance(r["text"], str), (
            f"turn {r['turn_index']}: text must be a string; got {type(r['text']).__name__}"
        )
        assert r["text"].strip(), (
            f"turn {r['turn_index']}: text is empty / whitespace-only"
        )


# ---------------------------------------------------------------------------
# 11 — deterministic harness can run the first 50 rows
# ---------------------------------------------------------------------------


def test_11_harness_runs_first_50_rows(rows: List[Dict[str, Any]]) -> None:
    h = LongNaturalTranscriptHarness(
        seed=42, transcript_id=EXPECTED_TRANSCRIPT_ID
    )
    tel = h.run_rows(rows[:50])
    assert tel["n_rows"] == 50
    assert tel["n_events"] >= 50  # may be higher via fan-out
    assert tel["invariant_ok"] is True
    assert tel["metric_source"] == METRIC_SOURCE
    # No audit flags expected on a 50-row replay.
    assert tel["audit_flags"] == []


# ---------------------------------------------------------------------------
# 12 — deterministic harness can run the full 500 rows without invariant violation
# ---------------------------------------------------------------------------


def test_12_harness_runs_full_500_rows_invariant_ok(rows: List[Dict[str, Any]]) -> None:
    h = LongNaturalTranscriptHarness(
        seed=42, transcript_id=EXPECTED_TRANSCRIPT_ID
    )
    tel = h.run_rows(rows)
    assert tel["n_rows"] == 500
    assert tel["invariant_ok"] is True, (
        f"invariant violation; audit_flags={tel['audit_flags']}"
    )
    # n_events should be larger than n_rows due to fan-out.
    assert tel["n_events"] >= 500
    # Conservation: z_total_final >= z_active+z_resolved+z_archived (equality
    # actually, since invariant_ok is True).
    z_sum = tel["z_active_final"] + tel["z_resolved_final"] + tel["z_archived_final"]
    assert abs(z_sum - tel["z_total_final"]) < 1e-9, (
        f"conservation violated: z_total={tel['z_total_final']:.6f}, "
        f"sum={z_sum:.6f}"
    )


# ---------------------------------------------------------------------------
# 13 — no PotentialOmega signal is required at fixture validation stage
# ---------------------------------------------------------------------------


def test_13_no_omega_signal_required(rows: List[Dict[str, Any]]) -> None:
    """The fixture must not REQUIRE any PotentialOmega signal to fire.

    If signals fire, they must all be advisory_only. If none fire, that
    is also acceptable at the fixture validation stage.
    """
    h = LongNaturalTranscriptHarness(
        seed=42, transcript_id=EXPECTED_TRANSCRIPT_ID
    )
    tel = h.run_rows(rows)
    # All signals (if any) must be advisory_only.
    for sig in tel["potential_omega_signals"]:
        assert sig["advisory_only"] is True, (
            f"signal {sig['signal_id']!r} is not advisory_only — "
            f"design constraint violated"
        )
    # Fixture stage: no positive lower bound on signal count.
    assert tel["n_potential_omega_signals"] >= 0


# ---------------------------------------------------------------------------
# 14 — metric_source remains "research_surrogate_v1_not_fce_production"
# ---------------------------------------------------------------------------


def test_14_metric_source_surrogate_label(rows: List[Dict[str, Any]]) -> None:
    h = LongNaturalTranscriptHarness(
        seed=42, transcript_id=EXPECTED_TRANSCRIPT_ID
    )
    tel = h.run_rows(rows[:30])
    assert tel["metric_source"] == "research_surrogate_v1_not_fce_production"
    assert METRIC_SOURCE == "research_surrogate_v1_not_fce_production"


# ---------------------------------------------------------------------------
# Extra — primary perspective distribution sanity (informational, lenient)
# ---------------------------------------------------------------------------


def test_extra_perspective_distribution_sanity(rows: List[Dict[str, Any]]) -> None:
    """Sanity: every admitted v1 perspective is the PRIMARY perspective of
    at least 30 rows (i.e. real coverage, not a single token row)."""
    primary_counts: Dict[str, int] = {p: 0 for p in ADMITTED_PERSPECTIVES}
    for r in rows:
        p = r.get("intended_perspective")
        if p in primary_counts:
            primary_counts[p] += 1
    for p, n in primary_counts.items():
        assert n >= 30, (
            f"perspective {p!r} is primary on only {n} rows (< 30); fixture "
            f"insufficient coverage. counts={primary_counts}"
        )
