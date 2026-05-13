"""
PolicyEngine — evaluates whether a step is permitted to execute.

Policy grants are configured OUTSIDE untrusted workflow config
([invariant_no_policy_bypass], [invariant_production_requires_grant]).

The engine is the sole authority on allow/deny decisions.
Workflow YAML/JSON cannot influence policy outcomes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set


@dataclass
class PolicyGrant:
    """
    An explicit grant allowing a step (or pattern) to execute.

    Grants are configured by operators, not by workflow authors.
    """
    step_name: str                        # exact name or "*" for wildcard
    required_context: Dict[str, Any] = field(default_factory=dict)
    environments: Optional[List[str]] = None   # None = all environments


class PolicyEngine:
    """
    Evaluates step execution permission.

    Default posture: DENY.
    Steps are allowed only when a matching PolicyGrant exists.

    Production steps additionally require a grant with environments
    containing "production" ([invariant_production_requires_grant]).
    """

    def __init__(self) -> None:
        self._grants: List[PolicyGrant] = []

    def add_grant(self, grant: PolicyGrant) -> None:
        self._grants.append(grant)

    def check(self, step_name: str, context: Dict[str, Any]) -> bool:
        """
        Returns True (allow) or False (deny).

        Checks grants in order; first matching grant wins.
        """
        environment = context.get("environment", "")

        for grant in self._grants:
            if not self._matches_step(grant, step_name):
                continue
            if not self._matches_environment(grant, environment):
                continue
            if not self._matches_context(grant, context):
                continue
            return True

        return False

    # ------------------------------------------------------------------

    def _matches_step(self, grant: PolicyGrant, step_name: str) -> bool:
        return grant.step_name == "*" or grant.step_name == step_name

    def _matches_environment(self, grant: PolicyGrant, environment: str) -> bool:
        if grant.environments is None:
            return True
        return environment in grant.environments

    def _matches_context(self, grant: PolicyGrant, context: Dict[str, Any]) -> bool:
        for key, expected in grant.required_context.items():
            if context.get(key) != expected:
                return False
        return True


# ---------------------------------------------------------------------------
# Factory helpers
# ---------------------------------------------------------------------------

def make_permissive_policy() -> PolicyEngine:
    """Allow all steps in all environments. Useful for non-production testing."""
    engine = PolicyEngine()
    engine.add_grant(PolicyGrant(step_name="*"))
    return engine


def make_production_policy(approved_steps: List[str]) -> PolicyEngine:
    """
    Allow listed steps in production; allow everything else in non-production.
    [invariant_production_requires_grant]: production requires explicit grant.
    """
    engine = PolicyEngine()
    # Non-production wildcard
    engine.add_grant(PolicyGrant(step_name="*", environments=["staging", "dev", "test"]))
    # Explicit production grants
    for step in approved_steps:
        engine.add_grant(PolicyGrant(step_name=step, environments=["production"]))
    return engine