"""FN-09 Directed interaction asymmetry.

The vendored FCE-Omega interactions module exposes directional operators
I_{i<-j} != I_{j<-i}. The interference operator is exactly anti-symmetric;
absorption and repulsion are asymmetric in capacity / direction.

In the integrated UFME passive observer (v0.4.0) each (entity, attr)
center owns its own Agent and centers do not exchange field deltas
across the bridge — so observer-level cross-influence is NOT yet wired.
This test pins down both: (a) the underlying primitive is asymmetric,
(b) the observer's per-center isolation is the documented v0.4.0 state.
"""

from __future__ import annotations

import numpy as np

from unified_fragmergent_memory.sources import fce_omega


def _two_agents(D=8, kappa_a=0.7, kappa_b=0.3, alpha_a=0.7, alpha_b=0.2,
                seed=0):
    rng = np.random.default_rng(seed)
    A = fce_omega.Agent(idx=0, D=D, kappa_0=kappa_a, alpha_0=alpha_a,
                         lambda_0=0.2, rng=rng)
    B = fce_omega.Agent(idx=1, D=D, kappa_0=kappa_b, alpha_0=alpha_b,
                         lambda_0=0.05, rng=np.random.default_rng(seed + 7))
    return A, B


def test_interference_operator_is_antisymmetric():
    A, B = _two_agents()
    X = np.ones(A.D) / np.sqrt(A.D)
    Phi_i = A.build_Phi_a(X)
    Phi_j = B.build_Phi_a(X)
    K_ij = fce_omega.interactions.interference(Phi_i, Phi_j, X)
    K_ji = fce_omega.interactions.interference(Phi_j, Phi_i, X)
    np.testing.assert_allclose(K_ij, -K_ji, atol=1e-12)


def test_absorption_is_asymmetric_under_unequal_capacity():
    A, B = _two_agents(alpha_a=0.9, alpha_b=0.05)
    rng = np.random.default_rng(123)
    delta_X = rng.standard_normal(A.D)
    A_ij = fce_omega.interactions.absorption(
        A.Pi_s, A.Phi_s, A.alpha, delta_X)
    A_ji = fce_omega.interactions.absorption(
        B.Pi_s, B.Phi_s, B.alpha, delta_X)
    # The "j absorbs from i" direction with a low-alpha receiver
    # produces a strictly smaller absorbed magnitude.
    assert np.linalg.norm(A_ij) > np.linalg.norm(A_ji)


def test_repulsion_depends_on_misalignment_only():
    """Repulsion is anti-symmetric in the misalignment factor's sign
    convention (always nonnegative), but its direction depends on the
    receiver's Pi_s and the same delta_X — so different receivers
    produce different repulsion vectors."""
    A, B = _two_agents()
    rng = np.random.default_rng(7)
    delta_X = rng.standard_normal(A.D)
    R_ij = fce_omega.interactions.repulsion(A.Pi_s, A.Phi_s, B.Phi_s, delta_X)
    R_ji = fce_omega.interactions.repulsion(B.Pi_s, B.Phi_s, A.Phi_s, delta_X)
    # The two repulsion vectors are not equal (different receiver Pi_s).
    assert not np.allclose(R_ij, R_ji)


def test_observer_centers_are_isolated_in_v0_4_0():
    """Document the v0.4.0 contract: the passive observer keeps each
    center on its own Agent and does not propagate delta_X across
    centers. If they were coupled, A's coherent track would visibly
    perturb B's AR / kappa and vice versa; here they stay independent.
    """
    from tests.fce_omega_functional.conftest import symbolic_entry
    from unified_fragmergent_memory import UnifiedMemoryStore, Config

    def _drive(s, values_a, values_b, zones_a, zones_b):
        for k in range(len(values_a)):
            ep_a = 1 + 2 * k
            ep_b = 2 + 2 * k
            s.write(symbolic_entry("A", "x", values_a[k], ep_a, 0, zone=zones_a[k]))
            s.consolidate(episode_id=ep_a)
            s.write(symbolic_entry("B", "x", values_b[k], ep_b, 0, zone=zones_b[k]))
            s.consolidate(episode_id=ep_b)

    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.5, fce_omega_tau_coag=99)

    s_mixed = UnifiedMemoryStore(cfg)
    _drive(
        s_mixed,
        values_a=["stable"] * 6,
        values_b=["v0", "v1", "v2", "v3", "v4", "v5"],
        zones_a=["committed"] * 6,
        zones_b=["disputed"] * 6,
    )
    obs_mixed = s_mixed.fce_omega_observer()

    # Now run A alone (without B) under identical writes and confirm A's
    # final state is the same. If centers leaked, A's state with B
    # interleaved would differ from A alone.
    s_solo = UnifiedMemoryStore(cfg)
    for k in range(6):
        s_solo.write(symbolic_entry("A", "x", "stable", 1 + 2 * k, 0,
                                     zone="committed"))
        s_solo.consolidate(episode_id=1 + 2 * k)
    obs_solo = s_solo.fce_omega_observer()

    a_mixed = obs_mixed.center_state("A::x")
    a_solo = obs_solo.center_state("A::x")
    # A's Omega is determined by A's events only. B's events never
    # promote nor demote A's Omega.
    assert a_mixed["Omega"] == a_solo["Omega"]
    # v0.4.1: per-center anchor. The previous coupling channel (global
    # anchor scalar) is gone — disputed writes on B no longer modulate
    # disrupt_eff for A. A's kappa and Z_norm are now bit-equal between
    # solo and mixed runs.
    assert a_mixed["kappa"] == a_solo["kappa"], (
        f"A's kappa diverged under v0.4.1 isolation: "
        f"solo={a_solo['kappa']} mixed={a_mixed['kappa']}"
    )
    assert a_mixed["Z_norm"] == a_solo["Z_norm"], (
        f"A's Z_norm diverged under v0.4.1 isolation: "
        f"solo={a_solo['Z_norm']} mixed={a_mixed['Z_norm']}"
    )
