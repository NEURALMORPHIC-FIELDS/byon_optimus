# Limitations

This document describes what the policy-gated workflow engine intentionally
does **not** do.  Understanding these limitations is essential before
integrating the engine into a real deployment pipeline.

---

## 1. All Step Execution is Simulated

**No step performs any real action.**

`WorkflowEngine._execute_step()` sets `step.status = StepStatus.SUCCESS` and
writes an audit entry.  It does not:

- Run shell commands or subprocesses.
- Make HTTP/gRPC/SSH calls.
- Write to databases, object stores, or message queues.
- Trigger external CI/CD systems.
- Deploy containers, functions, or infrastructure.

Any workflow `action` value (e.g. `deploy.kubernetes`, `run.terraform`) is
accepted by the validator as a string identifier but is **never interpreted
or executed**.

**Implication**: to build a real deployment engine on top of this project, you
must replace `_execute_step()` with a dispatch mechanism that maps action
identifiers to real executor plugins.

---

## 2. No Persistence Between Runs

The engine holds all workflow state in memory for the duration of a single
process invocation.  There is no:

- Database or file-backed step state.
- Resume-from-checkpoint after process crash.
- Distributed locking for concurrent runners.

The **audit log** is partially persistent: if `AuditLog(jsonl_path=…)` is
used (the default in the CLI), audit entries are appended to a JSONL file.
However, `Step.status` values are lost when the process exits.

---

## 3. No Parallel Step Execution

Steps are executed sequentially in topological order.  Steps with no
dependency relationship between them are eligible to run in parallel (Kahn's
algorithm would process them in the same "wave"), but the engine does not
exploit this — it processes one step at a time.

---

## 4. Condition Expressions are Limited

The condition language supports six operators: `equals`, `not_equals`, `in`,
`not_in`, `exists`, `not_exists`.

It does **not** support:

- Boolean combinators (`and`, `or`, `not`).
- Arithmetic comparisons (`gt`, `lt`, `gte`, `lte`).
- String pattern matching (regex, glob).
- Referencing other steps' outputs or status.
- Computed expressions or templates.

---

## 5. Variables are Flat and Untyped (Mostly)

Execution-time variables (`--var KEY=VALUE`) are a flat `dict[str, Any]`.
Values are JSON-decoded when possible (so `--var count=3` gives integer `3`)
but there is no schema, no default values, no required-variable enforcement,
and no variable interpolation within other fields (e.g. `action`, `params`).

---

## 6. No Secret Management

The engine does not handle secrets.  Variables passed via `--var` appear in
audit log entries (as key names only, not values) but there is no mechanism
to mark a variable as sensitive, redact it from logs, or retrieve it from a
secrets manager.

Do not pass passwords, tokens, or private keys as `--var` values.

---

## 7. Single-Process Only

The engine is not designed for distributed or multi-process use.  The in-
memory `AuditLog` is protected by a `threading.Lock` for thread safety within
one process, but:

- Multiple processes writing to the same JSONL file would interleave writes
  non-atomically on some operating systems.
- There is no distributed consensus for the "who ran what" question.

---

## 8. Permission Model is Static

`PermissionModel` is initialised once from Python source defaults or explicit
constructor arguments.  It does not:

- Query an external IAM system (LDAP, OAuth, AWS IAM, OPA, etc.).
- Refresh permissions at runtime.
- Support attribute-based access control (ABAC).
- Enforce time-bounded grants.

Production use would require replacing or wrapping `PermissionModel` with an
integration to your organisation's identity provider.

---

## 9. No Notification or Observability Integration

The engine writes to its audit log and to stdout.  It does not emit:

- Structured logs to a log aggregation system (Datadog, Splunk, etc.).
- Metrics or traces (Prometheus, OpenTelemetry).
- Webhook callbacks or events on step completion/failure.

---

## 10. Rollback is Also Simulated

`WorkflowEngine.rollback()` reverses the `_execution_order` list and writes
audit entries.  It does **not** perform any real compensating actions.  In a
real system, rollback of a deployment step would require an actual
re-deployment or teardown.

---

## 11. No Rate Limiting or Retry Logic

Steps have no retry configuration.  A simulated step always succeeds (unless
the test overrides `_execute_step`).  In a real engine you would need:

- Configurable retry counts and backoff.
- Timeout enforcement.
- Circuit-breaker integration.

---

## 12. No Multi-Workflow Orchestration

Each invocation of `workflow run` executes exactly one workflow file.  There
is no concept of:

- Sub-workflows or workflow composition.
- Triggering one workflow from another.
- Shared state between workflows.