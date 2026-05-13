"""PermissionModel: maps roles to allowed PolicyGates."""
from __future__ import annotations
from .models import PolicyGate

# Built-in gates — REQ_NO_POLICY_BYPASS: gates are defined here, not in workflow YAML.
BUILTIN_GATES: dict[str, PolicyGate] = {
    "dev-gate": PolicyGate(name="dev-gate", required_role="developer"),
    "staging-gate": PolicyGate(name="staging-gate", required_role="deployer"),
    "prod-gate": PolicyGate(
        name="prod-gate",
        required_role="release-manager",
        environment_restriction="prod",
    ),
}


class PermissionModel:
    """REQ_PROD_REQUIRES_GRANT: production gate requires explicit role grant."""

    def __init__(
        self,
        role: str,
        extra_gates: dict[str, PolicyGate] | None = None,
    ) -> None:
        self.role = role
        self._gates: dict[str, PolicyGate] = {**BUILTIN_GATES, **(extra_gates or {})}

    def check(self, gate_name: str, environment: str) -> bool:
        gate = self._gates.get(gate_name)
        if gate is None:
            # Unknown gate → deny by default (REQ_NO_POLICY_BYPASS)
            return False
        return gate.evaluate(self.role, environment)

    def list_gates(self) -> list[PolicyGate]:
        return list(self._gates.values())