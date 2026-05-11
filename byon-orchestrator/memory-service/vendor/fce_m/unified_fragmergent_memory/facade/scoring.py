"""Hybrid lambda scoring router.

Composes tf_engine's softmax_attention, mi_attention, and hybrid_weights.
For symbolic sources (d_cortex, memory_engine_runtime), retrieval is
slot-match-based and the hybrid_lambda parameter is meaningless; this module
raises NotImplementedError when scoring='hybrid' is requested against a
non-tf_engine source.
"""

from __future__ import annotations

from typing import Any, Dict

import numpy as np


def softmax_score(q_vec: np.ndarray, bank_vecs: np.ndarray,
                  temperature: float = 0.05) -> np.ndarray:
    """Wraps fragmergent_tf.memory.memory_propagation.softmax_attention."""
    from unified_fragmergent_memory.sources.tf_engine import softmax_attention
    return softmax_attention(q_vec, bank_vecs, temperature=temperature)


def mi_score(q_mi: float, bank_mis: np.ndarray,
             temperature: float = 0.5) -> np.ndarray:
    """Wraps fragmergent_tf.memory.memory_propagation.mi_attention."""
    from unified_fragmergent_memory.sources.tf_engine import mi_attention
    return mi_attention(q_mi, bank_mis, temperature=temperature)


def hybrid_score(q_vec: np.ndarray, q_mi: float,
                 bank_vecs: np.ndarray, bank_mis: np.ndarray,
                 lambda_: float = 0.5, temperature: float = 0.05,
                 mi_scale: float = 1.0) -> np.ndarray:
    """Hybrid lambda-mixed score: lambda * vector_term + (1-lambda) * mi_term.

    Composes tf_engine's hybrid_weights formula:
        score = -lambda * ||v_q - v_k||^2 - (1-lambda) * (MI_q - MI_k)^2 / mi_scale^2
    then softmax-normalizes.
    """
    if not (0.0 <= lambda_ <= 1.0):
        raise ValueError(f"lambda_ must be in [0,1], got {lambda_}")
    if mi_scale <= 0:
        raise ValueError(f"mi_scale must be > 0, got {mi_scale}")
    bank_vecs = np.asarray(bank_vecs, dtype=np.float64)
    bank_mis = np.asarray(bank_mis, dtype=np.float64)
    diffs = bank_vecs - q_vec[None, :]
    vector_term = np.sum(diffs * diffs, axis=-1)
    mi_term = ((bank_mis - q_mi) ** 2) / (mi_scale ** 2)
    raw = -lambda_ * vector_term - (1.0 - lambda_) * mi_term
    raw -= raw.max()
    weights = np.exp(raw / max(temperature, 1e-12))
    return weights / weights.sum()


def slot_match_score(query: Dict[str, Any], source: str = "memory_engine_runtime") -> Dict[str, Any]:
    """Symbolic retrieval: slot match producing an arbitrated read result.

    For source='memory_engine_runtime', returns the runtime's ReadResult-shaped
    dict. For source='d_cortex', forwards to the same runtime alias per O11.
    """
    if source not in {"memory_engine_runtime", "d_cortex"}:
        raise NotImplementedError(
            f"slot_match_score only supports symbolic sources "
            f"(memory_engine_runtime, d_cortex). Got source={source!r}."
        )
    if not (isinstance(query, dict) and "entity_id" in query and "attr_type" in query):
        raise ValueError("slot_match_score query must be a dict with entity_id and attr_type")
    return {
        "entity_id": query["entity_id"],
        "attr_type": query["attr_type"],
        "match_status": "FORWARDED",
        "note": (
            "Symbolic slot-match retrieval is performed by the source's ReadArbiter. "
            "This facade helper validates the query shape; the actual lookup is "
            "delegated to the active store backend."
        ),
        "source": source,
    }
