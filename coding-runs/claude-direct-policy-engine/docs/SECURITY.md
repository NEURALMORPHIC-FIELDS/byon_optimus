# Security Model

## Summary

The engine enforces a strict boundary between **untrusted input** (workflow
files, CLI arguments, environment) and **trusted configuration** (gate
registry, role grants, policy mode).  Policy enforcement cannot be disabled
from the untrusted side.

---

## Threat model

### Assets being protected

1. **Policy enforcement** — gates must run for every gated step.
2. **Audit integrity** — the audit log must be a complete, unmodified record
   of everything that happened.
3. **Production safety** — production-environment steps require an explicit,
   operator-granted role.

### Threat actors considered

| Actor | Description |
|-------|-------------|
| Workflow author | Writes YAML/JSON workflow files.  Not trusted to modify policy. |
| CI pipeline | Calls the CLI with arguments that may be derived from repo content. |
| Operator / SRE | Trusted; controls role, policy mode, and gate registry via trusted config. |
| Compromised dependency | A supply-chain attack on PyYAML or stdlib. |

### Threats out of scope

- Compromised Python interpreter or operating system.
- Physical access to the machine running the engine.
- Operator deliberately misconfiguring the trusted layer.

---

## Trusted vs untrusted inputs

| Input | Trust level | Validated by |
|-------|-------------|--------------|
| Workflow YAML / JSON file | **Untrusted** | `loader.py` — full field validation before any use |
| `--var KEY=VALUE` CLI flags | **Untrusted** | Stored in `ExecutionContext`; only used for condition evaluation, never for policy decisions |
| `--role` CLI flag | **Semi-trusted** | Operator-supplied; maps to `PermissionModel.from_defaults()` which cannot exceed pre-defined grants |
| `--policy-mode` CLI flag | **Operator-trusted** | Parsed by CLI; cannot appear in workflow files |
| `DEFAULT_GATES` in `policy.py` | **Trusted** | Defined in source code; never loaded from external files |
| `DEFAULT_GRANTS` in `permissions.py` | **Trusted** | Defined in source code |
| `_FORBIDDEN_GATE_NAMES` in `loader.py` | **Trusted** | Defined in source code |

---

## How `policy_gate: bypass_all` is prevented

This section documents the exact defence-in-depth chain that prevents a
workflow author from disabling policy enforcement by writing
`policy_gate: bypass_all` (or any equivalent) in a workflow file.

### Layer 1 — Block-list in `loader.py` (`_FORBIDDEN_GATE_NAMES`)

`loader.py` defines a frozenset of reserved names at module load time:

```python
_FORBIDDEN_GATE_NAMES: frozenset = frozenset({
    "bypass_all", "bypass-all",
    "skip_all",   "skip-all",
    "no_policy",  "no-policy",
    "disable_policy", "disable-policy",
    "allow_all",  "allow-all",
    "open", "none", "*",
})