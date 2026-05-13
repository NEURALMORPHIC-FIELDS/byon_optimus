# Redundancy removal report

**Branch:** `cleanup/canonical-docs-and-redundancy-removal`
**Inventory source:** `docs/cleanup/REDUNDANCY_INVENTORY.md`
**Rule in force:** *"Nu șterge cod doar pentru că pare vechi. Demonstrează că este nefolosit."*

## What was removed

| Removed path | Why removed | Safe because | Replacement / canonical source |
| --- | --- | --- | --- |
| `byon-orchestrator/test-results/full-organism-capability-benchmark/2026-05-13T09-48-41-058Z-164hl9/` | empty probe directory (no `summary.json`, no items) — first probe before the path setup was correct | not committed (untracked); no consumer in any test, runner, doc, or CI workflow | the canonical run is `2026-05-13T09-57-20-343Z-b39uv/` |
| `byon-orchestrator/test-results/full-organism-capability-benchmark/2026-05-13T09-49-13-727Z-1fiamw/` | 3-item smoke probe; `B-cost = $0` because `_env-bootstrap` had not loaded `.env` yet → Claude calls never happened in Condition B; verdict `NO_CLEAR_USER_VALUE_ADVANTAGE` is meaningless | not committed (untracked); explicitly listed as a "broken intermediate" in the post-merge stabilization doc; no test or doc references its run_id | canonical run `2026-05-13T09-57-20-343Z-b39uv/` |
| `byon-orchestrator/test-results/full-organism-capability-benchmark/2026-05-13T09-50-52-781Z-5od2u/` | 2-item smoke probe; `B-cost = $0`; same env-bootstrap defect | same as above | canonical run `2026-05-13T09-57-20-343Z-b39uv/` |
| `byon-orchestrator/test-results/full-organism-capability-benchmark/2026-05-13T09-55-02-152Z-4tgix/` | 3-item smoke probe (last one before the canonical run); `B-cost = $0.054` but only 3 items so verdict is `MEMORY_ADVANTAGE_NOT_PROVEN` by construction | same as above | canonical run `2026-05-13T09-57-20-343Z-b39uv/` |

**Total deletions:** 4 directories. All four were untracked in git (never committed). No `git rm` was used; only `rm -rf` against untracked files. No commit history is rewritten.

## What was kept (against operator's "keep if unsure" rule)

### Canonical benchmark artefacts — kept entirely

```
byon-orchestrator/test-results/full-organism-capability-benchmark/2026-05-13T09-57-20-343Z-b39uv/
  ├── capability-deltas.json
  ├── condition-a-claude-direct.jsonl
  ├── condition-b-byon-full-organism.jsonl
  ├── module-activation-matrix.json
  ├── per-item-scores.json
  ├── regression-matrix.json
  ├── report.md
  ├── run-config.json
  └── summary.json
```

### Validation docs — kept entirely

```
docs/validation/
  ├── 00_PROTECTED_BASELINE.md
  ├── CANONIZATION_APPROVAL_REPORT.md
  ├── FINAL_ARTIFACT_REVIEW_CHECKLIST.md
  ├── POST_MERGE_TEST_HARNESS_STABILIZATION.md
  └── REGRESSION_MATRIX.md
```

### Research-trail test-results — kept

- `byon-orchestrator/test-results/level3-full-organism-live/*` (8 commit-15 era runs)
- `byon-orchestrator/test-results/level3-structural-identity/*` (2 commit-16 era runs)
- `byon-orchestrator/test-results/level3-structural-identity-full-organism/2026-05-13T08-58-51-831Z-71533158/` (commit-17 canonical structural-identity run referenced in the commit message)

These directories are committed and form the research trail. Each is referenced by its corresponding test file (`level3-*.test.ts`) which now loads and runs after PR #4.

### Code — kept

Zero files deleted under `byon-orchestrator/scripts/`, zero under `byon-orchestrator/scripts/lib/`, zero under `byon-orchestrator/tests/`, zero under `byon-orchestrator/memory-service/`. Two scripts flagged `REVIEW_NEEDED` (no consumers found in tests, runtime, or docs) but **not** deleted, pending operator confirmation:

- `byon-orchestrator/scripts/architecture-verify.mjs`
- `byon-orchestrator/scripts/byon-chat-once.mjs`

### Docs — kept

Zero existing doc files were deleted. The validated documentation set was *added to*, not pruned. See `docs/cleanup/REDUNDANCY_INVENTORY.md` Section E for the full list.

### Backup tags — kept

All 5 `backup/pre-validation-20260513T092621Z/*` tags remain on local + origin.

### Branches — kept

No branch (local or remote) was deleted by this cleanup. Earlier in the validation sequence the local-only `tmp/merge-validation-into-current-main` was deleted by direct operator authorisation — that action is **not** part of this cleanup pass.

## What was created / updated

### New canonical docs

- `docs/LEVEL_STATUS.md` — short operational-level statement
- `docs/MEMORY_MODEL.md` — trust tiers and memory categories
- `docs/STRUCTURAL_REFERENCE_MEMORY.md` — the seven operator-seeded references and what is / isn't proven
- `docs/RUNTIME.md` — practical runtime guide; commands that do NOT auto-run benchmark or call Claude
- `docs/VALIDATION_SUMMARY.md` — end-to-end record of PR #3 + PR #4
- `docs/cleanup/REDUNDANCY_INVENTORY.md` — pre-deletion audit
- `docs/cleanup/REDUNDANCY_REMOVAL_REPORT.md` — this file

### Updated docs

- `README.md` — current status, validation summary, pointers
- `docs/ARCHITECTURE.md` — refreshed to reflect post-commit-17 + benchmark state; MACP description preserved

## Acceptance criteria (operator-stated)

| # | Criterion | Result |
| --- | --- | :---: |
| 1 | Canonical benchmark intact | b39uv directory + 9 files present and tracked ✓ |
| 2 | Validated code intact | zero `.mjs` / `.ts` / `.py` deletion under `byon-orchestrator/` ✓ |
| 3 | `npm test` passes | see Phase 7 of the commit ✓ |
| 4 | `npm run build` passes | see Phase 7 of the commit ✓ |
| 5 | `npx tsc --noEmit` passes | see Phase 7 of the commit ✓ |
| 6 | Docs reflect the validated model | 7 new / updated canonical docs ✓ |
| 7 | Docs do not present fragmented history as architecture | new docs are status-of-now; research-history docs untouched ✓ |
| 8 | No Level 3 claim | none introduced; forbidden tokens absent as positive claims ✓ |
| 9 | No branch deletion | no remote branch deleted; no local branch deleted in this cleanup ✓ |
| 10 | No release / tag | none created ✓ |
