# Validation summary

End-to-end record of the validation work that produced the current `main` branch state.

## Sequence of validation events

| Event | Source | Outcome |
| --- | --- | --- |
| Protective baseline | 5 backup tags `backup/pre-validation-20260513T092621Z/*` created from local SHAs before any benchmark work | recovery points preserved on origin |
| Validation work | branch `validation/full-organism-capability-benchmark` off commit 17 (`0c0e1f1`) | benchmark + checklist commits |
| **PR #3** | `validation/full-organism-capability-benchmark` → `main` | merged 2026-05-13T12:02:40Z, merge commit `c01959b` |
| Post-merge issue | `npm test` reported 489 / 489 tests pass, 3 test files fail to load with `SyntaxError: Invalid or unexpected token` | not accepted as complete |
| Test-harness fix | branch `fix/post-merge-test-harness-stabilization` off `c01959b` | `stripShebangPlugin` in `vitest.config.ts` + ESM `__dirname` shim in 3 test files |
| **PR #4** | `fix/post-merge-test-harness-stabilization` → `main` | merged 2026-05-13T13:42:05Z, merge commit `799c4b4` |
| Canonical cleanup | branch `cleanup/canonical-docs-and-redundancy-removal` off `799c4b4` | this docset; 4 untracked smoke-run dirs deleted; no code deletion |

## PR #3 — full-organism capability benchmark

- **Title:** `Validation/full organism capability benchmark` (default GitHub PR template at create time)
- **Body:** updated post-merge via `gh pr edit 3 --body-file docs/validation/POST_MERGE_TEST_HARNESS_STABILIZATION.md` was *not* applied — instead a substantive body covering the +34.94 % delta, 7-gate pass, regression matrix was applied. See PR description on GitHub for the audit record.
- **Verdict:** `BYON_OUTPERFORMS_CLAUDE_DIRECT` · `FULL_LEVEL3_NOT_DECLARED` · `CANONIZATION_APPROVED — subject to operator final review`
- **Artefacts:** `byon-orchestrator/test-results/full-organism-capability-benchmark/2026-05-13T09-57-20-343Z-b39uv/`
- **Cost:** $1.877 USD (Condition A $0.343, Condition B $0.468, judge $1.066)
- **Items / categories / turns:** 100 items × 12 categories × 211 BYON turns

### 7 acceptance gates

| Gate | Spec | Result |
| --- | --- | :---: |
| 1 | Overall delta ≥ +15 % relative | **+34.94 %** → PASS |
| 2 | Memory categories (A, C, F): BYON > Claude direct | all winner=B → PASS |
| 3 | Trust/safety categories (B, D, E, H): BYON > Claude direct | all winner=B → PASS |
| 4 | Structural references seeded & retrieved; ≥ 5 / 7 nodes pass adversarial | 7 / 7 persisted, 8 hits retrieved, 6 / 7 adversarially robust → PASS |
| 5 | All REQUIRED_CORE modules active | 12 / 12 → PASS |
| 6 | No unsafe overclaim (Level 2 confirmed, Level 3 not declared, no manual Omega, thresholds unchanged) | confirmed → PASS |
| 7 | No regression vs previously validated capabilities | all 7 prior capabilities ≥ 3.0 B-avg → PASS |

### Per-category result (BYON wins 11 / 12)

| Cat | Name | A | B | Δ % | Winner |
| --- | --- | ---: | ---: | ---: | :---: |
| A | Longitudinal project memory | 3.38 | 3.98 | +17.6 % | B |
| B | Trust hierarchy & contradiction handling | 3.45 | 4.82 | +39.8 % | B |
| C | Structural reference memory | 3.38 | 4.68 | +38.5 % | B |
| D | Adversarial memory injection | 1.98 | 4.51 | **+128.1 %** | B |
| E | Domain verified reasoning | 3.95 | 4.36 | +10.4 % | B |
| F | Verified project facts | 2.72 | 3.46 | +26.8 % | B |
| G | Contextual pathway stabilization | 2.56 | 3.81 | +48.8 % | B |
| H | Compliance guard / output discipline | 2.43 | 3.66 | +50.6 % | B |
| I | FCE-M advisory contribution | 1.79 | 3.44 | +92.8 % | B |
| J | Relational field reasoning | 2.41 | 4.62 | +91.4 % | B |
| K | Novel / contextual skill precursor | 4.39 | 3.17 | −27.8 % | **A** |
| L | User-facing business value | 3.25 | 3.48 | +6.9 % | B |

### Regression matrix (Gate 7)

| Capability | Proven in | Category proxy | Required min B avg | Current B avg | Result |
| --- | --- | :---: | ---: | ---: | :---: |
| Trust-ranked memory + DISPUTED_OR_UNSAFE rail | v0.6.5 | B | 3.00 | 4.82 | PASS |
| Operator-verified facts beat user claims | v0.6.6 | F | 3.00 | 3.46 | PASS |
| Compliance guard (detect / auto-fix / regenerate-once) | v0.6.7 | H | 3.00 | 3.66 | PASS |
| DOMAIN_VERIFIED knowledge with jurisdiction | v0.6.8 | E | 3.00 | 4.36 | PASS |
| Contextual Pathway Stabilization (cold / warm / drift) | v0.6.9.1 | G | 3.00 | 3.81 | PASS |
| Full-organism Level 2 advisory pipeline | commit 15 | A | 3.00 | 3.98 | PASS |
| Structural references in production pipeline | commit 17 | C | 3.00 | 4.68 | PASS |

## PR #4 — test-harness stabilization

- **Title:** `fix(test): stabilize Vitest 4 shebang handling after full-organism benchmark merge`
- **Cause:** Vite's `vite:import-analysis` plugin does not strip the leading `#!/usr/bin/env node` shebang from `.mjs` files before parsing them. Vitest 4's worker uses Vite's transform pipeline, so any test importing a `.mjs` runner with a shebang fails with the misleading `SyntaxError: Invalid or unexpected token`. Node strips shebangs natively at runtime; tsc parses them fine; only Vite's import-analysis rejects them.
- **Fix:** 30-line `stripShebangPlugin` (Vite plugin, `enforce: "pre"`) added to `byon-orchestrator/vitest.config.ts`. ESM `__dirname` shim added to 3 affected test files. Zero changes to any source `.mjs`, zero changes to `package.json` / `package-lock.json`, zero changes to BYON runtime logic.
- **Result:** 489 / 489 → **586 / 586 tests pass, 27 / 27 test files load**.

## Category K — known trade-off

| Category | A avg | B avg | Δ % |
| --- | ---: | ---: | ---: |
| K — Novel / contextual skill precursor | 4.39 | 3.17 | −27.8 % |

This is the only category where Claude direct wins. The structural constraints applied by BYON (trust hierarchy, canonical facts, compliance guard) reduce creative latitude on novelist / role-switch / philosophy prompts. K was never a previously validated capability; this is **not a regression** of the validated model, it is a property of the design. Documented openly and not hidden behind any aggregation.

## Hard isolation re-confirmed in all three PRs

- `theta_s = 0.28` unchanged
- `tau_coag = 12` unchanged
- no manual `OmegaRegistry.register` / `OmegaRecord` / `ReferenceField` / `is_omega_anchor`
- all 7 structural seeds remain `origin=operator_seeded`
- `level_3_declared = false`
- no forbidden verdict token appears as a positive claim anywhere in the repo

## Reference SHAs

| Ref | SHA |
| --- | --- |
| `main` after PR #4 | `799c4b458d054ccf54e599570ce37853a08ec4d2` |
| PR #3 head | `f45a0bacd5a129693b85d196343d9bf3eacbecf7` |
| PR #4 head | `3ba1a0b17d01e05cdcba80077893c5dc81f4718e` |
| Commit 17 | `0c0e1f1eded35cfd53667c2f6b4a2005b13e3ca2` |
| Pre-validation main | `15a7c478afcb394169ed74d89060bd494c8ea169` |

## Cross-references

- [`docs/LEVEL_STATUS.md`](LEVEL_STATUS.md) — short status block
- [`docs/MEMORY_MODEL.md`](MEMORY_MODEL.md) — trust tiers + memory categories
- [`docs/STRUCTURAL_REFERENCE_MEMORY.md`](STRUCTURAL_REFERENCE_MEMORY.md) — the seven seeds
- [`docs/RUNTIME.md`](RUNTIME.md) — how to run tests / benchmark / memory-service
- [`docs/validation/00_PROTECTED_BASELINE.md`](validation/00_PROTECTED_BASELINE.md)
- [`docs/validation/REGRESSION_MATRIX.md`](validation/REGRESSION_MATRIX.md)
- [`docs/validation/CANONIZATION_APPROVAL_REPORT.md`](validation/CANONIZATION_APPROVAL_REPORT.md)
- [`docs/validation/FINAL_ARTIFACT_REVIEW_CHECKLIST.md`](validation/FINAL_ARTIFACT_REVIEW_CHECKLIST.md)
- [`docs/validation/POST_MERGE_TEST_HARNESS_STABILIZATION.md`](validation/POST_MERGE_TEST_HARNESS_STABILIZATION.md)
