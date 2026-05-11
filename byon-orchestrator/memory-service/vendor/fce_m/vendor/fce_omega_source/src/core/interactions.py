# -*- coding: utf-8 -*-
# Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
# Cluj-Napoca, Romania · Patent EP25216372.0

"""
fce_omega.core.interactions
============================
Directed, non-commutative interaction operators for multiperspectival fields.

Interaction Taxonomy
--------------------
All interactions are directional: I_{i←j} ≠ I_{j←i}.

    A_{i←j}  Absorption      i integrates part of j's excitation via Π_i
    R_{i←j}  Repulsion       i excludes j's dynamic proportionally to misalignment
    K_{i←j}  Interference    [Φ_i, Φ_j] · X  (non-commutative; K_{i←j} = -K_{j←i})
    C_{i←j}  Directional coagulation  asymmetric pull toward shared form

Shared coagulation nucleus C^{shared}_{ij} is the only symmetric component,
activated when both S_i and S_j exceed THETA_PAIR.

Field Update Normalization
--------------------------
Without normalization, field intensity scales as O(N) for individual terms
and O(N²) for pair terms, producing artificial turbulence. The normalized
update is:

    ΔX_field =
        (1/N)         · Σ_i ΔX_i
      + (1/N(N-1))    · Σ_{i≠j} I_{i←j}
      + (1/N(N-1)/2)  · Σ_{i<j} C^{shared}_{ij}

This conserves field intensity relative to the uniperspectival (N=1) baseline.

Anchor Mechanism
----------------
A coagulated agent (Ω_i = 1) reduces the effective disruption experienced by
other agents through a relational reference field:

    anchor_j = Σ_i Ω_i · max(0, Φ_s_j · Φ_s_i)
    disrupt_j_eff = disrupt_j · (1 - γ_anchor · anchor_j)
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

Array = NDArray[np.float64]

# Default interaction weights
W_ABSORB: float = 0.12
W_REPEL: float = 0.06
W_INTERFERE: float = 0.04
W_COAG_DIR: float = 0.03
W_COAG_SHARED: float = 0.05
THETA_PAIR: float = 0.20


def absorption(
    Pi_i: Array,
    Phi_s_i: Array,
    alpha_i: float,
    delta_Xj: Array,
    w: float = W_ABSORB,
) -> Array:
    """
    Absorption operator A_{i←j}.

    Agent i integrates a fraction of j's field excitation through its own
    assimilation projector, weighted by alignment and assimilation capacity:

        A_{i←j} = W_A · α_i · coh(ΔX_j, Φ_s_i) · Π_i · ΔX_j

    Parameters
    ----------
    Pi_i : Array, shape (D, D)
        Assimilation projector of agent i.
    Phi_s_i : Array, shape (D,)
        Dynamic direction of agent i.
    alpha_i : float
        Assimilation capacity of agent i.
    delta_Xj : Array, shape (D,)
        Field excitation produced by agent j.
    w : float
        Absorption weight.

    Returns
    -------
    A : Array, shape (D,)
        Absorption contribution to field update.
    """
    norm_dXj = float(np.linalg.norm(delta_Xj))
    if norm_dXj < 1e-10:
        return np.zeros_like(delta_Xj)
    coh_ij = float(abs(np.dot(delta_Xj / norm_dXj, Phi_s_i)))
    return w * alpha_i * coh_ij * (Pi_i @ delta_Xj)


def repulsion(
    Pi_i: Array,
    Phi_s_i: Array,
    Phi_s_j: Array,
    delta_Xj: Array,
    w: float = W_REPEL,
) -> Array:
    """
    Repulsion operator R_{i←j}.

    Agent i excludes j's dynamic in proportion to their directional
    misalignment, projecting into the orthogonal complement of Π_i:

        R_{i←j} = -W_R · misalign(Φ_s_i, Φ_s_j) · (I - Π_i) · ΔX_j

    Parameters
    ----------
    Pi_i : Array, shape (D, D)
    Phi_s_i : Array, shape (D,)
    Phi_s_j : Array, shape (D,)
    delta_Xj : Array, shape (D,)
    w : float

    Returns
    -------
    R : Array, shape (D,)
    """
    D = delta_Xj.shape[0]
    misalign = 1.0 - float(abs(np.dot(Phi_s_i, Phi_s_j)))
    return -w * misalign * ((np.eye(D) - Pi_i) @ delta_Xj)


def interference(
    Phi_i: Array,
    Phi_j: Array,
    X: Array,
    w: float = W_INTERFERE,
) -> Array:
    """
    Interference operator K_{i←j} = W_K · [Φ_i, Φ_j] · X.

    The commutator [Φ_i, Φ_j] = Φ_i Φ_j - Φ_j Φ_i is anti-symmetric:
    K_{i←j} = -K_{j←i}. This encodes the irreducible emergent dynamic
    arising from the specific ordering of field operators.

    Parameters
    ----------
    Phi_i : Array, shape (D, D)
        Lie-algebra element of agent i.
    Phi_j : Array, shape (D, D)
        Lie-algebra element of agent j.
    X : Array, shape (D,)
        Current field state.
    w : float

    Returns
    -------
    K : Array, shape (D,)
    """
    commutator = Phi_i @ Phi_j - Phi_j @ Phi_i
    return w * commutator @ X


def coagulation_directional(
    Phi_s_i: Array,
    Phi_s_j: Array,
    lambda_i: float,
    lambda_j: float,
    X: Array,
    w: float = W_COAG_DIR,
) -> Array:
    """
    Directional coagulation operator C_{i←j}.

    Agent i bends toward j's dynamic proportionally to the product of
    their autoreferential coefficients and their directional alignment:

        C_{i←j} = W_C · λ_i · λ_j · align · Φ_s_i Φ_s_j^T · X

    Parameters
    ----------
    Phi_s_i : Array, shape (D,)
    Phi_s_j : Array, shape (D,)
    lambda_i : float
    lambda_j : float
    X : Array, shape (D,)
    w : float

    Returns
    -------
    C : Array, shape (D,)
    """
    joint = lambda_i * lambda_j
    align = float(abs(np.dot(Phi_s_i, Phi_s_j)))
    return w * joint * align * np.outer(Phi_s_i, Phi_s_j) @ X


def coagulation_shared(
    Phi_s_i: Array,
    Phi_s_j: Array,
    S_i: float,
    S_j: float,
    X: Array,
    theta_pair: float = THETA_PAIR,
    w: float = W_COAG_SHARED,
) -> Array:
    """
    Shared coagulation nucleus contribution C^{shared}_{ij}.

    Activated when both agents have S_t above THETA_PAIR. Projects X
    along the geometric mean of their dynamic directions, creating a
    common attractor contribution:

        C^{shared}_{ij} = W_S · min(S_i, S_j) · (Φ_shared Φ_shared^T) · X

    This is the only symmetric interaction: C^{shared}_{ij} = C^{shared}_{ji}.

    Parameters
    ----------
    Phi_s_i, Phi_s_j : Array, shape (D,)
    S_i, S_j : float
    X : Array, shape (D,)
    theta_pair : float
    w : float

    Returns
    -------
    C_shared : Array, shape (D,)
    """
    D = X.shape[0]
    if S_i < theta_pair or S_j < theta_pair:
        return np.zeros(D)
    shared = Phi_s_i + Phi_s_j
    nd = float(np.linalg.norm(shared))
    if nd < 1e-10:
        return np.zeros(D)
    shared /= nd
    return w * min(S_i, S_j) * np.outer(shared, shared) @ X


def compute_anchor(
    agents: list,
    j: int,
) -> float:
    """
    Compute anchor signal for agent j from all coagulated neighbors.

        anchor_j = Σ_{i: Ω_i=1, i≠j} max(0, Φ_s_j · Φ_s_i)

    Parameters
    ----------
    agents : list of Agent
    j : int
        Index of the receiving agent.

    Returns
    -------
    anchor : float ≥ 0
    """
    anchor = 0.0
    Phi_j = agents[j].Phi_s
    for i, ag in enumerate(agents):
        if i != j and ag.Omega == 1:
            anchor += max(0.0, float(np.dot(Phi_j, ag.Phi_s)))
    return anchor


def compute_normalized_field_delta(
    agents: list,
    Phi_list: list,
    dX_list: list,
    X: Array,
    S_list: list,
) -> Array:
    """
    Compute the normalized multiperspectival field update.

    Normalization is applied per interaction class to preserve field
    intensity relative to the uniperspectival baseline:

        ΔX_field =
            (1/N)         · Σ_i ΔX_i
          + (1/N(N-1))    · Σ_{i≠j} I_{i←j}
          + (1/N(N-1)/2)  · Σ_{i<j} C^{shared}_{ij}

    Parameters
    ----------
    agents : list of Agent, length N
    Phi_list : list of Array (D×D), length N
        Lie-algebra elements for current step.
    dX_list : list of Array (D,), length N
        Field excitations ΔX_i for each agent.
    X : Array, shape (D,)
        Current field state.
    S_list : list of float, length N
        Current Self-Index values for pair coagulation gate.

    Returns
    -------
    field_delta : Array, shape (D,)
        Normalized total field update.
    """
    N = len(agents)
    D = X.shape[0]
    N_pairs_ord = N * (N - 1)
    N_pairs_unord = N * (N - 1) // 2

    # Individual excitations
    fd_individual = sum(dX_list, np.zeros(D)) / N

    # Directed pair interactions
    fd_pairs = np.zeros(D)
    for i, ag_i in enumerate(agents):
        for j, ag_j in enumerate(agents):
            if i == j:
                continue
            fd_pairs += absorption(ag_i.Pi_s, ag_i.Phi_s, ag_i.alpha, dX_list[j])
            fd_pairs += repulsion(ag_i.Pi_s, ag_i.Phi_s, ag_j.Phi_s, dX_list[j])
            fd_pairs += interference(Phi_list[i], Phi_list[j], X)
            fd_pairs += coagulation_directional(
                ag_i.Phi_s, ag_j.Phi_s, ag_i.lambda_ar, ag_j.lambda_ar, X
            )
    if N_pairs_ord > 0:
        fd_pairs /= N_pairs_ord

    # Shared nuclei
    fd_shared = np.zeros(D)
    for i in range(N):
        for j in range(i + 1, N):
            fd_shared += coagulation_shared(
                agents[i].Phi_s, agents[j].Phi_s, S_list[i], S_list[j], X
            )
    if N_pairs_unord > 0:
        fd_shared /= N_pairs_unord

    return fd_individual + fd_pairs + fd_shared
