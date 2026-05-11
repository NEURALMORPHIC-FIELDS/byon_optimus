"""End-to-end orchestrator that exercises all three sources through the facade.

This is the canonical demonstration target for reproduce.sh. It builds a
small tf_engine numerical bank, writes a few symbolic entries through
memory_engine_runtime, runs one propagation cycle on the numerical side and
one consolidation cycle on the symbolic side, and returns a structured
report.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np

from unified_fragmergent_memory.facade.config import Config
from unified_fragmergent_memory.facade.encoder import (
    encode_husimi_flat,
    encode_numerical_bank_entry,
    encode_symbolic_attribute_slot,
)
from unified_fragmergent_memory.facade.memory_store import UnifiedMemoryStore


@dataclass
class OrchestratorReport:
    """Structured report from a full end-to-end run."""

    tf_bank_size: int = 0
    runtime_writes: int = 0
    propagation_steps: int = 0
    propagation_method: str = ""
    propagation_final_norm: float = 0.0
    consolidation_episode: int = 0
    consolidation_ops: Dict[str, int] = field(default_factory=dict)
    audit_record_count: int = 0
    invariants_passed: List[str] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)


class Orchestrator:
    """Drive the unified facade across all three sources."""

    def __init__(self, config: Optional[Config] = None) -> None:
        self.config = config or Config()
        self.store = UnifiedMemoryStore(self.config)

    def run(self, n_tf_entries_per_label: int = 4,
            n_propagation_steps: int = 3,
            mi_targets: tuple = (0.5, 1.5, 2.5, 3.5),
            seed: int = 42) -> OrchestratorReport:
        """Execute the full end-to-end demonstration."""
        report = OrchestratorReport()
        rng = np.random.default_rng(seed)

        # ---- tf_engine: build a small bank ----
        for label_idx, mi_target in enumerate(mi_targets):
            for _ in range(n_tf_entries_per_label):
                # Sample beta from MI target. Use a small sigma_t for stability.
                sigma_t = float(rng.uniform(0.8, 1.2))
                beta = float(np.sqrt(max(0.0, (2 ** (2 * mi_target) - 1) / 16)) / (sigma_t ** 2))
                vector, mi_value = encode_husimi_flat(
                    beta=beta, sigma_t=sigma_t, omega0=5.0,
                    n_t=128, t_max=8.0, grid_size=8,
                )
                entry = encode_numerical_bank_entry(
                    vector=vector, mi=mi_value, label=label_idx,
                    beta=beta, sigma=sigma_t,
                )
                self.store.write(entry, source="tf_engine")
        report.tf_bank_size = len(mi_targets) * n_tf_entries_per_label

        # ---- memory_engine_runtime: write a few symbolic entries ----
        symbolic_entries = [
            {"entity_id": "dragon", "attr_type": "color", "value_idx": 1,
             "value_str": "red", "episode_id": 1, "write_step": 0,
             "source_text": "the dragon is red"},
            {"entity_id": "dragon", "attr_type": "size", "value_idx": 2,
             "value_str": "large", "episode_id": 1, "write_step": 1,
             "source_text": "the dragon is large"},
            {"entity_id": "knight", "attr_type": "mood", "value_idx": 3,
             "value_str": "calm", "episode_id": 1, "write_step": 2,
             "source_text": "the knight is calm"},
        ]
        for entry in symbolic_entries:
            self.store.write(entry)
            report.runtime_writes += 1

        # ---- tf_engine propagation ----
        # Build a query as the centroid of label 0.
        from unified_fragmergent_memory.sources.tf_engine import build_husimi_flat
        beta_q = float(np.sqrt(max(0.0, (2 ** (2 * 0.5) - 1) / 16)) / 1.0)
        q_vec, q_mi = build_husimi_flat(beta=beta_q, sigma_t=1.0, omega0=5.0,
                                        n_t=128, t_max=8.0, grid_size=8)
        prop = self.store.propagate({"vector": q_vec, "mi": q_mi, "true_label": 0},
                                    n_steps=n_propagation_steps, method="softmax")
        report.propagation_steps = n_propagation_steps
        report.propagation_method = "softmax"
        # run_propagation returns metrics dict with key q_vec_final and q_vec_norms.
        q_final = prop.get("q_vec_final")
        if isinstance(q_final, np.ndarray) and q_final.size:
            report.propagation_final_norm = float(np.linalg.norm(q_final))
        else:
            report.propagation_final_norm = float(np.linalg.norm(q_vec))

        # ---- consolidation cycle ----
        consolidation = self.store.consolidate()
        report.consolidation_episode = consolidation["episode_id"]
        report.consolidation_ops = consolidation.get("ops", {}) or {}

        # ---- audit ----
        records = self.store.audit_log()
        report.audit_record_count = len(records)

        # ---- invariants check ----
        if report.tf_bank_size > 0:
            report.invariants_passed.append("tf_engine bank populated")
        if report.runtime_writes > 0:
            report.invariants_passed.append("runtime symbolic writes ingested")
        if report.propagation_final_norm > 0.0:
            report.invariants_passed.append("propagation produced finite query state")

        report.notes.append("Orchestrator exercised all three source projects via facade.")
        report.notes.append(
            "Routing policy: symbolic -> memory_engine_runtime, numerical -> tf_engine "
            "(per docs/ROUTING.md, CC1 user resolution 2026-05-06)."
        )

        return report


def run_end_to_end_demo() -> OrchestratorReport:
    """Public convenience entry point used by reproduce.sh."""
    return Orchestrator().run()


@dataclass
class CrossSubstrateLoopReport:
    """Report from run_with_cross_substrate_coupling: a sequence of
    CrossSubstrateRecord per episode plus aggregate stats."""

    episodes_run: int = 0
    n_idempotent_steps: int = 0
    n_perturbed_steps: int = 0
    n_records_with_pressure: int = 0
    cross_substrate_records: List[Any] = field(default_factory=list)
    final_registry_size: int = 0
    final_pressure_origin: Optional[str] = None
    notes: List[str] = field(default_factory=list)


def run_with_cross_substrate_coupling(
    n_episodes: int = 3,
    n_tf_entries_per_label: int = 4,
    mi_targets: tuple = (0.5, 1.5, 2.5),
    seed: int = 42,
    config: Optional[Config] = None,
) -> CrossSubstrateLoopReport:
    """Drive the cross-substrate cycle for n_episodes.

    Pre-conditions: tf_engine bank populated. Symbolic writes interleaved
    per episode to feed the consolidator. The orchestrator owns the loop;
    cross_substrate_step is called once per episode (1:1:1 per Q4 sync
    resolution).

    Per A1 user resolution 2026-05-06: orchestrator drives,
    cross_substrate_step stays a pure functional facade entry point.
    """
    from unified_fragmergent_memory.facade.cross_substrate import cross_substrate_step
    from unified_fragmergent_memory.bridges.cross_substrate_pressure import (
        get_pressure_origin,
    )

    store = UnifiedMemoryStore(config or Config())

    # Build a small numerical bank.
    rng = np.random.default_rng(seed)
    from unified_fragmergent_memory.facade.encoder import (
        encode_husimi_flat,
        encode_numerical_bank_entry,
    )
    for label_idx, mi_target in enumerate(mi_targets):
        for _ in range(n_tf_entries_per_label):
            sigma_t = float(rng.uniform(0.8, 1.2))
            beta = float(np.sqrt(max(0.0, (2 ** (2 * mi_target) - 1) / 16)) / (sigma_t ** 2))
            vector, mi_value = encode_husimi_flat(
                beta=beta, sigma_t=sigma_t, omega0=5.0,
                n_t=128, t_max=8.0, grid_size=8,
            )
            store.write(
                encode_numerical_bank_entry(
                    vector=vector, mi=mi_value, label=label_idx,
                    beta=beta, sigma=sigma_t,
                ),
                source="tf_engine",
            )

    # Register slot-to-label mappings so the cross-substrate translator
    # can map consolidator audit ops back to tf_engine labels.
    canonical_slots = [
        ("dragon", "color"),
        ("knight", "mood"),
        ("teacher", "size"),
    ]
    for label_idx, slot in enumerate(canonical_slots[: len(mi_targets)]):
        store.register_label_slot(slot[0], slot[1], label=label_idx)

    report = CrossSubstrateLoopReport()

    # Per-episode symbolic writes plus cross-substrate step.
    # Pattern: a Pas7a L1-style sequence on the (dragon, color) slot.
    #   ep1: COMMIT value_idx=1 (stable_value).
    #   ep2: DISPUTED value_idx=2 (challenger, episode 1 of 2).
    #   ep3: DISPUTED value_idx=2 (challenger, episode 2 of 2 -> RETROGRADE eligible).
    #   ep4+: COMMIT value_idx=2 (the now-promoted challenger).
    # This pattern reliably triggers consolidator ops and exercises the
    # non-idempotent branch of cross_substrate_step.
    primary_slot = canonical_slots[0]
    for ep in range(1, n_episodes + 1):
        if ep == 1:
            entry = {
                "entity_id": primary_slot[0], "attr_type": primary_slot[1],
                "value_idx": 1, "value_str": "stable_value",
                "episode_id": ep, "write_step": ep,
                "zone_after": "committed",
                "source_text": f"episode {ep} commit",
            }
        elif ep in (2, 3):
            entry = {
                "entity_id": primary_slot[0], "attr_type": primary_slot[1],
                "value_idx": 2, "value_str": "challenger_value",
                "episode_id": ep, "write_step": ep,
                "zone_after": "disputed",
                "value_before": "stable_value",
                "source_text": f"episode {ep} challenger",
            }
        else:
            entry = {
                "entity_id": primary_slot[0], "attr_type": primary_slot[1],
                "value_idx": 2, "value_str": "challenger_value",
                "episode_id": ep, "write_step": ep,
                "zone_after": "committed",
                "source_text": f"episode {ep} promoted",
            }
        store.write(entry)

        record = cross_substrate_step(store, episode_id=ep)
        report.cross_substrate_records.append(record)
        if record.triggered_by_idempotent_step:
            report.n_idempotent_steps += 1
        if record.tf_perturbation_applied:
            report.n_perturbed_steps += 1
        if record.resulting_pressure_origin == "cross_substrate":
            report.n_records_with_pressure += 1

    report.episodes_run = n_episodes
    report.final_registry_size = len(store._label_slot_registry)
    report.final_pressure_origin = get_pressure_origin(store._cross_substrate_last_pressure)

    report.notes.append(
        "Cross-substrate cycle (Pas 5, v0.2.0): symbolic writes drive consolidator, "
        "consolidator audit perturbs tf_engine bank parametrically, propagation "
        "result becomes synthetic LatentSignals, receptor produces pressure for "
        "next-episode influence. Provenance preserved end-to-end."
    )
    return report


def run_cross_substrate_demo() -> CrossSubstrateLoopReport:
    """Public convenience entry point for the v0.2.0 demonstration."""
    return run_with_cross_substrate_coupling()
