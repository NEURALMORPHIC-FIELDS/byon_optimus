"""Build and validate ExecutionPlan (topological sort, DAG validation).

Symbols defined here (canonical — do not redefine elsewhere):
  - PlanError
  - PlanValidator
  - PlanRenderer
  - build_plan
"""
from __future__ import annotations
from typing import Any

from policy_engine.models import WorkflowDefinition, ExecutionPlan, WorkflowStep


class PlanError(ValueError):
    pass


class PlanValidator:
    """Validates DAG structure. REQ_FAILED_BLOCKS_DEPENDENTS depends on correct ordering."""

    def validate(self, wf: WorkflowDefinition) -> None:
        names = {s.name for s in wf.steps}
        for step in wf.steps:
            for dep in step.depends_on:
                if dep not in names:
                    raise PlanError(f"Step {step.name!r} depends on unknown step {dep!r}")
        # cycle detection via DFS
        order = _topo_sort(wf.steps)
        if order is None:
            raise PlanError("Workflow contains a dependency cycle")


class PlanRenderer:
    """Renders a plan as human-readable text and machine-readable dict.

    Methods
    -------
    render(plan) -> str
        Human-readable multi-line summary (existing public API — unchanged).
    render_dict(plan) -> dict
        Machine-readable representation of the plan.
    """

    def render(self, plan: ExecutionPlan) -> str:
        """Return a human-readable plan summary string.

        Each step is rendered on its own numbered line so that step names
        can be located unambiguously even when the workflow name contains
        a substring that matches a step name.
        """
        lines = [f"Workflow: {plan.workflow.name}", "Execution order:"]
        for i, step in enumerate(plan.ordered_steps, 1):
            gates = ", ".join(step.policy_gates) or "none"
            cond = ""
            if step.condition is not None:
                cond = (
                    f" condition={step.condition.operator}"
                    f"({step.condition.var}=={step.condition.value!r})"
                )
            deps = ", ".join(step.depends_on) or "none"
            lines.append(
                f"  {i}. {step.name}"
                f" [action={step.action}"
                f" env={step.environment}"
                f" gates={gates}"
                f" depends_on={deps}"
                f"{cond}]"
            )
        return "\n".join(lines)

    def render_dict(self, plan: ExecutionPlan) -> dict[str, Any]:
        """Return a machine-readable dict representation of the plan."""
        steps_list = []
        for i, step in enumerate(plan.ordered_steps, 1):
            entry: dict[str, Any] = {
                "order": i,
                "name": step.name,
                "action": step.action,
                "environment": step.environment,
                "depends_on": list(step.depends_on),
                "policy_gates": list(step.policy_gates),
                "condition": None,
            }
            if step.condition is not None:
                entry["condition"] = {
                    "operator": step.condition.operator,
                    "var": step.condition.var,
                    "value": step.condition.value,
                }
            steps_list.append(entry)
        return {
            "workflow": plan.workflow.name,
            "step_count": len(plan.ordered_steps),
            "steps": steps_list,
        }


def build_plan(wf: WorkflowDefinition) -> ExecutionPlan:
    PlanValidator().validate(wf)
    ordered = _topo_sort(wf.steps)
    return ExecutionPlan(workflow=wf, ordered_steps=ordered)


def _topo_sort(steps: list[WorkflowStep]) -> list[WorkflowStep] | None:
    index = {s.name: s for s in steps}
    visited: set[str] = set()
    temp: set[str] = set()
    result: list[WorkflowStep] = []

    def visit(name: str) -> bool:
        if name in temp:
            return False  # cycle
        if name in visited:
            return True
        temp.add(name)
        for dep in index[name].depends_on:
            if not visit(dep):
                return False
        temp.discard(name)
        visited.add(name)
        result.append(index[name])
        return True

    for s in steps:
        if s.name not in visited:
            if not visit(s.name):
                return None
    return result