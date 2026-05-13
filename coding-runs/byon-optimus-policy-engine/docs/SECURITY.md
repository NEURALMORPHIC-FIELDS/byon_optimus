# Security

## Threat Model

### Assets

- **Policy gates** — the mechanism that prevents unauthorised steps (e.g. production
  deployments) from executing.
- **Audit log** — the tamper-evident record of every state transition.
- **Operator-controlled settings** — `PolicyMode`, role assignment — must not be
  influenceable by untrusted workflow files.

### Trust Boundary

| Input | Trust level | Validated by |
|---|---|---|
| Workflow YAML/JSON files | **Untrusted** | `loader.py` on load |
| `--policy-mode` CLI flag | Operator-controlled | `cli.py` |
| `POLICY_MODE` env var | Operator-controlled | `policy_mode.py` |
| `--role` CLI flag | Operator-controlled | `cli.py` |
| Runtime `variables` dict (passed to `engine.run()`) | Caller-supplied | Used only for condition evaluation, never for gate decisions |

### Attacker Assumptions

- An attacker can craft an arbitrary YAML or JSON workflow file.
- An attacker cannot modify the Python source, the CLI invocation, or environment
  variables (those are operator-controlled).
- An attacker cannot inject values into `PermissionModel` at runtime.

---

## REQ_NO_POLICY_BYPASS: How `policy_gate: bypass_all` Is Prevented

This section explains exactly how a workflow file containing
`policy_gate: bypass_all` (or any bypass variant) is prevented from
disabling policy gates.

### Layer 1 — Forbidden key rejection in `loader.py`

`_parse()` checks every top-level key against `_FORBIDDEN_WORKFLOW_KEYS` before
any other processing:

```python
_FORBIDDEN_WORKFLOW_KEYS: dict[str, str] = {
    "policy_gate": "...",
    "policy_mode": "...",
}

for forbidden_key, message in _FORBIDDEN_WORKFLOW_KEYS.items():
    if forbidden_key in data:
        raise LoadError(f"REQ_NO_POLICY_BYPASS: forbidden workflow field ...")