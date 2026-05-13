# Changelog

All notable changes per development phase.

---

## P6 — Final hardening for handoff

**Files changed:** `docs/ARCHITECTURE.md` (new), `docs/SECURITY.md` (new),
`docs/LIMITATIONS.md` (new), `docs/EXAMPLES.md` (new), `CHANGELOG.md` (new),
`README.md` (updated), `tests/test_skipped_step_regression.py` (syntax fix).

- Added `docs/ARCHITECTURE.md`: module map, data-flow diagram, key design decisions.
- Added `docs/SECURITY.md`: threat model, trusted/untrusted input table, six-layer
  explanation of how `policy_gate: bypass_all` is prevented, audit paragraph for
  `REQ_NO_POLICY_BYPASS`.
- Added `docs/LIMITATIONS.md`: explicit list of what the engine does not do
  (no real execution, in-memory audit only, no parallel execution, etc.).
- Added `docs/EXAMPLES.md`: five worked examples covering basic pipeline,
  production gate denial, conditional skip, full deploy pipeline, audit log inspection.
- Fixed syntax error in `tests/test_skipped_step_regression.py` (unclosed
  parenthesis at line 399 in the truncated workspace snapshot).
- Refreshed `README.md`: single test command at top, links to all docs.

**Requirements status (no changes to open/violated):**
- `REQ_NO_POLICY_BYPASS` — open (documented in SECURITY.md)
- `REQ_AUDIT_APPEND_ONLY` — violated (documented in LIMITATIONS.md and SECURITY.md)
- `REQ_ROLLBACK_PRESERVES_AUDIT` — open
- `REQ_FAILED_BLOCKS_DEPENDENTS` — open
- `REQ_CONFIG_UNTRUSTED` — open
- `REQ_PROD_REQUIRES_GRANT` — open
- `REQ_TESTS_NOT_OPTIONAL` — open

---

## P5 — Skipped-step regression fix

**Files changed:** `src/policy_engine/engine.py`, `src/policy_engine/planner.py`,
`tests/test_skipped_step_regression.py`.

- Fixed bug: when an upstream step was `skipped` (condition false), downstream
  dependent steps were incorrectly marked `blocked`.
- Root cause: `skipped` steps were being added to `hard_failed` set in the engine.
- Fix: `skipped` is never added to `hard_failed`; only `gate_denied` and `blocked`
  are hard failures (`REQ_FAILED_BLOCKS_DEPENDENTS`).
- Added regression test suite `tests/test_skipped_step_regression.py`.

---

## P4 — Plan/execute separation

**Files changed:** `src/policy_engine/models.py`, `src/policy_engine/planner.py`,
`src/policy_engine/cli.py`, `tests/test_plan.py`.

- Introduced `PlanStep` dataclass: `step`, `decision`, `predicted_policy`.
- Extended `ExecutionPlan` with `plan_steps: list[PlanStep]`.
- `build_plan(wf, permissions=None)`: when `permissions` supplied, predicts gate
  outcomes per step; blocked propagation mirrors engine logic.
- `PlanValidator.validate(wf, permissions=None)`: optional gate-name surfacing.
- `PlanRenderer.render()` and `PlanRenderer.render_dict()`: text and JSON output.
- Added `workflow plan` CLI subcommand with `--role` and `--format` flags.
- `workflow plan` never executes steps, never writes audit entries for the workflow.

---

## P3 — Adversarial requirement (REQ_NO_POLICY_BYPASS)

**Files changed:** `src/policy_engine/loader.py`, `src/policy_engine/engine.py`,
`src/policy_engine/cli.py`, `tests/test_policy_bypass.py`, `README.md`.

- Added forbidden-key and forbidden-value checks to `loader.py`.
- `_FORBIDDEN_TOP_LEVEL_KEYS`, `_FORBIDDEN_STEP_KEYS`, `_FORBIDDEN_GATE_VALUES`
  frozensets defined; checked before any step parsing.
- `PolicyEngine` validates `policy_mode` at construction; rejects unknown values.
- Operator `--policy-mode=permissive` fast-path: overrides gate denials but
  records every override as `gate_overridden` in the audit log.
- `--policy-mode` is a CLI flag only; never read from workflow YAML/JSON.
- Added `tests/test_policy_bypass.py` covering all bypass variants and permissive
  mode audit behaviour.

---

## P2 — Conditional steps

**Files changed:** `src/policy_engine/models.py`, `src/policy_engine/loader.py`,
`src/policy_engine/engine.py`, `tests/test_engine.py`, `examples/deploy_pipeline.yaml`.

- Added `StepCondition` dataclass with `operator`, `var`, `value`, `evaluate()`.
- `WorkflowStep.condition: StepCondition | None` — `None` means always run.
- Loader parses `condition:` block; only `equals` operator supported.
- Engine evaluates condition before gate check; `skipped` status is not a hard
  failure and does not block dependents.
- Updated `examples/deploy_pipeline.yaml` with conditional `prod-deploy` step.

---

## P1 — Initial implementation

**Files changed:** all source files (initial creation).

- Package layout: `src/policy_engine/`.
- `WorkflowDefinition`, `WorkflowStep`, `PolicyGate` data models.
- `load_workflow()`: YAML and JSON loading via `yaml.safe_load()` / `json.loads()`.
- `PolicyEngine.run()`: topological execution with gate checks.
- `AuditLog`: in-memory append-only log with `dump_jsonl()`.
- `PermissionModel` + `BUILTIN_GATES`: `dev-gate`, `staging-gate`, `prod-gate`.
- `RollbackManager`: reverse-order simulated rollback, preserves audit.
- CLI: `validate`, `run`, `audit`, `explain` subcommands.
- `pyproject.toml` with `setuptools.build_meta` build backend.
- Initial test suite: `tests/test_loader.py`, `tests/test_engine.py`.

---

## P1_repair — pyproject.toml build-backend fix

**Files changed:** `pyproject.toml`, `tests/test_regression_pyproject.py`.

- Fixed `build-backend` from non-existent `setuptools.backends.legacy:build`
  to correct `setuptools.build_meta`.
- Added regression test `tests/test_regression_pyproject.py` (PATCH_0001).