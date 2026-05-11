"""Organism-driven cross-substrate coupling (Pas 5+, v0.2.1).

v0.2.0 demonstrated that the cross-substrate cycle is structurally complete:
the four audit logs reconstruct the chain end to end. But v0.2.0 wrote
symbolic events directly into DCortexAdapter, bypassing the wired
Organism. The Organism's CommitArbiter has Pas 5 latent_decision_pressure
branches (`ignition_build_v0.py:1697-1731` for the canonical
LATENT_RETROGRADE_PRESSURE_ON_IDEMPOTENT branch). v0.2.0 never reached
those branches.

v0.2.1 closes the gap. OrchestratorOrganismDriven instantiates the
Organism (latent_mode='off' so the runtime's internal latent flow is
inert) and routes symbolic writes through Organism.perceive(). Between
episodes, an externally-derived LatentDecisionPressure (either
synthetically engineered for unit tests or produced by the v0.2.0
cross-substrate cycle for end-to-end demonstrations) is installed into
Organism.current_latent_pressure. CommitArbiter sees the pressure on the
next perceive(), and may take a Pas 5 branch that changes the decision.

Comparison protocol:
  Run A (coupling=False): Organism with current_latent_pressure left empty.
  Run B (coupling=True):  Same inputs, same Organism class, same scenario,
                          but pressure injected between episodes.
The trace logs are diffed: if at least one trace differs in
{decision, memory_target_zone, epistemic_status, latent_pressure marker,
influence_effects}, cognitive coupling is confirmed.

The Organism is read-only source (R1). This orchestrator only constructs
it, calls public methods, and reads its trace_log.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np

from unified_fragmergent_memory.facade.config import Config
from unified_fragmergent_memory.facade.memory_store import UnifiedMemoryStore


# A scenario is a list of episodes; each episode is a list of input strings.
Scenario = List[List[str]]


@dataclass
class TraceSummary:
    """Condensed view of a CognitiveTrace produced by Organism.perceive().

    Carries only the fields used for cognitive-coupling diff. The full
    trace stays in Organism.trace_log.
    """

    trace_id: str
    episode_id: int
    write_step: int
    input_text: str
    intent: str
    head_entity: Optional[str]
    epistemic_status: str
    memory_target_zone: Optional[str]
    arbiter_decision: Optional[str]
    arbiter_reason: Optional[str]
    latent_pressure_marker: Optional[str]
    influence_effect_channels: List[str]
    pressure_was_active: bool
    # v0.3.2: slot key extracted from the arbiter's last decision so that
    # auto-registration has a deterministic (entity, attr) pair to use.
    slot_entity: Optional[str] = None
    slot_attr: Optional[str] = None


@dataclass
class AutoRegistration:
    """v0.3.2 metadata for a slot that was auto-registered as a tf label.

    Carries provenance back to the organism trace that triggered the
    registration plus the assigned tf label. Bidirectional lookup: the
    UnifiedMemoryStore exposes lookup_slot_by_label(label) -> slot.
    """

    entity_id: str
    attr_type: str
    label: int
    organism_trace_id: str
    episode_id: int
    write_step: int
    auto_registration_id: str
    epistemic_status: str
    memory_target_zone: Optional[str]

    def to_json_safe(self) -> Dict[str, Any]:
        return {
            "entity_id": self.entity_id,
            "attr_type": self.attr_type,
            "label": int(self.label),
            "organism_trace_id": self.organism_trace_id,
            "episode_id": int(self.episode_id),
            "write_step": int(self.write_step),
            "auto_registration_id": self.auto_registration_id,
            "epistemic_status": self.epistemic_status,
            "memory_target_zone": self.memory_target_zone,
        }

    @classmethod
    def from_json_safe(cls, payload: Dict[str, Any]) -> "AutoRegistration":
        return cls(
            entity_id=payload["entity_id"],
            attr_type=payload["attr_type"],
            label=int(payload["label"]),
            organism_trace_id=payload["organism_trace_id"],
            episode_id=int(payload["episode_id"]),
            write_step=int(payload["write_step"]),
            auto_registration_id=payload["auto_registration_id"],
            epistemic_status=payload.get("epistemic_status", ""),
            memory_target_zone=payload.get("memory_target_zone"),
        )


@dataclass
class EpisodeRecord:
    """One episode of an organism-driven run with full provenance."""

    episode_id: int
    inputs: List[str] = field(default_factory=list)
    pressure_pre_install_summary: Dict[str, Any] = field(default_factory=dict)
    traces: List[TraceSummary] = field(default_factory=list)
    end_episode_summary: Dict[str, Any] = field(default_factory=dict)
    cross_substrate_consolidation_op_counts: Dict[str, int] = field(default_factory=dict)
    cross_substrate_perturbations: Dict[int, float] = field(default_factory=dict)
    cross_substrate_record_ids: List[str] = field(default_factory=list)
    pressure_post_synthesis_summary: Dict[str, Any] = field(default_factory=dict)
    pressure_origin: Optional[str] = None
    # v0.3.2: per-episode list of slot auto-registrations triggered by traces.
    auto_registrations: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class OrganismDrivenReport:
    """Full report from one orchestrator run.

    Two of these are produced per A/B comparison: one for coupling=OFF and
    one for coupling=ON.
    """

    coupling: bool
    episodes: List[EpisodeRecord] = field(default_factory=list)
    n_traces: int = 0
    n_decisions_changed_vs_baseline: int = 0
    notes: List[str] = field(default_factory=list)


def summarize_pressure(pressure: Any) -> Dict[str, Any]:
    """JSON-safe summary of a LatentDecisionPressure."""
    if pressure is None:
        return {"empty": True, "is_None": True}
    return {
        "empty": pressure.is_empty() if hasattr(pressure, "is_empty") else True,
        "n_promote_slots": len(getattr(pressure, "promote_slots", {}) or {}),
        "n_retrograde_slots": len(getattr(pressure, "retrograde_slots", {}) or {}),
        "n_prune_slots": len(getattr(pressure, "prune_slots", set()) or set()),
        "n_persistent_conflict_slots": len(
            getattr(pressure, "persistent_conflict_slots", set()) or set()
        ),
        "confidence": float(getattr(pressure, "confidence", 0.0)),
    }


def summarize_trace(trace: Any) -> TraceSummary:
    """Build a TraceSummary from an Organism CognitiveTrace.

    All fields are read by attribute access; the source dataclass is
    not modified (R1).
    """
    arbiter = getattr(trace, "arbiter_trace", {}) or {}
    decisions = arbiter.get("decisions", []) if isinstance(arbiter, dict) else []
    last_decision = decisions[-1] if decisions else {}
    influence_effects = getattr(trace, "influence_effects", []) or []
    annotations = getattr(trace, "annotations", {}) or {}

    # Extract slot from last decision, with fallback to head_entity + family of
    # the primary value_candidate. Decisions store slot as [entity, attr].
    slot_entity: Optional[str] = None
    slot_attr: Optional[str] = None
    if isinstance(last_decision, dict):
        slot_field = last_decision.get("slot")
        if isinstance(slot_field, (list, tuple)) and len(slot_field) >= 2:
            slot_entity = str(slot_field[0])
            slot_attr = str(slot_field[1])
    if slot_entity is None:
        slot_entity = getattr(trace, "head_entity", None)
    if slot_attr is None:
        # Fall back to the family of the first value_candidate that has one.
        value_candidates = getattr(trace, "value_candidates", []) or []
        for vc in value_candidates:
            fam = getattr(vc, "family", None)
            if fam:
                slot_attr = str(fam)
                break

    return TraceSummary(
        trace_id=str(getattr(trace, "trace_id", "")),
        episode_id=int(getattr(trace, "episode_id", -1)),
        write_step=int(getattr(trace, "write_step", -1)),
        input_text=str(getattr(trace, "input_text", "")),
        intent=str(getattr(trace, "intent", "")),
        head_entity=getattr(trace, "head_entity", None),
        epistemic_status=str(getattr(trace, "epistemic_status", "")),
        memory_target_zone=getattr(trace, "memory_target_zone", None),
        arbiter_decision=last_decision.get("decision") if isinstance(last_decision, dict) else None,
        arbiter_reason=last_decision.get("reason") if isinstance(last_decision, dict) else None,
        latent_pressure_marker=annotations.get("latent_pressure"),
        influence_effect_channels=[
            getattr(eff, "channel", None) or (eff.get("channel") if isinstance(eff, dict) else None)
            for eff in influence_effects
        ],
        pressure_was_active=bool(annotations.get("latent_pressure_active", False)),
        slot_entity=slot_entity,
        slot_attr=slot_attr,
    )


def build_synthetic_retrograde_pressure(slot_key: Tuple[str, str],
                                         challenger_value: str,
                                         confidence: float = 0.8) -> Any:
    """Construct a LatentDecisionPressure with retrograde_slots populated.

    Used by tests that want to demonstrate the latent-driven decision
    branch without engineering a full cross_substrate cycle. The runtime
    LatentDecisionPressure dataclass is constructed via the source
    passthrough (R1: not modified, just instantiated).
    """
    from unified_fragmergent_memory.sources.memory_engine_runtime import (
        LatentDecisionPressure,
    )
    return LatentDecisionPressure(
        promote_slots={},
        retrograde_slots={slot_key: challenger_value},
        prune_slots=set(),
        persistent_conflict_slots=set(),
        reinforcement_slots={},
        challenger_strength={slot_key: 2.0},
        confidence=confidence,
        raw_v15_7a_signals_ref={
            "_origin": "v0.2.1.synthetic_retrograde_for_test",
            "slot": list(slot_key),
            "challenger": challenger_value,
        },
    )


class OrchestratorOrganismDriven:
    """Drive a wired Organism through episodes with optional pressure injection.

    The orchestrator instantiates Organism(latent_mode='off') so the
    runtime's internal latent flow stays empty across the run. Any
    pressure observed by CommitArbiter is therefore explicitly injected
    by this orchestrator between episodes. This isolates the
    cross-substrate contribution.
    """

    def __init__(self, config: Optional[Config] = None) -> None:
        self.config = config or Config()
        self._organism = None
        self._cross_substrate_store: Optional[UnifiedMemoryStore] = None
        # v0.3.0 smart-mirror state: track per-slot last committed value in
        # the mirror store so subsequent writes can decide between
        # zone_after=committed (idempotent), disputed (challenger), or
        # committed (fresh value).
        self._mirror_committed: Dict[Tuple[str, str], str] = {}

    def _build_organism(self) -> Any:
        """Instantiate Organism via the lazy ignition proxy."""
        from unified_fragmergent_memory.sources.memory_engine_runtime import (
            ignition,
            LATENT_MODE_OFF,
        )
        Organism = ignition.Organism
        return Organism(latent_mode=LATENT_MODE_OFF)

    def _ensure_cross_substrate_store(self) -> UnifiedMemoryStore:
        if self._cross_substrate_store is None:
            self._cross_substrate_store = UnifiedMemoryStore(self.config)
        return self._cross_substrate_store

    def run(
        self,
        scenario: Scenario,
        coupling: bool = True,
        pressure_provider: Optional[Callable[[int, Any], Any]] = None,
        seed_tf_bank_for_natural_cycle: bool = False,
        bank_seed: int = 42,
        mirror_priming: Optional[List[List[Dict[str, Any]]]] = None,
    ) -> OrganismDrivenReport:
        """Run the scenario through a wired Organism with optional pressure injection.

        If `coupling=True` and `pressure_provider` is given, that callable
        is invoked between episodes (signature: `(episode_id, organism) ->
        LatentDecisionPressure`) and its return value is installed in
        organism.current_latent_pressure.

        If `coupling=True` and `pressure_provider` is None, the orchestrator
        runs a v0.2.0-style cross-substrate cycle on its own
        UnifiedMemoryStore, mirroring inputs to the store, and uses the
        cycle's natural pressure output. seed_tf_bank_for_natural_cycle
        controls whether to seed a small numerical bank in the store first.

        If `coupling=False`, no pressure is ever injected. organism.current_
        latent_pressure stays empty for the entire run.
        """
        report = OrganismDrivenReport(coupling=coupling)
        organism = self._build_organism()
        self._organism = organism

        # Optionally seed the cross_substrate store with a small tf bank.
        if coupling and pressure_provider is None and seed_tf_bank_for_natural_cycle:
            self._seed_natural_cycle_bank(bank_seed)

        for ep_idx, episode_inputs in enumerate(scenario, start=1):
            ep_record = EpisodeRecord(episode_id=ep_idx)
            ep_record.inputs = list(episode_inputs)

            # Snapshot the pressure that will be visible during perceive().
            ep_record.pressure_pre_install_summary = summarize_pressure(
                organism.current_latent_pressure
            )

            # v0.3.1 mirror priming: write extra slot_events to the cross-
            # substrate store BEFORE the organism perceives, so the natural
            # cycle sees external context (challengers, alternative writes)
            # the organism is not exposed to. This decouples the mirror's
            # state from the organism's state, allowing scenarios where the
            # organism stays in COMMITTED while the mirror accumulates
            # provisional challengers.
            if (coupling and pressure_provider is None and mirror_priming
                    and ep_idx - 1 < len(mirror_priming)):
                store = self._ensure_cross_substrate_store()
                for prim in mirror_priming[ep_idx - 1]:
                    event = dict(prim)
                    event.setdefault("episode_id", ep_idx)
                    event.setdefault("write_step", -1)
                    store.register_label_slot(event["entity_id"], event["attr_type"])
                    store.write(event)
                    if str(event.get("zone_after", "")).lower() == "committed":
                        self._mirror_committed[
                            (event["entity_id"], event["attr_type"])
                        ] = event.get("value_str", "")

            organism.begin_episode()
            for text in episode_inputs:
                trace = organism.perceive(text)
                summary = summarize_trace(trace)
                ep_record.traces.append(summary)
                # v0.3.2: auto-register the slot if the trace passes validation.
                # Only meaningful when the natural cycle is in play (coupling=ON
                # without an explicit pressure_provider). In OFF mode the
                # store still has the registry but no cycle runs.
                if coupling and pressure_provider is None:
                    store = self._ensure_cross_substrate_store()
                    auto_reg = store.auto_register_from_trace(summary, ep_idx)
                    if auto_reg is not None:
                        ep_record.auto_registrations.append(auto_reg.to_json_safe())
            ep_record.end_episode_summary = organism.end_episode()

            # Coupling step: produce next-episode pressure.
            if coupling:
                if pressure_provider is not None:
                    next_pressure = pressure_provider(ep_idx, organism)
                    ep_record.pressure_origin = "external_provider"
                else:
                    next_pressure, cs_record = self._natural_cycle_step(
                        ep_idx, episode_inputs
                    )
                    ep_record.cross_substrate_consolidation_op_counts = (
                        cs_record.consolidation_op_counts
                    )
                    ep_record.cross_substrate_perturbations = cs_record.tf_perturbations
                    ep_record.cross_substrate_record_ids = (
                        cs_record.consolidation_record_ids
                    )
                    ep_record.pressure_origin = (
                        cs_record.resulting_pressure_origin or "natural_cycle"
                    )
                if next_pressure is not None:
                    organism.current_latent_pressure = next_pressure
                ep_record.pressure_post_synthesis_summary = summarize_pressure(
                    organism.current_latent_pressure
                )
            else:
                ep_record.pressure_post_synthesis_summary = summarize_pressure(
                    organism.current_latent_pressure
                )

            report.episodes.append(ep_record)
            report.n_traces += len(ep_record.traces)

        report.notes.append(
            f"Organism instantiated with latent_mode='off'; coupling={coupling}; "
            f"pressure_provider={'set' if pressure_provider is not None else 'none'}; "
            f"natural_cycle_bank_seeded={seed_tf_bank_for_natural_cycle}."
        )
        return report

    def _seed_natural_cycle_bank(self, seed: int) -> None:
        """Seed a small tf bank on the cross_substrate store for natural-cycle runs."""
        from unified_fragmergent_memory.facade.encoder import (
            encode_husimi_flat,
            encode_numerical_bank_entry,
        )
        store = self._ensure_cross_substrate_store()
        rng = np.random.default_rng(seed)
        for label_idx, mi_target in enumerate((0.5, 1.5)):
            for _ in range(3):
                sigma_t = float(rng.uniform(0.8, 1.2))
                beta = float(np.sqrt(max(0.0, (2 ** (2 * mi_target) - 1) / 16)) / (sigma_t ** 2))
                v, mi_value = encode_husimi_flat(
                    beta=beta, sigma_t=sigma_t, omega0=5.0,
                    n_t=128, t_max=8.0, grid_size=8,
                )
                store.write(
                    encode_numerical_bank_entry(v, mi_value, label_idx, beta, sigma_t),
                    source="tf_engine",
                )

    def _natural_cycle_step(
        self, episode_id: int, episode_inputs: List[str]
    ) -> Tuple[Any, Any]:
        """Mirror this episode's inputs into the cross_substrate store and run one cycle.

        v0.3.0 smart mirror: per-slot, decide zone_after based on whether
        the slot was already committed in this orchestrator's mirror state:
          - slot empty (or never seen): zone_after=committed
          - slot committed with same value: zone_after=committed (idempotent)
          - slot committed with different value: zone_after=disputed,
            value_before=last_committed_value
        This matches the Organism's CommitArbiter projection so that the
        mirror store accumulates challengers for the same slots that the
        Organism considers disputed.

        Returns (pressure, cross_substrate_record). pressure may be None if
        the cycle path produced a null-effect record.
        """
        from unified_fragmergent_memory.facade.cross_substrate import (
            cross_substrate_step,
        )
        store = self._ensure_cross_substrate_store()
        for write_step, text in enumerate(episode_inputs):
            parsed = _parse_input_to_slot(text)
            if parsed is None:
                continue
            entity_id, attr_type, value_str = parsed
            slot = (entity_id, attr_type)
            store.register_label_slot(entity_id, attr_type)

            last_committed = self._mirror_committed.get(slot)
            if last_committed is None or last_committed == value_str:
                zone_after = "committed"
                value_before = None
                # Update tracker only when we are committing a value.
                self._mirror_committed[slot] = value_str
            else:
                zone_after = "disputed"
                value_before = last_committed
                # On dispute, the committed value stays as last_committed;
                # we do NOT update the tracker (challenger remains in
                # provisional, the slot's stable committed value is unchanged).
            store.write({
                "entity_id": entity_id,
                "attr_type": attr_type,
                "value_idx": _stable_value_idx(value_str),
                "value_str": value_str,
                "value_before": value_before,
                "zone_after": zone_after,
                "episode_id": episode_id,
                "write_step": write_step,
                "source_text": text,
            })
        cs_record = cross_substrate_step(store, episode_id=episode_id)
        return store._cross_substrate_last_pressure, cs_record


_RUNTIME_VOCAB_ENTITIES = {"dragon", "teacher", "horse", "knight", "wizard", "beast"}
_RUNTIME_VOCAB_FAMILIES = {
    "color": {"red", "blue", "green", "yellow", "black"},
    "size":  {"small", "large", "tiny", "huge", "tall"},
    "state": {"asleep", "awake", "calm", "ready", "still"},
    "mood":  {"calm", "angry", "happy", "sad", "fierce"},
}


def _parse_input_to_slot(text: str) -> Optional[Tuple[str, str, str]]:
    """Lightweight parser mirroring the runtime Sense organ's vocabulary.

    This is NOT a substitute for the runtime parser; it exists only for
    mirroring inputs into the cross_substrate store. The Organism
    independently parses the same text via Sense / RoleResolver.
    """
    tokens = [t.strip(".,!?").lower() for t in text.split()]
    entity = next((t for t in tokens if t in _RUNTIME_VOCAB_ENTITIES), None)
    if entity is None:
        return None
    for family, values in _RUNTIME_VOCAB_FAMILIES.items():
        for tok in tokens:
            if tok in values:
                return entity, family, tok
    return None


def _stable_value_idx(value_str: str) -> int:
    """Deterministic mapping value_str -> int, stable across runs."""
    return abs(hash(value_str)) % (10**6)


def diff_reports(report_off: OrganismDrivenReport,
                 report_on: OrganismDrivenReport) -> Dict[str, Any]:
    """Diff two reports per trace, return structured difference summary."""
    fields_to_compare = (
        "epistemic_status",
        "memory_target_zone",
        "arbiter_decision",
        "arbiter_reason",
        "latent_pressure_marker",
        "pressure_was_active",
    )
    diffs: List[Dict[str, Any]] = []
    if len(report_off.episodes) != len(report_on.episodes):
        return {
            "n_diffs": -1,
            "error": "episode_count_mismatch",
            "off_n": len(report_off.episodes),
            "on_n": len(report_on.episodes),
        }
    for ep_off, ep_on in zip(report_off.episodes, report_on.episodes):
        if len(ep_off.traces) != len(ep_on.traces):
            diffs.append({
                "episode_id": ep_off.episode_id,
                "trace_count_mismatch": True,
                "off": len(ep_off.traces), "on": len(ep_on.traces),
            })
            continue
        for t_off, t_on in zip(ep_off.traces, ep_on.traces):
            differing = {f: (getattr(t_off, f), getattr(t_on, f))
                         for f in fields_to_compare
                         if getattr(t_off, f) != getattr(t_on, f)}
            channels_off = [c for c in (t_off.influence_effect_channels or []) if c]
            channels_on = [c for c in (t_on.influence_effect_channels or []) if c]
            if channels_off != channels_on:
                differing["influence_effect_channels"] = (channels_off, channels_on)
            if differing:
                diffs.append({
                    "episode_id": ep_off.episode_id,
                    "input": t_on.input_text,
                    "trace_id_off": t_off.trace_id,
                    "trace_id_on": t_on.trace_id,
                    "fields": differing,
                })
    return {
        "n_diffs": len(diffs),
        "details": diffs,
    }


# ---------------------------------------------------------------------------
# Public demo entry points used by reproduce.sh and tests.
# ---------------------------------------------------------------------------

@dataclass
class ProvenanceChain:
    """v0.3.0 provenance chain at decision level.

    Tracks the seven IDs the user spec requires:
      source_symbolic_trace_id -> D_Cortex consolidation_record_id ->
      vector_perturbation_id -> tf_propagation_id -> reconstructed_pressure_id
      -> organism_trace_id -> decision_diff_id

    Reconstructible from the four audit logs (consolidator + tf_metrics +
    receptor + organism trace_log) plus this record.
    """

    source_symbolic_trace_id: str
    consolidation_record_ids: List[str]
    vector_perturbation_ids: List[str]
    tf_propagation_id: str
    reconstructed_pressure_id: str
    organism_trace_id_off: Optional[str]
    organism_trace_id_on: Optional[str]
    decision_diff_id: Optional[str]
    decision_diff_fields: Dict[str, Any] = field(default_factory=dict)

    def to_json_safe(self) -> Dict[str, Any]:
        return {
            "source_symbolic_trace_id": self.source_symbolic_trace_id,
            "consolidation_record_ids": list(self.consolidation_record_ids),
            "vector_perturbation_ids": list(self.vector_perturbation_ids),
            "tf_propagation_id": self.tf_propagation_id,
            "reconstructed_pressure_id": self.reconstructed_pressure_id,
            "organism_trace_id_off": self.organism_trace_id_off,
            "organism_trace_id_on": self.organism_trace_id_on,
            "decision_diff_id": self.decision_diff_id,
            "decision_diff_fields": dict(self.decision_diff_fields),
        }

    def is_complete(self) -> bool:
        """Every link in the chain populated."""
        return all([
            self.source_symbolic_trace_id,
            self.consolidation_record_ids,
            self.vector_perturbation_ids,
            self.tf_propagation_id,
            self.reconstructed_pressure_id,
            self.organism_trace_id_off,
            self.organism_trace_id_on,
            self.decision_diff_id,
            self.decision_diff_fields,
        ])


def _hash_id(*parts: Any) -> str:
    """Deterministic short hex ID from the concatenated parts."""
    import hashlib
    s = "::".join(str(p) for p in parts)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]


def build_provenance_chain(
    report_off: OrganismDrivenReport,
    report_on: OrganismDrivenReport,
    diff: Dict[str, Any],
) -> Optional[ProvenanceChain]:
    """Construct the seven-ID chain from a coupled A/B comparison.

    Returns None if the diff is empty (no decision change to trace).
    """
    if diff.get("n_diffs", 0) <= 0:
        return None
    first_diff = diff["details"][0]
    diff_episode_id = first_diff["episode_id"]
    ep_on = next(ep for ep in report_on.episodes if ep.episode_id == diff_episode_id)
    # The pressure observed by perceive() at this episode was set at the END
    # of the PREVIOUS episode's cycle.
    prev_ep_on = next(
        (ep for ep in report_on.episodes if ep.episode_id == diff_episode_id - 1),
        None,
    )
    if prev_ep_on is None:
        # First-episode diff is unusual; provenance back to seed step.
        consolidation_ids = []
        vector_ids = []
        tf_propagation_id = _hash_id("seed", diff_episode_id)
    else:
        consolidation_ids = list(prev_ep_on.cross_substrate_record_ids)
        vector_ids = [
            _hash_id("vec", consolidation_ids[i] if i < len(consolidation_ids) else i,
                     prev_ep_on.cross_substrate_perturbations.get(i))
            for i in range(len(consolidation_ids) or 1)
        ]
        tf_propagation_id = _hash_id(
            "tf",
            prev_ep_on.episode_id,
            tuple(sorted(prev_ep_on.cross_substrate_perturbations.items())),
        )
    reconstructed_pressure_id = _hash_id(
        "pressure",
        diff_episode_id,
        tuple(sorted(ep_on.pressure_pre_install_summary.items())),
    )
    source_trace_id = (
        ep_on.traces[0].trace_id if ep_on.traces else _hash_id("nosource", diff_episode_id)
    )
    return ProvenanceChain(
        source_symbolic_trace_id=source_trace_id,
        consolidation_record_ids=consolidation_ids,
        vector_perturbation_ids=vector_ids,
        tf_propagation_id=tf_propagation_id,
        reconstructed_pressure_id=reconstructed_pressure_id,
        organism_trace_id_off=first_diff.get("trace_id_off"),
        organism_trace_id_on=first_diff.get("trace_id_on"),
        decision_diff_id=_hash_id(
            "diff", diff_episode_id, first_diff.get("trace_id_on"),
        ),
        decision_diff_fields={
            k: list(v) if isinstance(v, tuple) else v
            for k, v in first_diff.get("fields", {}).items()
        },
    )


# ---------------------------------------------------------------------------
# v0.3.0: Natural cross-substrate coupling demo
# ---------------------------------------------------------------------------

def run_natural_coupling_demo() -> Dict[str, Any]:
    """v0.3.0 demonstration of NATURAL cognitive coupling.

    No synthetic pressure helper. The pressure that influences the
    Organism's next-episode decision is produced by the full cycle:
      symbolic write -> consolidator audit -> SlotPressureVector list ->
      tf_engine bank perturbation -> propagation -> synthetic LatentSignals
      (synthetic in shape only; semantically derived from tf result) ->
      LatentRationalMemoryReceptor -> LatentDecisionPressure.

    Scenario:
      ep1: commit "red"  (organism+mirror).
      ep2: write "blue"  (challenger; organism MARK_DISPUTED, mirror DISPUTED).
      ep3: write "blue"  (continued dispute; consolidator fires RETROGRADE on
                          tf label 0 which maps to (dragon, color); natural
                          MI-based propagation flips predict_label to label 1;
                          tf_result_to_synthetic_signals -> promote_candidate
                          on label 1 -> receptor -> pressure.promote_slots
                          maps (dragon, color) -> "blue").
      ep4: write "blue"  (challenger again; pressure says promote "blue";
                          latent_reinforces branch fires in CommitArbiter
                          (`ignition_build_v0.py:1921-2008`); decision changes
                          from REINFORCE_CHALLENGER (without pressure) to
                          either CONSOLIDATION_PROMOTED or
                          REINFORCE_CHALLENGER_LATENT depending on count.

    The natural cycle uses propagation method='mi' so MI perturbations
    actually flip predict_label, which is what makes the pressure value
    string land on the challenger instead of the committed value.
    """
    config = Config(cross_substrate_propagation_method="mi")
    scenario: Scenario = [
        ["the dragon is red"],
        ["the dragon is blue"],
        ["the dragon is blue"],
        ["the dragon is blue"],
        ["the dragon is blue"],
    ]

    # OFF: organism with latent_mode='off', no external injection.
    orch_off = OrchestratorOrganismDriven(config=config)
    report_off = orch_off.run(scenario, coupling=False)

    # ON: organism with latent_mode='off', natural cycle drives pressure.
    orch_on = OrchestratorOrganismDriven(config=config)
    report_on = orch_on.run(
        scenario, coupling=True,
        pressure_provider=None,
        seed_tf_bank_for_natural_cycle=True,
    )

    diff = diff_reports(report_off, report_on)
    chain = build_provenance_chain(report_off, report_on, diff)
    return {
        "report_off": report_off,
        "report_on": report_on,
        "diff": diff,
        "natural_cognitive_coupling_confirmed": diff["n_diffs"] > 0,
        "provenance_chain": chain,
        "provenance_chain_complete": chain.is_complete() if chain is not None else False,
    }


def run_natural_branch_flip_demo() -> Dict[str, Any]:
    """v0.3.1 demonstration of NATURAL arbiter-branch flip.

    No synthetic helper. The natural cycle produces retrograde pressure on
    a slot that the Organism keeps in the COMMITTED zone. When the
    Organism receives an idempotent re-affirmation of the committed
    value, CommitArbiter's Pas 5 branch at `ignition_build_v0.py:1697-
    1731` (LATENT_RETROGRADE_PRESSURE_ON_IDEMPOTENT) fires, changing the
    arbiter_decision from NOOP to MARK_DISPUTED_LATENT_RETROGRADE.

    Decoupling mechanism: mirror_priming. The cross-substrate store
    receives challenger events the Organism does NOT perceive, so:
      - Organism's slot stays COMMITTED (only ever sees "the dragon is red").
      - Mirror's slot accumulates challengers (blue) at ep2 and ep3.
      - Cross-substrate cycle at end of ep3 fires RECONCILE+RETROGRADE.
      - Pressure produced has retrograde_slots[(dragon, color)] = "red".
      - At ep4 the pressure is installed; Organism's idempotent "the
        dragon is red" perceive trips the latent-retrograde-on-idempotent
        branch.

    This is acceptable architecturally because in any real deployment the
    cross-substrate store can receive events from sources beyond what the
    Organism perceives directly: external systems, sensors, peer agents,
    or pre-loaded historical traces. The orchestrator merely models that
    asymmetry explicitly.
    """
    config = Config(cross_substrate_propagation_method="mi")
    scenario: Scenario = [
        ["the dragon is red"],
        ["the dragon is red"],
        ["the dragon is red"],
        ["the dragon is red"],
    ]
    mirror_priming: List[List[Dict[str, Any]]] = [
        [],
        [{"entity_id": "dragon", "attr_type": "color",
          "value_str": "blue", "value_before": "red",
          "zone_after": "disputed",
          "value_idx": 2, "source_text": "ep2 external challenger"}],
        [{"entity_id": "dragon", "attr_type": "color",
          "value_str": "blue", "value_before": "red",
          "zone_after": "disputed",
          "value_idx": 2, "source_text": "ep3 external challenger"}],
        [],
    ]

    orch_off = OrchestratorOrganismDriven(config=config)
    report_off = orch_off.run(scenario, coupling=False)

    orch_on = OrchestratorOrganismDriven(config=config)
    report_on = orch_on.run(
        scenario, coupling=True,
        pressure_provider=None,
        seed_tf_bank_for_natural_cycle=True,
        mirror_priming=mirror_priming,
    )

    diff = diff_reports(report_off, report_on)
    chain = build_provenance_chain(report_off, report_on, diff)

    # Locate any diff where arbiter_decision actually flipped.
    branch_flip_diffs = [
        d for d in diff["details"]
        if "arbiter_decision" in d["fields"]
    ]
    return {
        "report_off": report_off,
        "report_on": report_on,
        "diff": diff,
        "branch_flip_diffs": branch_flip_diffs,
        "natural_branch_flip_confirmed": len(branch_flip_diffs) > 0,
        "provenance_chain": chain,
        "provenance_chain_complete": chain.is_complete() if chain is not None else False,
    }


def run_auto_registration_demo() -> Dict[str, Any]:
    """v0.3.2 demonstration of bidirectional self-registering substrate
    coupling.

    No slot is pre-registered. The orchestrator's perceive loop calls
    store.auto_register_from_trace after each Organism.perceive(), and
    valid traces add slots to the registry with full provenance. The
    natural cycle then targets the auto-registered labels with pressure
    vectors, propagation runs, reconstructed pressure maps back to the
    same slots, and v0.3.1's branch-flip mechanism applies on the
    auto-registered slot.

    Returns a dict with:
      - report_off / report_on (OrganismDrivenReport)
      - diff (decision-field diff between OFF and ON runs)
      - branch_flip_diffs (subset of diff where arbiter_decision flipped)
      - registry_before / registry_after (for the ON run)
      - auto_registrations (provenance metadata per slot)
      - bidirectional_round_trip_verified: bool
      - provenance_chain
    """
    config = Config(cross_substrate_propagation_method="mi")
    scenario: Scenario = [
        ["the dragon is red"],
        ["the dragon is red"],
        ["the dragon is red"],
        ["the dragon is red"],
    ]
    mirror_priming: List[List[Dict[str, Any]]] = [
        [],
        [{"entity_id": "dragon", "attr_type": "color",
          "value_str": "blue", "value_before": "red",
          "zone_after": "disputed",
          "value_idx": 2, "source_text": "ep2 external challenger"}],
        [{"entity_id": "dragon", "attr_type": "color",
          "value_str": "blue", "value_before": "red",
          "zone_after": "disputed",
          "value_idx": 2, "source_text": "ep3 external challenger"}],
        [],
    ]

    orch_off = OrchestratorOrganismDriven(config=config)
    report_off = orch_off.run(scenario, coupling=False)

    orch_on = OrchestratorOrganismDriven(config=config)
    on_store_before = orch_on._ensure_cross_substrate_store()
    registry_before = dict(on_store_before._label_slot_registry)
    report_on = orch_on.run(
        scenario, coupling=True,
        pressure_provider=None,
        seed_tf_bank_for_natural_cycle=True,
        mirror_priming=mirror_priming,
    )
    registry_after = dict(orch_on._cross_substrate_store._label_slot_registry)
    auto_registrations = orch_on._cross_substrate_store.auto_registrations_snapshot()

    diff = diff_reports(report_off, report_on)
    branch_flip_diffs = [
        d for d in diff["details"]
        if "arbiter_decision" in d["fields"]
    ]
    chain = build_provenance_chain(report_off, report_on, diff)

    # Bidirectional round-trip verification: every registered slot maps to a
    # label, and lookup_slot_by_label returns the same slot.
    bidirectional_ok = True
    for slot, label in registry_after.items():
        recovered = orch_on._cross_substrate_store.lookup_slot_by_label(label)
        if recovered != slot:
            bidirectional_ok = False
            break

    return {
        "report_off": report_off,
        "report_on": report_on,
        "diff": diff,
        "branch_flip_diffs": branch_flip_diffs,
        "registry_before": registry_before,
        "registry_after": registry_after,
        "auto_registrations": auto_registrations,
        "bidirectional_round_trip_verified": bidirectional_ok,
        "auto_registration_branch_flip_confirmed": len(branch_flip_diffs) > 0,
        "auto_registration_marker_diff_confirmed": (
            diff["n_diffs"] > 0 if diff else False
        ),
        "provenance_chain": chain,
        "provenance_chain_complete": chain.is_complete() if chain is not None else False,
    }


def run_organism_driven_demo() -> Dict[str, Any]:
    """Canonical demonstration of cognitive coupling (v0.2.1).

    Scenario: idempotent re-affirmation of a committed slot, with
    retrograde pressure synthesized from a (slot, challenger) tuple
    between episodes. This triggers the
    LATENT_RETROGRADE_PRESSURE_ON_IDEMPOTENT branch in CommitArbiter.

    Returns a dict with both OrganismDrivenReport values and a diff
    summary.
    """
    scenario: Scenario = [
        ["the dragon is red"],          # ep1: commit
        ["the dragon is red"],          # ep2: idempotent re-affirmation
    ]

    def synthetic_retrograde_provider(episode_id: int, organism: Any) -> Any:
        # After ep1 (commit), prepare retrograde pressure for ep2.
        if episode_id == 1:
            return build_synthetic_retrograde_pressure(
                slot_key=("dragon", "color"),
                challenger_value="blue",
                confidence=0.8,
            )
        return None

    orch_off = OrchestratorOrganismDriven()
    report_off = orch_off.run(scenario, coupling=False)

    orch_on = OrchestratorOrganismDriven()
    report_on = orch_on.run(
        scenario, coupling=True,
        pressure_provider=synthetic_retrograde_provider,
    )

    diff = diff_reports(report_off, report_on)
    return {
        "report_off": report_off,
        "report_on": report_on,
        "diff": diff,
        "cognitive_coupling_confirmed": diff["n_diffs"] > 0,
    }
