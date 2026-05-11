# -*- coding: utf-8 -*-
# Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
# Cluj-Napoca, Romania · Patent EP25216372.0

"""
fce_omega.regimes.multiperspectival
=====================================
Two-phase multiperspectival regime: germinal incubation (Phase 1)
followed by normalized N-center field entry (Phase 2).

Phase 1 — Germinal Incubation
------------------------------
A single agent (index 0) operates in an uniperspectival field for at most
T_INCUB_MAX cycles. Coagulation follows the standard criterion:
S_0(t) ≥ θ_s for τ consecutive cycles. If Ω_0 = 1 is not achieved within
T_INCUB_MAX, the regime is classified as INCUBATION_FAILED.

Phase 2 — Multiperspectival Entry
-----------------------------------
After Ω_0 = 1, agents 1..N-1 enter the field. The shared field X continues
from its Phase 1 state without reset. Field updates are normalized per the
R9 normalization scheme. Anchor coupling from Ω_0 = 1 is active.

Principal finding (R10b / R11)
--------------------------------
Integrative coagulation (Ω_0 = 1 at t=11, κ=0.612) is achieved under
germinal incubation with unidirectional homeostatic α recovery.
Secondary coagulations (1/3 agents, t=23) depend on the germinal
condition of secondary agents, not on anchor coupling intensity.
"""

from __future__ import annotations

import numpy as np
from scipy.linalg import expm
from numpy.typing import NDArray

from src.core.agent import Agent
from src.core.field_operators import initialize_field, dissipate_field, build_Phi_a
from src.core.metrics import self_index, check_coagulation
from src.core.interactions import (
    compute_anchor,
    compute_normalized_field_delta,
)

Array = NDArray[np.float64]


class MultiperspectivalRegime:
    """
    Two-phase FCE-Ω regime with germinal incubation.

    Parameters
    ----------
    N : int
        Total number of agents (1 active in Phase 1, all N in Phase 2).
    D : int
        Field dimension.
    cycles : int
        Total simulation cycles (Phase 1 + Phase 2).
    t_incub_max : int
        Maximum Phase 1 duration.
    kappa_primary : float
        Initial κ for agent 0 (germinal seed).
    alpha_primary : float
        Initial α for agent 0.
    kappa_secondary : float
        Initial κ for agents 1..N-1.
    alpha_secondary : float
        Initial α for agents 1..N-1.
    rho_secondary : float
        Initial ρ for agents 1..N-1.
    theta_s : float
        Coagulation threshold θ_s.
    tau_coag : int
        Consecutive-cycles threshold τ.
    gamma_anchor : float
        Anchor coupling coefficient γ_anchor. Set to 0 for ablation (R11b).
    rng : numpy Generator, optional
    **agent_kwargs
        Additional keyword arguments passed to Agent constructor.
    """

    def __init__(
        self,
        N: int = 4,
        D: int = 6,
        cycles: int = 1000,
        t_incub_max: int = 100,
        kappa_primary: float = 0.85,
        alpha_primary: float = 0.70,
        kappa_secondary: float = 0.68,
        alpha_secondary: float = 0.65,
        rho_secondary: float = 0.05,
        theta_s: float = 0.28,
        tau_coag: int = 12,
        gamma_anchor: float = 0.35,
        rng: np.random.Generator | None = None,
        **agent_kwargs,
    ) -> None:
        self.N = N
        self.D = D
        self.cycles = cycles
        self.t_incub_max = t_incub_max
        self.theta_s = theta_s
        self.tau_coag = tau_coag
        self.gamma_anchor = gamma_anchor
        self.rng = rng if rng is not None else np.random.default_rng()

        # Primary agent (germinal seed)
        self.primary = Agent(
            idx=0, D=D, kappa_0=kappa_primary, alpha_0=alpha_primary,
            rng=self.rng, **agent_kwargs
        )
        self.secondary_params = dict(
            kappa_secondary=kappa_secondary,
            alpha_secondary=alpha_secondary,
            rho_secondary=rho_secondary,
            kwargs=agent_kwargs,
        )
        self.agents: list[Agent] = [self.primary]
        self.X: Array = initialize_field(D, self.rng)

        # Pair coagulation registry
        self.Omega_pair: dict[tuple[int, int], int] = {}
        self.Omega_pair_cycles: dict[tuple[int, int], int | None] = {}

        # History arrays (allocated for all N, filled during run)
        self.hist_S = np.zeros((N, cycles))
        self.hist_Omega = np.zeros((N, cycles), dtype=int)
        self.hist_kappa = np.zeros((N, cycles))
        self.hist_alpha = np.zeros((N, cycles))
        self.hist_rho = np.zeros((N, cycles))
        self.hist_lambda = np.zeros((N, cycles))
        self.hist_X_norm = np.zeros(cycles)
        self.hist_phase = np.zeros(cycles, dtype=int)

        # Execution state
        self.phase: int = 1
        self.phase2_start: int | None = None
        self.incubation_result: str = "pending"

    def run(self, verbose: bool = True) -> "MultiperspectivalRegime":
        """
        Execute the full two-phase simulation.

        Returns
        -------
        self : MultiperspectivalRegime
        """
        if verbose:
            self._print_header()

        for t in range(self.cycles):
            if self.phase == 1:
                self._step_phase1(t, verbose)
                if self.incubation_result == "failed":
                    break
            else:
                self._step_phase2(t, verbose)

            self.hist_X_norm[t] = float(np.linalg.norm(self.X))
            self.hist_phase[t] = self.phase

        if verbose:
            self._print_summary()

        return self

    # ------------------------------------------------------------------ #
    #  Phase 1: uniperspectival germinal incubation                        #
    # ------------------------------------------------------------------ #

    def _step_phase1(self, t: int, verbose: bool) -> None:
        ag = self.primary
        Phi = ag.build_Phi_a(self.X)
        U = expm(Phi)
        delta_X = (U - np.eye(self.D)) @ self.X
        self.X = dissipate_field(self.X + delta_X)
        S = ag.step(delta_X, U, anchor=0.0, gamma_anchor=0.0)
        newly_coagulated = check_coagulation(ag, S, t, self.theta_s, self.tau_coag, verbose)

        self.hist_S[0, t] = S
        self.hist_Omega[0, t] = ag.Omega
        self.hist_kappa[0, t] = ag.kappa
        self.hist_alpha[0, t] = ag.alpha
        self.hist_rho[0, t] = ag.rho
        self.hist_lambda[0, t] = ag.lambda_ar
        for i in range(1, self.N):
            self.hist_kappa[i, t] = self.secondary_params["kappa_secondary"]
            self.hist_alpha[i, t] = self.secondary_params["alpha_secondary"]

        if newly_coagulated:
            self._transition_to_phase2(t, verbose)
        elif t >= self.t_incub_max:
            self.incubation_result = "failed"
            if verbose:
                print(f"  [INCUBATION_FAILED] Agent 0 did not coagulate within {self.t_incub_max} cycles.")

    def _transition_to_phase2(self, t: int, verbose: bool) -> None:
        self.phase = 2
        self.phase2_start = t
        self.incubation_result = "success"

        p = self.secondary_params
        for i in range(1, self.N):
            agent = Agent(
                idx=i, D=self.D,
                kappa_0=p["kappa_secondary"],
                alpha_0=p["alpha_secondary"],
                rho_0=p["rho_secondary"],
                rng=self.rng,
                **p["kwargs"],
            )
            self.agents.append(agent)

        for i in range(self.N):
            for j in range(i + 1, self.N):
                self.Omega_pair[(i, j)] = 0
                self.Omega_pair_cycles[(i, j)] = None

        if verbose:
            print(
                f"\n  [PHASE 2] t={t}: agents 1–{self.N-1} entering"
                f" (κ={p['kappa_secondary']}, α={p['alpha_secondary']})\n",
                flush=True,
            )

    # ------------------------------------------------------------------ #
    #  Phase 2: normalized multiperspectival field                         #
    # ------------------------------------------------------------------ #

    def _step_phase2(self, t: int, verbose: bool) -> None:
        agents = self.agents

        # Build Lie elements and excitations
        Phi_list = [ag.build_Phi_a(self.X) for ag in agents]
        U_list = [expm(Phi) for Phi in Phi_list]
        dX_list = [(U - np.eye(self.D)) @ self.X for U in U_list]

        # Anchors from coagulated agents
        anchors = [compute_anchor(agents, j) for j in range(self.N)]

        # Preliminary S_t for pair gate
        S_prelim = []
        for ag, dX in zip(agents, dX_list):
            E = ag.Pi_s @ dX
            AR = float(abs(np.dot(ag.Pi_s @ ag.Phi_s, ag.Phi_s)) / (np.dot(ag.Phi_s, ag.Phi_s) + 1e-12))
            I_t = float(np.linalg.norm(E)) / (float(np.linalg.norm(dX)) + 1e-12)
            B_t = 1.0 / (1.0 + float(np.linalg.norm(ag.Z)))
            S_prelim.append(AR * ag.kappa * I_t * B_t)

        # Normalized field update
        field_delta = compute_normalized_field_delta(agents, Phi_list, dX_list, self.X, S_prelim)
        self.X = dissipate_field(self.X + field_delta)

        # Update pair coagulation registry
        self._update_pair_registry(S_prelim, t, verbose)

        # Agent updates
        for idx, ag in enumerate(agents):
            S = ag.step(dX_list[idx], U_list[idx], anchors[idx], self.gamma_anchor)
            check_coagulation(ag, S, t, self.theta_s, self.tau_coag, verbose)
            self.hist_S[idx, t] = S
            self.hist_Omega[idx, t] = ag.Omega
            self.hist_kappa[idx, t] = ag.kappa
            self.hist_alpha[idx, t] = ag.alpha
            self.hist_rho[idx, t] = ag.rho
            self.hist_lambda[idx, t] = ag.lambda_ar

    def _update_pair_registry(self, S_list: list, t: int, verbose: bool) -> None:
        from src.core.interactions import THETA_PAIR
        for i in range(self.N):
            for j in range(i + 1, self.N):
                key = (i, j)
                if (self.Omega_pair.get(key, 0) == 0
                        and self.agents[i].Omega == 1
                        and self.agents[j].Omega == 1):
                    self.Omega_pair[key] = 1
                    self.Omega_pair_cycles[key] = t
                    if verbose:
                        print(f"  [PAIR_COAG] ({i},{j}) at t={t}", flush=True)

    # ------------------------------------------------------------------ #
    #  Reporting                                                           #
    # ------------------------------------------------------------------ #

    @property
    def n_coagulated(self) -> int:
        return sum(ag.Omega for ag in self.agents)

    @property
    def n_secondary_coagulated(self) -> int:
        return sum(ag.Omega for ag in self.agents[1:])

    def _print_header(self) -> None:
        print("=" * 72)
        print("FCE-Ω Multiperspectival Regime")
        print(f"  N={self.N}  D={self.D}  cycles={self.cycles}")
        print(f"  Phase 1: κ_primary={self.primary.kappa:.2f}  T_max={self.t_incub_max}")
        print(f"  Phase 2: κ_secondary={self.secondary_params['kappa_secondary']:.2f}")
        print(f"  θ_s={self.theta_s}  τ={self.tau_coag}  γ_anchor={self.gamma_anchor}")
        print("=" * 72)

    def _print_summary(self) -> None:
        print("\n" + "=" * 72)
        print("RESULTS")
        print(f"  Incubation: {self.incubation_result}  |  Phase 2 start: t={self.phase2_start}")
        for ag in self.agents:
            if ag.Omega == 1:
                print(
                    f"  Agent {ag.idx}: Ω=1 at t={ag.coag_cycle}"
                    f"  κ@coag={ag.coag_kappa:.3f}  type={ag.sine_type}"
                    f"  S_peak={self.hist_S[ag.idx].max():.4f}"
                )
            else:
                print(
                    f"  Agent {ag.idx}: Ω=0"
                    f"  S_peak={self.hist_S[ag.idx].max():.4f}"
                )
        print(f"  Total coagulated: {self.n_coagulated}/{self.N}")
        print(f"  Secondary coagulations: {self.n_secondary_coagulated}/{self.N-1}")
        for key, cyc in self.Omega_pair_cycles.items():
            if cyc is not None:
                print(f"  Pair Ω_{key}=1 at t={cyc}")
        print("\n  THREE DIAGNOSTIC QUESTIONS:")
        q1 = f"YES at t={self.primary.coag_cycle}" if self.primary.Omega == 1 else "NO"
        q2 = "YES (ontologically irreversible)" if self.primary.Omega == 1 else "N/A"
        q3 = f"{self.n_secondary_coagulated}/{self.N-1}"
        print(f"  1. Agent 0 coagulated in incubation? {q1}")
        print(f"  2. Ω_0 irreversible after Phase 2 entry? {q2}")
        print(f"  3. Secondary coagulations: {q3}")
        print("=" * 72)
