"""Operator-controlled policy mode. REQ_NO_POLICY_BYPASS + REQ_CONFIG_UNTRUSTED.

Policy mode is NOT a workflow-file setting.  It is an operator-controlled
parameter that lives outside untrusted workflow YAML/JSON:

  * CLI flag:          ``--policy-mode=permissive``
  * Environment var:   ``POLICY_MODE=permissive``

Both are disabled by default (ENFORCE).  When PERMISSIVE is active every gate
check that would have been denied is instead recorded as ``OVERRIDDEN`` in the
audit log — it is never silently elided.

The workflow file itself cannot set or influence policy mode.  Any attempt to
do so is rejected by the loader (REQ_NO_POLICY_BYPASS).
"""
from __future__ import annotations
import os
from enum import Enum


class PolicyMode(Enum):
    """Operator-controlled execution mode for policy gates.

    ENFORCE (default)
        All policy gates are enforced normally.  A denied gate blocks the step.

    PERMISSIVE
        Gate failures are recorded as OVERRIDDEN in the audit log and execution
        continues.  Intended for operator-controlled test environments only.
        Must never be set from within an untrusted workflow file.
    """
    ENFORCE = "enforce"
    PERMISSIVE = "permissive"


def get_policy_mode_from_env() -> PolicyMode:
    """Read POLICY_MODE environment variable.  Defaults to ENFORCE.

    Only ``permissive`` (case-insensitive) activates PERMISSIVE mode.
    Any other value (including empty string) is treated as ENFORCE.
    """
    raw = os.environ.get("POLICY_MODE", "").strip().lower()
    if raw == PolicyMode.PERMISSIVE.value:
        return PolicyMode.PERMISSIVE
    return PolicyMode.ENFORCE