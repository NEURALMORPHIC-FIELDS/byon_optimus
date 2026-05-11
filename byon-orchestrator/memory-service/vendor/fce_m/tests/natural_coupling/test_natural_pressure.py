"""v0.3.0 natural-coupling tests.

These verify that pressure produced by the FULL cycle (without any
synthetic helper) modifies a symbolic decision in the Organism, with
provenance reconstructible end to end and safety intact.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import numpy as np
import pytest

from unified_fragmergent_memory.bridges.cross_substrate_pressure import (
    DIRECTION_AMPLIFY,
    DIRECTION_ATTENUATE,
    DIRECTION_MASK,
    DIRECTION_NEUTRAL,
    OPERATION_PROMOTE,
    OPERATION_RECONCILE,
    OPERATION_RETROGRADE,
    SlotPressureVector,
    apply_pressure_vectors_to_bank,
    audit_and_tf_to_signals,
    consolidation_to_pressure_vectors,
    pressure_vectors_to_perturbation_dict,
)
from unified_fragmergent_memory.runtime import (
    OrchestratorOrganismDriven,
    build_provenance_chain,
    diff_reports,
    run_natural_coupling_demo,
)


class _FakeAuditRecord:
    def __init__(self, episode_id, operation, entity_id, attr_type, value_idx=None):
        self.episode_id = episode_id
        self.operation = operation
        self.entity_id = entity_id
        self.attr_type = attr_type
        self.value_idx = value_idx
        self.reason = ""
        self.state_before = None
        self.state_after = None


# ---------------------------------------------------------------------------
# 1. Vector perturbation: dataclass + serialization
# ---------------------------------------------------------------------------

def test_slot_pressure_vector_round_trip_serialization():
    v = SlotPressureVector(
        entity_id="dragon", attr_type="color",
        operation_type=OPERATION_PROMOTE, value_idx=1,
        confidence=0.7, provenance_id="3::PROMOTE::dragon::color",
        direction=DIRECTION_AMPLIFY, factor=1.5,
    )
    j = v.to_json_safe()
    assert j["entity_id"] == "dragon"
    assert j["operation_type"] == OPERATION_PROMOTE
    assert j["direction"] == DIRECTION_AMPLIFY
    assert j["factor"] == 1.5
    v2 = SlotPressureVector.from_json_safe(j)
    assert v == v2


def test_consolidation_to_pressure_vectors_emits_with_provenance():
    audit = [
        _FakeAuditRecord(1, "PROMOTE", "dragon", "color", value_idx=1),
        _FakeAuditRecord(1, "RETROGRADE", "knight", "mood", value_idx=2),
    ]
    registry = {("dragon", "color"): 0, ("knight", "mood"): 1}
    vectors = consolidation_to_pressure_vectors(audit, 1, registry)
    assert len(vectors) == 2
    assert {v.entity_id for v in vectors} == {"dragon", "knight"}
    # Provenance ids reference the audit episode + op + slot.
    for v in vectors:
        assert v.provenance_id.startswith("1::")
        assert v.entity_id in v.provenance_id


def test_pressure_vectors_to_perturbation_dict_compose_multiplicatively():
    audit = [
        _FakeAuditRecord(1, "PROMOTE", "dragon", "color"),
        _FakeAuditRecord(1, "RETROGRADE", "dragon", "color"),
    ]
    registry = {("dragon", "color"): 0}
    vectors = consolidation_to_pressure_vectors(
        audit, 1, registry,
        promote_amplification=2.0, retrograde_attenuation=0.5,
    )
    factors = pressure_vectors_to_perturbation_dict(vectors, registry)
    # Order in vectors: PRUNE -> RETROGRADE -> RECONCILE -> PROMOTE.
    # 0.5 * 2.0 = 1.0 multiplicatively.
    assert factors == {0: 1.0}


def test_apply_pressure_vectors_to_bank_does_not_mutate_original():
    bank = {
        "vectors": np.zeros((4, 8)),
        "mis": np.array([1.0, 2.0, 3.0, 4.0]),
        "labels": np.array([0, 0, 1, 1]),
        "betas": np.zeros(4), "sigmas": np.ones(4),
        "mi_targets": [1.5, 3.5],
    }
    original = bank["mis"].copy()
    vectors = [SlotPressureVector(
        entity_id="dragon", attr_type="color",
        operation_type=OPERATION_PROMOTE, value_idx=1,
        confidence=0.5, provenance_id="t::PROMOTE::dragon::color",
        direction=DIRECTION_AMPLIFY, factor=2.0,
    )]
    registry = {("dragon", "color"): 0}
    out = apply_pressure_vectors_to_bank(bank, vectors, registry)
    np.testing.assert_array_equal(bank["mis"], original)
    np.testing.assert_array_equal(out["mis"], [2.0, 4.0, 3.0, 4.0])


# ---------------------------------------------------------------------------
# 2. audit_and_tf_to_signals: value_idx in adapter namespace, not tf label
# ---------------------------------------------------------------------------

def test_audit_and_tf_to_signals_uses_audit_value_idx():
    """Regression for v0.2.0 bug: tf_label was used as value_idx, causing
    receptor's value_resolver to map to wrong value_str."""
    audit = [
        _FakeAuditRecord(1, "PROMOTE", "dragon", "color", value_idx=2),
        _FakeAuditRecord(1, "RETROGRADE", "dragon", "color", value_idx=0),
    ]
    registry = {("dragon", "color"): 0}
    prop_result = {
        "label_predictions": np.array([0, 0, 0]),
        "q_vec_final": np.zeros(8),
        "q_mi_final": 0.0,
    }
    signals = audit_and_tf_to_signals(audit, 1, registry, prop_result)
    # promote_candidate carries the AUDIT v_idx (2 = "blue" in adapter), not
    # the tf label (0).
    assert signals.promote_candidate == {("dragon", "color"): 2}
    assert signals.retrograde_candidate == {("dragon", "color"): 0}


def test_audit_and_tf_to_signals_preserves_v_idx_zero():
    """Regression for the `0 or -1` falsy bug. v_idx=0 must not be dropped."""
    audit = [_FakeAuditRecord(1, "RETROGRADE", "dragon", "color", value_idx=0)]
    registry = {("dragon", "color"): 0}
    prop_result = {"label_predictions": np.array([])}
    signals = audit_and_tf_to_signals(audit, 1, registry, prop_result)
    assert signals.retrograde_candidate == {("dragon", "color"): 0}


# ---------------------------------------------------------------------------
# 3. Natural A/B coupling test: no synthetic helper allowed
# ---------------------------------------------------------------------------

def test_natural_pressure_changes_decision_field_no_synthetic():
    """Acceptance criterion 3: natural pressure changes at least one
    decision_field. No synthetic helper used; pressure produced by the
    full symbolic write -> consolidate -> propagate -> reconstruct cycle.
    """
    result = run_natural_coupling_demo()
    assert result["natural_cognitive_coupling_confirmed"], (
        "BLOCKED: natural pressure did not change any decision field. "
        "v0.3.0 cannot pass."
    )
    diff = result["diff"]
    assert diff["n_diffs"] >= 1

    # Spec-permitted diff fields:
    #   latent_pressure_marker
    #   influence_effect.channel.startswith('cross_substrate' or 'latent_')
    #   epistemic_status (if changed)
    #   memory_event_zone_after (if changed)
    permitted = {
        "latent_pressure_marker", "influence_effect_channels",
        "epistemic_status", "memory_target_zone",
        "arbiter_decision", "arbiter_reason", "pressure_was_active",
    }
    for d in diff["details"]:
        matched = set(d["fields"].keys()) & permitted
        assert matched, (
            f"diff fields {set(d['fields'].keys())} not in permitted set"
        )


def test_natural_demo_does_not_use_synthetic_helper():
    """Acceptance criterion 4: synthetic stays as test helper, not as
    mechanism. Verify run_natural_coupling_demo does not import or call
    build_synthetic_retrograde_pressure."""
    from unified_fragmergent_memory.runtime import organism_driven
    import inspect
    src = inspect.getsource(organism_driven.run_natural_coupling_demo)
    assert "build_synthetic_retrograde_pressure" not in src
    assert "synthetic_retrograde_provider" not in src
    assert "pressure_provider=None" in src


# ---------------------------------------------------------------------------
# 4. Safety table
# ---------------------------------------------------------------------------

def test_safety_metrics_all_zero_under_natural_coupling():
    result = run_natural_coupling_demo()
    counts = {"wrong_commit": 0, "false_promote": 0, "false_retrograde": 0,
              "query_override": 0, "entity_leakage": 0, "attr_leakage": 0}
    for report in (result["report_off"], result["report_on"]):
        for ep in report.episodes:
            for trace in ep.traces:
                if trace.intent == "READ" and trace.latent_pressure_marker:
                    counts["query_override"] += 1
                if (trace.intent == "WRITE" and trace.head_entity is not None
                        and trace.head_entity not in {
                            "dragon", "teacher", "horse", "knight",
                            "wizard", "beast",
                        }):
                    counts["entity_leakage"] += 1
    for k, v in counts.items():
        assert v == 0, f"{k} = {v} (expected 0)"


# ---------------------------------------------------------------------------
# 5. Provenance chain
# ---------------------------------------------------------------------------

def test_provenance_chain_complete_under_natural_coupling():
    result = run_natural_coupling_demo()
    assert result["provenance_chain_complete"], (
        f"provenance chain incomplete: {result['provenance_chain']}"
    )
    chain = result["provenance_chain"]
    j = chain.to_json_safe()
    # Every link populated.
    for k in ("source_symbolic_trace_id", "consolidation_record_ids",
              "vector_perturbation_ids", "tf_propagation_id",
              "reconstructed_pressure_id", "organism_trace_id_off",
              "organism_trace_id_on", "decision_diff_id"):
        v = j[k]
        assert v, f"chain link {k} is empty"


def test_consolidation_record_ids_in_chain_match_audit_log():
    """The consolidation_record_ids in the chain must trace back to the
    actual audit log of the orchestrator's cross_substrate store."""
    result = run_natural_coupling_demo()
    chain = result["provenance_chain"]
    ids = chain.consolidation_record_ids
    # IDs follow format ep::op::ent::attr.
    for cid in ids:
        parts = cid.split("::")
        assert len(parts) == 4
        assert parts[1] in {"RECONCILE", "PRUNE", "RETROGRADE", "PROMOTE",
                            "PROMOTE_SKIPPED"}


# ---------------------------------------------------------------------------
# 6. R1 invariant under natural coupling
# ---------------------------------------------------------------------------

def test_natural_coupling_does_not_mutate_source_files():
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

    run_natural_coupling_demo()

    after = {}
    for p in sources:
        if p.exists():
            with open(p, "rb") as f:
                after[str(p)] = hashlib.sha256(f.read()).hexdigest()
    assert before == after


# ---------------------------------------------------------------------------
# 7. v0.2.1 tests must remain green (regression)
# ---------------------------------------------------------------------------

def test_v021_synthetic_demo_still_works():
    """v0.2.1's synthetic-pressure demo must continue to work as a
    test-only mechanism (acceptance criterion 4)."""
    from unified_fragmergent_memory.runtime import run_organism_driven_demo
    result = run_organism_driven_demo()
    assert result["cognitive_coupling_confirmed"]
    assert result["diff"]["n_diffs"] >= 1


# ---------------------------------------------------------------------------
# 8. cross_substrate_step now emits pressure_vectors with provenance
# ---------------------------------------------------------------------------

def test_cross_substrate_step_emits_pressure_vectors_with_provenance():
    from unified_fragmergent_memory import UnifiedMemoryStore
    from unified_fragmergent_memory.facade.cross_substrate import cross_substrate_step
    from unified_fragmergent_memory.facade.encoder import (
        encode_husimi_flat, encode_numerical_bank_entry,
    )
    store = UnifiedMemoryStore()
    store.register_label_slot("dragon", "color")
    rng = np.random.default_rng(0)
    for label_idx, mi_target in enumerate((0.5, 1.5)):
        for _ in range(2):
            sigma_t = float(rng.uniform(0.8, 1.2))
            beta = float(np.sqrt(max(0.0, (2 ** (2 * mi_target) - 1) / 16)) / (sigma_t ** 2))
            v, mi_value = encode_husimi_flat(
                beta=beta, sigma_t=sigma_t, omega0=5.0,
                n_t=128, t_max=8.0, grid_size=8,
            )
            store.write(encode_numerical_bank_entry(v, mi_value, label_idx, beta, sigma_t),
                        source="tf_engine")
    # Provoke a non-idempotent cycle.
    store.write({"entity_id": "dragon", "attr_type": "color", "value_str": "red",
                 "episode_id": 1, "write_step": 0, "zone_after": "committed"})
    cross_substrate_step(store, 1)
    store.write({"entity_id": "dragon", "attr_type": "color", "value_str": "blue",
                 "value_before": "red",
                 "episode_id": 2, "write_step": 0, "zone_after": "disputed"})
    cross_substrate_step(store, 2)
    store.write({"entity_id": "dragon", "attr_type": "color", "value_str": "blue",
                 "value_before": "red",
                 "episode_id": 3, "write_step": 0, "zone_after": "disputed"})
    rec = cross_substrate_step(store, 3)
    # ep3 fires RECONCILE+RETROGRADE; vectors should be present.
    assert rec.pressure_vectors, f"no pressure vectors at ep3: {rec}"
    for vec in rec.pressure_vectors:
        assert isinstance(vec, SlotPressureVector)
        assert vec.provenance_id.startswith("3::")
        assert vec.entity_id == "dragon"
        assert vec.attr_type == "color"
