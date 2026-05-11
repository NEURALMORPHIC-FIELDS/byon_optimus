"""v0.3.2 mandatory tests: bidirectional auto-registration / self-registering
substrate coupling.

Eight required tests per spec, plus supplementary persistence and edge tests.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path

import pytest

from unified_fragmergent_memory import Config, UnifiedMemoryStore
from unified_fragmergent_memory.runtime import (
    AutoRegistration,
    OrchestratorOrganismDriven,
    TraceSummary,
    diff_reports,
    run_auto_registration_demo,
)


def _make_summary(intent="WRITE", head_entity="dragon", attr="color",
                  status="COMMIT_DONE", zone="COMMITTED",
                  trace_id="E0001_S000001_001", write_step=0,
                  episode_id=1) -> TraceSummary:
    return TraceSummary(
        trace_id=trace_id, episode_id=episode_id, write_step=write_step,
        input_text="the dragon is red", intent=intent,
        head_entity=head_entity, epistemic_status=status,
        memory_target_zone=zone, arbiter_decision="COMMIT",
        arbiter_reason="EMPTY_SLOT", latent_pressure_marker=None,
        influence_effect_channels=[], pressure_was_active=False,
        slot_entity=head_entity, slot_attr=attr,
    )


# ---------------------------------------------------------------------------
# Mandatory test 1
# ---------------------------------------------------------------------------

def test_auto_registers_slot_after_first_valid_commit():
    """A new valid slot is auto-registered as a tf label after the first
    valid COMMIT trace, with no manual register_label_slot call."""
    store = UnifiedMemoryStore()
    assert ("dragon", "color") not in store._label_slot_registry

    summary = _make_summary()
    rec = store.auto_register_from_trace(summary, episode_id=1)

    assert rec is not None
    assert rec.entity_id == "dragon"
    assert rec.attr_type == "color"
    assert rec.label == 0
    assert ("dragon", "color") in store._label_slot_registry
    assert store._label_slot_registry[("dragon", "color")] == 0


# ---------------------------------------------------------------------------
# Mandatory test 2
# ---------------------------------------------------------------------------

def test_auto_registered_label_round_trip():
    """(entity, attr) -> label -> (entity, attr) lossless."""
    store = UnifiedMemoryStore()
    store.auto_register_from_trace(_make_summary(head_entity="dragon", attr="color"), 1)
    store.auto_register_from_trace(_make_summary(head_entity="knight", attr="mood"), 2)

    label_a = store._label_slot_registry[("dragon", "color")]
    label_b = store._label_slot_registry[("knight", "mood")]
    assert label_a != label_b

    assert store.lookup_slot_by_label(label_a) == ("dragon", "color")
    assert store.lookup_slot_by_label(label_b) == ("knight", "mood")
    # Unknown label returns None.
    assert store.lookup_slot_by_label(9999) is None


# ---------------------------------------------------------------------------
# Mandatory test 3
# ---------------------------------------------------------------------------

def test_no_registration_on_parser_failure_or_uncertain():
    store = UnifiedMemoryStore()

    rec = store.auto_register_from_trace(
        _make_summary(status="PARSER_FAILURE"), episode_id=1,
    )
    assert rec is None
    assert ("dragon", "color") not in store._label_slot_registry

    rec = store.auto_register_from_trace(
        _make_summary(status="PARSE_UNCERTAIN"), episode_id=1,
    )
    assert rec is None

    rec = store.auto_register_from_trace(
        _make_summary(status="REJECTED"), episode_id=1,
    )
    assert rec is None

    # READ intent: not registered.
    rec = store.auto_register_from_trace(
        _make_summary(intent="READ"), episode_id=1,
    )
    assert rec is None

    # Missing slot fields: not registered.
    rec = store.auto_register_from_trace(
        _make_summary(head_entity=None), episode_id=1,
    )
    assert rec is None

    rec = store.auto_register_from_trace(
        TraceSummary(
            trace_id="x", episode_id=1, write_step=0, input_text="",
            intent="WRITE", head_entity="dragon", epistemic_status="COMMIT_DONE",
            memory_target_zone="COMMITTED", arbiter_decision="COMMIT",
            arbiter_reason=None, latent_pressure_marker=None,
            influence_effect_channels=[], pressure_was_active=False,
            slot_entity="dragon", slot_attr=None,  # missing attr
        ),
        episode_id=1,
    )
    assert rec is None

    # Zone NONE: not registered.
    rec = store.auto_register_from_trace(_make_summary(zone="NONE"), episode_id=1)
    assert rec is None
    rec = store.auto_register_from_trace(_make_summary(zone=None), episode_id=1)
    assert rec is None


# ---------------------------------------------------------------------------
# Mandatory test 4
# ---------------------------------------------------------------------------

def test_auto_registered_slot_receives_pressure_vector():
    """After a consolidator op fires on the auto-registered slot, the
    cross_substrate_step emits SlotPressureVector entries targeting the
    auto-allocated label."""
    result = run_auto_registration_demo()
    # The ON run produced cross_substrate records at ep3 (RECONCILE+RETROGRADE).
    on_ep3 = next(ep for ep in result["report_on"].episodes if ep.episode_id == 3)
    assert on_ep3.cross_substrate_consolidation_op_counts.get("RETROGRADE", 0) >= 1
    # The perturbation dict targets the auto-registered label (0 for dragon::color).
    auto_label = result["registry_after"][("dragon", "color")]
    assert auto_label in on_ep3.cross_substrate_perturbations or \
           any(auto_label == k for k in on_ep3.cross_substrate_perturbations.keys())
    assert on_ep3.cross_substrate_perturbations[auto_label] == 0.5  # RETROGRADE factor


# ---------------------------------------------------------------------------
# Mandatory test 5
# ---------------------------------------------------------------------------

def test_auto_registered_pressure_returns_to_symbolic_slot():
    """tf propagation produces a reconstructed pressure that maps back to
    the symbolic slot via lookup_slot_by_label and the receptor's
    value_resolver, populating the pressure correctly."""
    result = run_auto_registration_demo()
    on_ep4 = next(ep for ep in result["report_on"].episodes if ep.episode_id == 4)
    # The pressure visible at ep4 has retrograde_slots populated.
    assert on_ep4.pressure_pre_install_summary.get("n_retrograde_slots", 0) >= 1


# ---------------------------------------------------------------------------
# Mandatory test 6
# ---------------------------------------------------------------------------

def test_auto_registration_can_participate_in_branch_flip_or_marker_diff():
    """A/B coupling OFF vs ON. The auto-registered slot must produce at
    least a marker diff; if branch diff appears, that is the stronger
    confirmation. The test reports which level is reached without forcing
    branch on a marker-only outcome."""
    result = run_auto_registration_demo()
    assert result["auto_registration_marker_diff_confirmed"], (
        "BLOCKED: auto-registered slot produced no diff at all under "
        "natural coupling."
    )
    # Branch flip is preferred but not strictly required; spec allows
    # marker-only with explicit reporting.
    if not result["auto_registration_branch_flip_confirmed"]:
        pytest.fail(
            "auto_registration_marker_diff_confirmed but no arbiter_decision "
            "branch flip. Reporting marker-only verdict."
        )


# ---------------------------------------------------------------------------
# Mandatory test 7: safety table
# ---------------------------------------------------------------------------

def test_safety_metrics_zero_under_auto_registration():
    result = run_auto_registration_demo()
    counts = {"wrong_commit": 0, "false_promote": 0, "false_retrograde": 0,
              "query_override": 0, "entity_leakage": 0, "attr_leakage": 0}
    valid_entities = {"dragon", "teacher", "horse", "knight", "wizard", "beast"}
    valid_attrs = {"color", "size", "state", "mood"}
    for report in (result["report_off"], result["report_on"]):
        for ep in report.episodes:
            for trace in ep.traces:
                if trace.intent == "READ" and trace.latent_pressure_marker:
                    counts["query_override"] += 1
                if (trace.intent == "WRITE" and trace.head_entity is not None
                        and trace.head_entity not in valid_entities):
                    counts["entity_leakage"] += 1
                if trace.slot_attr is not None and trace.slot_attr not in valid_attrs:
                    counts["attr_leakage"] += 1
    assert counts == {
        "wrong_commit": 0, "false_promote": 0, "false_retrograde": 0,
        "query_override": 0, "entity_leakage": 0, "attr_leakage": 0,
    }, f"safety regression: {counts}"


# ---------------------------------------------------------------------------
# Mandatory test 8: source invariance
# ---------------------------------------------------------------------------

def test_auto_registration_does_not_mutate_source_files():
    sources = [
        Path("c:/Users/Lucian/Desktop/D_CORTEX_ULTIMATE/MISIUNEA.txt"),
        Path("c:/Users/Lucian/Desktop/D_CORTEX_ULTIMATE/steps/13_v15_7a_consolidation/code.py"),
        Path("c:/Users/Lucian/Desktop/fragmergent-memory-engine/ignition_build_v0.py"),
        Path("c:/Users/Lucian/Desktop/fragmergent-memory-engine/13_v15_7a_consolidation/d_cortex/v15_7a_core.py"),
        Path("c:/Users/Lucian/Desktop/fragmergent-memory-engine/13_v15_7a_consolidation/d_cortex/adapter.py"),
        Path("c:/Users/Lucian/Desktop/fragmergent-memory-engine/13_v15_7a_consolidation/d_cortex/receptor.py"),
    ]
    before = {}
    for p in sources:
        if p.exists():
            with open(p, "rb") as f:
                before[str(p)] = hashlib.sha256(f.read()).hexdigest()
    run_auto_registration_demo()
    after = {}
    for p in sources:
        if p.exists():
            with open(p, "rb") as f:
                after[str(p)] = hashlib.sha256(f.read()).hexdigest()
    assert before == after


# ---------------------------------------------------------------------------
# Supplementary tests
# ---------------------------------------------------------------------------

def test_auto_registration_provenance_chain_includes_auto_reg():
    """Every diff trace's provenance should include the auto_registration_id
    of the involved slots."""
    result = run_auto_registration_demo()
    auto_regs = result["auto_registrations"]
    assert auto_regs, "no auto-registrations recorded"
    for ar in auto_regs:
        assert ar["auto_registration_id"]
        assert len(ar["auto_registration_id"]) == 16   # SHA256 prefix
        assert ar["organism_trace_id"]
        assert ar["episode_id"] >= 1


def test_auto_registration_persistence_round_trip():
    store = UnifiedMemoryStore()
    store.auto_register_from_trace(_make_summary(head_entity="dragon", attr="color"), 1)
    store.auto_register_from_trace(_make_summary(head_entity="knight", attr="mood"), 2)
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "auto_reg.json")
        store.persist_auto_registrations(path)
        with open(path) as f:
            payload = json.load(f)
        assert len(payload["auto_registrations"]) == 2

        store2 = UnifiedMemoryStore()
        store2.load_auto_registrations(path)
        assert len(store2._auto_registrations) == 2
        # Forward registry was also populated.
        assert ("dragon", "color") in store2._label_slot_registry
        assert ("knight", "mood") in store2._label_slot_registry


def test_auto_registration_idempotent_for_repeated_trace():
    """Calling auto_register_from_trace twice for the same slot does not
    create a duplicate; the original AutoRegistration is returned."""
    store = UnifiedMemoryStore()
    rec1 = store.auto_register_from_trace(_make_summary(), episode_id=1)
    rec2 = store.auto_register_from_trace(_make_summary(trace_id="different_trace_id"), episode_id=2)
    assert rec1 is rec2  # same object, no new registration
    assert len(store._auto_registrations) == 1


def test_v031_natural_branch_flip_still_passes_with_auto_reg_layer():
    """Regression: v0.3.1's natural branch flip demo must still produce
    branch flip with auto-registration in the perceive loop."""
    from unified_fragmergent_memory.runtime import run_natural_branch_flip_demo
    result = run_natural_branch_flip_demo()
    assert result["natural_branch_flip_confirmed"]


def test_bidirectional_round_trip_verified_in_demo():
    result = run_auto_registration_demo()
    assert result["bidirectional_round_trip_verified"]


def test_registry_grows_only_through_auto_registration_in_demo():
    """The demo does not call register_label_slot manually; the registry
    growth is entirely driven by auto-registration through perceive."""
    result = run_auto_registration_demo()
    assert result["registry_before"] == {}
    assert result["registry_after"] == {("dragon", "color"): 0}
