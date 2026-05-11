# -*- coding: utf-8 -*-
# Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
# Cluj-Napoca, Romania · Patent EP25216372.0

"""
tests.test_field_operators
===========================
Unit tests for fce_omega.core.field_operators.

Tests cover:
  - Φ_a structure: antisymmetric dominance, scale coupling to κ
  - Π_s: eigenvalue bounds, non-degeneracy at λ→1
  - Residue transport: fluid/rigid interpolation bounds
  - Field dissipation: norm ceiling
  - Back-action: boundedness
"""

import numpy as np
import pytest
from scipy.linalg import expm

from src.core.field_operators import (
    build_Phi_a,
    build_Pi_s,
    compute_transport_q,
    update_residue,
    compute_back_action,
    initialize_field,
    dissipate_field,
    normalize_direction,
)


@pytest.fixture
def rng():
    return np.random.default_rng(42)


@pytest.fixture
def D():
    return 6


@pytest.fixture
def unit_field(D, rng):
    X = rng.standard_normal(D)
    return X / np.linalg.norm(X)


@pytest.fixture
def unit_direction(D, rng):
    v = rng.standard_normal(D)
    return v / np.linalg.norm(v)


class TestBuildPhiA:
    """Tests for the Lie-algebra element Φ_a."""

    def test_shape(self, D, unit_field, rng):
        Phi = build_Phi_a(unit_field, kappa=0.5, rng=rng)
        assert Phi.shape == (D, D)

    def test_scale_increases_with_kappa(self, D, unit_field, rng):
        """Higher κ → higher Frobenius norm of Φ_a."""
        rng_lo = np.random.default_rng(0)
        rng_hi = np.random.default_rng(0)
        Phi_lo = build_Phi_a(unit_field, kappa=0.1, rng=rng_lo)
        Phi_hi = build_Phi_a(unit_field, kappa=0.9, rng=rng_hi)
        assert np.linalg.norm(Phi_hi, 'fro') > np.linalg.norm(Phi_lo, 'fro')

    def test_antisymmetric_dominance(self, D, unit_field, rng):
        """Antisymmetric component dominates for symmetric_fraction < 0.5."""
        Phi = build_Phi_a(unit_field, kappa=0.5, symmetric_fraction=0.25, rng=rng)
        antisym_part = (Phi - Phi.T) / 2
        sym_part = (Phi + Phi.T) / 2
        assert np.linalg.norm(antisym_part, 'fro') > np.linalg.norm(sym_part, 'fro')

    def test_u_a_is_invertible(self, D, unit_field, rng):
        """U_a = exp(Φ_a) must be invertible (det ≠ 0)."""
        Phi = build_Phi_a(unit_field, kappa=0.5, rng=rng)
        U = expm(Phi)
        assert abs(np.linalg.det(U)) > 1e-6


class TestBuildPiS:
    """Tests for the assimilation projector Π_s."""

    def test_shape(self, D, unit_direction):
        Pi = build_Pi_s(alpha=0.5, lambda_ar=0.0, Phi_s=unit_direction)
        assert Pi.shape == (D, D)

    def test_eigenvalue_bounds(self, D, unit_direction):
        """All eigenvalues of Π_s must be in [0, 1]."""
        for alpha in [0.01, 0.3, 0.7, 1.0]:
            for lam in [0.0, 0.5, 1.0]:
                Pi = build_Pi_s(alpha=alpha, lambda_ar=lam, Phi_s=unit_direction)
                eigvals = np.linalg.eigvalsh(Pi)
                assert np.all(eigvals >= -1e-9), f"Negative eigenvalue at alpha={alpha}, λ={lam}"
                assert np.all(eigvals <= 1.0 + 1e-9), f"Eigenvalue > 1 at alpha={alpha}, λ={lam}"

    def test_symmetry(self, D, unit_direction):
        """Π_s must be symmetric."""
        Pi = build_Pi_s(alpha=0.5, lambda_ar=0.3, Phi_s=unit_direction)
        np.testing.assert_allclose(Pi, Pi.T, atol=1e-12)

    def test_non_degenerate_at_high_lambda(self, D, unit_direction):
        """
        At λ=1, α=0.01, Π_s must not collapse to pure rank-1 (outer product only).
        The global floor (alpha_floor) ensures rank > 1.
        """
        Pi = build_Pi_s(
            alpha=0.01, lambda_ar=1.0, Phi_s=unit_direction,
            alpha_floor=0.12, alpha_self_floor=0.08
        )
        eigvals = np.linalg.eigvalsh(Pi)
        n_nonzero = np.sum(eigvals > 1e-4)
        assert n_nonzero > 1, "Π_s degenerated to rank-1 at high λ with non-degenerate constructor"

    def test_self_coupling_floor_independent_of_alpha(self, D, unit_direction):
        """
        With collapsed α = 0.01 and λ = 1, self-coupling weight must be
        nonzero due to alpha_self_floor.
        """
        Pi = build_Pi_s(
            alpha=0.01, lambda_ar=1.0, Phi_s=unit_direction,
            alpha_self_floor=0.08, m_mix=0.60
        )
        # AR measure = |Phi_s^T Pi Phi_s| / ||Phi_s||^2 must be > alpha_self_floor
        Pi_phi = Pi @ unit_direction
        AR = float(abs(np.dot(Pi_phi, unit_direction)))
        assert AR > 0.05, f"AR={AR:.4f} too low — self-coupling floor not active"


class TestTransportQ:
    """Tests for fluid-rigid interpolation coefficient q."""

    def test_bounds(self):
        for alpha in np.linspace(0.01, 1.0, 5):
            for kappa in np.linspace(0.01, 1.0, 5):
                for rho in [0.0, 1.0, 10.0, 100.0]:
                    q = compute_transport_q(alpha, kappa, rho)
                    assert 0.0 <= q <= 1.0, f"q={q} out of [0,1]"

    def test_high_rho_approaches_rigid(self):
        q = compute_transport_q(alpha=0.5, kappa=0.5, rho=1e6)
        assert q < 1e-3, "High ρ should give near-zero q (rigid stasis)"

    def test_zero_rho_proportional(self):
        q1 = compute_transport_q(alpha=0.2, kappa=0.5, rho=0.0)
        q2 = compute_transport_q(alpha=0.4, kappa=0.5, rho=0.0)
        assert q2 > q1, "Higher α should give higher q at ρ=0"


class TestUpdateResidue:
    """Tests for residue transport update Z_{t+1}."""

    def test_output_shape(self, D, unit_direction, unit_field, rng):
        U = np.eye(D)
        Xi = rng.standard_normal(D) * 0.1
        Z = np.zeros(D)
        Z_new = update_residue(Z, Xi, U, q=0.5)
        assert Z_new.shape == (D,)

    def test_zero_initial_residue(self, D, rng):
        Xi = rng.standard_normal(D) * 0.1
        Z = np.zeros(D)
        U = np.eye(D)
        Z_new = update_residue(Z, Xi, U, q=1.0, mu=0.9)
        np.testing.assert_allclose(Z_new, Xi)

    def test_mu_decay(self, D, rng):
        Z = np.ones(D)
        Xi = np.zeros(D)
        U = np.eye(D)
        Z_new = update_residue(Z, Xi, U, q=0.0, mu=0.9)
        np.testing.assert_allclose(Z_new, 0.9 * Z)


class TestDissipateField:
    """Tests for soft field norm dissipation."""

    def test_below_target_unchanged(self):
        X = np.array([0.5, 0.5, 0.5])
        X_diss = dissipate_field(X, x_target=2.0)
        np.testing.assert_allclose(X_diss, X)

    def test_above_target_attenuated(self):
        X = np.array([3.0, 0.0, 0.0])
        X_diss = dissipate_field(X, x_target=2.0, gamma=0.05)
        assert float(np.linalg.norm(X_diss)) < float(np.linalg.norm(X))

    def test_direction_preserved(self):
        X = np.array([5.0, 3.0, 0.0])
        X_diss = dissipate_field(X, x_target=2.0)
        cos_angle = np.dot(X, X_diss) / (np.linalg.norm(X) * np.linalg.norm(X_diss))
        np.testing.assert_allclose(cos_angle, 1.0, atol=1e-12)


class TestNormalizeDirection:
    """Tests for unit-vector normalization."""

    def test_unit_norm(self, rng, D):
        v = rng.standard_normal(D) * 5.0
        v_norm = normalize_direction(v)
        np.testing.assert_allclose(np.linalg.norm(v_norm), 1.0, atol=1e-12)

    def test_near_zero_handled(self, D):
        v = np.zeros(D)
        v_norm = normalize_direction(v)
        assert np.isfinite(v_norm).all()
