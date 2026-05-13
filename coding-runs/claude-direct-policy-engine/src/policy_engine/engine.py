"""Workflow execution engine.

Phase 3 refactor: execution planning is separated from execution.
  - ``Planner``         builds an ``ExecutionPlan``   (see planner.py)
  - ``PlanValidator``   validates a plan              (see planner.py)
  - ``PlanRenderer``    renders a plan                (see planner.py)
  - ``WorkflowEngine``  executes a workflow (unchanged public API)

Public API compatibility
------------------------
WorkflowEngine.run(workflow, role, run_vars=None) -> dict[str, StepStatus]
    Unchanged.

RollbackManager.rollback(executed_steps, workflow_id) -> None
    Unchanged.

Bug fix (Phase 4)
-----------------
SKIPPED steps were inadvertently treated as blocking by ``any_dep_blocking``
when the ``_BLOCKING`` set was inconsistently applied in a check that
also tested for *non-satisfied* states.  The fix makes the two predicates
exhaustive and mutually exclusive:

  * ``any_dep_blocking``  — True iff any dep is in ``_BLOCKING``
  * ``deps_satisfied``    — True iff ALL deps are in ``_SATISFIED``
  * a dep in any other terminal state (e.g. SKIPPED, which IS in _SATISFIED)
    must never trigger the blocking path.

The sets are now defined once, centrally, and both predicates are tested
explicitly in ``tests/test_regression_skipped_unblocks_dependents.py``.
"""
from __future__ import annotations

from typing import Any

from .audit import AuditLog
from .conditions import ConditionError, evaluate_condition
from .models import Step, StepStatus, Workflow
from .policy import PolicyGate

# ---------------------------------------------------------------------------
# Terminal-state classification
#
# _SATISFIED  — predecessor is done in a way that allows dependents to run.
#               SKIPPED counts as satisfied: the step did not fail, it was
#               intentionally bypassed; dependents should proceed.
#
# _BLOCKING   — predecessor is done in a way that prevents dependents from
#               running.  SKIPPED must NOT be in this set.
#
# These two sets must remain mutually exclusive.  Any StepStatus value that
# belongs to neither set is "not yet terminal" (PENDING, RUNNING).
# ---------------------------------------------------------------------------
_SATISFIED: frozenset[StepStatus] = frozenset({
    StepStatus.SUCCESS,
    StepStatus.SKIPPED,   # ← intentional: skipped ≠ failed
})
_BLOCKING: frozenset[StepStatus] = frozenset({
    StepStatus.FAILED,
    StepStatus.BLOCKED,
    # SKIPPED is explicitly absent — this is the fix for the Phase-4 bug.
})

# Sanity-check the invariant at import time so a future edit cannot
# silently break it.
assert _SATISFIED.isdisjoint(_BLOCKING), (
    "BUG: _SATISFIED and _BLOCKING must be disjoint. "
    "SKIPPED must never appear in _BLOCKING."
)


# ── ExecutionContext (internal) ───────────────────────────────────────────────


class ExecutionContext:
    """Mutable runtime state threaded through the engine.

    This class is *internal* to the engine.  External callers should use
    ``WorkflowEngine.run()`` and inspect the returned status dict.
    """

    def __init__(
        self,
        workflow: Workflow,
        role: str,
        audit: AuditLog,
        gate: PolicyGate,
        run_vars: dict[str, Any],
    ) -> None:
        self.workflow = workflow
        self.role = role
        self.audit = audit
        self.gate = gate
        self.variables: dict[str, Any] = {**workflow.variables, **run_vars}
        self._status: dict[str, StepStatus] = {
            s.id: StepStatus.PENDING for s in workflow.steps
        }

    def set_status(self, step_id: str, status: StepStatus) -> None:
        self._status[step_id] = status
        for s in self.workflow.steps:
            if s.id == step_id:
                s.status = status

    def get_status(self, step_id: str) -> StepStatus:
        return self._status[step_id]

    def deps_satisfied(self, step: Step) -> bool:
        """Return True iff every predecessor is in a *satisfied* terminal state.

        Both SUCCESS and SKIPPED are satisfied.  PENDING and RUNNING are not
        (we must wait).  FAILED/BLOCKED are not (but ``any_dep_blocking``
        catches those earlier in the loop — this predicate is only reached
        when no dep is blocking).
        """
        for dep in step.depends_on:
            if self._status.get(dep) not in _SATISFIED:
                return False
        return True

    def any_dep_blocking(self, step: Step) -> bool:
        """Return True iff any predecessor is in a *blocking* terminal state.

        Only FAILED and BLOCKED trigger this.  SKIPPED does NOT — a skipped
        predecessor must not prevent its dependents from running.
        """
        for dep in step.depends_on:
            if self._status.get(dep) in _BLOCKING:
                return True
        return False


# ── Simulation ────────────────────────────────────────────────────────────────


def _simulate_action(step: Step) -> tuple[bool, str]:
    """Simulate step execution — no real side effects."""
    if step.params.get("simulate_failure"):
        return False, f"[simulated] action {step.action!r} failed"
    return True, f"[simulated] action {step.action!r} succeeded"


# ── WorkflowEngine ────────────────────────────────────────────────────────────


class WorkflowEngine:
    """Executes a ``Workflow`` step by step, enforcing policies and auditing.

    Public API (unchanged from Phase 1/2/3)
    ----------------------------------------
    run(workflow, role, run_vars=None) -> dict[str, StepStatus]
    """

    def __init__(self, audit: AuditLog, gate: PolicyGate) -> None:
        self.audit = audit
        self.gate = gate
        self._executed: list[Step] = []

    def run(
        self,
        workflow: Workflow,
        role: str,
        run_vars: dict[str, Any] | None = None,
    ) -> dict[str, StepStatus]:
        """Execute *workflow* as *role*.

        Parameters
        ----------
        workflow:
            Validated ``Workflow`` object (from ``loader.load_workflow``).
        role:
            Operator-supplied role string.  Gates are evaluated against this.
        run_vars:
            Optional runtime variables merged on top of workflow-level
            variables.  Used for condition evaluation.

        Returns
        -------
        dict[str, StepStatus]
            Final status for every step keyed by step id.
        """
        effective_vars = dict(run_vars or {})
        self.audit.append(
            "workflow_start",
            workflow_id=workflow.id,
            role=role,
            policy_mode=self.gate.mode.value,
            variables=effective_vars,
        )
        ctx = ExecutionContext(
            workflow, role, self.audit, self.gate, effective_vars
        )

        remaining = list(workflow.steps)
        max_iters = len(remaining) ** 2 + 10
        iterations = 0

        while remaining:
            iterations += 1
            if iterations > max_iters:
                raise RuntimeError("Execution loop exceeded — possible cycle")

            progress = False

            for step in list(remaining):
                st = ctx.get_status(step.id)

                # Already resolved in a previous pass — drain from remaining.
                if st not in (StepStatus.PENDING,):
                    remaining.remove(step)
                    progress = True
                    continue

                # ── Blocking check (FAILED / BLOCKED predecessors) ────────────
                # invariant_failed_step_blocks_dependents
                # NOTE: SKIPPED predecessors must NOT trigger this branch.
                #       See _BLOCKING definition above and Phase-4 bug fix.
                if ctx.any_dep_blocking(step):
                    ctx.set_status(step.id, StepStatus.BLOCKED)
                    self.audit.append(
                        "step_blocked",
                        step_id=step.id,
                        workflow_id=workflow.id,
                        reason="dependency failed or blocked",
                    )
                    remaining.remove(step)
                    progress = True
                    continue

                # ── Wait for in-flight predecessors ───────────────────────────
                # deps_satisfied returns False when any dep is still PENDING /
                # RUNNING (i.e. not yet in _SATISFIED).  We simply skip this
                # step for the current iteration and revisit it next pass.
                if not ctx.deps_satisfied(step):
                    continue

                # ── Condition evaluation ──────────────────────────────────────
                if step.condition is not None:
                    try:
                        cond_result = evaluate_condition(
                            step.condition, ctx.variables
                        )
                    except ConditionError as exc:
                        ctx.set_status(step.id, StepStatus.FAILED)
                        self.audit.append(
                            "step_failed",
                            step_id=step.id,
                            workflow_id=workflow.id,
                            message=f"condition evaluation error: {exc}",
                        )
                        remaining.remove(step)
                        progress = True
                        continue

                    if not cond_result:
                        ctx.set_status(step.id, StepStatus.SKIPPED)
                        self.audit.append(
                            "step_skipped",
                            step_id=step.id,
                            workflow_id=workflow.id,
                            reason="condition not met",
                            condition=step.condition,
                        )
                        remaining.remove(step)
                        progress = True
                        continue

                # ── Policy gate (invariant_no_policy_bypass) ──────────────────
                ok, reason = self.gate.evaluate(step.policy_gate, role)
                if not ok:
                    self.audit.append(
                        "step_gate_denied",
                        step_id=step.id,
                        gate=step.policy_gate,
                        role=role,
                        reason=reason,
                        workflow_id=workflow.id,
                    )
                    ctx.set_status(step.id, StepStatus.FAILED)
                    remaining.remove(step)
                    progress = True
                    continue

                # ── Execute ───────────────────────────────────────────────────
                ctx.set_status(step.id, StepStatus.RUNNING)
                self.audit.append(
                    "step_start",
                    step_id=step.id,
                    action=step.action,
                    workflow_id=workflow.id,
                )
                success, msg = _simulate_action(step)
                if success:
                    ctx.set_status(step.id, StepStatus.SUCCESS)
                    self._executed.append(step)
                    self.audit.append(
                        "step_success",
                        step_id=step.id,
                        message=msg,
                        workflow_id=workflow.id,
                    )
                else:
                    ctx.set_status(step.id, StepStatus.FAILED)
                    self.audit.append(
                        "step_failed",
                        step_id=step.id,
                        message=msg,
                        workflow_id=workflow.id,
                    )

                remaining.remove(step)
                progress = True

            if not progress:
                # Deadlock guard — should be unreachable after DAG validation.
                for step in remaining:
                    ctx.set_status(step.id, StepStatus.BLOCKED)
                    self.audit.append(
                        "step_blocked",
                        step_id=step.id,
                        reason="deadlock",
                        workflow_id=workflow.id,
                    )
                break

        self.audit.append(
            "workflow_end",
            workflow_id=workflow.id,
            statuses={sid: s.value for sid, s in ctx._status.items()},
        )
        return dict(ctx._status)


# ── RollbackManager ───────────────────────────────────────────────────────────


class RollbackManager:
    """Undoes successfully executed steps in reverse order.

    invariant_rollback_preserves_audit: rollback is audited; history NOT erased.
    invariant_audit_append_only: only append() is called.

    Public API (unchanged)
    ----------------------
    rollback(executed_steps, workflow_id) -> None
    """

    def __init__(self, audit: AuditLog) -> None:
        self.audit = audit

    def rollback(self, executed_steps: list[Step], workflow_id: str) -> None:
        self.audit.append(
            "rollback_start",
            workflow_id=workflow_id,
            steps=[s.id for s in executed_steps],
        )
        for step in reversed(executed_steps):
            self.audit.append(
                "rollback_step",
                step_id=step.id,
                action=step.action,
                workflow_id=workflow_id,
                message=f"[simulated] rollback of {step.action!r}",
            )
            step.status = StepStatus.PENDING
        self.audit.append("rollback_end", workflow_id=workflow_id)