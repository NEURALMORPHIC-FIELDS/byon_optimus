"""Tests for the unified API contract (UnifiedMemoryStore)."""

from __future__ import annotations

import numpy as np
import pytest

from unified_fragmergent_memory import Config, UnifiedMemoryStore


def test_construction_default_config():
    store = UnifiedMemoryStore()
    assert store.config.default_routing == "auto"
    assert store.config.runtime_n_promote == 2


def test_routing_symbolic_to_runtime_default():
    store = UnifiedMemoryStore()
    target = store._route(
        {"entity_id": "dragon", "attr_type": "color", "value_idx": 1},
        source="auto",
    )
    assert target == "memory_engine_runtime"


def test_routing_numerical_to_tf_engine_default():
    store = UnifiedMemoryStore()
    target = store._route(
        {"vector": np.zeros(8, dtype=np.float64)},
        source="auto",
    )
    assert target == "tf_engine"


def test_routing_explicit_overrides_shape():
    store = UnifiedMemoryStore()
    target = store._route(
        {"entity_id": "dragon", "attr_type": "color"},
        source="d_cortex",
    )
    assert target == "d_cortex"


def test_routing_ambiguous_raises():
    store = UnifiedMemoryStore()
    with pytest.raises(ValueError):
        store._route({"foo": "bar"}, source="auto")


def test_routing_explicit_mode_requires_source():
    store = UnifiedMemoryStore(Config(default_routing="explicit"))
    with pytest.raises(ValueError):
        store._route({"entity_id": "x", "attr_type": "y"}, source="auto")


def test_write_numerical_and_seal_bank():
    store = UnifiedMemoryStore()
    for i in range(3):
        store.write({
            "vector": np.full(16, float(i)),
            "mi": float(i),
            "label": i,
        })
    bank = store._seal_tf_bank()
    assert bank["vectors"].shape == (3, 16)
    assert bank["mis"].shape == (3,)
    assert bank["labels"].tolist() == [0, 1, 2]


def test_write_symbolic_routes_to_runtime():
    store = UnifiedMemoryStore()
    result = store.write({"entity_id": "dragon", "attr_type": "color", "value_idx": 1})
    assert result["target"] == "memory_engine_runtime"


def test_propagate_on_symbolic_raises_not_implemented():
    store = UnifiedMemoryStore()
    with pytest.raises(NotImplementedError):
        store.propagate({"entity_id": "x", "attr_type": "y"}, n_steps=3, source="memory_engine_runtime")


def test_consolidate_on_tf_engine_raises_not_implemented():
    store = UnifiedMemoryStore()
    with pytest.raises(NotImplementedError):
        store.consolidate(source="tf_engine")


def test_hybrid_on_symbolic_raises_not_implemented():
    store = UnifiedMemoryStore()
    store.write({"entity_id": "dragon", "attr_type": "color", "value_idx": 1})
    with pytest.raises(NotImplementedError):
        store.read(
            {"entity_id": "dragon", "attr_type": "color"},
            scoring="hybrid", lambda_=0.5,
        )


def test_softmax_read_on_tf_engine():
    store = UnifiedMemoryStore()
    rng = np.random.default_rng(0)
    for i in range(5):
        store.write({
            "vector": rng.normal(size=16),
            "mi": float(i),
            "label": i,
        })
    weights = store.read({"vector": rng.normal(size=16)}, scoring="softmax")
    assert weights.shape == (5,)
    assert np.isclose(weights.sum(), 1.0, atol=1e-10)
    assert np.all(weights >= 0)


def test_audit_log_default_for_runtime():
    store = UnifiedMemoryStore()
    store.write({"entity_id": "x", "attr_type": "y", "value_idx": 1})
    log = store.audit_log()
    assert isinstance(log, list)


def test_metrics_snapshot_structure():
    store = UnifiedMemoryStore()
    snap = store.metrics_snapshot()
    assert "config" in snap
    assert "tf_engine" in snap
    assert "memory_engine_runtime" in snap
    assert snap["tf_engine"]["bank_size"] == 0


def test_invalid_source_raises():
    store = UnifiedMemoryStore()
    with pytest.raises(ValueError):
        store._route({"entity_id": "x", "attr_type": "y"}, source="other_source")
