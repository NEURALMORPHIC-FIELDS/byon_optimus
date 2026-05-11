"""Entry encoding helpers exposed by the unified facade.

These thin wrappers compose encoder primitives from the source projects.
Each function names the source primitive it composes, satisfying invariant
I4 (no primitive renamed without provenance).
"""

from __future__ import annotations

from typing import Any, Dict, Tuple

import numpy as np


def encode_husimi_flat(beta: float, sigma_t: float, omega0: float = 5.0,
                       n_t: int = 256, t_max: float = 8.0,
                       grid_size: int = 16) -> Tuple[np.ndarray, float]:
    """Wraps fragmergent_tf.memory.memory_propagation.build_husimi_flat.

    Returns (flat_vector, analytical_mi) where flat_vector is grid_size**2-d
    and analytical_mi is the closed-form MI in bits for the chirp parameter.
    """
    from unified_fragmergent_memory.sources.tf_engine import build_husimi_flat
    return build_husimi_flat(
        beta=beta, sigma_t=sigma_t, omega0=omega0,
        n_t=n_t, t_max=t_max, grid_size=grid_size,
    )


def encode_symbolic_attribute_slot(entity_id: str, attr_type: str,
                                   value_idx: int, write_step: int = 0,
                                   value_emb: Any = None) -> Dict[str, Any]:
    """Build a symbolic AttributeSlot-compatible dict.

    Composes the runtime project's AttributeSlot dataclass shape without
    forcing instantiation. Useful when constructing entries before deciding
    on a routing target.
    """
    return {
        "entity_id": entity_id,
        "attr_type": attr_type,
        "value_idx": int(value_idx),
        "version": 1,
        "write_step": int(write_step),
        "value_emb": value_emb,
        "present": True,
    }


def encode_numerical_bank_entry(vector: np.ndarray, mi: float, label: int,
                                beta: float = 0.0, sigma: float = 1.0) -> Dict[str, Any]:
    """Build a numerical bank entry compatible with tf_engine bank shape."""
    return {
        "vector": np.asarray(vector, dtype=np.float64),
        "mi": float(mi),
        "label": int(label),
        "beta": float(beta),
        "sigma": float(sigma),
    }
