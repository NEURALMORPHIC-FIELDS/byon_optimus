# BYON Optimus — operational level status

```text
Level 2:                            confirmed.
Full-organism benchmark:            passed (PR #3 → main).
BYON vs Claude Sonnet 4.6 direct:   +34.94 % (weighted score 4.034 vs 2.989).
Items / categories / turns:         100 items × 12 categories, 211 BYON turns.
Acceptance gates:                   7 / 7 PASS.
Regression vs v0.6.5 → commit 17:   none (all prior capabilities ≥ 3.0 B-avg).
Test suite:                         586 / 586 pass (27 / 27 test files).
Test-harness stabilization:         PR #4 → main, shebang plugin in vitest.config.ts.
Level 3:                            not declared.
Natural Omega:                      not proven.
ReferenceField:                     not manually created.
theta_s = 0.28                      unchanged (operator-locked).
tau_coag = 12                       unchanged (operator-locked).
```

## What "Level 2 confirmed" means in this codebase

- **`Level 2 of 4 — Morphogenetic Advisory Memory`** is the operational classification used in `README.md` and `docs/RESEARCH_PROGRESS_v0.6.md`. FCE-M v0.6.0 sits next to FAISS as a hybrid backend and contributes advisory signals (residue, contested-expression, attention shifts) without ever altering Auditor verdicts.
- **Full-organism benchmark passed** means the 100-item A/B benchmark in `byon-orchestrator/test-results/full-organism-capability-benchmark/2026-05-13T09-57-20-343Z-b39uv/` shows BYON beating Claude direct under operator-defined gates. See `docs/validation/CANONIZATION_APPROVAL_REPORT.md`.
- **Structural reference memory active in production pipeline** is the result of commit 17: the seven operator-seeded structural references are persisted to memory-service via `/level3/persist-structural-reference`, retrieved thread-scoped per turn, and enter prompt construction through the trust-ranked formatter. See `docs/STRUCTURAL_REFERENCE_MEMORY.md`.

## What is **not** claimed

- **Level 3 is not declared.** The full-organism benchmark proves that BYON outperforms Claude direct on memory / trust / safety / structural categories, *not* that the system has reached autonomous identity coagulation.
- **Natural Omega is not proven.** No `OmegaRecord` has emerged endogenously through the conversational loop within the documented runs. `θ_s ≥ 0.28` for `τ_coag ≥ 12` is the criterion; this criterion has not been crossed under controlled conditions.
- **ReferenceField is not created manually.** Where structural reference logic exists, it is operator-seeded and stays `origin=operator_seeded`. The operator-seeded structural reference *is not* an endogenous Omega anchor — see `docs/STRUCTURAL_REFERENCE_MEMORY.md`.
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
| `main` after PR #4 | `799c4b458d054ccf54e599570ce37853a08ec4d2` |
| Canonical benchmark commit (PR #3 head) | `f45a0bacd5a129693b85d196343d9bf3eacbecf7` |
| Test-harness stabilization (PR #4 head) | `3ba1a0b17d01e05cdcba80077893c5dc81f4718e` |
| Commit 17 (research/level3-full-organism-runtime) | `0c0e1f1eded35cfd53667c2f6b4a2005b13e3ca2` |
| Protected pre-validation `main` | `15a7c478afcb394169ed74d89060bd494c8ea169` (tag `backup/pre-validation-20260513T092621Z/main`) |
