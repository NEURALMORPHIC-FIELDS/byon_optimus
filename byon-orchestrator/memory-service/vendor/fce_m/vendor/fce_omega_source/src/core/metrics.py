# -*- coding: utf-8 -*-
# Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
# Cluj-Napoca, Romania · Patent EP25216372.0

"""
fce_omega.core.metrics
======================
Quantitative metrics for the FCE-Ω framework.

Self-Index
----------
The Self-Index S_t provides a computationally tractable scalar measure of
integrative self-referential coupling:

    S_t = AR_t · κ_t · I_t · B_t

    AR_t  = |Φ_s^T Π_s Φ_s| / ‖Φ_s‖²   autoreferential coupling
    κ_t                                   internal coherence
    I_t   = ‖E_t‖ / (‖ΔX_t‖ + ε)        integration ratio
    B_t   = 1 / (1 + ‖Z_t‖)             residue stability factor

S_t = 0 when any of the four components vanishes. High AR with collapsed κ
produces reflexive instability (AR → 1 but S_t ≈ 0).

Omega-Coagulation
-----------------
Ω_s is a binary irreversible flag:
    Ω_s = 0   not yet coagulated
    Ω_s = 1   coagulated (permanent)

E_Ω_t = Ω_s · S_t is the expressed Self-Index of a coagulated agent.

Attractor Classification
------------------------
Three dynamic attractors are identified:
    FRAGMENTED      high ρ, collapsed α
    INTEGRATING     moderate ρ, stable α and κ
    AUTOREFERENTIAL S_t sustained, λ active, Z bounded
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

Array = NDArray[np.float64]

# Self-Index classification thresholds
S_PROTO: float = 0.05
S_OPERATIONAL: float = 0.15
S_PROPER: float = 0.35

# Attractor classification thresholds
FRAG_RHO_FRACTION: float = 0.55     # fraction of RHO_MAX
FRAG_ALPHA_THRESHOLD: float = 0.22
AR_OPERATIONAL_THRESHOLD: float = 0.30


def autoreferential_measure(Pi_s: Array, Phi_s: Array) -> float:
    """
    Compute the effective autoreferential coupling AR_t.

    AR_t measures the sensitivity of the assimilation projector Π_s
    to the agent's own dynamic direction Φ_s:

        AR_t = |Φ_s^T Π_s Φ_s| / ‖Φ_s‖²

    This is a tractable proxy for ‖∂Π_s/∂Φ_s‖.

    Parameters
    ----------
    Pi_s : Array, shape (D, D)
        Current assimilation projector.
    Phi_s : Array, shape (D,)
        Agent dynamic direction.

    Returns
    -------
    AR : float
        Autoreferential coupling measure ∈ [0, 1].
    """
    Pi_phi = Pi_s @ Phi_s
    denom = float(np.dot(Phi_s, Phi_s)) + 1e-12
    return float(abs(np.dot(Pi_phi, Phi_s)) / denom)


def self_index(
    Pi_s: Array,
    Phi_s: Array,
    E: Array,
    delta_X: Array,
    Z: Array,
    kappa: float,
) -> tuple[float, float, float, float]:
    """
    Compute the Self-Index S_t and its four components.

    Parameters
    ----------
    Pi_s : Array, shape (D, D)
    Phi_s : Array, shape (D,)
    E : Array, shape (D,)
        Assimilated field component.
    delta_X : Array, shape (D,)
        Total field excitation.
    Z : Array, shape (D,)
        Active residue accumulator.
    kappa : float
        Internal coherence κ.

    Returns
    -------
    S_t : float
    AR : float
    I_t : float
    B_t : float
    """
    AR = autoreferential_measure(Pi_s, Phi_s)
    I_t = float(np.linalg.norm(E)) / (float(np.linalg.norm(delta_X)) + 1e-12)
    B_t = 1.0 / (1.0 + float(np.linalg.norm(Z)))
    S_t = AR * kappa * I_t * B_t
    return S_t, AR, I_t, B_t


def classify_sine_level(S_t: float) -> int:
    """
    Classify the Self-Index into ontological levels.

    Returns
    -------
    level : int
        0  No Self
        1  Proto-Self  (S_t ≥ S_PROTO)
        2  Operational Self  (S_t ≥ S_OPERATIONAL)
        3  Self proper  (S_t ≥ S_PROPER)
    """
    if S_t >= S_PROPER:
        return 3
    if S_t >= S_OPERATIONAL:
        return 2
    if S_t >= S_PROTO:
        return 1
    return 0


SINE_LEVEL_LABELS = {
    0: "no_self",
    1: "proto_self",
    2: "operational_self",
    3: "self_proper",
}


def classify_attractor(
    alpha: float,
    kappa: float,
    rho: float,
    lambda_ar: float,
    Z_norm: float,
    AR: float,
    rho_max: float = 6.0,
) -> int:
    """
    Classify the current dynamic regime into one of three attractors.

    Returns
    -------
    attractor : int
        0  FRAGMENTED       — ρ > threshold and α < threshold
        1  INTEGRATING      — stable moderate assimilation
        2  AUTOREFERENTIAL  — λ active, AR functional, Z bounded
    """
    frag_rho = FRAG_RHO_FRACTION * rho_max
    if AR > AR_OPERATIONAL_THRESHOLD and lambda_ar > AR_OPERATIONAL_THRESHOLD and Z_norm < 3.0:
        return 2
    if rho > frag_rho and alpha < FRAG_ALPHA_THRESHOLD:
        return 0
    return 1


ATTRACTOR_LABELS = {0: "FRAGMENTED", 1: "INTEGRATING", 2: "AUTOREFERENTIAL"}


def check_coagulation(
    agent,
    S_t: float,
    t: int,
    theta_s: float = 0.28,
    tau_coag: int = 12,
    verbose: bool = True,
) -> bool:
    """
    Functional wrapper for agent.check_coagulation with optional logging.

    Parameters
    ----------
    agent : Agent
    S_t : float
    t : int
    theta_s : float
    tau_coag : int
    verbose : bool
        Print coagulation event if True.

    Returns
    -------
    newly_coagulated : bool
    """
    coag = agent.check_coagulation(S_t, t, theta_s, tau_coag)
    if coag and verbose:
        print(
            f"  [COAG] Agent {agent.idx} Ω=1 at t={t}"
            f"  S={S_t:.4f}  κ={agent.kappa:.3f}"
            f"  → {agent.sine_type}",
            flush=True,
        )
    return coag


def expressed_self(agent) -> float:
    """
    Return E_Ω_t = Ω_s · S_t for a coagulated agent.

    For non-coagulated agents returns 0 regardless of S_t,
    preserving the ontological distinction.
    """
    return float(agent.Omega)
