# Limitations

This document describes what the `policy-gated-workflow-engine` intentionally
does **not** do.  These are design boundaries, not bugs.

---

## Execution

### No real execution
All step execution is **simulated**.  `WorkflowEngine._simulate_step()` logs
what it would do and returns `SUCCESS` without performing any action.  There
are no real:
- Shell commands or subprocesses
- Network requests (HTTP, SSH, gRPC, etc.)
- File system writes (beyond the audit JSONL)
- Container or VM operations
- Cloud provider API calls
- Database migrations

**Implication:** The engine is suitable as a planning, gate-checking, and
audit scaffold.  To perform real actions, replace `_simulate_step()` with a
dispatch mechanism.  All other engine logic (ordering, conditions, policy,
audit) remains valid.

### No parallel execution
Steps execute strictly in topological order, one at a time.  There is no
concurrency, thread pool, or async execution.  Independent branches of the DAG
are serialised.

### No retry logic
Failed steps are not retried.  There is no `retry:` field in the workflow
schema and no exponential back-off.

### No timeouts
Steps have no execution timeout.  In a real executor, a hung step would block
indefinitely.

### No resource limits
There is no CPU, memory, or time budget per step or per workflow.

---

## Workflow definition

### No dynamic step generation
The set of steps is fixed at load time.  Steps cannot create other steps, loop,
or branch beyond what `condition` expressions allow.

### No templating
Workflow files are not templated (no Jinja2, no variable substitution in
strings).  Context variables are only used for condition evaluation.

### No external references
Workflow files cannot `include` or `import` other workflow files.

### No schema versioning migration
If the workflow schema changes in a breaking way, old files must be manually
updated.  There is no automatic migration.

### Condition operators are limited
Supported: `equals`, `not_equals`, `in`, `not_in`, `exists`, `not_exists`.
Not supported: numeric comparisons (`>`, `<`, `>=`, `<=`), regex matching,
boolean logic (`and`, `or`, `not`), arithmetic, or referencing step outputs.

---

## Policy and permissions

### No authentication
The `--role` flag is accepted at face value from the CLI caller.  The engine
does not verify the caller's identity, issue tokens, or integrate with an
identity provider (LDAP, OIDC, IAM, etc.).

### No dynamic roles
Roles and their gate grants are defined in source code (`permissions.py`).
There is no runtime role-assignment API, no RBAC database, and no way for a
workflow file to grant itself additional roles.

### No per-step approval workflow
Gates are checked programmatically.  There is no human-in-the-loop approval
step, no webhook callback, and no integration with approval systems
(Jira, PagerDuty, ServiceNow, etc.).

### No secret management
There is no integration with secret stores (Vault, AWS Secrets Manager, etc.).
`params` fields in workflow steps are stored and logged in plain text.

---

## Audit log

### In-process only by default
The default `AuditLog` is an in-memory list.  It is lost when the process
exits unless `jsonl_path` is set.

### No tamper-evident hash chain
Audit entries are not cryptographically linked.  A sufficiently privileged
attacker with filesystem access could edit the JSONL file without detection.

### No remote shipping
The audit log is not forwarded to a SIEM, log aggregator, or audit database.

### No structured query
There is no query API on top of the audit log beyond iterating `entries()`.

---

## Operational

### No daemon mode
The engine is a one-shot CLI process.  There is no server, scheduler, or
queue consumer.

### No workflow state persistence
The engine does not store workflow run state in a database.  If the process
is killed mid-run, there is no resume capability.

### No notification integrations
The `notify` action is simulated.  There is no email, Slack, PagerDuty, or
webhook integration.

### No metrics or tracing
There is no Prometheus metrics endpoint, no OpenTelemetry trace export, and
no structured performance data beyond what appears in the audit log.

---

## Testing

### Simulated execution means integration tests are limited
Because all steps are simulated, the test suite cannot verify that a real
deployment would succeed.  Tests verify the engine's logic (ordering, policy,
conditions, audit, rollback) but not the correctness of any real action.