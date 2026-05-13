# Changelog

All notable changes to `policy-gated-workflow-engine` are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

---

## [0.4.0] — Phase 4: Bug Fix — SKIPPED steps no longer block dependents

### Fixed
- **Critical engine bug**: a workflow step whose upstream dependency was
  `SKIPPED` (via a false condition) was incorrectly treated as having a
  *failed* predecessor and was itself marked `BLOCKED` or `FAILED`.
- Root cause: `StepStatus.SKIPPED` was absent from `_SATISFIED` in a
  code path reachable via `deps_satisfied()`; simultaneously the planner's
  `_PLANNER_BLOCKING_DECISIONS` set implicitly included `SKIP` by omission.
- Fix in `engine.py`: `_SATISFIED` and `_BLOCKING` are now `frozenset`
  constants with an import-time disjointness assertion.  `SKIPPED ∈
  _SATISFIED`, `SKIPPED ∉ _BLOCKING`.
- Fix in `planner.py`: introduced explicit `_PLANNER_BLOCKING_DECISIONS`
  frozenset.  `StepDecision.SKIP` is documented as absent.

### Added
- `tests/test_regression_skipped_unblocks_dependents.py` — 18 regression
  tests covering engine predicates, end-to-end flows, and planner
  predictions for every skip/fail/block combination.

### Invariants verified
- `invariant_failed_step_blocks_dependents` — still holds; only
  `FAILED`/`BLOCKED` trigger downstream blocking.
- `invariant_audit_append_only` — no change.

---

## [0.3.0] — Phase 3: Execution Planning

### Added
- `src/policy_engine/planner.py` — three new collaborators:
  - `ExecutionPlan` — frozen dataclass; ordered list of `StepPlan` entries
    with predicted decisions and policy results.
  - `Planner` — builds an `ExecutionPlan` from a `Workflow` + `PolicyGate`
    without executing anything and without writing audit entries.
  - `PlanValidator` — validates a plan against policies and structural
    invariants; returns `ValidationResult` with typed `ValidationIssue` list.
  - `PlanRenderer` — renders a plan as human-readable text (with optional
    ANSI colour) or machine-readable `dict`.
- `StepDecision` enum — `RUN | SKIP | SKIP_CONDITION_UNKNOWN | BLOCK | DENY
  | UNKNOWN`.
- `PolicyResult` enum — `ALLOW | DENY | OVERRIDE | NO_GATE | UNKNOWN`.
- CLI subcommand `workflow plan <file>` — prints plan, exits non-zero (3)
  when validation errors are present.  Supports `--output-format json`.

### Changed
- `WorkflowEngine` and `RollbackManager` public APIs are **unchanged**.
- `ExecutionContext` is now documented as internal.
- `cli.py`: `_add_run_args()` helper deduplicates shared flags between
  `run` and `plan` subcommands.

### Invariants verified
- Planning is read-only — no audit entries written during `Planner.build()`.
- Policy gates probed via `_probe_gate()` which bypasses the audit-writing
  path of `PolicyGate.evaluate()`.

---

## [0.2.0] — Phase 2: Conditional Steps

### Added
- `src/policy_engine/conditions.py` — condition expression evaluator.
  - Operators: `equals`, `not_equals`, `in`, `not_in`, `exists`,
    `not_exists`, `and`, `or`.
  - `evaluate_condition(condition, ctx)` — pure evaluation.
  - `validate_condition(condition)` — structural validation (no context
    needed); called by `loader.py` at load time.
  - `ConditionError` — raised for structural or evaluation errors.
- `Step.condition` field — optional `dict` parsed from workflow YAML/JSON.
- `Workflow.variables` field — default variable values merged with
  `run_vars` at execution time.
- CLI `--var KEY=VALUE` flag for `run` subcommand (repeatable).
- Condition semantics:
  - absent → step runs normally.
  - evaluates `False` → `SKIPPED`; audit records `step_skipped` with
    `reason="condition not met"`.
  - evaluates `True` → step runs normally.
  - `SKIPPED` is a *satisfied* terminal state; dependents proceed.

### Security addition (adversarial requirement)
- `policy_gate: bypass_all` (and variants) in workflow YAML/JSON is
  **rejected at load time** with a `ValueError` referencing
  `invariant_no_policy_bypass`.
- `loader._validate_gate_name()` enforces both an explicit denylist and
  an allowlist of known gate names.
- `PolicyMode` enum added to `policy.py`: `ENFORCED` (default) /
  `PERMISSIVE`.
- Permissive mode is operator-controlled only (CLI `--policy-mode=permissive`
  or `WORKFLOW_POLICY_MODE` env-var).  Every gate override is recorded in
  the audit log as `policy_gate_overridden`.
- `tests/test_policy_bypass_rejection.py` — adversarial test suite.

---

## [0.1.0] — Phase 1: Initial Working Version

### Added
- Package layout: `src/policy_engine/`.
- `models.py` — `Step`, `Workflow`, `StepStatus` dataclasses.
- `loader.py` — YAML/JSON loader with full untrusted-input validation.
- `audit.py` — `AuditLog`: append-only in-memory list + optional JSONL
  persistence.
- `policy.py` — `PermissionModel` + `PolicyGate`.  Production gate
  disabled by default.
- `engine.py` — `WorkflowEngine` (DAG scheduler) + `RollbackManager`.
- `cli.py` — `workflow validate | run | audit | explain`.
- `pyproject.toml` — `pip install -e .` support; `workflow` console script.
- `tests/` — `conftest.py`, `test_loader.py`, `test_engine.py`,
  `test_audit_persistence.py`.
- `examples/` — `ci_pipeline.yaml`, `production_deploy.yaml`.
- `README.md`.

### Invariants established
All seven structural invariants active from this phase forward:
`invariant_no_policy_bypass`, `invariant_audit_append_only`,
`invariant_rollback_preserves_audit`, `invariant_failed_step_blocks_dependents`,
`invariant_config_is_untrusted`, `invariant_production_requires_grant`,
`invariant_tests_are_deliverable`.