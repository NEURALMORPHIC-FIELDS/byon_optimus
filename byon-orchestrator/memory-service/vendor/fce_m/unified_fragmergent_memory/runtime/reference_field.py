"""Native memory prototype: ReferenceField derived from OmegaRecord.

v0.6.0 introduces the distinction between:

  - OmegaRecord     = the historical, IRREVERSIBLE fact of coagulation
                      (omega_id, coagulated_at_episode, S_t_at_coagulation,
                      kappa_at_coagulation are immutable forever)
  - ReferenceField  = a FUNCTIONAL field derived from a coagulated center,
                      used to interpret FUTURE events in morphogenetic
                      terms (aligned, tensioned, contested, etc.)

ReferenceField MAY fluctuate in `expression_state` and `strength` based
on subsequent observations. It does NOT change OmegaRecord and it does
NOT alter UFME's epistemic verdicts (slot zones, audit_log).

Native memory in the sense used by mission §10 = past coagulations
become internal reference structures that shape how new inputs are
read, not a database queried for answers.

Strict separation enforced:
  - A ReferenceField can only be created for a center that HAS an
    OmegaRecord. Centers without coagulation cannot have ReferenceField.
  - Centers without ReferenceField can still perturb the field (residue,
    tension), but cannot ENTER the Omega-field as nuclei.
  - Inter-ReferenceField interactions (omega_field_*) are recorded as
    advisory traces; they never auto-coagulate a third center.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np


REFERENCE_FIELD_ACTIVE = "active"
REFERENCE_FIELD_CONTESTED = "contested"
REFERENCE_FIELD_INEXPRESSED = "inexpressed"

VALID_REFERENCE_FIELD_STATES = frozenset({
    REFERENCE_FIELD_ACTIVE,
    REFERENCE_FIELD_CONTESTED,
    REFERENCE_FIELD_INEXPRESSED,
})


# Event classification kinds — read into morphogenetic terms, NOT
# epistemic. Mission §4 Etapa 5:
EVENT_KIND_ALIGNED = "aligned"
EVENT_KIND_EXPRESSION_REINFORCING = "expression_reinforcing"
EVENT_KIND_TENSIONED = "tensioned"
EVENT_KIND_ORTHOGONAL = "orthogonal"
EVENT_KIND_CONTESTED_EXPRESSION = "contested_expression"
EVENT_KIND_RESIDUE_AMPLIFYING = "residue_amplifying"

VALID_EVENT_KINDS = frozenset({
    EVENT_KIND_ALIGNED, EVENT_KIND_EXPRESSION_REINFORCING,
    EVENT_KIND_TENSIONED, EVENT_KIND_ORTHOGONAL,
    EVENT_KIND_CONTESTED_EXPRESSION, EVENT_KIND_RESIDUE_AMPLIFYING,
})


@dataclass
class ReferenceField:
    """Functional field projected from a coagulated center.

    Fields
    ------
    reference_id : str
        Stable 16-hex id derived from (omega_id, center_key).
    omega_id : str
        OmegaRecord this field is anchored to.
    center_key : str
        Semantic center.
    field_vector : List[float]
        The morphogenetic reference direction: a snapshot of the
        agent's Phi_s at coagulation time. Frozen for the life of
        the ReferenceField; expression may fluctuate, but the field
        direction does not drift.
    strength : float
        In [0, 1]. Decreases under sustained contestation; recovers
        under aligned reinforcement. Bounded; cannot go below 0 or
        above 1.
    expression_state : str
        active / contested / inexpressed. Mirrors the OmegaRecord's
        expression_state but tracks ReferenceField-specific dynamics.
    created_at_episode : int
    last_updated_episode : int
    source_omega_record : Dict[str, Any]
        Snapshot of relevant fields from the OmegaRecord at field
        creation: coagulated_at_episode, S_t_at_coagulation,
        kappa_at_coagulation, source_episodes, source_events. This
        is the provenance link from ReferenceField back to history.
    """

    reference_id: str
    omega_id: str
    center_key: str
    field_vector: List[float]
    strength: float
    expression_state: str
    created_at_episode: int
    last_updated_episode: int
    source_omega_record: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ReferenceFieldEvent:
    """Classification of a single FCE observation against an active
    ReferenceField. Audit-only; never used to gate UFME ops."""

    event_id: str
    reference_id: str
    omega_id: str
    center_key: str
    episode_id: int
    zone_seen: str
    kind: str  # one of VALID_EVENT_KINDS
    cosine_alignment: float
    delta_X_norm: float
    notes: str = (
        "morphogenetic classification only; UFME truth-status is unchanged"
    )


@dataclass
class OmegaFieldInteraction:
    """Higher-order interaction trace between two active ReferenceFields.

    Recorded ONLY for pairs whose centers both have an active
    ReferenceField AND were co-active in the same consolidate pass.
    A center without an OmegaRecord cannot appear in this trace.

    The trace is advisory: it never creates a third Omega, never sets
    a relation in a registry, never modifies UFME memory.
    """

    interaction_id: str
    center_i: str
    center_j: str
    omega_id_i: str
    omega_id_j: str
    episode_id: int
    field_alignment: float       # cos angle between field_vectors
    field_tension: float         # 1 - alignment, sign-aware
    resonance_score: float       # alignment * min(strength_i, strength_j)
    interference_score: float    # (1 - alignment) * min(strength_i, strength_j)


class ReferenceFieldRegistry:
    """Persist-friendly registry of ReferenceFields keyed by center."""

    def __init__(self) -> None:
        self._fields: Dict[str, ReferenceField] = {}

    @staticmethod
    def make_reference_id(omega_id: str, center_key: str) -> str:
        seed = f"reffield::{omega_id}::{center_key}"
        return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]

    def has(self, center_key: str) -> bool:
        return center_key in self._fields

    def get(self, center_key: str) -> Optional[ReferenceField]:
        return self._fields.get(center_key)

    def get_by_id(self, reference_id: str) -> Optional[ReferenceField]:
        for rf in self._fields.values():
            if rf.reference_id == reference_id:
                return rf
        return None

    def all(self) -> List[ReferenceField]:
        return list(self._fields.values())

    def __len__(self) -> int:
        return len(self._fields)

    def __iter__(self):
        return iter(self._fields.values())

    def register(
        self,
        omega_record: Dict[str, Any],
        center_key: str,
        field_vector: np.ndarray,
        strength: float,
        created_at_episode: int,
    ) -> ReferenceField:
        """Create a ReferenceField from an OmegaRecord. Idempotent: if
        a field already exists for this center, return the existing
        one (we never overwrite an already-projected reference)."""
        existing = self._fields.get(center_key)
        if existing is not None:
            return existing
        omega_id = str(omega_record["omega_id"])
        ref_id = self.make_reference_id(omega_id, center_key)
        rf = ReferenceField(
            reference_id=ref_id,
            omega_id=omega_id,
            center_key=center_key,
            field_vector=list(map(float, np.asarray(field_vector).tolist())),
            strength=float(max(0.0, min(1.0, strength))),
            expression_state=REFERENCE_FIELD_ACTIVE,
            created_at_episode=int(created_at_episode),
            last_updated_episode=int(created_at_episode),
            source_omega_record={
                "omega_id": omega_id,
                "coagulated_at_episode": int(
                    omega_record.get("coagulated_at_episode", 0)
                ),
                "S_t_at_coagulation": float(
                    omega_record.get("S_t_at_coagulation", 0.0)
                ),
                "kappa_at_coagulation": float(
                    omega_record.get("kappa_at_coagulation", 0.0)
                ),
                "sine_type": str(omega_record.get("sine_type", "")),
                "source_episodes": list(omega_record.get("source_episodes", [])),
                "source_event_count": len(
                    omega_record.get("source_events", []) or []
                ),
            },
        )
        self._fields[center_key] = rf
        return rf

    # --- expression / strength updates ---------------------------------

    STRENGTH_AT_CREATION: float = 0.80
    STRENGTH_DELTA_ALIGNED: float = +0.05
    STRENGTH_DELTA_TENSIONED: float = -0.02
    STRENGTH_DELTA_CONTESTED: float = -0.08
    STRENGTH_DELTA_RESIDUE: float = -0.04
    STRENGTH_FLOOR: float = 0.0
    STRENGTH_CEILING: float = 1.0

    CONTESTED_STRENGTH_THRESHOLD: float = 0.30
    INEXPRESSED_STRENGTH_THRESHOLD: float = 0.10

    def update_with_event(
        self,
        center_key: str,
        event_kind: str,
        episode_id: int,
    ) -> Optional[ReferenceField]:
        """Apply the bounded strength update for a classified event.

        Updates only the ReferenceField's strength + expression_state
        + last_updated_episode. NEVER touches OmegaRecord, NEVER
        touches UFME memory.
        """
        rf = self._fields.get(center_key)
        if rf is None:
            return None
        delta = {
            EVENT_KIND_ALIGNED: self.STRENGTH_DELTA_ALIGNED,
            EVENT_KIND_EXPRESSION_REINFORCING: self.STRENGTH_DELTA_ALIGNED,
            EVENT_KIND_TENSIONED: self.STRENGTH_DELTA_TENSIONED,
            EVENT_KIND_ORTHOGONAL: 0.0,
            EVENT_KIND_CONTESTED_EXPRESSION: self.STRENGTH_DELTA_CONTESTED,
            EVENT_KIND_RESIDUE_AMPLIFYING: self.STRENGTH_DELTA_RESIDUE,
        }.get(event_kind, 0.0)
        new_strength = float(max(
            self.STRENGTH_FLOOR,
            min(self.STRENGTH_CEILING, rf.strength + delta),
        ))
        rf.strength = new_strength
        rf.last_updated_episode = int(episode_id)
        # Expression-state transitions, bounded by strength bands.
        if new_strength < self.INEXPRESSED_STRENGTH_THRESHOLD:
            rf.expression_state = REFERENCE_FIELD_INEXPRESSED
        elif new_strength < self.CONTESTED_STRENGTH_THRESHOLD:
            rf.expression_state = REFERENCE_FIELD_CONTESTED
        else:
            rf.expression_state = REFERENCE_FIELD_ACTIVE
        return rf

    # --- snapshot / persist --------------------------------------------

    def snapshot(self) -> Dict[str, Any]:
        return {
            "count": len(self._fields),
            "active": sum(1 for f in self._fields.values()
                          if f.expression_state == REFERENCE_FIELD_ACTIVE),
            "contested": sum(1 for f in self._fields.values()
                             if f.expression_state == REFERENCE_FIELD_CONTESTED),
            "inexpressed": sum(1 for f in self._fields.values()
                               if f.expression_state == REFERENCE_FIELD_INEXPRESSED),
            "fields": [asdict(f) for f in self._fields.values()],
        }

    def persist(self, path: str) -> None:
        payload = self.snapshot()
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        os.replace(tmp, path)

    def load(self, path: str) -> None:
        if not os.path.exists(path):
            return
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        self._fields = {}
        for entry in payload.get("fields", []):
            rf = ReferenceField(**entry)
            self._fields[rf.center_key] = rf


# ---------------------------------------------------------------------
# Event classification: deterministic, zone-aware. Inputs are a single
# FCEObservation and an active ReferenceField. Output is a kind string.
# ---------------------------------------------------------------------

def classify_event_against_reference(
    delta_X: np.ndarray,
    zone: str,
    residue_weight: float,
    field_vector: np.ndarray,
) -> Dict[str, Any]:
    """Pure function: classify an observation against a ReferenceField.

    Returns {"kind": str, "cosine_alignment": float, "delta_X_norm": float}.
    Never raises on degenerate inputs; falls back to ORTHOGONAL.
    """
    n_dx = float(np.linalg.norm(delta_X))
    n_fv = float(np.linalg.norm(field_vector))
    if n_dx < 1e-12 or n_fv < 1e-12:
        return {
            "kind": EVENT_KIND_ORTHOGONAL,
            "cosine_alignment": 0.0,
            "delta_X_norm": n_dx,
        }
    cos = float(np.dot(delta_X, field_vector) / (n_dx * n_fv))
    abs_cos = abs(cos)
    zone_u = (zone or "").upper()

    if zone_u == "COMMITTED":
        if cos > 0.75:
            kind = EVENT_KIND_EXPRESSION_REINFORCING
        elif cos > 0.30:
            kind = EVENT_KIND_ALIGNED
        elif abs_cos < 0.30:
            kind = EVENT_KIND_ORTHOGONAL
        else:
            kind = EVENT_KIND_TENSIONED
    elif zone_u == "DISPUTED":
        # Residue-heavy disputed events with low alignment amplify
        # residue; otherwise the event contests the expression.
        if residue_weight > 0.70 and abs_cos < 0.40:
            kind = EVENT_KIND_RESIDUE_AMPLIFYING
        elif cos < 0.30:
            kind = EVENT_KIND_CONTESTED_EXPRESSION
        else:
            kind = EVENT_KIND_TENSIONED
    else:  # PROVISIONAL, NONE, unknown
        if cos > 0.50:
            kind = EVENT_KIND_ALIGNED
        elif abs_cos < 0.30:
            kind = EVENT_KIND_ORTHOGONAL
        else:
            kind = EVENT_KIND_TENSIONED

    return {
        "kind": kind,
        "cosine_alignment": cos,
        "delta_X_norm": n_dx,
    }
