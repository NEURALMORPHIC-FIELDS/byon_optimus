"""Tests for Planner (ExecutionPlan construction).

Covers:
  - RUN decision when condition passes and gates pass
  - SKIP decision when condition is false
  - DENY decision when a gate denies
  - BLOCK propagation from DENY and BLOCK predecessors
  - OVERRIDDEN gates in permissive mode
  - Skipped predecessor does NOT cause BLOCK (only DENY/BLOCK do)
  - as_dict / would_succeed / counts
  - Planner does NOT write to any audit log (pure)
"""
import pytest

from policy_engine.audit import AuditLog
from policy_engine.models import PolicyGate, Step, Workflow
from policy_engine.permissions import PermissionModel
from policy_engine.planner import Decision, Planner
from policy_engine.policy_mode import