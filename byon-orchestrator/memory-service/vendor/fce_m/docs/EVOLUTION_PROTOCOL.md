# Evolution Protocol — FCE-Ω + UFME integrated project

This document codifies how the integrated project evolves stage by stage.
It is the single source of truth for what "make progress" means in this
repo. The protocol exists to keep the morphogenetic layer honest: it
must observe and measure, never decide truth.

## 1. Architectural formula (red lines)

These hold across every release. A change that touches them is rejected
on principle, regardless of how convenient or "almost-passing" it is.

```
UFME            gestionează memoria
D_Cortex        verifică adevărul
FCE-Ω           măsoară asimilare, reziduu, coagulare, referință
Omega Registry  păstrează ireversibilitatea coagulării
Advisory        recomandă; NU suprascrie
```

Operational corollaries:

- FCE-Ω never alters slot zone, value, or epistemic status in the
  runtime adapter. The bridge translates UFME events into FCE
  observations; the inverse direction is forbidden in passive mode.
- `OmegaRecord` is immutable after registration on the
  `omega_id` / `coagulated_at_episode` / `S_t_at_coagulation` /
  `kappa_at_coagulation` axes. Only `expression_state` may transition,
  and only through `mark_active` / `mark_contested` / `mark_inexpressed`
  on an already-existing record.
- Tests do not synthesise an Omega manually unless they are testing
  registry internals. Coagulation must arise from the threshold rule
  (`S_t >= theta_s for tau_coag consecutive cycles`).
- `vendor/fce_omega_source/` is read-only. Modifications require an
  explicit justification in the CHANGELOG and in a comment at the
  modification site.
- Advisory hints (`fce_advisory_hints()` and successors) return
  inspectable suggestions only. Calling them must produce zero side
  effects on runtime / tf_engine / d_cortex.

## 2. Stage discipline

Evolution proceeds in discrete stages. Each stage carries a version,
short_name, and ordinal (`etapa_NN`). The unit of work between two
user-visible checkpoints is exactly one stage.

```
ETAPA 0  Baseline lock
ETAPA 1  v0.4.1  Center-Isolated Anchor
ETAPA 2  v0.4.2  Integrated R10b Reproduction
ETAPA 3  v0.5.0  Multiperspectival Observer
ETAPA 4  v0.5.1  Semi-Active Advisory Feedback
ETAPA 5  v0.6.0  Native Memory Prototype
```

The default cycle per stage:

```
1. Baseline lock        run pytest, confirm previous totals stay green
2. Implement            minimal, focused change set
3. Tests                add failure-mode + non-regression tests
4. Pytest               full suite must pass
5. Stage finalize       python tools/stage_finalize.py
6. Report to user       strict format, see section 5
7. STOP                 wait for user confirmation before next stage
```

If any step fails the criterion, do NOT proceed; investigate and report.

## 3. The "do not dilute the model" rule

When a test fails, classify the failure before touching any code:

| Failure cause                                       | Right action                                                     |
|-----------------------------------------------------|-------------------------------------------------------------------|
| Test asserted on a misleading axis                  | Fix the test, switch to the right axis, comment why               |
| Test crossed a mission invariant                    | Delete the test; mission wins                                     |
| Model regressed against an earlier-confirmed truth  | Fix the model; the test stays                                     |
| Numerical drift inside expected tolerance           | Tighten the model first; relax tolerance only with justification  |

Concrete examples already in the codebase:

- `test_04_assimilation_vs_residue.py` originally asserted
  `conflicting.Z_norm > coherent.Z_norm`. That fails because coherent
  residues sum in the stable `direction` while conflicting residues
  orthogonalize and partially cancel. The right axes are AR and κ; the
  test was rewritten to assert on those, with a comment explaining
  why Z_norm is not a reliable discriminator.
- `test_09_directed_interaction.py::test_observer_centers_are_isolated_in_v0_4_0`
  originally tolerated `< 5%` drift between solo and mixed runs (the
  v0.4.0 global anchor leaked). In v0.4.1 the coupling channel was
  removed, and the same test now asserts bitwise equality. The fix was
  in the model (per-center anchor), not in the test's tolerance.

## 4. Per-stage artifact contract

Each completed stage writes its artifacts into
`results/etapa_<NN>_<version>_<short_name>/`. The folder name uses
underscores, never spaces, never the package name. At minimum each
folder contains:

```
results/etapa_<NN>_<version>_<short_name>/
├── pytest_full.txt         python -m pytest -v --tb=short
├── pytest_summary.txt      python -m pytest -q --tb=no (tail)
├── report.txt              tools/fce_functional_report.py output
├── report.json             same, machine-readable
├── manifest.json           structured stage metadata (see schema below)
└── CHANGELOG_slice.md      the CHANGELOG entry for this version
```

The top-level `results/` keeps "latest" snapshots
(`fce_functional_report.txt`, `pytest_full_transcript.txt`) so a
reader who lands on the repo without context can still see the
current state.

### `manifest.json` schema

```json
{
  "etapa": "01",
  "version": "v0.4.1",
  "short_name": "center_isolated_anchor",
  "date": "2026-05-11",
  "previous_total_tests": 213,
  "new_total_tests": 222,
  "tests_added": [
    "tests/fce_omega_functional/test_16_center_isolated_anchor.py (8 tests)",
    "tests/fce_omega_functional/test_10 (+1 test)"
  ],
  "files_modified": [
    "unified_fragmergent_memory/bridges/fce_translator.py",
    "unified_fragmergent_memory/runtime/fce_omega_observer.py",
    "..."
  ],
  "capabilities_confirmed": ["per-center anchor", "bitwise isolation", "..."],
  "limitations_remaining": ["in-episode aggregation", "..."],
  "integration_mode": "passive_with_advisory",
  "invariants_preserved": true,
  "notes": "free-form, optional"
}
```

`integration_mode` is one of:
- `passive` — observer never alters anything, hints not even exposed
- `passive_with_advisory` — passive + read-only `advisory_hints()`
- `semi_active` — advisory may influence priorities/queues, never truth
- `active` — feedback loops touch routing decisions (NOT a target for
  this project — listed for completeness)

## 5. Reporting format

After each stage, report to the user in this strict layout:

```
## ETAPA N — v<X.Y.Z> <ShortName>

### Files modified
<bulleted file list>

### Tests added
<file: test count>

### Total pytest
<NNN passed>

### Capabilities confirmed
- ...

### Limitations remaining
1. ...

### Integration mode
passive | passive_with_advisory | semi_active

### Formula arhitecturală
respected (UFME memory, D_Cortex truth, FCE-Ω becoming, Omega
irreversibility, advisory recommends only)
```

Then STOP. Do not start the next stage until the user confirms.

## 6. Tooling

- `tools/fce_functional_report.py` — generates the workload-driven
  report. Stable interface (`--out`, `--json`).
- `tools/stage_finalize.py` — orchestrator that runs pytest, writes
  the per-stage subfolder, builds `manifest.json`, slices the
  CHANGELOG entry. Single command per stage end:
  ```
  python tools/stage_finalize.py --etapa 01 --version v0.4.1 \
      --short-name center_isolated_anchor
  ```

## 7. What this protocol explicitly forbids

- Skipping baseline before a change
- Chaining multiple stages in one go
- Modifying vendor source without justification
- Setting Omega manually in non-registry tests
- Adding feedback that writes back to UFME without a feature flag
  defaulted to off and gated tests
- Re-introducing nested redundant folders (e.g.,
  `unified-fragmergent-memory-engine/` inside the workspace)
- Deleting old stage subfolders to "save space" — they are the
  authoritative history of the project's evolution

## 8. What it explicitly allows

- Reorganizing the layout when it removes confusion (e.g. lifting
  contents to workspace root when the workspace name IS the project's
  identity)
- Reformulating a test when the assertion axis turns out to be wrong
- Adding new advisory `kind` values, as long as they remain read-only
- Documenting known coupling channels honestly rather than asserting
  isolation that doesn't hold

The point of the protocol is to evolve fast WHEN it's safe and slow
DOWN at every red line. Stages are checkpoints, not stretches; reports
are the audit trail.
