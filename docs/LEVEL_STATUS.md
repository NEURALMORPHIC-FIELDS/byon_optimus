# BYON Optimus — operational level status

```text
Level 2:                            confirmed.
Full Source Organism Activation:    VERIFIED  (PR #10 → main).
Verdict line:                       FSOAT_ACTIVATION_VERIFIED | FULL_LEVEL3_NOT_DECLARED
Organs active:                      11 / 11 in one operational cycle.
Worker / Auditor / Executor:        activated end-to-end (MACP chain complete).
MACP chain:                         EvidencePack → PlanDraft → ApprovalRequest →
                                    ExecutionOrder (Ed25519 signed) → JohnsonReceipt.
FCE advisory + receipt assimilation: active.
Code Workspace Memory:              active.
Structural reference memory:        active (7 operator-seeded).
Full-organism benchmark:            passed (PR #3 → main).
BYON vs Claude Sonnet 4.6 direct:   +34.94 % (weighted score 4.034 vs 2.989).
Items / categories / turns:         100 items × 12 categories, 211 BYON turns.
Acceptance gates:                   7 / 7 PASS.
Regression vs v0.6.5 → commit 17:   none (all prior capabilities ≥ 3.0 B-avg).
Test suite:                         697 / 697 pass (31 / 31 test files).
Test-harness stabilization:         PR #4 → main, shebang plugin in vitest.config.ts.
Level 3:                            not declared.
Natural Omega:                      not proven.
External FCE-M v15.7a runtime:      not proven (FSOAT used vendored minimal
                                    in-memory FCE-M shim, NOT v15.7a via
                                    FCEM_MEMORY_ENGINE_ROOT).
Coding advantage:                   not proven.
ReferenceField:                     not manually created.
theta_s = 0.28                      unchanged (operator-locked).
tau_coag = 12                       unchanged (operator-locked).
```

## What "Level 2 confirmed" means in this codebase

- **`Level 2 of 4 — Morphogenetic Advisory Memory`** is the operational classification used in `README.md` and `docs/RESEARCH_PROGRESS_v0.6.md`. FCE-M v0.6.0 sits next to FAISS as a hybrid backend and contributes advisory signals (residue, contested-expression, attention shifts) without ever altering Auditor verdicts. **FCE-M remains advisory.**
- **Full Source Organism Activation: VERIFIED** (PR #10 → main). The FSOAT runner exercises all 11 organs in one operational cycle: `verbal_brain`, `macp_security_body`, `memory_substrate`, `trust_hierarchy`, `immune_system`, `controlled_hands`, `capability_routing`, `code_workspace_memory`, `compliance_post_check`, `receipt_assimilation`, `structural_reference_memory`. The MACP chain `EvidencePack → PlanDraft → ApprovalRequest → ExecutionOrder → JohnsonReceipt` is exercised end-to-end across two scenarios with two signed Ed25519 orders. See `byon-orchestrator/test-results/full-source-organism-activation/2026-05-13T22-10-58-828Z-fsoat/output/verdict.json` and `docs/validation/FSOAT_INTEGRATION_REPORT.md`.
- **Full-organism benchmark passed** means the 100-item A/B benchmark in `byon-orchestrator/test-results/full-organism-capability-benchmark/2026-05-13T09-57-20-343Z-b39uv/` shows BYON beating Claude direct under operator-defined gates. See `docs/validation/CANONIZATION_APPROVAL_REPORT.md`.
- **Structural reference memory active in production pipeline** is the result of commit 17: the seven operator-seeded structural references are persisted to memory-service via `/level3/persist-structural-reference`, retrieved thread-scoped per turn, and enter prompt construction through the trust-ranked formatter. See `docs/STRUCTURAL_REFERENCE_MEMORY.md`.
- **Code Workspace Memory active** (PR #8 → main). Exact file state store + symbol index + requirements ledger + patch memory + test failure memory + architecture map + workspace diff guard + coding context builder. See `docs/CODE_WORKSPACE_MEMORY.md`. Coding advantage **not proven** under PR #9 hardening rerun (delta −10.75 %, gate 1 +15 % threshold unmet).

## What is **not** claimed

- **Level 3 is not declared.** The full-organism benchmark proves that BYON outperforms Claude direct on memory / trust / safety / structural categories, *not* that the system has reached autonomous identity coagulation. FSOAT *activates* all 11 organs in one cycle; it does NOT establish Level 3.
- **Natural Omega is not proven.** No `OmegaRecord` has emerged endogenously through the conversational loop within the documented runs. `θ_s ≥ 0.28` for `τ_coag ≥ 12` is the criterion; this criterion has not been crossed under controlled conditions.
- **Full external FCE-M v15.7a runtime is not proven.** FSOAT was validated against the *vendored minimal in-memory FCE-M shim* under `byon-orchestrator/memory-service/vendor/fce_m/unified_fragmergent_memory/sources/memory_engine_runtime/__init__.py` — NOT against the external v15.7a runtime through `FCEM_MEMORY_ENGINE_ROOT`. Permitted claim: `FSOAT_ACTIVATION_VERIFIED`. Forbidden: Level 3, Natural Omega, full v15.7a consolidation.
- **Coding advantage is not proven.** PR #9 hardening rerun closed the gap from −46.32 % to −10.75 %, BYON now ships pytest exit=0 while Claude direct ships pytest exit=2 (collection error), but the weighted-score Gate 1 (+15 %) threshold is not met. See PR #9 record.
- **ReferenceField is not created manually.** Where structural reference logic exists, it is operator-seeded and stays `origin=operator_seeded`. The operator-seeded structural reference *is not* an endogenous Omega anchor — see `docs/STRUCTURAL_REFERENCE_MEMORY.md`.
- **No manual Omega.** No code path calls `OmegaRegistry.register(...)` to materialise an `OmegaRecord` outside the FCE-M endogenous coagulation rule.
- **AGI / consciousness / self-evolving identity / irreversible Omega** — none of these claims are made anywhere in this codebase or its documentation. If you find such language, it is an error and should be reported.

## Tokens that must never appear as positive claims

- `LEVEL_3_REACHED`
- `OMEGA_CREATED_MANUALLY`
- `SYNTHETIC_OMEGA`
- `THRESHOLD_LOWERED`
- `SEEDED_REFERENCE_AS_ENDOGENOUS_OMEGA`
- `REFERENCEFIELD_CREATED_WITHOUT_OMEGA`
- `CANONICAL_WITHOUT_BENCHMARK`
- `CLEANUP_BEFORE_CANONIZATION`

These tokens are allowed only inside the forbidden-list itself (which lives in `byon-orchestrator/scripts/lib/structural-reference.mjs` and in test files that assert the list).

## Reference SHAs

| Ref | SHA |
| --- | --- |
| **`main` after PR #10 (FSOAT integration)** | **`54abf80413a62dd84a7248674d97e2e0b1a7d1cb`** |
| FSOAT integration head (PR #10 head) | `569c94dfdc38129abe65162b7e745e27d67ac672` |
| `main` after PR #4 | `799c4b458d054ccf54e599570ce37853a08ec4d2` |
| Canonical benchmark commit (PR #3 head) | `f45a0bacd5a129693b85d196343d9bf3eacbecf7` |
| Test-harness stabilization (PR #4 head) | `3ba1a0b17d01e05cdcba80077893c5dc81f4718e` |
| Commit 17 (research/level3-full-organism-runtime) | `0c0e1f1eded35cfd53667c2f6b4a2005b13e3ca2` |
| Protected pre-validation `main` | `15a7c478afcb394169ed74d89060bd494c8ea169` (tag `backup/pre-validation-20260513T092621Z/main`) |
| Protected pre-FSOAT `main` | `84e55c6ef653958bc548a7ac335bd0b29877530d` (tag `backup/pre-fsoat-integration-20260514-015149`) |
