"""Tests for the deterministic summary policy v1.

Required test cases (operator-locked for commit 5):

   1. should_summarize false for buffer < 3 active events
   2. expression_pattern_stable produces SummaryEvent
   3. correction_chain produces SummaryEvent
   4. receipt_success_chain produces SummaryEvent
   5. unresolved adversarial_claim does NOT summarize
   6. unresolved contradiction does NOT summarize
   7. summary_text <= 280 chars
   8. source_event_ids non-empty and stable order
   9. no duplicate source_event_ids
  10. resolved_event_ids subset of source_event_ids
  11. archived_event_ids subset of source_event_ids
  12. tombstone required for every archived_event_id
  13. z_reduction > 0
  14. z_reduction <= sum source z_contribution
  15. deterministic: same buffer + same seed -> same SummaryEvent
  16. same buffer + different seed -> only summary_id /
      provenance.seed change; everything else stable
  17. summary policy version is deterministic_v1
  18. no LLM imports / no OpenAI / no Anthropic / no embeddings (AST)
  19. no Omega fields / no is_omega_anchor / no .register (AST)
  20. production imports forbidden (AST)
  21. integration smoke: build summary -> apply_summary -> z_total
      unchanged, z_active decreases, B_t increases
"""

from __future__ import annotations

import uuid
from typing import List, Optional

import pytest

from schemas import (
    CenterEventBuffer,
    EventKind,
    MemoryEvent,
    Perspective,
    ProvenanceRecord,
    ResolutionStatus,
    SummarisationPolicyVersion,
    SummaryEvent,
    TombstoneRef,
)
from summary_policy import (
    DeterministicSummaryPolicyV1,
    NoSummaryCandidate,
    POLICY_VERSION,
    REASON_CORRECTION,
    REASON_RECEIPT,
    REASON_STABLE_PATTERN,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _prov(turn_index: int = 0) -> ProvenanceRecord:
    return ProvenanceRecord(
        channel="harness",
        thread_id="research-thread-1",
        source="summary_policy_test",
        turn_index=turn_index,
        transcript_id="transcript_A_byon_arch",
        seed=42,
    )


def _ev(
    *,
    turn_index: int,
    kind: str = EventKind.ALIGNED.value,
    z_contribution: float = 0.2,
    center_id: str = "byon::macp_pipeline::factual",
    perspective: str = Perspective.FACTUAL.value,
    event_id: Optional[str] = None,
    text: Optional[str] = None,
) -> MemoryEvent:
    return MemoryEvent(
        event_id=event_id or f"ev-{turn_index:04d}-{uuid.uuid4().hex[:8]}",
        center_id=center_id,
        perspective=perspective,
        ts=f"2026-01-01T00:00:{turn_index:02d}.000000Z",
        kind=kind,
        text=text or f"event for turn {turn_index}",
        embedding=None,
        provenance=_prov(turn_index=turn_index),
        z_contribution=z_contribution,
    )


def _buffer(
    events: List[MemoryEvent],
    *,
    center_id: str = "byon::macp_pipeline::factual",
    perspective: str = Perspective.FACTUAL.value,
    max_events: int = 1024,
) -> CenterEventBuffer:
    buf = CenterEventBuffer(
        center_id=center_id,
        perspective=perspective,
        max_events=max_events,
    )
    for e in events:
        buf.append(e)
    return buf


# ---------------------------------------------------------------------------
# Required tests
# ---------------------------------------------------------------------------


def test_01_should_summarize_false_for_buffer_under_three_active() -> None:
    pol = DeterministicSummaryPolicyV1()
    buf = _buffer([_ev(turn_index=0), _ev(turn_index=1)])
    assert pol.should_summarize(buf) is False

    with pytest.raises(NoSummaryCandidate, match="at least 3 active events"):
        pol.build_summary(buf, summary_id_seed=42)


def test_02_expression_pattern_stable_produces_summary() -> None:
    pol = DeterministicSummaryPolicyV1()
    # 3 ALIGNED events on the same center, no tensions -> stable pattern
    buf = _buffer([
        _ev(turn_index=0, kind=EventKind.ALIGNED.value, z_contribution=0.2),
        _ev(turn_index=1, kind=EventKind.ALIGNED.value, z_contribution=0.2),
        _ev(turn_index=2, kind=EventKind.ALIGNED.value, z_contribution=0.2),
    ])
    assert pol.should_summarize(buf) is True

    se = pol.build_summary(buf, summary_id_seed=42)
    s = se.summary

    assert s.summary_text.startswith("stable expression pattern")
    assert len(s.source_event_ids) == 3
    # NEWEST event resolved; older 2 archived.
    assert len(s.resolved_event_ids) == 1
    assert len(s.archived_event_ids) == 2
    # Tombstone per archived id.
    assert len(se.tombstone_pointers) == 2
    for tomb in se.tombstone_pointers:
        assert tomb.reason == REASON_STABLE_PATTERN
        assert tomb.summary_id == s.summary_id


def test_03_correction_chain_produces_summary() -> None:
    pol = DeterministicSummaryPolicyV1()
    # ALIGNED, CONTESTED (plain contradiction z=0.8), ALIGNED (coherent
    # restatement = weak resolution OK).
    buf = _buffer([
        _ev(turn_index=0, kind=EventKind.ALIGNED.value, z_contribution=0.2),
        _ev(turn_index=1, kind=EventKind.CONTESTED.value, z_contribution=0.8),
        _ev(turn_index=2, kind=EventKind.ALIGNED.value, z_contribution=0.2),
    ])
    assert pol.should_summarize(buf) is True

    se = pol.build_summary(buf, summary_id_seed=42)
    s = se.summary
    assert s.summary_text.startswith("resolved correction chain")
    # All 3 events are in the chain.
    assert len(s.source_event_ids) == 3
    assert list(s.source_event_ids) == list(s.resolved_event_ids)
    assert list(s.archived_event_ids) == []   # correction_chain v1: nothing archived
    # No tombstones (no archived ids).
    assert len(se.tombstone_pointers) == 0


def test_04_receipt_success_chain_produces_summary() -> None:
    pol = DeterministicSummaryPolicyV1()
    # 3 events: 2 ALIGNED + 1 RECEIPT_SUCCESS at the end.
    buf = _buffer([
        _ev(turn_index=0, kind=EventKind.ALIGNED.value, z_contribution=0.2,
            center_id="byon::release_state::project_state",
            perspective=Perspective.PROJECT_STATE.value),
        _ev(turn_index=1, kind=EventKind.ALIGNED.value, z_contribution=0.2,
            center_id="byon::release_state::project_state",
            perspective=Perspective.PROJECT_STATE.value),
        _ev(turn_index=2, kind=EventKind.RECEIPT_SUCCESS.value, z_contribution=0.1,
            center_id="byon::release_state::project_state",
            perspective=Perspective.PROJECT_STATE.value),
    ], center_id="byon::release_state::project_state",
       perspective=Perspective.PROJECT_STATE.value)

    # Correction_chain detector won't fire (no tension event), so this
    # falls through to receipt_success_chain.
    assert pol.should_summarize(buf) is True
    se = pol.build_summary(buf, summary_id_seed=42)
    s = se.summary
    assert s.summary_text.startswith("stable receipt chain")
    assert len(s.source_event_ids) == 3
    assert list(s.source_event_ids) == list(s.resolved_event_ids)
    assert list(s.archived_event_ids) == []


def test_05_unresolved_adversarial_claim_does_not_summarize() -> None:
    pol = DeterministicSummaryPolicyV1()
    # Adversarial CONTESTED with z=1.0 followed by ALIGNED restatement
    # only (no CORRECTION or RECEIPT_SUCCESS). Adversarial requires
    # strong resolution -> refuse.
    buf = _buffer([
        _ev(turn_index=0, kind=EventKind.ALIGNED.value, z_contribution=0.2),
        _ev(turn_index=1, kind=EventKind.CONTESTED.value, z_contribution=1.0,
            text="adversarial claim_to_rule"),
        _ev(turn_index=2, kind=EventKind.ALIGNED.value, z_contribution=0.2),
        _ev(turn_index=3, kind=EventKind.ALIGNED.value, z_contribution=0.2),
    ])
    assert pol.should_summarize(buf) is False
    with pytest.raises(NoSummaryCandidate, match="adversarial"):
        pol.build_summary(buf, summary_id_seed=42)


def test_05b_adversarial_with_strong_resolution_summarizes() -> None:
    """Sanity flip-side of test 5: the SAME shape but with CORRECTION
    after the adversarial event DOES produce a correction_chain."""
    pol = DeterministicSummaryPolicyV1()
    buf = _buffer([
        _ev(turn_index=0, kind=EventKind.ALIGNED.value, z_contribution=0.2),
        _ev(turn_index=1, kind=EventKind.CONTESTED.value, z_contribution=1.0),
        _ev(turn_index=2, kind=EventKind.CORRECTION.value, z_contribution=0.15),
    ])
    assert pol.should_summarize(buf) is True
    se = pol.build_summary(buf, summary_id_seed=42)
    assert se.summary.summary_text.startswith("resolved correction chain")


def test_06_unresolved_contradiction_does_not_summarize() -> None:
    pol = DeterministicSummaryPolicyV1()
    # CONTESTED at the END of the buffer -> last is tension -> rejected.
    buf = _buffer([
        _ev(turn_index=0, kind=EventKind.ALIGNED.value, z_contribution=0.2),
        _ev(turn_index=1, kind=EventKind.ALIGNED.value, z_contribution=0.2),
        _ev(turn_index=2, kind=EventKind.CONTESTED.value, z_contribution=0.8),
    ])
    assert pol.should_summarize(buf) is False
    with pytest.raises(NoSummaryCandidate, match="unresolved tension"):
        pol.build_summary(buf, summary_id_seed=42)


def test_07_summary_text_under_280_chars() -> None:
    pol = DeterministicSummaryPolicyV1()
    buf = _buffer([_ev(turn_index=i) for i in range(5)])
    se = pol.build_summary(buf, summary_id_seed=42)
    assert len(se.summary.summary_text) <= 280


def test_08_source_event_ids_non_empty_and_stable_order() -> None:
    pol = DeterministicSummaryPolicyV1()
    events = [_ev(turn_index=i) for i in range(5)]
    buf = _buffer(events)
    se = pol.build_summary(buf, summary_id_seed=42)

    assert len(se.summary.source_event_ids) > 0
    # Stable insertion order — matches buffer iteration order.
    expected_order = [e.event_id for e in events]
    assert list(se.summary.source_event_ids) == expected_order


def test_09_no_duplicate_source_event_ids() -> None:
    pol = DeterministicSummaryPolicyV1()
    buf = _buffer([_ev(turn_index=i) for i in range(5)])
    se = pol.build_summary(buf, summary_id_seed=42)
    ids = list(se.summary.source_event_ids)
    assert len(ids) == len(set(ids))


def test_10_resolved_event_ids_subset_of_source_event_ids() -> None:
    pol = DeterministicSummaryPolicyV1()
    buf = _buffer([_ev(turn_index=i) for i in range(5)])
    se = pol.build_summary(buf, summary_id_seed=42)
    src = set(se.summary.source_event_ids)
    resolved = set(se.summary.resolved_event_ids)
    assert resolved.issubset(src)


def test_11_archived_event_ids_subset_of_source_event_ids() -> None:
    pol = DeterministicSummaryPolicyV1()
    # Use stable pattern (which DOES archive older ids).
    buf = _buffer([_ev(turn_index=i) for i in range(5)])
    se = pol.build_summary(buf, summary_id_seed=42)
    src = set(se.summary.source_event_ids)
    archived = set(se.summary.archived_event_ids)
    assert archived.issubset(src)
    # And specifically: ALL events except the NEWEST are archived.
    assert len(archived) == 4
    assert se.summary.source_event_ids[-1] not in archived


def test_12_tombstone_required_for_every_archived_event_id() -> None:
    """SummaryEvent.__post_init__ enforces this; we still verify the
    summary policy honours it."""
    pol = DeterministicSummaryPolicyV1()
    buf = _buffer([_ev(turn_index=i) for i in range(4)])   # stable pattern, 3 archived
    se = pol.build_summary(buf, summary_id_seed=42)

    archived_ids = set(se.summary.archived_event_ids)
    pointer_ids = {p.archived_event_id for p in se.tombstone_pointers}
    assert archived_ids == pointer_ids, (
        f"every archived id needs a tombstone; archived={archived_ids} "
        f"pointers={pointer_ids}"
    )
    # Each tombstone carries the full audit metadata.
    for tomb in se.tombstone_pointers:
        assert tomb.reason in {REASON_CORRECTION, REASON_RECEIPT, REASON_STABLE_PATTERN}
        assert tomb.summary_id == se.summary.summary_id
        assert tomb.archived_at_turn >= 0
        assert tuple(tomb.source_event_ids) == tuple(se.summary.source_event_ids)


def test_13_z_reduction_strictly_positive() -> None:
    pol = DeterministicSummaryPolicyV1()
    buf = _buffer([_ev(turn_index=i, z_contribution=0.2) for i in range(3)])
    se = pol.build_summary(buf, summary_id_seed=42)
    assert se.summary.z_reduction > 0.0


def test_14_z_reduction_le_sum_source_z_contribution() -> None:
    pol = DeterministicSummaryPolicyV1()
    events = [_ev(turn_index=i, z_contribution=0.2 + i * 0.1) for i in range(4)]
    buf = _buffer(events)
    se = pol.build_summary(buf, summary_id_seed=42)
    sum_z = sum(e.z_contribution for e in events)
    assert se.summary.z_reduction <= sum_z + 1e-9


def test_15_deterministic_same_buffer_same_seed() -> None:
    pol = DeterministicSummaryPolicyV1()
    events = [_ev(turn_index=i) for i in range(5)]
    buf_a = _buffer(events)
    buf_b = _buffer(events)
    se_a = pol.build_summary(buf_a, summary_id_seed=42)
    se_b = pol.build_summary(buf_b, summary_id_seed=42)

    s_a, s_b = se_a.summary, se_b.summary
    assert s_a.summary_id == s_b.summary_id
    assert s_a.summary_text == s_b.summary_text
    assert list(s_a.source_event_ids) == list(s_b.source_event_ids)
    assert list(s_a.resolved_event_ids) == list(s_b.resolved_event_ids)
    assert list(s_a.archived_event_ids) == list(s_b.archived_event_ids)
    assert s_a.z_reduction == pytest.approx(s_b.z_reduction)
    # Tombstones round-trip identically.
    assert len(se_a.tombstone_pointers) == len(se_b.tombstone_pointers)
    for ta, tb in zip(se_a.tombstone_pointers, se_b.tombstone_pointers):
        assert ta == tb


def test_16_different_seed_changes_only_id_and_provenance_seed() -> None:
    pol = DeterministicSummaryPolicyV1()
    events = [_ev(turn_index=i) for i in range(5)]
    buf_a = _buffer(events)
    buf_b = _buffer(events)
    se_a = pol.build_summary(buf_a, summary_id_seed=42)
    se_b = pol.build_summary(buf_b, summary_id_seed=1337)

    s_a, s_b = se_a.summary, se_b.summary
    # IDs differ.
    assert s_a.summary_id != s_b.summary_id
    # Content identical (modulo the seed in provenance).
    assert s_a.summary_text == s_b.summary_text
    assert list(s_a.source_event_ids) == list(s_b.source_event_ids)
    assert list(s_a.resolved_event_ids) == list(s_b.resolved_event_ids)
    assert list(s_a.archived_event_ids) == list(s_b.archived_event_ids)
    assert s_a.z_reduction == pytest.approx(s_b.z_reduction)
    assert s_a.center_id == s_b.center_id
    assert s_a.perspective == s_b.perspective
    # provenance.seed reflects the new run seed.
    assert s_a.provenance.seed == 42
    assert s_b.provenance.seed == 1337


def test_17_summary_policy_version_is_deterministic_v1() -> None:
    pol = DeterministicSummaryPolicyV1()
    assert pol.POLICY_VERSION == "deterministic_v1"
    assert POLICY_VERSION == SummarisationPolicyVersion.DETERMINISTIC_V1.value
    assert POLICY_VERSION == "deterministic_v1"

    buf = _buffer([_ev(turn_index=i) for i in range(3)])
    se = pol.build_summary(buf, summary_id_seed=42)
    assert se.summary.provenance.policy_version == "deterministic_v1"


def test_18_no_llm_or_embeddings_imports() -> None:
    """AST check: the policy must not import any LLM or embedding library."""
    import ast
    import inspect
    import summary_policy.deterministic_v1 as dv

    tree = ast.parse(inspect.getsource(dv))
    seen = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                seen.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            seen.append(node.module or "")

    forbidden = (
        "openai",
        "anthropic",
        "torch",
        "tensorflow",
        "sentence_transformers",
        "sentence-transformers",
        "transformers",
        "faiss",
        "numpy",          # research v1 stays pure-stdlib; numpy might be ok in future commits
        "embedding",
    )
    for mod in seen:
        low = (mod or "").lower()
        for fp in forbidden:
            assert not low.startswith(fp.lower()), (
                f"deterministic_v1.py imports forbidden module {mod!r}"
            )


def test_19_no_omega_or_check_coagulation_or_register() -> None:
    """AST check: no Omega creation, no check_coagulation, no .register()."""
    import ast
    import inspect
    import summary_policy.deterministic_v1 as dv

    src = inspect.getsource(dv)
    tree = ast.parse(src)

    # 1. Forbidden imports.
    forbidden_imports = (
        "check_coagulation",
        "OmegaRegistry",
        "omega_registry",
        "fce_omega_observer",
        "register_omega",
    )
    seen = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                seen.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            seen.append(node.module or "")
            for alias in node.names:
                seen.append(alias.name)
    for mod in seen:
        low = (mod or "").lower()
        for fp in forbidden_imports:
            assert fp.lower() not in low, (
                f"deterministic_v1.py imports forbidden token {mod!r}"
            )

    # 2. No `.register(...)` calls.
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            f = node.func
            if isinstance(f, ast.Attribute) and f.attr == "register":
                pytest.fail(
                    "deterministic_v1.py contains a .register(...) call; "
                    "OmegaRegistry writes are forbidden in research code"
                )

    # 3. No `is_omega_anchor` or `OmegaRecord` references as Python names.
    forbidden_names = ("is_omega_anchor", "omega_anchor", "OmegaRecord", "ReferenceField")
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            for fn in forbidden_names:
                assert fn != node.id, (
                    f"deterministic_v1.py references forbidden name {fn!r}"
                )


def test_20_production_imports_forbidden() -> None:
    """AST check: no imports from byon-orchestrator production paths."""
    import ast
    import inspect
    import summary_policy.deterministic_v1 as dv

    tree = ast.parse(inspect.getsource(dv))

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
    )
    seen = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                seen.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            seen.append(node.module or "")
    for mod in seen:
        low = (mod or "").lower()
        for fp in forbidden_prefixes:
            assert not low.startswith(fp.lower()), (
                f"deterministic_v1.py imports forbidden module {mod!r}"
            )
    # Sanity: DOES import from schemas.
    assert any(m == "schemas" or m.startswith("schemas.") for m in seen)


def test_21_integration_smoke_summary_drives_z_runtime() -> None:
    """End-to-end smoke: build a buffer, apply events to z_runtime, build a
    summary from the buffer, apply the summary to z_runtime. Verify:
      - z_total UNCHANGED
      - z_active DECREASES
      - B_t INCREASES
    """
    from z_metabolism import ZMetabolismRuntime

    pol = DeterministicSummaryPolicyV1()
    rt = ZMetabolismRuntime()

    events = [
        _ev(turn_index=0, z_contribution=0.2),
        _ev(turn_index=1, z_contribution=0.2),
        _ev(turn_index=2, z_contribution=0.2),
        _ev(turn_index=3, z_contribution=0.2),
    ]
    buf = _buffer(events)

    # Apply each event to z runtime.
    for e in events:
        rt.apply_event(e)

    before = rt.counters_for("byon::macp_pipeline::factual", Perspective.FACTUAL)
    bt_before = rt.b_t("byon::macp_pipeline::factual", Perspective.FACTUAL)
    assert before.z_total == pytest.approx(0.8)
    assert before.z_active == pytest.approx(0.8)
    assert before.z_resolved == 0.0
    assert before.z_archived == 0.0

    # Build summary and apply it.
    se = pol.build_summary(buf, summary_id_seed=42)
    rt.apply_summary(se)

    after = rt.counters_for("byon::macp_pipeline::factual", Perspective.FACTUAL)
    bt_after = rt.b_t("byon::macp_pipeline::factual", Perspective.FACTUAL)

    # z_total UNCHANGED.
    assert after.z_total == pytest.approx(before.z_total)
    # z_active DECREASED.
    assert after.z_active < before.z_active
    # B_t INCREASED.
    assert bt_after > bt_before
    # Invariant holds.
    assert after.conservation_holds()
    # Mass is conserved across active -> resolved/archived buckets.
    delta = before.z_active - after.z_active
    assert delta > 0
    assert (after.z_resolved + after.z_archived) == pytest.approx(
        before.z_resolved + before.z_archived + delta
    )


# ---------------------------------------------------------------------------
# Extras
# ---------------------------------------------------------------------------


def test_extra_mixed_center_id_rejected() -> None:
    """Trying to summarize a buffer whose events are on a different
    center_id than the buffer is rejected. This is defensive; the buffer
    itself rejects this at append time, but the policy double-checks."""
    pol = DeterministicSummaryPolicyV1()
    buf = CenterEventBuffer(center_id="byon::A::factual", perspective=Perspective.FACTUAL.value)
    # Bypass the buffer's normal append check by inserting via from_snapshot
    snap = buf.snapshot()
    snap["events"] = [
        {
            "event_id": "x1", "center_id": "byon::A::factual", "perspective": "factual",
            "ts": "2026-01-01T00:00:00.000000Z", "kind": "aligned",
            "text": "", "embedding": None,
            "provenance": {
                "channel": "h", "thread_id": "t", "source": "s",
                "turn_index": 0, "transcript_id": "tr", "seed": 42,
            },
            "z_contribution": 0.2,
            "resolution_status": "unresolved",
            "resolved_by_summary_id": None,
            "archived_at_ts": None,
            "archive_path": None,
            "tags": [],
        },
    ]
    # Add a second event on a DIFFERENT center_id by force.
    snap["events"].append(dict(snap["events"][0]))
    snap["events"][1]["event_id"] = "x2"
    snap["events"][1]["center_id"] = "byon::B::factual"   # mismatch
    snap["events"].append(dict(snap["events"][0]))
    snap["events"][2]["event_id"] = "x3"

    # from_snapshot rebuilds the buffer with no validation on cross-center
    # events because it trusts the snapshot.
    rebuilt = CenterEventBuffer.from_snapshot(snap)
    assert pol.should_summarize(rebuilt) is False
    with pytest.raises(NoSummaryCandidate, match="mixed center_id"):
        pol.build_summary(rebuilt, summary_id_seed=42)


def test_extra_missing_provenance_rejected() -> None:
    """An event without provenance must cause the policy to refuse."""
    pol = DeterministicSummaryPolicyV1()
    buf = CenterEventBuffer(center_id="byon::A::factual", perspective=Perspective.FACTUAL.value)
    # Sidestep buffer-level validation by from_snapshot.
    snap = buf.snapshot()
    snap["events"] = [
        {
            "event_id": f"x{i}", "center_id": "byon::A::factual", "perspective": "factual",
            "ts": f"2026-01-01T00:00:{i:02d}.000000Z", "kind": "aligned",
            "text": "", "embedding": None,
            "provenance": None,                          # MISSING
            "z_contribution": 0.2,
            "resolution_status": "unresolved",
            "resolved_by_summary_id": None,
            "archived_at_ts": None, "archive_path": None,
            "tags": [],
        }
        for i in range(3)
    ]
    rebuilt = CenterEventBuffer.from_snapshot(snap)
    assert pol.should_summarize(rebuilt) is False
    with pytest.raises(NoSummaryCandidate, match="provenance"):
        pol.build_summary(rebuilt, summary_id_seed=42)


def test_extra_summary_id_uuid_shape() -> None:
    """summary_id is 36 chars, UUID-shaped 8-4-4-4-12 hex."""
    import re
    pol = DeterministicSummaryPolicyV1()
    buf = _buffer([_ev(turn_index=i) for i in range(3)])
    se = pol.build_summary(buf, summary_id_seed=42)
    assert re.fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        se.summary.summary_id,
    )


def test_extra_correction_chain_takes_priority_over_stable() -> None:
    """When a buffer would fit BOTH correction_chain AND another pattern,
    correction_chain wins (priority A).
    """
    pol = DeterministicSummaryPolicyV1()
    buf = _buffer([
        _ev(turn_index=0, kind=EventKind.ALIGNED.value, z_contribution=0.2),
        _ev(turn_index=1, kind=EventKind.CONTESTED.value, z_contribution=0.8),
        _ev(turn_index=2, kind=EventKind.CORRECTION.value, z_contribution=0.15),
        _ev(turn_index=3, kind=EventKind.RECEIPT_SUCCESS.value, z_contribution=0.1),
    ])
    se = pol.build_summary(buf, summary_id_seed=42)
    assert se.summary.summary_text.startswith("resolved correction chain")


def test_extra_returns_none_pattern_when_only_one_kind_short() -> None:
    """A buffer of 2 ALIGNED is too short -> should_summarize False."""
    pol = DeterministicSummaryPolicyV1()
    buf = _buffer([_ev(turn_index=0), _ev(turn_index=1)])
    assert pol.should_summarize(buf) is False
