"""FN-11 Provenance chain.

Every OmegaRecord, morphogenesis row, and FCE observation must trace
back to a UFME source: a slot_event/tension_event from the runtime
adapter (memory_engine_runtime). The bridge tags source_event with a
"kind" so downstream consumers can attribute provenance.

tf_engine numerical entries do NOT feed the observer in v0.4.0 (only
consolidate() is the observation window). This test pins that contract
too.
"""

from __future__ import annotations

from tests.fce_omega_functional.conftest import (
    symbolic_entry, numerical_entry,
)
from unified_fragmergent_memory import UnifiedMemoryStore, Config


def test_omega_record_traces_back_to_runtime_slot_events():
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.0, fce_omega_tau_coag=1)
    s = UnifiedMemoryStore(cfg)
    eps = [1, 2, 3]
    for ep in eps:
        s.write(symbolic_entry("dragon", "color", "red",
                                episode_id=ep, write_step=0,
                                zone="committed"))
        s.consolidate(episode_id=ep)
    snap = s.omega_registry_snapshot()
    assert snap["count"] >= 1
    rec = next(r for r in snap["records"]
               if r["semantic_center"] == "dragon::color")
    # source_episodes is a subset of the episodes that fed coagulation.
    for ep in eps:
        if ep <= rec["coagulated_at_episode"]:
            assert ep in rec["source_episodes"]
    # Each source_event has a "kind" tag identifying its origin in the
    # runtime adapter (slot_event or tension_event).
    assert rec["source_events"]
    for ev in rec["source_events"]:
        assert ev.get("kind") in ("slot_event", "tension_event")
        # And the originating runtime substrate is identified implicitly:
        # the bridge only ever produces these two kinds — both come from
        # memory_engine_runtime, never from tf_engine or d_cortex.


def test_propagate_does_not_inject_phantom_provenance():
    """tf_engine activity does not produce FCE provenance. Only
    consolidate() (which drains the runtime adapter logs) does."""
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.0, fce_omega_tau_coag=1)
    s = UnifiedMemoryStore(cfg)
    for i in range(4):
        s.write(numerical_entry(label=i, mi=0.5 * i, dim=8, seed=i),
                source="tf_engine")
    q = numerical_entry(label=0, mi=1.0, dim=8, seed=99)
    _ = s.propagate(q, n_steps=3, method="softmax", source="tf_engine")
    # Observer was never constructed because consolidate() never ran.
    assert s.fce_omega_observer() is None


def test_morphogenesis_rows_carry_episode_id_back_to_runtime():
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.5, fce_omega_tau_coag=99)
    s = UnifiedMemoryStore(cfg)
    for ep in (1, 2, 3):
        s.write(symbolic_entry("dragon", "color", f"v{ep}",
                                episode_id=ep, write_step=0,
                                zone="committed"))
        s.consolidate(episode_id=ep)
    log = s.fce_morphogenesis_log()
    eps_seen = {r["episode_id"] for r in log}
    assert {1, 2, 3}.issubset(eps_seen)
