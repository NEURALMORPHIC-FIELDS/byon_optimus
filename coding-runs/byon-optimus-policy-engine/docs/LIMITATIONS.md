# Limitations

## No Real Execution

All step execution is **simulated**. When the engine marks a step `success`,
no actual process is spawned, no file is written, no deployment occurs, and
no network call is made. The engine is a policy-enforcement and audit framework,
not a task runner.

## No Persistent Audit Log by Default

`AuditLog` stores entries in memory for the duration of a single `engine.run()`
call. When the process exits, the log is lost. A `jsonl_path` constructor
argument enables append-to-file persistence, but this is not wired up in the
CLI (`--audit-file` is noted as a future feature in `cmd_audit`).

## No Parallel Execution

Steps are executed strictly in topological order, one at a time. There is no
concurrency, no thread pool, and no async support. Steps that could run in
parallel (no shared dependencies) are serialised.

## Single Condition Operator

The only supported condition operator is `equals`. There is no `not_equals`,
`in`, `gt`, `lt`, or boolean composition (`and`/`or`). Unknown operators raise
`ConditionError` at runtime.

## In-Memory Permission Model Only

`PermissionModel` is constructed in memory at startup from the built-in default
gates. There is no integration with an external IAM system, LDAP, OAuth, or
policy-as-code store (e.g. OPA). Adding custom gates requires Python API calls
before invoking the engine.

## No Cryptographic Audit Integrity

`AuditLog` entries are not signed or hashed. An in-process attacker with access
to the `AuditLog` object could manipulate `_entries` via Python name mangling.
See `docs/SECURITY.md` for the threat model boundary.

## No Rollback of Real Side Effects

`RollbackManager.rollback()` records `ROLLBACK` audit entries and clears the
internal completed-steps list. Because execution is simulated, there are no
real side effects to undo. In a real system, rollback handlers would need to be
registered per step.

## No Retry Logic

A denied or failed step is not retried. There is no backoff, no retry count,
and no partial-failure recovery. A denied step immediately blocks all transitive
dependents.

## YAML Only via PyYAML

JSON is supported natively. YAML requires `PyYAML>=6.0`. If PyYAML is not
installed, YAML files raise `LoadError`. There is no support for TOML, HCL,
or other formats.

## No Schema Versioning

Workflow files have no `version` field. There is no migration path between
schema versions and no backwards-compatibility guarantee across releases.

## Single-Process Only

The engine has no distributed coordination, no locking, and no shared state
between processes. Running two instances against the same workflow file
simultaneously produces two independent, uncoordinated executions.