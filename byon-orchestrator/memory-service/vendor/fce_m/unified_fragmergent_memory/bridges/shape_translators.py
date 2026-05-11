"""Shape translation between symbolic and numerical entry representations.

Symbolic entry shape (used by d_cortex and memory_engine_runtime):
    {entity_id: str, attr_type: str, value_idx: int, ...}

Numerical-vector entry shape (used by tf_engine):
    {vector: numpy.ndarray, mi: float, label: int, ...}

These are pure translation functions. They do not validate semantics, they
only normalize shape so the facade can dispatch.
"""

from __future__ import annotations

from typing import Any, Dict

import numpy as np


def is_symbolic_entry(entry: Dict[str, Any]) -> bool:
    """Return True if the entry has the symbolic-shape required keys."""
    return (
        isinstance(entry, dict)
        and isinstance(entry.get("entity_id"), str)
        and isinstance(entry.get("attr_type"), str)
    )


def is_numerical_entry(entry: Dict[str, Any]) -> bool:
    """Return True if the entry has a numpy.ndarray under key vector or v."""
    if not isinstance(entry, dict):
        return False
    vec = entry.get("vector", entry.get("v"))
    if not isinstance(vec, np.ndarray):
        return False
    if vec.size == 0:
        return False
    return np.issubdtype(vec.dtype, np.number)


def husimi_vector_to_value_emb(vector: np.ndarray) -> np.ndarray:
    """Wrap a 256-d Husimi flat vector for storage as AttributeSlot.value_emb.

    The runtime's AttributeSlot accepts Optional[Any] for value_emb. The
    consolidator does not read it; it is auxiliary. This bridge guarantees
    shape and dtype consistency for any consumer that does inspect value_emb.
    """
    arr = np.asarray(vector, dtype=np.float64)
    if arr.ndim != 1:
        raise ValueError(f"husimi_vector_to_value_emb expects 1-D ndarray, got shape {arr.shape}")
    return arr


def symbolic_to_numerical_skeleton(entry: Dict[str, Any], dim: int = 256) -> Dict[str, Any]:
    """Build a zero-vector numerical skeleton from a symbolic entry.

    This is a fallback for consumers who want to register a symbolic entry
    in tf_engine. The vector is zero (no real wave packet was computed); the
    MI is 0.0; the label is the value_idx if present, else -1. Use only
    when explicit cross-bank co-storage is intended.
    """
    return {
        "vector": np.zeros(dim, dtype=np.float64),
        "mi": 0.0,
        "label": int(entry.get("value_idx", -1)),
        "_origin": "symbolic_skeleton",
    }


def numerical_to_symbolic_skeleton(entry: Dict[str, Any], entity_id_template: str = "vec_{label}") -> Dict[str, Any]:
    """Build a symbolic skeleton from a numerical entry.

    Maps numerical entries to (entity_id, attr_type) by templating the entity_id
    from the numerical label. attr_type is set to 'numerical_label'. value_idx
    is the integer label. The original numpy vector is preserved under the
    'value_emb' key so the runtime AttributeSlot can carry it (auxiliary).
    """
    label = int(entry.get("label", -1))
    return {
        "entity_id": entity_id_template.format(label=label),
        "attr_type": "numerical_label",
        "value_idx": label,
        "value_emb": husimi_vector_to_value_emb(entry["vector"]) if "vector" in entry else None,
        "_origin": "numerical_skeleton",
    }
