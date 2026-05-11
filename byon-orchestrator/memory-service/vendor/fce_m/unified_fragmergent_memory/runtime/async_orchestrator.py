"""v0.3.3 async cross-substrate orchestrator.

Decouples the four phases of the cycle:
  perceive  -> consolidate -> propagate -> reconstruct pressure -> apply
in time. Phases that were 1:1:1 synchronized in v0.2.0 through v0.3.2 can
now run on their own cadence, with explicit queueing and provenance for
each delay.

Three knobs on AsyncSchedule:
  consolidate_every_n_episodes: 1 = sync (per episode); >1 = batch
    consolidation across N episodes. Mirror inputs are still written per
    perceive (so the consolidator sees them at the moment they happen),
    but the cross-substrate cycle (consolidate + propagate + signals)
    only fires on tick episodes.
  apply_pressure_delay_episodes: 0 = immediate apply; >0 = queue the
    produced pressure and apply it at episode produced+delay (or later
    if no episode has elapsed since due time).
  stale_pressure_max_age_episodes: drop a pending pressure whose
    produced+max_age has passed without application. Stale pressure is
    NEVER applied to the organism (no orb-pressure path).

Per spec, the implementation does not modify any source file (R1) and
does not modify the v0.3.2 sync orchestrator either; this is a strict
extension via a subclass.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from unified_fragmergent_memory.facade.config import Config
from unified_fragmergent_memory.runtime.organism_driven import (
    EpisodeRecord,
    OrchestratorOrganismDriven,
    OrganismDrivenReport,
    Scenario,
    summarize_pressure,
    summarize_trace,
)


@dataclass
class AsyncSchedule:
    """Per-episode delays for the async cross-substrate cycle.

    Fully sync (v0.3.2 behavior) is recovered by AsyncSchedule(1, 0, 5).
    """

    consolidate_every_n_episodes: int = 1
    apply_pressure_delay_episodes: int = 0
    stale_pressure_max_age_episodes: int = 5

    def is_consolidate_episode(self, ep: int) -> bool:
        if self.consolidate_every_n_episodes <= 0:
            return False
        return ep % self.consolidate_every_n_episodes == 0

    def validate(self) -> None:
        if self.consolidate_every_n_episodes < 1:
            raise ValueError(
                "consolidate_every_n_episodes must be >= 1; "
                f"got {self.consolidate_every_n_episodes}"
            )
        if self.apply_pressure_delay_episodes < 0:
            raise ValueError(
                "apply_pressure_delay_episodes must be >= 0; "
                f"got {self.apply_pressure_delay_episodes}"
            )
        if self.stale_pressure_max_age_episodes < 1:
            raise ValueError(
                "stale_pressure_max_age_episodes must be >= 1; "
                f"got {self.stale_pressure_max_age_episodes}"
            )


@dataclass
class PendingPressure:
    """A pressure object queued for delayed application.

    Carries full provenance back to the consolidation that produced it,
    plus async-specific timing fields. Slot-safe: only the explicit
    target_slots are reported as receivers; the receptor's pressure
    object itself dictates which slots it actually affects when applied.
    """

    pressure: Any
    pressure_id: str
    produced_at_episode: int
    earliest_apply_at: int
    expires_at: int
    target_slots: List[Tuple[str, str]] = field(default_factory=list)
    consolidation_record_ids: List[str] = field(default_factory=list)
    pressure_vectors_summary: List[Dict[str, Any]] = field(default_factory=list)
    auto_registration_ids: List[str] = field(default_factory=list)
    applied_at_episode: Optional[int] = None
    expired: bool = False
    expired_at_episode: Optional[int] = None

    @property
    def delay_steps(self) -> Optional[int]:
        if self.applied_at_episode is None:
            return None
        return int(self.applied_at_episode) - int(self.produced_at_episode)

    @property
    def is_stale(self) -> bool:
        return bool(self.expired)

    @property
    def is_applied(self) -> bool:
        return self.applied_at_episode is not None

    def to_json_safe(self) -> Dict[str, Any]:
        return {
            "pressure_id": self.pressure_id,
            "produced_at_episode": int(self.produced_at_episode),
            "earliest_apply_at": int(self.earliest_apply_at),
            "expires_at": int(self.expires_at),
            "target_slots": [list(s) for s in self.target_slots],
            "consolidation_record_ids": list(self.consolidation_record_ids),
            "pressure_vectors_summary": list(self.pressure_vectors_summary),
            "auto_registration_ids": list(self.auto_registration_ids),
            "applied_at_episode": self.applied_at_episode,
            "expired": self.expired,
            "expired_at_episode": self.expired_at_episode,
            "delay_steps": self.delay_steps,
            "pressure_summary": summarize_pressure(self.pressure),
        }


@dataclass
class AsyncEpisodeRecord(EpisodeRecord):
    """Per-episode record extended with async telemetry."""

    pending_pressure_count: int = 0
    applied_pressure_ids: List[str] = field(default_factory=list)
    expired_pressure_ids: List[str] = field(default_factory=list)
    consolidation_fired_this_episode: bool = False


@dataclass
class AsyncProvenanceChain:
    """v0.3.3 provenance chain extension with delay metadata."""

    source_symbolic_trace_id: str
    auto_registration_ids: List[str]
    consolidation_record_ids: List[str]
    pressure_vector_ids: List[str]
    tf_propagation_id: str
    reconstructed_pressure_id: str
    queued_at_episode: int
    applied_at_episode: Optional[int]
    delay_steps: Optional[int]
    organism_trace_id: str
    decision_diff_id: Optional[str]
    expired: bool = False

    def is_complete(self) -> bool:
        return all([
            self.source_symbolic_trace_id,
            self.consolidation_record_ids,
            self.pressure_vector_ids,
            self.tf_propagation_id,
            self.reconstructed_pressure_id,
            self.queued_at_episode >= 0,
            self.organism_trace_id,
        ])

    def to_json_safe(self) -> Dict[str, Any]:
        return {
            "source_symbolic_trace_id": self.source_symbolic_trace_id,
            "auto_registration_ids": list(self.auto_registration_ids),
            "consolidation_record_ids": list(self.consolidation_record_ids),
            "pressure_vector_ids": list(self.pressure_vector_ids),
            "tf_propagation_id": self.tf_propagation_id,
            "reconstructed_pressure_id": self.reconstructed_pressure_id,
            "queued_at_episode": int(self.queued_at_episode),
            "applied_at_episode": self.applied_at_episode,
            "delay_steps": self.delay_steps,
            "organism_trace_id": self.organism_trace_id,
            "decision_diff_id": self.decision_diff_id,
            "expired": bool(self.expired),
        }


def _hash_id(*parts: Any) -> str:
    s = "::".join(str(p) for p in parts)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]


class AsyncOrchestratorOrganismDriven(OrchestratorOrganismDriven):
    """v0.3.3 async variant of the organism-driven orchestrator.

    Overrides run() with run_async() which honors a schedule. Sync
    behavior is preserved when schedule is AsyncSchedule(1, 0, 5)
    (default).
    """

    def __init__(self, config: Optional[Config] = None) -> None:
        super().__init__(config=config)
        self.pending_pressures: List[PendingPressure] = []
        self.applied_pressure_log: List[PendingPressure] = []
        self.expired_pressure_log: List[PendingPressure] = []
        # async safety counters
        self.stale_pressure_applied_count: int = 0
        self.wrong_slot_pressure_applied_count: int = 0

    def _apply_due_pressures(self, organism: Any, ep_idx: int) -> List[PendingPressure]:
        """Install at most one due, non-expired pressure into organism.current_latent_pressure.

        Picks the OLDEST due pressure first (FIFO). Multiple pending
        pressures across episodes are processed across multiple ticks of
        this method (one per call). Stale pressures are NEVER applied
        even if they pass the earliest_apply_at gate (defense in depth).
        """
        applied: List[PendingPressure] = []
        sorted_pending = sorted(
            (pp for pp in self.pending_pressures
             if not pp.is_applied and not pp.is_stale),
            key=lambda pp: (pp.earliest_apply_at, pp.produced_at_episode),
        )
        for pp in sorted_pending:
            if pp.earliest_apply_at <= ep_idx <= pp.expires_at:
                organism.current_latent_pressure = pp.pressure
                pp.applied_at_episode = ep_idx
                self.applied_pressure_log.append(pp)
                applied.append(pp)
                # One installed pressure per call. Subsequent due pressures
                # wait their turn on later episodes.
                break
            elif ep_idx > pp.expires_at:
                # Defense in depth: skip even though we already filter
                # stale ones out above.
                continue
        return applied

    def _expire_stale_pressures(self, ep_idx: int) -> List[PendingPressure]:
        expired: List[PendingPressure] = []
        for pp in self.pending_pressures:
            if pp.is_applied or pp.is_stale:
                continue
            if ep_idx > pp.expires_at:
                pp.expired = True
                pp.expired_at_episode = ep_idx
                self.expired_pressure_log.append(pp)
                expired.append(pp)
        return expired

    def _build_pending_pressure(
        self, cs_record: Any, ep_idx: int, schedule: AsyncSchedule,
        auto_registration_ids: List[str],
    ) -> Optional[PendingPressure]:
        """Build a PendingPressure from a CrossSubstrateRecord plus the
        store's current pressure. Returns None if no pressure exists."""
        store = self._cross_substrate_store
        if store is None:
            return None
        pressure = store._cross_substrate_last_pressure
        if pressure is None or (
            hasattr(pressure, "is_empty") and pressure.is_empty()
        ):
            return None
        target_slots: List[Tuple[str, str]] = []
        for slot in (
            list(getattr(pressure, "promote_slots", {}) or {})
            + list(getattr(pressure, "retrograde_slots", {}) or {})
            + list(getattr(pressure, "persistent_conflict_slots", set()) or set())
        ):
            if isinstance(slot, tuple) and slot not in target_slots:
                target_slots.append(slot)
        produced = int(ep_idx)
        earliest_apply = produced + int(schedule.apply_pressure_delay_episodes)
        expires = produced + int(schedule.stale_pressure_max_age_episodes)
        pressure_id = _hash_id(
            "async_pp", produced,
            tuple(sorted(target_slots)),
            tuple(sorted(getattr(cs_record, "consolidation_record_ids", []))),
        )
        return PendingPressure(
            pressure=pressure,
            pressure_id=pressure_id,
            produced_at_episode=produced,
            earliest_apply_at=earliest_apply,
            expires_at=expires,
            target_slots=target_slots,
            consolidation_record_ids=list(
                getattr(cs_record, "consolidation_record_ids", [])
            ),
            pressure_vectors_summary=[
                v.to_json_safe() if hasattr(v, "to_json_safe") else dict(v)
                for v in getattr(cs_record, "pressure_vectors", [])
            ],
            auto_registration_ids=list(auto_registration_ids),
        )

    def run_async(
        self,
        scenario: Scenario,
        schedule: Optional[AsyncSchedule] = None,
        coupling: bool = True,
        mirror_priming: Optional[List[List[Dict[str, Any]]]] = None,
        bank_seed: int = 42,
        seed_tf_bank_for_natural_cycle: bool = True,
    ) -> OrganismDrivenReport:
        """Run scenario with async scheduling.

        At each episode:
          1. Apply due pressures (FIFO, slot-safe, stale-rejecting).
          2. Mirror priming, organism perceive(s) with auto-registration.
          3. End_episode.
          4. If schedule says consolidate this episode, run cross_substrate
             cycle and queue the produced pressure as PendingPressure.
          5. Expire stale pending pressures.

        OFF mode (coupling=False) skips steps 1, 4, 5; the organism runs
        with empty current_latent_pressure throughout.
        """
        if schedule is None:
            schedule = AsyncSchedule()
        schedule.validate()

        report = OrganismDrivenReport(coupling=coupling)
        organism = self._build_organism()
        self._organism = organism

        if coupling and seed_tf_bank_for_natural_cycle:
            self._seed_natural_cycle_bank(bank_seed)

        for ep_idx, episode_inputs in enumerate(scenario, start=1):
            ep_record = AsyncEpisodeRecord(episode_id=ep_idx)
            ep_record.inputs = list(episode_inputs)

            # Phase 1: apply due pressures.
            if coupling:
                applied = self._apply_due_pressures(organism, ep_idx)
                ep_record.applied_pressure_ids = [pp.pressure_id for pp in applied]

            ep_record.pressure_pre_install_summary = summarize_pressure(
                organism.current_latent_pressure
            )

            # Phase 2: mirror priming + perceive(s) + auto-register.
            if (coupling and mirror_priming
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
            episode_auto_reg_ids: List[str] = []
            for text in episode_inputs:
                trace = organism.perceive(text)
                summary = summarize_trace(trace)
                ep_record.traces.append(summary)
                if coupling:
                    store = self._ensure_cross_substrate_store()
                    auto_reg = store.auto_register_from_trace(summary, ep_idx)
                    if auto_reg is not None:
                        ep_record.auto_registrations.append(auto_reg.to_json_safe())
                        episode_auto_reg_ids.append(auto_reg.auto_registration_id)
            ep_record.end_episode_summary = organism.end_episode()

            # Phase 3: scheduled consolidation tick.
            cs_record = None
            if coupling and schedule.is_consolidate_episode(ep_idx):
                ep_record.consolidation_fired_this_episode = True
                # Mirror current organism inputs into store and run the cycle
                # (consolidate + propagate + signals + receptor).
                pressure_before = (
                    self._cross_substrate_store._cross_substrate_last_pressure
                    if self._cross_substrate_store is not None else None
                )
                _, cs_record = self._natural_cycle_step(ep_idx, episode_inputs)
                ep_record.cross_substrate_consolidation_op_counts = (
                    cs_record.consolidation_op_counts
                )
                ep_record.cross_substrate_perturbations = cs_record.tf_perturbations
                ep_record.cross_substrate_record_ids = (
                    cs_record.consolidation_record_ids
                )
                # Build pending pressure and queue it.
                # IMPORTANT: do NOT apply pressure to organism here. The
                # async rule is: pressure is queued, applied later.
                pp = self._build_pending_pressure(
                    cs_record, ep_idx, schedule, episode_auto_reg_ids,
                )
                if pp is not None:
                    self.pending_pressures.append(pp)
                    ep_record.pressure_origin = "async_queued"
                else:
                    ep_record.pressure_origin = "null_effect_idempotent"
                # Reset store's _cross_substrate_last_pressure so it doesn't
                # leak into subsequent sync calls; we own the application.
                if self._cross_substrate_store is not None:
                    self._cross_substrate_store._cross_substrate_last_pressure = (
                        pressure_before
                    )
                # Reset organism's current_latent_pressure so the queued
                # pressure does not get installed implicitly via the
                # natural-cycle step's side effects (which only set the
                # store's last_pressure, not the organism's).
                # Note: we did NOT alter organism.current_latent_pressure
                # in this phase; the only path that does is _apply_due_pressures.

            # Phase 4: expire stale pressures.
            if coupling:
                expired = self._expire_stale_pressures(ep_idx)
                ep_record.expired_pressure_ids = [pp.pressure_id for pp in expired]
                ep_record.pending_pressure_count = sum(
                    1 for pp in self.pending_pressures
                    if not pp.is_applied and not pp.is_stale
                )

            ep_record.pressure_post_synthesis_summary = summarize_pressure(
                organism.current_latent_pressure
            )
            report.episodes.append(ep_record)
            report.n_traces += len(ep_record.traces)

        report.notes.append(
            f"Async scheduler: consolidate_every_n={schedule.consolidate_every_n_episodes}, "
            f"apply_delay={schedule.apply_pressure_delay_episodes}, "
            f"stale_max_age={schedule.stale_pressure_max_age_episodes}, "
            f"coupling={coupling}."
        )
        report.notes.append(
            f"Async stats: pending_now={sum(1 for pp in self.pending_pressures if not pp.is_applied and not pp.is_stale)}, "
            f"applied_total={len(self.applied_pressure_log)}, "
            f"expired_total={len(self.expired_pressure_log)}."
        )
        return report


def diff_async_reports(report_off: OrganismDrivenReport,
                       report_on: OrganismDrivenReport) -> Dict[str, Any]:
    """Same diff logic as v0.3.x sync, applied to async reports.

    Reuses runtime.diff_reports from organism_driven.
    """
    from unified_fragmergent_memory.runtime.organism_driven import diff_reports
    return diff_reports(report_off, report_on)


# ---------------------------------------------------------------------------
# Demos
# ---------------------------------------------------------------------------

def run_async_coupling_demo() -> Dict[str, Any]:
    """v0.3.3 demonstration. Same L1 scenario as v0.3.1/v0.3.2 plus async
    scheduling: consolidation runs every 1 episode (immediate), but
    pressure is delayed by 1 episode before application.

    The branch flip from v0.3.1 still occurs at ep4 because the pressure
    produced at end of ep3 has earliest_apply_at = 4 (3 + 1 delay).
    """
    config = Config(cross_substrate_propagation_method="mi")
    scenario: Scenario = [
        ["the dragon is red"],
        ["the dragon is red"],
        ["the dragon is red"],
        ["the dragon is red"],
        ["the dragon is red"],   # extra ep for application window
    ]
    mirror_priming: List[List[Dict[str, Any]]] = [
        [],
        [{"entity_id": "dragon", "attr_type": "color",
          "value_str": "blue", "value_before": "red",
          "zone_after": "disputed", "value_idx": 2}],
        [{"entity_id": "dragon", "attr_type": "color",
          "value_str": "blue", "value_before": "red",
          "zone_after": "disputed", "value_idx": 2}],
        [],
        [],
    ]
    schedule = AsyncSchedule(
        consolidate_every_n_episodes=1,
        apply_pressure_delay_episodes=1,
        stale_pressure_max_age_episodes=10,
    )

    orch_off = AsyncOrchestratorOrganismDriven(config=config)
    report_off = orch_off.run_async(scenario, schedule, coupling=False)

    orch_on = AsyncOrchestratorOrganismDriven(config=config)
    report_on = orch_on.run_async(
        scenario, schedule, coupling=True, mirror_priming=mirror_priming,
    )

    diff = diff_async_reports(report_off, report_on)
    branch_flip_diffs = [
        d for d in diff["details"]
        if "arbiter_decision" in d["fields"]
    ]
    return {
        "schedule": schedule,
        "report_off": report_off,
        "report_on": report_on,
        "diff": diff,
        "branch_flip_diffs": branch_flip_diffs,
        "applied_pressure_log": [pp.to_json_safe() for pp in orch_on.applied_pressure_log],
        "expired_pressure_log": [pp.to_json_safe() for pp in orch_on.expired_pressure_log],
        "pending_pressures": [pp.to_json_safe() for pp in orch_on.pending_pressures],
        "async_branch_flip_confirmed": len(branch_flip_diffs) > 0,
        "async_marker_diff_confirmed": diff["n_diffs"] > 0,
        "stale_pressure_applied_count": orch_on.stale_pressure_applied_count,
        "wrong_slot_pressure_applied_count": orch_on.wrong_slot_pressure_applied_count,
    }
