"""PolicyGate and PermissionModel.

invariant_no_policy_bypass  — gate config lives here, not in workflow YAML.
invariant_production_requires_grant — production gate disabled by default.

Permissive mode
---------------
Operator-controlled only.  Never readable from untrusted workflow config.
When active every gate evaluation is OVERRIDDEN (not silently skipped) and
an audit entry is written so there is a full record.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .audit import AuditLog


class PolicyMode(Enum):
    """Operator-controlled execution mode.

    ENFORCED   — normal operation; all gates enforced (default).
    PERMISSIVE — gates are overridden but *recorded* in the audit log.
                 Must be set outside untrusted workflow config (CLI flag,
                 env-var, or test fixture only).
    """
    ENFORCED = "enforced"
    PERMISSIVE = "permissive"


@dataclass
class PermissionModel:
    """Maps roles to the set of policy gates they may pass."""
    role_grants: dict[str, set[str]] = field(default_factory=dict)

    # production gate is DISABLED by default (invariant_production_requires_grant)
    production_granted: bool = False

    @classmethod
    def default(cls) -> "PermissionModel":
        return cls(
            role_grants={
                "developer": {"build_gate", "test_gate", "notify_gate"},
                "deployer": {
                    "build_gate", "test_gate", "deploy_gate", "notify_gate",
                },
                "admin": {
                    "build_gate", "test_gate", "deploy_gate",
                    "notify_gate", "migrate_gate",
                },
            },
            production_granted=False,
        )

    def grant_production(self) -> None:
        """Explicit out-of-band call required to enable production gate."""
        self.production_granted = True

    def can_pass(self, role: str, gate: str) -> bool:
        if gate == "production_gate" and not self.production_granted:
            return False
        allowed = self.role_grants.get(role, set())
        return gate in allowed


class PolicyGate:
    """Evaluates whether a step's gate is satisfied for a given role.

    Parameters
    ----------
    permission_model:
        The operator-configured permission model.
    mode:
        ``PolicyMode.ENFORCED`` (default) or ``PolicyMode.PERMISSIVE``.
        Permissive mode must be set by the operator, never from workflow YAML.
    audit:
        Optional AuditLog.  When supplied, permissive overrides are recorded.
    """

    def __init__(
        self,
        permission_model: PermissionModel,
        mode: PolicyMode = PolicyMode.ENFORCED,
        audit: "AuditLog | None" = None,
    ) -> None:
        self._model = permission_model
        self._mode = mode
        self._audit = audit

    @property
    def mode(self) -> PolicyMode:
        return self._mode

    def evaluate(self, gate: str | None, role: str) -> tuple[bool, str]:
        """Return (allowed, reason).

        In PERMISSIVE mode every gate that *would* be denied is instead
        OVERRIDDEN — but the decision is recorded in the audit log.
        """
        if gate is None:
            return True, "no gate"

        normally_ok = self._model.can_pass(role, gate)

        if self._mode is PolicyMode.PERMISSIVE:
            reason = (
                f"OVERRIDDEN by permissive mode "
                f"(would have been {'granted' if normally_ok else 'denied'} "
                f"for role {role!r} on gate {gate!r})"
            )
            if self._audit is not None:
                self._audit.append(
                    "policy_gate_overridden",
                    gate=gate,
                    role=role,
                    normally_ok=normally_ok,
                    reason=reason,
                )
            return True, reason

        # ENFORCED (default)
        reason = (
            "granted"
            if normally_ok
            else f"role {role!r} denied for gate {gate!r}"
        )
        return normally_ok, reason