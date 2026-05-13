# Limitations — Policy-Gated Workflow Engine

This document records what the engine explicitly does **not** do.
Understanding limitations is as important as understanding capabilities.

---

## Execution Model

**No real deployment or infrastructure actions.**
Step handlers in this codebase are stubs or test doubles. The engine
provides the orchestration and policy-gating framework; actual deployment
actions (SSH, Kubernetes, cloud APIs) are not implemented and are out of
scope.

**No parallel execution.**
Steps execute sequentially in topological order. Parallel branches (steps
with no mutual dependency) are executed one at a time, not concurrently.
Adding concurrency would require a thread/async model and is a future
concern.

**No retry logic.**
A failed step is marked FAILED immediately. There is no built-in retry,
back-off, or timeout mechanism. Callers who need retries must wrap the
engine or implement retry at the handler level.

---

## Policy Engine

**No dynamic policy loading.**
Policies are registered at `PolicyEngine` construction time in code. There
is no hot-reload, plugin system, or external policy-as-data language (e.g.,
OPA/Rego). Adding a new gate requires a code change and redeployment.

**No attribute-based or role-based access control.**
The policy engine evaluates step-level gates against a context dict. It
does not implement RBAC, ABAC, or identity federation. Caller identity is
not verified by the engine.

**No cryptographic proof of policy evaluation.**
Policy decisions are recorded in the audit log as structured data but are
not cryptographically signed. An attacker with write access to the audit
store could forge entries. See SECURITY.md for mitigation guidance.

---

## Audit Log

**In-memory only (default implementation).**
The default `AuditLog` stores entries in a Python list. Entries are lost
when the process exits. Production use requires wiring the log to a
persistent, append-only sink.

**No tamper detection.**
Entries are not hashed or chained. The append-only contract is enforced by
the API surface, not by cryptographic means.

---

## Workflow Definition

**No versioning or migration.**
There is no schema version field or migration path between schema versions.
Breaking schema changes require manual workflow file updates.

**No loops or dynamic step generation.**
The workflow graph is static and acyclic (DAG). Loops, fan-out based on
runtime data, or dynamically generated steps are not supported.

**No timeout or deadline per step.**
Steps run to completion (or failure) with no wall-clock limit.

---

## Rollback

**Rollback is best-effort.**
`RollbackManager` calls registered undo handlers. If an undo handler itself
fails, the failure is audited but rollback continues. There is no
compensation transaction protocol (e.g., Saga pattern).

**Rollback does not restore external state.**
If a step modified an external system (database, cloud resource), rollback
only calls the registered undo handler. Whether that handler actually
restores external state is the handler author's responsibility.

---

## Security

**No network isolation of step handlers.**
Step handlers run in the same process as the engine. A malicious or buggy
handler can access the network, filesystem, and process environment.
Production deployments that run untrusted handlers should add OS-level
sandboxing outside this engine.

**No secret management.**
The engine does not encrypt, redact, or rotate secrets. Do not pass raw
credentials as context values if audit entries are persisted externally.