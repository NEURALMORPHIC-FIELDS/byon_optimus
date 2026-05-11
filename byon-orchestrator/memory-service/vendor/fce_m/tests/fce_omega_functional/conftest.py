"""Shared helpers for the FCE-Omega functional battery."""

from __future__ import annotations

from typing import Any, Dict

import numpy as np
import pytest

from unified_fragmergent_memory import UnifiedMemoryStore, Config


def symbolic_entry(entity: str, attr: str, value: str,
                   episode_id: int, write_step: int,
                   zone: str = "committed") -> Dict[str, Any]:
    return {
        "entity_id": entity, "attr_type": attr,
        "value_str": value, "value_idx": (hash(value) & 0xFFFF),
        "episode_id": episode_id, "write_step": write_step,
        "zone_after": zone,
    }


def numerical_entry(label: int, mi: float, dim: int = 32,
                    seed: int = 0) -> Dict[str, Any]:
    rng = np.random.default_rng(seed)
    v = rng.standard_normal(dim)
    return {"vector": v.astype(np.float64), "mi": float(mi), "label": int(label),
            "beta": 1.0, "sigma": 1.0}


@pytest.fixture
def store_off() -> UnifiedMemoryStore:
    return UnifiedMemoryStore(Config(fce_omega_enabled=False))


@pytest.fixture
def store_on() -> UnifiedMemoryStore:
    return UnifiedMemoryStore(Config(
        fce_omega_enabled=True, fce_omega_D=8,
        fce_omega_theta_s=0.05, fce_omega_tau_coag=2,
    ))


def runtime_view(store: UnifiedMemoryStore) -> Dict[str, Any]:
    """Subset of metrics_snapshot that captures the runtime adapter's
    deterministic decision-state — used to compare on/off invariance."""
    snap = store.metrics_snapshot().get("memory_engine_runtime", {})
    keys = [
        "n_slot_events", "n_tension_events", "n_resolution_events",
        "n_identity_events", "n_self_observer_events",
        "n_provisional_entries", "n_committed_slots",
        "audit_log_size", "last_pipeline_ops",
        "end_episode_calls", "ingest_skipped_malformed",
        "advice_calls", "advice_returned_nonempty",
    ]
    return {k: snap.get(k) for k in keys if k in snap}
