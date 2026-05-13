"""
Policy gate enforcement.

invariant_no_policy_bypass   — gates cannot be skipped via workflow config.
invariant_production_requires_grant — production gate requires explicit grant.

Safe test / operator escape hatch
----------------------------------
If the *operator* (not the workflow author) needs a permissive mode (e.g. for
local dev or CI smoke tests), they set PolicyMode.PERMISSIVE via a trusted
call-site (CLI flag --policy-mode=permissive, env var, or test fixture).

PERMISSIVE mode:
  * Is NEVER activated by anything inside a workflow YAML/JSON file.
  * Is disabled by default.
  * Records every overridden gate decision as 'policy_overridden' in the
    audit log — decisions are never silently elided.
  * Is clearly distinguished from a genuine PASS in StepResult messages.
"""
from __future__ import annotations
from enum import Enum
from typing import Dict

from .models import PolicyGate, Step
from .permissions import PermissionModel


class PolicyViolation(Exception):
    pass


class PolicyMode(str, Enum):
    ENFORCED   = "enforced"    # default — all gates strictly enforced
    PERMISSIVE = "permissive"  # operator opt-in — gates overridden + audited


class PolicyDecision:
    """Outcome of a single gate check."""
    __slots__ = ("passed", "overridden", "reason")

    def __init__(self, passed: bool, overridden: bool = False, reason: str = ""):
        self.passed = passed
        self.overridden = overridden
        self.reason = reason

    def __repr__(self):  # pragma: no cover
        return (
            f"PolicyDecision(passed={self.passed}, "
            f"overridden={self.overridden}, reason={self.reason!r})"
        )


class PolicyEngine:
    """
    Evaluates whether a step may execute.

    Parameters
    ----------
    gates       : trusted gate registry (never from workflow YAML)
    permissions : role → allowed gates
    role        : the role executing this run
    mode        : PolicyMode.ENFORCED (default) or PolicyMode.PERMISSIVE
                  (operator-controlled only — never set from workflow config)
    """

    def __init__(
        self,
        gates: Dict[str, PolicyGate],
        permissions: PermissionModel,
        role: str,
        mode: PolicyMode = PolicyMode.ENFORCED,
    ):
        self._gates = gates
        self._permissions = permissions
        self._role = role
        self._mode = mode

    @property
    def mode(self) -> PolicyMode:
        return self._mode

    def check(self, step: Step) -> PolicyDecision:
        """
        Return a PolicyDecision for *step*.

        * ENFORCED mode  — raises PolicyViolation on denial.
        * PERMISSIVE mode — never raises; returns overridden=True when the
          role would normally be denied (caller must audit the override).
        """
        if step.policy_gate is None:
            return PolicyDecision(passed=True)

        gate = self._gates.get(step.policy_gate)
        if gate is None:
            # Unknown gate is always an error regardless of mode.
            raise PolicyViolation(
                f"Step '{step.id}' references unknown policy gate '{step.policy_gate}'"
            )

        permitted = self._permissions.can_pass_gate(self._role, gate.name)

        if permitted:
            return PolicyDecision(passed=True)

        if self._mode is PolicyMode.PERMISSIVE:
            return PolicyDecision(
                passed=True,
                overridden=True,
                reason=(
                    f"POLICY OVERRIDDEN (permissive mode): role '{self._role}' "
                    f"would be denied gate '{gate.name}' for step '{step.id}'"
                ),
            )

        # ENFORCED + not permitted
        raise PolicyViolation(
            f"Role '{self._role}' is not permitted to pass gate '{gate.name}' "
            f"(required for step '{step.id}')"
        )


# ---------------------------------------------------------------------------
# Default gate registry — trusted, defined in source, never from YAML/JSON
# ---------------------------------------------------------------------------
DEFAULT_GATES: Dict[str, PolicyGate] = {
    "lint-gate": PolicyGate("lint-gate", "developer", "Requires developer role"),
    "test-gate":  PolicyGate("test-gate",  "developer", "Requires developer role"),
    "build-gate": PolicyGate("build-gate", "developer", "Requires developer role"),
    "staging-gate": PolicyGate("staging-gate", "deployer", "Requires deployer role"),
    "production-gate": PolicyGate(
        "production-gate", "release-manager",
        "Requires release-manager role — production deployment",
        is_production=True,
    ),
}