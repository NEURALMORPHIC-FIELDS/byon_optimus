# -*- coding: utf-8 -*-
# Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
# Cluj-Napoca, Romania · Patent EP25216372.0

"""
tests.test_metrics_and_coagulation
====================================
Unit and integration tests for:
  - Self-Index S_t computation and classification
  - Omega-Coagulation Registry irreversibility
  - AR measure bounds and sensitivity
  - Directed interaction asymmetry (K_{i←j} = -K_{j←i})
  - Pair coagulation gate
"""

import numpy as np
import pytest
from scipy.linalg import expm

from src.core.field_operators import (
    build_Pi_s,
    initialize_field,
    build_Phi_a,
)
from src.core.metrics import (
    autoreferential_measure,
    self_index,
    classify_sine_level,
    S_PROTO,
    S_OPERATIONAL,
    S_PROPER,
)
from src.core.agent import Agent
from src.core.interactions import (
    absorption,
    repulsion,
    interference,
    coagulation_directional,
    coagulation_shared,
    THETA_PAIR,
)


@pytest.fixture
def rng():
    return np.random.default_rng(99)


@pytest.fixture
def D():
    return 6


@pytest.fixture
def unit_dir(D, rng):
    v = rng.standard_normal(D)
    return v / np.linalg.norm(v)


@pytest.fixture
def unit_field(D, rng):
    X = rng.standard_normal(D)
    return X / np.linalg.norm(X)


# ===========================================================
# AR measure tests
# ===========================================================

class TestARMeasure:
    def test_bounds_zero_to_one(self, D, unit_dir, rng):
        for alpha in [0.01, 0.3, 0.7]:
            for lam in [0.0, 0.5, 1.0]:
                Pi = build_Pi_s(alpha=alpha, lambda_ar=lam, Phi_s=unit_dir)
                AR = autoreferential_measure(Pi, unit_dir)
                assert 0.0 <= AR <= 1.0 + 1e-9, f"AR={AR} out of bounds"

    def test_increases_with_lambda(self, D, unit_dir):
        """AR should increase as λ increases (more self-coupling)."""
        alpha = 0.3
        AR_lo = autoreferential_measure(
            build_Pi_s(alpha, 0.0, unit_dir), unit_dir
        )
        AR_hi = autoreferential_measure(
            build_Pi_s(alpha, 1.0, unit_dir), unit_dir
        )
        assert AR_hi > AR_lo

    def test_non_degenerate_floor(self, D, unit_dir):
        """With non-degenerate Π_s, AR at α=0.01, λ=1 must exceed alpha_self_floor."""
        Pi = build_Pi_s(0.01, 1.0, unit_dir, alpha_self_floor=0.08, alpha_floor=0.12)
        AR = autoreferential_measure(Pi, unit_dir)
        assert AR > 0.08, f"AR={AR:.4f} below expected floor"


# ===========================================================
# Self-Index tests
# ===========================================================

class TestSelfIndex:
    def test_zero_when_kappa_zero(self, D, unit_dir, unit_field, rng):
        Pi = build_Pi_s(0.5, 0.3, unit_dir)
        delta_X = rng.standard_normal(D) * 0.1
        E = Pi @ delta_X
        Z = np.zeros(D)
        S, AR, I_t, B_t = self_index(Pi, unit_dir, E, delta_X, Z, kappa=0.0)
        assert S == 0.0

    def test_zero_when_delta_X_zero(self, D, unit_dir):
        Pi = build_Pi_s(0.5, 0.3, unit_dir)
        delta_X = np.zeros(D)
        E = np.zeros(D)
        Z = np.zeros(D)
        S, _, I_t, _ = self_index(Pi, unit_dir, E, delta_X, Z, kappa=0.8)
        assert I_t == 0.0
        assert S == 0.0

    def test_bounded(self, D, unit_dir, rng):
        Pi = build_Pi_s(0.7, 0.5, unit_dir)
        delta_X = rng.standard_normal(D) * 0.3
        E = Pi @ delta_X
        Z = rng.standard_normal(D) * 0.1
        S, AR, I_t, B_t = self_index(Pi, unit_dir, E, delta_X, Z, kappa=0.8)
        assert 0.0 <= S <= 1.0 + 1e-9
        assert 0.0 <= AR <= 1.0 + 1e-9
        assert 0.0 <= I_t <= 1.0 + 1e-9
        assert 0.0 < B_t <= 1.0 + 1e-9

    def test_decreases_with_large_residue(self, D, unit_dir, rng):
        Pi = build_Pi_s(0.7, 0.5, unit_dir)
        delta_X = rng.standard_normal(D) * 0.3
        E = Pi @ delta_X
        Z_small = np.zeros(D)
        Z_large = rng.standard_normal(D) * 10.0
        S_small, *_ = self_index(Pi, unit_dir, E, delta_X, Z_small, kappa=0.8)
        S_large, *_ = self_index(Pi, unit_dir, E, delta_X, Z_large, kappa=0.8)
        assert S_small > S_large


class TestClassifySineLevel:
    def test_classification_order(self):
        assert classify_sine_level(0.0) == 0
        assert classify_sine_level(S_PROTO - 0.001) == 0
        assert classify_sine_level(S_PROTO + 0.001) == 1
        assert classify_sine_level(S_OPERATIONAL + 0.001) == 2
        assert classify_sine_level(S_PROPER + 0.001) == 3


# ===========================================================
# Omega-Coagulation Registry tests
# ===========================================================

class TestOmegaCoagulation:
    def test_coagulation_requires_consecutive_cycles(self, D, rng):
        agent = Agent(idx=0, D=D, kappa_0=0.9, alpha_0=0.7, rng=rng)
        theta_s = 0.28
        tau_coag = 12
        # Feed S_t below threshold: should not coagulate
        for t in range(20):
            agent.check_coagulation(S_t=0.10, t=t, theta_s=theta_s, tau_coag=tau_coag)
        assert agent.Omega == 0

    def test_coagulation_triggers_after_tau(self, D, rng):
        agent = Agent(idx=0, D=D, kappa_0=0.9, alpha_0=0.7, rng=rng)
        theta_s = 0.28
        tau_coag = 5
        coag = False
        for t in range(10):
            newly = agent.check_coagulation(S_t=0.40, t=t, theta_s=theta_s, tau_coag=tau_coag)
            if newly:
                coag = True
                coag_t = t
                break
        assert coag, "Coagulation should have occurred"
        assert coag_t == tau_coag - 1  # triggers at cycle tau-1 (0-indexed)

    def test_coagulation_is_irreversible(self, D, rng):
        agent = Agent(idx=0, D=D, kappa_0=0.9, alpha_0=0.7, rng=rng)
        tau_coag = 3
        for t in range(3):
            agent.check_coagulation(S_t=0.40, t=t, tau_coag=tau_coag)
        assert agent.Omega == 1
        # Feed collapsing S_t
        for t in range(3, 100):
            agent.check_coagulation(S_t=0.0, t=t, tau_coag=tau_coag)
        assert agent.Omega == 1, "Omega must remain 1 after coagulation (irreversible)"

    def test_sine_type_classification(self, D, rng):
        agent = Agent(idx=0, D=D, kappa_0=0.5, alpha_0=0.7, rng=rng)
        agent.kappa = 0.5
        for t in range(15):
            agent.check_coagulation(0.40, t, tau_coag=12)
        assert agent.sine_type == "integrative"

        agent2 = Agent(idx=1, D=D, kappa_0=0.1, alpha_0=0.7, rng=rng)
        agent2.kappa = 0.1
        for t in range(15):
            agent2.check_coagulation(0.40, t, tau_coag=12)
        assert agent2.sine_type == "turbulent"


# ===========================================================
# Directed interaction asymmetry tests
# ===========================================================

class TestInteractionAsymmetry:
    def test_interference_antisymmetric(self, D, unit_field, rng):
        """K_{i←j} = [Φ_i, Φ_j] X = -K_{j←i}."""
        X = unit_field
        Phi_i = rng.standard_normal((D, D)) * 0.1
        Phi_j = rng.standard_normal((D, D)) * 0.1
        K_ij = interference(Phi_i, Phi_j, X)
        K_ji = interference(Phi_j, Phi_i, X)
        np.testing.assert_allclose(K_ij, -K_ji, atol=1e-12)

    def test_absorption_asymmetric(self, D, unit_field, rng):
        """A_{i←j} ≠ A_{j←i} in general."""
        X = unit_field
        Pi_i = build_Pi_s(0.5, 0.2, rng.standard_normal(D) / 6)
        Pi_j = build_Pi_s(0.3, 0.4, rng.standard_normal(D) / 6)
        Phi_s_i = rng.standard_normal(D); Phi_s_i /= np.linalg.norm(Phi_s_i)
        Phi_s_j = rng.standard_normal(D); Phi_s_j /= np.linalg.norm(Phi_s_j)
        delta_Xj = rng.standard_normal(D) * 0.1
        delta_Xi = rng.standard_normal(D) * 0.1
        A_ij = absorption(Pi_i, Phi_s_i, alpha_i=0.5, delta_Xj=delta_Xj)
        A_ji = absorption(Pi_j, Phi_s_j, alpha_i=0.3, delta_Xj=delta_Xi)
        # They should generally differ (not equal)
        assert not np.allclose(A_ij, A_ji, atol=1e-6)

    def test_repulsion_output_direction(self, D, rng):
        """R_{i←j} is nonzero when Phi_s_i and Phi_s_j are orthogonal.

        misalign = 1 - |cos(Phi_s_i, Phi_s_j)|.
        Orthogonal directions (cos=0) give misalign=1 → maximum repulsion.
        Anti-aligned directions (|cos|=1) give misalign=0 → no repulsion.
        """
        Pi_i = build_Pi_s(0.5, 0.0, np.array([1.0] + [0.0]*(D-1)))
        Phi_s_i = np.array([1.0] + [0.0]*(D-1))
        Phi_s_j = np.array([0.0, 1.0] + [0.0]*(D-2))  # orthogonal direction
        delta_Xj = np.array([0.0, 1.0] + [0.0]*(D-2))
        R = repulsion(Pi_i, Phi_s_i, Phi_s_j, delta_Xj)
        # Misalignment = 1 (orthogonal) → repulsion should be nonzero
        assert float(np.linalg.norm(R)) > 0

    def test_shared_coagulation_symmetric(self, D, rng):
        """C^{shared}_{ij} = C^{shared}_{ji} (only symmetric interaction)."""
        X = rng.standard_normal(D)
        Phi_s_i = rng.standard_normal(D); Phi_s_i /= np.linalg.norm(Phi_s_i)
        Phi_s_j = rng.standard_normal(D); Phi_s_j /= np.linalg.norm(Phi_s_j)
        S_i = 0.5
        S_j = 0.4
        C_ij = coagulation_shared(Phi_s_i, Phi_s_j, S_i, S_j, X)
        C_ji = coagulation_shared(Phi_s_j, Phi_s_i, S_j, S_i, X)
        np.testing.assert_allclose(C_ij, C_ji, atol=1e-12)

    def test_shared_coagulation_gated(self, D, rng):
        """C^{shared} returns zero when either S < THETA_PAIR."""
        X = rng.standard_normal(D)
        Phi_s_i = np.ones(D) / np.sqrt(D)
        Phi_s_j = np.ones(D) / np.sqrt(D)
        C_gated = coagulation_shared(Phi_s_i, Phi_s_j, S_i=0.05, S_j=0.5, X=X)
        np.testing.assert_allclose(C_gated, np.zeros(D), atol=1e-12)


# ===========================================================
# Agent integration test
# ===========================================================

class TestAgentIntegration:
    def test_step_returns_float(self, D, unit_field, rng):
        agent = Agent(idx=0, D=D, kappa_0=0.7, alpha_0=0.6, rng=rng)
        Phi = build_Phi_a(unit_field, kappa=0.7, rng=rng)
        U = expm(Phi)
        delta_X = (U - np.eye(D)) @ unit_field
        S = agent.step(delta_X, U, anchor=0.0)
        assert isinstance(S, float)
        assert np.isfinite(S)

    def test_kappa_bounded(self, D, unit_field, rng):
        agent = Agent(idx=0, D=D, kappa_0=0.7, alpha_0=0.6, rng=rng)
        X = unit_field.copy()
        for _ in range(50):
            Phi = build_Phi_a(X, kappa=agent.kappa, rng=rng)
            U = expm(Phi)
            delta_X = (U - np.eye(D)) @ X
            X = X + delta_X
            X /= max(1.0, np.linalg.norm(X) / 2.0)
            agent.step(delta_X, U, anchor=0.0)
            assert 0.01 <= agent.kappa <= 1.0

    def test_alpha_bounded(self, D, unit_field, rng):
        agent = Agent(idx=0, D=D, kappa_0=0.7, alpha_0=0.6, rng=rng)
        X = unit_field.copy()
        for _ in range(50):
            Phi = build_Phi_a(X, kappa=agent.kappa, rng=rng)
            U = expm(Phi)
            delta_X = (U - np.eye(D)) @ X
            agent.step(delta_X, U, anchor=0.0)
            assert 0.01 <= agent.alpha <= 1.0
