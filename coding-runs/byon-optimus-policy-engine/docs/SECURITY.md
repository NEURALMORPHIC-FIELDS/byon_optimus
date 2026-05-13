# Security — Policy-Gated Workflow Engine

## Threat Model

### Assets

| Asset | Why it matters |
|---|---|
| Policy enforcement | Determines what steps are allowed to execute. Bypass = arbitrary execution. |
| Audit log | Provides tamper-evident record of all decisions. Corruption = loss of accountability. |
| Runtime context | May contain secrets (env vars, credentials). Leakage = confidentiality breach. |

### Trust Boundaries

| Input | Trust level | Handling |
|---|---|---|
| Workflow YAML / JSON file | **Untrusted** | Validated by `loader.py`; schema-checked; unknown keys rejected. |
| CLI arguments | **Untrusted** | Parsed and validated before use; never eval'd. |
| `context` dict (caller-supplied) | **Caller-trusted** | Used for condition evaluation only; not persisted verbatim. |
| `PolicyEngine` configuration | **Trusted** | Configured in code / operator config, never from workflow files. |
| Step handler implementations | **Trusted** | Registered in code; workflow YAML references handlers by name, cannot supply handler code. |

### Threat Actors

- **Malicious workflow author** — supplies a crafted YAML file attempting to
  disable policy gates, inject handler code, or corrupt the audit log.
- **Misconfigured workflow** — accidental use of reserved keys or invalid
  dependency graphs.
- **Compromised dependency** — a third-party library used in parsing or
  execution is exploited.

---

## Policy-Bypass Prevention

### How `policy_gate: bypass_all` is prevented

A workflow YAML field `policy_gate: bypass_all` (or any variant) **cannot
disable policy enforcement**. The prevention is layered:

**Layer 1 — Schema validation (loader.py)**
The YAML schema defines an explicit allowlist of recognised top-level and
step-level keys. Any key not in the allowlist — including `policy_gate` —
causes `loader.py` to raise a `ValidationError` before a
`WorkflowDefinition` object is ever constructed. The workflow is rejected
at the boundary; it never reaches the engine.

**Layer 2 — PolicyEngine is not configurable from workflow data**
`PolicyEngine` is instantiated by the operator (in code or operator config)
and passed into `WorkflowEngine`. The `WorkflowDefinition` dataclass has no
field that references, modifies, or disables the policy engine. There is no
code path from a `WorkflowDefinition` attribute to a `PolicyEngine` method
that weakens a gate.

**Layer 3 — No dynamic gate registration**
`PolicyEngine` exposes no public method to add, remove, or override a gate
at runtime. Gates are registered at construction time only. A workflow
cannot call `PolicyEngine` methods — it is not exposed to workflow-level
code.

**Layer 4 — Tests as regression guard**
`tests/test_invariants.py` contains a dedicated regression test
(`test_policy_gate_bypass_all_rejected`) that asserts a workflow YAML
containing `policy_gate: bypass_all` is rejected by the loader and that
the engine never executes any step from such a workflow. This test is part
of the mandatory CI gate (see README).

**Summary:** the attack surface is eliminated structurally. There is no
configuration knob, environment variable, or runtime flag that a workflow
file can set to weaken policy enforcement.

---

## Audit Log Integrity

- `AuditLog` exposes only `append(entry)` and `entries` (read-only).
- There is no `delete`, `update`, `clear`, or `rewrite` method.
- Rollback operations append new entries describing the rollback; they do
  not remove the original execution entries.
- In production deployments, the audit log should be written to an
  append-only sink (e.g., append-only file, write-once object storage,
  or a database with insert-only permissions).

## Input Validation Rules

1. Workflow files are parsed with `yaml.safe_load` (no arbitrary Python
   object deserialisation).
2. All string fields are length-bounded and matched against an identifier
   pattern (`[a-zA-Z0-9_-]+`) before use.
3. `depends_on` references are validated to name only steps that exist in
   the same workflow; forward references are resolved after full parse.
4. Condition operands are resolved against the caller-supplied `context`
   dict only; they cannot reference filesystem paths, environment variables,
   or execute code.
5. Step handler names are looked up in a pre-registered handler registry;
   unrecognised names raise `ValidationError`.

## What This Engine Does NOT Enforce

- Network-level isolation (no sandboxing of step handlers).
- Secret redaction in audit entries (callers must not pass raw secrets as
  context values if audit entries are stored externally).
- Cryptographic signing of audit entries (out of scope for this version;
  see LIMITATIONS.md).