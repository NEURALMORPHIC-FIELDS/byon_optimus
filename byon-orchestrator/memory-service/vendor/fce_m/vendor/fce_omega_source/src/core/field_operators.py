# -*- coding: utf-8 -*-
# Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
# Cluj-Napoca, Romania · Patent EP25216372.0

"""
fce_omega.core.field_operators
==============================
Fundamental field-theoretic operators for the FCE-Ω framework.

All operators act on a shared D-dimensional real vector field X ∈ ℝ^D.

Mathematical conventions
------------------------
Φ_a ∈ gl(D, ℝ)           Lie-algebra element for action a
U_a = exp(Φ_a)            Lie-group element (field evolution operator)
ΔX_t = (U_a - I) X_t     Field excitation produced by action a
Π_s ∈ ℝ^{D×D}            Assimilation projector (soft projection, eigenvalues ∈ [0,1])
Z ∈ ℝ^D                   Active residue accumulator
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray


# ============================================================
# Type aliases
# ============================================================

Array = NDArray[np.float64]


# ============================================================
# Lie-algebra element construction
# ============================================================

def build_Phi_a(
    X: Array,
    kappa: float,
    action_scale: float = 0.30,
    symmetric_fraction: float = 0.25,
    rng: np.random.Generator | None = None,
) -> Array:
    """
    Construct the Lie-algebra element Φ_a for action a in field X.

    The element comprises an antisymmetric component (driving rotations,
    i.e. norm-preserving perturbations) and a symmetric component
    (driving expansions along the action direction):

        Φ_a = scale · (A_antisym + f_sym · A_sym) / D

    where scale = 0.4 + 0.6 · κ couples perturbation intensity to the
    agent's internal coherence.

    Parameters
    ----------
    X : Array, shape (D,)
        Current field state vector.
    kappa : float
        Agent coherence coefficient κ ∈ [0, 1].
    action_scale : float
        Standard deviation of the action vector prior.
    symmetric_fraction : float
        Weight of the symmetric component relative to antisymmetric.
    rng : numpy Generator, optional
        Random number generator for reproducibility.

    Returns
    -------
    Phi : Array, shape (D, D)
        Lie-algebra element.
    """
    if rng is None:
        rng = np.random.default_rng()
    D = X.shape[0]
    a = rng.standard_normal(D) * action_scale
    antisym = (np.outer(a, X) - np.outer(X, a)) / D
    sym = np.outer(a, a) / D
    scale = 0.4 + 0.6 * kappa
    return scale * (antisym + symmetric_fraction * sym)


# ============================================================
# Assimilation projector
# ============================================================

def build_Pi_s(
    alpha: float,
    lambda_ar: float,
    Phi_s: Array,
    alpha_floor: float = 0.12,
    alpha_self_floor: float = 0.08,
    m_mix: float = 0.60,
) -> Array:
    """
    Construct the assimilation projector Π_s.

    The projector has two components:

    1. Global component:
       w_global = α_floor + α · (1 - M_mix · λ)
       Maintains permeability to the full field regardless of self-coupling.

    2. Self-referential component:
       w_self = λ · (α_self_floor + α · M_mix)
       The self-coupling floor α_self_floor is independent of α, ensuring
       the autoreferential channel remains active even when α collapses.

    Eigenvalues are clipped to [0, 1] enforcing proper soft-projection
    semantics (idempotent in the limit).

    Parameters
    ----------
    alpha : float
        Global assimilation capacity α ∈ [0.01, 1].
    lambda_ar : float
        Autoreferential coefficient λ ∈ [0, 1].
    Phi_s : Array, shape (D,)
        Agent's own dynamic direction (unit vector).
    alpha_floor : float
        Minimum global field permeability, independent of α.
    alpha_self_floor : float
        Minimum self-coupling weight when λ > 0, independent of α.
    m_mix : float
        Mixing coefficient governing λ-driven reallocation from global
        to self-referential component.

    Returns
    -------
    Pi : Array, shape (D, D)
        Assimilation projector with eigenvalues ∈ [0, 1].
    """
    D = Phi_s.shape[0]
    w_global = alpha_floor + alpha * (1.0 - m_mix * lambda_ar)
    w_self = lambda_ar * (alpha_self_floor + alpha * m_mix)
    Pi = w_global * np.eye(D) + w_self * np.outer(Phi_s, Phi_s)
    eigvals, eigvecs = np.linalg.eigh(Pi)
    eigvals = np.clip(eigvals, 0.0, 1.0)
    return eigvecs @ np.diag(eigvals) @ eigvecs.T


# ============================================================
# Residue transport operator
# ============================================================

def compute_transport_q(
    alpha: float,
    kappa: float,
    rho: float,
    rho_max: float = 6.0,
) -> float:
    """
    Compute the fluid-rigid interpolation coefficient q ∈ [0, 1].

    The residue transport operator interpolates between:
    - q = 1: fluid transport — residue is propagated through the new
      field dynamics (U_a Z), characteristic of integrated agents.
    - q = 0: rigid stasis — residue is inert (I Z = Z), characteristic
      of fragmented agents with high residual burden.

    Parameters
    ----------
    alpha : float
        Assimilation capacity.
    kappa : float
        Internal coherence.
    rho : float
        Residual burden ρ ≥ 0.
    rho_max : float
        Saturation ceiling for ρ.

    Returns
    -------
    q : float
        Interpolation coefficient ∈ [0, 1].
    """
    return float(np.clip((alpha * kappa) / (1.0 + rho / rho_max), 0.0, 1.0))


def update_residue(
    Z: Array,
    Xi: Array,
    U_a: Array,
    q: float,
    mu: float = 0.90,
) -> Array:
    """
    Update the active residue accumulator Z.

        Z_{t+1} = μ · [q · U_a + (1-q) · I] · Z_t + Ξ_t

    Parameters
    ----------
    Z : Array, shape (D,)
        Current residue state.
    Xi : Array, shape (D,)
        New unassimilated excitation Ξ_t = (I - Π_s) ΔX_t.
    U_a : Array, shape (D, D)
        Field evolution operator for current action.
    q : float
        Fluid-rigid coefficient from compute_transport_q.
    mu : float
        Residue persistence / decay factor μ ∈ [0, 1].

    Returns
    -------
    Z_new : Array, shape (D,)
        Updated residue accumulator.
    """
    D = Z.shape[0]
    T = q * U_a + (1.0 - q) * np.eye(D)
    return mu * (T @ Z) + Xi


# ============================================================
# Back-action operator
# ============================================================

def compute_back_action(
    E: Array,
    Phi_s: Array,
    X: Array,
    lambda_ar: float,
) -> Array:
    """
    Compute the back-action R_s of conscious assimilation on the field.

    The back-action is directed along the agent's own dynamic direction
    Φ_s, scaled by the autoreferential coefficient λ and bounded by the
    current field norm to prevent destabilization:

        R_s = λ · min(1, ‖X‖/‖proj‖) · ⟨E, Φ_s⟩ · Φ_s

    Parameters
    ----------
    E : Array, shape (D,)
        Assimilated field component.
    Phi_s : Array, shape (D,)
        Agent dynamic direction (unit vector).
    X : Array, shape (D,)
        Current field state.
    lambda_ar : float
        Autoreferential coefficient.

    Returns
    -------
    R_s : Array, shape (D,)
        Back-action contribution to field update.
    """
    proj_magnitude = float(np.dot(E, Phi_s))
    proj = proj_magnitude * Phi_s
    proj_norm = float(np.linalg.norm(proj)) + 1e-12
    field_bound = float(np.linalg.norm(X))
    scale = lambda_ar * min(1.0, field_bound / proj_norm)
    return scale * proj


# ============================================================
# Field utilities
# ============================================================

def initialize_field(D: int, rng: np.random.Generator | None = None) -> Array:
    """
    Initialize the shared field X as a unit-norm random vector.

    Parameters
    ----------
    D : int
        Field dimension.
    rng : numpy Generator, optional

    Returns
    -------
    X : Array, shape (D,)
        Unit-norm initial field state.
    """
    if rng is None:
        rng = np.random.default_rng()
    X = rng.standard_normal(D)
    return X / np.linalg.norm(X)


def dissipate_field(X: Array, x_target: float = 2.0, gamma: float = 0.05) -> Array:
    """
    Apply soft field dissipation above the target norm.

    Attenuates ‖X‖ toward x_target when the field norm exceeds it,
    preventing unbounded growth under sustained excitation:

        X_diss = X / (1 + γ · max(0, ‖X‖ - x_target))

    Parameters
    ----------
    X : Array, shape (D,)
        Field state after excitation.
    x_target : float
        Soft norm ceiling.
    gamma : float
        Dissipation coefficient.

    Returns
    -------
    X_diss : Array, shape (D,)
        Dissipated field state.
    """
    excess = max(0.0, float(np.linalg.norm(X)) - x_target)
    return X / (1.0 + gamma * excess)


def normalize_direction(v: Array) -> Array:
    """Return unit vector, handling near-zero input gracefully."""
    norm = float(np.linalg.norm(v))
    return v / (norm + 1e-12)
