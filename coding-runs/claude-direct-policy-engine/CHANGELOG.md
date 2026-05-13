# Changelog

All notable changes to `policy-gated-workflow-engine` are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added
- `docs/ARCHITECTURE.md` — module inventory, data-flow diagrams, key design
  decisions, invariant enforcement map.
- `docs/SECURITY.md` — threat model, trusted-vs-untrusted input table,
  step-by-step explanation of how `bypass_all` in YAML is prevented,
  production gate and audit log security properties.
- `docs/LIMITATIONS.md` — 12 explicit limitations (no real execution, no
  persistence, no parallelism, etc.).
- `docs/EXAMPLES.md` — 6 worked examples with full CLI output.
- `examples/conditional_pipeline.yaml` — runnable environment-aware pipeline.
- `CHANGELOG.md` (this file).
- Refreshed `README.md` with single-command test instructions and links to all
  docs.

### Changed
- No public API changes in this phase.

---

## [0.2.1] — Phase 4: Skip-propagation bug fix

### Fixed
- **Critical**: A SKIPPED step (condition evaluated to False) was incorrectly
  causing downstream dependent steps to be BLOCKED or FAILED.

  **Root cause**: The engine relied on a single `failed_ids` set to track all
  non-successful steps.  When a step was skipped, it was not added to
  `failed_ids`, which was correct — but the structural guarantee was implicit
  and fragile.  Specifically, the Planner's `bad_ids` set and the engine's
  blocking check both needed to be verified to never include skipped steps.

  **Fix**: Introduced an explicit `skipped_ids: Set[str]` in both
  `WorkflowEngine.run()` and `Planner.build()`.  The blocking check now
  reads:

  ```python
  blocking = [
      dep for dep in step.depends_on
      if dep in failed_ids
      and dep not in skipped_ids   # belt-and-suspenders invariant assertion
  ]