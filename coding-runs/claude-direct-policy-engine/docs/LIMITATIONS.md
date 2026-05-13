# Limitations

This document records what the `policy-gated-workflow-engine` deliberately
does **not** do.  These are not bugs — they are explicit scope boundaries.

---

## Execution is Simulated Only

**No real work is ever performed.**

Every step action (`build`, `deploy`, `migrate`, etc.) calls `_simulate_action()`
which returns a success/failure string.  There is no:

- Shell command execution (`subprocess`, `os.system`)
- Network calls (HTTP, SSH, gRPC)
- File system writes outside the audit log
- Container or VM lifecycle management
- Package installation or compilation

To integrate with real systems, replace `_simulate_action()` in `engine.py`
with your own executor.  The rest of the engine (DAG scheduling, policy
gates, audit, rollback) is real and production-quality.

---

## No Persistent State Between Runs

The audit log is either:
- **In-memory only** — lost when the process exits (default CLI behaviour).
- **JSONL file** — written if `AuditLog(jsonl_path=...)` is constructed.

The CLI uses an in-process `_GLOBAL_AUDIT` instance.  Running `workflow run`
twice in two separate processes produces two independent audit logs.  There
is no database, no server, no shared state.

---

## No Parallelism

Steps are executed **sequentially** in topological order within a single
thread.  The iterative scheduler processes one step per pass.  There is no:

- `asyncio` / `threading` / `multiprocessing` parallelism
- Fan-out of independent steps in parallel
- Timeout or deadline enforcement per step

If two steps have no dependency relationship they will still run one after
the other (in definition order, subject to the iteration pass).

---

## Condition Variables Are Strings / Scalars Only

The condition DSL (`conditions.py`) evaluates expressions against a flat
`dict[str, Any]` context.  It does not support:

- Nested object traversal (`vars.build.artifact`)
- Arithmetic expressions (`count > 5`)
- Regular expression matching
- Jinja2 / template interpolation
- Dynamic variable values from step outputs

Variables must be supplied at invocation time via `--var KEY=VALUE` or
workflow-level `variables:` defaults.

---

## No Step Output / Artifact Passing

Steps cannot pass data to downstream steps.  There is no:

- Output capture from `_simulate_action`
- Variable injection from step results
- Artifact store or shared workspace

Each step is evaluated with the same variable context established at the
start of the run.

---

## Role Model is Flat and Static

The `PermissionModel` maps role strings to sets of gate strings.  It does
not support:

- Hierarchical roles (role inheritance)
- Dynamic role assignment at runtime
- RBAC policies loaded from external systems (LDAP, OPA, Vault)
- Time-bounded or context-sensitive grants
- Per-workflow or per-environment role overrides from config files

Adding a new gate requires editing `policy.py` and `loader._VALID_GATES`.

---

## No Real Rollback

`RollbackManager.rollback()` records `rollback_step` audit entries and
resets step status to `PENDING`.  It does **not**:

- Execute any real undo operation
- Call an API to reverse a deployment
- Restore database state
- Revert file changes

Rollback is a record-keeping convention.  Real undo logic must be
implemented by the integrator in `_simulate_action` or a replacement.

---

## Single-Node, Single-Tenant

The engine is designed as a library / CLI tool for a single operator on a
single machine.  It does not support:

- Multi-user concurrent access
- Remote execution agents
- Distributed locking
- Workflow queuing or scheduling (cron, event triggers)
- A REST API or web UI

---

## YAML/JSON Schema is Not Formally Published

Workflow file validation is implemented in `loader.py` as Python code.
There is no JSON Schema, OpenAPI spec, or formal grammar document.  The
authoritative definition of valid input is the loader source and its tests.

---

## No Secret Redaction in Audit Log

If sensitive values (tokens, passwords) are placed in `params:`, they will
appear in plain text in audit log entries.  Do not put secrets in workflow
files or `--var` arguments.