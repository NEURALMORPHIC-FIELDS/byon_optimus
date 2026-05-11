"""Propagation and consolidation router.

Two distinct operators (per overlap O3 in integration_map.json):

- `propagate`: tf_engine's iterative top-k attention-aggregated EMA over a
  static bank. n_steps parameter. Numerical sources only.
- `consolidate`: memory_engine_runtime's end-of-episode 4-op pipeline
  (reconcile, prune, retrograde, promote). Symbolic sources only.

Calling either on a source that does not support it raises NotImplementedError.

Note on tf_engine.propagate_semantic discretization: that primitive rounds
delay to integer time-grid steps (np.roll). For very small couplings the
shift can round to zero and the packet is returned unchanged. Documented in
ARCHITECTURE.md section 11.
"""

from __future__ import annotations

from typing import Any, Dict, List

import numpy as np


def propagate(q_vec: np.ndarray, q_mi: float, bank: Dict[str, np.ndarray],
              n_steps: int = 5, method: str = "softmax",
              alpha: float = 0.3, k_top: int = 5,
              temperature_softmax: float = 0.05,
              temperature_mi: float = 0.5,
              true_label: int = -1) -> Dict[str, np.ndarray]:
    """Wraps fragmergent_tf.memory.memory_propagation.run_propagation.

    method: 'softmax' or 'mi'. For hybrid, use propagate_hybrid.
    """
    from unified_fragmergent_memory.sources.tf_engine import run_propagation
    if method not in {"softmax", "mi"}:
        raise ValueError(f"method must be 'softmax' or 'mi', got {method!r}")
    return run_propagation(
        q_vec=q_vec, q_mi=q_mi, bank=bank, method=method,
        n_steps=n_steps, alpha=alpha, k_top=k_top,
        temperature_softmax=temperature_softmax,
        temperature_mi=temperature_mi,
        true_label=true_label,
    )


def propagate_hybrid(q_vec: np.ndarray, q_mi: float, bank: Dict[str, np.ndarray],
                     lambda_: float = 0.5, n_steps: int = 5, alpha: float = 0.3,
                     k_top: int = 5, true_label: int = -1) -> Dict[str, Any]:
    """Wraps experiments.exp05_hybrid_attention.run_hybrid_propagation."""
    import sys
    from unified_fragmergent_memory.sources import tf_engine as _tf
    # The experiment lives at the package root, not in fragmergent_tf.
    exp_path = str(_tf.SOURCE_ROOT / "experiments")
    if exp_path not in sys.path:
        sys.path.insert(0, exp_path)
    import exp05_hybrid_attention  # type: ignore[import-not-found]
    return exp05_hybrid_attention.run_hybrid_propagation(
        q_vec=q_vec, q_mi=q_mi, bank=bank, lam=lambda_,
        n_steps=n_steps, alpha=alpha, k_top=k_top, true_label=true_label,
    )


def consolidate(provisional_memory: Any, bank: Any, stability_index: Any,
                current_episode: int, audit: List[Any] | None = None,
                n_promote: int = 2, m_retrograde: int = 2,
                k_promote_age: int = 2, k_prune_stale: int = 3) -> Dict[str, int]:
    """Wraps memory_engine_runtime d_cortex.v15_7a_core.run_consolidator_pipeline.

    Runs the four ops (reconcile, prune, retrograde, promote) in fixed order at
    end_episode. Returns a dict with keys RECONCILE, PRUNE, RETROGRADE, PROMOTE
    each carrying an integer op count.

    The four parameters n_promote, m_retrograde, k_promote_age, k_prune_stale
    have sealed default values from v15.7a (2, 2, 2, 3).
    """
    from unified_fragmergent_memory.sources.memory_engine_runtime import (
        run_consolidator_pipeline,
    )
    if audit is None:
        audit = []
    return run_consolidator_pipeline(
        provisional_memory=provisional_memory,
        bank=bank,
        stability_index=stability_index,
        current_episode=current_episode,
        audit=audit,
        N=n_promote,
        M=m_retrograde,
        K_age=k_promote_age,
        K_stale=k_prune_stale,
    )
