"""FCE-Ω Morphogenesis Observer.

The observer is the v0.4.0 / Etapa 2 piece described in misiunea.txt:

    "Introduci un observator care rulează după consolidate. El construiește
     evenimente FCE din operațiile UFME. Output-ul lui este doar raport.
     Nu schimbă încă nimic în routing."

Contract (mission §6):
  * The observer is read-only with respect to UFME state. It never writes
    to the runtime adapter, the tf_engine bank, or D_Cortex.
  * The observer does NOT decide truth. It only measures field deformation
    induced by UFME operations and records what it sees.
  * Coagulation (Omega) is irreversible once recorded; expression state
    can still oscillate. The OmegaRegistry handles that invariant.

What it computes per observe() call:
  * For each semantic center touched by new slot_events / tension_events,
    advances the FCE-Ω Agent that represents that center by one step,
    using delta_X from the bridge.
  * Records S_t, AR, residue norm, kappa, alpha, lambda for each center.
  * Calls check_coagulation; on Omega 0 -> 1, registers a new OmegaRecord
    with provenance.

Wire-up (mission §5): UnifiedMemoryStore.consolidate() is the natural
window — the observer's observe_after_consolidate() is invoked there.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from unified_fragmergent_memory.bridges.fce_translator import (
    FCEObservation,
    anchor_from_center_counts,
    anchor_from_runtime_snapshot,  # kept exported for backward-compat consumers
    collect_observations_from_adapter,
    semantic_center_key,
)


@dataclass
class MorphogenesisRecord:
    """One entry in the observer's read-only morphogenesis log.

    Audit only. Never used to gate UFME ops; consumers can read this log to
    understand how a sequence of UFME operations deformed the FCE-Ω field.
    """

    episode_id: int
    cycle: int
    semantic_center: str
    zone_seen: str
    S_t: float
    AR: float
    kappa: float
    alpha: float
    rho: float
    lambda_ar: float
    Z_norm: float
    delta_X_norm: float
    omega: int
    newly_coagulated: bool
    omega_id: Optional[str]
    anchor: float


@dataclass
class MultiperspectiveInteractionTrace:
    """One ordered-pair interaction trace from the v0.5.0 multiperspectival
    observer. Records the magnitudes of the four FCE-Omega directional
    operators (absorption, repulsion, interference, directional
    coagulation) computed for i <- j, with class-wise normalization.

    The trace is read-only audit; it does NOT mutate UFME state. v0.5.0
    additionally applies a normalized reference-field anchor influence
    when one or both centers are coagulated, recorded in
    anchor_influence_from_omega.
    """

    episode_id: int
    center_i: str
    center_j: str
    cycle_i: int
    cycle_j: int
    Phi_s_alignment: float
    absorption_norm: float
    repulsion_norm: float
    interference_norm: float
    directional_coag_norm: float
    interference_antisym_residual: float
    anchor_influence_from_omega: float


@dataclass
class RelationCandidate:
    """Shared-coagulation candidate between two centers.

    Per misiunea.txt §1 and Etapa 3 contract, a high-S_t co-active pair
    can produce a relation-nucleus, but the registry must not auto-set
    Omega for either center based on this candidate alone. The candidate
    is morphogenetic information, not an epistemic verdict.
    """

    episode_id: int
    center_i: str
    center_j: str
    S_i: float
    S_j: float
    theta_pair: float
    shared_coag_norm: float
    note: str = (
        "advisory only; does not modify individual Omega; coagulation "
        "still requires each center to cross its own threshold rule"
    )


@dataclass
class FCEAdvisoryFeedback:
    """v0.5.1 semi-active advisory feedback item.

    The observer emits these in `priority_only` mode. They are inspectable
    priority-metadata recommendations with bounded delta and complete
    provenance. They are NEVER applied to UFME memory, slot zones,
    audit_log, or D_Cortex — the runtime stays the truth authority.

    Fields
    ------
    feedback_id : str
        Stable 16-hex id derived from (kind, center, episode).
    center_key : str
        Semantic center this recommendation is about.
    kind : str
        One of: high_residue, near_coagulation, coagulated_reference,
        contested_expression, fragmented, relation_candidate,
        incubation_recommended, delayed_consolidation_recommended.
    priority_delta : float
        Bounded in [-1.0, 1.0]. Positive = raise consolidation priority;
        negative = lower it (fragmented / unstable). Consumers MAY
        ignore this; UFME itself never reads it.
    recommended_action : str
        Short imperative phrase describing the recommended consumer
        action ("consolidate sooner", "incubate", "delay consolidation",
        "review expression", "review relation").
    reason : str
        Human-readable note. Always disclaims epistemic authority.
    source_trace_ids : List[str]
        Ids of interaction traces that contributed (if any).
    source_omega_ids : List[str]
        OmegaRecord ids touching this center.
    source_relation_candidate_ids : List[str]
        Ids of relation candidates referencing this center.
    applied : bool
        Whether this feedback has been acted on by a consumer; default
        False (the observer never marks True itself).
    mode : str
        Always 'priority_only' for emitted items.
    created_at_episode : int
    """

    feedback_id: str
    center_key: str
    kind: str
    priority_delta: float
    recommended_action: str
    reason: str
    source_trace_ids: List[str] = field(default_factory=list)
    source_omega_ids: List[str] = field(default_factory=list)
    source_relation_candidate_ids: List[str] = field(default_factory=list)
    applied: bool = False
    mode: str = "priority_only"
    created_at_episode: int = 0


@dataclass
class MorphogenesisReport:
    """Returned by observe_after_consolidate().

    Read-only summary the caller can log, surface in metrics, or use for
    advisory hooks (Etapa 5). Etapa 2 just returns it; no feedback yet.
    """

    episode_id: int
    cycles_advanced: int
    centers_touched: List[str]
    new_omega_ids: List[str]
    records: List[MorphogenesisRecord] = field(default_factory=list)
    interaction_traces: List[MultiperspectiveInteractionTrace] = field(default_factory=list)
    relation_candidates: List[RelationCandidate] = field(default_factory=list)

    def to_json_safe(self) -> Dict[str, Any]:
        return {
            "episode_id": int(self.episode_id),
            "cycles_advanced": int(self.cycles_advanced),
            "centers_touched": list(self.centers_touched),
            "new_omega_ids": list(self.new_omega_ids),
            "records": [asdict(r) for r in self.records],
            "interaction_traces": [asdict(t) for t in self.interaction_traces],
            "relation_candidates": [asdict(r) for r in self.relation_candidates],
        }


class FCEOmegaObserver:
    """Per-center FCE-Ω agents driven by UFME consolidation events.

    One Agent per semantic_center. The shared D-dimensional field is held
    inside each Agent's own state (Phi_s, Z) — there is no global X here;
    the bridge supplies delta_X directly per observation. This mirrors how
    the FCE-Ω regimes module composes per-agent dynamics over a shared
    field, except that the field here is implicit and the perturbations
    are content-derived (from UFME events), not synthetic.

    Parameters
    ----------
    D : int
        FCE field dimension. Default 16 keeps things cheap; production
        wiring should pick a value that matches the embedding space.
    theta_s : float
        Coagulation threshold for S_t.
    tau_coag : int
        Required consecutive cycles above theta_s before Omega flips.
    seed : int
        RNG seed for Agent initialization. The bridge's delta_X is
        deterministic; this only affects each Agent's initial Phi_s.
    omega_registry : OmegaRegistry, optional
        Where coagulations are appended. If None, the observer creates a
        fresh registry it owns.
    """

    def __init__(
        self,
        D: int = 16,
        theta_s: float = 0.28,
        tau_coag: int = 12,
        seed: int = 42,
        omega_registry: Optional[Any] = None,
        multiperspectival_enabled: bool = False,
        multiperspectival_anchor_eta: float = 0.30,
        multiperspectival_theta_pair: float = 0.20,
        advisory_mode: str = "read_only",
        reference_fields_enabled: bool = False,
    ) -> None:
        from unified_fragmergent_memory.runtime.omega_registry import (
            OmegaRegistry,
        )
        # Lazy import the FCE-Ω wrapper. Tests can patch this attribute to
        # exercise the observer without the FCE-Ω source on disk.
        from unified_fragmergent_memory.sources import fce_omega

        self._fce = fce_omega
        self.D = int(D)
        self.theta_s = float(theta_s)
        self.tau_coag = int(tau_coag)
        self._rng_seed = int(seed)

        # v0.5.0 multiperspectival observer.
        self.multiperspectival_enabled = bool(multiperspectival_enabled)
        self.multiperspectival_anchor_eta = float(multiperspectival_anchor_eta)
        self.multiperspectival_theta_pair = float(multiperspectival_theta_pair)

        # v0.5.1 semi-active advisory feedback mode. Default 'read_only'
        # leaves the observer behavior bit-identical to v0.5.0.
        if advisory_mode not in ("read_only", "priority_only"):
            raise ValueError(
                f"advisory_mode must be 'read_only' or 'priority_only', "
                f"got {advisory_mode!r}"
            )
        self.advisory_mode: str = str(advisory_mode)
        # Append-only feedback log; entries only appear when the
        # observer is in 'priority_only' mode and a consolidate pass
        # produced enough signal to recommend something. The list is
        # purely metadata — no consumer is forced to read it.
        self.advisory_feedback_log: List[FCEAdvisoryFeedback] = []

        # v0.6.0 native memory prototype. When ON, the observer
        # auto-creates a ReferenceField on each new coagulation and
        # classifies subsequent observations against the active fields.
        # OFF preserves v0.5.1 behavior bit-identical.
        from unified_fragmergent_memory.runtime.reference_field import (
            ReferenceFieldRegistry,
        )
        self.reference_fields_enabled: bool = bool(reference_fields_enabled)
        self.reference_field_registry = ReferenceFieldRegistry()
        self.reference_field_events: List[Any] = []
        self.omega_field_interactions: List[Any] = []

        self.omega_registry = omega_registry if omega_registry is not None \
            else OmegaRegistry()

        # Per-center FCE-Ω agent + cycle counter + provenance buffer.
        self._agents: Dict[str, Any] = {}
        self._cycles: Dict[str, int] = {}
        self._center_episodes: Dict[str, List[int]] = {}
        self._center_events: Dict[str, List[Dict[str, Any]]] = {}
        # v0.4.1: per-center zone counts. The observer's anchor is now
        # computed strictly from THIS center's history; disputed writes
        # on another center never bleed into this center's anchor.
        self._center_zone_counts: Dict[str, Dict[str, int]] = {}
        # v0.5.0: append-only multiperspectival traces and shared-
        # coagulation candidates. These are audit; the observer's agents
        # may receive normalized reference-field anchor influence, but
        # the runtime adapter is never touched by this composition.
        self.interaction_log: List[MultiperspectiveInteractionTrace] = []
        self.relation_candidates: List[RelationCandidate] = []
        # Cached delta_X per (center, episode) so the multiperspectival
        # composition has access to j's most recent excitation when
        # computing i <- j.
        self._last_delta_X: Dict[str, np.ndarray] = {}

        # Cursors into the runtime adapter's event logs. The observer reads
        # only the new tail per observation pass.
        self._slot_cursor: int = 0
        self._tension_cursor: int = 0

        # Read-only morphogenesis log. Append-only.
        self.morphogenesis_log: List[MorphogenesisRecord] = []

    # ------------------------------------------------------------------

    def _get_or_create_agent(self, center_key: str) -> Any:
        agent = self._agents.get(center_key)
        if agent is not None:
            return agent
        # Per-center seed so initialization is deterministic and unique.
        # Use hashlib (process-stable) rather than Python's hash() which
        # is randomized per process under PYTHONHASHSEED.
        import hashlib
        h = hashlib.sha256(center_key.encode("utf-8")).digest()
        seed = self._rng_seed + int.from_bytes(h[:4], "big")
        rng = np.random.default_rng(seed)
        agent_idx = len(self._agents)
        agent = self._fce.Agent(
            idx=agent_idx,
            D=self.D,
            rng=rng,
        )
        self._agents[center_key] = agent
        self._cycles[center_key] = 0
        self._center_episodes[center_key] = []
        self._center_events[center_key] = []
        self._center_zone_counts[center_key] = {
            "COMMITTED": 0, "PROVISIONAL": 0, "DISPUTED": 0, "NONE": 0,
        }
        return agent

    def _U_a_from_delta(self, delta_X: np.ndarray, kappa: float) -> np.ndarray:
        """Approximate the field-evolution operator U_a that produced
        delta_X.

        FCE-Ω usually computes U_a = exp(Phi_a) from a Lie-algebra element.
        Here we don't have an explicit Phi_a, only the resulting
        excitation delta_X. We use a small symmetric rank-1 generator
        Phi_a = c * (delta_X / ||delta_X||) (delta_X / ||delta_X||)^T,
        with c scaled by kappa, and U_a = I + Phi_a (first-order Lie
        expansion). This keeps update_residue's Z transport meaningful
        without forcing scipy.linalg.expm on every observation.
        """
        D = delta_X.shape[0]
        n = float(np.linalg.norm(delta_X))
        if n < 1e-12:
            return np.eye(D, dtype=np.float64)
        u = delta_X / n
        c = 0.20 + 0.30 * float(kappa)
        Phi = c * np.outer(u, u)
        return np.eye(D, dtype=np.float64) + Phi

    # ------------------------------------------------------------------

    def observe_after_consolidate(
        self,
        runtime_adapter: Any,
        episode_id: int,
    ) -> MorphogenesisReport:
        """Drain the new tail of the runtime event logs and advance the
        per-center FCE-Ω agents one cycle each.

        The runtime adapter is treated as read-only here; we only read
        slot_event_log, tension_event_log, and metrics_snapshot().
        """
        slot_log = list(getattr(runtime_adapter, "slot_event_log", []))
        tension_log = list(getattr(runtime_adapter, "tension_event_log", []))

        observations, new_slot, new_tension = collect_observations_from_adapter(
            slot_event_log=slot_log,
            tension_event_log=tension_log,
            D=self.D,
            since_index=self._slot_cursor,
            since_tension_index=self._tension_cursor,
        )
        self._slot_cursor = new_slot
        self._tension_cursor = new_tension

        # Group observations by center. Each center advances by the sum of
        # the new excitations it received in this episode — multiple writes
        # to the same slot in one episode compose as one delta_X.
        per_center: Dict[str, List[FCEObservation]] = {}
        for obs in observations:
            per_center.setdefault(obs.center_key, []).append(obs)

        new_omega_ids: List[str] = []
        records: List[MorphogenesisRecord] = []
        centers_touched: List[str] = []
        traces_this_episode: List[MultiperspectiveInteractionTrace] = []
        candidates_this_episode: List[RelationCandidate] = []

        # v0.5.0: snapshot agents BEFORE this consolidate's step so the
        # reference-field anchor uses the previous state (avoids
        # within-pass causal entanglement).
        prev_state: Dict[str, Dict[str, Any]] = {}
        for c, _obs_list in per_center.items():
            ag = self._get_or_create_agent(c)
            prev_state[c] = {
                "Omega": int(ag.Omega),
                "Phi_s": ag.Phi_s.copy(),
            }
        active_centers = list(per_center.keys())
        N_active = len(active_centers)

        center_S_t: Dict[str, float] = {}

        for center, obs_list in per_center.items():
            centers_touched.append(center)
            agent = self._get_or_create_agent(center)
            self._center_episodes[center].append(int(episode_id))
            for obs in obs_list:
                self._center_events[center].append(obs.source_event)
                # v0.4.1: update per-center zone counts so this center's
                # anchor is computed strictly from its own history.
                zc = self._center_zone_counts[center]
                key = obs.zone if obs.zone in zc else "NONE"
                zc[key] = zc.get(key, 0) + 1

            # Compose excitations for this center in this pass.
            delta_X = np.sum(
                [obs.delta_X for obs in obs_list], axis=0
            ).astype(np.float64)
            # Cache for multiperspectival composition (so other centers'
            # i <- j traces can read j's delta_X).
            self._last_delta_X[center] = delta_X.copy()

            U_a = self._U_a_from_delta(delta_X, agent.kappa)
            # v0.4.1: per-center anchor. Disputed writes on center B do
            # not appear in center A's counts; the channel that used to
            # couple kappa across centers is gone.
            zc = self._center_zone_counts[center]
            anchor = anchor_from_center_counts(
                committed=zc.get("COMMITTED", 0),
                provisional=zc.get("PROVISIONAL", 0),
                disputed=zc.get("DISPUTED", 0),
            )
            # v0.5.0: reference-field anchor influence. Co-active
            # neighbors with Omega=1 (taken from the PREV state so this
            # is order-free within a consolidate pass) project a small
            # additional anchor onto this center, scaled by their
            # Phi_s alignment and normalized by (N_active - 1).
            ref_anchor = 0.0
            if self.multiperspectival_enabled and N_active >= 2:
                phi_i = prev_state[center]["Phi_s"]
                contrib = 0.0
                for other in active_centers:
                    if other == center:
                        continue
                    if prev_state[other]["Omega"] != 1:
                        continue
                    phi_j = prev_state[other]["Phi_s"]
                    align = max(0.0, float(np.dot(phi_i, phi_j)))
                    contrib += align
                if N_active > 1:
                    contrib /= float(N_active - 1)
                ref_anchor = (
                    self.multiperspectival_anchor_eta * float(contrib)
                )
            effective_anchor = float(min(1.0, anchor + ref_anchor))

            S_t = agent.step(delta_X, U_a, anchor=effective_anchor)
            center_S_t[center] = float(S_t)
            self._cycles[center] += 1
            cycle = self._cycles[center]

            already_coagulated = bool(agent.Omega == 1)
            newly_coagulated = agent.check_coagulation(
                S_t, cycle, theta_s=self.theta_s, tau_coag=self.tau_coag
            )

            omega_id: Optional[str] = None
            if newly_coagulated and not already_coagulated:
                rec = self.omega_registry.register(
                    semantic_center=center,
                    coagulated_at_episode=int(episode_id),
                    coagulated_at_cycle=int(cycle),
                    S_t_at_coagulation=float(S_t),
                    kappa_at_coagulation=float(agent.coag_kappa),
                    sine_type=str(agent.sine_type),
                    source_episodes=list(self._center_episodes[center]),
                    source_events=list(self._center_events[center]),
                    duration_above_threshold=int(self.tau_coag),
                )
                omega_id = rec.omega_id
                new_omega_ids.append(omega_id)
                # v0.6.0: project a ReferenceField from this fresh
                # OmegaRecord. The field signature is the BLEND of the
                # content vector that won the coagulation (delta_X
                # normalized at coag time) and the agent's internal
                # direction (Phi_s). Both contribute equally; the
                # blend is unit-normalized. This gives a stable
                # reference that future events on the same center can
                # align with (committed events share the same hash-
                # direction so cos with field is high) and that
                # disputed orthogonal events legitimately contest.
                if self.reference_fields_enabled:
                    from unified_fragmergent_memory.runtime.reference_field import (
                        ReferenceFieldRegistry,
                    )
                    blended = agent.Phi_s.copy()
                    n_dx = float(np.linalg.norm(delta_X))
                    if n_dx > 1e-12:
                        blended = 0.5 * agent.Phi_s + 0.5 * (delta_X / n_dx)
                        n_b = float(np.linalg.norm(blended))
                        if n_b > 1e-12:
                            blended = blended / n_b
                    self.reference_field_registry.register(
                        omega_record=rec.to_json_safe(),
                        center_key=center,
                        field_vector=blended,
                        strength=ReferenceFieldRegistry.STRENGTH_AT_CREATION,
                        created_at_episode=int(episode_id),
                    )
            elif agent.Omega == 1:
                existing = self.omega_registry.get(center)
                if existing is not None:
                    omega_id = existing.omega_id

            zone_seen = "/".join(sorted({obs.zone for obs in obs_list}))
            rec = MorphogenesisRecord(
                episode_id=int(episode_id),
                cycle=int(cycle),
                semantic_center=center,
                zone_seen=zone_seen,
                S_t=float(S_t),
                AR=float(
                    self._fce.autoreferential_measure(agent.Pi_s, agent.Phi_s)
                ),
                kappa=float(agent.kappa),
                alpha=float(agent.alpha),
                rho=float(agent.rho),
                lambda_ar=float(agent.lambda_ar),
                Z_norm=float(np.linalg.norm(agent.Z)),
                delta_X_norm=float(np.linalg.norm(delta_X)),
                omega=int(agent.Omega),
                newly_coagulated=bool(newly_coagulated and not already_coagulated),
                omega_id=omega_id,
                anchor=float(anchor),
            )
            self.morphogenesis_log.append(rec)
            records.append(rec)

        # v0.5.0: compose directional interactions and detect shared-
        # coagulation candidates for co-active pairs in this consolidate
        # pass. The agents' state has already been advanced individually
        # above; this pass is purely AUDIT and CANDIDATE detection —
        # it does NOT mutate agent state and never auto-flips Omega.
        if self.multiperspectival_enabled and N_active >= 2:
            traces_this_episode, candidates_this_episode = (
                self._compose_multiperspectival(
                    episode_id=int(episode_id),
                    active_centers=active_centers,
                    center_S_t=center_S_t,
                )
            )
            self.interaction_log.extend(traces_this_episode)
            self.relation_candidates.extend(candidates_this_episode)

        # v0.6.0: classify each new observation against the active
        # ReferenceField (if any) for its center; emit OmegaFieldInteraction
        # traces for co-active pairs that BOTH have ReferenceFields.
        # Both are advisory; neither modifies UFME or OmegaRegistry.
        new_rf_events: List[Any] = []
        new_omega_field_interactions: List[Any] = []
        if self.reference_fields_enabled and active_centers:
            new_rf_events = self._classify_against_reference_fields(
                episode_id=int(episode_id),
                per_center=per_center,
            )
            self.reference_field_events.extend(new_rf_events)
            new_omega_field_interactions = self._compose_omega_field_interactions(
                episode_id=int(episode_id),
                active_centers=active_centers,
            )
            self.omega_field_interactions.extend(new_omega_field_interactions)

        # v0.5.1: in priority_only mode, derive bounded advisory
        # feedback items from the post-step state of the centers that
        # just observed. The emission is read-only with respect to
        # UFME state; only self.advisory_feedback_log grows.
        if self.advisory_mode == "priority_only" and active_centers:
            new_feedback = self._emit_priority_feedback(
                episode_id=int(episode_id),
                active_centers=active_centers,
                traces_this_episode=traces_this_episode,
                candidates_this_episode=candidates_this_episode,
                reference_field_events=new_rf_events,
                omega_field_interactions=new_omega_field_interactions,
            )
            self.advisory_feedback_log.extend(new_feedback)

        return MorphogenesisReport(
            episode_id=int(episode_id),
            cycles_advanced=len(records),
            centers_touched=centers_touched,
            new_omega_ids=new_omega_ids,
            records=records,
            interaction_traces=list(traces_this_episode),
            relation_candidates=list(candidates_this_episode),
        )

    # ------------------------------------------------------------------
    # v0.5.0: pair composition
    # ------------------------------------------------------------------

    def _build_Phi_a_for_pair(self, agent: Any, shared_X: np.ndarray,
                              pair_key: str) -> np.ndarray:
        """Deterministic Lie-algebra element for a pair, seeded by
        (rng_seed, pair_key). Used by the interference operator which
        needs a Lie-algebra element rather than a raw delta_X."""
        import hashlib
        h = hashlib.sha256(pair_key.encode("utf-8")).digest()
        seed = self._rng_seed + int.from_bytes(h[:4], "big")
        rng = np.random.default_rng(seed)
        return self._fce.build_Phi_a(shared_X, agent.kappa, rng=rng)

    def _compose_multiperspectival(
        self,
        episode_id: int,
        active_centers: List[str],
        center_S_t: Dict[str, float],
    ) -> tuple:
        """Class-normalized pair composition. Returns (traces, candidates).

        Normalization (mission §5 Etapa 3):
          * directional terms (absorption, repulsion, directional coag,
            interference) divided by N*(N-1) so total cross-influence
            stays bounded as the active set grows;
          * shared coag candidates divided by N*(N-1)/2.

        The composition uses the AGENT STATE AT END OF THIS CONSOLIDATE
        (Pi_s, Phi_s, alpha, lambda_ar are post-step values). This means
        the trace reflects what i would experience from j's most recent
        delta_X under i's current projector. That is a self-consistent
        audit reading: it does not mutate the agent further.
        """
        traces: List[MultiperspectiveInteractionTrace] = []
        candidates: List[RelationCandidate] = []
        N = len(active_centers)
        if N < 2:
            return traces, candidates

        directional_norm = float(N * (N - 1))
        shared_norm = float(N * (N - 1) / 2) if N >= 2 else 1.0

        # Build a shared X for the interference operator. Take the mean
        # of the agents' Phi_s as a tractable proxy for the field state
        # the pair "sees" during this pass.
        shared_X = np.zeros(self.D, dtype=np.float64)
        for c in active_centers:
            shared_X = shared_X + self._agents[c].Phi_s
        n_X = float(np.linalg.norm(shared_X))
        if n_X > 1e-12:
            shared_X = shared_X / n_X

        absorption_fn = self._fce.interactions.absorption
        repulsion_fn = self._fce.interactions.repulsion
        interference_fn = self._fce.interactions.interference
        directional_coag_fn = self._fce.interactions.coagulation_directional
        shared_coag_fn = self._fce.interactions.coagulation_shared
        THETA_PAIR = float(self.multiperspectival_theta_pair)

        # Pre-build per-center Phi_a (Lie-algebra element) once per
        # composition so antisymmetry of interference holds: K_{ij} uses
        # the same Phi_a_i, Phi_a_j as K_{ji} would.
        Phi_a: Dict[str, np.ndarray] = {}
        for c in active_centers:
            Phi_a[c] = self._build_Phi_a_for_pair(
                self._agents[c], shared_X, pair_key=c
            )

        # Directional traces for every ordered pair (i, j), i != j.
        for i_center in active_centers:
            A_i = self._agents[i_center]
            for j_center in active_centers:
                if j_center == i_center:
                    continue
                A_j = self._agents[j_center]
                delta_X_j = self._last_delta_X.get(j_center)
                if delta_X_j is None or float(np.linalg.norm(delta_X_j)) < 1e-12:
                    continue

                A_ij = absorption_fn(
                    A_i.Pi_s, A_i.Phi_s, float(A_i.alpha), delta_X_j
                ) / directional_norm
                R_ij = repulsion_fn(
                    A_i.Pi_s, A_i.Phi_s, A_j.Phi_s, delta_X_j
                ) / directional_norm
                K_ij = interference_fn(
                    Phi_a[i_center], Phi_a[j_center], shared_X
                ) / directional_norm
                C_ij = directional_coag_fn(
                    A_i.Phi_s, A_j.Phi_s,
                    float(A_i.lambda_ar), float(A_j.lambda_ar),
                    shared_X,
                ) / directional_norm

                # Antisymmetry residual: K_{ij} + K_{ji} should be ~0.
                K_ji = interference_fn(
                    Phi_a[j_center], Phi_a[i_center], shared_X
                ) / directional_norm
                antisym_residual = float(
                    np.linalg.norm(K_ij + K_ji)
                )

                # Reference-field contribution (already applied via
                # anchor in step). Record what the contribution was for
                # this pair, normalized by N_active - 1.
                phi_align = float(np.dot(A_i.Phi_s, A_j.Phi_s))
                anchor_contrib = 0.0
                if int(A_j.Omega) == 1:
                    anchor_contrib = max(0.0, phi_align) / float(N - 1)

                traces.append(MultiperspectiveInteractionTrace(
                    episode_id=int(episode_id),
                    center_i=i_center,
                    center_j=j_center,
                    cycle_i=int(self._cycles.get(i_center, 0)),
                    cycle_j=int(self._cycles.get(j_center, 0)),
                    Phi_s_alignment=phi_align,
                    absorption_norm=float(np.linalg.norm(A_ij)),
                    repulsion_norm=float(np.linalg.norm(R_ij)),
                    interference_norm=float(np.linalg.norm(K_ij)),
                    directional_coag_norm=float(np.linalg.norm(C_ij)),
                    interference_antisym_residual=antisym_residual,
                    anchor_influence_from_omega=float(anchor_contrib),
                ))

        # Shared-coagulation candidates over unordered pairs.
        ordered = list(active_centers)
        for a_idx in range(len(ordered)):
            for b_idx in range(a_idx + 1, len(ordered)):
                i_center = ordered[a_idx]
                j_center = ordered[b_idx]
                S_i = float(center_S_t.get(i_center, 0.0))
                S_j = float(center_S_t.get(j_center, 0.0))
                if S_i < THETA_PAIR or S_j < THETA_PAIR:
                    continue
                A_i = self._agents[i_center]
                A_j = self._agents[j_center]
                C_shared = shared_coag_fn(
                    A_i.Phi_s, A_j.Phi_s,
                    float(A_i.lambda_ar), float(A_j.lambda_ar),
                    shared_X,
                ) / shared_norm
                candidates.append(RelationCandidate(
                    episode_id=int(episode_id),
                    center_i=i_center,
                    center_j=j_center,
                    S_i=S_i, S_j=S_j,
                    theta_pair=THETA_PAIR,
                    shared_coag_norm=float(np.linalg.norm(C_shared)),
                ))
        return traces, candidates

    # ------------------------------------------------------------------
    # v0.5.1: semi-active priority feedback emission
    # ------------------------------------------------------------------

    PRIORITY_DELTA_HIGH_RESIDUE_CAP: float = 1.0
    PRIORITY_DELTA_FRAGMENTED: float = -0.50
    PRIORITY_DELTA_NEAR_COAG_CAP: float = 0.80
    PRIORITY_DELTA_COAG_REFERENCE: float = 0.40
    PRIORITY_DELTA_CONTESTED: float = 0.30
    PRIORITY_DELTA_RELATION_CANDIDATE_CAP: float = 0.50

    def _feedback_id(self, kind: str, center: str, episode_id: int) -> str:
        import hashlib
        seed = f"fb::{kind}::{center}::{episode_id}::{len(self.advisory_feedback_log)}"
        return hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]

    PRIORITY_DELTA_EXPRESSION_REINFORCING: float = 0.45
    PRIORITY_DELTA_RF_ALIGNED: float = 0.25
    PRIORITY_DELTA_RF_CONTESTED_EXPRESSION: float = 0.25
    PRIORITY_DELTA_RF_RESIDUE_AMPLIFYING: float = -0.30
    PRIORITY_DELTA_OMEGA_FIELD_RESONANCE: float = 0.35
    PRIORITY_DELTA_OMEGA_FIELD_INTERFERENCE: float = 0.20
    OMEGA_FIELD_RESONANCE_CUTOFF: float = 0.40
    OMEGA_FIELD_INTERFERENCE_CUTOFF: float = 0.40

    def _emit_priority_feedback(
        self,
        episode_id: int,
        active_centers: List[str],
        traces_this_episode: List[MultiperspectiveInteractionTrace],
        candidates_this_episode: List[RelationCandidate],
        reference_field_events: Optional[List[Any]] = None,
        omega_field_interactions: Optional[List[Any]] = None,
    ) -> List[FCEAdvisoryFeedback]:
        """Derive bounded priority-metadata recommendations for the
        centers touched in this consolidate pass.

        Contract (v0.5.1, mission §4 Etapa 4):
          - returns FCEAdvisoryFeedback items with priority_delta in
            [-1, 1] and recommended_action describing the suggestion;
          - never modifies UFME slot_event_log / audit_log / runtime
            adapter state / D_Cortex / tf_engine;
          - never creates Omega; coagulation still goes through
            check_coagulation;
          - never deletes residue, OmegaRegistry entries, or interaction
            history.

        The emission is keyed off the FCE state at end of step. It
        reuses the existing advisory_hints() classification thresholds
        so the two surfaces (read-only hints and priority-mode
        feedback log) stay coherent.
        """
        out: List[FCEAdvisoryFeedback] = []
        attractor_fn = getattr(self._fce, "classify_attractor", None)

        # Index relation candidates by center for fast provenance lookup.
        rc_by_center: Dict[str, List[Tuple[int, RelationCandidate]]] = {}
        for idx, rc in enumerate(candidates_this_episode):
            rc_by_center.setdefault(rc.center_i, []).append((idx, rc))
            rc_by_center.setdefault(rc.center_j, []).append((idx, rc))

        # Index traces by source center.
        trace_ids_by_center: Dict[str, List[str]] = {}
        for idx, tr in enumerate(traces_this_episode):
            tid = f"trace::{episode_id}::{tr.center_i}::{tr.center_j}"
            trace_ids_by_center.setdefault(tr.center_i, []).append(tid)
            trace_ids_by_center.setdefault(tr.center_j, []).append(tid)

        for center in active_centers:
            agent = self._agents[center]
            Z_norm = float(np.linalg.norm(agent.Z))
            consec = int(getattr(agent, "_consec_above_threshold", 0))
            related_omega = []
            omega_rec = self.omega_registry.get(center)
            if omega_rec is not None:
                related_omega = [omega_rec.omega_id]

            related_traces = trace_ids_by_center.get(center, [])
            related_candidate_ids = [
                f"relcand::{episode_id}::{rc.center_i}::{rc.center_j}"
                for _idx, rc in rc_by_center.get(center, [])
            ]

            # 1) high_residue
            if Z_norm > self.HIGH_RESIDUE_THRESHOLD:
                delta = min(self.PRIORITY_DELTA_HIGH_RESIDUE_CAP,
                            Z_norm / max(agent.RHO_MAX, 1e-9))
                kind = "high_residue"
                out.append(FCEAdvisoryFeedback(
                    feedback_id=self._feedback_id(kind, center, episode_id),
                    center_key=center,
                    kind=kind,
                    priority_delta=float(max(-1.0, min(1.0, delta))),
                    recommended_action="delay consolidation; incubate",
                    reason=(
                        f"active residue norm Z={Z_norm:.3f} exceeds "
                        f"observer's HIGH_RESIDUE_THRESHOLD; this is "
                        f"morphogenetic signal, not an epistemic verdict"
                    ),
                    source_trace_ids=list(related_traces),
                    source_omega_ids=list(related_omega),
                    source_relation_candidate_ids=list(related_candidate_ids),
                    created_at_episode=int(episode_id),
                ))

            # 2) near_coagulation (within 1 tau-step of the rule firing)
            if (omega_rec is None
                    and self.tau_coag >= 1
                    and consec >= max(1, self.tau_coag - 1)):
                # delta scales by closeness to tau.
                delta = min(self.PRIORITY_DELTA_NEAR_COAG_CAP,
                            float(consec) / float(self.tau_coag))
                kind = "near_coagulation"
                out.append(FCEAdvisoryFeedback(
                    feedback_id=self._feedback_id(kind, center, episode_id),
                    center_key=center,
                    kind=kind,
                    priority_delta=float(max(-1.0, min(1.0, delta))),
                    recommended_action=(
                        "incubate; observe whether S_t stays above theta"
                    ),
                    reason=(
                        "consec_above_threshold approaching tau_coag; "
                        "advisory only — coagulation still requires the "
                        "check_coagulation rule to fire"
                    ),
                    source_trace_ids=list(related_traces),
                    source_omega_ids=list(related_omega),
                    source_relation_candidate_ids=list(related_candidate_ids),
                    created_at_episode=int(episode_id),
                ))

            # 3) coagulated_reference
            if omega_rec is not None and omega_rec.expression_state in (
                "active", "inexpressed"
            ):
                kind = "coagulated_reference"
                out.append(FCEAdvisoryFeedback(
                    feedback_id=self._feedback_id(kind, center, episode_id),
                    center_key=center,
                    kind=kind,
                    priority_delta=self.PRIORITY_DELTA_COAG_REFERENCE,
                    recommended_action=(
                        "prioritize consolidation for related slots"
                    ),
                    reason=(
                        "coagulated reference; downstream consumers may "
                        "raise consolidation priority for related slots; "
                        "epistemic verdicts remain runtime-authoritative"
                    ),
                    source_trace_ids=list(related_traces),
                    source_omega_ids=list(related_omega),
                    source_relation_candidate_ids=list(related_candidate_ids),
                    created_at_episode=int(episode_id),
                ))

            # 4) contested_expression
            if omega_rec is not None and omega_rec.expression_state == "contested":
                kind = "contested_expression"
                out.append(FCEAdvisoryFeedback(
                    feedback_id=self._feedback_id(kind, center, episode_id),
                    center_key=center,
                    kind=kind,
                    priority_delta=self.PRIORITY_DELTA_CONTESTED,
                    recommended_action=(
                        "review expression; Omega remains active"
                    ),
                    reason=(
                        "Omega expression contested; review recommended. "
                        "Omega itself is irreversible; the runtime keeps "
                        "epistemic authority on the underlying slot"
                    ),
                    source_trace_ids=list(related_traces),
                    source_omega_ids=list(related_omega),
                    source_relation_candidate_ids=list(related_candidate_ids),
                    created_at_episode=int(episode_id),
                ))

            # 5) fragmented (attractor classification)
            if attractor_fn is not None:
                AR_val = float(self._fce.autoreferential_measure(
                    agent.Pi_s, agent.Phi_s
                ))
                attractor = attractor_fn(
                    alpha=float(agent.alpha), kappa=float(agent.kappa),
                    rho=float(agent.rho), lambda_ar=float(agent.lambda_ar),
                    Z_norm=Z_norm, AR=AR_val,
                )
                if attractor == 0:  # FRAGMENTED
                    kind = "fragmented"
                    out.append(FCEAdvisoryFeedback(
                        feedback_id=self._feedback_id(kind, center, episode_id),
                        center_key=center,
                        kind=kind,
                        priority_delta=self.PRIORITY_DELTA_FRAGMENTED,
                        recommended_action=(
                            "delay consolidation; field is fragmented"
                        ),
                        reason=(
                            "FCE attractor classification = FRAGMENTED; "
                            "lower operational trust until field stabilizes"
                        ),
                        source_trace_ids=list(related_traces),
                        source_omega_ids=list(related_omega),
                        source_relation_candidate_ids=list(related_candidate_ids),
                        created_at_episode=int(episode_id),
                    ))

        # 6) per-candidate relation_candidate feedback (unordered pairs)
        for idx, rc in enumerate(candidates_this_episode):
            min_S = float(min(rc.S_i, rc.S_j))
            delta = min(self.PRIORITY_DELTA_RELATION_CANDIDATE_CAP, min_S)
            cid = f"relcand::{episode_id}::{rc.center_i}::{rc.center_j}"
            kind = "relation_candidate"
            out.append(FCEAdvisoryFeedback(
                feedback_id=self._feedback_id(
                    f"{kind}::{rc.center_i}::{rc.center_j}",
                    rc.center_i, episode_id,
                ),
                center_key=f"{rc.center_i}+{rc.center_j}",
                kind=kind,
                priority_delta=float(max(0.0, min(1.0, delta))),
                recommended_action=(
                    "review relation; advisory only"
                ),
                reason=(
                    f"both S_t above theta_pair ({rc.theta_pair}); "
                    f"S_i={rc.S_i:.3f} S_j={rc.S_j:.3f}; relation review "
                    f"recommended without modifying either center's Omega"
                ),
                source_trace_ids=[],
                source_omega_ids=[],
                source_relation_candidate_ids=[cid],
                created_at_episode=int(episode_id),
            ))

        # v0.6.0: surface ReferenceField events as advisory feedback.
        for ev in (reference_field_events or []):
            kind_map = {
                "expression_reinforcing": (
                    self.PRIORITY_DELTA_EXPRESSION_REINFORCING,
                    "expression_reinforcing",
                    "consolidate sooner; reference field reinforced",
                ),
                "aligned": (
                    self.PRIORITY_DELTA_RF_ALIGNED,
                    "rf_aligned",
                    "consolidate; event aligned with reference field",
                ),
                "contested_expression": (
                    self.PRIORITY_DELTA_RF_CONTESTED_EXPRESSION,
                    "rf_contested_expression",
                    "review expression; Omega remains active",
                ),
                "residue_amplifying": (
                    self.PRIORITY_DELTA_RF_RESIDUE_AMPLIFYING,
                    "rf_residue_amplifying",
                    "delay consolidation; residue amplifies against field",
                ),
            }
            mapping = kind_map.get(ev.kind)
            if mapping is None:
                continue  # tensioned / orthogonal -> no priority hint
            delta, fb_kind, action = mapping
            out.append(FCEAdvisoryFeedback(
                feedback_id=self._feedback_id(fb_kind, ev.center_key, episode_id),
                center_key=ev.center_key,
                kind=fb_kind,
                priority_delta=float(max(-1.0, min(1.0, delta))),
                recommended_action=action,
                reason=(
                    f"ReferenceField event '{ev.kind}' (cosine="
                    f"{ev.cosine_alignment:+.3f}, zone={ev.zone_seen}); "
                    f"morphogenetic classification only; UFME truth-status "
                    f"is unchanged"
                ),
                source_trace_ids=[],
                source_omega_ids=[ev.omega_id],
                source_relation_candidate_ids=[ev.reference_id],
                created_at_episode=int(episode_id),
            ))

        # v0.6.0: omega_field interactions become advisory hints too.
        for ofi in (omega_field_interactions or []):
            if ofi.resonance_score > self.OMEGA_FIELD_RESONANCE_CUTOFF:
                out.append(FCEAdvisoryFeedback(
                    feedback_id=self._feedback_id(
                        f"omega_field_resonance::{ofi.center_i}::{ofi.center_j}",
                        ofi.center_i, episode_id,
                    ),
                    center_key=f"{ofi.center_i}+{ofi.center_j}",
                    kind="omega_field_resonance",
                    priority_delta=float(
                        max(-1.0, min(1.0, self.PRIORITY_DELTA_OMEGA_FIELD_RESONANCE))
                    ),
                    recommended_action=(
                        "relation review; two ReferenceFields resonate"
                    ),
                    reason=(
                        f"alignment={ofi.field_alignment:+.3f}, "
                        f"resonance={ofi.resonance_score:.3f}; advisory "
                        f"only — does NOT create a new Omega for either "
                        f"center"
                    ),
                    source_trace_ids=[ofi.interaction_id],
                    source_omega_ids=[ofi.omega_id_i, ofi.omega_id_j],
                    source_relation_candidate_ids=[],
                    created_at_episode=int(episode_id),
                ))
            if ofi.interference_score > self.OMEGA_FIELD_INTERFERENCE_CUTOFF:
                out.append(FCEAdvisoryFeedback(
                    feedback_id=self._feedback_id(
                        f"omega_field_interference::{ofi.center_i}::{ofi.center_j}",
                        ofi.center_i, episode_id,
                    ),
                    center_key=f"{ofi.center_i}+{ofi.center_j}",
                    kind="omega_field_interference",
                    priority_delta=float(
                        max(-1.0, min(1.0, self.PRIORITY_DELTA_OMEGA_FIELD_INTERFERENCE))
                    ),
                    recommended_action=(
                        "relation review; ReferenceFields interfere"
                    ),
                    reason=(
                        f"alignment={ofi.field_alignment:+.3f}, "
                        f"interference={ofi.interference_score:.3f}; "
                        f"advisory only — Omega per-center stays intact"
                    ),
                    source_trace_ids=[ofi.interaction_id],
                    source_omega_ids=[ofi.omega_id_i, ofi.omega_id_j],
                    source_relation_candidate_ids=[],
                    created_at_episode=int(episode_id),
                ))

        return out

    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # v0.6.0: ReferenceField classification & inter-Omega interactions
    # ------------------------------------------------------------------

    def _classify_against_reference_fields(
        self,
        episode_id: int,
        per_center: Dict[str, List[FCEObservation]],
    ) -> List[Any]:
        """For each observation whose center has an active ReferenceField,
        classify it morphogenetically. Update ReferenceField strength /
        expression_state. Never touch OmegaRecord or UFME state."""
        from unified_fragmergent_memory.runtime.reference_field import (
            ReferenceFieldEvent,
            classify_event_against_reference,
        )
        import hashlib

        out: List[Any] = []
        for center, obs_list in per_center.items():
            rf = self.reference_field_registry.get(center)
            if rf is None:
                continue
            field_vec = np.asarray(rf.field_vector, dtype=np.float64)
            for obs_idx, obs in enumerate(obs_list):
                cls = classify_event_against_reference(
                    delta_X=obs.delta_X,
                    zone=obs.zone,
                    residue_weight=obs.residue_weight,
                    field_vector=field_vec,
                )
                # Stable event_id from (rf.reference_id, ep, idx).
                seed = f"rfe::{rf.reference_id}::{episode_id}::{obs_idx}"
                event_id = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]
                ev = ReferenceFieldEvent(
                    event_id=event_id,
                    reference_id=rf.reference_id,
                    omega_id=rf.omega_id,
                    center_key=center,
                    episode_id=int(episode_id),
                    zone_seen=str(obs.zone),
                    kind=str(cls["kind"]),
                    cosine_alignment=float(cls["cosine_alignment"]),
                    delta_X_norm=float(cls["delta_X_norm"]),
                )
                out.append(ev)
                # Bounded strength + expression_state update. ReferenceField
                # mutations are LOCAL to ReferenceField; OmegaRecord stays.
                self.reference_field_registry.update_with_event(
                    center_key=center,
                    event_kind=str(cls["kind"]),
                    episode_id=int(episode_id),
                )
        return out

    def _compose_omega_field_interactions(
        self,
        episode_id: int,
        active_centers: List[str],
    ) -> List[Any]:
        """For every unordered pair of co-active centers where BOTH have
        a ReferenceField, record an OmegaFieldInteraction. A center
        without an OmegaRecord cannot appear in this trace; this enforces
        mission §5: 'centre fără Ω pot perturba X-field, dar nu intră
        direct în Ω-field'."""
        from unified_fragmergent_memory.runtime.reference_field import (
            OmegaFieldInteraction,
        )
        import hashlib

        out: List[Any] = []
        if len(active_centers) < 2:
            return out

        # Only consider centers with active ReferenceFields.
        active_with_rf: List[str] = [
            c for c in active_centers
            if self.reference_field_registry.has(c)
        ]
        if len(active_with_rf) < 2:
            return out

        for a in range(len(active_with_rf)):
            for b in range(a + 1, len(active_with_rf)):
                ci = active_with_rf[a]
                cj = active_with_rf[b]
                rf_i = self.reference_field_registry.get(ci)
                rf_j = self.reference_field_registry.get(cj)
                if rf_i is None or rf_j is None:
                    continue
                fi = np.asarray(rf_i.field_vector, dtype=np.float64)
                fj = np.asarray(rf_j.field_vector, dtype=np.float64)
                n_i = float(np.linalg.norm(fi))
                n_j = float(np.linalg.norm(fj))
                if n_i < 1e-12 or n_j < 1e-12:
                    continue
                cos = float(np.dot(fi, fj) / (n_i * n_j))
                alignment = float(cos)
                tension = float(1.0 - abs(cos))
                min_strength = float(min(rf_i.strength, rf_j.strength))
                resonance = float(max(0.0, cos)) * min_strength
                interference = float(1.0 - abs(cos)) * min_strength

                seed = (f"ofi::{rf_i.reference_id}::{rf_j.reference_id}"
                        f"::{episode_id}")
                iid = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]
                out.append(OmegaFieldInteraction(
                    interaction_id=iid,
                    center_i=ci, center_j=cj,
                    omega_id_i=rf_i.omega_id,
                    omega_id_j=rf_j.omega_id,
                    episode_id=int(episode_id),
                    field_alignment=alignment,
                    field_tension=tension,
                    resonance_score=resonance,
                    interference_score=interference,
                ))
        return out

    def center_state(self, semantic_center: str) -> Dict[str, Any]:
        """Inspection helper: read-only snapshot of one center's agent."""
        agent = self._agents.get(semantic_center)
        if agent is None:
            return {"exists": False}
        zc = self._center_zone_counts.get(semantic_center, {})
        return {
            "exists": True,
            "Omega": int(agent.Omega),
            "kappa": float(agent.kappa),
            "alpha": float(agent.alpha),
            "rho": float(agent.rho),
            "lambda_ar": float(agent.lambda_ar),
            "Z_norm": float(np.linalg.norm(agent.Z)),
            "Phi_s_norm": float(np.linalg.norm(agent.Phi_s)),
            "cycles": int(self._cycles.get(semantic_center, 0)),
            "consec_above_threshold": int(
                getattr(agent, "_consec_above_threshold", 0)
            ),
            "sine_type": str(agent.sine_type),
            "source_episodes": list(self._center_episodes.get(semantic_center, [])),
            "zone_counts": dict(zc),
            "anchor": anchor_from_center_counts(
                committed=zc.get("COMMITTED", 0),
                provisional=zc.get("PROVISIONAL", 0),
                disputed=zc.get("DISPUTED", 0),
            ),
        }

    def metrics_snapshot(self) -> Dict[str, Any]:
        """Snapshot of observer state, safe to embed in
        UnifiedMemoryStore.metrics_snapshot()."""
        per_center_anchor: Dict[str, float] = {}
        for center, zc in self._center_zone_counts.items():
            per_center_anchor[center] = anchor_from_center_counts(
                committed=zc.get("COMMITTED", 0),
                provisional=zc.get("PROVISIONAL", 0),
                disputed=zc.get("DISPUTED", 0),
            )
        return {
            "D": int(self.D),
            "theta_s": float(self.theta_s),
            "tau_coag": int(self.tau_coag),
            "centers": len(self._agents),
            "coagulated_centers": sum(
                1 for a in self._agents.values() if int(a.Omega) == 1
            ),
            "morphogenesis_log_size": len(self.morphogenesis_log),
            "omega_registry": self.omega_registry.snapshot(),
            "slot_cursor": int(self._slot_cursor),
            "tension_cursor": int(self._tension_cursor),
            # v0.4.1: per-center anchor and zone counts replace the
            # single global anchor scalar from v0.4.0.
            "center_zone_counts": {
                c: dict(zc) for c, zc in self._center_zone_counts.items()
            },
            "center_anchors": per_center_anchor,
            # v0.5.0: multiperspectival audit surface.
            "multiperspectival_enabled": bool(self.multiperspectival_enabled),
            "multiperspectival_anchor_eta": float(self.multiperspectival_anchor_eta),
            "multiperspectival_theta_pair": float(self.multiperspectival_theta_pair),
            "interaction_log_size": len(self.interaction_log),
            "relation_candidates_count": len(self.relation_candidates),
            # v0.5.1
            "advisory_mode": str(self.advisory_mode),
            "advisory_feedback_log_size": len(self.advisory_feedback_log),
            # v0.6.0
            "reference_fields_enabled": bool(self.reference_fields_enabled),
            "reference_fields_count": len(self.reference_field_registry),
            "reference_field_events_size": len(self.reference_field_events),
            "omega_field_interactions_size": len(self.omega_field_interactions),
        }

    # ------------------------------------------------------------------
    # Read-only advisory surface (v0.4.0: hints only, no side effects).
    # Mission §7 Etapa 5 reserves "advisory_feedback" for v0.5.1; here we
    # only expose inspectable hints. Calling this never mutates the
    # observer, the runtime adapter, or the OmegaRegistry.
    # ------------------------------------------------------------------

    HIGH_RESIDUE_THRESHOLD: float = 0.50
    HIGH_RHO_FRACTION: float = 0.40   # of FCE Agent.RHO_MAX

    def advisory_hints(self) -> List[Dict[str, Any]]:
        """Return a snapshot list of read-only recommendations.

        Hint kinds emitted in this version:
          * "high_residue"  - center has Z_norm above HIGH_RESIDUE_THRESHOLD.
                              Suggests incubation / delayed consolidation.
          * "coagulated_reference" - center has Omega=1 in registry.
                              Suggests prioritized consolidation for
                              related slots.
          * "contested_expression" - Omega center currently in 'contested'
                              expression state. Suggests structural conflict.
          * "fragmented" - FCE attractor classifies the center as
                              FRAGMENTED. Suggests low operational trust.

        The structure is intentionally a list of dicts so a caller can
        filter by kind without subclassing.
        """
        out: List[Dict[str, Any]] = []
        attractor_fn = getattr(self._fce, "classify_attractor", None)
        attractor_labels = getattr(self._fce, "ATTRACTOR_LABELS", {})

        for center, agent in self._agents.items():
            Z_norm = float(np.linalg.norm(agent.Z))
            AR = float(
                self._fce.autoreferential_measure(agent.Pi_s, agent.Phi_s)
            )
            if Z_norm > self.HIGH_RESIDUE_THRESHOLD:
                out.append({
                    "kind": "high_residue",
                    "semantic_center": center,
                    "Z_norm": Z_norm,
                    "rho": float(agent.rho),
                    "suggestion": (
                        "delay consolidation / incubate; residue norm is "
                        "above HIGH_RESIDUE_THRESHOLD"
                    ),
                })
            if attractor_fn is not None:
                attractor = attractor_fn(
                    alpha=float(agent.alpha), kappa=float(agent.kappa),
                    rho=float(agent.rho), lambda_ar=float(agent.lambda_ar),
                    Z_norm=Z_norm, AR=AR,
                )
                if attractor == 0:  # FRAGMENTED
                    out.append({
                        "kind": "fragmented",
                        "semantic_center": center,
                        "attractor": str(
                            attractor_labels.get(attractor, "FRAGMENTED")
                        ),
                        "suggestion": (
                            "low operational trust; reduce consolidation "
                            "priority until field stabilizes"
                        ),
                    })

        for rec in self.omega_registry.all_records():
            if rec.expression_state == "contested":
                out.append({
                    "kind": "contested_expression",
                    "semantic_center": rec.semantic_center,
                    "omega_id": rec.omega_id,
                    "suggestion": (
                        "structural conflict on coagulated reference; the "
                        "underlying epistemic decision remains the runtime's"
                    ),
                })
            else:
                out.append({
                    "kind": "coagulated_reference",
                    "semantic_center": rec.semantic_center,
                    "omega_id": rec.omega_id,
                    "expression_state": rec.expression_state,
                    "suggestion": (
                        "prioritize consolidation for slots tied to this "
                        "reference"
                    ),
                })
        return out

    # ------------------------------------------------------------------
    # Persistence: passive observer-state roundtrip so the morphogenesis
    # history survives reload. The reload never replays UFME events.
    # ------------------------------------------------------------------

    def persist(self, path: str) -> None:
        """Save observer state to JSON."""
        import json
        import os
        payload = {
            "version": "v0.6.0",
            "multiperspectival_enabled": bool(self.multiperspectival_enabled),
            "multiperspectival_anchor_eta": float(self.multiperspectival_anchor_eta),
            "multiperspectival_theta_pair": float(self.multiperspectival_theta_pair),
            "interaction_log": [asdict(t) for t in self.interaction_log],
            "relation_candidates": [asdict(r) for r in self.relation_candidates],
            "advisory_mode": str(self.advisory_mode),
            "advisory_feedback_log": [
                asdict(fb) for fb in self.advisory_feedback_log
            ],
            # v0.6.0
            "reference_fields_enabled": bool(self.reference_fields_enabled),
            "reference_field_registry": self.reference_field_registry.snapshot(),
            "reference_field_events": [
                asdict(ev) for ev in self.reference_field_events
            ],
            "omega_field_interactions": [
                asdict(ofi) for ofi in self.omega_field_interactions
            ],
            "D": int(self.D),
            "theta_s": float(self.theta_s),
            "tau_coag": int(self.tau_coag),
            "rng_seed": int(self._rng_seed),
            "slot_cursor": int(self._slot_cursor),
            "tension_cursor": int(self._tension_cursor),
            "morphogenesis_log": [
                {
                    "episode_id": r.episode_id, "cycle": r.cycle,
                    "semantic_center": r.semantic_center,
                    "zone_seen": r.zone_seen, "S_t": r.S_t, "AR": r.AR,
                    "kappa": r.kappa, "alpha": r.alpha, "rho": r.rho,
                    "lambda_ar": r.lambda_ar, "Z_norm": r.Z_norm,
                    "delta_X_norm": r.delta_X_norm, "omega": r.omega,
                    "newly_coagulated": r.newly_coagulated,
                    "omega_id": r.omega_id, "anchor": r.anchor,
                }
                for r in self.morphogenesis_log
            ],
            "omega_registry": self.omega_registry.snapshot(),
            "agents": [
                {
                    "center": center,
                    "kappa": float(agent.kappa),
                    "alpha": float(agent.alpha),
                    "rho": float(agent.rho),
                    "lambda_ar": float(agent.lambda_ar),
                    "Phi_s": agent.Phi_s.tolist(),
                    "Z": agent.Z.tolist(),
                    "Omega": int(agent.Omega),
                    "coag_cycle": agent.coag_cycle,
                    "coag_kappa": agent.coag_kappa,
                    "_consec_above_threshold": int(
                        getattr(agent, "_consec_above_threshold", 0)
                    ),
                    "cycles": int(self._cycles.get(center, 0)),
                    "source_episodes": list(
                        self._center_episodes.get(center, [])
                    ),
                    "source_events": list(
                        self._center_events.get(center, [])
                    ),
                    "zone_counts": dict(
                        self._center_zone_counts.get(center, {})
                    ),
                }
                for center, agent in self._agents.items()
            ],
        }
        tmp = f"{path}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        os.replace(tmp, path)

    def load(self, path: str) -> None:
        """Restore observer state from a persist() JSON. Purely passive;
        does NOT replay UFME events. Subsequent observe_after_consolidate()
        resumes from the saved cursors."""
        import json
        import os
        from unified_fragmergent_memory.runtime.omega_registry import (
            OmegaRegistry, OmegaRecord,
        )
        if not os.path.exists(path):
            return
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)

        self.D = int(payload.get("D", self.D))
        self.theta_s = float(payload.get("theta_s", self.theta_s))
        self.tau_coag = int(payload.get("tau_coag", self.tau_coag))
        self._rng_seed = int(payload.get("rng_seed", self._rng_seed))
        self._slot_cursor = int(payload.get("slot_cursor", 0))
        self._tension_cursor = int(payload.get("tension_cursor", 0))

        # v0.5.0: optional multiperspectival fields. Absent in v0.4.x
        # payloads so we fall back to the constructor defaults.
        if "multiperspectival_enabled" in payload:
            self.multiperspectival_enabled = bool(
                payload["multiperspectival_enabled"]
            )
        if "multiperspectival_anchor_eta" in payload:
            self.multiperspectival_anchor_eta = float(
                payload["multiperspectival_anchor_eta"]
            )
        if "multiperspectival_theta_pair" in payload:
            self.multiperspectival_theta_pair = float(
                payload["multiperspectival_theta_pair"]
            )
        self.interaction_log = [
            MultiperspectiveInteractionTrace(**t)
            for t in payload.get("interaction_log", [])
        ]
        self.relation_candidates = [
            RelationCandidate(**r)
            for r in payload.get("relation_candidates", [])
        ]
        # v0.5.1: optional advisory state. Older payloads lack it.
        if "advisory_mode" in payload:
            self.advisory_mode = str(payload["advisory_mode"])
        self.advisory_feedback_log = [
            FCEAdvisoryFeedback(**fb)
            for fb in payload.get("advisory_feedback_log", [])
        ]
        # v0.6.0: optional ReferenceField state.
        from unified_fragmergent_memory.runtime.reference_field import (
            ReferenceFieldRegistry,
            ReferenceField,
            ReferenceFieldEvent,
            OmegaFieldInteraction,
        )
        if "reference_fields_enabled" in payload:
            self.reference_fields_enabled = bool(payload["reference_fields_enabled"])
        new_rf_reg = ReferenceFieldRegistry()
        rf_snap = payload.get("reference_field_registry", {})
        for entry in rf_snap.get("fields", []):
            rf = ReferenceField(**entry)
            new_rf_reg._fields[rf.center_key] = rf
        self.reference_field_registry = new_rf_reg
        self.reference_field_events = [
            ReferenceFieldEvent(**ev)
            for ev in payload.get("reference_field_events", [])
        ]
        self.omega_field_interactions = [
            OmegaFieldInteraction(**ofi)
            for ofi in payload.get("omega_field_interactions", [])
        ]

        self.morphogenesis_log = [
            MorphogenesisRecord(**r)
            for r in payload.get("morphogenesis_log", [])
        ]

        new_reg = OmegaRegistry()
        for entry in payload.get("omega_registry", {}).get("records", []):
            rec = OmegaRecord.from_json_safe(entry)
            new_reg._records[rec.semantic_center] = rec
        self.omega_registry = new_reg

        self._agents = {}
        self._cycles = {}
        self._center_episodes = {}
        self._center_events = {}
        self._center_zone_counts = {}
        for ag in payload.get("agents", []):
            center = ag["center"]
            agent = self._fce.Agent(
                idx=len(self._agents), D=self.D,
                rng=np.random.default_rng(0),
            )
            agent.kappa = float(ag["kappa"])
            agent.alpha = float(ag["alpha"])
            agent.rho = float(ag["rho"])
            agent.lambda_ar = float(ag["lambda_ar"])
            agent.Phi_s = np.asarray(ag["Phi_s"], dtype=np.float64)
            agent.Z = np.asarray(ag["Z"], dtype=np.float64)
            agent.Omega = int(ag["Omega"])
            agent.coag_cycle = ag.get("coag_cycle")
            agent.coag_kappa = ag.get("coag_kappa")
            agent._consec_above_threshold = int(
                ag.get("_consec_above_threshold", 0)
            )
            agent.Pi_s = self._fce.build_Pi_s(
                agent.alpha, agent.lambda_ar, agent.Phi_s
            )
            self._agents[center] = agent
            self._cycles[center] = int(ag.get("cycles", 0))
            self._center_episodes[center] = list(
                ag.get("source_episodes", [])
            )
            self._center_events[center] = list(ag.get("source_events", []))
            # v0.4.1: zone counts may be absent in v0.4.0 payloads;
            # reconstruct an empty counter so resumed observation
            # continues from zero anchor mass rather than crashing.
            raw_zc = dict(ag.get("zone_counts") or {})
            self._center_zone_counts[center] = {
                "COMMITTED": int(raw_zc.get("COMMITTED", 0)),
                "PROVISIONAL": int(raw_zc.get("PROVISIONAL", 0)),
                "DISPUTED": int(raw_zc.get("DISPUTED", 0)),
                "NONE": int(raw_zc.get("NONE", 0)),
            }
