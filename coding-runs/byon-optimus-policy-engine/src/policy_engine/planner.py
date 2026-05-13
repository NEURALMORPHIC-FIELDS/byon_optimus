"""Build and validate ExecutionPlan (topological sort, DAG validation, policy prediction).

Public API additions in P4
--------------------------
build_plan(wf, permissions=None)
    permissions: PermissionModel | None
        When supplied, each PlanStep carries a predicted gate decision.
        When None, decision='run' and predicted_policy='unknown (no permissions supplied)'.

PlanValidator.validate(wf, permissions=None)
    Validates DAG structure (always).
    When permissions is supplied, also validates that every gate name referenced
    by a step is a known gate (unknown gates are always denied — REQ_NO_POLICY_BYPASS).

PlanRenderer.render(plan, permissions=None)
    Renders a human-readable plan.
    When permissions is supplied (or plan already carries PlanStep predictions),
    the predicted gate outcome is shown per step.
    Also exposes render_dict(plan) → list[dict] for machine-readable output.
"""
from __future__ import annotations
from collections import deque
from typing import TYPE_CHECKING

from .models import ExecutionPlan, PlanStep, WorkflowDefinition, WorkflowStep

if TYPE_CHECKING:
    from .permissions import PermissionModel


class PlanError(ValueError):
    pass


class PlanValidator:
    """Validates DAG structure and optionally predicts policy outcomes.

    REQ_FAILED_BLOCKS_DEPENDENTS depends on correct ordering.
    REQ_NO_POLICY_BYPASS: unknown gates are always denied.
    """

    def validate(
        self,
        wf: WorkflowDefinition,
        permissions: "PermissionModel | None" = None,
    ) -> None:
        """Validate the workflow DAG.

        Parameters
        ----------
        wf          : workflow to validate
        permissions : optional — when supplied, unknown gate names are flagged
                      as warnings in the returned structure (they will be denied
                      at runtime).  This does NOT raise; it is informational.
                      Structural errors (unknown deps, cycles) always raise PlanError.
        """
        names = {s.name for s in wf.steps}
        for step in wf.steps:
            for dep in step.depends_on:
                if dep not in names:
                    raise PlanError(
                        f"Step '{step.name}' depends on unknown step '{dep}'"
                    )
        # cycle detection via DFS
        visiting: set[str] = set()
        visited: set[str] = set()
        index = {s.name: s for s in wf.steps}

        def dfs(name: str) -> None:
            if name in visiting:
                raise PlanError(f"Cycle detected involving step '{name}'")
            if name in visited:
                return
            visiting.add(name)
            for dep in index[name].depends_on:
                dfs(dep)
            visiting.remove(name)
            visited.add(name)

        for s in wf.steps:
            dfs(s.name)

        # Optional: warn about unknown gate names (informational, not structural)
        if permissions is not None:
            known_gate_names = {g.name for g in permissions.list_gates()}
            for step in wf.steps:
                for gate in step.policy_gates:
                    if gate not in known_gate_names:
                        # Unknown gates are denied at runtime (REQ_NO_POLICY_BYPASS).
                        # Surfaced via PlanStep.predicted_policy in build_plan.
                        pass


def _topo_sort(wf: WorkflowDefinition) -> list[WorkflowStep]:
    """Kahn's algorithm — returns steps in topological order.

    Raises PlanError on cycle (should already be caught by PlanValidator,
    but defended here too).
    """
    index = {s.name: s for s in wf.steps}
    in_degree: dict[str, int] = {s.name: 0 for s in wf.steps}
    dependents: dict[str, list[str]] = {s.name: [] for s in wf.steps}

    for step in wf.steps:
        for dep in step.depends_on:
            in_degree[step.name] += 1
            dependents[dep].append(step.name)

    queue: deque[str] = deque(
        name for name, deg in in_degree.items() if deg == 0
    )
    # Stable ordering: sort zero-in-degree nodes by their original position
    position = {s.name: i for i, s in enumerate(wf.steps)}
    queue = deque(sorted(queue, key=lambda n: position[n]))

    ordered: list[WorkflowStep] = []
    while queue:
        name = queue.popleft()
        ordered.append(index[name])
        # Sort newly-unblocked nodes for deterministic output
        newly_free = []
        for child in dependents[name]:
            in_degree[child] -= 1
            if in_degree[child] == 0:
                newly_free.append(child)
        for n in sorted(newly_free, key=lambda x: position[x]):
            queue.append(n)

    if len(ordered) != len(wf.steps):
        raise PlanError("Cycle detected in workflow DAG")

    return ordered


def _predict_step(
    step: WorkflowStep,
    hard_denied: set[str],
    permissions: "PermissionModel | None",
) -> PlanStep:
    """Predict the outcome of a single step given already-denied predecessors.

    Parameters
    ----------
    step        : step to predict
    hard_denied : set of step names that are predicted gate_denied or blocked.
                  Skipped steps are NOT in hard_denied — a skipped predecessor
                  does not block dependents (REQ_FAILED_BLOCKS_DEPENDENTS).
    permissions : if None, decision is 'run' with 'unknown' policy summary
    """
    # Blocked by a hard-denied predecessor?
    if any(dep in hard_denied for dep in step.depends_on):
        return PlanStep(
            step=step,
            decision="blocked",
            predicted_policy="blocked — predecessor predicted gate_denied or blocked",
        )

    if permissions is None:
        return PlanStep(
            step=step,
            decision="run",
            predicted_policy="unknown (no permissions supplied)",
        )

    # Gate prediction
    denied_gates = [
        g for g in step.policy_gates
        if not permissions.check(g, step.environment)
    ]
    if denied_gates:
        summary = (
            f"gate_denied: {', '.join(denied_gates)} "
            f"denied for role '{permissions.role}'"
        )
        return PlanStep(
            step=step,
            decision="gate_denied",
            predicted_policy=summary,
        )

    if step.policy_gates:
        passing = ", ".join(step.policy_gates)
        summary = f"all gates pass ({passing})"
    else:
        summary = "no gates"
    return PlanStep(step=step, decision="run", predicted_policy=summary)


class PlanRenderer:
    """Produces human-readable and machine-readable descriptions of an ExecutionPlan."""

    def render(self, plan: ExecutionPlan) -> str:
        """Return a human-readable multi-line string describing the plan."""
        lines = [f"Workflow: {plan.workflow.name}", "Execution order:"]

        if plan.plan_steps:
            for i, ps in enumerate(plan.plan_steps, 1):
                step = ps.step
                gates = ", ".join(step.policy_gates) or "none"
                deps = ", ".join(step.depends_on) or "none"
                if step.condition is not None:
                    cond = (
                        f"{step.condition.operator}("
                        f"{step.condition.var}=={step.condition.value!r})"
                    )
                else:
                    cond = "none"
                lines.append(
                    f"  {i}. [{step.environment}] {step.name} "
                    f"(action={step.action}, gates={gates}, "
                    f"depends_on={deps}, condition={cond}) "
                    f"→ {ps.decision} [{ps.predicted_policy}]"
                )
        else:
            for i, step in enumerate(plan.ordered_steps, 1):
                gates = ", ".join(step.policy_gates) or "none"
                deps = ", ".join(step.depends_on) or "none"
                if step.condition is not None:
                    cond = (
                        f"{step.condition.operator}("
                        f"{step.condition.var}=={step.condition.value!r})"
                    )
                else:
                    cond = "none"
                lines.append(
                    f"  {i}. [{step.environment}] {step.name} "
                    f"(action={step.action}, gates={gates}, "
                    f"depends_on={deps}, condition={cond})"
                )

        return "\n".join(lines)

    def render_dict(self, plan: ExecutionPlan) -> list[dict]:
        """Return a machine-readable list of dicts, one per step."""
        result = []
        if plan.plan_steps:
            for ps in plan.plan_steps:
                step = ps.step
                result.append({
                    "name": step.name,
                    "action": step.action,
                    "environment": step.environment,
                    "depends_on": list(step.depends_on),
                    "policy_gates": list(step.policy_gates),
                    "condition": (
                        {
                            "operator": step.condition.operator,
                            "var": step.condition.var,
                            "value": step.condition.value,
                        }
                        if step.condition is not None
                        else None
                    ),
                    "decision": ps.decision,
                    "predicted_policy": ps.predicted_policy,
                })
        else:
            for step in plan.ordered_steps:
                result.append({
                    "name": step.name,
                    "action": step.action,
                    "environment": step.environment,
                    "depends_on": list(step.depends_on),
                    "policy_gates": list(step.policy_gates),
                    "condition": (
                        {
                            "operator": step.condition.operator,
                            "var": step.condition.var,
                            "value": step.condition.value,
                        }
                        if step.condition is not None
                        else None
                    ),
                    "decision": "run",
                    "predicted_policy": "unknown (no permissions supplied)",
                })
        return result


def build_plan(
    wf: WorkflowDefinition,
    permissions: "PermissionModel | None" = None,
) -> ExecutionPlan:
    """Topological sort → ExecutionPlan.

    Parameters
    ----------
    wf          : validated workflow definition
    permissions : optional PermissionModel used to predict gate outcomes.
                  When None, all PlanStep entries have decision='run' and
                  predicted_policy='unknown (no permissions supplied)'.
                  The engine's actual gate checks are unaffected by this prediction.

    Returns
    -------
    ExecutionPlan with both ordered_steps (backward-compat) and plan_steps (new).

    Bug fix (P5): skipped-step regression
    --------------------------------------
    hard_denied tracks only gate_denied and blocked predictions.
    A step whose condition would cause it to be skipped at runtime is NOT
    added to hard_denied — its dependents must not be predicted as blocked.
    Conditions are not evaluated at plan time (no execution context is
    available); conditional steps are always predicted as 'run' unless a
    gate denies them.
    """
    PlanValidator().validate(wf, permissions=permissions)
    ordered = _topo_sort(wf)

    # hard_denied: steps predicted gate_denied or blocked.
    # IMPORTANT: skipped steps are never added here.
    # A skipped predecessor does NOT block dependents
    # (REQ_FAILED_BLOCKS_DEPENDENTS applies only to hard failures).
    hard_denied: set[str] = set()
    plan_steps: list[PlanStep] = []

    for step in ordered:
        ps = _predict_step(step, hard_denied, permissions)
        plan_steps.append(ps)
        # Only hard failures propagate the block — never skipped.
        if ps.decision in ("gate_denied", "blocked"):
            hard_denied.add(step.name)

    return ExecutionPlan(
        workflow=wf,
        ordered_steps=ordered,
        plan_steps=plan_steps,
    )