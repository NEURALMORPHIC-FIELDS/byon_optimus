# Level 3 A/B Comparison Report

> ADVISORY ONLY. Research artifact. Does NOT declare Level 3, does NOT create Omega, does NOT touch production. `metric_source = research_surrogate_v1_not_fce_production`.

- Report version: `level3-ab-audit.v1`
- Branch: `research/level-3-natural-omega`
- Generated at commit SHA: `ac7d22979681a6965b06a7eecd5ceedabba06613`
- Schema version: `level3-research.harness.v1`
- Metric source: `research_surrogate_v1_not_fce_production`

## A. Run metadata

| Field | Run A | Run B |
|---|---|---|
| transcript_id | transcript_A_byon_arch_v1_500 | transcript_B_byon_arch_v1_500 |
| seed | 42 | 1337 |
| n_rows | 500 | 500 |
| n_events | 624 | 596 |
| n_centers | 22 | 21 |
| n_summaries | 105 | 130 |
| n_potential_omega_signals | 49 | 76 |

## B. Z metabolism comparison

| Field | Run A | Run B |
|---|---:|---:|
| z_total_final | 151.400 | 144.400 |
| z_active_final | 34.750 | 22.300 |
| z_resolved_final | 71.983 | 62.300 |
| z_archived_final | 44.667 | 59.800 |
| z_active / z_total | 0.2295 | 0.1544 |
| (resolved + archived) / z_total | 0.7705 | 0.8456 |
| b_t min | 0.053 | 0.093 |
| b_t max | 1.000 | 1.000 |
| b_t final | 0.833 | 0.526 |
| invariant_ok | True | True |
| conservation_holds | True | True |
| audit_flags | `[]` | `[]` |

## C. Summary behavior

- A: 105 summaries; z_reduction_total=116.650
- B: 130 summaries; z_reduction_total=122.100

### Summaries per perspective

| Perspective | Run A | Run B |
|---|---:|---:|
| domain_verified | 11 | 12 |
| factual | 50 | 77 |
| project_state | 10 | 11 |
| security_boundary | 34 | 30 |

### Top summary reasons

| Reason | Run A | Run B |
|---|---:|---:|
| correction_chain | 5 | 5 |
| receipt_success_chain | 8 | 4 |
| expression_pattern_stable | 92 | 121 |

### Top summary centers (Run A — top 10)

- `byon::general::factual` — 23
- `byon::security_boundary::security_boundary` — 16
- `byon::trust_hierarchy::factual` — 13
- `byon::macp_pipeline::factual` — 10
- `byon::executor_air_gap::security_boundary` — 7
- `byon::unsafe_memory::security_boundary` — 6
- `byon::project_state::project_state` — 5
- `byon::fce_m::factual` — 4
- `byon::domain_verified::domain_verified` — 4
- `byon::release_state::project_state` — 3

### Top summary centers (Run B — top 10)

- `byon::general::factual` — 35
- `byon::trust_hierarchy::factual` — 20
- `byon::security_boundary::security_boundary` — 12
- `byon::macp_pipeline::factual` — 11
- `byon::fce_m::factual` — 11
- `byon::unsafe_memory::security_boundary` — 8
- `byon::project_state::project_state` — 6
- `byon::token_policy::security_boundary` — 5
- `byon::domain_verified::domain_verified` — 4
- `byon::level_state::project_state` — 3

## D. PotentialOmega signals

| Field | Run A | Run B |
|---|---:|---:|
| n_signals | 49 | 76 |
| advisory_only_count | 49 | 76 |
| advisory_only_validation | True | True |
| confidence min | 0.417 | 0.452 |
| confidence max | 0.966 | 0.945 |
| confidence avg | 0.656 | 0.637 |
| source_cycle_ids length | 12..12 | 12..12 |

### Top buckets by signal count

**Run A (top 10):**

- `byon::trust_hierarchy::factual` — 16
- `byon::macp_pipeline::factual` — 8
- `byon::security_boundary::security_boundary` — 6
- `byon::general::factual` — 6
- `byon::unsafe_memory::security_boundary` — 6
- `byon::fce_m::factual` — 5
- `byon::project_state::project_state` — 2

**Run B (top 10):**

- `byon::general::factual` — 25
- `byon::trust_hierarchy::factual` — 23
- `byon::macp_pipeline::factual` — 11
- `byon::security_boundary::security_boundary` — 7
- `byon::unsafe_memory::security_boundary` — 7
- `byon::token_policy::security_boundary` — 2
- `byon::release_state::project_state` — 1

## E. Cross-run overlap analysis

- Exact text overlap A∩B: **0** rows
- Common centers (A∩B): **21**
- Centers only in A: **1**
- Centers only in B: **0**
- Common signal buckets (A∩B): **5**

### Common signal buckets

- `byon::general::factual`
- `byon::macp_pipeline::factual`
- `byon::security_boundary::security_boundary`
- `byon::trust_hierarchy::factual`
- `byon::unsafe_memory::security_boundary`

### Divergence — signal buckets only in Run A

- `byon::fce_m::factual`
- `byon::project_state::project_state`

### Divergence — signal buckets only in Run B

- `byon::release_state::project_state`
- `byon::token_policy::security_boundary`

### A/B stability observations

- A z_active / z_total = 0.2295; b_t_final = 0.833; invariant_ok = True
- B z_active / z_total = 0.1544; b_t_final = 0.526; invariant_ok = True

## F. L3 gate audit

| Gate | Status | Rationale |
|---|---|---|
| L3-G1 | **PASS** | Both runs preserve conservation invariant (z_active+z_resolved+z_archived==z_total) and report z_active/z_total = 0.230 (A), 0.154 (B) — strictly less than 1. Summaries reduce z_active while z_total is preserved. |
| L3-G2 | **PARTIAL** | Within-run B_t recovery observed: A min=0.053, max=1.000, final=0.833; B min=0.093, max=1.000, final=0.526. Trend rises off the minimum in both runs. PARTIAL because a controlled coagulation-observation experiment is the next step. |
| L3-G3 | **PASS** | Every summary in A (105 total) and B (130 total) carries a non-empty source_event_ids list. Test `test_12_source_event_ids_complete_in_summary_events` and schema validation in RollingCenterSummary enforce this. |
| L3-G4 | **PASS** | CenterEventBuffer.archive_event marks events archived but never deletes the underlying row. Test `test_11_raw_events_recoverable_after_archive` verifies on harness runs. Provenance + tombstone pointers remain addressable after archival. |
| L3-G5 | **PASS** | A signals: 49 total, 49 carry advisory_only=True. B signals: 76 total, 76 carry advisory_only=True. Detector contract + harness `_verify_invariants` both enforce. |
| L3-G6 | **PASS** | Harness never invokes check_coagulation, never creates OmegaRecord, never calls OmegaRegistry.register, never sets is_omega_anchor. AST-based static checks in `test_17_no_omega_or_registry_or_check_coagulation_in_runner` verify this in the runner module. The conditional 'unless check_coagulation fires' is therefore vacuously satisfied. |
| L3-G7 | **NOT_TESTED_YET** | No OmegaRecord created (research scope intentionally stops before coagulation). ReferenceField creation path therefore not exercised in this audit. Requires a controlled coagulation-observation experiment to test. |
| L3-G8 | **NOT_TESTED_YET** | No OmegaRecord exists to contest post-coagulation. Requires a separate experiment where Omega is allowed to form first. |
| L3-G9 | **NOT_TESTED_YET** | Production code at byon-orchestrator/src/, scripts/, and memory-service/ is untouched on this research branch (verified via git diff vs origin/main). D/E/F/M/N benchmark suites must run on main, not here. The research branch does not regress production by construction; the explicit benchmark run is a separate gate. |
| L3-G10 | **PARTIAL** | Two independent transcripts (A seed=42, B seed=1337) replay successfully under identical code. Both produce non-zero advisory-only PotentialOmega signal counts (A 49, B 76) on comparable center families. NO OmegaRecord has been created in either run, so 'second independent run reproduces an Omega' is not yet tested. Operator approval is a separate gating step outside the harness. |

**Status tally**: NOT_TESTED_YET=3, PARTIAL=2, PASS=5

## G. Conclusion

- Level 3 is **NOT declared**.
- Natural Omega is **NOT proven**.
- Research feasibility signal: **POSITIVE**.
- Z_active semantics: **PROMISING**.
- Main remains **Level 2 of 4**.
- Next step: controlled coagulation-observation experiment, still on research branch; check_coagulation remains untouched until the experiment is designed and operator-approved.
- No production modification, no tag, no release.

