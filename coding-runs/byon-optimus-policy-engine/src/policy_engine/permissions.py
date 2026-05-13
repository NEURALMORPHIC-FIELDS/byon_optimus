"""Simple role-based permission model. REQ_PROD_REQUIRES_GRANT."""
from __future__ import annotations
from policy_engine.models import PolicyGate


class PermissionModel:
    """Maps roles to the set of gates they satisfy."""

    def __init__(self) -> None:
        self._gates: dict[str, PolicyGate] = {}

    def register_gate(self, gate: PolicyGate) -> None:
        self._gates[gate.name] = gate

    def is_allowed(self, gate_name: str, role: str, environment: str) -> bool:
        gate = self._gates.get(gate_name)
        if gate is None:
            return False  # REQ_NO_POLICY_BYPASS: unknown gate = deny
        return gate.allows(role, environment)

    @classmethod
    def default(cls) -> "PermissionModel":
        """Built-in gates. REQ_PROD_REQUIRES_GRANT: prod gate requires 'release-manager'."""
        pm = cls()
        pm.register_gate(PolicyGate("dev-gate", required_role="developer", environment_scope="dev"))
        pm.register_gate(PolicyGate("staging-gate", required_role="qa-engineer", environment_scope="staging"))
        pm.register_gate(PolicyGate("prod-gate", required_role="release-manager", environment_scope="prod"))
        pm.register_gate(PolicyGate("any-gate", required_role="developer", environment_scope="*"))
        return pm