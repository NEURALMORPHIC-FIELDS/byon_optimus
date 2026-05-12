# Controlled Coagulation Observation Report

> ADVISORY ONLY. Research artifact. Does NOT declare Level 3, does NOT create OmegaRecord, does NOT write to OmegaRegistry, does NOT modify production config, does NOT call the production `check_coagulation`. Inputs are surrogate S_t labeled `research_surrogate_v1_not_fce_production`.

- Schema version: `level3-research.coagulation_observation.v1`
- Branch: `research/level-3-natural-omega`
- Generated at commit SHA: `dc8b1fb5f94c92b804548e479ad7948a4d9a827f`
- Metric source: `research_surrogate_v1_not_fce_production`
- `theta_s` used: **0.28**
- `tau_coag` used: **12**
- `theta_s` source: operator-locked literal in coagulation_observation.runner.THETA_S; matches production operator-locked threshold; production config untouched by this module
- `tau_coag` source: operator-locked literal in coagulation_observation.runner.TAU_COAG; matches production operator-locked threshold; production config untouched by this module
- Production config untouched: **True**

## Hard isolation guarantees

- Level 3 declared: **False** (must be false)
- Natural Omega created: **False** (must be false)
- No OmegaRecord created: **True**
- No OmegaRegistry write: **True**
- No ReferenceField created: **True**

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
- `metric_source`: `research_surrogate_v1_not_fce_production`

### Per-bucket observation

| center_id | perspective | n_cycles | max_s_t | mean_s_t | longest_run | first_above | candidate_cycle_idx | would_coagulate_surrogate | would_coagulate_isolated | verdict |
|---|---|---:|---:|---:|---:|---:|---:|:---:|:---:|---|
| `byon::trust_hierarchy::factual` | `factual` | 54 | 1.0000 | 0.8813 | 54 | 0 | 11 | true | true | **WOULD_COAGULATE** |
| `byon::security_boundary::security_boundary` | `security_boundary` | 49 | 1.0000 | 0.9401 | 49 | 0 | 11 | true | true | **WOULD_COAGULATE** |
| `byon::macp_pipeline::factual` | `factual` | 129 | 1.0000 | 0.7563 | 129 | 0 | 11 | true | true | **WOULD_COAGULATE** |

## Transcript B (seed 1337)

- `transcript_id`: `transcript_B_byon_arch_v1_500`
- `n_rows`: 500
- `n_events`: 596
- `n_centers`: 21
- `n_summaries`: 130
- `n_potential_omega_signals`: 76
- `invariant_ok`: **True**
- `audit_flags`: `[]`
- `metric_source`: `research_surrogate_v1_not_fce_production`

### Per-bucket observation

| center_id | perspective | n_cycles | max_s_t | mean_s_t | longest_run | first_above | candidate_cycle_idx | would_coagulate_surrogate | would_coagulate_isolated | verdict |
|---|---|---:|---:|---:|---:|---:|---:|:---:|:---:|---|
| `byon::trust_hierarchy::factual` | `factual` | 75 | 1.0000 | 0.9207 | 75 | 0 | 11 | true | true | **WOULD_COAGULATE** |
| `byon::security_boundary::security_boundary` | `security_boundary` | 39 | 1.0000 | 0.9383 | 39 | 0 | 11 | true | true | **WOULD_COAGULATE** |
| `byon::macp_pipeline::factual` | `factual` | 78 | 1.0000 | 0.8065 | 78 | 0 | 11 | true | true | **WOULD_COAGULATE** |

## A/B family cross-status

| family | A verdict | B verdict | A surrogate | A isolated | B surrogate | B isolated | comparable |
|---|---|---|:---:|:---:|:---:|:---:|:---:|
| `byon::trust_hierarchy::factual::factual` | **WOULD_COAGULATE** | **WOULD_COAGULATE** | true | true | true | true | true |
| `byon::security_boundary::security_boundary::security_boundary` | **WOULD_COAGULATE** | **WOULD_COAGULATE** | true | true | true | true | true |
| `byon::macp_pipeline::factual::factual` | **WOULD_COAGULATE** | **WOULD_COAGULATE** | true | true | true | true | true |

## Final verdict

**`ISOLATED_RULE_OBSERVED_NO_OMEGA_CREATED`**

The local audit re-implementation of `S_t >= theta_s for tau_coag consecutive cycles` would emit on at least one bucket × transcript. NO OmegaRecord is created. NO registry write. Production config untouched. Level 3 NOT declared. Inputs are surrogate S_t, not production FCE metrics; this is a research observation only.

## Confirmations

- Level 3 is **NOT declared**.
- No OmegaRecord created.
- No OmegaRegistry write.
- No ReferenceField created.
- `theta_s = 0.28` unchanged from operator-locked value.
- `tau_coag = 12` unchanged from operator-locked value.
- Production config untouched.
- Inputs are surrogate S_t (`research_surrogate_v1_not_fce_production`); this is a research observation, not a production coagulation event.

