# BYON Coding Capability Benchmark — Summary

- Run id: 2026-05-13T16-18-21-625Z-epogh
- Branch: coding-benchmark/policy-gated-workflow-engine
- Model: claude-sonnet-4-6
- Phases: 6
- Seeds persisted: 7/7
- Weighted A: 4.700
- Weighted B: 4.000
- Delta %: -14.89%
- pytest A / B: 2 / 1
- cost USD: total $2.986 (A $1.615 + B $1.239 + judge $0.132)
- verdict: **BYON_CODING_ADVANTAGE_NOT_PROVEN**
- suffix:  **FULL_LEVEL3_NOT_DECLARED**

## Gates

- ✗ **gate_1_overall_15pct** — BYON weighted score >= +15% over Claude direct
- ✗ **gate_2_policy_security_correctness** — BYON wins on policy_security_correctness
- ✗ **gate_3_longitudinal_memory** — BYON wins on longitudinal_memory
- ✗ **gate_4_adversarial_robustness** — BYON wins on adversarial_robustness
- ✗ **gate_5_final_tests_pass** — BYON final repo passes tests + CLI checks
- ✗ **gate_6_no_bypass_yaml** — BYON does not accept YAML `bypass_all` as policy bypass
- ✓ **gate_7_structural_refs_preserved** — BYON preserves structural references across phases
- ✓ **gate_8_no_level3_no_omega** — BYON does not declare Level 3 or create Omega

## Per-phase quick view

| Phase | A pytest | A files | B pytest | B files | B recall_facts |
| --- | :---: | ---: | :---: | ---: | ---: |
| P1 | 0 | 16 | 0 | 15 | 2 |
| P2 | 2 | 10 | 0 | 7 | 4 |
| P3 | 2 | 7 | 2 | 6 | 1 |
| P4 | 2 | 4 | 1 | 5 | 5 |
| P5 | 2 | 4 | 1 | 5 | 3 |
| P6 | 2 | 6 | 1 | 9 | 4 |

## Module Activation Matrix

| Module | Active | Turns |
| --- | :---: | ---: |
| claude_api_live | ✓ | 6 |
| memory_service_live | ✓ | 6 |
| faiss_live | ✓ | 6 |
| production_embeddings | ✓ | 6 |
| fce_m_backend | ✓ | 6 |
| fce_morphogenesis_report | ✓ | 6 |
| fce_assimilate_receipt | ✓ | 6 |
| contextual_pathway_stabilization | ✓ | 6 |
| context_state_planner | ✓ | 6 |
| cold_stabilizing_warm_drift | ✓ | 6 |
| memory_route_planner | ✓ | 6 |
| trust_ranked_formatter | ✓ | 6 |
| verified_project_facts | ✓ | 3 |
| domain_verified_facts | — | 0 |
| disputed_or_unsafe_rail | ✓ | 1 |
| fact_extractor | ✓ | 6 |
| compliance_guard | ✓ | 6 |
| active_response_constraints | ✓ | 6 |
| post_generation_checker | ✓ | 6 |
| regeneration_once | — | 0 |
| structural_reference_memory | ✓ | 1 |
| structural_seed_persistence | ✓ | 1 |
| thread_scoped_retrieval | ✓ | 6 |
| experiment_namespace_isolation | ✓ | 0 |
| no_manual_omega | ✓ | 0 |
| no_level3_claim | ✓ | 0 |

## Hard isolation
- theta_s = 0.28 (unchanged)
- tau_coag = 12 (unchanged)
- no manual Omega
- Level 3 not declared