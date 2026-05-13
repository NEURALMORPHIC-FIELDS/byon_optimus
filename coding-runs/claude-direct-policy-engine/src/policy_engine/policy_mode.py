"""Operator-controlled policy mode.

This module provides the ONLY legitimate fast-path for policy gate evaluation:
a permissive mode that is:
  - disabled by default
  - controlled OUTSIDE untrusted workflow YAML (env var or explicit API call)
  - audited every single time it overrides a gate decision
  - never silent — every override is recorded as 'OVERRIDDEN' in the audit log

Invariants:
  [invariant_no_policy_bypass]  — workflow YAML cannot set this; only operators can
  [invariant_audit_append_only] — every override is audited
  [invariant_production_requires_grant] — permissive mode still respects prod gates
                                          unless operator explicitly unlocks them too
"""
from __future__ import annotations

import os
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .audit import AuditLog

# Environment variable name that operators (repo owners, CI infra) may set.
# It is intentionally verbose so it cannot be set accidentally.
_ENV_VAR = "WORKFLOW_POLICY_MODE"

# The only accepted non-default value.
_PERMISSIVE_VALUE = "permissive"


class PolicyMode(str, Enum):
    """Operating mode for policy gate evaluation."""

    ENFORCING = "enforcing"   # default — gates are always enforced
    PERMISSIVE = "permissive" # operator fast-path — gates log OVERRIDDEN, not denied


def resolve_policy_mode(explicit: str | None = None) -> PolicyMode:
    """Determine the active PolicyMode.

    Priority (highest → lowest):
      1. *explicit* argument passed by operator code (e.g. test fixture).
      2. ``WORKFLOW_POLICY_MODE`` environment variable.
      3. Default: ENFORCING.

    Workflow YAML/JSON is intentionally NOT consulted here.
    [invariant_no_policy_bypass]
    """
    raw = explicit or os.environ.get(_ENV_VAR, "")
    if raw.strip().lower() == _PERMISSIVE_VALUE:
        return PolicyMode.PERMISSIVE
    return PolicyMode.ENFORCING


def audit_mode_activation(audit: "AuditLog", mode: PolicyMode) -> None:
    """Record the active policy mode at workflow-start time."""
    if mode == PolicyMode.PERMISSIVE:
        audit.record(
            "policy_mode_override",
            (
                "POLICY MODE: PERMISSIVE — gate denials are overridden. "
                "This mode is operator-controlled and must NEVER be set from "
                "untrusted workflow YAML. All overrides are recorded below."
            ),
            actor="operator",
        )
    else:
        audit.record(
            "policy_mode",
            "POLICY MODE: ENFORCING (default) — all gates strictly enforced.",
            actor="system",
        )