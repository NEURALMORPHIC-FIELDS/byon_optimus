"""
Tests for ExecutionPlan, Planner, PlanValidator, PlanRenderer.

Coverage targets
----------------
* Planner.build()      — all decision types (RUN, SKIP, DENY, BLOCK,
                         SKIP_CONDITION_UNKNOWN)
* PlanValidator        — error / warning detection, valid / invalid results
* PlanRenderer         — text and dict output, colour flag
* Plan does NOT execute steps (no audit side effects)
* Separation invariant: engine run_count is unaffected by planning
"""
from __future__ import annotations

import json

import pytest

from policy_engine.audit import AuditLog
from policy_engine.engine import WorkflowEngine
from policy_engine.models import Step, StepStatus, Workflow
from policy_engine.planner import (
    ExecutionPlan,
    PlanRenderer,
    PlanValidator,
    Planner,
    StepDecision,
    PolicyResult,
    ValidationResult,
)
from policy_engine.policy import PermissionModel, PolicyGate, PolicyMode


# ── fixtures / factories ──────────────────────────────────────────────────────


def make_gate(
    role_grants: dict | None = None,
    production: bool = False,
    mode: PolicyMode = PolicyMode.ENFORCED,
    audit: A