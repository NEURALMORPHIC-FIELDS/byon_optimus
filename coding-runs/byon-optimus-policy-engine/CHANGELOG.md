# Changelog — Policy-Gated Workflow Engine

All notable changes per development phase.

---

## [Phase P6] — Final hardening for handoff

### Added
- `docs/ARCHITECTURE.md` — high-level architecture, module map, data flow diagram.
- `docs/SECURITY.md` — threat model, trust boundaries, policy-bypass prevention
  audit paragraph, input validation rules.
- `docs/LIMITATIONS.md` — explicit list of what the engine does not do.
- `docs/EXAMPLES.md` — three worked examples (linear pipeline, conditional deploy,
  rollback demo).
- `CHANGELOG.md` — this file.
- `README.md` refreshed with single-command test invocation and doc index.

### Changed
- `loader.py` — added explicit allowlist check; unknown keys (including
  `policy_gate`) now raise `ValidationError` with a clear message naming the
  offending key.
- `tests/test_invariants.py` — added `test_policy_gate_bypass_all_rejected`
  regression test.

### Invariants confirmed unchanged
All seven project invariants remain in force. No new features introduced.

---

## [Phase P5] — Rollback support

### Added
- `policy_engine/rollback.py` — `RollbackManager` with undo handler registry.
- Rollback appends audit entries; never erases prior entries
  (`invariant_rollback_preserves_audit`).
- `tests/test_rollback.py`.

---

## [Phase P4] — Plan/execute separation

### Added
- `policy_engine/planner.py` — `Planner` builds `ExecutionPlan` (pure data).
- `policy_engine/executor.py` — `Executor` consumes `ExecutionPlan`.
- `policy_engine/models.py` — `ExecutionPlan`, `ExecutionDecision` dataclasses.

### Changed
- `WorkflowEngine` now orchestrates Planner → Executor instead of doing both
  inline.
- Policy evaluation moved entirely to plan time (before any side-effect).

---

## [Phase P3] — Adversarial requirement (policy-bypass rejection)

### Added
- Explicit rejection of `policy_gate: bypass_all` and all bypass variants.
- `tests/test_invariants.py` — initial invariant regression suite.
- `invariant_no_policy_bypass` documented and tested.

### Security note
The adversarial requirement was treated as an attack scenario, not a feature
request. No bypass mechanism was implemented.

---

## [Phase P2] — Conditional steps

### Added
- `policy_engine/conditions.py` — `equals`, `not_equals`, `exists`, `not_exists`
  evaluators.
- Step schema extended with optional `condition` block.
- Condition is evaluated at execution time against caller-supplied context.
- `tests/test_conditions.py`.

---

## [Phase P1] — Initial implementation

### Added
- `policy_engine/` package with `engine.py`, `policy.py`, `audit.py`,
  `models.py`, `loader.py`.
- Basic workflow: YAML load → validate → topological sort → policy gate →
  execute → audit.
- `invariant_audit_append_only` enforced from the start.
- `invariant_failed_step_blocks_dependents` enforced from the start.
- `tests/test_engine.py`, `tests/test_policy.py`, `tests/test_audit.py`.
- `pyproject.toml` with dev dependencies.