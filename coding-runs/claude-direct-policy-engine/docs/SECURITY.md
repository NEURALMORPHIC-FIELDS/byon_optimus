# Security Model

## Threat Model

The engine processes **untrusted workflow definitions** (YAML/JSON files that
may be supplied by developers, CI systems, or external users).  The threat
model assumes:

| Actor | Trust level | Notes |
|---|---|---|
| Workflow YAML/JSON file | **Untrusted** | Must be fully validated before use |
| CLI flags (`--role`, `--var`, `--policy-mode`) | **Operator-trusted** | Set by the person running the command |
| `PermissionModel` / `PolicyGate` construction | **Operator-trusted** | Lives in Python code, not in workflow files |
| `WORKFLOW_POLICY_MODE` env-var | **Operator-trusted** | Set in the shell by the repo owner / CI config |
| Python import-time constants (`_SATISFIED`, `_BLOCKING`) | **Trusted** | Part of the codebase, not runtime input |

The primary security property this engine protects is:

> **No workflow file can disable, weaken, or bypass policy gate enforcement.**

---

## Trusted vs Untrusted Inputs

### Untrusted (validated at load time — `loader.py`)

- `id` — must match `[A-Za-z0-9_\-]+`
- `action` — must be in `_VALID_ACTIONS` allowlist
- `environment` — must be in `_VALID_ENVS` allowlist
- `policy_gate` — must pass both denylist **and** allowlist checks
  (see below)
- `depends_on` — each entry must reference a known step id
- `condition` — structurally validated by `conditions.validate_condition()`
- `variables` — must be a plain mapping (no executable content)
- Unknown top-level keys — silently ignored but never acted upon

### Operator-trusted (never read from workflow files)

- `PolicyMode` (enforced / permissive)
- `PermissionModel.role_grants`
- `PermissionModel.production_granted`
- `PolicyGate` instance construction
- `--grant-production` flag

---

## How `policy_gate: bypass_all` Is Prevented

This section explains exactly how the adversarial input
`policy_gate: bypass_all` (or any similar sentinel) in a workflow file is
prevented from disabling gate enforcement.

### Layer 1 — Explicit denylist (loader.py: `_GATE_DENYLIST`)

```python
_GATE_DENYLIST = {
    "bypass_all", "bypass", "skip_policy", "no_policy",
    "allow_all", "permit_all", "disable_policy",
}