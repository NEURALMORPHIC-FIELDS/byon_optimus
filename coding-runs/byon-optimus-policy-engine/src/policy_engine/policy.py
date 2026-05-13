"""
Policy engine.

[invariant_no_policy_bypass] Policy cannot be disabled by workflow config.
[invariant_production_requires_grant] Production approval requires an explicit grant,
 configured outside untrusted workflow config.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from.loader import StepDefinition


class PolicyEngine:
 """
 Evaluates policy rules against a step and runtime context.

 Grants are configured programmatically (trusted operator code),
 never from untrusted workflow YAML.
 """

 def __init__(self) -> None:
 self._grants: Dict[str, bool] = {}

 # ------------------------------------------------------------------
 # Operator API (trusted — called from application code, not YAML)
 # ------------------------------------------------------------------

 def grant(self, tag: str) -> None:
 """Enable a policy tag. Called by trusted operator code only."""
 self._grants[tag] = True

 def revoke(self, tag: str) -> None:
 """Disable a policy tag."""
 self._grants[tag] = False

 # ------------------------------------------------------------------
 # Check
 # ------------------------------------------------------------------

 def check(
 self,
 step: StepDefinition,
 context: Dict[str, Any], # noqa: ARG002 — reserved for future context-aware rules
 ) -> Tuple[bool, str]:
 """
 Return (allowed, reason).

 Rules:
 - A step tagged 'production' requires an explicit grant.
 [invariant_production_requires_grant]
 - All other steps are allowed by default.
 """
 for tag in step.policy_tags:
 if tag == "production":
 if not self._grants.get("production", False):
 return False, "production grant not enabled"
 # Additional tag rules can be added here.

 return True, "ok"