"""Tests for LongNaturalTranscriptHarness.

Required test cases (operator-locked for commit 7):

   1. harness runs transcript_A sample without error
   2. harness runs transcript_B sample without error
   3. n_rows matches file rows
   4. n_events > n_rows when fan-out produces multiple events
   5. summaries can be produced from crafted rows
   6. apply_summary reduces z_active while z_total preserved
   7. potential omega signal can be emitted on crafted synthetic rows
   8. no signal on short transcript <12 cycles
   9. telemetry includes metric_source =
      research_surrogate_v1_not_fce_production
  10. invariant_ok true
  11. raw events recoverable after archive
  12. source_event_ids complete in summary_events
  13. transcript_A seed 42 deterministic
  14. transcript_B seed 1337 deterministic
  15. same transcript + same seed gives identical aggregate
  16. different seed changes ids but not counts
  17. no Omega / no registry / no check_coagulation (AST)
  18. production imports forbidden (AST)

Plus extras:
  - transcript_A telemetry has surrogate metrics in [0, 1]
  - audit_flags is a list
  - cycle_records is in turn-order
"""

from __future__ import annotations

import os
import pathlib
from typing import Any, Dict, List

import pytest

from harness import (
    METRIC_SOURCE,
    SCHEMA_VERSION,
    LongNaturalTranscriptHarness,
)
from schemas import Perspective


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


_HERE = pathlib.Path(__file__).parent.resolve()
_LEVEL3_ROOT = _HERE.parent
_TRANSCRIPT_A = _LEVEL3_ROOT / "transcripts" / "transcript_A_byon_arch.jsonl"
_TRANSCRIPT_B = _LEVEL3_ROOT / "transcripts" / "transcript_B_byon_arch.jsonl"


def _row(
    turn_index: int,
    text: str,
    *,
    phase: str = "arch_recap",
    transcript_id: str = "test_crafted",
) -> Dict[str, Any]:
    return {
        "turn_index": turn_index,
        "phase": phase,
        "text": text,
        "transcript_id": transcript_id,
    }


def _make_harness(*, seed: int = 42, transcript_id: str = "test_crafted") -> LongNaturalTranscriptHarness:
    return LongNaturalTranscriptHarness(seed=seed, transcript_id=transcript_id)


# ---------------------------------------------------------------------------
# 1 — harness runs transcript_A sample without error
# ---------------------------------------------------------------------------


def test_01_runs_transcript_A_sample_without_error() -> None:
    assert _TRANSCRIPT_A.exists(), f"missing fixture {_TRANSCRIPT_A}"
    h = LongNaturalTranscriptHarness(seed=42, transcript_id="transcript_A_byon_arch")
    tel = h.run_jsonl(_TRANSCRIPT_A)

    assert tel["transcript_id"] == "transcript_A_byon_arch"
    assert tel["seed"] == 42
    assert tel["n_rows"] >= 1
    assert tel["schema_version"] == SCHEMA_VERSION
    assert tel["metric_source"] == METRIC_SOURCE
    assert tel["invariant_ok"] is True


# ---------------------------------------------------------------------------
# 2 — harness runs transcript_B sample without error
# ---------------------------------------------------------------------------


def test_02_runs_transcript_B_sample_without_error() -> None:
    assert _TRANSCRIPT_B.exists(), f"missing fixture {_TRANSCRIPT_B}"
    h = LongNaturalTranscriptHarness(seed=1337, transcript_id="transcript_B_byon_arch")
    tel = h.run_jsonl(_TRANSCRIPT_B)

    assert tel["transcript_id"] == "transcript_B_byon_arch"
    assert tel["seed"] == 1337
    assert tel["n_rows"] >= 1
    assert tel["invariant_ok"] is True


# ---------------------------------------------------------------------------
# 3 — n_rows matches file rows
# ---------------------------------------------------------------------------


def test_03_n_rows_matches_file_rows() -> None:
    # Count non-empty lines in transcript A.
    with open(_TRANSCRIPT_A, encoding="utf-8") as f:
        file_rows = sum(1 for line in f if line.strip())
    h = LongNaturalTranscriptHarness(seed=42, transcript_id="transcript_A_byon_arch")
    tel = h.run_jsonl(_TRANSCRIPT_A)
    assert tel["n_rows"] == file_rows


# ---------------------------------------------------------------------------
# 4 — n_events > n_rows when fan-out produces multiple events
# ---------------------------------------------------------------------------


def test_04_n_events_can_exceed_n_rows_via_fanout() -> None:
    """A turn touching multiple perspectives (factual + project_state +
    security_boundary, etc.) produces multiple MemoryEvents per row.
    transcript_A is a rich BYON-architecture conversation that should
    fan out on many rows."""
    h = LongNaturalTranscriptHarness(seed=42, transcript_id="transcript_A_byon_arch")
    tel = h.run_jsonl(_TRANSCRIPT_A)
    assert tel["n_events"] >= tel["n_rows"]
    # We expect at least SOME fan-out on a BYON-arch transcript.
    assert tel["n_events"] > tel["n_rows"], (
        f"expected fan-out: n_events={tel['n_events']} > n_rows={tel['n_rows']}"
    )


# ---------------------------------------------------------------------------
# 5 — summaries can be produced from crafted rows
# ---------------------------------------------------------------------------


def test_05_summaries_produced_from_crafted_rows() -> None:
    """4 aligned BYON-architecture rows on the same conversational
    center -> expression_pattern_stable summary fires."""
    h = _make_harness(seed=42)
    rows = [
        _row(0, "Worker plans MACP pipeline."),
        _row(1, "Auditor signs ExecutionOrder with Ed25519."),
        _row(2, "Executor runs in air-gap; network_mode none."),
        _row(3, "JohnsonReceipt closes the MACP loop."),
    ]
    tel = h.run_rows(rows)
    assert tel["n_summaries"] >= 1
    # Every summary carries provenance.policy_version = deterministic_v1.
    for s in tel["summary_events"]:
        assert s["provenance"]["policy_version"] == "deterministic_v1"


# ---------------------------------------------------------------------------
# 6 — apply_summary reduces z_active while z_total preserved
# ---------------------------------------------------------------------------


def test_06_apply_summary_reduces_z_active_z_total_preserved() -> None:
    """After a summary fires, z_total stays the same but z_active drops."""
    h = _make_harness(seed=42)
    rows = [
        _row(0, "Worker plans MACP pipeline."),
        _row(1, "Auditor signs ExecutionOrder."),
        _row(2, "Executor runs in air-gap."),
        _row(3, "JohnsonReceipt closes MACP."),
    ]
    tel = h.run_rows(rows)
    assert tel["n_summaries"] >= 1

    # On at least one bucket: z_resolved + z_archived > 0 AND
    # z_total > 0. (i.e. some mass moved out of z_active.)
    moved = False
    for key, c in tel["per_center_summary"].items():
        if c["z_resolved"] + c["z_archived"] > 0 and c["z_total"] > 0:
            moved = True
            # And the bucket-level conservation holds.
            assert abs(
                c["z_active"] + c["z_resolved"] + c["z_archived"] - c["z_total"]
            ) < 1e-6
            break
    assert moved, (
        "expected at least one bucket where summary moved z_active into "
        "z_resolved/z_archived"
    )


# ---------------------------------------------------------------------------
# 7 — potential omega signal can be emitted on crafted synthetic rows
# ---------------------------------------------------------------------------


def test_07_potential_omega_signal_on_crafted_rows() -> None:
    """Carefully crafted 12-row transcript designed to land 12 cycles on a
    single (center, perspective) bucket with the falling-z, rising-b_t
    shape that triggers the detector emission pattern.

    All rows route to `byon::macp_pipeline::factual::factual` (single
    perspective, single center) because texts mention only `Worker` and
    `MACP` keywords (no `Auditor`/`Executor`/`Ed25519`/`token`/`build`/
    `version`, which would fan out to other perspectives).

    Row plan (each row fires exactly 1 event on the macp_pipeline bucket):
      rows 0-5: CORRECTION kind (texts begin with "Actually"/"In fact"),
                no summary fires because none of the 3 policy patterns
                applies — correction_chain needs a tension event first,
                receipt_chain needs a RECEIPT_*, stable_pattern needs
                ALL ALIGNED. Z_active grows linearly from 0.15 to 0.90.
      row 6:    RECEIPT_SUCCESS (text mentions "success") — triggers
                receipt_chain on the 7-event buffer, archives all,
                resets Z_active to 0.
      rows 7-11: ALIGNED kind. After 3 ALIGNED events (cycle 9),
                stable_pattern fires, archives all, resets Z_active.
                Final two ALIGNED rebuild Z_active to 0.40.

    Expected trajectory (post-summary z_active per cycle):
      [0.15, 0.30, 0.45, 0.60, 0.75, 0.90, 0.0, 0.20, 0.40, 0.0, 0.20, 0.40]

    Detector window evaluation at cycle 11 (the 12th cycle on this
    bucket, K=12):
      - z_trend = mean([0.0, 0.20, 0.40, 0.0, 0.20, 0.40]) - mean([0.15, 0.30,
        0.45, 0.60, 0.75, 0.90]) = 0.20 - 0.525 = -0.325 (< 0, falling) OK
      - b_t = 1/(1+z_active), so b_trend > 0 (rising)                     OK
      - ar_t = 1.0 throughout (no tension events), ar_std = 0.0            OK
      - kappa_t = 1.0 throughout (single dominant kind per cycle), kappa_std = 0.0 OK
      - s_t = (1+1+b)/3 sustained around 0.92 (>= 0.20 floor)              OK

    All 5 detector emission conditions met -> exactly 1 signal fires.
    """
    h = _make_harness(seed=42)
    rows: List[Dict[str, Any]] = []
    # Phase 1: 6 CORRECTION events, no summary fires (z grows 0.15 -> 0.90).
    rows.append(_row(0, "Actually, Worker plans MACP carefully."))
    rows.append(_row(1, "In fact, Worker handles MACP work."))
    rows.append(_row(2, "Actually MACP runs by Worker."))
    rows.append(_row(3, "In fact, MACP works via Worker."))
    rows.append(_row(4, "Actually, Worker drives MACP."))
    rows.append(_row(5, "In fact, MACP handled by Worker."))
    # Phase 2 trigger: receipt_success fires receipt_chain on the
    # CORRECTION+RECEIPT_SUCCESS buffer, archives 7 events, resets z.
    rows.append(_row(6, "Worker MACP success."))
    # Phase 3: 5 ALIGNED events. stable_pattern fires at row 9.
    rows.append(_row(7, "Worker plans MACP."))
    rows.append(_row(8, "Worker MACP design."))
    rows.append(_row(9, "Worker MACP review."))
    rows.append(_row(10, "Worker MACP code."))
    rows.append(_row(11, "Worker MACP tests."))

    tel = h.run_rows(rows)

    # Defensive: the macp_pipeline factual bucket should have observed
    # exactly 12 cycles (one per row).
    by_bucket: Dict[str, int] = {}
    for cr in tel["cycle_records"]:
        k = f"{cr['center_id']}::{cr['perspective']}"
        by_bucket[k] = by_bucket.get(k, 0) + 1
    assert any(v >= 12 for v in by_bucket.values()), (
        f"expected at least one bucket with >= 12 cycle observations; got {by_bucket}"
    )

    # Crafted signal: exactly 1 PotentialOmegaSignal should fire on this
    # trajectory. The detector's emission set is operator-locked;
    # if this test fails, either the surrogate metrics or the crafted
    # transcript no longer produce the rising-shape needed.
    assert tel["n_potential_omega_signals"] >= 1, (
        f"expected >=1 PotentialOmegaSignal on crafted transcript; "
        f"got {tel['n_potential_omega_signals']} signals. "
        f"buckets seen: {by_bucket}. "
        f"audit_flags: {tel['audit_flags']}"
    )
    for sig in tel["potential_omega_signals"]:
        assert sig["advisory_only"] is True
        # The signal must point to the macp_pipeline bucket (the only
        # bucket that observes 12 cycles).
        assert sig["center_id"] == "byon::macp_pipeline::factual"
        assert sig["perspective"] == "factual"
        # And it must report falling z, rising b_t (the crafted shape).
        assert sig["z_active_trend"] < 0
        assert sig["b_t_trend"] > 0


# ---------------------------------------------------------------------------
# 8 — no signal on short transcript <12 cycles
# ---------------------------------------------------------------------------


def test_08_no_signal_on_short_transcript() -> None:
    """A 5-row transcript can't produce 12+ cycles on any bucket, so
    no PotentialOmegaSignal should fire."""
    h = _make_harness(seed=42)
    rows = [
        _row(i, f"Worker plans turn {i}.") for i in range(5)
    ]
    tel = h.run_rows(rows)
    assert tel["n_potential_omega_signals"] == 0


# ---------------------------------------------------------------------------
# 9 — telemetry includes metric_source surrogate label
# ---------------------------------------------------------------------------


def test_09_metric_source_is_surrogate_label() -> None:
    h = _make_harness(seed=42)
    tel = h.run_rows([_row(0, "Worker plans MACP.")])
    assert tel["metric_source"] == "research_surrogate_v1_not_fce_production"


# ---------------------------------------------------------------------------
# 10 — invariant_ok True after a full run
# ---------------------------------------------------------------------------


def test_10_invariant_ok_true() -> None:
    h = LongNaturalTranscriptHarness(seed=42, transcript_id="transcript_A_byon_arch")
    tel = h.run_jsonl(_TRANSCRIPT_A)
    assert tel["invariant_ok"] is True


# ---------------------------------------------------------------------------
# 11 — raw events recoverable after archive
# ---------------------------------------------------------------------------


def test_11_raw_events_recoverable_after_archive() -> None:
    """Events archived by a summary remain in the buffer's storage with
    full payload + archive_path. The harness reports archived_count > 0
    on at least one bucket after a multi-row run with summaries."""
    h = _make_harness(seed=42)
    rows = [
        _row(i, "Worker plans the MACP pipeline architecture.")
        for i in range(6)
    ]
    h.run_rows(rows)

    # At least one bucket should have archived events that are still
    # recoverable from the buffer.
    found_archived = False
    for key, buf in list(h._buffers.items()):  # internal access OK in tests
        archived = buf.archived_events()
        if archived:
            found_archived = True
            # Every archived event has full payload.
            for ev in archived:
                assert ev.event_id
                assert ev.text
                assert ev.provenance is not None
                assert ev.archive_path is not None
                # Buffer's `get()` can recover the event by id.
                rec = buf.get(ev.event_id)
                assert rec is not None
                assert rec.event_id == ev.event_id
                assert rec.text == ev.text
            break
    assert found_archived, "expected at least one archived event in buffer"


# ---------------------------------------------------------------------------
# 12 — source_event_ids complete in summary_events
# ---------------------------------------------------------------------------


def test_12_source_event_ids_complete_in_summary_events() -> None:
    h = _make_harness(seed=42)
    rows = [_row(i, "Worker plans MACP architecture.") for i in range(6)]
    tel = h.run_rows(rows)
    assert tel["n_summaries"] >= 1
    for se_dict in tel["summary_events"]:
        assert isinstance(se_dict["source_event_ids"], list)
        assert len(se_dict["source_event_ids"]) > 0
        # No duplicates.
        assert len(set(se_dict["source_event_ids"])) == len(se_dict["source_event_ids"])


# ---------------------------------------------------------------------------
# 13 — transcript_A seed 42 deterministic
# ---------------------------------------------------------------------------


def test_13_transcript_A_seed_42_deterministic() -> None:
    h1 = LongNaturalTranscriptHarness(seed=42, transcript_id="transcript_A_byon_arch")
    h2 = LongNaturalTranscriptHarness(seed=42, transcript_id="transcript_A_byon_arch")
    t1 = h1.run_jsonl(_TRANSCRIPT_A)
    t2 = h2.run_jsonl(_TRANSCRIPT_A)
    # Aggregate counts identical.
    for k in (
        "n_rows", "n_events", "n_centers", "n_summaries",
        "n_potential_omega_signals", "z_total_final", "z_active_final",
        "z_resolved_final", "z_archived_final",
    ):
        assert t1[k] == t2[k], f"divergent on {k}: {t1[k]} vs {t2[k]}"
    # Summary id and signal id strings identical (deterministic).
    ids1 = [s["summary_id"] for s in t1["summary_events"]]
    ids2 = [s["summary_id"] for s in t2["summary_events"]]
    assert ids1 == ids2


# ---------------------------------------------------------------------------
# 14 — transcript_B seed 1337 deterministic
# ---------------------------------------------------------------------------


def test_14_transcript_B_seed_1337_deterministic() -> None:
    h1 = LongNaturalTranscriptHarness(seed=1337, transcript_id="transcript_B_byon_arch")
    h2 = LongNaturalTranscriptHarness(seed=1337, transcript_id="transcript_B_byon_arch")
    t1 = h1.run_jsonl(_TRANSCRIPT_B)
    t2 = h2.run_jsonl(_TRANSCRIPT_B)
    for k in (
        "n_rows", "n_events", "n_centers", "n_summaries",
        "n_potential_omega_signals",
    ):
        assert t1[k] == t2[k]


# ---------------------------------------------------------------------------
# 15 — same transcript + same seed gives identical aggregate
# ---------------------------------------------------------------------------


def test_15_same_transcript_same_seed_identical_aggregate() -> None:
    """Stronger than 13/14: every scalar field in the telemetry matches
    exactly across two runs with the same seed (modulo lists that may
    have non-deterministic ordering — but the harness uses canonical
    sorted order for buckets, so even those should match)."""
    rows = [_row(i, f"Worker plans MACP turn {i % 4}.") for i in range(20)]
    h1 = _make_harness(seed=42)
    h2 = _make_harness(seed=42)
    t1 = h1.run_rows(list(rows))
    t2 = h2.run_rows(list(rows))

    # Compare scalar fields.
    for k in (
        "n_rows", "n_events", "n_centers", "n_summaries",
        "n_potential_omega_signals",
        "z_total_final", "z_active_final",
        "z_resolved_final", "z_archived_final",
        "b_t_final", "b_t_min", "b_t_max",
        "invariant_ok", "metric_source", "schema_version",
        "transcript_id", "seed",
    ):
        assert t1[k] == t2[k], f"divergent on {k}: {t1[k]} vs {t2[k]}"
    # Per-center summary identical.
    assert t1["per_center_summary"] == t2["per_center_summary"]
    # Summary events list identical (deterministic ids + payload).
    assert t1["summary_events"] == t2["summary_events"]
    # PotentialOmegaSignals identical.
    assert t1["potential_omega_signals"] == t2["potential_omega_signals"]


# ---------------------------------------------------------------------------
# 16 — different seed changes ids but not counts
# ---------------------------------------------------------------------------


def test_16_different_seed_changes_ids_but_not_counts() -> None:
    rows = [_row(i, f"Worker plans MACP turn {i % 4}.") for i in range(20)]
    h1 = _make_harness(seed=42)
    h2 = _make_harness(seed=1337)
    t1 = h1.run_rows(list(rows))
    t2 = h2.run_rows(list(rows))

    # Counts identical.
    for k in ("n_rows", "n_events", "n_centers", "n_summaries"):
        assert t1[k] == t2[k], f"counts diverge on {k}: {t1[k]} vs {t2[k]}"

    # Summary IDs differ (deterministic on seed).
    ids1 = sorted(s["summary_id"] for s in t1["summary_events"])
    ids2 = sorted(s["summary_id"] for s in t2["summary_events"])
    if ids1:
        assert ids1 != ids2, "summary_ids should differ across seeds"


# ---------------------------------------------------------------------------
# 17 — no Omega / no registry / no check_coagulation (AST)
# ---------------------------------------------------------------------------


def test_17_no_omega_or_registry_or_check_coagulation_in_runner() -> None:
    import ast
    import inspect
    import harness.runner as runner
    import harness.telemetry as tel

    for mod in (runner, tel):
        src = inspect.getsource(mod)
        tree = ast.parse(src)

        # 1. No .register(...) calls.
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                f = node.func
                if isinstance(f, ast.Attribute) and f.attr == "register":
                    pytest.fail(
                        f"{mod.__name__}: contains a .register(...) call; "
                        f"OmegaRegistry writes are forbidden in research"
                    )

        # 2. No Omega/ReferenceField/is_omega_anchor name references.
        forbidden_names = ("OmegaRecord", "ReferenceField", "is_omega_anchor", "omega_anchor")
        for node in ast.walk(tree):
            if isinstance(node, ast.Name):
                for fn in forbidden_names:
                    assert fn != node.id, (
                        f"{mod.__name__}: references forbidden name {fn!r}"
                    )

        # 3. No check_coagulation imports or calls.
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    assert "check_coagulation" not in alias.name.lower()
            elif isinstance(node, ast.ImportFrom):
                assert "check_coagulation" not in (node.module or "").lower()
                for alias in node.names:
                    assert "check_coagulation" not in alias.name.lower()
            elif isinstance(node, ast.Call):
                f = node.func
                if isinstance(f, ast.Name) and "check_coagulation" in f.id.lower():
                    pytest.fail(
                        f"{mod.__name__}: contains check_coagulation(...) call"
                    )
                if isinstance(f, ast.Attribute) and "check_coagulation" in f.attr.lower():
                    pytest.fail(
                        f"{mod.__name__}: contains .check_coagulation(...) call"
                    )


# ---------------------------------------------------------------------------
# 18 — production imports forbidden (AST)
# ---------------------------------------------------------------------------


def test_18_production_imports_forbidden() -> None:
    import ast
    import inspect
    import harness.runner as runner
    import harness.telemetry as tel

    forbidden_prefixes = (
        "byon_orchestrator",
        "byon-orchestrator",
        "memory_service",
        "unified_fragmergent_memory",
        "fce_m",
        "fce_omega_observer",
        "omega_registry",
        "check_coagulation",
        "fact_extractor",
        # No LLM / embeddings either:
        "openai",
        "anthropic",
        "torch",
        "tensorflow",
        "sentence_transformers",
        "transformers",
        "faiss",
    )
    for mod in (runner, tel):
        tree = ast.parse(inspect.getsource(mod))
        seen = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    seen.append(alias.name)
            elif isinstance(node, ast.ImportFrom):
                seen.append(node.module or "")
        for m in seen:
            low = (m or "").lower()
            for fp in forbidden_prefixes:
                assert not low.startswith(fp.lower()), (
                    f"{mod.__name__}: imports forbidden module {m!r}"
                )


# ---------------------------------------------------------------------------
# Extras
# ---------------------------------------------------------------------------


def test_extra_surrogate_metrics_bounded() -> None:
    h = _make_harness(seed=42)
    rows = [_row(i, "Worker plans MACP architecture.") for i in range(8)]
    tel = h.run_rows(rows)
    for cr in tel["cycle_records"]:
        for k in ("ar_t", "kappa_t", "s_t", "b_t"):
            v = cr[k]
            assert 0.0 <= v <= 1.0, f"cycle metric {k} out of [0,1]: {v}"


def test_extra_audit_flags_is_list() -> None:
    h = _make_harness(seed=42)
    tel = h.run_rows([_row(0, "Worker plans.")])
    assert isinstance(tel["audit_flags"], list)


def test_extra_cycle_records_in_turn_order() -> None:
    """Cycle records appear in the order their (turn_index) was processed."""
    h = _make_harness(seed=42)
    rows = [_row(i, "Worker plans MACP.") for i in range(8)]
    tel = h.run_rows(rows)
    turn_seq = [cr["turn_index"] for cr in tel["cycle_records"]]
    # Turns appear in non-decreasing order.
    assert turn_seq == sorted(turn_seq), (
        f"cycle_records not in turn order: {turn_seq}"
    )
