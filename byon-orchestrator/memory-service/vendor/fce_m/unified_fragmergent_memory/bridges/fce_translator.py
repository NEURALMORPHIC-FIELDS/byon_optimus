"""UFME -> FCE-Ω semantic bridge.

Translates UFME memory events (slot_events, runtime snapshots, episode
records) into FCE-Ω observation inputs (field excitation vectors, anchor
scalars, semantic-center identifiers).

This module is intentionally pure: it does not mutate runtime state and it
does not import the FCE-Ω wrapper (so it can be tested without FCE-Ω being
installed). Numerics use a fixed deterministic projection so two identical
events always produce the same delta_X.

Per misiunea.txt §4:
  - COMMITTED slots increase coherent assimilation E_t (aligned excitation).
  - PROVISIONAL slots inject tension (excitation with a small residue tail).
  - DISPUTED slots emphasize the residue component (Ξ_t-heavy excitation).
  - Promote / retrograde / consolidate events shift the field; they do not
    decide truth here (D_Cortex / runtime keeps that authority).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np


# Per misiunea.txt §4: zone semantics -> field interpretation. The numbers
# are passive weights; they only color the excitation, they do not change
# the UFME zone or the epistemic status.
ZONE_FIELD_WEIGHTS: Dict[str, Dict[str, float]] = {
    "COMMITTED":   {"coherence": 1.00, "tension": 0.10, "residue": 0.05},
    "PROVISIONAL": {"coherence": 0.45, "tension": 0.70, "residue": 0.25},
    "DISPUTED":    {"coherence": 0.20, "tension": 0.55, "residue": 0.95},
    "NONE":        {"coherence": 0.10, "tension": 0.05, "residue": 0.05},
}


def _hash_to_unit_vector(seed_key: str, D: int) -> np.ndarray:
    """Deterministic projection of a string key into a unit vector in R^D.

    Uses SHA-256 of the key to seed a numpy Generator; this gives a
    reproducible, well-distributed direction without needing a learned
    embedding model. The result is unit-normalized.
    """
    h = hashlib.sha256(seed_key.encode("utf-8")).digest()
    seed = int.from_bytes(h[:8], "big", signed=False)
    rng = np.random.default_rng(seed)
    v = rng.standard_normal(D)
    n = float(np.linalg.norm(v))
    if n < 1e-12:
        v = np.zeros(D, dtype=np.float64)
        v[0] = 1.0
        return v
    return (v / n).astype(np.float64)


def semantic_center_key(entity_id: str, attr_type: str) -> str:
    """Stable key used to identify a (entity, attr) cluster across episodes."""
    return f"{entity_id}::{attr_type}"


@dataclass
class FCEObservation:
    """One field excitation derived from one UFME event.

    Fields
    ------
    center_key : str
        Semantic center this observation belongs to. The observer groups
        observations by center_key when deciding which Agent receives the
        delta_X.
    delta_X : np.ndarray
        Field excitation in R^D. Length D matches the observer's field
        dimension.
    coherence_weight : float
        Fraction of delta_X aligned with the agent's Phi_s direction
        (intended for E_t). Always in [0, 1].
    residue_weight : float
        Fraction of delta_X expected to remain unassimilated (Xi_t).
        Always in [0, 1]. coherence_weight + residue_weight need not
        sum to 1.
    zone : str
        Zone tag this observation came from (COMMITTED / PROVISIONAL /
        DISPUTED / NONE). Used for audit, not for math.
    source_event : Dict[str, Any]
        Original UFME event (slot_event or tension_event). Kept for
        provenance so an OmegaRecord can be traced back.
    """

    center_key: str
    delta_X: np.ndarray
    coherence_weight: float
    residue_weight: float
    zone: str
    source_event: Dict[str, Any] = field(default_factory=dict)


def slot_event_to_observation(
    slot_event: Dict[str, Any],
    D: int,
) -> FCEObservation:
    """Translate one runtime slot_event into an FCE-Ω observation.

    The schema mirrors what UnifiedMemoryStore._write_runtime emits:
        {entity, family, value_after, value_before, zone_before, zone_after,
         episode_id, write_step, reason}

    The function never raises on unknown zones; it falls back to NONE
    weights and records the seen zone string verbatim in `zone`.
    """
    entity = str(slot_event.get("entity", ""))
    family = str(slot_event.get("family", ""))
    value_after = str(slot_event.get("value_after", ""))
    zone_after_raw = str(slot_event.get("zone_after", "NONE"))
    zone = zone_after_raw.upper()
    weights = ZONE_FIELD_WEIGHTS.get(zone, ZONE_FIELD_WEIGHTS["NONE"])

    # Direction comes from (entity, attr) — stable across value changes so
    # successive writes to the same slot perturb the same center.
    center = semantic_center_key(entity, family)
    direction = _hash_to_unit_vector(center, D)

    # Magnitude has two parts: a coherent push along `direction` (size
    # weights["coherence"]) and a noisy orthogonal perturbation (size
    # weights["residue"]), seeded by the value so the same value writes
    # are stable.
    value_seed = f"{center}|{value_after}"
    noise_vec = _hash_to_unit_vector(value_seed + "|noise", D)
    # Orthogonalize the noise against `direction` so coherence and
    # residue contributions are linearly independent.
    proj = float(np.dot(noise_vec, direction))
    noise_perp = noise_vec - proj * direction
    n = float(np.linalg.norm(noise_perp))
    if n > 1e-12:
        noise_perp = noise_perp / n
    else:
        noise_perp = np.zeros(D, dtype=np.float64)

    delta_X = (
        weights["coherence"] * direction
        + weights["residue"] * noise_perp
    )

    return FCEObservation(
        center_key=center,
        delta_X=delta_X.astype(np.float64),
        coherence_weight=float(weights["coherence"]),
        residue_weight=float(weights["residue"]),
        zone=zone,
        source_event={
            "kind": "slot_event",
            "entity": entity,
            "family": family,
            "value_after": value_after,
            "zone_after": zone,
            "episode_id": slot_event.get("episode_id"),
            "write_step": slot_event.get("write_step"),
        },
    )


def tension_event_to_observation(
    tension_event: Dict[str, Any],
    D: int,
) -> FCEObservation:
    """Translate a tension_event into a residue-dominated FCE-Ω observation.

    A tension_event represents a conflict in the runtime; we project it as
    a high-residue, low-coherence perturbation at the slot's center, which
    is precisely the kind of input that grows Z in the FCE-Ω formalism.
    """
    entity = str(
        tension_event.get("entity")
        or tension_event.get("head_entity")
        or ""
    )
    family = str(
        tension_event.get("family")
        or tension_event.get("attr_type")
        or ""
    )
    center = semantic_center_key(entity, family)
    direction = _hash_to_unit_vector(center, D)
    # tension_id (or trace_id) seeds the noise so different tensions on the
    # same slot still produce distinct observations.
    seed = str(
        tension_event.get("tension_id")
        or tension_event.get("trace_id")
        or tension_event.get("write_step")
        or ""
    )
    noise_vec = _hash_to_unit_vector(f"{center}|tension|{seed}", D)
    proj = float(np.dot(noise_vec, direction))
    noise_perp = noise_vec - proj * direction
    n = float(np.linalg.norm(noise_perp))
    if n > 1e-12:
        noise_perp = noise_perp / n
    else:
        noise_perp = np.zeros(D, dtype=np.float64)

    # Tension events emphasize residue and dampen coherence.
    coherence_w = 0.15
    residue_w = 0.90
    delta_X = coherence_w * direction + residue_w * noise_perp

    return FCEObservation(
        center_key=center,
        delta_X=delta_X.astype(np.float64),
        coherence_weight=coherence_w,
        residue_weight=residue_w,
        zone="DISPUTED",
        source_event={
            "kind": "tension_event",
            "entity": entity,
            "family": family,
            "tension_id": tension_event.get("tension_id"),
            "episode_id": tension_event.get("episode_id"),
        },
    )


def anchor_from_runtime_snapshot(snapshot: Dict[str, Any]) -> float:
    """Derive a [0, 1] GLOBAL anchor scalar from a runtime metrics snapshot.

    Backward-compat for v0.4.0 callers. v0.4.1 introduces
    anchor_from_center_counts() and the FCE-Omega observer no longer
    routes through this aggregated form (it leaked inter-center signals
    by construction). Mission §4 semantics preserved here unchanged:

        anchor = committed / (committed + 0.5 * provisional + disputed + 1)
    """
    committed = float(snapshot.get("n_committed_slots", 0))
    provisional = float(snapshot.get("n_provisional_entries", 0))
    disputed = float(snapshot.get("n_tension_events", 0))
    denom = committed + 0.5 * provisional + disputed + 1.0
    return float(committed / denom)


def anchor_from_center_counts(committed: int, provisional: int,
                              disputed: int) -> float:
    """Per-center anchor scalar in [0, 1] from per-center zone counts.

    v0.4.1 isolation: the observer maintains its own per-center
    counters seeded only by events whose center_key matches; disputed
    writes on center B never enter center A's totals. The formula
    matches anchor_from_runtime_snapshot so log readers see the same
    shape and value range — just keyed per center now.
    """
    c = max(0, int(committed))
    p = max(0, int(provisional))
    d = max(0, int(disputed))
    denom = c + 0.5 * p + d + 1.0
    return float(c / denom)


def collect_observations_from_adapter(
    slot_event_log: List[Dict[str, Any]],
    tension_event_log: List[Dict[str, Any]],
    D: int,
    since_index: int = 0,
    since_tension_index: int = 0,
) -> Tuple[List[FCEObservation], int, int]:
    """Batch-translate the new tail of the runtime event logs.

    Returns the list of FCEObservation instances plus the new "since"
    cursors so the observer can do incremental ingest:
        obs_list, next_slot_cursor, next_tension_cursor.
    """
    obs: List[FCEObservation] = []
    for ev in slot_event_log[since_index:]:
        obs.append(slot_event_to_observation(ev, D))
    for ev in tension_event_log[since_tension_index:]:
        obs.append(tension_event_to_observation(ev, D))
    return obs, len(slot_event_log), len(tension_event_log)


def _slot_event_dict(ev: Any) -> Optional[Dict[str, Any]]:
    """Best-effort conversion of a runtime SlotEvent into a plain dict.

    The runtime adapter may store events as dataclasses or plain dicts.
    This helper normalizes both shapes so the bridge stays decoupled from
    the runtime's internal representation.
    """
    if isinstance(ev, dict):
        return ev
    for attr in ("__dict__", "_asdict"):
        if hasattr(ev, attr):
            try:
                if attr == "__dict__":
                    return dict(ev.__dict__)
                return dict(ev._asdict())
            except Exception:
                pass
    # Last resort: pull known fields via getattr.
    return {
        "entity": getattr(ev, "entity", None),
        "family": getattr(ev, "family", None),
        "value_after": getattr(ev, "value_after", None),
        "zone_after": getattr(ev, "zone_after", None),
        "episode_id": getattr(ev, "episode_id", None),
        "write_step": getattr(ev, "write_step", None),
    }
