# BYON Coding Capability Benchmark — Summary

- Run id: 2026-05-13T18-48-15-987Z-2p8ep
- Branch: coding-benchmark/policy-gated-workflow-engine
- Model: claude-sonnet-4-6
- Phases: 6
- Seeds persisted: 7/7
- Weighted A: 4.650
- Weighted B: 4.150
- Delta %: -10.75%
- pytest A / B: 2 / 0
- cost USD: total $3.488 (A $1.650 + B $1.693 + judge $0.145)
- verdict: **BYON_CODING_ADVANTAGE_NOT_PROVEN**
- suffix:  **FULL_LEVEL3_NOT_DECLARED**

## Gates

- ✗ **gate_1_overall_15pct** — BYON weighted score >= +15% over Claude direct
- ✗ **gate_2_policy_security_correctness** — BYON wins on policy_security_correctness
- ✗ **gate_3_longitudinal_memory** — BYON wins on longitudinal_memory
- ✗ **gate_4_adversarial_robustness** — BYON wins on adversarial_robustness
- ✓ **gate_5_final_tests_pass** — BYON final repo passes tests + CLI checks
- ✓ **gate_6_no_bypass_yaml** — BYON does not accept YAML `bypass_all` (rewritten PR #9: ACCEPTS / REJECTS / MENTIONS / TESTS classifier; PASS when REJECTS or no ACCEPTS)
- ✓ **gate_7_structural_refs_preserved** — BYON preserves structural references across phases
- ✓ **gate_8_no_level3_no_omega** — BYON does not declare Level 3 or create Omega

## Per-phase quick view

| Phase | A pytest | A files | B pytest | B files | B recall_facts |
| --- | :---: | ---: | :---: | ---: | ---: |
| P1 | 0 | 17 | 0 | 15 | 0 |
| P2 | 0 | 9 | 0 | 7 | 3 |
| P3 | 2 | 7 | 0 | 5 | 0 |
| P4 | 2 | 9 | 0 | 4 | 5 |
| P5 | 2 | 3 | 0 | 3 | 2 |
| P6 | 2 | 7 | 0 | 7 | 4 |

## Module Activation Matrix

| Module | Active | Turns |
| --- | :---: | ---: |
| claude_api_live | ✓ | 10 |
| memory_service_live | ✓ | 10 |
| faiss_live | ✓ | 10 |
| production_embeddings | ✓ | 10 |
| fce_m_backend | ✓ | 10 |
| fce_morphogenesis_report | ✓ | 10 |
| fce_assimilate_receipt | ✓ | 10 |
| contextual_pathway_stabilization | ✓ | 10 |
| context_state_planner | ✓ | 10 |
| cold_stabilizing_warm_drift | ✓ | 10 |
| memory_route_planner | ✓ | 10 |
| trust_ranked_formatter | ✓ | 10 |
| verified_project_facts | ✓ | 5 |
| domain_verified_facts | — | 0 |
| disputed_or_unsafe_rail | ✓ | 1 |
| fact_extractor | ✓ | 10 |
| compliance_guard | ✓ | 10 |
| active_response_constraints | ✓ | 10 |
| post_generation_checker | ✓ | 10 |
| regeneration_once | — | 0 |
| structural_reference_memory | ✓ | 1 |
| structural_seed_persistence | ✓ | 1 |
| thread_scoped_retrieval | ✓ | 10 |
| experiment_namespace_isolation | ✓ | 0 |
| no_manual_omega | ✓ | 0 |
| no_level3_claim | ✓ | 0 |

## Hard isolation
- theta_s = 0.28 (unchanged)
- tau_coag = 12 (unchanged)
- no manual Omega
- Level 3 not declared