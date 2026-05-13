# Redundancy inventory — pre-deletion audit

**Branch:** `cleanup/canonical-docs-and-redundancy-removal`
**Branched from:** `main` @ `799c4b4`
**Created:** 2026-05-13
**Rule in force:** *"Nu șterge cod doar pentru că pare vechi. Demonstrează că este nefolosit."* Default decision = **KEEP**.

This inventory is produced *before* any deletion. Each row carries evidence (grep counts or summary.json inspection) and an explicit KEEP / DELETE / REVIEW_NEEDED decision.

## A. Test-results directories

The canonical full-organism capability benchmark is `2026-05-13T09-57-20-343Z-b39uv` (100 items, BYON +34.94 %, `BYON_OUTPERFORMS_CLAUDE_DIRECT`, all 7 gates PASS). Everything else under `byon-orchestrator/test-results/full-organism-capability-benchmark/` is intermediate.

| Path | Items | Verdict | B-cost USD | Tracked in git? | Decision |
| --- | ---: | --- | ---: | :---: | :---: |
| `byon-orchestrator/test-results/full-organism-capability-benchmark/2026-05-13T09-48-41-058Z-164hl9/` | empty | — (no summary.json) | — | NO | **DELETE** (empty probe; pre-fix) |
| `byon-orchestrator/test-results/full-organism-capability-benchmark/2026-05-13T09-49-13-727Z-1fiamw/` | 3 | `NO_CLEAR_USER_VALUE_ADVANTAGE` | $0.000 | NO | **DELETE** (env-bootstrap not yet applied; B cost = 0 = broken) |
| `byon-orchestrator/test-results/full-organism-capability-benchmark/2026-05-13T09-50-52-781Z-5od2u/` | 2 | `MEMORY_ADVANTAGE_NOT_PROVEN` | $0.000 | NO | **DELETE** (post-bootstrap-attempt but still B cost = 0; broken) |
| `byon-orchestrator/test-results/full-organism-capability-benchmark/2026-05-13T09-55-02-152Z-4tgix/` | 3 | `MEMORY_ADVANTAGE_NOT_PROVEN` | $0.054 | NO | **DELETE** (last smoke probe before canonical run; superseded) |
| `byon-orchestrator/test-results/full-organism-capability-benchmark/2026-05-13T09-57-20-343Z-b39uv/` | 100 | `BYON_OUTPERFORMS_CLAUDE_DIRECT` | $0.468 | YES (committed in PR #3) | **KEEP — CANONICAL** |
| `byon-orchestrator/test-results/level3-full-organism-live/*` (8 runs) | various | — | — | YES | **KEEP** — commit-15 research trail; tests reference the runner that produced them; archive value for reproducibility |
| `byon-orchestrator/test-results/level3-structural-identity/*` (2 runs) | various | — | — | YES | **KEEP** — commit-16 research trail; merged via PR #2/#3 |
| `byon-orchestrator/test-results/level3-structural-identity-full-organism/2026-05-13T08-58-51-831Z-71533158/` | 28 turns | `STRUCTURAL_IDENTITY_FIELD_ACTIVE_IN_PIPELINE` | — | YES | **KEEP** — commit-17 canonical structural-identity run, referenced in commit message and PR #3 description |

**Evidence:** `for d in test-results/full-organism-capability-benchmark/*/; do python -c "..."; done` produced the table above. Run b39uv shows `BYON_OUTPERFORMS_CLAUDE_DIRECT`, items=100, B cost = $0.468 (real run). All four lower-cost / no-summary runs are uncommitted and pre-canonical.

## B. Code (`byon-orchestrator/scripts/`)

For each script, the evidence is `git grep -l <name>` across the repo excluding the scripts/ dir and docs/.

| Script | Grep hits outside `scripts/`+`docs/` | Used by | Decision |
| --- | ---: | --- | :---: |
| `byon-full-organism-capability-benchmark.mjs` | — | the canonical benchmark itself | **KEEP** — canonical benchmark runner |
| `byon-industrial-ab-benchmark.mjs` | — | `tests/unit/level3-structural-identity-full-organism.test.ts` imports `runConditionB` from it; `byon-full-organism-capability-benchmark.mjs` imports it too | **KEEP** — production Condition B pipeline export |
| `level3-structural-identity-full-organism-runner.mjs` | — | `tests/unit/level3-structural-identity-full-organism.test.ts` (24 tests) | **KEEP** — commit-17 canonical runner |
| `level3-full-organism-live-runner.mjs` | — | `tests/unit/level3-full-organism.test.ts` (31 tests) | **KEEP** — commit-15 runner |
| `level3-structural-identity-runner.mjs` | — | `tests/unit/level3-structural-identity.test.ts` (42 tests) | **KEEP** — commit-16 runner |
| `architecture-verify.mjs` | 0 | — | **REVIEW_NEEDED** — appears unused; keep until operator confirms |
| `byon-ab-compliance-rescore.mjs` | 2 (docs only) | rescoring utility | **KEEP** — documented utility |
| `byon-ab-rescore-v0.6.5.mjs` | 1 (doc) | v0.6.5 rescoring utility | **KEEP** — version-tagged utility |
| `byon-chat-once.mjs` | 0 | — | **REVIEW_NEEDED** — keep until operator confirms |
| `byon-coagulation-harness.mjs` | 4 | references `theta_s=0.28`, `tau_coag=12` (immutable thresholds); evidence harness | **KEEP** — operator-locked threshold harness |
| `byon-domain.mjs` | 7 | DOMAIN_VERIFIED tooling | **KEEP** — runtime tooling |
| `byon-facts.mjs` | 2 | facts management CLI | **KEEP** — runtime tooling |
| `byon-fcem-deep-suite.mjs` | 4 | FCE-M deep test suite | **KEEP** — referenced |
| `byon-whatsapp-bridge.mjs` | 8 | WhatsApp surface (per `CLAUDE.md`) | **KEEP** — conversational surface |
| `e2e-pipeline-test.mjs` | 1 (doc) | E2E pipeline test | **KEEP** — pipeline test |
| `lib/_env-bootstrap.mjs` | — | benchmark | **KEEP** — env loader |
| `lib/byon-system-facts.mjs` | — | benchmark + runtime | **KEEP** — canonical facts |
| `lib/context-state.mjs` | — | Contextual Pathway Stabilization | **KEEP** — v0.6.9 runtime |
| `lib/fact-extractor.mjs` | — | runtime | **KEEP** — fact extractor |
| `lib/full-organism-capability-test-bank.mjs` | — | canonical benchmark | **KEEP** — test bank |
| `lib/level3-flag.mjs` | — | runner gating | **KEEP** — env-flag util |
| `lib/relational-field.mjs` | — | commit-14/15 relational instrumentation | **KEEP** — research artefact still imported by tests |
| `lib/structural-reference.mjs` | — | commit-16/17 runners | **KEEP** — structural reference helper |
| `lib/structural-seeds.mjs` | — | commit-17 runner | **KEEP** — seed corpus |
| `lib/scenarios/*` | — | runners | **KEEP** — scenario fixtures |

**Net result:** 0 deletions in `byon-orchestrator/scripts/`. Two scripts marked `REVIEW_NEEDED` (`architecture-verify.mjs`, `byon-chat-once.mjs`) but not deleted — operator-only call.

## C. Tests (`byon-orchestrator/tests/`)

All 27 test files load and the 586 tests in them pass on `main` after PR #4. No test is to be deleted.

| Decision | Count |
| --- | ---: |
| **KEEP — all 27 test files** | 27 |
| DELETE | 0 |

## D. Memory service + FCE-M

| Path | Decision | Reason |
| --- | :---: | --- |
| `byon-orchestrator/memory-service/handlers.py` | KEEP | core handler surface |
| `byon-orchestrator/memory-service/server.py` | KEEP | FastAPI entry point |
| `byon-orchestrator/memory-service/fcem_backend.py` | KEEP | hybrid FAISS + FCE-M backend |
| `byon-orchestrator/memory-service/level3_experimental_endpoints.py` | KEEP | commit-17 endpoints, env-gated, no manual Omega |
| `byon-orchestrator/memory-service/vendor/fce_m/` | KEEP | vendored FCE-M v0.6.0 (BSD-3-Clause) |

## E. Documentation under `docs/`

Goal: add canonical docs that reflect the validated organism. Existing research docs stay as the research-history trail (per operator directive *Nu șterge cod activ ... Nu rescriem runtime-ul*).

| Doc | Status now | Decision |
| --- | --- | :---: |
| `docs/ARCHITECTURE.md` | v0.6.4 snapshot | **UPDATE** — refresh to post-commit-17 + benchmark wording, keep MACP / FCE-M description as-is, add validation footer |
| `docs/RESEARCH_PROGRESS_v0.6.md` | v0.6.0 → v0.6.4 narrative | **KEEP** — research history; new docs reference it but do not contradict it |
| `docs/ROADMAP_v0.6.6_to_v0.7.0.md` | roadmap | **KEEP** |
| `docs/LEVEL3_FULL_ORGANISM_RUNTIME_EXPERIMENT.md` | commit-15 / commit-17 narrative | **KEEP** — research trail |
| `docs/LEVEL3_NATURAL_OMEGA_RESEARCH.md` | research design doc | **KEEP** — research trail; NOT a Level-3 claim |
| `docs/LEVEL3_STRUCTURAL_IDENTITY_EXPERIMENT.md` | commit-16/17 narrative | **KEEP** — research trail |
| `docs/CONTEXTUAL_PATHWAY_STABILIZATION_v0.6.9.md` | v0.6.9 spec | **KEEP** — feature spec |
| `docs/CAPABILITY_REPORT.md` | older capability report | **KEEP** — historical capability snapshot |
| `docs/COMPREHENSIVE_CAPABILITY_REPORT.md` | older capability report | **KEEP** — historical capability snapshot |
| `docs/EXECUTIVE_SUMMARY.md` | executive summary | **KEEP** |
| `docs/IMPLEMENTATION_GUIDE.md` / `IMPLEMENTATION_SUMMARY.md` | implementation guides | **KEEP** |
| `docs/USAGE_VALIDATION_REPORT.md` | usage validation | **KEEP** |
| `docs/PRODUCTION_RUNBOOK.md` | runbook | **KEEP** |
| `docs/SECURITY_WHITEPAPER.md`, `BYON_SECURITY.md`, `PRODUCTION_SECURITY_REMEDIATION.md` | security docs | **KEEP** |
| `docs/GDPR_COMPLIANCE.md`, `PRIVACY_POLICY.md` | compliance | **KEEP** |
| `docs/BYON_API.md`, `BYON_ARCHITECTURE.md`, `BYON_QUICKSTART.md` | API/arch/quickstart | **KEEP** |
| `docs/FAILURE_RECOVERY.md` | failure recovery | **KEEP** |
| `docs/LAUNCH_READINESS.md` | launch readiness | **KEEP** |
| `docs/TEST_CAMPAIGN.md` | test campaign | **KEEP** |
| `docs/WFP-BYON-INTEGRATION-ARCHITECTURE.md` | WFP integration | **KEEP** |
| `docs/validation/00_PROTECTED_BASELINE.md` | benchmark trace | **KEEP — CANONICAL** |
| `docs/validation/REGRESSION_MATRIX.md` | regression matrix | **KEEP — CANONICAL** |
| `docs/validation/CANONIZATION_APPROVAL_REPORT.md` | gates report | **KEEP — CANONICAL** |
| `docs/validation/FINAL_ARTIFACT_REVIEW_CHECKLIST.md` | 20-item freeze | **KEEP — CANONICAL** |
| `docs/validation/POST_MERGE_TEST_HARNESS_STABILIZATION.md` | PR #4 stabilization | **KEEP — CANONICAL** |
| `docs/LEVEL_STATUS.md` | (new) | **CREATE** — operator-mandated |
| `docs/MEMORY_MODEL.md` | (new) | **CREATE** — operator-mandated |
| `docs/STRUCTURAL_REFERENCE_MEMORY.md` | (new) | **CREATE** — operator-mandated |
| `docs/RUNTIME.md` | (new) | **CREATE** — operator-mandated |
| `docs/VALIDATION_SUMMARY.md` | (new) | **CREATE** — operator-mandated |
| `docs/cleanup/REDUNDANCY_INVENTORY.md` | (this file) | **CREATE** |
| `docs/cleanup/REDUNDANCY_REMOVAL_REPORT.md` | (new) | **CREATE** — operator-mandated |
| `README.md` | v0.6.4 snapshot | **UPDATE** — current state pointer to validation docs |

## F. CI workflows + config

| Path | Decision |
| --- | :---: |
| `.github/workflows/*.yml` | **KEEP** — CI is wired and passing |
| `byon-orchestrator/vitest.config.ts` | **KEEP** — includes the stripShebangPlugin from PR #4 |
| `byon-orchestrator/package.json` / `package-lock.json` | **KEEP unchanged** — pinned at vitest 4.0.18 |

## G. Backup tags

| Tag | Decision |
| --- | :---: |
| `backup/pre-validation-20260513T092621Z/main` | **KEEP** |
| `backup/pre-validation-20260513T092621Z/master` | **KEEP** |
| `backup/pre-validation-20260513T092621Z/research-level3-full-organism-runtime` | **KEEP** |
| `backup/pre-validation-20260513T092621Z/research-level-3-natural-omega` | **KEEP** |
| `backup/pre-validation-20260513T092621Z/backup-legacy-remote-main` | **KEEP** |

## Summary

| Bucket | KEEP | DELETE | REVIEW_NEEDED |
| --- | ---: | ---: | ---: |
| Test-results dirs | 12 | **4** | 0 |
| Scripts | 23 | 0 | 2 |
| Tests | 27 | 0 | 0 |
| Memory service / FCE-M | (all) | 0 | 0 |
| Docs (existing) | (all) | 0 | 0 |
| Docs (new canonical) | — | — | **+7 to create** |
| CI / config | (all) | 0 | 0 |
| Backup tags | 5 | 0 | 0 |

**Total deletions authorised by this inventory:** 4 untracked smoke-run directories. No source file, no committed artifact, no documentation is being deleted in this pass.

The 2 `REVIEW_NEEDED` scripts (`architecture-verify.mjs`, `byon-chat-once.mjs`) are left in place pending explicit operator confirmation.
