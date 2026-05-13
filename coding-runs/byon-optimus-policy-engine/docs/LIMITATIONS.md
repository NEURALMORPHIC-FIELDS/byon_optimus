# Limitations

This document describes what the engine does **not** do.  Understanding these
boundaries is essential before using this project in a real deployment context.

## No Real Execution

All step execution is **simulated**.  `PolicyEngine.run()` records audit entries
and returns status strings.  It does not:

- Run shell commands or subprocesses
- Deploy code to any environment
- Call any network endpoint
- Write to any filesystem path (beyond the audit log, which is in-memory)
- Interact with CI/CD systems, Kubernetes, cloud providers, or any external service

The `action` field on a step is stored and audited but never interpreted or
executed.

## In-Memory Audit Log Only

`AuditLog` stores entries in a Python list for the lifetime of the process.
It is **not** persisted to disk, a database, or any external store.  When the
process exits, the audit log is lost.

The log is append-only within a single process run, but there is no
cryptographic signing, no write-ahead log, and no protection against a caller
who holds a reference to the `AuditLog` object replacing it.
`REQ_AUDIT_APPEND_ONLY` is partially satisfied (in-process immutability) but
not fully satisfied (no durable persistence).

## No Real Rollback

`RollbackManager.rollback()` appends audit entries in reverse step order.  It
does not perform any real undo operation (no database transactions, no file
restores, no API calls).

## Single Condition Operator

The `condition` block supports only the `equals` operator.  There is no support
for:

- `not_equals`, `greater_than`, `less_than`, `in`, `not_in`
- Boolean combinators (`and`, `or`, `not`)
- Regular expression matching
- Dynamic variable resolution beyond a flat `context` dict

An unknown operator evaluates conservatively to `False` (step is skipped).

## No Parallel Execution

Steps are executed strictly in topological order, one at a time.  There is no
support for running independent branches of the DAG concurrently.

## No Step Retry or Timeout

There is no retry logic, timeout, or backoff for failed steps.  A step either
succeeds or fails in a single pass.

## No Dynamic Workflow Modification

The workflow definition is fixed at load time.  Steps cannot add, remove, or
modify other steps at runtime.  There is no support for dynamic fan-out or
matrix builds.

## No Secret Management

The engine has no concept of secrets, credentials, or environment variable
injection.  The `params` dict on a step is stored as plain data and is never
encrypted or redacted in the audit log.

## No Multi-Tenancy or Authentication

`PermissionModel` accepts a `role` string at construction time.  There is no
authentication layer — the engine trusts the role it is given.  In a real
deployment, the caller must authenticate the role before constructing
`PermissionModel`.

## No Persistent Gate Registry

`BUILTIN_GATES` is a module-level constant.  There is no database-backed gate
registry, no UI for managing gates, and no hot-reload of gate definitions.
Adding a new gate requires a code change and redeployment.

## Python Version

Requires Python 3.9 or later.  The `tomllib` module used in
`test_regression_pyproject.py` is stdlib only from Python 3.11; a regex
fallback is provided for 3.9/3.10.