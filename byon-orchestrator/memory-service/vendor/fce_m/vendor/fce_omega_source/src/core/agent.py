# -*- coding: utf-8 -*-
# Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
# Cluj-Napoca, Romania · Patent EP25216372.0

"""
fce_omega.core.agent
====================
Agent state container and per-step update equations for the FCE-Ω framework.

Each agent `i` maintains the following state vector:

    σ_i = (κ_i, α_i, ρ_i, λ_i)

    κ_i  ∈ [0.01, 1]   Internal coherence
    α_i  ∈ [0.01, 1]   Assimilation capacity
    ρ_i  ∈ [0, ∞)      Residual burden
    λ_i  ∈ [0, 1]      Autoreferential coefficient

Plus the auxiliary state:

    Φ_s_i ∈ ℝ^D (unit)  Agent dynamic direction
    Z_i   ∈ ℝ^D          Active residue accumulator
    Ω_i   ∈ {0, 1}       Ontological coagulation registry (irreversible)
    Π_i   ∈ ℝ^{D×D}      Current assimilation projector
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from src.core.field_operators import (
    build_Phi_a,
    build_Pi_s,
    compute_transport_q,
    update_residue,
    compute_back_action,
    normalize_direction,
)
from src.core.metrics import autoreferential_measure

Array = NDArray[np.float64]


class Agent:
    """
    FCE-Ω agent with full state dynamics and Omega-Coagulation registry.

    Parameters
    ----------
    idx : int
        Agent index (used for logging and pair coagulation tracking).
    D : int
        Field dimension.
    kappa_0 : float
        Initial coherence κ_0.
    alpha_0 : float
        Initial assimilation capacity α_0.
    rho_0 : float
        Initial residual burden ρ_0.
    lambda_0 : float
        Initial autoreferential coefficient λ_0.
    rng : numpy Generator, optional
    **projector_kwargs
        Passed to build_Pi_s (alpha_floor, alpha_self_floor, m_mix).
    """

    # ------------------------------------------------------------------ #
    #  Hyperparameters (class-level defaults; override via subclassing)   #
    # ------------------------------------------------------------------ #

    ETA_E: float = 0.04     # α growth rate from assimilation
    ETA_XI: float = 0.07    # α decay rate from residual burden
    BETA_E: float = 0.03    # κ growth from coherent assimilation
    BETA_XI: float = 0.05   # κ decay from residue disruption
    GAMMA_AR: float = 0.025  # λ growth rate from AR measure
    DELTA_AR: float = 0.04   # λ decay rate from instability
    GAMMA_SELF: float = 0.06 # κ regeneration via self-referential assimilation
    ETA_G_E: float = 0.08    # Φ_s pull toward assimilation direction
    ETA_G_Z: float = 0.04    # Φ_s deformation by residue
    R_ALPHA: float = 0.09    # Homeostatic α recovery rate
    ALPHA_REF: float = 0.45  # Homeostatic α reference level
    RHO_MAX: float = 6.0     # Residue saturation ceiling
    MU: float = 0.90         # Residue persistence
    Z_COHERENCE_CAP: float = 3.0  # Z-norm cap for λ growth gate

    def __init__(
        self,
        idx: int,
        D: int,
        kappa_0: float = 0.55,
        alpha_0: float = 0.55,
        rho_0: float = 0.0,
        lambda_0: float = 0.01,
        action_scale: float = 0.30,
        rng: np.random.Generator | None = None,
        **projector_kwargs,
    ) -> None:
        self.idx = idx
        self.D = D
        self.action_scale = action_scale
        self.rng = rng if rng is not None else np.random.default_rng()
        self._projector_kwargs = projector_kwargs

        # State variables
        self.kappa: float = float(kappa_0)
        self.alpha: float = float(alpha_0)
        self.rho: float = float(rho_0)
        self.lambda_ar: float = float(lambda_0)

        # Auxiliary state
        Phi_s = self.rng.standard_normal(D)
        self.Phi_s: Array = Phi_s / np.linalg.norm(Phi_s)
        self.Z: Array = np.zeros(D)
        self.Pi_s: Array = build_Pi_s(
            self.alpha, self.lambda_ar, self.Phi_s, **projector_kwargs
        )

        # Coagulation registry
        self.Omega: int = 0
        self.coag_cycle: int | None = None
        self.coag_kappa: float | None = None
        self._consec_above_threshold: int = 0

    # ------------------------------------------------------------------ #
    #  Field operator construction                                         #
    # ------------------------------------------------------------------ #

    def build_Phi_a(self, X: Array) -> Array:
        """Construct Lie-algebra element Φ_a for the current field state X."""
        return build_Phi_a(X, self.kappa, self.action_scale, rng=self.rng)

    # ------------------------------------------------------------------ #
    #  Per-step update                                                     #
    # ------------------------------------------------------------------ #

    def step(
        self,
        delta_X: Array,
        U_a: Array,
        anchor: float = 0.0,
        gamma_anchor: float = 0.35,
    ) -> float:
        """
        Execute one update step for this agent.

        Sequence
        --------
        1. Compute assimilation E_t and residue Ξ_t.
        2. Update Z_{t+1} (residue transport).
        3. Update Φ_s (dynamic direction).
        4. Update σ = (κ, α, ρ, λ).
        5. Rebuild Π_s with updated state.
        6. Compute and return S_t.

        Parameters
        ----------
        delta_X : Array, shape (D,)
            Field excitation ΔX_t = (U_a - I) X_t.
        U_a : Array, shape (D, D)
            Field evolution operator.
        anchor : float
            Anchor signal from already-coagulated neighbors:
            anchor_j = Σ_i Ω_i · max(0, Φ_s_j · Φ_s_i).
        gamma_anchor : float
            Anchor coupling coefficient γ_anchor ∈ [0, 1].

        Returns
        -------
        S_t : float
            Self-Index at end of step.
        """
        # --- 1. Assimilation and residue ---
        E = self.Pi_s @ delta_X
        Xi = delta_X - E

        # --- 2. Residue transport ---
        q = compute_transport_q(self.alpha, self.kappa, self.rho, self.RHO_MAX)
        self.Z = update_residue(self.Z, Xi, U_a, q, self.MU)

        # --- 3. Dynamic direction update ---
        nE = float(np.linalg.norm(E))
        nZ = float(np.linalg.norm(self.Z))
        pull = self.ETA_G_E * E / (nE + 1e-12) if nE > 1e-10 else np.zeros(self.D)
        deform = self.ETA_G_Z * self.Z / (nZ + 1e-12) if nZ > 1e-10 else np.zeros(self.D)
        self.Phi_s = normalize_direction(self.Phi_s + pull - deform)

        # --- 4. State updates ---
        ar = autoreferential_measure(self.Pi_s, self.Phi_s)
        I_t = nE / (float(np.linalg.norm(delta_X)) + 1e-12)
        B_t = 1.0 / (1.0 + nZ)
        coh_val = self._coh(E)
        disrupt_val = self._disrupt()

        # Anchor reduces effective disruption
        anchor_clamped = min(anchor, 1.0 / gamma_anchor if gamma_anchor > 0 else 1e9)
        disrupt_eff = disrupt_val * (1.0 - gamma_anchor * anchor_clamped)

        # κ regeneration via coherent self-referential assimilation
        regen_kappa = self.GAMMA_SELF * ar * coh_val * I_t * B_t

        # Homeostatic α recovery (unidirectional: only pulls upward)
        C_alpha = 1.0 / (1.0 + self.rho)
        homeo = self.R_ALPHA * C_alpha * max(0.0, self.ALPHA_REF - self.alpha)

        # Apply updates
        self.rho = float(np.clip(
            self.MU * self.rho + float(np.linalg.norm(Xi)),
            0.0, self.RHO_MAX * 3.0
        ))
        self.alpha = float(np.clip(
            self.alpha + self.ETA_E * nE - self.ETA_XI * self._h(self.rho) + homeo,
            0.01, 1.0
        ))
        self.kappa = float(np.clip(
            self.kappa + self.BETA_E * coh_val - self.BETA_XI * disrupt_eff + regen_kappa,
            0.01, 1.0
        ))

        # λ update: grows from AR measure and coherent assimilation when Z bounded
        bounded = max(0.0, 1.0 - nZ / self.Z_COHERENCE_CAP)
        self.lambda_ar = float(np.clip(
            self.lambda_ar
            + self.GAMMA_AR * ar
            + self.GAMMA_AR * coh_val * bounded
            - self.DELTA_AR * self.rho / (self.RHO_MAX + self.rho),
            0.0, 1.0
        ))

        # --- 5. Rebuild Π_s ---
        self.Pi_s = build_Pi_s(
            self.alpha, self.lambda_ar, self.Phi_s, **self._projector_kwargs
        )

        # --- 6. Compute S_t with updated state ---
        ar_new = autoreferential_measure(self.Pi_s, self.Phi_s)
        Eu = self.Pi_s @ delta_X
        Iu = float(np.linalg.norm(Eu)) / (float(np.linalg.norm(delta_X)) + 1e-12)
        Bu = 1.0 / (1.0 + float(np.linalg.norm(self.Z)))
        return ar_new * self.kappa * Iu * Bu

    # ------------------------------------------------------------------ #
    #  Coagulation check                                                   #
    # ------------------------------------------------------------------ #

    def check_coagulation(
        self,
        S_t: float,
        t: int,
        theta_s: float = 0.28,
        tau_coag: int = 12,
    ) -> bool:
        """
        Update Omega-Coagulation Registry based on S_t and threshold.

        Coagulation is irreversible: once Ω_s = 1, it cannot return to 0
        regardless of subsequent S_t values.

        Parameters
        ----------
        S_t : float
            Current Self-Index value.
        t : int
            Current cycle index.
        theta_s : float
            Coagulation threshold θ_s.
        tau_coag : int
            Minimum consecutive cycles τ above θ_s required for coagulation.

        Returns
        -------
        newly_coagulated : bool
            True if this call triggered coagulation for the first time.
        """
        if S_t >= theta_s:
            self._consec_above_threshold += 1
        else:
            self._consec_above_threshold = 0

        if self.Omega == 0 and self._consec_above_threshold >= tau_coag:
            self.Omega = 1
            self.coag_cycle = t
            self.coag_kappa = self.kappa
            return True
        return False

    # ------------------------------------------------------------------ #
    #  Sine type classification                                            #
    # ------------------------------------------------------------------ #

    @property
    def sine_type(self) -> str:
        """
        Classify the type of coagulated Self based on κ at coagulation.

        Returns
        -------
        str
            'integrative'     κ ≥ 0.40
            'operational'     0.15 ≤ κ < 0.40
            'turbulent'       κ < 0.15
            'not_coagulated'  Ω_s = 0
        """
        if self.Omega == 0:
            return "not_coagulated"
        kc = self.coag_kappa
        if kc >= 0.40:
            return "integrative"
        if kc >= 0.15:
            return "operational"
        return "turbulent"

    # ------------------------------------------------------------------ #
    #  Internal helpers                                                    #
    # ------------------------------------------------------------------ #

    def _coh(self, E: Array) -> float:
        """Cosine alignment between E and Φ_s."""
        nE = float(np.linalg.norm(E))
        return float(abs(np.dot(E / (nE + 1e-12), self.Phi_s))) if nE > 1e-10 else 0.0

    def _disrupt(self) -> float:
        """Misalignment between Z and Φ_s (residue disruption signal)."""
        nZ = float(np.linalg.norm(self.Z))
        return float(1.0 - abs(np.dot(self.Z / (nZ + 1e-12), self.Phi_s))) if nZ > 1e-10 else 0.0

    @staticmethod
    def _h(rho: float) -> float:
        """Saturating burden function h(ρ) = ρ/(1+ρ)."""
        return rho / (1.0 + rho)

    def __repr__(self) -> str:
        return (
            f"Agent(idx={self.idx}, Ω={self.Omega}, "
            f"κ={self.kappa:.3f}, α={self.alpha:.3f}, "
            f"ρ={self.rho:.3f}, λ={self.lambda_ar:.3f})"
        )
