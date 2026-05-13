"""Execution planning — pure data structures and planning logic.

ExecutionPlan   — immutable snapshot of what *would* happen.
PlanValidator   — validates a plan against policies + invariants.
PlanRenderer    — human-readable and machine-readable views.

No step is executed here; no audit entries are written.

Phase-4 bug fix applied here
-----------------------------
``_plan_step`` previously included ``StepDecision.SKIP`` in the set of
decisions that trigger downstream BLOCK propagation.  A skipped step is a
*satisfied* terminal state (the step was intentionally bypassed, not
failed), so its dependents must not be blocked.

Fixed: ``StepDecision.SKIP`` is explicitly excluded from
``_PLANNER_BLOCKING_DECISIONS``.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from .conditions import ConditionError, evaluate_condition
from .models import Step, StepStatus, Workflow
from .policy import PolicyGate


# ── Decision types ────────────────────────────────────────────────────────────


class StepDecision(Enum):
    """Predicted outcome for a step at plan time."""
    RUN = "run"
    SKIP = "skip"                        # condition false at plan time
    SKIP_CONDITION_UNKNOWN = "skip_condition_unknown"  # vars not yet known
    BLOCK = "block"                      # a dependency is predicted to fail/block
    DENY = "deny"                        # policy gate will deny the role
    UNKNOWN = "unknown"                  # cannot be determined statically


class PolicyResult(Enum):
    """Predicted policy gate outcome."""
    ALLOW = "allow"
    DENY = "deny"
    OVERRIDE = "override"    # permissive mode active
    NO_GATE = "no_gate"
    UNKNOWN = "unknown"


# ---------------------------------------------------------------------------
# Decisions that propagate as "blocking" to downstream steps.
#
# SKIP is intentionally absent: a skipped step is a satisfied terminal
# state.  Its dependents should proceed.  (This mirrors _SATISFIED in
# engine.py.)
#
# SKIP_CONDITION_UNKNOWN *is* included because we cannot guarantee the
# step will eventually be satisfied — the planner must be conservative.
# ---------------------------------------------------------------------------
_PLANNER_BLOCKING_DECISIONS: frozenset[StepDecision] = frozenset({
    StepDecision.DENY,
    StepDecision.BLOCK,
    StepDecision.UNKNOWN,
    StepDecision.SKIP_CONDITION_UNKNOWN,
    # StepDecision.SKIP is explicitly absent — see docstring above.
})


# ── Core data structures ──────────────────────────────────────────────────────


@dataclass(frozen=True)
class StepPlan:
    """Plan entry for a single step."""
    step: Step
    decision: StepDecision
    policy_result: PolicyResult
    policy_reason: str
    condition_result: bool | None
    condition_reason: str
    blocked_by: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "step_id": self.step.id,
            "step_name": self.step.name,
            "action": self.step.action,
            "environment": self.step.environment,
            "depends_on": self.step.depends_on,
            "policy_gate": self.step.policy_gate,
            "decision": self.decision.value,
            "policy_result": self.policy_result.value,
            "policy_reason": self.policy_reason,
            "condition": self.step.condition,
            "condition_result": self.condition_result,
            "condition_reason": self.condition_reason,
            "blocked_by": list(self.blocked_by),
            "warnings": list(self.warnings),
        }


@dataclass(frozen=True)
class ExecutionPlan:
    """Immutable snapshot of the predicted execution order and outcomes."""
    workflow_id: str
    workflow_name: str
    role: str
    policy_mode: str
    variables: dict[str, Any]
    steps: list[StepPlan]
    run_count: int = 0
    skip_count: int = 0
    deny_count: int = 0
    block_count: int = 0
    unknown_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "workflow_id": self.workflow_id,
            "workflow_name": self.workflow_name,
            "role": self.role,
            "policy_mode": self.policy_mode,
            "variables": dict(self.variables),
            "summary": {
                "total": len(self.steps),
                "run": self.run_count,
                "skip": self.skip_count,
                "deny": self.deny_count,
                "block": self.block_count,
                "unknown": self.unknown_count,
            },
            "steps": [sp.to_dict() for sp in self.steps],
        }


# ── Planner ───────────────────────────────────────────────────────────────────


class Planner:
    """Builds an ``ExecutionPlan`` without executing any step."""

    def __init__(self, gate: PolicyGate) -> None:
        self._gate = gate

    def build(
        self,
        workflow: Workflow,
        role: str,
        run_vars: dict[str, Any] | None = None,
    ) -> ExecutionPlan:
        effective_vars: dict[str, Any] = {
            **workflow.variables,
            **(run_vars or {}),
        }
        predicted: dict[str, StepDecision] = {}
        step_plans: list[StepPlan] = []

        for step in workflow.steps:
            sp = self._plan_step(step, role, effective_vars, predicted)
            predicted[step.id] = sp.decision
            step_plans.append(sp)

        run_count = sum(1 for sp in step_plans if sp.decision is StepDecision.RUN)
        skip_count = sum(
            1 for sp in step_plans
            if sp.decision in (StepDecision.SKIP, StepDecision.SKIP_CONDITION_UNKNOWN)
        )
        deny_count = sum(1 for sp in step_plans if sp.decision is StepDecision.DENY)
        block_count = sum(1 for sp in step_plans if sp.decision is StepDecision.BLOCK)
        unknown_count = sum(
            1 for sp in step_plans if sp.decision is StepDecision.UNKNOWN
        )

        return ExecutionPlan(
            workflow_id=workflow.id,
            workflow_name=workflow.name,
            role=role,
            policy_mode=self._gate.mode.value,
            variables=effective_vars,
            steps=step_plans,
            run_count=run_count,
            skip_count=skip_count,
            deny_count=deny_count,
            block_count=block_count,
            unknown_count=unknown_count,
        )

    def _plan_step(
        self,
        step: Step,
        role: str,
        variables: dict[str, Any],
        predicted: dict[str, StepDecision],
    ) -> StepPlan:
        warnings: list[str] = []

        # 1. Check if a dependency is predicted to be blocking.
        #    SKIP is NOT in _PLANNER_BLOCKING_DECISIONS — a skipped
        #    predecessor is satisfied and must not block its dependents.
        blocking_deps = [
            dep for dep in step.