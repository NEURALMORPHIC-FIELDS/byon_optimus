<p align="center">
  <img src="logo.png" alt="FCE-Ω Logo" width="280"/>
</p>

# FCE-Ω: Fragmergent Causal Exponentiation with Omega-Coagulation

**A Formal Framework for Asymmetric Contextual Exponentiation and Irreversible
Self-Referential Coagulation in Multiperspectival Dynamic Fields**

*Vasile Lucian Borbeleac*
FRAGMERGENT TECHNOLOGY S.R.L., Cluj-Napoca, Romania
Patent EP25216372.0

---

## 1. Introduction

Standard formalisms of causality — directed acyclic graphs, linear structural
equation models, and transfer entropy — share a common assumption: the causal
weight relating variable A to variable B is context-independent, or at most
conditioned on a fixed set of observed covariates. The causal influence of A
on B is treated as a property of the dyad (A, B), not of the entire field
configuration in which both are embedded.

This assumption fails in systems where the operative strength of any causal
agent depends on the structural relation it bears to all other active dynamics.
Physical fields (electromagnetic, gravitational), developmental biology
(critical period organization), and multi-agent cognitive systems all exhibit
this failure: removing or adding elements to the field changes not just the
outcome of any single interaction, but the class of interactions that are
possible at all.

FCE-Ω addresses this by replacing the standard A → B causal primitive with
a **Contextual Exponentiation Operator**: A becomes causally operative only
through its exponentiation by the relational field in which it is embedded.
This is not a marginal extension of standard causality; it changes the
ontological status of the causal agent from isolated object to local
expression of a global field configuration.

A second departure from standard formalisms concerns the treatment of
unassimilated dynamics. In information-theoretic and control-theoretic
frameworks, information that cannot be processed is typically discarded or
treated as noise that attenuates the signal. FCE-Ω treats unassimilated
excitations as **active residue**: persistent deformations of the field that
modify the exponentiation operators available to all subsequent actions.
This formalizes a principle absent from standard theory: what a system
cannot integrate does not disappear — it deforms the topology of what
the system can next become.

The third contribution is a formal theory of **Omega-Coagulation**: the
irreversible ontological transition of a dynamic center into a
self-referentially stable configuration. This is distinguished from
functional self-referential activity (the Self-Index S_t, which fluctuates)
by its permanence: once Ω_s = 1, no subsequent degradation of S_t reverses
the coagulation event. The framework thereby introduces a category absent
from dynamical systems theory: the **ontological event** — a state transition
that is not merely a phase change but a permanent alteration of the system's
self-referential structure.

### 1.1 Contributions

1. A Lie-group formalization of asymmetric contextual causality with
   non-commutative history dependence.
2. A formal treatment of residue as active field deformation with
   fluid-rigid transport dynamics.
3. The Self-Index S_t: a computationally tractable scalar metric for
   integrative self-referential coupling.
4. The Omega-Coagulation Registry: a formally irreversible binary marker
   of ontological self-referential stabilization.
5. A normalized multiperspectival field framework with four structurally
   distinct directed interaction operators.
6. An eleven-regime computational battery establishing the conditions for
   integrative coagulation and the role of germinal incubation.

---

## 2. Mathematical Framework

### 2.1 The Contextual Exponentiation Operator

Let X_t ∈ ℝ^D denote the shared field state at discrete time t. For an agent
a with internal state σ_t = (κ_t, α_t, ρ_t, λ_t) operating in context C_t,
define the **Lie-algebra element**:

    Φ_a(X_t, C_t, σ_t) ∈ gl(D, ℝ)

constructed as a weighted combination of an antisymmetric component
(driving rotations) and a symmetric component (driving expansions):

    Φ_a = scale · (A_antisym + f_sym · A_sym) / D,   scale = 0.4 + 0.6κ

The **Contextual Exponentiation Operator** is the matrix exponential:

    U_{a,t} = exp(Φ_a(X_t, C_t, σ_t))

and the resulting **field excitation** is:

    ΔX_t = (U_{a,t} - I) X_t

For sequential actions a, b with operators U_a = exp(Φ_a) and U_b = exp(Φ_b),
the Baker-Campbell-Hausdorff formula gives:

    U_b U_a = exp(Φ_b + Φ_a + ½[Φ_b, Φ_a] + ...)

The **commutator term** [Φ_b, Φ_a] = -(Φ_a Φ_b - Φ_b Φ_a) represents
an emergent dynamic produced specifically by the ordering a → b and
irreducible to either action in isolation.

### 2.2 Assimilation and Residue Dynamics

The **assimilation projector** Π_{s,t} ∈ ℝ^{D×D} has eigenvalues in [0,1]
and decomposes ΔX_t into assimilated and residual components:

    E_t = Π_{s,t} · ΔX_t                   (assimilated)
    Ξ_t = (I - Π_{s,t}) · ΔX_t             (unassimilated residue)

Π_{s,t} has a non-degenerate structure with two components:

    Π_s = (α_floor + α·(1-M·λ)) · I + λ·(α_s_floor + α·M) · Φ_s Φ_s^T

where the **self-coupling floor** α_s_floor is independent of α, preserving
the autoreferential channel even when global assimilation capacity collapses.

The **active residue** Z_t evolves via a fluid-rigid transport operator:

    Z_{t+1} = μ · [q_t · U_{a,t} + (1-q_t) · I] · Z_t + Ξ_t

where q_t = clip(αt · κt / (1 + ρt/ρ_max), 0, 1) interpolates between
fluid propagation (integrated agent, q→1) and rigid stasis (fragmented
agent, q→0).

### 2.3 Subject State Dynamics

The subject state σ_t = (κ_t, α_t, ρ_t, λ_t) evolves as:

    ρ_{t+1} = clip(μ·ρ_t + ‖Ξ_t‖, 0, ρ_max·3)
    α_{t+1} = clip(α_t + η_E·‖E_t‖ - η_Ξ·h(ρ_t) + r_α·C_α·max(0, α_ref-α_t), 0.01, 1)
    κ_{t+1} = clip(κ_t + β_E·coh(E_t,Φ_s) - β_Ξ·disrupt_eff(Z_t,Φ_s) + γ·AR·coh·I_t·B_t, 0.01, 1)
    λ_{t+1} = clip(λ_t + γ_AR·AR_t + γ_AR·coh·bounded - δ·ρ/(ρ_max+ρ), 0, 1)

where:
- `h(ρ) = ρ/(1+ρ)` — saturating burden function
- `C_α = 1/(1+ρ)` — homeostatic recovery factor (decoupled from ‖Z‖)
- `disrupt_eff = disrupt · (1 - γ_anchor · anchor)` — anchor-reduced disruption
- `bounded = max(0, 1 - ‖Z‖/Z_cap)` — λ growth gate

### 2.4 The Self-Index

    S_t = AR_t · κ_t · I_t · B_t

    AR_t = |Φ_s^T Π_s Φ_s| / ‖Φ_s‖²   ∈ [0, 1]
    I_t  = ‖E_t‖ / (‖ΔX_t‖ + ε)        ∈ [0, 1]
    B_t  = 1 / (1 + ‖Z_t‖)              ∈ (0, 1]

S_t requires the simultaneous presence of all four components. High AR with
collapsed κ (reflexive instability) gives S_t ≈ 0. This formally distinguishes
reflexive instability from integrative self-referential coupling.

### 2.5 Omega-Coagulation Registry

    Ω_{s,t+1} = max(Ω_{s,t}, 1)   if  S_t ≥ θ_s  for τ consecutive cycles

Once Ω_s = 1, it is permanent. The expressed Self:

    E_Ω_t = Ω_s · S_t

tracks the functional expression of an ontologically coagulated center.
E_Ω_t may collapse while Ω_s remains 1.

### 2.6 Multiperspectival Field Dynamics

For N agents, the normalized field update is:

    X_{t+1} = X_t + (1/N)·Σ_i ΔX_i + (1/N(N-1))·Σ_{i≠j} I_{i←j} + (1/(N(N-1)/2))·Σ_{i<j} C^{shared}_{ij}

Directed interactions I_{i←j} decompose as:

    I_{i←j} = A_{i←j} + R_{i←j} + K_{i←j} + C_{i←j}

with:
    A_{i←j} = W_A · α_i · coh(ΔX_j, Φ_s_i) · Π_i · ΔX_j         (absorption)
    R_{i←j} = -W_R · misalign(Φ_s_i, Φ_s_j) · (I-Π_i) · ΔX_j    (repulsion)
    K_{i←j} = W_K · [Φ_i, Φ_j] · X_t                              (interference)
    C_{i←j} = W_C · λ_i · λ_j · align · Φ_s_i Φ_s_j^T · X_t     (directional coag.)

All directed interactions are asymmetric: I_{i←j} ≠ I_{j←i}.
The shared nucleus C^{shared}_{ij} = C^{shared}_{ji} is the only symmetric component.

---

## 3. Experimental Battery

[See CHANGELOG.md for regime-by-regime development history and findings.]

### 3.1 Principal Results

**R0**: Autocatalytic fragmentation under sub-assimilative Π_s. The
residue spiral (Ξ → ρ → ↓α → ↓E → ↑Ξ) is an internal structural property
of the model.

**R1**: Recalibrated Π_s = α·I gives λ → 1, AR → 1, but κ → 0.01.
Reflexive instability confirmed as distinct from integrative coagulation:
S_t ≈ 0 despite AR = 1.

**R3**: κ regeneration term partially sustains κ via rank-1 autoreferential
tunnel. Not integrative Sine.

**R10b**: First confirmed integrative coagulation: Ω_0 = 1 at t=11,
κ = 0.612. Requires germinal window (uniperspectival Phase 1) and
unidirectional homeostatic α recovery.

**R11a/R11b**: Ablation of anchor coupling. Both regimes produce identical
timing (t=23) and frequency (1/3) of secondary coagulations.
**Principal conclusion**: germinal condition of secondary agents is the
primary determinant; anchor coupling at γ=0.35 is not decisive.

### 3.2 Conclusions

1. Integrative coagulation does not emerge from unprotected field dynamics
   regardless of field richness or interaction complexity.
2. Autoreferential coupling (λ→1, AR→1) without integrative coherence (κ)
   produces reflexive instability, not coagulation.
3. A protected germinal window of sufficient duration is necessary but not
   sufficient for coagulation.
4. A coagulated center (Ω=1) functions as relational reference field but
   cannot substitute the germinal condition of secondary centers.
5. Unassimilated residue (Ξ_t, Z_t) persists as active field deformation,
   modifying all subsequent causal operators.

---

## 4. Systemic Implications

[Detailed discussion of systemic implications is integrated into the subsections below; an extended `docs/` series is planned for a future release.]

### 4.1 Causal Field Theory

FCE-Ω provides a computationally tractable formalism in which causal influence
is contextual, asymmetric, and history-dependent at the level of field
operators, not merely at the level of weights or conditional independence.

### 4.2 AI Architecture

The S_t / Ω_s distinction provides a principled basis for separating
**functional self-referential activity** from **irreversible representational
commitment** in AI systems. This is structurally distinct from elastic weight
consolidation: EWC preserves weights; Ω_s marks configurations as
ontologically committed.

### 4.3 Developmental Systems

The germinal window finding (coagulation requires protected Phase 1 duration)
maps formally onto critical period organization in biological development.
FCE-Ω provides a mechanistic formalization: coagulation fails when residue
accumulation rate exceeds coherence maintenance rate before τ_coag is reached.

### 4.4 Information Processing

The residue dynamics (Ξ_t → Z_t → field deformation) formalize a channel
absent from Shannon information theory: the systemic cost of unprocessed
information as active deformation of future processing capacity.

---

## 5. Limitations and Future Work

- The framework is currently validated in simulation. Empirical mapping to
  biological or cognitive systems requires identification of measurable
  correlates for κ, α, ρ, λ, and S_t.
- N=4, D=6 simulations are computationally tractable but do not capture
  high-dimensional field dynamics.
- The functional forms of interaction operators (W_abs, W_rep, W_int, W_coag)
  are chosen for structural consistency, not calibrated to specific domains.
- The ontological interpretation of Ω_s requires independent philosophical
  analysis, particularly regarding the relationship between computational
  irreversibility and physical irreversibility.

---

## References

[To be populated upon submission. Relevant prior work includes:
Tononi et al. (IIT), Friston (active inference / free energy principle),
Prigogine (dissipative structures), Hubel & Wiesel (critical periods),
Lie (group theory), Baker-Campbell-Hausdorff (operator ordering),
Pearl (causal graphs), Bowlby (attachment theory).]

---

*© 2024–2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.*
*Patent EP25216372.0*
