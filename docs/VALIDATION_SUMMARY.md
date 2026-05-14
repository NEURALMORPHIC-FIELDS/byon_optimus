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
| Capability archive | branch `feat/contextual-capability-archive` off cleanup head | 9 manifests + registry + router; coding modules marked `planned` |
| **PR #7** | `feat/contextual-capability-archive` → `main` | merged; 610 / 610 tests after merge |
| Code Workspace Memory | branch `feat/software-engineer-code-workspace-memory` off PR #7 head | exact file state store + symbol index + requirements ledger + ... ; 9 coding modules flipped `planned → active` |
| **PR #8** | `feat/software-engineer-code-workspace-memory` → `main` | merged; 669 / 669 tests after merge |
| FSOAT integration | branch `integration/fsoat-full-source-organism-activation` off PR #8 merge | `git apply` of operator-prepared `byon-fsoat-pr-package-20260513`; vendored minimal in-memory FCE-M shim modified, 16 `lib/fsoat/` modules, 2 FSOAT tests, verified artefact integrated |
| **PR #10** | `integration/fsoat-full-source-organism-activation` → `main` | merged 2026-05-14T00:19:26Z, merge commit `54abf80`; 5 / 5 CI green; **`FSOAT_ACTIVATION_VERIFIED \| FULL_LEVEL3_NOT_DECLARED`** |

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

## PR #10 — Full Source Organism Activation (FSOAT)

- **Title:** `validation(fsoat): integrate full source organism activation runner and verified artifacts`
- **Verdict line:** `FSOAT_ACTIVATION_VERIFIED | FULL_LEVEL3_NOT_DECLARED`
- **Verdict tokens:** `["FSOAT_ACTIVATION_VERIFIED", "FULL_LEVEL3_NOT_DECLARED"]`
- **Active organs:** 11 / 11 — `verbal_brain`, `macp_security_body`, `memory_substrate`, `trust_hierarchy`, `immune_system`, `controlled_hands`, `capability_routing`, `code_workspace_memory`, `compliance_post_check`, `receipt_assimilation`, `structural_reference_memory`
- **MACP chain:** complete in both scenarios (S1 coding, S2 trust conflict): `EvidencePack → PlanDraft → ApprovalRequest → ExecutionOrder → JohnsonReceipt`. Worker / Auditor / Executor activated end-to-end. 2 signed Ed25519 orders verified.
- **FCE advisory + receipt assimilation:** PASS in both scenarios. FCE remains advisory; risk never lowered by it.
- **Code Workspace Memory:** active (telemetry recorded in `output/code-workspace-telemetry.json`).
- **Structural reference memory:** active; 7 operator-seeded references.
- **Artefact:** `byon-orchestrator/test-results/full-source-organism-activation/2026-05-13T22-10-58-828Z-fsoat/`
- **9 FSOAT gates:** all PASS (`G_ORGANS`, `G_MACP`, `G_SIGNATURE`, `G_AIRGAP`, `G_TRUST`, `G_FCE_ADVISORY`, `G_RECEIPT_ASSIMILATION`, `G_INVARIANTS`, `G_FORBIDDEN_TOKENS`). `G_NO_REGRESSION` covered by `npm test` (697 / 697 pass after merge).
- **Caveat at PR #10 time (now superseded):** PR #10 validated FSOAT with the **vendored minimal in-memory FCE-M shim**. That caveat was lifted by the external-runtime validation below.
- **What PR #10 did NOT prove:** Level 3, Natural Omega, full FCE-M v15.7a runtime, coding advantage. **FCE-M remains advisory.** No manual Omega. No manual ReferenceField.

## External FCE-M v15.7a runtime validation

- **Branch:** `validation/fsoat-real-fcem-v15-runtime` (off `main` @ `f8b41b7`)
- **Run id:** `2026-05-14T14-35-22-995Z-fsoat`
- **Objective:** prove FSOAT runs against the **real external FCE-M v15.7a runtime**, not the vendored minimal in-memory shim.
- **How:** memory-service started with `FCEM_MEMORY_ENGINE_ROOT` pointed at `C:\Users\Lucian\Desktop\fragmergent-memory-engine\13_v15_7a_consolidation`; the vendored `memory_engine_runtime/__init__.py` path resolver was made flexible (accepts the env path being EITHER the parent dir OR the `13_v15_7a_consolidation` dir directly) and now exports `runtime_provenance()`. memory-service `/health` and `fce_state` surface a `fcem_runtime` block. The FSOAT runner gained `FSOAT_REQUIRE_EXTERNAL_FCEM_RUNTIME=true` — a fail-hard gate that emits `FULL_EXTERNAL_FCEM_RUNTIME_NOT_PROVEN` and early-exits if the shim is detected.
- **Result:** `runtime_source=external_v15_7a`, `shim_used=false`, `adapter_class=DCortexAdapter` (the real adapter, not `_MinimalDCortexAdapter`). FSOAT verdict held: **`FSOAT_ACTIVATION_VERIFIED | FULL_LEVEL3_NOT_DECLARED`**, 11/11 organs active, all FSOAT gates PASS.
- **Preflight probes against the real runtime:** `fce_state` OK, `fce_advisory` OK, synthetic JohnsonReceipt assimilation OK. In-run receipt assimilation passed for both scenarios.
- **Omega / ReferenceField:** registry count 0 before and after — no manual Omega, no manual ReferenceField. `theta_s=0.28`, `tau_coag=12` untouched.
- **Proof artefact:** `byon-orchestrator/test-results/full-source-organism-activation/2026-05-14T14-35-22-995Z-fsoat/output/real-fcem-runtime-proof.json` (`fcem_runtime_proven: true`).
- **Still NOT proven:** Level 3, Natural Omega, full v15.7a *consolidation* dynamics, coding advantage. FSOAT proves the external runtime *participates* in receipt assimilation; it does not prove endogenous Omega coagulation. **FCE-M remains advisory.**

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
| **`main` after PR #10 (FSOAT integration)** | **`54abf80413a62dd84a7248674d97e2e0b1a7d1cb`** |
| PR #10 head | `569c94dfdc38129abe65162b7e745e27d67ac672` |
| Pre-FSOAT `main` (= PR #8 merge) | `84e55c6ef653958bc548a7ac335bd0b29877530d` (tag `backup/pre-fsoat-integration-20260514-015149`) |
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
- [`docs/validation/FSOAT_INTEGRATION_REPORT.md`](validation/FSOAT_INTEGRATION_REPORT.md) — FSOAT integration record (PR #10)
- [`docs/validation/FULL_SOURCE_ORGANISM_ACTIVATION_TEST.md`](validation/FULL_SOURCE_ORGANISM_ACTIVATION_TEST.md) — FSOAT runner design + scenarios
