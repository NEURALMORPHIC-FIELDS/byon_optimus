# FSOAT integration report

## Post-merge note (PR #10)

The FSOAT integration was opened as draft, CI completed **5 / 5 PASS** (Build Orchestrator 16 s, Lint & Test Orchestrator 24 s, Security Scan 17 s, Validate JSON Schemas 16 s, Docker Build 1 m 8 s), the operator authorised merge, and PR #10 was merged into `main` on `2026-05-14T00:19:26Z`.

- **Merge commit:** `54abf80413a62dd84a7248674d97e2e0b1a7d1cb`
- **`main` now contains FSOAT.** Local main was fast-forwarded; `git merge-base --is-ancestor 569c94d HEAD` returns 0.
- **Post-merge suite on `main`:** `npm test` → **31 / 31 files, 697 / 697 tests pass**; `npm run build` exit 0; `npx tsc --noEmit` exit 0.
- **Working tree clean** after a `git -c core.longpaths=true checkout HEAD -- ...` restore of two deep handoff receipt JSON paths that Windows MAX_PATH refused during the initial `pull --ff-only` (the files are in the merge commit on the remote; only their local checkout needed `core.longpaths=true`).
- **No tag / release / branch deletion / cleanup** performed.
- **`theta_s = 0.28` and `tau_coag = 12` unchanged** on `main`.
- **No Level 3 / Omega claim** introduced. **FCE-M remains advisory.**

---

**Branch:** `integration/fsoat-full-source-organism-activation`
**Base SHA:** `84e55c6ef653958bc548a7ac335bd0b29877530d` (main @ PR #8 merge)
**Backup tag:** `backup/pre-fsoat-integration-20260514-015149` → same SHA
**Source package:** `C:\Users\Lucian\Desktop\byon_omni_fragmergent-causal-exponentiation-memory\ULTIMA VERSIUNE\byon-fsoat-pr-package-20260513` (already extracted; no ZIP step needed)
**Integration method:** **`git apply git/fsoat.patch`** (preferred path; clean, no bundle / no manual copy)
**Patch dry-run (`git apply --check`):** exit 0
**Patch apply:** exit 0, no conflicts

## Package integrity

| Check | Result |
|---|---|
| `CHECKSUMS.sha256` (sha256sum -c) | **all OK** (60+ files; sample tail: `npm-build.txt`, `npm-test.txt`, `tsc-noemit.txt`, all `source/changed-files/*` files OK) |
| Mandatory files present | 7 / 7 (`git/fsoat.patch`, `git/fsoat-branch.bundle`, `source/changed-files`, `artifacts/full-source-organism-activation/2026-05-13T22-10-58-828Z-fsoat`, `PR_BODY.md`, `README_APPLY.md`, `CHECKSUMS.sha256`) |
| Secret scan | only `MOCKMOCKMOCK` placeholders (`-----BEGIN PRIVATE KEY-----\nMOCKMOCKMOCKMOCKMOCK\n-----END PRIVATE KEY-----`) inside two test files. No real keys. **No real tokens. No real API keys.** |

## Files integrated (20)

```
 .../sources/memory_engine_runtime/__init__.py      | 103 +++-
 byon-orchestrator/scripts/byon-full-source-organism-activation-test.mjs  | 611 +++++
 byon-orchestrator/scripts/lib/fsoat/activation-tracker.mjs               | 226 +++
 byon-orchestrator/scripts/lib/fsoat/auditor-runner-adapter.mjs           | 219 +++
 byon-orchestrator/scripts/lib/fsoat/capability-experience-observer.mjs   | 174 +++
 byon-orchestrator/scripts/lib/fsoat/code-workspace-observer.mjs          | 202 +++
 byon-orchestrator/scripts/lib/fsoat/executor-runner-adapter.mjs          | 168 +++
 byon-orchestrator/scripts/lib/fsoat/fce-receipt-assimilation-observer.mjs| 362 +++
 byon-orchestrator/scripts/lib/fsoat/final-verdict-builder.mjs            | 333 +++
 byon-orchestrator/scripts/lib/fsoat/handoff-workspace-manager.mjs        | 194 +++
 byon-orchestrator/scripts/lib/fsoat/index.mjs                            |  19 +
 byon-orchestrator/scripts/lib/fsoat/macp-chain-observer.mjs              | 166 +++
 byon-orchestrator/scripts/lib/fsoat/scenarios/S1-minimal-coding.json     |  45 +
 byon-orchestrator/scripts/lib/fsoat/structural-reference-observer.mjs    | 196 +++
 byon-orchestrator/scripts/lib/fsoat/trust-tier-observer.mjs              | 153 +++
 byon-orchestrator/scripts/lib/fsoat/utils/run-id.mjs                     |  51 +
 byon-orchestrator/scripts/lib/fsoat/worker-runner-adapter.mjs            | 213 +++
 byon-orchestrator/tests/integration/fsoat-runner.test.ts                 | 415 +++
 byon-orchestrator/tests/unit/fsoat-modules.test.ts                       | 366 +++
 docs/validation/FULL_SOURCE_ORGANISM_ACTIVATION_TEST.md                  | 456 +++
 20 files changed, 4671 insertions(+), 1 deletion(-)
```

## Artifacts integrated

Copied from `artifacts/full-source-organism-activation/2026-05-13T22-10-58-828Z-fsoat/` (patch did not include artifacts; manual copy) to:

`byon-orchestrator/test-results/full-source-organism-activation/2026-05-13T22-10-58-828Z-fsoat/`

Contents (output/):

- `verdict.json`
- `module-activation-matrix.json`
- `summary.md`
- `code-workspace-telemetry.json`
- `capability-experience.jsonl`
- `fce-state-deltas.jsonl`
- `mac-document-chain.jsonl`
- `structural-reference-telemetry.json`
- `trust-tier-telemetry.json`

Plus `audit_logs/`, `handoff/`, `keys/auditor.public.pem`, `project/` subdirs.

## Verdict artefact

```
final_verdict_line:   FSOAT_ACTIVATION_VERIFIED | FULL_LEVEL3_NOT_DECLARED
verdict_tokens:       ["FSOAT_ACTIVATION_VERIFIED", "FULL_LEVEL3_NOT_DECLARED"]
primary_verdict:      FSOAT_ACTIVATION_VERIFIED
level_3_declared:     false
operator_invariants:  theta_s = 0.28, tau_coag = 12, touched_by_run = false

activation_summary:
  active_count:       11
  inactive_count:     0
  not_applicable:     0
  active_organs: verbal_brain, macp_security_body, memory_substrate, trust_hierarchy,
                 immune_system, controlled_hands, capability_routing,
                 code_workspace_memory, compliance_post_check, receipt_assimilation,
                 structural_reference_memory

macp_chain_summary (both scenarios complete chain):
  S1_coding:           EvidencePack ✓ PlanDraft ✓ ApprovalRequest ✓ ExecutionOrder ✓ Receipt ✓  signed=1
  S2_trust_conflict:   EvidencePack ✓ PlanDraft ✓ ApprovalRequest ✓ ExecutionOrder ✓ Receipt ✓  signed=1

gates (8 / 9 PASS; G_NO_REGRESSION evaluated by `npm test` — see below):
  G_ORGANS:               PASS  (no inactive organs)
  G_MACP:                 PASS  (2 / 2 scenarios complete chain)
  G_SIGNATURE:            PASS  (signed=2, verified=2)
  G_AIRGAP:               PASS  (1 airgap event)
  G_TRUST:                PASS  (2 events)
  G_FCE_ADVISORY:         PASS  (2 events; advisory never lowers risk)
  G_RECEIPT_ASSIMILATION: PASS  (2 events)
  G_INVARIANTS:           PASS  (no violations)
  G_FORBIDDEN_TOKENS:     PASS  (zero forbidden hits)
```

## Post-integration test results

| Step | Result |
|---|---|
| `npm test` | **31 / 31 test files load, 697 / 697 tests pass** (matches package target) |
| `npm run build` | exit 0 |
| `npx tsc --noEmit` | exit 0 |

## Invariants re-verified after integration

| Constant | Value | Source |
|---|---:|---|
| `theta_s` | `0.28` | `byon-orchestrator/scripts/byon-coagulation-harness.mjs:254` |
| `tau_coag` | `12` | same file, line 255 |

Forbidden-token grep (`LEVEL_3_REACHED`, `OMEGA_CREATED_MANUALLY`, `SYNTHETIC_OMEGA`, `THRESHOLD_LOWERED`, etc.): present only inside **forbidden-token lists, rejection rubrics, and tests that assert their absence** — never as a positive claim.

## Caveat — what FSOAT does NOT prove

The runner was validated with a **vendored minimal in-memory FCE-M shim** under the `memory_engine_runtime` package (the file the patch modifies). It has NOT been validated against the **full v15.7a runtime** via `FCEM_MEMORY_ENGINE_ROOT`. Per operator brief, the permitted claim is therefore:

- ✓ `FSOAT_ACTIVATION_VERIFIED`
- ✗ Level 3
- ✗ Natural Omega
- ✗ full v15.7a FCE-M consolidation
- ✗ coding advantage

## What this integration deliberately does NOT do

- ✗ no merge to `main`
- ✗ no branch deletion
- ✗ no tag/release (only the protective `backup/pre-fsoat-integration-*` tag from Step 1)
- ✗ no Level 3 / Natural Omega declaration
- ✗ no coding-advantage claim
- ✗ no cleanup
- ✗ no modification of theta_s / tau_coag

## Next step recommended

Open a draft PR `integration/fsoat-full-source-organism-activation → main` for review. Do NOT merge automatically. The CI pipeline will re-execute `npm test` / `npm run build` / lint / Docker build against this branch on push. Wait for green CI before considering merge.
