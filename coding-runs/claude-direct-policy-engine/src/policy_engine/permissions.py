"""Simple role-based permission model."""
from __future__ import annotations
from typing import Dict, Set


# invariant_production_requires_grant:
# Production gates are DISABLED by default. They must be explicitly granted
# in trusted config (not in workflow YAML).
DEFAULT_GRANTS: Dict[str, Set[str]] = {
    "developer": {"lint-gate", "test-gate", "build-gate"},
    "deployer": {"lint-gate", "test-gate", "build-gate", "staging-gate"},
    "release-manager": {"lint-gate", "test-gate", "build-gate", "staging-gate", "production-gate"},
    "admin": set(),  # admin role gets all via is_admin flag
}


class PermissionModel:
    """
    Maps roles to allowed policy gates.
    Production gate is never implicitly granted.
    """

    def __init__(self, role_grants: Dict[str, Set[str]] | None = None, is_admin: bool = False):
        self._grants: Dict[str, Set[str]] = role_grants if role_grants is not None else {}
        self._is_admin = is_admin

    @classmethod
    def from_defaults(cls, role: str) -> "PermissionModel":
        grants = {role: DEFAULT_GRANTS.get(role, set())}
        return cls(role_grants=grants)

    def can_pass_gate(self, role: str, gate_name: str) -> bool:
        if self._is_admin:
            return True
        return gate_name in self._grants.get(role, set())

    def grant(self, role: str, gate_name: str) -> None:
        """Explicitly grant a role access to a gate (trusted operation)."""
        self._grants.setdefault(role, set()).add(gate_name)

    def revoke(self, role: str, gate_name: str) -> None:
        self._grants.get(role, set()).discard(gate_name)