"""
WorkflowPlanner — builds an ExecutionPlan from a WorkflowDefinition + context
without executing any steps.

This is the bridge between the existing engine internals and the new
ExecutionPlan data structure introduced in P4.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .execution_plan import ExecutionPlan, StepPlan
from .workflow import WorkflowDefinition, WorkflowStep
from .conditions import evaluate_condition
from .policies import PolicyEngine


class WorkflowPlanner:
    """
    Builds an ExecutionPlan by dry-running the decision logic:
      - evaluates conditions against the provided context
      - queries the policy engine for each step
      - propagates dependency-blocked status

    No side effects: no audit writes, no step execution.
    """

    def __init__(self, policy_engine: PolicyEngine) -> None:
        self._policy = policy_engine

    def build_plan(
        self,
        workflow: WorkflowDefinition,
        context: Dict[str, Any],
    ) -> ExecutionPlan:
        plan = ExecutionPlan()

        # Track which steps will NOT execute so dependents can be blocked.
        blocked: set[str] = set()

        for step in workflow.steps:
            step_plan = self._plan_step(step, context, blocked)
            plan.steps.append(step_plan)
            if not step_plan.will_execute:
                blocked.add(step.name)

        return plan

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _plan_step(
        self,
        step: WorkflowStep,
        context: Dict[str, Any],
        blocked: set[str],
    ) -> StepPlan:
        depends_on: List[str] = list(step.depends_on or [])

        # [invariant_failed_step_blocks_dependents]
        blocked_deps = [d for d in depends_on if d in blocked]
        if blocked_deps:
            return StepPlan(
                step_name=step.name,
                depends_on=depends_on,
                condition_met=None,
                policy_result="skip",
                will_execute=False,
                skip_reason=f"dependency blocked: {blocked_deps}",
            )

        # Evaluate condition (if any)
        condition_met: Optional[bool] = None
        if step.condition is not None:
            condition_met = evaluate_condition(step.condition, context)
            if not condition_met:
                return StepPlan(
                    step_name=step.name,
                    depends_on=depends_on,
                    condition_met=condition_met,
                    policy_result="skip",
                    will_execute=False,
                    skip_reason="condition not met",
                )

        # Query policy engine
        policy_result = self._evaluate_policy(step, context)

        if policy_result == "deny":
            return StepPlan(
                step_name=step.name,
                depends_on=depends_on,
                condition_met=condition_met,
                policy_result="deny",
                will_execute=False,
                skip_reason="denied by policy",
            )

        return StepPlan(
            step_name=step.name,
            depends_on=depends_on,
            condition_met=condition_met,
            policy_result=policy_result,
            will_execute=True,
            skip_reason=None,
        )

    def _evaluate_policy(
        self, step: WorkflowStep, context: Dict[str, Any]
    ) -> str:
        """
        Returns "allow" or "deny".

        Delegates to PolicyEngine.check(); translates the result to the
        canonical string used in StepPlan.  The policy engine is the sole
        authority — workflow config cannot override it
        ([invariant_no_policy_bypass]).
        """
        allowed = self._policy.check(step.name, context)
        return "allow" if allowed else "deny"