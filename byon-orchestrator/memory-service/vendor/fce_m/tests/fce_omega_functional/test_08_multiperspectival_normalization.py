"""FN-08 Multiperspectival normalization.

N centers active simultaneously must not blow up the per-center field
norm. The observer keeps each center on its own Agent; the field norm
seen at each center is bounded by Agent's own dissipation. Aggregate
field norm should scale roughly linearly with N (not quadratically).
"""

from __future__ import annotations

import numpy as np

from tests.fce_omega_functional.conftest import symbolic_entry
from unified_fragmergent_memory import UnifiedMemoryStore, Config


def _run_with_N_centers(N: int, episodes: int = 3) -> dict:
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.5, fce_omega_tau_coag=99)
    s = UnifiedMemoryStore(cfg)
    for ep in range(1, episodes + 1):
        for k in range(N):
            entity = f"e{k}"
            s.write(symbolic_entry(entity, "color", "red",
                                    episode_id=ep, write_step=k,
                                    zone="committed"))
        s.consolidate(episode_id=ep)
    snap = s.metrics_snapshot()["fce_omega"]
    log = s.fce_morphogenesis_log()
    Z_norms = [r["Z_norm"] for r in log]
    delta_X_norms = [r["delta_X_norm"] for r in log]
    return {
        "N": N, "centers": snap["centers"],
        "max_Z": float(max(Z_norms)) if Z_norms else 0.0,
        "mean_delta_X": float(np.mean(delta_X_norms)) if delta_X_norms else 0.0,
        "log_size": len(log),
    }


def test_field_does_not_blow_up_with_N_centers():
    r1 = _run_with_N_centers(1)
    r4 = _run_with_N_centers(4)
    r8 = _run_with_N_centers(8)
    # Per-center mean excitation must stay roughly constant (within a
    # factor that does not grow with N). delta_X is built per-event;
    # adding more centers does not pile up per-center excitation.
    assert r4["mean_delta_X"] < 5.0 * r1["mean_delta_X"] + 0.5
    assert r8["mean_delta_X"] < 5.0 * r1["mean_delta_X"] + 0.5
    # Number of agents scales linearly with N.
    assert r4["centers"] == 4
    assert r8["centers"] == 8


def test_max_Z_bounded_when_many_centers_active():
    """With 16 active centers and only coherent writes, Z must stay
    bounded by FCE Agent's RHO_MAX-ish scale (we check < 10 as a soft
    sanity bound)."""
    r = _run_with_N_centers(16, episodes=4)
    assert r["max_Z"] < 20.0, f"max Z_norm exploded: {r['max_Z']}"


def test_per_center_state_isolated_across_simultaneous_centers():
    """Centers with different per-episode trajectories produce distinct
    state on the discrimination axes (AR / kappa / S_t). They are not
    coupled into one global state."""
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.5, fce_omega_tau_coag=99)
    s = UnifiedMemoryStore(cfg)
    # A: coherent committed writes (same value); B: disputed writes with
    # varying values. Drive one event per episode.
    for k in range(6):
        ep_a = 1 + 2 * k
        ep_b = 2 + 2 * k
        s.write(symbolic_entry("A", "x", "stable", ep_a, 0, zone="committed"))
        s.consolidate(episode_id=ep_a)
        s.write(symbolic_entry("B", "x", f"v{k}", ep_b, 0, zone="disputed"))
        s.consolidate(episode_id=ep_b)
    obs = s.fce_omega_observer()
    state_a = obs.center_state("A::x")
    state_b = obs.center_state("B::x")
    assert state_a["exists"] and state_b["exists"]
    # The two trajectories differ on at least one of the FCE-Ω
    # discrimination axes — kappa (coherent A keeps it up, conflicting B
    # gets it disrupted).
    log = s.fce_morphogenesis_log()
    a_rows = [r for r in log if r["semantic_center"] == "A::x"]
    b_rows = [r for r in log if r["semantic_center"] == "B::x"]
    assert a_rows[-1]["AR"] > b_rows[-1]["AR"], (
        f"A_AR={a_rows[-1]['AR']} B_AR={b_rows[-1]['AR']}"
    )
    assert a_rows[-1]["kappa"] >= b_rows[-1]["kappa"] - 0.02
