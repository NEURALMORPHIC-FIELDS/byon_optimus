"""Tests for bridges/cross_substrate_pressure.py."""

from __future__ import annotations

import numpy as np
import pytest

from unified_fragmergent_memory.bridges.cross_substrate_pressure import (
    apply_mi_perturbations_to_bank,
    consolidation_to_tf_perturbation,
    get_pressure_origin,
    pressure_to_query_seed,
    tag_pressure_origin,
    tf_result_to_synthetic_signals,
)


class _FakeAuditRecord:
    """Stand-in for V15_7a_ConsolidationRecord with the fields the bridge reads."""

    def __init__(self, episode_id: int, operation: str, entity_id: str, attr_type: str):
        self.episode_id = episode_id
        self.operation = operation
        self.entity_id = entity_id
        self.attr_type = attr_type
        self.value_idx = -1
        self.reason = ""
        self.state_before = None
        self.state_after = None


def test_consolidation_to_tf_perturbation_promote_amplifies():
    audit = [_FakeAuditRecord(1, "PROMOTE", "dragon", "color")]
    registry = {("dragon", "color"): 0}
    result = consolidation_to_tf_perturbation(
        audit, episode_id=1, label_slot_registry=registry,
        promote_amplification=1.5, retrograde_attenuation=0.5, prune_mask_value=0.0,
    )
    assert result == {0: 1.5}


def test_consolidation_to_tf_perturbation_retrograde_attenuates():
    audit = [_FakeAuditRecord(1, "RETROGRADE", "dragon", "color")]
    registry = {("dragon", "color"): 0}
    result = consolidation_to_tf_perturbation(audit, 1, registry)
    assert result == {0: 0.5}


def test_consolidation_to_tf_perturbation_prune_zeroes():
    audit = [_FakeAuditRecord(1, "PRUNE", "dragon", "color")]
    registry = {("dragon", "color"): 0}
    result = consolidation_to_tf_perturbation(audit, 1, registry)
    assert result == {0: 0.0}


def test_consolidation_to_tf_perturbation_reconcile_is_noop():
    audit = [_FakeAuditRecord(1, "RECONCILE", "dragon", "color")]
    registry = {("dragon", "color"): 0}
    result = consolidation_to_tf_perturbation(audit, 1, registry)
    assert result == {}


def test_consolidation_order_PRUNE_then_RETROGRADE_then_PROMOTE():
    """Per A2 user resolution: deterministic order PRUNE -> RETROGRADE ->
    RECONCILE no-op -> PROMOTE; multiplicative composition on same label."""
    audit = [
        _FakeAuditRecord(1, "PROMOTE", "dragon", "color"),
        _FakeAuditRecord(1, "PRUNE", "dragon", "color"),
        _FakeAuditRecord(1, "RETROGRADE", "dragon", "color"),
    ]
    registry = {("dragon", "color"): 0}
    result = consolidation_to_tf_perturbation(audit, 1, registry,
                                              promote_amplification=2.0,
                                              retrograde_attenuation=0.5,
                                              prune_mask_value=0.0)
    # 0.0 (prune) * 0.5 (retrograde) * 2.0 (promote) = 0.0
    assert result == {0: 0.0}


def test_consolidation_filters_by_episode():
    audit = [
        _FakeAuditRecord(1, "PROMOTE", "dragon", "color"),
        _FakeAuditRecord(2, "PROMOTE", "dragon", "color"),
    ]
    registry = {("dragon", "color"): 0}
    result_ep1 = consolidation_to_tf_perturbation(audit, 1, registry)
    result_ep2 = consolidation_to_tf_perturbation(audit, 2, registry)
    assert result_ep1 == {0: 1.5}
    assert result_ep2 == {0: 1.5}
    # Episode 3: nothing.
    assert consolidation_to_tf_perturbation(audit, 3, registry) == {}


def test_consolidation_skips_unregistered_slots():
    audit = [_FakeAuditRecord(1, "PROMOTE", "ghost", "unknown")]
    registry = {("dragon", "color"): 0}
    assert consolidation_to_tf_perturbation(audit, 1, registry) == {}


def test_apply_mi_perturbations_to_bank_does_not_mutate_original():
    bank = {
        "vectors": np.zeros((4, 8)),
        "mis": np.array([1.0, 2.0, 3.0, 4.0]),
        "labels": np.array([0, 0, 1, 1]),
        "betas": np.zeros(4),
        "sigmas": np.ones(4),
        "mi_targets": [1.5, 3.5],
    }
    original_mis = bank["mis"].copy()
    new_bank = apply_mi_perturbations_to_bank(bank, {0: 2.0, 1: 0.5})
    np.testing.assert_array_equal(bank["mis"], original_mis)
    np.testing.assert_array_equal(new_bank["mis"], [2.0, 4.0, 1.5, 2.0])
    assert new_bank["mi_targets"] == [3.0, 1.75]


def test_apply_mi_perturbations_empty_returns_same_bank():
    bank = {"vectors": np.zeros((1, 4)), "mis": np.array([1.0]),
            "labels": np.array([0]), "betas": np.zeros(1),
            "sigmas": np.ones(1), "mi_targets": [1.0]}
    out = apply_mi_perturbations_to_bank(bank, {})
    assert out is bank


def test_tf_result_to_synthetic_signals_stable_predictions_promote():
    prop = {
        "label_predictions": np.array([0, 0, 0, 0]),
        "q_vec_final": np.zeros(8),
        "q_mi_final": 1.0,
    }
    registry = {("dragon", "color"): 0}
    signals = tf_result_to_synthetic_signals(prop, registry)
    # promote_candidate is now a dict slot -> value_idx (per LatentSignals contract).
    assert signals.promote_candidate == {("dragon", "color"): 0}
    # confirmation_count is also a dict slot -> {value_idx: distinct_episodes}.
    assert signals.confirmation_count == {("dragon", "color"): {0: 4}}


def test_tf_result_to_synthetic_signals_oscillating_signals_conflict():
    prop = {
        "label_predictions": np.array([0, 1, 0, 1]),
        "q_vec_final": np.zeros(8),
        "q_mi_final": 1.0,
    }
    registry = {("dragon", "color"): 1}
    signals = tf_result_to_synthetic_signals(prop, registry)
    # conflict_persistence is a set of slots.
    assert ("dragon", "color") in signals.conflict_persistence
    # challenger_strength is a dict; the registered slot has a positive count.
    assert signals.challenger_strength[("dragon", "color")] > 0.0


def test_tf_result_to_synthetic_signals_marks_idempotent():
    prop = {
        "label_predictions": np.array([0, 0]),
        "q_vec_final": np.zeros(8),
        "q_mi_final": 0.5,
    }
    signals = tf_result_to_synthetic_signals(prop, {}, triggered_by_idempotent_step=True)
    assert signals.raw_v15_7a_signals["triggered_by_idempotent_step"] is True


def test_pressure_to_query_seed_uses_label_centroid():
    bank = {
        "vectors": np.array([[1.0, 0.0], [1.0, 0.0], [0.0, 2.0], [0.0, 2.0]]),
        "mis": np.array([1.0, 1.0, 3.0, 3.0]),
        "labels": np.array([0, 0, 1, 1]),
        "betas": np.zeros(4),
        "sigmas": np.ones(4),
        "mi_targets": [1.0, 3.0],
    }
    registry = {("dragon", "color"): 1}
    q_vec, q_mi = pressure_to_query_seed(None, bank, registry)
    # No pressure: pick smallest registered label centroid (label 0, centroid [1, 0]).
    np.testing.assert_array_almost_equal(q_vec, [1.0, 0.0])
    assert q_mi == 1.0


def test_pressure_to_query_seed_with_active_pressure():
    bank = {
        "vectors": np.array([[1.0, 0.0], [1.0, 0.0], [0.0, 2.0], [0.0, 2.0]]),
        "mis": np.array([1.0, 1.0, 3.0, 3.0]),
        "labels": np.array([0, 0, 1, 1]),
        "betas": np.zeros(4),
        "sigmas": np.ones(4),
        "mi_targets": [1.0, 3.0],
    }
    registry = {("dragon", "color"): 1}

    class _FakePressure:
        promote_slots = {("dragon", "color"): "red"}
        def is_empty(self):
            return False

    q_vec, q_mi = pressure_to_query_seed(_FakePressure(), bank, registry)
    # Pressure points at label 1 centroid [0, 2] with mi 3.0.
    np.testing.assert_array_almost_equal(q_vec, [0.0, 2.0])
    assert q_mi == 3.0


def test_pressure_origin_weakref_tagging_and_lookup():
    """Q2: tag origin via WeakKeyDictionary, not id(). dataclass instance must be hashable."""
    from unified_fragmergent_memory.sources.memory_engine_runtime import (
        LatentDecisionPressure,
    )
    pressure = LatentDecisionPressure.empty()
    tag_pressure_origin(pressure, "cross_substrate")
    assert get_pressure_origin(pressure) == "cross_substrate"


def test_pressure_origin_returns_none_for_untagged():
    from unified_fragmergent_memory.sources.memory_engine_runtime import (
        LatentDecisionPressure,
    )
    pressure = LatentDecisionPressure.empty()
    assert get_pressure_origin(pressure) is None


def test_pressure_origin_handles_none():
    assert get_pressure_origin(None) is None
