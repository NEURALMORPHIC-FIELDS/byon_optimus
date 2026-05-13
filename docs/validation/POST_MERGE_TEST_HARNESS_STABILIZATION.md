# Post-merge test-harness stabilization

**Branch:** `fix/post-merge-test-harness-stabilization` (off `main` @ `c01959b`)
**Created:** 2026-05-13
**Trigger:** after PR #3 merge, `npm test` reported 489/489 tests pass but **3 test files failed to load** with `SyntaxError: Invalid or unexpected token`:

- `byon-orchestrator/tests/unit/level3-full-organism.test.ts`
- `byon-orchestrator/tests/unit/level3-structural-identity.test.ts`
- `byon-orchestrator/tests/unit/level3-structural-identity-full-organism.test.ts`

`npx tsc --noEmit` parsed all three cleanly. The error was therefore a Vitest / Vite loader issue, not a TypeScript syntax issue. The operator's directive was to make the post-merge test suite fully green **without weakening tests, skipping, or changing BYON runtime behaviour**.

---

## Captured tooling versions

| Tool | Version |
| --- | --- |
| Node.js | v24.13.0 |
| npm | 11.6.2 |
| vitest | 4.0.18 (declared `^4.0.18` in `package.json`) |
| vite (transitive via vitest) | 7.3.1 |
| typescript | 5.9.3 |

`package.json` has been pinned at `vitest: ^4.0.18` since the initial repo commit, so this is **not a version drift from when commit 17 reported "586 / 586 pass"** — the same Vitest 4.0.18 was in place then.

## Root cause

The error message reported by Vitest 4 — `SyntaxError: Invalid or unexpected token` — was misleading. After bisecting with isolated probe tests, the actual error surfaced from `vite:import-analysis` and pointed at line 1, column 0 of `byon-orchestrator/scripts/byon-industrial-ab-benchmark.mjs`:

```
1 | #!/usr/bin/env node
  | ^
```

Vite's `vite:import-analysis` plugin does **not** strip a leading shebang from `.mjs` files before parsing them for import analysis. Node.js *does* strip the shebang natively at runtime, so direct `node script.mjs` execution and `node -e "import('./script.mjs')"` both work without issue (verified). But Vitest 4's worker, which uses Vite's transform pipeline, rejects the file before any code runs.

The 3 failing tests all transitively import a chain of `.mjs` runners that ultimately load `byon-industrial-ab-benchmark.mjs`:

```
level3-full-organism.test.ts
  └─ ../../scripts/level3-full-organism-live-runner.mjs (has shebang)

level3-structural-identity.test.ts
  └─ ../../scripts/level3-structural-identity-runner.mjs (has shebang)

level3-structural-identity-full-organism.test.ts
  └─ ../../scripts/level3-structural-identity-full-organism-runner.mjs (has shebang)
      └─ ../../scripts/byon-industrial-ab-benchmark.mjs (has shebang)
```

Every `.mjs` in this chain begins with `#!/usr/bin/env node`. Vite/Vitest 4 rejects the first one it touches via `vite:import-analysis`.

### Why this worked before but doesn't now

The commit 17 claim of "586 / 586 pass" was made on the research branch `research/level3-full-organism-runtime` *before* it was merged into `main` via PR #3. The vitest config / package.json have not been touched between then and now, but it is possible the on-disk `node_modules` (and hence the exact Vite minor version, the prebuilt `node_modules/.vite` cache, or some transient state) differed. With the current install (vitest 4.0.18 → vite 7.3.1) the shebang trips the import-analysis pass.

This is recorded here for honest provenance: the regression appeared at post-merge install time, not from any benchmark or commit-17 code change.

## Fix — minimal and non-weakening

### Fix 1: tiny `stripShebangPlugin` in `vitest.config.ts`

A read-only Vite plugin that runs **before** `vite:import-analysis` (`enforce: "pre"`) and, for any `.mjs` file whose first two bytes are `#!`, replaces the shebang line with a JS line comment (same length, same line count, identical byte semantics for everything after the first line). It does **not** write to disk and does **not** modify the file on Linux/macOS where `node script.mjs` still strips the shebang natively at runtime.

```ts
const stripShebangPlugin = {
    name: "strip-mjs-shebang",
    enforce: "pre" as const,
    load(id: string) {
        if (!id.endsWith(".mjs")) return null;
        // ...read file, if starts with "#!", replace with "//" prefix on the same first line...
    },
};

export default defineConfig({
    plugins: [stripShebangPlugin],
    test: { /* unchanged */ },
});
```

This is the *Allowed fixes / update Vitest config for v4 compatibility* category in the operator directive. It does **not**:

- skip any test
- delete any test file
- weaken any assertion
- change `theta_s` / `tau_coag`
- touch Omega / ReferenceField logic
- modify any BYON runtime file
- modify any benchmark artifact

### Fix 2: ESM-correct `__dirname` in the 3 test files

While bisecting, I also found that all 3 test files used the CommonJS global `__dirname` — undefined in ES modules — at the top:

```ts
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
```

The package is `"type": "module"`, so `__dirname` is technically a `ReferenceError` at runtime in ESM context. Adding the standard ESM shim — a 2-line change at the top of each file — makes the tests robust to future loader changes that no longer inject a CommonJS-compat shim:

```ts
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
```

This change is also in the *Allowed fixes / adjust test file ... unsupported syntax* category. The semantics of `PROJECT_ROOT` are identical before and after.

## Files changed

| File | Change |
| --- | --- |
| `byon-orchestrator/vitest.config.ts` | +33 lines (plugin + import) — no `test:` config change |
| `byon-orchestrator/tests/unit/level3-full-organism.test.ts` | +4 lines (fileURLToPath import + shim) |
| `byon-orchestrator/tests/unit/level3-structural-identity.test.ts` | +4 lines (fileURLToPath import + shim) |
| `byon-orchestrator/tests/unit/level3-structural-identity-full-organism.test.ts` | +4 lines (fileURLToPath import + shim) |

**No** changes to:

- any `.mjs` script
- any source file under `src/`
- `package.json` / `package-lock.json`
- any benchmark artifact under `byon-orchestrator/test-results/`
- any `docs/validation/` doc (this new doc is additive)

## Verification

| Command | Before fix | After fix |
| --- | --- | --- |
| `npm test` (full suite) | 489 / 489 tests pass, **3 test files fail to load** (`SyntaxError: Invalid or unexpected token`) | **586 / 586 tests pass, 27 / 27 test files load** |
| `npm run build` (`tsc -p tsconfig.json`) | exit 0 | exit 0 |
| `npx tsc --noEmit` | exit 0 | exit 0 |

## Untracked smoke-run dirs (3 found, intentionally left in place)

Classification per operator directive:

| Path | Items | Verdict | Status |
| --- | ---: | --- | --- |
| `byon-orchestrator/test-results/full-organism-capability-benchmark/2026-05-13T09-49-13-727Z-1fiamw/` | 3 | `NO_CLEAR_USER_VALUE_ADVANTAGE` | broken intermediate (B cost = $0; pre-env-bootstrap fix) |
| `byon-orchestrator/test-results/full-organism-capability-benchmark/2026-05-13T09-50-52-781Z-5od2u/` | 2 | `MEMORY_ADVANTAGE_NOT_PROVEN` | broken intermediate (B cost = $0; pre-env-bootstrap fix) |
| `byon-orchestrator/test-results/full-organism-capability-benchmark/2026-05-13T09-55-02-152Z-4tgix/` | 3 | `MEMORY_ADVANTAGE_NOT_PROVEN` | last smoke probe before the canonical full run |

All three are:

- broken intermediate run artifacts (the first two have B-cost = $0 because the smoke run preceded the `_env-bootstrap.mjs` fix that loads `.env` before importing `byon-industrial-ab-benchmark.mjs`),
- not part of the canonical benchmark (the canonical run is `2026-05-13T09-57-20-343Z-b39uv/`, which is fully committed),
- not committed,
- not required for reproducibility.

**Chosen handling — Option A:** leave them untracked, document here.

Rationale for not picking the other options:

- **Option B (move outside repo)** would require explicit operator approval and is not justified — the dirs are small (a few hundred KB total) and not interfering with anything.
- **Option C (add ignore rule)** would risk the ignore pattern also hiding the canonical run dir (which IS committed) or future legitimately committed runs. The current pattern (timestamp-rand-suffix) cannot be cleanly distinguished from the canonical run pattern.

No deletion is performed. Operator can delete these manually at any time without losing canonical data.

## Acceptance criteria — confirmed

| # | Criterion | Result |
| --- | --- | :---: |
| 1 | `npm test` completes with zero failed test files and zero load errors | **27 / 27 files pass, 586 / 586 tests pass** ✓ |
| 2 | `npm run build` passes | exit 0 ✓ |
| 3 | `npx tsc --noEmit` passes | exit 0 ✓ |
| 4 | The 3 previously failing files load and execute | all 3 load; 97 tests run inside them ✓ |
| 5 | No benchmark results edited | `byon-orchestrator/test-results/full-organism-capability-benchmark/2026-05-13T09-57-20-343Z-b39uv/` untouched ✓ |
| 6 | No Level 3 claim introduced | none ✓ |
| 7 | No tests skipped to fake success | `.skip` count unchanged; no `test.todo` introduced ✓ |
| 8 | No cleanup or branch deletion performed | only the local `tmp/merge-validation-into-current-main` deletion done **earlier** by direct operator authorisation; nothing in this fix touched any branch ✓ |

## Hard isolation re-confirmed

- `theta_s = 0.28` — unchanged
- `tau_coag = 12` — unchanged
- no manual `OmegaRegistry.register` / `OmegaRecord` / `ReferenceField` / `is_omega_anchor`
- all 7 structural seeds remain `origin=operator_seeded`
- `level_3_declared = false`
- no benchmark rerun
- no Claude API call
- no memory-service started
- no new tag / release
- none of the forbidden verdict tokens (`LEVEL_3_REACHED`, `OMEGA_CREATED_MANUALLY`, `SYNTHETIC_OMEGA`, `THRESHOLD_LOWERED`, `CANONICAL_WITHOUT_BENCHMARK`, `CLEANUP_BEFORE_CANONIZATION`) appear in any file touched by this fix

## Verdict

`POST_MERGE_TEST_HARNESS_STABLE — 586/586 TESTS PASS`

Awaiting operator review of this fix branch.
