# Changelog

All notable changes are recorded here, organised by phase.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased] — Phase 6: Developer Handoff

### Added
- `docs/ARCHITECTURE.md` — module map, data-flow diagram (ASCII), extension
  points, layer responsibilities.
- `docs/SECURITY.md` — threat model, trusted-vs-untrusted input table, full
  audit paragraph explaining how `policy_gate: bypass_all` is prevented.
- `docs/LIMITATIONS.md` — explicit list of what the engine does NOT do.
- `docs/EXAMPLES.md` — three worked examples with step-by-step expected output.
- `README.md` refreshed: "Run all tests" command at the top, docs table,
  exit-code table, role/gate table, full project layout.
- `CHANGELOG.md` consolidated from per-phase prose into this single file.

### Changed
- No functional code changes in this phase.  The docs were written to match
  the code exactly; where a docstring was absent or misleading it was updated
  to match observable behaviour.

---

## [0.4.0] — Phase 5: Bug Fix — skipped-blocks-dependents

### Fixed

**`skipped-blocks-dependents`** — SKIPPED step incorrectly blocked dependents.

**Severity:** High — incorrect workflow execution results.

**Symptoms**

A step whose `condition` evaluates to `False` is marked `SKIPPED`.  Any step
that listed the skipped step in `depends_on` was then marked `FAILED` /
`BLOCKED` instead of running normally.

Example:

```yaml
steps:
  - id: optional-scan
    action: scan
    condition:
      equals: { var: environment, value: production }
  - id: build
    action: build
    depends_on: [optional-scan]   # was BLOCKED in staging — now SUCCESS