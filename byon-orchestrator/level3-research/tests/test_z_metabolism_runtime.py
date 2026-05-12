"""Tests for the Z metabolism runtime.

Required test cases (operator-locked for commit 4):

  01. apply_event increases Z_total and Z_active equally
  02. Z_resolved / Z_archived unchanged after event
  03. invariant holds after single event
  04. invariant holds after multiple events
  05. b_t uses Z_active only
  06. apply_summary reduces Z_active but preserves Z_total
  07. apply_summary moves mass into Z_resolved / Z_archived
  08. apply_summary clamps if z_reduction > Z_active
  09. clamp is logged in audit
  10. duplicate event_id rejected
  11. duplicate summary_id rejected
  12. snapshot / from_snapshot exact
  13. bad snapshot invariant rejected
  14. bad schema_version rejected
  15. duplicate ids in snapshot rejected
  16. separate centers isolated
  17. separate perspectives isolated
  18. audit log contains before/after
  19. no Omega fields / no check_coagulation / no registry import
  20. production imports forbidden

Plus a few extras (b_t increases after summary; resolved-only split;
archive-only split; negative / nan / inf z rejected; counters_for
admits Perspective enum + string; from_snapshot rejects mismatched
counter key).
"""

from __future__ import annotations

import math
import uuid
from typing import Any, Dict, List, Optional

import pytest

from schemas import (
    EventKind,
    MemoryEvent,
    Perspective,
    PERSPECTIVES_V1,
    ProvenanceRecord,
    ResolutionStatus,
    RollingCenterSummary,
    SummarisationPolicyVersion,
    SummaryEvent,
    SummaryProvenance,
    TombstoneRef,
    ZCounters,
)
from z_metabolism import SCHEMA_VERSION, ZMetabolismRuntime


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _provenance(turn_index: int = 0) -> ProvenanceRecord:
    return ProvenanceRecord(
        channel="harness",
        thread_id="research-thread-1",
        source="z_metabolism_test",
        turn_index=turn_index,
        transcript_id="transcript_A_byon_arch",
        seed=42,
    )


def _event(
    *,
    z_contribution: float,
    center_id: str = "byon::macp_pipeline::factual",
    perspective: str = Perspective.FACTUAL.value,
    kind: str = EventKind.ALIGNED.value,
    turn_index: int = 0,
    event_id: Optional[str] = None,
) -> MemoryEvent:
    return MemoryEvent(
        event_id=event_id or str(uuid.uuid4()),
        center_id=center_id,
        perspective=perspective,
        ts=f"2026-01-01T00:00:{turn_index:02d}.000000Z",
        kind=kind,
        text=f"event for turn {turn_index}",
        embedding=None,
        provenance=_provenance(turn_index=turn_index),
        z_contribution=z_contribution,
        resolution_status=ResolutionStatus.UNRESOLVED.value,
    )


def _summary(
    *,
    z_reduction: float,
    center_id: str = "byon::macp_pipeline::factual",
    perspective: str = Perspective.FACTUAL.value,
    source_event_ids: Optional[List[str]] = None,
    resolved_event_ids: Optional[List[str]] = None,
    archived_event_ids: Optional[List[str]] = None,
    summary_id: Optional[str] = None,
    produced_at_turn: int = 5,
) -> SummaryEvent:
    src = source_event_ids or ["e-src-1"]
    rcs = RollingCenterSummary(
        summary_id=summary_id or str(uuid.uuid4()),
        center_id=center_id,
        perspective=perspective,
        summary_text="test rolling summary",
        source_event_ids=src,
        resolved_event_ids=list(resolved_event_ids or src),
        archived_event_ids=list(archived_event_ids or []),
        z_reduction=z_reduction,
        provenance=SummaryProvenance(
            policy_version=SummarisationPolicyVersion.DETERMINISTIC_V1.value,
            parent_summary_id=None,
            produced_at_ts=f"2026-01-01T00:00:{produced_at_turn:02d}.000000Z",
            produced_at_turn=produced_at_turn,
            transcript_id="transcript_A_byon_arch",
            seed=42,
        ),
    )
    tombstones = [
        TombstoneRef(
            archived_event_id=aid,
            archived_at_ts=f"2026-01-01T00:00:{produced_at_turn:02d}.000000Z",
            recovery_path=f"/tmp/archive/{aid}.json",
        )
        for aid in (archived_event_ids or [])
    ]
    return SummaryEvent(summary=rcs, tombstone_pointers=tombstones)


# ---------------------------------------------------------------------------
# Required tests (1–20)
# ---------------------------------------------------------------------------


def test_01_apply_event_increases_z_total_and_z_active_equally() -> None:
    rt = ZMetabolismRuntime()
    ev = _event(z_contribution=0.5)
    c = rt.apply_event(ev)

    assert c.z_total == pytest.approx(0.5)
    assert c.z_active == pytest.approx(0.5)
    # Equal increase: both rose by exactly z_contribution.
    assert c.z_total == c.z_active


def test_02_apply_event_does_not_touch_resolved_or_archived() -> None:
    rt = ZMetabolismRuntime()
    ev = _event(z_contribution=0.5)
    c = rt.apply_event(ev)

    assert c.z_resolved == 0.0
    assert c.z_archived == 0.0


def test_03_invariant_holds_after_single_event() -> None:
    rt = ZMetabolismRuntime()
    c = rt.apply_event(_event(z_contribution=0.42))
    assert c.conservation_holds()


def test_04_invariant_holds_after_multiple_events() -> None:
    rt = ZMetabolismRuntime()
    for i in range(10):
        c = rt.apply_event(_event(z_contribution=0.1 * (i + 1), turn_index=i))
        assert c.conservation_holds(), (
            f"invariant broken after event {i}: {c}"
        )
    final = rt.counters_for("byon::macp_pipeline::factual", Perspective.FACTUAL)
    # Sum of 0.1 + 0.2 + ... + 1.0 = 5.5
    assert final.z_total == pytest.approx(5.5)
    assert final.z_active == pytest.approx(5.5)
    assert final.z_resolved == 0.0
    assert final.z_archived == 0.0


def test_05_b_t_uses_z_active_only() -> None:
    """b_t = 1 / (1 + z_active). After a summary moves mass out of z_active,
    b_t MUST rise, because z_total stays the same."""
    rt = ZMetabolismRuntime()
    rt.apply_event(_event(z_contribution=0.5, event_id="e1"))

    before = rt.b_t("byon::macp_pipeline::factual", Perspective.FACTUAL)
    assert before == pytest.approx(1.0 / 1.5, abs=1e-9)

    # Summary reduces 0.3 of z_active. z_total stays at 0.5.
    rt.apply_summary(
        _summary(
            z_reduction=0.3,
            source_event_ids=["e1"],
            resolved_event_ids=["e1"],
            archived_event_ids=[],
        )
    )
    after = rt.b_t("byon::macp_pipeline::factual", Perspective.FACTUAL)
    # z_active = 0.2 -> b_t = 1/1.2
    assert after == pytest.approx(1.0 / 1.2, abs=1e-9)
    assert after > before, "b_t must rise because z_active dropped"

    # And z_total really is unchanged (the proof that b_t uses z_active).
    c = rt.counters_for("byon::macp_pipeline::factual", Perspective.FACTUAL)
    assert c.z_total == pytest.approx(0.5)


def test_06_apply_summary_reduces_z_active_preserves_z_total() -> None:
    rt = ZMetabolismRuntime()
    rt.apply_event(_event(z_contribution=0.5, event_id="e1"))

    before = rt.counters_for("byon::macp_pipeline::factual", Perspective.FACTUAL)
    assert before.z_total == pytest.approx(0.5)
    assert before.z_active == pytest.approx(0.5)

    rt.apply_summary(
        _summary(
            z_reduction=0.2,
            source_event_ids=["e1"],
            resolved_event_ids=["e1"],
        )
    )
    after = rt.counters_for("byon::macp_pipeline::factual", Perspective.FACTUAL)
    # z_total unchanged. z_active dropped by 0.2.
    assert after.z_total == pytest.approx(0.5)
    assert after.z_active == pytest.approx(0.3)
    assert after.conservation_holds()


def test_07_apply_summary_moves_mass_into_resolved_and_archived() -> None:
    rt = ZMetabolismRuntime()
    rt.apply_event(_event(z_contribution=1.0, event_id="e1"))

    # Summary: source_event_ids=[e1, e2, e3, e4]; resolved=[e1, e2, e3];
    # archived=[e1]. So archived_count = 1, resolved_only_count = 2.
    # z_reduction = 0.6 => effective = 0.6.
    # archived_share = 0.6 * (1/3) = 0.2
    # resolved_share = 0.6 - 0.2 = 0.4
    rt.apply_summary(
        _summary(
            z_reduction=0.6,
            source_event_ids=["e1", "e2", "e3", "e4"],
            resolved_event_ids=["e1", "e2", "e3"],
            archived_event_ids=["e1"],
        )
    )
    c = rt.counters_for("byon::macp_pipeline::factual", Perspective.FACTUAL)
    assert c.z_total == pytest.approx(1.0)
    assert c.z_active == pytest.approx(0.4)
    assert c.z_resolved == pytest.approx(0.4)
    assert c.z_archived == pytest.approx(0.2)
    assert c.conservation_holds()


def test_08_apply_summary_clamps_when_z_reduction_exceeds_z_active() -> None:
    rt = ZMetabolismRuntime()
    rt.apply_event(_event(z_contribution=0.5, event_id="e1"))

    # z_reduction=1.0 but z_active is only 0.5 — clamp to 0.5.
    rt.apply_summary(
        _summary(
            z_reduction=1.0,
            source_event_ids=["e1"],
            resolved_event_ids=["e1"],
        )
    )
    c = rt.counters_for("byon::macp_pipeline::factual", Perspective.FACTUAL)
    # z_active dropped to 0; the 0.5 went to z_resolved (resolved-only).
    assert c.z_total == pytest.approx(0.5)
    assert c.z_active == pytest.approx(0.0)
    assert c.z_resolved == pytest.approx(0.5)
    assert c.z_archived == 0.0
    assert c.conservation_holds()


def test_09_clamp_is_logged_in_audit() -> None:
    rt = ZMetabolismRuntime()
    rt.apply_event(_event(z_contribution=0.5, event_id="e1"))
    rt.apply_summary(
        _summary(
            z_reduction=1.0,
            source_event_ids=["e1"],
            resolved_event_ids=["e1"],
            summary_id="s-clamp",
        )
    )

    log = rt.audit_log()
    last = log[-1]
    assert last["operation_type"] == "apply_summary"
    assert last["summary_id"] == "s-clamp"
    assert last["clamped"] is True
    assert last["requested_reduction"] == pytest.approx(1.0)
    assert last["effective_reduction"] == pytest.approx(0.5)


def test_10_duplicate_event_id_rejected() -> None:
    rt = ZMetabolismRuntime()
    ev = _event(z_contribution=0.4, event_id="e-dup")
    rt.apply_event(ev)
    with pytest.raises(ValueError, match="duplicate event_id"):
        rt.apply_event(ev)

    # Counters must be UNCHANGED by the rejected duplicate.
    c = rt.counters_for("byon::macp_pipeline::factual", Perspective.FACTUAL)
    assert c.z_total == pytest.approx(0.4)
    assert c.z_active == pytest.approx(0.4)


def test_11_duplicate_summary_id_rejected() -> None:
    rt = ZMetabolismRuntime()
    rt.apply_event(_event(z_contribution=0.5, event_id="e1"))
    rt.apply_summary(
        _summary(
            z_reduction=0.1,
            source_event_ids=["e1"],
            resolved_event_ids=["e1"],
            summary_id="s-dup",
        )
    )
    with pytest.raises(ValueError, match="duplicate summary_id"):
        rt.apply_summary(
            _summary(
                z_reduction=0.1,
                source_event_ids=["e1"],
                resolved_event_ids=["e1"],
                summary_id="s-dup",
            )
        )
    # Counters must reflect ONE application only.
    c = rt.counters_for("byon::macp_pipeline::factual", Perspective.FACTUAL)
    assert c.z_total == pytest.approx(0.5)
    assert c.z_active == pytest.approx(0.4)
    assert c.z_resolved == pytest.approx(0.1)


def test_12_snapshot_from_snapshot_exact_roundtrip() -> None:
    rt = ZMetabolismRuntime()
    # Mixed history across multiple buckets.
    rt.apply_event(_event(z_contribution=0.5, event_id="e1",
                          center_id="byon::macp_pipeline::factual",
                          perspective=Perspective.FACTUAL.value))
    rt.apply_event(_event(z_contribution=0.3, event_id="e2",
                          center_id="byon::release_state::project_state",
                          perspective=Perspective.PROJECT_STATE.value,
                          turn_index=1))
    rt.apply_summary(
        _summary(
            z_reduction=0.2,
            source_event_ids=["e1"],
            resolved_event_ids=["e1"],
            summary_id="s1",
        )
    )

    snap = rt.snapshot()

    import json
    reserialised = json.loads(json.dumps(snap))   # confirms JSON-friendly
    rebuilt = ZMetabolismRuntime.from_snapshot(reserialised)

    # Counters must match bucket-by-bucket.
    a_key = "byon::macp_pipeline::factual"
    b_key = "byon::release_state::project_state"
    a_orig = rt.counters_for(a_key, Perspective.FACTUAL)
    a_rebuilt = rebuilt.counters_for(a_key, Perspective.FACTUAL)
    b_orig = rt.counters_for(b_key, Perspective.PROJECT_STATE)
    b_rebuilt = rebuilt.counters_for(b_key, Perspective.PROJECT_STATE)
    assert a_orig == a_rebuilt
    assert b_orig == b_rebuilt

    # Applied id sets match.
    assert rebuilt.applied_event_ids == rt.applied_event_ids
    assert rebuilt.applied_summary_ids == rt.applied_summary_ids

    # Audit log length matches.
    assert len(rebuilt.audit_log()) == len(rt.audit_log())


def test_13_bad_snapshot_invariant_rejected() -> None:
    """A snapshot whose counter violates conservation must be rejected by
    from_snapshot (the ZCounters constructor raises)."""
    snap = {
        "schema_version": SCHEMA_VERSION,
        "counters": {
            "byon::macp_pipeline::factual": {
                "center_id": "byon::macp_pipeline::factual",
                "perspective": Perspective.FACTUAL.value,
                "z_total": 10.0,    # violates: 1+2+3 != 10
                "z_active": 1.0,
                "z_resolved": 2.0,
                "z_archived": 3.0,
                "last_updated_at_turn": 0,
                "last_updated_at_ts": "",
            },
        },
        "applied_event_ids": [],
        "applied_summary_ids": [],
        "audit_log": [],
    }
    with pytest.raises(ValueError, match="conservation invariant"):
        ZMetabolismRuntime.from_snapshot(snap)


def test_14_bad_schema_version_rejected() -> None:
    snap = {
        "schema_version": "level3-research.z_runtime.vXXX",
        "counters": {},
        "applied_event_ids": [],
        "applied_summary_ids": [],
        "audit_log": [],
    }
    with pytest.raises(ValueError, match="unknown schema_version"):
        ZMetabolismRuntime.from_snapshot(snap)


def test_15_duplicate_ids_in_snapshot_rejected() -> None:
    # Duplicate event_id.
    snap1 = {
        "schema_version": SCHEMA_VERSION,
        "counters": {},
        "applied_event_ids": ["e1", "e1", "e2"],
        "applied_summary_ids": [],
        "audit_log": [],
    }
    with pytest.raises(ValueError, match="duplicate applied_event_ids"):
        ZMetabolismRuntime.from_snapshot(snap1)

    # Duplicate summary_id.
    snap2 = {
        "schema_version": SCHEMA_VERSION,
        "counters": {},
        "applied_event_ids": [],
        "applied_summary_ids": ["s1", "s1"],
        "audit_log": [],
    }
    with pytest.raises(ValueError, match="duplicate applied_summary_ids"):
        ZMetabolismRuntime.from_snapshot(snap2)


def test_16_separate_centers_are_isolated() -> None:
    rt = ZMetabolismRuntime()
    rt.apply_event(_event(z_contribution=0.5, event_id="e1",
                          center_id="byon::macp_pipeline::factual",
                          perspective=Perspective.FACTUAL.value))
    rt.apply_event(_event(z_contribution=0.7, event_id="e2",
                          center_id="byon::fce_m::factual",
                          perspective=Perspective.FACTUAL.value,
                          turn_index=1))

    a = rt.counters_for("byon::macp_pipeline::factual", Perspective.FACTUAL)
    b = rt.counters_for("byon::fce_m::factual", Perspective.FACTUAL)
    assert a.z_total == pytest.approx(0.5)
    assert b.z_total == pytest.approx(0.7)
    assert a.z_active == pytest.approx(0.5)
    assert b.z_active == pytest.approx(0.7)
    # Distinct ZCounters objects.
    assert a is not b


def test_17_separate_perspectives_are_isolated() -> None:
    rt = ZMetabolismRuntime()
    # Same center_id base but TWO different perspectives -> two buckets.
    rt.apply_event(_event(z_contribution=0.5, event_id="e1",
                          center_id="byon::executor_air_gap::security_boundary",
                          perspective=Perspective.SECURITY_BOUNDARY.value))
    rt.apply_event(_event(z_contribution=0.2, event_id="e2",
                          center_id="byon::executor_air_gap::factual",
                          perspective=Perspective.FACTUAL.value,
                          turn_index=1))

    a = rt.counters_for("byon::executor_air_gap::security_boundary",
                        Perspective.SECURITY_BOUNDARY)
    b = rt.counters_for("byon::executor_air_gap::factual",
                        Perspective.FACTUAL)
    assert a.z_total == pytest.approx(0.5)
    assert b.z_total == pytest.approx(0.2)
    # Different keys.
    assert a.perspective != b.perspective


def test_18_audit_log_contains_before_and_after() -> None:
    rt = ZMetabolismRuntime()
    rt.apply_event(_event(z_contribution=0.5, event_id="e1"))
    rt.apply_summary(
        _summary(
            z_reduction=0.3,
            source_event_ids=["e1"],
            resolved_event_ids=["e1"],
            summary_id="s1",
        )
    )
    log = rt.audit_log()
    assert len(log) == 2

    for entry in log:
        # Every entry has the mandated keys.
        assert "operation_id" in entry
        assert "operation_type" in entry
        assert entry["operation_type"] in {"apply_event", "apply_summary"}
        assert "center_id" in entry
        assert "perspective" in entry
        assert "z_before" in entry and isinstance(entry["z_before"], dict)
        assert "z_after" in entry and isinstance(entry["z_after"], dict)
        for d in (entry["z_before"], entry["z_after"]):
            for k in ("z_total", "z_active", "z_resolved", "z_archived"):
                assert k in d
        assert "clamped" in entry
        assert "invariant_ok" in entry
        assert entry["invariant_ok"] is True

    # First entry is the event, second the summary.
    assert log[0]["operation_type"] == "apply_event"
    assert log[0]["source_event_id"] == "e1"
    assert log[0]["summary_id"] is None
    assert log[1]["operation_type"] == "apply_summary"
    assert log[1]["summary_id"] == "s1"
    assert log[1]["source_event_id"] is None


def test_19_no_omega_fields_no_check_coagulation_no_registry() -> None:
    """Static check: the runtime source must not contain Omega creation
    or check_coagulation references in NAMES (imports, attribute access).
    Prose / docstrings that mention these terms for documentation are
    allowed — the AST check below verifies imports and the runtime
    behaviour."""
    import ast
    import inspect
    import z_metabolism.runtime as rm

    src = inspect.getsource(rm)
    tree = ast.parse(src)

    # 1. No import of Omega-related names or check_coagulation.
    forbidden_import_substrings = (
        "check_coagulation",
        "OmegaRegistry",
        "omega_registry",
        "fce_omega_observer",
        "register_omega",
    )
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                for fp in forbidden_import_substrings:
                    assert fp.lower() not in alias.name.lower(), (
                        f"forbidden import {alias.name!r}"
                    )
        elif isinstance(node, ast.ImportFrom):
            mod = (node.module or "").lower()
            for fp in forbidden_import_substrings:
                assert fp.lower() not in mod, (
                    f"forbidden import from {mod!r}"
                )
            for alias in node.names:
                for fp in forbidden_import_substrings:
                    assert fp.lower() not in alias.name.lower(), (
                        f"forbidden imported name {alias.name!r} from {mod!r}"
                    )

    # 2. No attribute access of the form `*.register(...)` (the registry
    # write path). Calls to `replace`, `replace()`, etc. are fine because
    # they don't touch any Omega registry.
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            f = node.func
            if isinstance(f, ast.Attribute) and f.attr == "register":
                # If we ever see "<something>.register(...)" it must NOT
                # be on a registry-shaped object.
                # The runtime has no `register` calls at all, so any
                # match here is a regression.
                pytest.fail(
                    "z_metabolism.runtime contains a .register(...) call; "
                    "OmegaRegistry writes are forbidden in research code"
                )

    # 3. No literal `is_omega_anchor`, `OmegaRecord`, or `ReferenceField`
    # field names in the runtime's own data structures.
    forbidden_names = ("is_omega_anchor", "omega_anchor", "OmegaRecord", "ReferenceField")
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            for fn in forbidden_names:
                assert fn != node.id, (
                    f"z_metabolism.runtime references forbidden name {fn!r}"
                )


def test_20_production_imports_forbidden() -> None:
    """AST-based check: the runtime source must not import from any
    byon-orchestrator production path."""
    import ast
    import inspect
    import z_metabolism.runtime as rm

    src = inspect.getsource(rm)
    tree = ast.parse(src)

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
                f"runtime.py imports forbidden module {mod!r}"
            )

    # Sanity: it DOES import from `schemas`.
    assert any(m == "schemas" or m.startswith("schemas.") for m in seen)


# ---------------------------------------------------------------------------
# Extras
# ---------------------------------------------------------------------------


def test_extra_b_t_increases_after_summary() -> None:
    """Tighter statement: b_t strictly increases when a summary moves any
    positive mass out of z_active."""
    rt = ZMetabolismRuntime()
    rt.apply_event(_event(z_contribution=0.5, event_id="e1"))
    b0 = rt.b_t("byon::macp_pipeline::factual", Perspective.FACTUAL)
    rt.apply_summary(_summary(
        z_reduction=0.25,
        source_event_ids=["e1"],
        resolved_event_ids=["e1"],
        summary_id="s-bt",
    ))
    b1 = rt.b_t("byon::macp_pipeline::factual", Perspective.FACTUAL)
    assert b1 > b0


def test_extra_resolved_only_split() -> None:
    """A summary whose archived_event_ids is empty puts all reduction in
    z_resolved."""
    rt = ZMetabolismRuntime()
    rt.apply_event(_event(z_contribution=0.5, event_id="e1"))
    rt.apply_summary(_summary(
        z_reduction=0.3,
        source_event_ids=["e1"],
        resolved_event_ids=["e1"],
        archived_event_ids=[],
        summary_id="s-resolved-only",
    ))
    c = rt.counters_for("byon::macp_pipeline::factual", Perspective.FACTUAL)
    assert c.z_resolved == pytest.approx(0.3)
    assert c.z_archived == 0.0


def test_extra_archived_only_split() -> None:
    """A summary whose resolved_event_ids equals archived_event_ids (so
    resolved-only count is 0) puts all reduction in z_archived."""
    rt = ZMetabolismRuntime()
    rt.apply_event(_event(z_contribution=0.5, event_id="e1"))
    rt.apply_summary(_summary(
        z_reduction=0.3,
        source_event_ids=["e1"],
        resolved_event_ids=["e1"],
        archived_event_ids=["e1"],
        summary_id="s-archive-only",
    ))
    c = rt.counters_for("byon::macp_pipeline::factual", Perspective.FACTUAL)
    assert c.z_resolved == 0.0
    assert c.z_archived == pytest.approx(0.3)


def test_extra_negative_or_nan_or_inf_z_rejected_on_event() -> None:
    rt = ZMetabolismRuntime()
    # Negative.
    bad = _event(z_contribution=-0.1, event_id="bad-neg")
    with pytest.raises(ValueError, match=">= 0"):
        rt.apply_event(bad)
    # NaN.
    nan = _event(z_contribution=math.nan, event_id="bad-nan")
    with pytest.raises(ValueError, match="finite"):
        rt.apply_event(nan)
    # Inf.
    inf = _event(z_contribution=math.inf, event_id="bad-inf")
    with pytest.raises(ValueError, match="finite"):
        rt.apply_event(inf)
    # Nothing accumulated.
    c = rt.counters_for("byon::macp_pipeline::factual", Perspective.FACTUAL)
    assert c.z_total == 0.0


def test_extra_counters_for_admits_perspective_enum_and_string() -> None:
    rt = ZMetabolismRuntime()
    rt.apply_event(_event(z_contribution=0.1, event_id="e1"))
    a = rt.counters_for("byon::macp_pipeline::factual", Perspective.FACTUAL)
    b = rt.counters_for("byon::macp_pipeline::factual", "factual")
    assert a is b   # same bucket key resolution

    with pytest.raises(ValueError):
        rt.counters_for("byon::x::y", "preference")   # not admitted in v1
    with pytest.raises(TypeError):
        rt.counters_for("byon::x::y", 42)             # wrong type


def test_extra_from_snapshot_rejects_mismatched_counter_key() -> None:
    """If the snapshot's bucket key does not equal `<center_id>::<perspective>`
    derived from the counter, from_snapshot must reject."""
    snap = {
        "schema_version": SCHEMA_VERSION,
        "counters": {
            # Key claims one center, counter says another.
            "byon::macp_pipeline::factual": {
                "center_id": "byon::OTHER::factual",
                "perspective": Perspective.FACTUAL.value,
                "z_total": 0.0,
                "z_active": 0.0,
                "z_resolved": 0.0,
                "z_archived": 0.0,
                "last_updated_at_turn": 0,
                "last_updated_at_ts": "",
            },
        },
        "applied_event_ids": [],
        "applied_summary_ids": [],
        "audit_log": [],
    }
    with pytest.raises(ValueError, match="key mismatch"):
        ZMetabolismRuntime.from_snapshot(snap)


def test_extra_b_t_default_for_fresh_bucket() -> None:
    """For an unseen bucket, counters_for lazy-inits to zero and b_t = 1.0."""
    rt = ZMetabolismRuntime()
    bt = rt.b_t("byon::unseen::factual", Perspective.FACTUAL)
    assert bt == pytest.approx(1.0)
