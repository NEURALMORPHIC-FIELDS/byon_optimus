<p align="center">
  <img src="logo.png" alt="FCE-Ω Logo" width="280"/>
</p>

# FCE-Ω: Fragmergent Causal Exponentiation with Omega-Coagulation

**A Formal Framework for Asymmetric Contextual Exponentiation and Irreversible
Self-Referential Coagulation in Multiperspectival Dynamic Fields**

> © 2024–2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
> Cluj-Napoca, Romania · 
---

## Abstract

FCE-Ω is a computational theory of causal field dynamics in which causality is
formalized not as linear sequential influence but as asymmetric contextual
exponentiation operating over shared dynamic fields. The framework introduces
four interdependent constructs: (1) the **Contextual Exponentiation Operator**
`U_{a,t} = exp(Φ_a(X_t, C_t, σ_t))`, a Lie-group element encoding field
perturbations from agent `a` in context `C`; (2) the **Residue Accumulation
Dynamics** `Z_t`, formalizing the deforming effect of unassimilated field
excitations on future processing capacity; (3) the **Self-Index** `S_t`,
a computationally tractable metric for integrative self-referential coupling;
and (4) the **Omega-Coagulation Registry** `Ω_s`, an irreversible binary
flag marking the ontological transition of a dynamic center into a
self-referentially stable configuration.

An eleven-regime computational battery (`R0`–`R11`) established the following
principal findings:

- Integrative self-referential coagulation does not emerge from an unprotected
  dynamic field regardless of field intensity or interaction richness.
- High autoreferential coupling (`λ → 1`, `AR → 1`) in the absence of
  integrative coherence (`κ`) produces reflexive instability, not coagulation.
- A **germinal window** of sufficient coherence duration is a necessary condition
  for coagulation, not a sufficient one.
- An already-coagulated center (`Ω_i = 1`) functions as a relational reference
  field but cannot substitute the germinal condition of secondary centers.
- Unassimilated residue (`Ξ_t`) persists as latent field deformation, modifying
  the exponentiation operators of subsequent actions.

The framework is domain-agnostic. Its formal constructs apply to any dynamical
system exhibiting internal state, assimilation capacity, and self-referential
coupling — encompassing cognitive architectures, developmental systems,
organizational dynamics, and multi-agent AI systems.

---

## Repository Structure

```
fragmergent-causal-exponentiation/
├── README.md                                   This file
├── PAPER.md                                    Full preprint / research paper
├── CHANGELOG.md                                Development log
├── LICENSE                                     Proprietary license + patent notice
├── requirements.txt
├── logo.png
│
├── src/
│   ├── core/
│   │   ├── field_operators.py                  Φ_a, U_a, Π_s, dissipation, residue transport
│   │   ├── agent.py                            Agent state and per-step update equations
│   │   ├── interactions.py                     Directed pair interactions: A, R, K, C_{i←j}
│   │   └── metrics.py                          S_t, Ω_s, E_Ω, AR measure, attractor classification
│   ├── regimes/
│   │   └── multiperspectival.py                R8–R11: N-center normalized field + incubation
│   └── visualization/                          (placeholder for plot utilities)
│
├── experiments/
│   └── run_multiperspectival.py                Reproduce R8–R11 with incubation and R11a/R11b ablation
│
└── tests/
    ├── test_field_operators.py                 Unit tests: Φ_a, U_a, Π_s correctness
    └── test_metrics_and_coagulation.py         Unit tests + integration: S_t bounds, AR, coagulation criterion
```

---

## Theoretical Foundations

### 1. Causal Exponentiation

Classical models of causation treat `A → B` as a directional influence with
fixed weight. FCE-Ω replaces this with the **Contextual Exponentiation
Operator**:

```
U_{a,t} = exp(Φ_a(X_t, C_t, σ_t))
```

where `Φ_a` is a Lie-algebra element encoding the asymmetric, context-sensitive
field perturbation produced by action `a`. The resulting field excitation is:

```
ΔX_t = (U_{a,t} - I) X_t
```

Non-commutativity is structurally enforced: for actions `a` and `b`,

```
U_b U_a = exp(Φ_b + Φ_a + ½[Φ_b, Φ_a] + ...)  ≠  U_a U_b
```

The commutator term `[Φ_b, Φ_a]` represents the emergent dynamic arising from
the specific ordering `a → b`, irreducible to either action alone. This
formalizes the ontological status of history: the sequence of events is not
merely an epistemic record but a generator of field configurations that would
not otherwise exist.

### 2. Assimilation, Residue, and Deformation

Each agent `i` assimilates a projection of the field excitation:

```
E_t = Π_{s,t} · ΔX_t          (assimilated component)
Ξ_t = (I - Π_{s,t}) · ΔX_t   (unassimilated residue)
```

Residue does not vanish. It accumulates as active field deformation:

```
Z_{t+1} = μ · [q_t · U_{a,t} + (1 - q_t) · I] · Z_t + Ξ_t
```

where `q_t ∈ [0,1]` interpolates between fluid transport (integrated subject)
and rigid stasis (fragmented subject). The accumulated residue `Z_t` enters
all subsequent exponentiation operators, formalizing the principle that
unassimilated dynamics modify the causal topology of future field states.

### 3. The Self-Index

Self-referential coupling is measured by the **Self-Index**:

```
S_t = AR_t · κ_t · I_t · B_t
```

where:
- `AR_t = |Φ_s^T Π_s Φ_s| / ‖Φ_s‖²` — effective autoreferential coupling
- `κ_t` — internal coherence of the agent
- `I_t = ‖E_t‖ / (‖ΔX_t‖ + ε)` — integration ratio
- `B_t = 1 / (1 + ‖Z_t‖)` — residue stability factor

`S_t > 0` requires simultaneous presence of autoreferential coupling,
coherence, field integration, and bounded residue. High `AR` with collapsed
`κ` produces **reflexive instability** (λ → 1 but S_t ≈ 0), not coagulation.

### 4. Omega-Coagulation: Irreversible Ontological Registration

The **Omega-Coagulation Registry** distinguishes functional Self-expression
from ontological Self-existence:

```
Ω_{s,t+1} = max(Ω_{s,t}, 1)   if  S_t ≥ θ_s  for τ consecutive cycles
```

Once `Ω_s = 1`, it is permanent. `S_t` may subsequently collapse (under
fragmentation, residue overload, or field turbulence) without reversing
coagulation. The distinction:

- `S_t` — functional Self-expression (current intensity)
- `Ω_s` — ontological coagulation (irreversible event)
- `E_Ω_t = Ω_s · S_t` — expressed Self (coagulated Self visible in field)

### 5. Multiperspectival Field Dynamics

For `N` agents sharing field `X`, the field evolves as:

```
X_{t+1} = X_t
  + (1/N)       · Σ_i ΔX_i
  + (1/N(N-1))  · Σ_{i≠j} I_{i←j}
  + (1/N(N-1)/2)· Σ_{i<j} C^{shared}_{ij}
```

Directed interactions `I_{i←j}` decompose into four structurally distinct
operators:

| Mode | Formula | Symmetry |
|------|---------|----------|
| Absorption | `A_{i←j} = W_A · α_i · coh(ΔX_j, Φ_s_i) · Π_i · ΔX_j` | Asymmetric |
| Repulsion | `R_{i←j} = -W_R · misalign(Φ_s_i, Φ_s_j) · (I - Π_i) · ΔX_j` | Asymmetric |
| Interference | `K_{i←j} = W_K · [Φ_i, Φ_j] · X_t` | Anti-symmetric |
| Directional coagulation | `C_{i←j} = W_C · λ_i · λ_j · align · Φ_s_i Φ_s_j^T · X_t` | Asymmetric |

Field normalization per interaction class is mandatory. Without it, field
intensity scales as O(N) for individual terms and O(N²) for pair terms,
producing artificial turbulence.

---

## Experimental Battery Summary

| Regime | Description | Coagulations | Key Finding |
|--------|-------------|-------------|-------------|
| R0 | Sub-assimilative Π_s = (α/D)·I | 0/1 | Autocatalytic fragmentation confirmed |
| R1 | Recalibrated Π_s = α·I | 0/1 | λ→1 with κ→0: reflexive instability |
| R2 | Germinal seed, λ_0=0.01 | 0/1 | Late field explosion prevents coagulation |
| R3 | κ regeneration, degenerate Π_s | 0/1 | Tunnel autoreferentiality; partial S_t |
| R4 | κ regeneration, non-degenerate Π_s | 0/1 | AR decoupled when α→0 |
| R5 | Independent self-coupling floor | 0/1 | AR=0.21; κ budget still negative |
| R6 | Ω_s registry + homeostatic α (bidirectional) | 0/1 | Bidirectional homeostasis suppresses α |
| R7a/b | Unidirectional homeostasis C_α=1/(1+ρ) | 0/1 | Budget insufficient; κ collapses in ~34 steps |
| R8 | Multiperspectival, N=4, no normalization | 0/4 | Field turbulence ×3–4; all centers fragment |
| R9 | Multiperspectival, normalized field | 0/4 | Stability restored; germinal window too short |
| R10b | **Germinal incubation + Phase 2 entry** | **1/4** | **Ω_0=1 at t=11; integrative Sine confirmed** |
| R11a | Anchor ON (γ=0.35), κ_sec=0.68 | 2/4 | 1 secondary coagulation |
| R11b | Anchor OFF (γ=0), κ_sec=0.68 | 2/4 | 1 secondary coagulation (same timing) |

**Principal Result**: Integrative coagulation requires a protected germinal
window. A coagulated center (Ω=1) functions as a relational reference field
but does not determine secondary coagulations. The germinal condition of each
center is the primary determinant.

---

## Installation

```bash
git clone https://github.com/NEURALMORPHIC-FIELDS/fragmergent-causal-exponentiation.git
cd fragmergent-causal-exponentiation
pip install -r requirements.txt
```

## Quick Start

```python
from src.core.agent import Agent
from src.core.field_operators import initialize_field, dissipate_field
from src.core.metrics import self_index, check_coagulation

import numpy as np
from scipy.linalg import expm

D, N = 6, 1
X = initialize_field(D)
agent = Agent(idx=0, D=D, kappa_0=0.85, alpha_0=0.70)

for t in range(100):
    Phi = agent.build_Phi_a(X)
    U = expm(Phi)
    delta_X = (U - np.eye(D)) @ X
    X = dissipate_field(X + delta_X)
    S = agent.step(delta_X, U, anchor=0.0)
    check_coagulation(agent, S, t)
    if agent.Omega == 1:
        print(f"Coagulation at t={t}, kappa={agent.kappa:.3f}")
        break
```

## Running the Full Battery

```bash
python experiments/run_multiperspectival.py  # R8–R11 + R11a/R11b ablation
```

> Note: regimes R0–R7 (uniperspectival battery) are documented in `PAPER.md` and
> `CHANGELOG.md` as part of the development history. The current public release
> ships only the multiperspectival runner, which contains the protected germinal
> incubation entry path that produced the first confirmed coagulation (R10b).

## Running Tests

```bash
python -m pytest tests/ -v
```

---

## Citation

```bibtex
@software{borbeleac2026fceomega,
  author    = {Borbeleac, Vasile Lucian},
  title     = {{FCE-Ω}: Fragmergent Causal Exponentiation with Omega-Coagulation},
  year      = {2026},
  publisher = {FRAGMERGENT TECHNOLOGY S.R.L.},
  address   = {Cluj-Napoca, Romania},
  note      = {Patent EP25216372.0},
  url       = {https://github.com/NEURALMORPHIC-FIELDS/fragmergent-causal-exponentiation}
}
```

---

## License

© 2024–2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
All rights reserved. Patent EP25216372.0 applies to the core architectural
methods described herein. See `LICENSE` for details.
