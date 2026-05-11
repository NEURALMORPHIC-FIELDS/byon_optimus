# -*- coding: utf-8 -*-
# Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
# Cluj-Napoca, Romania · Patent EP25216372.0

"""
experiments.run_multiperspectival
===================================
Reproduce the R10b regime: two-phase germinal incubation followed by
normalized multiperspectival field entry.

Usage
-----
    python experiments/run_multiperspectival.py [--seed SEED] [--cycles N]

Principal result (R10b, seed=42):
    Phase 1: Ω_0 = 1 at t=11  κ=0.612  (integrative Sine)
    Phase 2: 1/3 secondary coagulations at t=23  κ=0.773  (integrative)
"""

import argparse
import sys
import os
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.regimes.multiperspectival import MultiperspectivalRegime


AGENT_COLORS = ['#c53030', '#2b6cb0', '#6b46c1', '#276749']


def parse_args():
    parser = argparse.ArgumentParser(description='FCE-Ω R10b: Germinal Incubation')
    parser.add_argument('--seed', type=int, default=42, help='RNG seed')
    parser.add_argument('--cycles', type=int, default=1000, help='Total cycles')
    parser.add_argument('--n-agents', type=int, default=4)
    parser.add_argument('--d', type=int, default=6, help='Field dimension')
    parser.add_argument('--no-plot', action='store_true')
    return parser.parse_args()


def plot_results(regime: MultiperspectivalRegime, out_path: str) -> None:
    N = regime.N
    CYCLES = regime.cycles
    ts = np.arange(CYCLES)
    p2 = regime.phase2_start

    fig, axes = plt.subplots(3, 2, figsize=(13, 11))
    fig.suptitle(
        'FCE-Ω R10b — Germinal Incubation + Multiperspectival Entry\n'
        'Phase 1 (green): Agent 0 alone | Phase 2 (purple): N=4 normalized field',
        fontsize=11
    )

    ax = axes[0, 0]
    for i in range(N):
        ax.plot(ts, regime.hist_S[i], color=AGENT_COLORS[i], lw=0.9, label=f'Ag{i}')
    if p2:
        ax.axvline(p2, color='black', lw=1.5, ls='--', label=f'Phase 2 t={p2}')
    for ag in regime.agents:
        if ag.coag_cycle is not None:
            ax.axvline(ag.coag_cycle, color=AGENT_COLORS[ag.idx], lw=0.8, ls='-.')
    ax.axhline(0.28, color='orange', lw=0.7, ls=':', label='θ_s=0.28')
    ax.set_title('Self-Index S_t per agent'); ax.legend(fontsize=7)
    ax.set_ylim(-0.01, 1.05); ax.grid(True, alpha=0.25)

    ax = axes[0, 1]
    for i in range(N):
        ax.plot(ts, regime.hist_Omega[i], color=AGENT_COLORS[i], lw=1.2, label=f'Ω_{i}')
    if p2:
        ax.axvline(p2, color='black', lw=1.5, ls='--')
    ax.set_yticks([0, 1]); ax.set_yticklabels(['0', '1 (coagulated)'])
    ax.set_title('Omega-Coagulation Registry Ω_i'); ax.legend(fontsize=7)
    ax.grid(True, alpha=0.25)

    ax = axes[1, 0]
    for i in range(N):
        ax.plot(ts, regime.hist_kappa[i], color=AGENT_COLORS[i], lw=0.9, label=f'κ_{i}')
    if p2:
        ax.axvline(p2, color='black', lw=1.5, ls='--')
    ax.set_title('Internal coherence κ'); ax.legend(fontsize=7); ax.grid(True, alpha=0.25)

    ax = axes[1, 1]
    for i in range(N):
        ax.plot(ts, regime.hist_alpha[i], color=AGENT_COLORS[i], lw=0.9, label=f'α_{i}')
    ax.axhline(0.45, color='gray', lw=0.6, ls='--', label='α_ref')
    if p2:
        ax.axvline(p2, color='black', lw=1.5, ls='--')
    ax.set_title('Assimilation capacity α'); ax.legend(fontsize=7); ax.grid(True, alpha=0.25)

    ax = axes[2, 0]
    for i in range(N):
        ax.plot(ts, regime.hist_rho[i], color=AGENT_COLORS[i], lw=0.8, label=f'ρ_{i}')
    if p2:
        ax.axvline(p2, color='black', lw=1.5, ls='--')
    ax.set_title('Residual burden ρ'); ax.legend(fontsize=7); ax.grid(True, alpha=0.25)

    ax = axes[2, 1]
    ax.plot(ts, regime.hist_X_norm, color='#4a5568', lw=0.9)
    ax.axhline(2.0, color='gray', lw=0.6, ls='--', label='X_target')
    if p2:
        ax.axvline(p2, color='black', lw=1.5, ls='--', label=f'Phase 2 t={p2}')
    ax.set_title('‖X‖ shared field norm'); ax.legend(fontsize=7); ax.grid(True, alpha=0.25)

    for ax in axes.flat:
        if p2:
            ax.axvspan(0, p2, alpha=0.07, color='green')
            ax.axvspan(p2, CYCLES, alpha=0.04, color='purple')
        ax.set_xlabel('cycle', fontsize=8)

    plt.tight_layout()
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    plt.savefig(out_path, dpi=150, bbox_inches='tight')
    plt.close()
    print(f'✓ Plot saved → {out_path}')


def main():
    args = parse_args()
    rng = np.random.default_rng(args.seed)

    regime = MultiperspectivalRegime(
        N=args.n_agents,
        D=args.d,
        cycles=args.cycles,
        t_incub_max=100,
        kappa_primary=0.85,
        alpha_primary=0.70,
        kappa_secondary=0.68,
        alpha_secondary=0.65,
        rho_secondary=0.05,
        theta_s=0.28,
        tau_coag=12,
        gamma_anchor=0.35,
        rng=rng,
    )
    regime.run(verbose=True)

    if not args.no_plot:
        out = os.path.join('results', 'figures', 'r10b_multiperspectival.png')
        plot_results(regime, out)


if __name__ == '__main__':
    main()
