# Isolated Real FCE-M Observation Adapter — Report

> ADVISORY ONLY. Research artifact. Does NOT declare Level 3, does NOT create OmegaRecord, does NOT write to OmegaRegistry, does NOT create ReferenceField, does NOT call `agent.check_coagulation`, does NOT modify FCE-M vendor.

- Schema version: `level3-research.fce_observation_adapter.v1`
- Branch: `research/level-3-natural-omega`
- Generated at commit SHA: `2dfa71bf66ffd717cbd6fd3108d748a2c76b6cf2`
- `metric_source_real`: `real_fce_m_on_research_derived_inputs_isolated_adapter_v1`
- `metric_source_surrogate`: `research_surrogate_v1_not_fce_production`
- `theta_s` used: **0.28**
- `tau_coag` used: **12**
- Agent field dim: **16**
- Agent init: kappa_0=0.5, alpha_0=0.5, rho_0=0.1, lambda_0=0.1
- Production config untouched: **True**
- FCE-M vendor unmodified: **True**

## Hard isolation guarantees

- Level 3 declared: **False** (must be false)
- Natural Omega created: **False** (must be false)
- No OmegaRecord created: **True**
- No OmegaRegistry write: **True**
- No ReferenceField created: **True**
- `agent.check_coagulation` called: **False** (must be false)

### Isolation notes

- Imports FCE-M `Agent`, `self_index`, and `autoreferential_measure` read-only. Module imports verified to have no side effects.
- Does NOT call `agent.check_coagulation` (which would mutate `agent.Omega`).
- Does NOT import or call `FceOmegaObserver` (production registry-writing path).
- Field vectors are deterministic hashes of `cycle_id` (SHA-256 → unit vector). NO LLM, NO embedding encoder.
- Anchor is a deterministic mapping of research surrogate telemetry (`0.5*s_t + 0.5*b_t`). NO production semantic encoder.
- Agent.Omega state is verified to remain 0 after every bucket observation; an exception is raised on any unexpected flip.

## Candidate buckets

- `byon::trust_hierarchy::factual` / `factual`
- `byon::security_boundary::security_boundary` / `security_boundary`
- `byon::macp_pipeline::factual` / `factual`

## Transcript A (seed 42)

- `transcript_id`: `transcript_A_byon_arch_v1_500`
- `n_rows`: 500
- `n_events`: 624
- `n_centers`: 22
- `n_summaries`: 105
- `n_potential_omega_signals`: 49
- `invariant_ok`: **True**
- `audit_flags`: `[]`

### Per-bucket real-FCE-M observation

| center_id | perspective | n_cycles | max_S_t_real | mean_S_t_real | longest_run | candidate_cycle_idx | real_FCE_pass | surrogate_pass | diverge | verdict |
|---|---|---:|---:|---:|---:|---:|:---:|:---:|:---:|---|
| `byon::trust_hierarchy::factual` | `factual` | 54 | 0.1330 | 0.0137 | 0 | — | false | true | true | **REAL_FCE_NO_COAGULATION** |
| `byon::security_boundary::security_boundary` | `security_boundary` | 49 | 0.1383 | 0.0173 | 0 | — | false | true | true | **REAL_FCE_NO_COAGULATION** |
| `byon::macp_pipeline::factual` | `factual` | 129 | 0.1342 | 0.0065 | 0 | — | false | true | true | **REAL_FCE_NO_COAGULATION** |

### Divergence notes (real vs surrogate)

- `byon::trust_hierarchy::factual`: surrogate=True, real-FCE=False — surrogate temporal rule and real-FCE temporal rule disagree for this bucket; the surrogate metric reflects alignment/kappa/b_t means while real FCE-M S_t includes I_t (assimilation fidelity) and is driven by the agent's hash-derived field updates
- `byon::security_boundary::security_boundary`: surrogate=True, real-FCE=False — surrogate temporal rule and real-FCE temporal rule disagree for this bucket; the surrogate metric reflects alignment/kappa/b_t means while real FCE-M S_t includes I_t (assimilation fidelity) and is driven by the agent's hash-derived field updates
- `byon::macp_pipeline::factual`: surrogate=True, real-FCE=False — surrogate temporal rule and real-FCE temporal rule disagree for this bucket; the surrogate metric reflects alignment/kappa/b_t means while real FCE-M S_t includes I_t (assimilation fidelity) and is driven by the agent's hash-derived field updates

## Transcript B (seed 1337)

- `transcript_id`: `transcript_B_byon_arch_v1_500`
- `n_rows`: 500
- `n_events`: 596
- `n_centers`: 21
- `n_summaries`: 130
- `n_potential_omega_signals`: 76
- `invariant_ok`: **True**
- `audit_flags`: `[]`

### Per-bucket real-FCE-M observation

| center_id | perspective | n_cycles | max_S_t_real | mean_S_t_real | longest_run | candidate_cycle_idx | real_FCE_pass | surrogate_pass | diverge | verdict |
|---|---|---:|---:|---:|---:|---:|:---:|:---:|:---:|---|
| `byon::trust_hierarchy::factual` | `factual` | 75 | 0.1380 | 0.0116 | 0 | — | false | true | true | **REAL_FCE_NO_COAGULATION** |
| `byon::security_boundary::security_boundary` | `security_boundary` | 39 | 0.1380 | 0.0219 | 0 | — | false | true | true | **REAL_FCE_NO_COAGULATION** |
| `byon::macp_pipeline::factual` | `factual` | 78 | 0.1365 | 0.0106 | 0 | — | false | true | true | **REAL_FCE_NO_COAGULATION** |

### Divergence notes (real vs surrogate)

- `byon::trust_hierarchy::factual`: surrogate=True, real-FCE=False — surrogate temporal rule and real-FCE temporal rule disagree for this bucket; the surrogate metric reflects alignment/kappa/b_t means while real FCE-M S_t includes I_t (assimilation fidelity) and is driven by the agent's hash-derived field updates
- `byon::security_boundary::security_boundary`: surrogate=True, real-FCE=False — surrogate temporal rule and real-FCE temporal rule disagree for this bucket; the surrogate metric reflects alignment/kappa/b_t means while real FCE-M S_t includes I_t (assimilation fidelity) and is driven by the agent's hash-derived field updates
- `byon::macp_pipeline::factual`: surrogate=True, real-FCE=False — surrogate temporal rule and real-FCE temporal rule disagree for this bucket; the surrogate metric reflects alignment/kappa/b_t means while real FCE-M S_t includes I_t (assimilation fidelity) and is driven by the agent's hash-derived field updates

## A/B family cross-status (real FCE-M)

| family | A real verdict | B real verdict | A real pass | B real pass | A surr pass | B surr pass | A diverge | B diverge | comparable |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `byon::trust_hierarchy::factual::factual` | **REAL_FCE_NO_COAGULATION** | **REAL_FCE_NO_COAGULATION** | false | false | true | true | true | true | true |
| `byon::security_boundary::security_boundary::security_boundary` | **REAL_FCE_NO_COAGULATION** | **REAL_FCE_NO_COAGULATION** | false | false | true | true | true | true | true |
| `byon::macp_pipeline::factual::factual` | **REAL_FCE_NO_COAGULATION** | **REAL_FCE_NO_COAGULATION** | false | false | true | true | true | true | true |

## Final verdict

**`REAL_FCE_NO_COAGULATION`**

Real FCE-M S_t never reached `tau_coag` consecutive cycles above `theta_s` in any bucket × transcript pair.

## Confirmations

- Level 3 is **NOT declared**.
- No OmegaRecord created.
- No OmegaRegistry write.
- No ReferenceField created.
- No `agent.check_coagulation` call.
- `theta_s = 0.28` unchanged from operator-locked value.
- `tau_coag = 12` unchanged from operator-locked value.
- Production config untouched.
- FCE-M vendor unmodified.
- Real FCE-M math is applied to research-derived inputs (hash-based field vectors + surrogate-derived anchor); the divergence from a production replay is documented here, not hidden.

