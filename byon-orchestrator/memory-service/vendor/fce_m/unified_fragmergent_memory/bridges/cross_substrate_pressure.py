"""Cross-substrate translators: consolidator output to tf_engine perturbation,
tf_engine result to synthetic LatentSignals, pressure to query seed.

These are pure translators with one explicit side effect: tagging the origin
of LatentDecisionPressure objects via a module-level WeakKeyDictionary so the
runtime LatentDecisionPressure dataclass is not modified (R1).

Per user resolutions 2026-05-06:
  Q1: tf_bank perturbation is parametric (do not mutate store._tf_bank;
      return a derived bank dict for the propagation call only).
  Q2: pressure_origin tracked via weakref.WeakKeyDictionary, not id().
  A2: deterministic op order PRUNE -> RETROGRADE -> RECONCILE (no-op) ->
      PROMOTE; multiplicative composition per label.
  A3: idempotent step still emits a CrossSubstrateRecord; signals computed
      but receptor is not updated and resulting_pressure is null-effect.
"""

from __future__ import annotations

import copy
import hashlib
import weakref
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np


# v0.3.0: vector perturbation. A SlotPressureVector is the richer per-slot
# pressure structure that replaces the simple scalar dict from v0.2.0 as the
# primary representation. The scalar dict {label: factor} is still derivable
# for backward compatibility (see pressure_vectors_to_perturbation_dict).

OPERATION_PROMOTE = "PROMOTE"
OPERATION_RETROGRADE = "RETROGRADE"
OPERATION_PRUNE = "PRUNE"
OPERATION_RECONCILE = "RECONCILE"
OPERATION_PERSISTENT_CONFLICT = "PERSISTENT_CONFLICT"

DIRECTION_AMPLIFY = "AMPLIFY"
DIRECTION_ATTENUATE = "ATTENUATE"
DIRECTION_MASK = "MASK"
DIRECTION_NEUTRAL = "NEUTRAL"


@dataclass
class SlotPressureVector:
    """v0.3.0 vector perturbation.

    Replaces the scalar perturbation dict as the primary representation.
    Carries operation type, value, confidence, provenance, direction, and
    the derived numeric factor used by tf_engine.

    JSON-serializable via to_json_safe(); reconstructible via from_json_safe().
    """

    entity_id: str
    attr_type: str
    operation_type: str
    value_idx: int
    confidence: float
    provenance_id: str
    direction: str
    factor: float = 1.0

    def to_json_safe(self) -> Dict[str, Any]:
        return {
            "entity_id": self.entity_id,
            "attr_type": self.attr_type,
            "operation_type": self.operation_type,
            "value_idx": int(self.value_idx),
            "confidence": float(self.confidence),
            "provenance_id": self.provenance_id,
            "direction": self.direction,
            "factor": float(self.factor),
        }

    @classmethod
    def from_json_safe(cls, payload: Dict[str, Any]) -> "SlotPressureVector":
        return cls(
            entity_id=payload["entity_id"],
            attr_type=payload["attr_type"],
            operation_type=payload["operation_type"],
            value_idx=int(payload["value_idx"]),
            confidence=float(payload["confidence"]),
            provenance_id=payload["provenance_id"],
            direction=payload["direction"],
            factor=float(payload.get("factor", 1.0)),
        )


# Module-level mapping id(pressure) -> origin. Entries are automatically
# removed when the pressure is garbage collected via weakref.finalize, so no
# id-recycling collision can occur (Q2 user resolution 2026-05-06).
#
# A naive WeakKeyDictionary cannot be used here: the runtime
# LatentDecisionPressure is a default @dataclass which is unhashable
# (mutable, eq=True, hash=None). We honor the SPIRIT of Q2 (no id reuse
# bugs) by registering a finalize callback that pops the entry the moment
# the pressure is collected. The dataclass itself is not modified (R1).
_PRESSURE_ORIGIN: Dict[int, str] = {}


def tag_pressure_origin(pressure: Any, origin: str) -> None:
    """Tag a LatentDecisionPressure instance with its origin label.

    Records `id(pressure) -> origin` and registers a weakref.finalize
    callback that pops the entry as soon as the pressure object is
    collected. Because the entry is removed before the id can be reused,
    no silent collision occurs.
    """
    if pressure is None:
        return
    pid = id(pressure)
    _PRESSURE_ORIGIN[pid] = str(origin)
    try:
        weakref.finalize(pressure, _PRESSURE_ORIGIN.pop, pid, None)
    except TypeError:
        # Object does not support weakref; tag remains until manual clear.
        pass


def get_pressure_origin(pressure: Any) -> Optional[str]:
    """Return the origin tag for a pressure, or None if untagged or collected."""
    if pressure is None:
        return None
    return _PRESSURE_ORIGIN.get(id(pressure))


def consolidation_to_tf_perturbation(
    audit_records: List[Any],
    episode_id: int,
    label_slot_registry: Dict[Tuple[str, str], int],
    promote_amplification: float = 1.5,
    retrograde_attenuation: float = 0.5,
    prune_mask_value: float = 0.0,
) -> Dict[int, float]:
    """Map consolidator audit ops in `episode_id` to per-label MI multipliers.

    Order (deterministic, A2): PRUNE first, then RETROGRADE, then RECONCILE
    (no-op), then PROMOTE last. Multiplicative composition on the same label.

    Returns a dict {label: factor}. Slots not present in label_slot_registry
    are skipped (slot has not been registered as a tf_engine label yet).
    """
    factors: Dict[int, float] = {}

    def _apply(label: int, factor: float) -> None:
        factors[label] = factors.get(label, 1.0) * factor

    # Filter to current episode only.
    episode_audit = [
        r for r in audit_records
        if getattr(r, "episode_id", None) == episode_id
    ]

    def _slot_to_label(record: Any) -> Optional[int]:
        slot = (getattr(record, "entity_id", None), getattr(record, "attr_type", None))
        return label_slot_registry.get(slot)

    # Pass 1: PRUNE.
    for r in episode_audit:
        if getattr(r, "operation", None) == "PRUNE":
            label = _slot_to_label(r)
            if label is not None:
                _apply(label, prune_mask_value)

    # Pass 2: RETROGRADE.
    for r in episode_audit:
        if getattr(r, "operation", None) == "RETROGRADE":
            label = _slot_to_label(r)
            if label is not None:
                _apply(label, retrograde_attenuation)

    # Pass 3: RECONCILE is no-op for tf_engine perturbation.
    # (Recorded in the audit chain but does not multiply any factor.)

    # Pass 4: PROMOTE.
    for r in episode_audit:
        if getattr(r, "operation", None) == "PROMOTE":
            label = _slot_to_label(r)
            if label is not None:
                _apply(label, promote_amplification)

    return factors


def consolidation_to_pressure_vectors(
    audit_records: List[Any],
    episode_id: int,
    label_slot_registry: Dict[Tuple[str, str], int],
    promote_amplification: float = 1.5,
    retrograde_attenuation: float = 0.5,
    prune_mask_value: float = 0.0,
) -> List[SlotPressureVector]:
    """v0.3.0 vector form of consolidation_to_tf_perturbation.

    Returns one SlotPressureVector per (op, slot) pair in the episode's
    audit log. Vectors carry full provenance (consolidation_record_id) and
    are emitted in the same deterministic order as the scalar version
    (PRUNE -> RETROGRADE -> RECONCILE info-only -> PROMOTE).
    """
    vectors: List[SlotPressureVector] = []

    def _record_id(r: Any) -> str:
        return (
            f"{int(getattr(r, 'episode_id', -1))}::"
            f"{getattr(r, 'operation', '')}::"
            f"{getattr(r, 'entity_id', '')}::"
            f"{getattr(r, 'attr_type', '')}"
        )

    episode_audit = [r for r in audit_records
                     if getattr(r, "episode_id", None) == episode_id]

    op_factor_dir = {
        OPERATION_PRUNE: (prune_mask_value, DIRECTION_MASK),
        OPERATION_RETROGRADE: (retrograde_attenuation, DIRECTION_ATTENUATE),
        OPERATION_RECONCILE: (1.0, DIRECTION_NEUTRAL),
        OPERATION_PROMOTE: (promote_amplification, DIRECTION_AMPLIFY),
    }
    op_order = [OPERATION_PRUNE, OPERATION_RETROGRADE,
                OPERATION_RECONCILE, OPERATION_PROMOTE]

    for op in op_order:
        for r in episode_audit:
            if getattr(r, "operation", None) != op:
                continue
            ent = getattr(r, "entity_id", None)
            attr = getattr(r, "attr_type", None)
            slot = (ent, attr)
            if slot not in label_slot_registry:
                continue
            factor, direction = op_factor_dir[op]
            confidence = float(min(1.0, max(0.1, abs(factor - 1.0)))) if op != OPERATION_RECONCILE else 0.5
            vectors.append(SlotPressureVector(
                entity_id=ent,
                attr_type=attr,
                operation_type=op,
                value_idx=int(getattr(r, "value_idx", -1) or -1),
                confidence=confidence,
                provenance_id=_record_id(r),
                direction=direction,
                factor=factor,
            ))
    return vectors


def pressure_vectors_to_perturbation_dict(
    vectors: List[SlotPressureVector],
    label_slot_registry: Dict[Tuple[str, str], int],
) -> Dict[int, float]:
    """Convert vector list to {label: cumulative_factor} for the scalar API.

    RECONCILE vectors with factor 1.0 are skipped (they do not perturb the
    bank). Multiple ops on the same slot compose multiplicatively, in the
    order vectors appear (which matches consolidation_to_pressure_vectors's
    deterministic op order).
    """
    factors: Dict[int, float] = {}
    for vec in vectors:
        if vec.operation_type == OPERATION_RECONCILE:
            continue
        slot = (vec.entity_id, vec.attr_type)
        label = label_slot_registry.get(slot)
        if label is None:
            continue
        factors[label] = factors.get(label, 1.0) * vec.factor
    return factors


def apply_pressure_vectors_to_bank(
    bank: Dict[str, Any],
    vectors: List[SlotPressureVector],
    label_slot_registry: Dict[Tuple[str, str], int],
) -> Dict[str, Any]:
    """v0.3.0 vector form of apply_mi_perturbations_to_bank.

    Composes the vectors into a per-label factor dict, then delegates to
    apply_mi_perturbations_to_bank for the actual mutation-free perturbation.
    """
    perturbations = pressure_vectors_to_perturbation_dict(vectors, label_slot_registry)
    return apply_mi_perturbations_to_bank(bank, perturbations)


def apply_mi_perturbations_to_bank(
    bank: Dict[str, Any],
    perturbations: Dict[int, float],
) -> Dict[str, Any]:
    """Return a derived bank dict with per-label MI factors applied.

    The original bank is not mutated (Q1 parametric perturbation). The derived
    bank shares vectors and labels with the original, but mis is a fresh
    array and mi_targets is recomputed from per-label means.
    """
    if not perturbations:
        return bank
    new_bank = dict(bank)
    new_mis = np.array(bank["mis"], dtype=np.float64, copy=True)
    labels = np.asarray(bank["labels"])
    for label, factor in perturbations.items():
        mask = labels == label
        new_mis[mask] = new_mis[mask] * factor
    new_bank["mis"] = new_mis
    unique_labels = np.unique(labels[labels >= 0])
    new_bank["mi_targets"] = [
        float(np.mean(new_mis[labels == lbl])) for lbl in unique_labels
    ]
    return new_bank


def audit_and_tf_to_signals(
    audit_records: List[Any],
    episode_id: int,
    label_slot_registry: Dict[Tuple[str, str], int],
    prop_result: Dict[str, Any],
    triggered_by_idempotent_step: bool = False,
) -> Any:
    """v0.3.0 canonical natural-pressure builder.

    Replaces the v0.2.0 tf_result_to_synthetic_signals as the primary
    construction path. The semantic correction over v0.2.0:

      Pressure.promote_slots / retrograde_slots carry value_idx values in
      the runtime adapter's namespace (so the receptor's value_resolver
      can resolve them to the correct value_str). v0.2.0 used tf_engine
      label as value_idx, which is a different namespace and causes the
      receptor to map the slot to the wrong value (it would return
      whatever the adapter happened to have at v_idx=tf_label, usually
      the FIRST value committed, not the value the consolidator actually
      promoted).

    Construction:
      - For each PROMOTE audit record at episode_id, set
        promote_candidate[slot] = adapter_v_idx_from_record.
      - For each RETROGRADE record, set retrograde_candidate[slot] =
        previously-committed adapter_v_idx (the slot was in bank with
        present=True before this record; we use record.value_idx which
        is the adapter v_idx of the demoted value).
      - For each PRUNE, append to prune_candidate[slot].
      - tf prop_result is used to populate confirmation_count, slot_age,
        last_activity, latent_status_pressure, challenger_strength.
      - raw_v15_7a_signals carries _origin='cross_substrate.audit_and_tf'
        plus tf metrics for downstream observability.
    """
    from unified_fragmergent_memory.sources.memory_engine_runtime import (
        LatentSignals,
    )

    label_predictions = np.asarray(prop_result.get("label_predictions", []))
    n_steps = int(label_predictions.size)

    promote_candidate_map: Dict[Tuple[str, str], int] = {}
    retrograde_candidate_map: Dict[Tuple[str, str], int] = {}
    prune_candidate_map: Dict[Tuple[str, str], List[int]] = {}
    conflict_persistence_set: set = set()
    confirmation_count_map: Dict[Tuple[str, str], Dict[int, int]] = {}
    challenger_strength_map: Dict[Tuple[str, str], float] = {}
    slot_age_map: Dict[Tuple[str, str], int] = {}
    last_activity_map: Dict[Tuple[str, str], int] = {}
    latent_status_pressure_map: Dict[Tuple[str, str], float] = {}

    episode_audit = [
        r for r in audit_records
        if getattr(r, "episode_id", None) == episode_id
    ]

    for r in episode_audit:
        op = getattr(r, "operation", None)
        ent = getattr(r, "entity_id", None)
        attr = getattr(r, "attr_type", None)
        raw_v = getattr(r, "value_idx", None)
        v_idx = int(raw_v) if raw_v is not None else -1
        slot = (ent, attr)
        if slot not in label_slot_registry:
            continue
        if op == "PROMOTE" and v_idx >= 0:
            promote_candidate_map[slot] = v_idx
        elif op == "RETROGRADE" and v_idx >= 0:
            retrograde_candidate_map[slot] = v_idx
        elif op == "PRUNE" and v_idx >= 0:
            prune_candidate_map.setdefault(slot, []).append(v_idx)
        elif op == "RECONCILE":
            # RECONCILE often signals persistent activity on the slot.
            conflict_persistence_set.add(slot)

    # Per-slot diagnostics: derive from BOTH audit and tf result.
    seen_slots = set(promote_candidate_map) | set(retrograde_candidate_map) \
                 | set(prune_candidate_map) | conflict_persistence_set
    label_to_slot: Dict[int, Tuple[str, str]] = {
        v: k for k, v in label_slot_registry.items()
    }
    if n_steps > 0:
        for lbl in np.unique(label_predictions).tolist():
            slot_for_lbl = label_to_slot.get(int(lbl))
            if slot_for_lbl is None:
                continue
            seen_slots.add(slot_for_lbl)

    for slot in seen_slots:
        # Best-effort: count appearances of this slot's tf label in
        # label_predictions for confirmation_count, fall back to op count.
        if slot in label_slot_registry and n_steps > 0:
            tf_label = label_slot_registry[slot]
            n_seen = int(np.sum(label_predictions == tf_label))
            confirmation_count_map[slot] = {tf_label: n_seen}
            challenger_strength_map[slot] = float(n_seen)
        else:
            confirmation_count_map[slot] = {}
            challenger_strength_map[slot] = 0.0
        slot_age_map[slot] = max(1, n_steps)
        last_activity_map[slot] = max(1, n_steps)
        latent_status_pressure_map[slot] = float(min(
            1.0,
            0.20 * challenger_strength_map[slot] + 0.10 * len(seen_slots),
        ))

    raw = {
        "_origin": "cross_substrate.audit_and_tf_to_signals",
        "triggered_by_idempotent_step": bool(triggered_by_idempotent_step),
        "episode_id": int(episode_id),
        "n_audit_records": len(episode_audit),
        "audit_op_counts": {
            op: sum(1 for r in episode_audit if getattr(r, "operation", None) == op)
            for op in ("RECONCILE", "PRUNE", "RETROGRADE", "PROMOTE", "PROMOTE_SKIPPED")
        },
        "tf_label_sequence": label_predictions.tolist() if n_steps > 0 else [],
        "tf_q_vec_final_norm": float(
            np.linalg.norm(prop_result.get("q_vec_final", np.zeros(1)))
        ),
        "tf_q_mi_final": float(prop_result.get("q_mi_final", 0.0)),
    }

    return LatentSignals(
        promote_candidate=promote_candidate_map,
        retrograde_candidate=retrograde_candidate_map,
        prune_candidate=prune_candidate_map,
        conflict_persistence=conflict_persistence_set,
        confirmation_count=confirmation_count_map,
        challenger_strength=challenger_strength_map,
        slot_age=slot_age_map,
        last_activity=last_activity_map,
        latent_status_pressure=latent_status_pressure_map,
        raw_v15_7a_signals=raw,
    )


def tf_result_to_synthetic_signals(
    prop_result: Dict[str, Any],
    label_slot_registry: Dict[Tuple[str, str], int],
    triggered_by_idempotent_step: bool = False,
) -> Any:
    """Build a LatentSignals-shaped object from tf_engine propagation output.

    The mapping rules:
      - If label_predictions stabilize over the last steps (mode equals last),
        the dominant label maps back to a slot which is recorded as a
        promote_candidate.
      - If label_predictions oscillate (last differs from mode), the dominant
        slot is recorded as conflict_persistence with a strength equal to the
        oscillation rate.
      - confirmation_count is the number of consecutive identical predictions
        at the tail.
      - challenger_strength is 1.0 - tail_consistency (0 if fully stable, 1 if
        fully unstable).
      - latent_status_pressure aggregates: clip(0.2 * confirmation_count + 0.1
        * len(unique_labels), 0, 1).

    Returns an instance of the runtime project's LatentSignals dataclass.
    Constructed via the runtime passthrough so no fields are renamed (R1, I4).
    """
    from unified_fragmergent_memory.sources.memory_engine_runtime import (
        LatentSignals,
    )

    label_predictions = np.asarray(prop_result.get("label_predictions", []))
    n_steps = int(label_predictions.size)
    if n_steps == 0:
        return _empty_signals(LatentSignals, triggered_by_idempotent_step)

    last = int(label_predictions[-1])
    # Tail consistency: how many of the last steps agree with the last prediction.
    tail_consistency = int(np.sum(label_predictions == last)) / n_steps
    trailing_run = int(_trailing_run_length(label_predictions))
    unique_labels = np.unique(label_predictions)

    # Reverse the registry to look up slot from label.
    label_to_slot: Dict[int, Tuple[str, str]] = {
        v: k for k, v in label_slot_registry.items()
    }

    # All signal fields are slot-keyed dicts/sets per the runtime LatentSignals
    # contract. We populate entries only for slots whose label was observed.
    promote_candidate_map: Dict[Tuple[str, str], int] = {}
    retrograde_candidate_map: Dict[Tuple[str, str], int] = {}
    conflict_persistence_set: set = set()
    confirmation_count_map: Dict[Tuple[str, str], Dict[int, int]] = {}
    challenger_strength_map: Dict[Tuple[str, str], float] = {}
    slot_age_map: Dict[Tuple[str, str], int] = {}
    last_activity_map: Dict[Tuple[str, str], int] = {}
    latent_status_pressure_map: Dict[Tuple[str, str], float] = {}

    if tail_consistency >= 0.7 and last in label_to_slot:
        promote_candidate_map[label_to_slot[last]] = int(last)

    if tail_consistency <= 0.5 and len(unique_labels) >= 2 and last in label_to_slot:
        conflict_persistence_set.add(label_to_slot[last])

    if n_steps >= 2:
        first = int(label_predictions[0])
        if first != last and first in label_to_slot:
            retrograde_candidate_map[label_to_slot[first]] = int(first)

    # For every label seen, populate per-slot diagnostics if the slot is registered.
    for lbl in unique_labels.tolist():
        if lbl not in label_to_slot:
            continue
        slot = label_to_slot[int(lbl)]
        n_seen = int(np.sum(label_predictions == lbl))
        confirmation_count_map[slot] = {int(lbl): n_seen}
        challenger_strength_map[slot] = float(n_seen)
        slot_age_map[slot] = n_steps
        last_activity_map[slot] = n_steps
        latent_status_pressure_map[slot] = float(
            min(1.0, 0.20 * trailing_run + 0.10 * len(unique_labels))
        )

    raw = {
        "_origin": "cross_substrate.tf_result_to_synthetic_signals",
        "triggered_by_idempotent_step": bool(triggered_by_idempotent_step),
        "tail_consistency": tail_consistency,
        "n_unique_labels": int(len(unique_labels)),
        "label_sequence": label_predictions.tolist(),
        "trailing_run_length": trailing_run,
        "q_vec_final_norm": float(np.linalg.norm(prop_result.get("q_vec_final", np.zeros(1)))),
        "q_mi_final": float(prop_result.get("q_mi_final", 0.0)),
    }

    return LatentSignals(
        promote_candidate=promote_candidate_map,
        retrograde_candidate=retrograde_candidate_map,
        prune_candidate={},
        conflict_persistence=conflict_persistence_set,
        confirmation_count=confirmation_count_map,
        challenger_strength=challenger_strength_map,
        slot_age=slot_age_map,
        last_activity=last_activity_map,
        latent_status_pressure=latent_status_pressure_map,
        raw_v15_7a_signals=raw,
    )


def _trailing_run_length(arr: np.ndarray) -> int:
    if arr.size == 0:
        return 0
    last = arr[-1]
    n = 0
    for x in arr[::-1]:
        if x == last:
            n += 1
        else:
            break
    return n


def _empty_signals(LatentSignalsCls: type, triggered_by_idempotent_step: bool) -> Any:
    return LatentSignalsCls(
        promote_candidate={},
        retrograde_candidate={},
        prune_candidate={},
        conflict_persistence=set(),
        confirmation_count={},
        challenger_strength={},
        slot_age={},
        last_activity={},
        latent_status_pressure={},
        raw_v15_7a_signals={
            "_origin": "cross_substrate.empty",
            "triggered_by_idempotent_step": bool(triggered_by_idempotent_step),
        },
    )


def pressure_to_query_seed(
    pressure: Any,
    bank: Dict[str, Any],
    label_slot_registry: Dict[Tuple[str, str], int],
    seed_strength: float = 1.0,
) -> Tuple[np.ndarray, float]:
    """Compose an initial (q_vec, q_mi) from an active LatentDecisionPressure.

    Strategy:
      1. If pressure has a non-empty promote_slots map, pick the deterministic
         smallest slot (lex order on (entity_id, attr_type)) whose label is
         registered, and use that label's centroid as the seed.
      2. Otherwise, use the centroid of the smallest registered label as a
         neutral seed.
      3. If the bank has no registered labels at all, return (zero_vec, 0.0).

    Returns (q_vec, q_mi). Both are read-only views into the bank; the caller
    should copy if it intends to mutate.
    """
    vectors = np.asarray(bank["vectors"])
    mis = np.asarray(bank["mis"])
    labels = np.asarray(bank["labels"])
    dim = vectors.shape[1] if vectors.ndim == 2 else 0
    if dim == 0:
        return np.zeros(1, dtype=np.float64), 0.0

    chosen_label: Optional[int] = None
    if pressure is not None and not getattr(pressure, "is_empty", lambda: True)():
        promote_map = getattr(pressure, "promote_slots", {}) or {}
        if promote_map:
            for slot in sorted(promote_map.keys()):
                if slot in label_slot_registry:
                    chosen_label = label_slot_registry[slot]
                    break

    if chosen_label is None:
        unique_labels = np.unique(labels[labels >= 0])
        if unique_labels.size:
            chosen_label = int(unique_labels[0])

    if chosen_label is None:
        return np.zeros(dim, dtype=np.float64), 0.0

    mask = labels == chosen_label
    if not mask.any():
        return np.zeros(dim, dtype=np.float64), 0.0

    centroid = vectors[mask].mean(axis=0).astype(np.float64)
    centroid_mi = float(mis[mask].mean())
    return seed_strength * centroid, seed_strength * centroid_mi
