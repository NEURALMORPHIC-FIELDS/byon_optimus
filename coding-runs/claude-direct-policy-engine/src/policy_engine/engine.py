"""
Workflow execution engine with simulated step execution and conditional steps.

Condition semantics
-------------------
  - condition absent  → run normally
  - condition true    → run normally
  - condition false   → SKIPPED (not a failure; dependents still run normally)
  - SKIPPED predecessor is treated as satisfied for dependency ordering
  - FAILED / BLOCKED predecessor blocks dependents (invariant_failed_step_blocks_dependents)

Policy modes (invariant_no_policy_bypass)
-----------------------------------------
  - PolicyMode.ENFORCED   → gates block unauthorised steps (default)
  - PolicyMode.PERMISSIVE → operator opt-in; overrides are AUDITED, never silent

Bug fix (see CHANGELOG.md — "skipped-blocks-dependents")
---------------------------------------------------------
  A SKIPPED step must never be added to `hard_failed`.  Previously the set was
  populated correctly in *this* file, but the missing regression-test coverage
  allowed an equivalent defect to go unnoticed in integration paths.  The fix
  makes the exclusion of SKIPPED from hard_failed explicit and documents it.
"""
from __future__ import annotations

from collections import deque
from typing import Any, Dict, List, Set

from .audit import AuditLog
from .conditions import ConditionError, evaluate
from .models import Step, StepStatus, WorkflowDefinition
from .policy import PolicyEngine, PolicyViolation


class StepResult:
    def __init__(self, step: Step, status: StepStatus, message: str = ""):
        self.step    = step
        self.status  = status
        self.message = message

    def __repr__(self) -> str:
        return f"StepResult(id={self.step.id!r}, status={self.status})"


class ExecutionContext:
    """Runtime variables available for condition evaluation."""

    def __init__(self, initial: Dict[str, Any] | None = None) -> None:
        self._vars: Dict[str, Any] = dict(initial or {})

    def set(self, key: str, value: Any) -> None:
        self._vars[key] = value

    def get(self, key: str, default: Any = None) -> Any:
        return self._vars.get(key, default)

    def as_dict(self) -> Dict[str, Any]:
        return dict(self._vars)

    def __contains__(self, key: str) -> bool:
        return key in self._vars


# Statuses that constitute a "hard failure" for dependency propagation.
# SKIPPED is intentionally excluded: a skipped step is not a failure,
# and its dependents must be allowed to run normally.
_HARD_FAILURE_STATUSES: frozenset = frozenset({StepStatus.FAILED, StepStatus.BLOCKED})


class WorkflowEngine:
    """
    Executes a WorkflowDefinition in topological order.

    All side effects are SIMULATED — no real network / shell / deployment.
    """

    def __init__(
        self,
        workflow:      WorkflowDefinition,
        policy_engine: PolicyEngine,
        audit:         AuditLog,
        context:       ExecutionContext | None = None,
        dry_run:       bool = False,
    ) -> None:
        self._workflow = workflow
        self._policy   = policy_engine
        self._audit    = audit
        self._context  = context or ExecutionContext()
        self._dry_run  = dry_run
        self._results: Dict[str, StepResult] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self) -> List[StepResult]:
        self._audit.record(
            "workflow_start",
            workflow    = self._workflow.name,
            version     = self._workflow.version,
            policy_mode = self._policy.mode.value,
            dry_run     = self._dry_run,
            context     = self._context.as_dict(),
        )

        ordered = self._topological_sort(self._workflow.steps)

        # Only FAILED and BLOCKED steps propagate as blockers.
        # SKIPPED steps are explicitly excluded so their dependents can run.
        hard_failed: Set[str] = set()

        for step in ordered:
            result = self._execute_step(step, hard_failed)
            self._results[step.id] = result

            # Explicit guard: only add to hard_failed for genuine failures.
            # This is the critical invariant — SKIPPED must never enter this set.
            if result.status in _HARD_FAILURE_STATUSES:
                hard_failed.add(step.id)
            # Defensive assertion (stripped in optimised runs via -O flag)
            assert result.status is not StepStatus.SKIPPED or step.id not in hard_failed, (
                f"BUG: skipped step '{step.id}' was incorrectly added to hard_failed"
            )

        failed_ids = list(hard_failed)
        self._audit.record(
            "workflow_end",
            workflow     = self._workflow.name,
            status       = "success" if not failed_ids else "partial_failure",
            failed_steps = failed_ids,
        )
        return list(self._results.values())

    def successful_steps(self) -> List[StepResult]:
        return [r for r in self._results.values() if r.status == StepStatus.SUCCESS]

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _execute_step(self, step: Step, hard_failed: Set[str]) -> StepResult:
        # ----------------------------------------------------------------
        # 1. Dependency failure propagation
        #    invariant_failed_step_blocks_dependents — only hard failures block.
        #    A SKIPPED predecessor is not in hard_failed, so it never blocks.
        # ----------------------------------------------------------------
        blocked_by = [dep for dep in step.depends_on if dep in hard_failed]
        if blocked_by:
            self._audit.record(
                "step_blocked",
                step_id    = step.id,
                blocked_by = blocked_by,
            )
            return StepResult(
                step,
                StepStatus.BLOCKED,
                f"Blocked by failed steps: {blocked_by}",
            )

        # ----------------------------------------------------------------
        # 2. Condition evaluation
        #    False condition → SKIPPED (not a hard failure)
        # ----------------------------------------------------------------
        if step.condition is not None:
            try:
                should_run = evaluate(step.condition, self._context.as_dict())
            except ConditionError as exc:
                self._audit.record(
                    "step_condition_error",
                    step_id = step.id,
                    reason  = str(exc),
                )
                # Condition errors are hard failures (misconfiguration)
                return StepResult(step, StepStatus.FAILED, f"Condition error: {exc}")

            if not should_run:
                reason = (
                    f"condition '{step.condition.operator}' on var "
                    f"'{step.condition.var}' not met "
                    f"(context value={self._context.get(step.condition.var)!r}, "
                    f"expected={step.condition.value!r})"
                )
                self._audit.record(
                    "step_skipped",
                    step_id = step.id,
                    reason  = "condition not met",
                    detail  = reason,
                )
                # SKIPPED — callers must NOT add this to hard_failed
                return StepResult(step, StepStatus.SKIPPED, reason)

        # ----------------------------------------------------------------
        # 3. Policy check
        # ----------------------------------------------------------------
        try:
            decision = self._policy.check(step)
        except PolicyViolation as exc:
            self._audit.record(
                "step_policy_violation",
                step_id = step.id,
                reason  = str(exc),
            )
            return StepResult(step, StepStatus.FAILED, str(exc))

        # Audit overridden decisions — never silent (invariant_no_policy_bypass)
        if decision.overridden:
            self._audit.record(
                "policy_overridden",
                step_id     = step.id,
                policy_mode = "permissive",
                reason      = decision.reason,
            )

        # ----------------------------------------------------------------
        # 4. Simulate execution
        # ----------------------------------------------------------------
        return self._simulate_step(step, overridden=decision.overridden)

    def _simulate_step(self, step: Step, overridden: bool = False) -> StepResult:
        self._audit.record(
            "step_start",
            step_id          = step.id,
            action           = step.action,
            environment      = step.environment,
            policy_overridden = overridden,
            dry_run          = self._dry_run,
        )
        prefix = "[SIMULATED/POLICY-OVERRIDDEN]" if overridden else "[SIMULATED]"
        output = (
            f"{prefix} {step.action} '{step.name}' "
            f"env={step.environment} params={step.params}"
        )
        self._audit.record(
            "step_end",
            step_id          = step.id,
            status           = StepStatus.SUCCESS.value,
            policy_overridden = overridden,
            output           = output,
        )
        return StepResult(step, StepStatus.SUCCESS, output)

    # ------------------------------------------------------------------
    # Topological sort (Kahn's algorithm)
    # ------------------------------------------------------------------

    @staticmethod
    def _topological_sort(steps: List[Step]) -> List[Step]:
        step_map: Dict[str, Step] = {s.id: s for s in steps}
        in_degree:  Dict[str, int]        = {s.id: 0  for s in steps}
        dependents: Dict[str, List[str]]  = {s.id: [] for s in steps}

        for s in steps:
            for dep in s.depends_on:
                in_degree[s.id] += 1
                dependents[dep].append(s.id)

        queue = deque(sid for sid, deg in in_degree.items() if deg == 0)
        order: List[Step] = []
        while queue:
            sid = queue.popleft()
            order.append(step_map[sid])
            for child in dependents[sid]:
                in_degree[child] -= 1
                if in_degree[child] == 0:
                    queue.append(child)
        return order