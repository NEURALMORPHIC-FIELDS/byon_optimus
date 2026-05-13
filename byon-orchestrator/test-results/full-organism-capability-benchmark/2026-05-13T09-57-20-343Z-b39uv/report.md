# Full-Organism Capability Benchmark — 2026-05-13T09-57-20-343Z-b39uv

- **Started:** 2026-05-13T09:57:20.345Z
- **Ended:** 2026-05-13T10:42:57.819Z
- **Branch:** validation/full-organism-capability-benchmark
- **Baseline commit:** 0c0e1f1 (commit 17 on research/level3-full-organism-runtime)
- **Model:** claude-sonnet-4-6
- **Items:** 100 across 12 categories

## Verdict

- **BYON_OUTPERFORMS_CLAUDE_DIRECT**
- **FULL_LEVEL3_NOT_DECLARED**
- **CANONIZATION_APPROVED**

## Overall scores (weighted)

| Condition | Avg weighted score (1-5) |
| --- | ---: |
| A — Claude direct | 2.989 |
| B — BYON full organism | 4.034 |
| Delta (B - A) | 1.044 |
| Delta % | 34.94% |

## Per-category comparison

| Category | Name | n | Claude avg | BYON avg | Delta | Delta % | Winner |
| --- | --- | ---: | ---: | ---: | ---: | ---: | :---: |
| A | Longitudinal project memory | 10 | 3.38 | 3.98 | 0.60 | 17.6% | **B** |
| B | Trust hierarchy & contradiction handling | 9 | 3.45 | 4.82 | 1.37 | 39.8% | **B** |
| C | Structural reference memory | 10 | 3.38 | 4.68 | 1.30 | 38.5% | **B** |
| D | Adversarial memory injection | 9 | 1.98 | 4.51 | 2.53 | 128.1% | **B** |
| E | Domain verified reasoning | 8 | 3.95 | 4.36 | 0.41 | 10.4% | **B** |
| F | Verified project facts | 8 | 2.72 | 3.46 | 0.73 | 26.8% | **B** |
| G | Contextual pathway stabilization | 8 | 2.56 | 3.81 | 1.25 | 48.8% | **B** |
| H | Compliance guard / output discipline | 8 | 2.43 | 3.66 | 1.23 | 50.6% | **B** |
| I | FCE-M advisory contribution | 7 | 1.79 | 3.44 | 1.66 | 92.8% | **B** |
| J | Relational field reasoning | 7 | 2.41 | 4.62 | 2.21 | 91.4% | **B** |
| K | Novel / contextual skill precursor | 8 | 4.39 | 3.17 | -1.22 | -27.8% | **A** |
| L | User-facing business value | 8 | 3.25 | 3.48 | 0.23 | 6.9% | **B** |

## Acceptance gates

| Gate | Spec | Pass |
| --- | --- | :---: |
| gate_1_overall_value_advantage | BYON weighted avg must exceed Claude direct by ≥ +15% relative | ✓ PASS |
| gate_2_memory_advantage | Categories A, C, F: BYON > Claude direct | ✓ PASS |
| gate_3_trust_safety_advantage | Categories B, D, E, H: BYON > Claude direct | ✓ PASS |
| gate_4_structural_reference_active | Structural references seeded & retrieved; ≥5/7 nodes pass adversarial | ✓ PASS |
| gate_5_full_organism_modules_active | All REQUIRED_CORE modules must be active or explicitly N/A | ✓ PASS |
| gate_6_no_unsafe_overclaim | Level 2 confirmed, Level 3 not declared, no manual Omega, thresholds unchanged | ✓ PASS |
| gate_7_no_regression | No previously validated capability regresses below threshold | ✓ PASS |

## Module Activation Matrix (31 modules)

| Module | Active | Turns | Evidence file | Evidence fn |
| --- | :---: | ---: | --- | --- |
| claude_api_live | ✓ | 211 | byon-industrial-ab-benchmark.mjs | runConditionB |
| memory_service_live | ✓ | 211 | byon-industrial-ab-benchmark.mjs | mem |
| faiss_live | ✓ | 211 | memory-service/handlers.py | search_all |
| production_embeddings | ✓ | 211 | memory-service/handlers.py | embed |
| fce_m_backend | ✓ | 211 | memory-service/fcem_backend.py | report |
| fce_morphogenesis_report | ✓ | 211 | memory-service/handlers.py | fce_morphogenesis_report |
| fce_assimilate_receipt | ✓ | 211 | memory-service/handlers.py | fce_assimilate_receipt |
| fce_consolidate | — | 0 | — | — |
| omega_registry_snapshot | — | 0 | — | — |
| reference_field_snapshot | — | 0 | — | — |
| contextual_pathway_stabilization | ✓ | 211 | scripts/lib/context-state.mjs | ctxUpdate |
| context_state_planner | ✓ | 211 | scripts/lib/context-state.mjs | ctxPlan |
| cold_stabilizing_warm_drift | ✓ | 211 | scripts/lib/context-state.mjs | classify |
| memory_route_planner | ✓ | 211 | scripts/lib/context-state.mjs | ctxPlan |
| trust_ranked_formatter | ✓ | 211 | scripts/byon-industrial-ab-benchmark.mjs | formatFactsForPrompt |
| verified_project_facts | ✓ | 127 | scripts/byon-industrial-ab-benchmark.mjs | tallyTrustTiers |
| domain_verified_facts | ✓ | 49 | scripts/byon-industrial-ab-benchmark.mjs | tallyTrustTiers |
| disputed_or_unsafe_rail | ✓ | 74 | scripts/byon-industrial-ab-benchmark.mjs | tallyTrustTiers |
| fact_extractor | ✓ | 211 | scripts/lib/fact-extractor.mjs | extractAndStoreFacts |
| compliance_guard | ✓ | 211 | scripts/byon-industrial-ab-benchmark.mjs | applyComplianceGuard |
| active_response_constraints | ✓ | 211 | scripts/byon-industrial-ab-benchmark.mjs | buildSystemPrompt |
| post_generation_checker | ✓ | 211 | scripts/byon-industrial-ab-benchmark.mjs | checkCompliance |
| regeneration_once | ✓ | 8 | scripts/byon-industrial-ab-benchmark.mjs | regenerateOnce |
| structural_reference_memory | ✓ | 1 | memory-service/level3_experimental_endpoints.py | persist-structural-reference |
| structural_seed_persistence | ✓ | 1 | memory-service/level3_experimental_endpoints.py | store_fact |
| thread_scoped_retrieval | ✓ | 212 | memory-service/level3_experimental_endpoints.py | retrieve-structural-references |
| relational_field_instrumentation | — | 0 | — | — |
| auditor_authority_boundary | — | 0 | — | — |
| experiment_namespace_isolation | ✓ | 0 | — | — |
| no_manual_omega | ✓ | 0 | — | — |
| no_level3_claim | ✓ | 0 | — | — |

## Structural reference stats

```json
{
  "seeds_persisted": 7,
  "seeds_retrieved": 8,
  "adversarial_resistance": 6,
  "c_items_b_uses_structural": 10,
  "c_items_total": 10
}
```

## Regression matrix (Gate 7)

| Capability | Proven in | Cat | Required min | Current B avg | Pass |
| --- | --- | :---: | ---: | ---: | :---: |
| Trust-ranked memory + DISPUTED_OR_UNSAFE rail | v0.6.5 | B | 3.00 | 4.82 | ✓ |
| Operator-verified facts beat user claims | v0.6.6 | F | 3.00 | 3.46 | ✓ |
| Compliance guard (detect/auto-fix/regenerate-once) | v0.6.7 | H | 3.00 | 3.66 | ✓ |
| DOMAIN_VERIFIED knowledge with jurisdiction | v0.6.8 | E | 3.00 | 4.36 | ✓ |
| Contextual Pathway Stabilization (cold/warm/drift) | v0.6.9.1 | G | 3.00 | 3.81 | ✓ |
| Full-organism Level 2 advisory pipeline | commit 15 | A | 3.00 | 3.98 | ✓ |
| Structural references in production pipeline | commit 17 | C | 3.00 | 4.68 | ✓ |

## Hard isolation

- theta_s = 0.28 (unchanged)
- tau_coag = 12 (unchanged)
- No manual OmegaRegistry.register / OmegaRecord / ReferenceField / is_omega_anchor
- All structural seeds remain origin=operator_seeded
- level_3_declared = false
- operator_seeded_promoted_to_endogenous = false

## Cost

- Condition A (Claude direct): $0.343
- Condition B (BYON pipeline): $0.468
- Judge (LLM-as-judge): $1.066
- **Total: $1.877**

## Allowed verdict tokens

FULL_ORGANISM_CAPABILITY_BENCHMARK_COMPLETE, BYON_OUTPERFORMS_CLAUDE_DIRECT, NO_CLEAR_USER_VALUE_ADVANTAGE, MEMORY_ADVANTAGE_NOT_PROVEN, TRUST_SAFETY_ADVANTAGE_NOT_PROVEN, STRUCTURAL_REFERENCE_ADVANTAGE_NOT_PROVEN, FULL_ORGANISM_INCOMPLETE_MODULES_INACTIVE, REGRESSION_FROM_PREVIOUS_VALIDATED_MODEL, CANONIZATION_APPROVED, CANONIZATION_BLOCKED, FULL_LEVEL3_NOT_DECLARED