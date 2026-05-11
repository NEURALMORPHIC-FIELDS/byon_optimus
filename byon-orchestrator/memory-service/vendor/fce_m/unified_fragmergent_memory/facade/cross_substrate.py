"""Cross-substrate coupling facade (Pas 5, v0.2.0).

Single sync 1:1:1 step that drives:

    consolidation (memory_engine_runtime)
        -> tf_engine perturbation (parametric, no source mutation)
        -> tf_engine propagation
        -> synthetic LatentSignals
        -> LatentDecisionPressure on the receptor (next-episode influence).

Provenance is preserved end-to-end: every CrossSubstrateRecord references
the exact consolidation_record_ids it was derived from, the perturbation
factors applied, the tf metrics observed, and the resulting pressure
origin tag. The chain is reconstructible from the four audit logs
(consolidator + tf_metrics + receptor + this record).

Per A1 user resolution 2026-05-06: cross_substrate_step is a pure
functional facade; the orchestrator drives it in a loop. There are no
side effects at import time. State changes (mi_targets adjustment,
registry update) happen during execution and live on the store, not on
the source projects (R1).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np


@dataclass
class CrossSubstrateRecord:
    """Audit record for one cross-substrate cycle.

    Per A3 user resolution 2026-05-06: idempotent steps emit a record
    with consolidation_record_ids=[], tf_perturbation_applied=False,
    synthetic_signals computed but marked triggered_by_idempotent_step,
    and resulting_pressure left null-effect.
    """

    episode_id: int
    consolidation_record_ids: List[str] = field(default_factory=list)
    consolidation_op_counts: Dict[str, int] = field(default_factory=dict)

    tf_perturbations: Dict[int, float] = field(default_factory=dict)
    tf_perturbation_applied: bool = False

    # v0.3.0: vector form of perturbation, with full provenance per slot.
    pressure_vectors: List[Any] = field(default_factory=list)

    tf_metrics: Dict[str, Any] = field(default_factory=dict)

    synthetic_signals_origin: str = ""
    triggered_by_idempotent_step: bool = False

    resulting_pressure_origin: str = ""
    null_effect: bool = False

    label_slot_registry_snapshot: Dict[str, int] = field(default_factory=dict)

    notes: List[str] = field(default_factory=list)

    def to_json_safe(self) -> Dict[str, Any]:
        """Convert to a JSON-serializable dict."""
        return {
            "episode_id": self.episode_id,
            "consolidation_record_ids": list(self.consolidation_record_ids),
            "consolidation_op_counts": dict(self.consolidation_op_counts),
            "tf_perturbations": {str(k): float(v) for k, v in self.tf_perturbations.items()},
            "tf_perturbation_applied": bool(self.tf_perturbation_applied),
            "pressure_vectors": [
                v.to_json_safe() if hasattr(v, "to_json_safe") else v
                for v in self.pressure_vectors
            ],
            "tf_metrics": dict(self.tf_metrics),
            "synthetic_signals_origin": self.synthetic_signals_origin,
            "triggered_by_idempotent_step": bool(self.triggered_by_idempotent_step),
            "resulting_pressure_origin": self.resulting_pressure_origin,
            "null_effect": bool(self.null_effect),
            "label_slot_registry_snapshot": dict(self.label_slot_registry_snapshot),
            "notes": list(self.notes),
        }


def cross_substrate_step(store: Any, episode_id: int) -> CrossSubstrateRecord:
    """Run one cross-substrate cycle on the given store.

    The store must be a UnifiedMemoryStore that has at least one tf_engine
    bank entry written. Symbolic writes prior to this call inform the
    consolidator. The function does not perform writes itself; it only
    drives the consolidate -> perturb -> propagate -> signals -> pressure
    chain.

    Returns a CrossSubstrateRecord with full provenance.
    """
    from unified_fragmergent_memory.bridges.cross_substrate_pressure import (
        apply_mi_perturbations_to_bank,
        consolidation_to_tf_perturbation,
        pressure_to_query_seed,
        tag_pressure_origin,
        tf_result_to_synthetic_signals,
    )

    record = CrossSubstrateRecord(episode_id=episode_id)

    # Step A: consolidation on memory_engine_runtime.
    consolidation = store.consolidate(episode_id=episode_id, source="memory_engine_runtime")
    record.consolidation_op_counts = dict(consolidation.get("ops") or {})

    audit = store.audit_log()
    record.consolidation_record_ids = [
        f"{int(getattr(r, 'episode_id', -1))}::{getattr(r, 'operation', '')}::"
        f"{getattr(r, 'entity_id', '')}::{getattr(r, 'attr_type', '')}"
        for r in audit
        if getattr(r, "episode_id", None) == episode_id
    ]

    is_idempotent = all(
        v == 0 for v in record.consolidation_op_counts.values()
    ) if record.consolidation_op_counts else True
    record.triggered_by_idempotent_step = is_idempotent

    # Step B: derive tf perturbations as vectors (v0.3.0). The scalar
    # perturbation dict is derived from the vectors for backward
    # compatibility with v0.2.0 callers.
    if not is_idempotent:
        from unified_fragmergent_memory.bridges.cross_substrate_pressure import (
            consolidation_to_pressure_vectors,
            pressure_vectors_to_perturbation_dict,
        )
        record.pressure_vectors = consolidation_to_pressure_vectors(
            audit_records=audit,
            episode_id=episode_id,
            label_slot_registry=store._label_slot_registry,
            promote_amplification=store.config.cross_substrate_promote_amplification,
            retrograde_attenuation=store.config.cross_substrate_retrograde_attenuation,
            prune_mask_value=store.config.cross_substrate_prune_mask_value,
        )
        record.tf_perturbations = pressure_vectors_to_perturbation_dict(
            record.pressure_vectors, store._label_slot_registry,
        )
        record.tf_perturbation_applied = bool(record.tf_perturbations)

    # Step C: tf propagate with derived bank.
    bank: Optional[Dict[str, Any]] = None
    has_bank = (
        store._tf_bank is not None or len(store._tf_bank_entries_buffer) > 0
    )
    if not has_bank:
        record.null_effect = True
        record.notes.append("tf_engine bank empty; propagation skipped")
    else:
        bank = store._seal_tf_bank()
        derived_bank = (
            apply_mi_perturbations_to_bank(bank, record.tf_perturbations)
            if record.tf_perturbations
            else bank
        )

        q_vec, q_mi = pressure_to_query_seed(
            store._cross_substrate_last_pressure,
            derived_bank,
            store._label_slot_registry,
            seed_strength=store.config.cross_substrate_pressure_seed_strength,
        )

        from unified_fragmergent_memory.facade.propagation import propagate as _prop

        prop_result = _prop(
            q_vec=q_vec, q_mi=q_mi, bank=derived_bank,
            n_steps=store.config.cross_substrate_n_steps,
            method=store.config.cross_substrate_propagation_method,
            alpha=store.config.tf_engine_alpha,
            k_top=store.config.tf_engine_k_top,
            temperature_softmax=store.config.tf_engine_temperature_softmax,
            temperature_mi=store.config.tf_engine_temperature_mi,
        )

        record.tf_metrics = _summarize_prop_result(prop_result)

        # Step D: build LatentSignals from audit + tf result. v0.3.0 uses
        # audit_and_tf_to_signals as the canonical natural-pressure builder
        # (semantically correct: value_idx in adapter namespace, so the
        # receptor's value_resolver maps to the actual promoted/demoted
        # value string). The v0.2.0 tf_result_to_synthetic_signals is
        # retained as a fallback path for callers that want only the tf
        # side of the bridge without audit context.
        from unified_fragmergent_memory.bridges.cross_substrate_pressure import (
            audit_and_tf_to_signals,
        )
        signals = audit_and_tf_to_signals(
            audit_records=audit,
            episode_id=episode_id,
            label_slot_registry=store._label_slot_registry,
            prop_result=prop_result,
            triggered_by_idempotent_step=is_idempotent,
        )
        record.synthetic_signals_origin = "cross_substrate.audit_and_tf"

        # Step E: signals -> pressure (only if non-idempotent, per A3).
        if not is_idempotent:
            from unified_fragmergent_memory.sources.memory_engine_runtime import (
                LatentRationalMemoryReceptor,
            )

            if store._cross_substrate_receptor is None:
                store._cross_substrate_receptor = LatentRationalMemoryReceptor()

            adapter = store._ensure_runtime_adapter()

            def _value_resolver(attr_type: str, value_idx: int) -> Optional[str]:
                try:
                    return adapter.resolve_value_idx(attr_type, value_idx)
                except Exception:
                    return None

            pressure = store._cross_substrate_receptor.update_from_signals(
                signals,
                value_resolver=_value_resolver,
                episode_id=episode_id,
            )
            tag_pressure_origin(pressure, "cross_substrate")
            store._cross_substrate_last_pressure = pressure
            record.resulting_pressure_origin = "cross_substrate"
        else:
            record.resulting_pressure_origin = "null_effect_idempotent"
            record.null_effect = True
            record.notes.append("idempotent step: signals computed but receptor not updated")

    record.label_slot_registry_snapshot = {
        f"{e}::{a}": int(label) for (e, a), label in store._label_slot_registry.items()
    }

    return record


def _summarize_prop_result(prop_result: Dict[str, Any]) -> Dict[str, Any]:
    """JSON-safe summary of run_propagation output."""
    out: Dict[str, Any] = {}
    for key in ("recalls", "label_predictions", "q_vec_norms", "q_mi_trajectory"):
        v = prop_result.get(key)
        if isinstance(v, np.ndarray):
            out[key] = v.tolist()
    if "q_vec_final" in prop_result:
        q = np.asarray(prop_result["q_vec_final"])
        out["q_vec_final_norm"] = float(np.linalg.norm(q))
    if "q_mi_final" in prop_result:
        out["q_mi_final"] = float(prop_result["q_mi_final"])
    return out
