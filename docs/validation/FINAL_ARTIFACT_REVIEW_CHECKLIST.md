# Final artifact review checklist — Full-Organism Capability Benchmark

**Run id:** `2026-05-13T09-57-20-343Z-b39uv`
**Run branch:** `validation/full-organism-capability-benchmark` @ `d09e45a`
**Branched from:** `research/level3-full-organism-runtime` @ `0c0e1f1` (commit 17)
**Checklist created:** 2026-05-13
**Status:** **FROZEN — no edits, no rerun unless operator explicitly requests.**

The benchmark passed the operator-mandated gatekeeper. This checklist is the
artifact-freeze record. Each item is a binary statement about what exists on
disk right now and what was verified at run time. Nothing below is editable
without explicit operator authorisation.

| # | Check | Path / value | Status |
| --- | --- | --- | :---: |
| 1 | Protected baseline document exists | [docs/validation/00_PROTECTED_BASELINE.md](00_PROTECTED_BASELINE.md) (3831 bytes) | ✓ |
| 2 | Regression matrix document exists | [docs/validation/REGRESSION_MATRIX.md](REGRESSION_MATRIX.md) (878 bytes) | ✓ |
| 3 | Canonization approval report exists | [docs/validation/CANONIZATION_APPROVAL_REPORT.md](CANONIZATION_APPROVAL_REPORT.md) (1148 bytes) | ✓ |
| 4 | Benchmark markdown report exists | `byon-orchestrator/test-results/full-organism-capability-benchmark/2026-05-13T09-57-20-343Z-b39uv/report.md` (7019 bytes) | ✓ |
| 5 | `summary.json` exists | same dir / `summary.json` (4777 bytes) | ✓ |
| 6 | `module-activation-matrix.json` exists | same dir / `module-activation-matrix.json` (7451 bytes) | ✓ |
| 7 | `per-item-scores.json` exists | same dir / `per-item-scores.json` (198 553 bytes) | ✓ |
| 8 | `capability-deltas.json` exists | same dir / `capability-deltas.json` (2633 bytes) | ✓ |
| 9 | `regression-matrix.json` exists | same dir / `regression-matrix.json` (1864 bytes) | ✓ |
| 10 | Condition A raw outputs exist | same dir / `condition-a-claude-direct.jsonl` (78 969 bytes, 100 rows) | ✓ |
| 11 | Condition B raw outputs exist | same dir / `condition-b-byon-full-organism.jsonl` (302 162 bytes, 100 rows) | ✓ |
| 12 | Judge scoring outputs exist (embedded per-item) | same dir / `per-item-scores.json` (carries `a_raw_scores` and `b_raw_scores` from judge for every item) | ✓ |
| 13 | All 7 acceptance gates PASS | `summary.json::gates.gate_1..gate_7.pass === true` | ✓ |
| 14 | BYON > Claude direct by > +15 % | `summary.json::overall_delta_pct = 34.94 %` (gate_1 threshold +15 %) | ✓ |
| 15 | No Level 3 claim | suffix `FULL_LEVEL3_NOT_DECLARED`; verdict `BYON_OUTPERFORMS_CLAUDE_DIRECT`; gate_6 explicit | ✓ |
| 16 | No manual Omega | gate_6 `omega_created_manually = false`; `module-activation-matrix.json::omega_registry_snapshot.active = false` (honest inactive, no manual register) | ✓ |
| 17 | theta_s = 0.28 unchanged | gate_6 `theta_s = 0.28`; FCE-M config untouched in this run | ✓ |
| 18 | tau_coag = 12 unchanged | gate_6 `tau_coag = 12`; FCE-M config untouched in this run | ✓ |
| 19 | Category K loss documented as trade-off, not regression | Commit message + `report.md` per-category table note K winner=A (-27.8 %). Not in `REGRESSION_MATRIX.md` because K was never a previously validated capability. Recorded as a structural-constraint vs creative-latitude trade-off. | ✓ |
| 20 | Canonization approval remains subject to operator final review | `docs/validation/CANONIZATION_APPROVAL_REPORT.md` final line: "subject to operator final review". No automatic merge / tag / release performed. | ✓ |

## Auxiliary artifact freeze (not on the 20-item list, but part of the run)

- `run-config.json` — full run configuration snapshot (2356 bytes) ✓
- `byon-orchestrator/scripts/byon-full-organism-capability-benchmark.mjs` — runner ✓
- `byon-orchestrator/scripts/lib/full-organism-capability-test-bank.mjs` — 100-item bank ✓
- `byon-orchestrator/scripts/lib/_env-bootstrap.mjs` — env loader (no dotenv dep) ✓

## Remote protection state (verified after push)

- `validation/full-organism-capability-benchmark` pushed to origin: `d09e45af39c29dbf0545311305245fab9352d508`
- Backup tags pushed to origin:
  - `backup/pre-validation-20260513T092621Z/main` → `15a7c478afcb394169ed74d89060bd494c8ea169`
  - `backup/pre-validation-20260513T092621Z/master` → `15a7c478afcb394169ed74d89060bd494c8ea169`
  - `backup/pre-validation-20260513T092621Z/research-level3-full-organism-runtime` → `0c0e1f1eded35cfd53667c2f6b4a2005b13e3ca2`
  - `backup/pre-validation-20260513T092621Z/research-level-3-natural-omega` → `ef689e935d68336e84f01955232132a5008294ab`
  - `backup/pre-validation-20260513T092621Z/backup-legacy-remote-main` → `79aac3471dec0477a6b9b1708a713f3ffd51afd3`
- No pre-existing tag was overwritten (all five pushed as `[new tag]`).
- `main` and `origin/main` both at `15a7c47` — untouched.
- No release created. No public tag created.

## Hard rules still in force

- Do NOT merge to `main`.
- Do NOT delete any research branch.
- Do NOT delete `test-results/`.
- Do NOT rewrite README.
- Do NOT archive code.
- Do NOT remove runners.
- Do NOT create a canonical capsule.
- Do NOT create a public release tag.
- Do NOT declare Level 3.
- Do NOT edit benchmark results.
- Do NOT rerun the benchmark without explicit operator authorisation.

## Verdict (operator-accepted)

- `BYON_OUTPERFORMS_CLAUDE_DIRECT`
- `FULL_LEVEL3_NOT_DECLARED`
- `CANONIZATION_APPROVED — subject to operator final review`
