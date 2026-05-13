# Security Model

## Threat Model

The engine processes **untrusted workflow YAML/JSON files** supplied by users
or automation systems.  The threat model assumes:

| Actor | Trust level | Examples |
|---|---|---|
| Workflow YAML/JSON content | **Untrusted** | User-authored `.yaml`, CI-supplied config |
| CLI `--var` / `--roles` arguments | **Untrusted** | Any caller of the `workflow` binary |
| `WORKFLOW_POLICY_MODE` env var | **Operator-trusted** | Set by repo owner / CI infra config |
| `PermissionModel` constructor args | **Trusted** | Python source code, test fixtures |
| `--grant-production` CLI flag | **Operator-trusted** | Explicitly passed by a human operator |
| Python source code in `src/` | **Trusted** | Reviewed, version-controlled |

The engine provides **no real execution**.  All step execution is simulated.
The primary security concern is therefore **policy gate bypass** — an attacker
crafting a workflow file that causes the engine to skip or weaken gate checks.

---

## How `policy_gate: bypass_all` is Prevented

This section explains exactly how an adversarial workflow file containing

```yaml
gates:
  bypass_all:
    required_role: anyone
steps:
  - id: deploy
    policy_gates: [bypass_all]