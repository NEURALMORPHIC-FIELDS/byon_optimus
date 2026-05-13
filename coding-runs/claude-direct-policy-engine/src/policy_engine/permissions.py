"""Simple permission model: roles → allowed gates.

Invariant: [invariant_production_requires_grant] — production gate is disabled by default
and must be explicitly configured outside workflow config.
"""
from __future__ import annotations
from typing import Dict, List, Set


# ---------------------------------------------------------------------------
# DEFAULT permission table — configured HERE, not in untrusted workflow YAML.
# Production-level gates (require explicit grant) are listed in PRODUCTION_GATES.
# ---------------------------------------------------------------------------
PRODUCTION_GATES: Set[str] = {"production_approval"}

_DEFAULT_ROLE_GATES: Dict[str, Set[str]] = {
    "developer": {"dev_gate", "test_gate"},
    "qa": {"dev_gate", "test_gate", "qa_gate"},
    "release_manager": {"dev_gate", "test_gate", "qa_gate", "staging_gate"},
    # production_approval is NOT granted to any role by default
}


class PermissionModel:
    """Resolve whether a set of roles is allowed to pass a policy gate."""

    def __init__(self, role_gates: Dict[str, Set[str]] | None = None, production_grants: Set[str] | None = None):
        # role_gates comes from trusted config, NOT from workflow YAML
        self._role_gates: Dict[str, Set[str]] = role_gates if role_gates is not None else {
            k: set(v) for k, v in _DEFAULT_ROLE_GATES.items()
        }
        # explicit production grants (outside workflow config)
        self._production_grants: Set[str] = production_grants if production_grants is not None else set()

    def allowed(self, gate_name: str, roles: List[str]) -> bool:
        """Return True if any role in *roles* is permitted to pass *gate_name*."""
        if gate_name in PRODUCTION_GATES:
            # production gates require an explicit out-of-band grant
            return gate_name in self._production_grants and any(
                gate_name in self._role_gates.get(r, set()) for r in roles
            ) or gate_name in self._production_grants

        for role in roles:
            if gate_name in self._role_gates.get(role, set()):
                return True
        return False

    def grant_production(self, gate_name: str) -> None:
        """Explicitly grant a production gate (called from trusted setup, not from YAML)."""
        self._production_grants.add(gate_name)

    def roles_for_gate(self, gate_name: str) -> List[str]:
        return [role for role, gates in self._role_gates.items() if gate_name in gates]