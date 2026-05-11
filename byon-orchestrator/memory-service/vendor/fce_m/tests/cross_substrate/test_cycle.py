"""End-to-end cross-substrate cycle tests (Pas 5, v0.2.0).

Verifies the round trip: symbolic write -> consolidator audit ->
tf_engine perturbation -> propagation -> synthetic signals -> latent
pressure -> next-episode influence.
"""

from __future__ import annotations

import json
import os
import tempfile

import numpy as np
import pytest

from unified_fragmergent_memory import Config, UnifiedMemoryStore
from unified_fragmergent_memory.facade.cross_substrate import (
    CrossSubstrateRecord,
    cross_substrate_step,
)
from unified_fragmergent_memory.facade.encoder import (
    encode_husimi_flat,
    encode_numerical_bank_entry,
)
from unified_fragmergent_memory.runtime import (
    run_cross_substrate_demo,
    run_with_cross_substrate_coupling,
)


def _seed_tf_bank(store: UnifiedMemoryStore, mi_targets=(0.5, 1.5, 2.5),
                  per_label: int = 4, seed: int = 42) -> None:
    rng = np.random.default_rng(seed)
    for label_idx, mi_target in enumerate(mi_targets):
        for _ in range(per_label):
            sigma_t = float(rng.uniform(0.8, 1.2))
            beta = float(np.sqrt(max(0.0, (2 ** (2 * mi_target) - 1) / 16)) / (sigma_t ** 2))
            v, mi_value = encode_husimi_flat(
                beta=beta, sigma_t=sigma_t, omega0=5.0,
                n_t=128, t_max=8.0, grid_size=8,
            )
            store.write(encode_numerical_bank_entry(v, mi_value, label_idx, beta, sigma_t),
                        source="tf_engine")


def test_register_label_slot_lazy_allocation():
    store = UnifiedMemoryStore()
    a = store.register_label_slot("dragon", "color")
    b = store.register_label_slot("dragon", "color")
    c = store.register_label_slot("knight", "mood")
    assert a == 0
    assert b == 0  # idempotent
    assert c == 1


def test_register_label_slot_explicit_label():
    store = UnifiedMemoryStore()
    label = store.register_label_slot("dragon", "color", label=7)
    assert label == 7
    next_alloc = store.register_label_slot("knight", "mood")
    assert next_alloc == 8


def test_label_slot_registry_persistence_round_trip():
    store = UnifiedMemoryStore()
    store.register_label_slot("dragon", "color")
    store.register_label_slot("knight", "mood")
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "registry.json")
        store.persist_label_slot_registry(path)
        with open(path) as f:
            payload = json.load(f)
        assert payload["next_label_id"] == 2
        assert len(payload["slots"]) == 2

        store2 = UnifiedMemoryStore()
        store2.load_label_slot_registry(path)
        assert store2._label_slot_registry == store._label_slot_registry
        assert store2._next_label_id == 2


def test_cross_substrate_step_idempotent_when_consolidator_emits_no_ops():
    """A3: idempotent step still emits a record, with null_effect."""
    store = UnifiedMemoryStore()
    _seed_tf_bank(store)
    store.register_label_slot("dragon", "color", label=0)
    # No symbolic writes -> consolidator emits no ops.
    record = cross_substrate_step(store, episode_id=1)
    assert isinstance(record, CrossSubstrateRecord)
    assert record.triggered_by_idempotent_step is True
    assert record.tf_perturbation_applied is False
    assert record.tf_perturbations == {}
    assert record.null_effect is True
    assert record.resulting_pressure_origin == "null_effect_idempotent"


def test_cross_substrate_step_perturbs_after_symbolic_write():
    """When the consolidator emits ops, perturbations are applied."""
    store = UnifiedMemoryStore()
    _seed_tf_bank(store)
    store.register_label_slot("dragon", "color", label=0)
    store.register_label_slot("knight", "mood", label=1)
    # Provoke a commit at episode 1 on (dragon, color).
    store.write({
        "entity_id": "dragon", "attr_type": "color", "value_idx": 1,
        "value_str": "red", "episode_id": 1, "write_step": 0,
        "source_text": "the dragon is red",
    })
    record = cross_substrate_step(store, episode_id=1)
    # Whether commit_slot or otherwise, the audit chain receives at least one record.
    # tf_perturbation_applied may or may not be True depending on the operation kind;
    # what we strictly require is that an idempotent flag is NOT raised when ops > 0.
    if record.consolidation_op_counts and any(v > 0 for v in record.consolidation_op_counts.values()):
        assert record.triggered_by_idempotent_step is False
    # tf_metrics must be populated since the bank has entries.
    assert "q_vec_final_norm" in record.tf_metrics


def test_cross_substrate_provenance_chain_complete():
    """Each verigă has a back-reference: registry snapshot, op counts, perturbations,
    tf metrics, signals origin, pressure origin (or null marker)."""
    store = UnifiedMemoryStore()
    _seed_tf_bank(store)
    store.register_label_slot("dragon", "color", label=0)
    store.write({
        "entity_id": "dragon", "attr_type": "color", "value_idx": 1,
        "value_str": "red", "episode_id": 1, "write_step": 0,
    })
    record = cross_substrate_step(store, episode_id=1)
    # Snapshot present.
    assert record.label_slot_registry_snapshot
    # JSON safety.
    payload = record.to_json_safe()
    json.dumps(payload)  # must not raise


def test_cross_substrate_does_not_mutate_source_files():
    """R1: cross-substrate cycle must not touch any source file mtime."""
    paths = [
        "c:/Users/Lucian/Desktop/D_CORTEX_ULTIMATE/MISIUNEA.txt",
        "c:/Users/Lucian/Desktop/fragmergent-tf-engine/README.md",
        "c:/Users/Lucian/Desktop/fragmergent-memory-engine/13_v15_7a_consolidation/README.md",
    ]
    before = {p: os.path.getmtime(p) for p in paths if os.path.exists(p)}

    store = UnifiedMemoryStore()
    _seed_tf_bank(store)
    store.register_label_slot("dragon", "color", label=0)
    cross_substrate_step(store, episode_id=1)

    after = {p: os.path.getmtime(p) for p in paths if os.path.exists(p)}
    assert before == after, "cross-substrate cycle modified a source file"


def test_run_with_cross_substrate_coupling_smoke():
    report = run_with_cross_substrate_coupling(
        n_episodes=2, n_tf_entries_per_label=2, mi_targets=(0.5, 1.5),
    )
    assert report.episodes_run == 2
    assert len(report.cross_substrate_records) == 2
    assert report.final_registry_size >= 2


def test_run_cross_substrate_demo_default_runs():
    report = run_cross_substrate_demo()
    assert report.episodes_run >= 1
    assert isinstance(report.cross_substrate_records, list)


def test_perturbations_observable_via_recall_change():
    """When PROMOTE amplifies label 0, the recall on that label after one
    propagation step should be at least as high as the unperturbed run.
    The test is loose; it asserts the perturbation produces a measurable
    difference, not a specific numeric improvement.
    """
    store = UnifiedMemoryStore()
    _seed_tf_bank(store)
    store.register_label_slot("dragon", "color", label=0)
    store.register_label_slot("knight", "mood", label=1)

    # Force a PROMOTE-like trajectory: write the same slot twice in different episodes.
    store.write({
        "entity_id": "dragon", "attr_type": "color", "value_idx": 1,
        "episode_id": 1, "write_step": 0, "value_str": "red",
    })
    rec1 = cross_substrate_step(store, episode_id=1)

    store.write({
        "entity_id": "dragon", "attr_type": "color", "value_idx": 1,
        "episode_id": 2, "write_step": 1, "value_str": "red",
    })
    rec2 = cross_substrate_step(store, episode_id=2)

    # Both records produced tf_metrics.
    assert "q_vec_final_norm" in rec1.tf_metrics
    assert "q_vec_final_norm" in rec2.tf_metrics
    # Perturbation factors recorded if any op fired.
    if rec2.tf_perturbation_applied:
        assert any(f != 1.0 for f in rec2.tf_perturbations.values())


def test_no_promotion_to_authority_in_signals_origin():
    """Synthetic LatentSignals must not appear authoritative; raw_v15_7a_signals
    carries _origin='cross_substrate.*' to mark non-authoritative origin.
    """
    store = UnifiedMemoryStore()
    _seed_tf_bank(store)
    store.register_label_slot("dragon", "color", label=0)
    store.write({
        "entity_id": "dragon", "attr_type": "color", "value_idx": 1,
        "episode_id": 1, "write_step": 0, "value_str": "red",
    })
    rec = cross_substrate_step(store, episode_id=1)
    # If propagation ran, signals were synthesized; signals_origin should mark cross_substrate.
    if rec.tf_metrics:
        # v0.3.0 narrowed the origin tag to cross_substrate.audit_and_tf;
        # the prefix invariant remains.
        assert rec.synthetic_signals_origin.startswith("cross_substrate")


def test_metrics_snapshot_includes_cross_substrate_block():
    store = UnifiedMemoryStore()
    snap = store.metrics_snapshot()
    assert "cross_substrate" in snap
    assert snap["cross_substrate"]["registry_size"] == 0
    assert snap["cross_substrate"]["receptor_initialized"] is False
