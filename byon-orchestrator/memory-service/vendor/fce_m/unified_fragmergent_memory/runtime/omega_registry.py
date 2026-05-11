"""Omega Registry for FCE-Ω coagulated nuclei.

Per misiunea.txt §3 and §4 of the Etape de implementare:

  * An Ω-nucleus is NOT just a memory; it is a reference point. After a
    semantic center crosses the FCE-Ω threshold (S_t >= theta for >= tau
    cycles), an `OmegaRecord` is appended here.

  * Coagulation is irreversible (mission §6 + R8 / test "omega_irreversibility"):
    once a record exists, the historical fact of its coagulation cannot be
    erased. The current *expression* of the Ω may oscillate (active /
    inexpressed / contested), but `coagulated_at_episode` and the record
    itself stay.

  * The registry is **not** a truth oracle (mission §6 + test "not_truth"):
    a contested expression on an Ω never overrides the runtime's epistemic
    decisions on the underlying slot. Contestation is recorded here as
    morphogenetic information, not as a memory write.

The registry is kept separate from the UFME audit_log because it tracks an
ontological transition, not an episode op count.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional


EXPRESSION_ACTIVE = "active"
EXPRESSION_INEXPRESSED = "inexpressed"
EXPRESSION_CONTESTED = "contested"

VALID_EXPRESSION_STATES = frozenset({
    EXPRESSION_ACTIVE,
    EXPRESSION_INEXPRESSED,
    EXPRESSION_CONTESTED,
})


@dataclass
class OmegaRecord:
    """A coagulated FCE-Ω nucleus tied back to UFME provenance.

    Fields
    ------
    omega_id : str
        Deterministic 16-hex id derived from semantic_center + coagulation
        episode + S_t at coagulation. Stable across reloads.
    semantic_center : str
        "entity_id::attr_type" key produced by bridges.fce_translator.
    coagulated_at_episode : int
        Episode id at which check_coagulation flipped Omega 0 -> 1.
    coagulated_at_cycle : int
        Internal FCE-Ω cycle count when coagulation triggered. Used by
        provenance to map back to the observer's morphogenesis log.
    S_t_at_coagulation : float
        Self-Index at coagulation. Kept for the sine_type classification.
    kappa_at_coagulation : float
        Coherence kappa at coagulation. Required for sine_type.
    sine_type : str
        One of {"integrative", "operational", "turbulent"} (per
        Agent.sine_type at coagulation time).
    source_episodes : List[int]
        Every UFME episode that contributed observations to this center
        prior to coagulation.
    source_events : List[Dict[str, Any]]
        Provenance breadcrumbs of the slot_events / tension_events that
        drove the coagulation. Each entry is the small dict produced by
        bridges.fce_translator.slot_event_to_observation.source_event.
    duration_above_threshold : int
        Consecutive cycles spent at S_t >= theta_s before flipping.
    expression_state : str
        One of {"active", "inexpressed", "contested"}. Never
        "uncoagulated"; the registry has no representation for that.
    expression_history : List[Dict[str, Any]]
        Append-only log of expression-state changes with (episode_id,
        new_state, reason). The current state is also the last entry's
        new_state.
    """

    omega_id: str
    semantic_center: str
    coagulated_at_episode: int
    coagulated_at_cycle: int
    S_t_at_coagulation: float
    kappa_at_coagulation: float
    sine_type: str
    source_episodes: List[int] = field(default_factory=list)
    source_events: List[Dict[str, Any]] = field(default_factory=list)
    duration_above_threshold: int = 0
    expression_state: str = EXPRESSION_ACTIVE
    expression_history: List[Dict[str, Any]] = field(default_factory=list)

    def to_json_safe(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_json_safe(cls, payload: Dict[str, Any]) -> "OmegaRecord":
        return cls(
            omega_id=str(payload["omega_id"]),
            semantic_center=str(payload["semantic_center"]),
            coagulated_at_episode=int(payload["coagulated_at_episode"]),
            coagulated_at_cycle=int(payload["coagulated_at_cycle"]),
            S_t_at_coagulation=float(payload["S_t_at_coagulation"]),
            kappa_at_coagulation=float(payload["kappa_at_coagulation"]),
            sine_type=str(payload["sine_type"]),
            source_episodes=list(payload.get("source_episodes", [])),
            source_events=list(payload.get("source_events", [])),
            duration_above_threshold=int(payload.get("duration_above_threshold", 0)),
            expression_state=str(payload.get("expression_state", EXPRESSION_ACTIVE)),
            expression_history=list(payload.get("expression_history", [])),
        )


def _make_omega_id(
    semantic_center: str,
    coagulated_at_episode: int,
    S_t_at_coagulation: float,
) -> str:
    seed = "::".join([
        "omega",
        semantic_center,
        str(int(coagulated_at_episode)),
        f"{float(S_t_at_coagulation):.6f}",
    ])
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]


class OmegaRegistry:
    """Append-only registry of FCE-Ω coagulations.

    The registry is keyed by semantic_center because a center is the
    coagulated object, not an arbitrary event. A second coagulation event
    on the same center is *not* a new record — the record already exists,
    and we only update expression_state / expression_history.
    """

    def __init__(self) -> None:
        self._records: Dict[str, OmegaRecord] = {}

    # --- core registration ---------------------------------------------

    def has(self, semantic_center: str) -> bool:
        return semantic_center in self._records

    def get(self, semantic_center: str) -> Optional[OmegaRecord]:
        return self._records.get(semantic_center)

    def get_by_id(self, omega_id: str) -> Optional[OmegaRecord]:
        for rec in self._records.values():
            if rec.omega_id == omega_id:
                return rec
        return None

    def register(
        self,
        semantic_center: str,
        coagulated_at_episode: int,
        coagulated_at_cycle: int,
        S_t_at_coagulation: float,
        kappa_at_coagulation: float,
        sine_type: str,
        source_episodes: List[int],
        source_events: List[Dict[str, Any]],
        duration_above_threshold: int,
    ) -> OmegaRecord:
        """Register a coagulation. Idempotent: if the center is already
        registered, return the existing record (coagulation is
        irreversible — we never replace the record)."""
        existing = self._records.get(semantic_center)
        if existing is not None:
            return existing
        omega_id = _make_omega_id(
            semantic_center, coagulated_at_episode, S_t_at_coagulation
        )
        rec = OmegaRecord(
            omega_id=omega_id,
            semantic_center=semantic_center,
            coagulated_at_episode=int(coagulated_at_episode),
            coagulated_at_cycle=int(coagulated_at_cycle),
            S_t_at_coagulation=float(S_t_at_coagulation),
            kappa_at_coagulation=float(kappa_at_coagulation),
            sine_type=str(sine_type),
            source_episodes=list(sorted(set(int(e) for e in source_episodes))),
            source_events=list(source_events),
            duration_above_threshold=int(duration_above_threshold),
            expression_state=EXPRESSION_ACTIVE,
            expression_history=[{
                "episode_id": int(coagulated_at_episode),
                "new_state": EXPRESSION_ACTIVE,
                "reason": "coagulation",
            }],
        )
        self._records[semantic_center] = rec
        return rec

    # --- expression transitions ----------------------------------------

    def set_expression_state(
        self,
        semantic_center: str,
        new_state: str,
        episode_id: int,
        reason: str = "",
    ) -> OmegaRecord:
        """Update only the current expression state; the historical fact
        of coagulation is preserved.

        Raises KeyError if the center has never been registered (the
        registry refuses to invent records via expression updates).
        """
        if new_state not in VALID_EXPRESSION_STATES:
            raise ValueError(
                f"new_state must be one of {sorted(VALID_EXPRESSION_STATES)}, "
                f"got {new_state!r}"
            )
        rec = self._records.get(semantic_center)
        if rec is None:
            raise KeyError(
                f"OmegaRegistry: cannot transition unknown center "
                f"{semantic_center!r}. Register coagulation first."
            )
        if rec.expression_state != new_state:
            rec.expression_state = new_state
            rec.expression_history.append({
                "episode_id": int(episode_id),
                "new_state": new_state,
                "reason": reason,
            })
        return rec

    def mark_contested(
        self, semantic_center: str, episode_id: int, reason: str = ""
    ) -> OmegaRecord:
        return self.set_expression_state(
            semantic_center, EXPRESSION_CONTESTED, episode_id, reason
        )

    def mark_inexpressed(
        self, semantic_center: str, episode_id: int, reason: str = ""
    ) -> OmegaRecord:
        return self.set_expression_state(
            semantic_center, EXPRESSION_INEXPRESSED, episode_id, reason
        )

    def mark_active(
        self, semantic_center: str, episode_id: int, reason: str = ""
    ) -> OmegaRecord:
        return self.set_expression_state(
            semantic_center, EXPRESSION_ACTIVE, episode_id, reason
        )

    # --- enumeration ----------------------------------------------------

    def __len__(self) -> int:
        return len(self._records)

    def __iter__(self):
        return iter(self._records.values())

    def all_records(self) -> List[OmegaRecord]:
        return list(self._records.values())

    def active_records(self) -> List[OmegaRecord]:
        return [r for r in self._records.values()
                if r.expression_state == EXPRESSION_ACTIVE]

    # --- snapshot and persistence --------------------------------------

    def snapshot(self) -> Dict[str, Any]:
        return {
            "count": len(self._records),
            "active": sum(
                1 for r in self._records.values()
                if r.expression_state == EXPRESSION_ACTIVE
            ),
            "contested": sum(
                1 for r in self._records.values()
                if r.expression_state == EXPRESSION_CONTESTED
            ),
            "inexpressed": sum(
                1 for r in self._records.values()
                if r.expression_state == EXPRESSION_INEXPRESSED
            ),
            "records": [r.to_json_safe() for r in self._records.values()],
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
        self._records = {}
        for entry in payload.get("records", []):
            rec = OmegaRecord.from_json_safe(entry)
            self._records[rec.semantic_center] = rec
