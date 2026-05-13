"""
WorkflowEngine — executes a WorkflowDefinition step by step.

Execution planning is now separated from execution:
  - WorkflowPlanner  builds an ExecutionPlan  (no side effects)
  - WorkflowEngine   executes an ExecutionPlan (writes audit, runs actions)

Public API (unchanged from P3):
  engine.run(workflow, context) -> ExecutionResult

New in P4:
  engine.plan(workflow, context) -> ExecutionPlan
    Returns the plan without executing anything.
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from .audit import AuditLog, AuditEntry
from .execution_plan import ExecutionPlan, StepPlan
from .planner import WorkflowPlanner
from .policies import PolicyEngine
from .workflow import WorkflowDefinition


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------

@dataclass
class StepResult:
    step_name: str
    status: str          # "success" | "failed" | "skipped" | "denied"
    output: Any = None
    error: Optional[str] = None


@dataclass
class ExecutionResult:
    workflow_name: str
    status: str          # "success" | "failed" | "partial"
    step_results: List[StepResult] = field(default_factory=list)

    @property
    def succeeded(self) -> bool:
        return self.status == "success"


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

ActionHandler = Callable[[str, Dict[str, Any]], Any]


class WorkflowEngine:
    """
    Executes workflows.

    Separation of concerns (P4):
      - Planning  → WorkflowPlanner.build_plan()   (pure, no side effects)
      - Execution → WorkflowEngine._execute_plan() (writes audit, runs actions)
    """

    def __init__(
        self,
        policy_engine: PolicyEngine,
        audit_log: AuditLog,
        action_handler: Optional[ActionHandler] = None,
    ) -> None:
        self._policy = policy_engine
        self._audit = audit_log
        self._action_handler = action_handler or _default_action_handler
        self._planner = WorkflowPlanner(policy_engine)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def plan(
        self,
        workflow: WorkflowDefinition,
        context: Optional[Dict[str, Any]] = None,
    ) -> ExecutionPlan:
        """
        Build and return an ExecutionPlan without executing anything.
        No audit entries are written.
        """
        ctx = {**workflow.context, **(context or {})}
        return self._planner.build_plan(workflow, ctx)

    def run(
        self,
        workflow: WorkflowDefinition,
        context: Optional[Dict[str, Any]] = None,
    ) -> ExecutionResult:
        """
        Plan then execute the workflow.

        Audit entries are written for every step (including skipped/denied).
        [invariant_audit_append_only]: entries are never removed or rewritten.
        """
        ctx = {**workflow.context, **(context or {})}
        execution_plan = self._planner.build_plan(workflow, ctx)
        return self._execute_plan(workflow.name, execution_plan, ctx)

    # ------------------------------------------------------------------
    # Internal execution
    # ------------------------------------------------------------------

    def _execute_plan(
        self,
        workflow_name: str,
        plan: ExecutionPlan,
        context: Dict[str, Any],
    ) -> ExecutionResult:
        self._audit.append(AuditEntry(
            event="workflow_start",
            workflow=workflow_name,
            detail={"step_count": len(plan.steps)},
        ))

        step_results: List[StepResult] = []
        failed_steps: set[str] = set()

        for sp in plan.steps:
            result = self._execute_step_plan(sp, workflow_name, context, failed_steps)
            step_results.append(result)
            if result.status == "failed":
                failed_steps.add(sp.step_name)

        overall = self._overall_status(step_results)
        self._audit.append(AuditEntry(
            event="workflow_end",
            workflow=workflow_name,
            detail={"status": overall},
        ))

        return ExecutionResult(
            workflow_name=workflow_name,
            status=overall,
            step_results=step_results,
        )

    def _execute_step_plan(
        self,
        sp: StepPlan,
        workflow_name: str,
        context: Dict[str, Any],
        failed_steps: set[str],
    ) -> StepResult:
        # [invariant_failed_step_blocks_dependents]: re-check at execution time
        blocked_deps = [d for d in sp.depends_on if d in failed_steps]
        if blocked_deps:
            self._audit.append(AuditEntry(
                event="step_skipped",
                workflow=workflow_name,
                step=sp.step_name,
                detail={"reason": f"dependency failed: {blocked_deps}"},
            ))
            return StepResult(
                step_name=sp.step_name,
                status="skipped",
                error=f"dependency failed: {blocked_deps}",
            )

        if not sp.will_execute:
            status = "denied" if sp.policy_result == "deny" else "skipped"
            self._audit.append(AuditEntry(
                event=f"step_{status}",
                workflow=workflow_name,
                step=sp.step_name,
                detail={"reason": sp.skip_reason},
            ))
            return StepResult(
                step_name=sp.step_name,
                status=status,
                error=sp.skip_reason,
            )

        # Execute
        self._audit.append(AuditEntry(
            event="step_start",
            workflow=workflow_name,
            step=sp.step_name,
        ))
        try:
            output = self._action_handler(sp.step_name, context)
            self._audit.append(AuditEntry(
                event="step_success",
                workflow=workflow_name,
                step=sp.step_name,
                detail={"output": str(output) if output is not None else None},
            ))
            return StepResult(step_name=sp.step_name, status="success", output=output)
        except Exception as exc:  # noqa: BLE001
            self._audit.append(AuditEntry(
                event="step_failed",
                workflow=workflow_name,
                step=sp.step_name,
                detail={"error": str(exc)},
            ))
            return StepResult(step_name=sp.step_name, status="failed", error=str(exc))

    @staticmethod
    def _overall_status(results: List[StepResult]) -> str:
        statuses = {r.status for r in results}
        if "failed" in statuses:
            return "failed"
        if statuses <= {"success", "skipped", "denied"}:
            if "success" in statuses:
                return "success"
            return "partial"
        return "partial"


# ---------------------------------------------------------------------------
# Default action handler
# ---------------------------------------------------------------------------

def _default_action_handler(step_name: str, context: Dict[str, Any]) -> str:
    """No-op handler used when no real handler is registered."""
    return f"executed:{step_name}"