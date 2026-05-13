"""
Execution planning — separates WHAT WILL HAPPEN from ACTUALLY DOING IT.

Public types
------------
StepDecision      pure-data outcome predicted for one step
ExecutionPlan     ordered list of StepDecisions (immutable after construction)
PlanValidator     validates a plan against policy + invariants, no side-effects
PlanRenderer      renders a plan as human text or machine dict

None of these classes execute steps, touch the audit log, or have side-effects.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set

from .conditions import ConditionError, evaluate
from .engine import ExecutionContext
from .models import Step, StepStatus, WorkflowDefinition
from .policy import PolicyDecision, PolicyEngine, PolicyMode, PolicyViolation


# ---------------------------------------------------------------------------
# StepDecision — predicted outcome for a single step
# ---------------------------------------------------------------------------

class PredictedOutcome(str, Enum):
    RUN      = "run"       # step will execute normally
    SKIP     = "skip"      # condition is false → will be skipped
    BLOCK    = "block"     # a hard-failed predecessor blocks this step
    DENY     = "deny"      # policy gate denies execution
    OVERRIDE = "override"  # gate denied but permissive mode overrides
    ERROR    = "error"     # static analysis found an error (bad condition, unknown gate…)


@dataclass(frozen=True)
class StepDecision:
    """
    Predicted execution decision for one step.

    Attributes
    ----------
    step            : the Step being decided
    outcome         : PredictedOutcome
    policy_decision : result of the policy check (None if no gate / not reached)
    skip_reason     : human-readable reason when outcome is SKIP
    block_reason    : human-readable reason when outcome is BLOCK
    error_reason    : human-readable reason when outcome is ERROR / DENY
    """
    step:            Step
    outcome:         PredictedOutcome
    policy_decision: Optional[PolicyDecision] = field(default=None, compare=False)
    skip_reason:     Optional[str]            = None
    block_reason:    Optional[str]            = None
    error_reason:    Optional[str]            = None

    # Convenience predicates
    @property
    def will_run(self) -> bool:
        return self.outcome in (PredictedOutcome.RUN, PredictedOutcome.OVERRIDE)

    @property
    def is_hard_failure(self) -> bool:
        """True when this decision propagates as a hard failure to dependents."""
        return self.outcome in (PredictedOutcome.DENY, PredictedOutcome.BLOCK,
                                PredictedOutcome.ERROR)


# ---------------------------------------------------------------------------
# ExecutionPlan — immutable, ordered collection of StepDecisions
# ---------------------------------------------------------------------------

class ExecutionPlan:
    """
    Pure-data, ordered plan produced by planning.build_plan().

    The plan is immutable once constructed; callers receive read-only views.
    """

    def __init__(
        self,
        workflow: WorkflowDefinition,
        decisions: List[StepDecision],
        policy_mode: PolicyMode,
        context_snapshot: Dict[str, Any],
    ) -> None:
        self._workflow         = workflow
        self._decisions        = list(decisions)          # defensive copy
        self._policy_mode      = policy_mode
        self._context_snapshot = dict(context_snapshot)  # defensive copy

    # -- read-only access ----------------------------------------------------

    @property
    def workflow(self) -> WorkflowDefinition:
        return self._workflow

    @property
    def decisions(self) -> List[StepDecision]:
        return list(self._decisions)  # copy — callers cannot mutate internals

    @property
    def policy_mode(self) -> PolicyMode:
        return self._policy_mode

    @property
    def context_snapshot(self) -> Dict[str, Any]:
        return dict(self._context_snapshot)

    # -- summary helpers -----------------------------------------------------

    def steps_that_will_run(self) -> List[Step]:
        return [d.step for d in self._decisions if d.will_run]

    def steps_that_will_skip(self) -> List[Step]:
        return [d.step for d in self._decisions if d.outcome == PredictedOutcome.SKIP]

    def steps_that_will_be_denied(self) -> List[Step]:
        return [d.step for d in self._decisions if d.outcome == PredictedOutcome.DENY]

    def steps_that_will_be_blocked(self) -> List[Step]:
        return [d.step for d in self._decisions if d.outcome == PredictedOutcome.BLOCK]

    def has_errors(self) -> bool:
        return any(d.outcome == PredictedOutcome.ERROR for d in self._decisions)

    def has_denials(self) -> bool:
        return any(d.outcome == PredictedOutcome.DENY for d in self._decisions)

    def __len__(self) -> int:
        return len(self._decisions)

    def __iter__(self):
        return iter(self.decisions)


# ---------------------------------------------------------------------------
# build_plan() — factory function; pure, no side-effects
# ---------------------------------------------------------------------------

def build_plan(
    workflow: WorkflowDefinition,
    policy_engine: PolicyEngine,
    context: ExecutionContext,
) -> ExecutionPlan:
    """
    Produce an ExecutionPlan by simulating the topological walk without
    executing any steps or writing to the audit log.

    Rules (mirrors WorkflowEngine._execute_step, read-only):
      1. If any hard-failing predecessor → BLOCK
      2. If condition evaluates to False → SKIP  (not a hard failure)
      3. If condition raises ConditionError → ERROR (hard failure)
      4. Policy check:
           - denied in ENFORCED mode  → DENY  (hard failure)
           - denied in PERMISSIVE mode → OVERRIDE (not a hard failure)
           - allowed                  → RUN
    """
    from .engine import WorkflowEngine  # local import avoids circular deps

    ordered = WorkflowEngine._topological_sort(workflow.steps)
    ctx_dict = context.as_dict()
    decisions: List[StepDecision] = []
    hard_failed: Set[str] = set()

    for step in ordered:
        decision = _decide_step(step, hard_failed, ctx_dict, policy_engine)
        decisions.append(decision)
        if decision.is_hard_failure:
            hard_failed.add(step.id)

    return ExecutionPlan(
        workflow=workflow,
        decisions=decisions,
        policy_mode=policy_engine.mode,
        context_snapshot=ctx_dict,
    )


def _decide_step(
    step: Step,
    hard_failed: Set[str],
    ctx_dict: Dict[str, Any],
    policy_engine: PolicyEngine,
) -> StepDecision:
    # 1. Blocked by predecessor?
    blocking = [d for d in step.depends_on if d in hard_failed]
    if blocking:
        return StepDecision(
            step=step,
            outcome=PredictedOutcome.BLOCK,
            block_reason=f"Blocked by hard-failed predecessors: {blocking}",
        )

    # 2. Condition evaluation
    if step.condition is not None:
        try:
            should_run = evaluate(step.condition, ctx_dict)
        except ConditionError as exc:
            return StepDecision(
                step=step,
                outcome=PredictedOutcome.ERROR,
                error_reason=f"Condition error: {exc}",
            )
        if not should_run:
            reason = (
                f"condition '{step.condition.operator}' on var "
                f"'{step.condition.var}' not met "
                f"(context={ctx_dict.get(step.condition.var)!r}, "
                f"expected={step.condition.value!r})"
            )
            return StepDecision(
                step=step,
                outcome=PredictedOutcome.SKIP,
                skip_reason=reason,
            )

    # 3. Policy check
    if step.policy_gate is None:
        return StepDecision(step=step, outcome=PredictedOutcome.RUN)

    try:
        pd = policy_engine.check(step)
    except PolicyViolation as exc:
        return StepDecision(
            step=step,
            outcome=PredictedOutcome.DENY,
            error_reason=str(exc),
        )

    outcome = PredictedOutcome.OVERRIDE if pd.overridden else PredictedOutcome.RUN
    return StepDecision(step=step, outcome=outcome, policy_decision=pd)


# ---------------------------------------------------------------------------
# PlanValidator — checks invariants without running anything
# ---------------------------------------------------------------------------

@dataclass
class ValidationIssue:
    severity: str   # 'error' | 'warning'
    step_id:  str
    message:  str


class PlanValidator:
    """
    Validates an ExecutionPlan against policy + structural invariants.

    No side-effects; does not write to the audit log.

    Checks performed
    ----------------
    - All policy denials are flagged as errors (enforced mode)
    - Policy overrides in permissive mode are flagged as warnings
    - Steps with condition errors are flagged as errors
    - Blocked steps are flagged as errors (transitively caused by the root)
    - Production-gate steps that will run are flagged as warnings for awareness
    """

    def validate(self, plan: ExecutionPlan) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []
        for decision in plan.decisions:
            issues.extend(self._check_decision(decision, plan.policy_mode))
        return issues

    def is_valid(self, plan: ExecutionPlan) -> bool:
        """True iff there are no error-severity issues."""
        return not any(i.severity == "error" for i in self.validate(plan))

    def _check_decision(
        self, d: StepDecision, mode: PolicyMode
    ) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []
        sid = d.step.id

        if d.outcome == PredictedOutcome.DENY:
            issues.append(ValidationIssue(
                severity="error",
                step_id=sid,
                message=(
                    f"Policy gate '{d.step.policy_gate}' denies execution. "
                    f"{d.error_reason or ''}"
                ),
            ))

        elif d.outcome == PredictedOutcome.BLOCK:
            issues.append(ValidationIssue(
                severity="error",
                step_id=sid,
                message=d.block_reason or "Blocked by a failed predecessor",
            ))

        elif d.outcome == PredictedOutcome.ERROR:
            issues.append(ValidationIssue(
                severity="error",
                step_id=sid,
                message=d.error_reason or "Unknown planning error",
            ))

        elif d.outcome == PredictedOutcome.OVERRIDE:
            issues.append(ValidationIssue(
                severity="warning",
                step_id=sid,
                message=(
                    f"Policy gate '{d.step.policy_gate}' would deny this step "
                    f"but is overridden by permissive mode."
                ),
            ))

        # Informational: production gate that will actually run
        if (
            d.will_run
            and d.step.policy_gate == "production-gate"
            and d.outcome != PredictedOutcome.OVERRIDE
        ):
            issues.append(ValidationIssue(
                severity="warning",
                step_id=sid,
                message="Step targets production-gate and will execute.",
            ))

        return issues


# ---------------------------------------------------------------------------
# PlanRenderer — human text + machine dict; no side-effects
# ---------------------------------------------------------------------------

_OUTCOME_ICON = {
    PredictedOutcome.RUN:      "▶",
    PredictedOutcome.SKIP:     "↷",
    PredictedOutcome.BLOCK:    "⊘",
    PredictedOutcome.DENY:     "✗",
    PredictedOutcome.OVERRIDE: "⚠",
    PredictedOutcome.ERROR:    "💥",
}

_SEVERITY_ICON = {"error": "✗", "warning": "⚠"}


class PlanRenderer:
    """
    Renders an ExecutionPlan.

    render_text(plan, issues) → multi-line human-readable string
    render_dict(plan, issues) → JSON-serialisable dict

    Neither method writes to stdout/files; callers decide what to do with output.
    """

    def render_text(
        self,
        plan: ExecutionPlan,
        issues: Optional[List[ValidationIssue]] = None,
    ) -> str:
        lines: List[str] = []
        wf = plan.workflow
        lines.append(f"Execution Plan  ·  {wf.name}  v{wf.version}")
        lines.append(f"Policy mode     : {plan.policy_mode.value}")
        if plan.context_snapshot:
            lines.append(f"Context         : {plan.context_snapshot}")
        lines.append(
            f"Steps           : {len(plan)} total  |  "
            f"{len(plan.steps_that_will_run())} run  |  "
            f"{len(plan.steps_that_will_skip())} skip  |  "
            f"{len(plan.steps_that_will_be_denied())} deny  |  "
            f"{len(plan.steps_that_will_be_blocked())} block"
        )
        lines.append("")
        lines.append(f"{'#':<3} {'OUTCOME':<10} {'STEP ID':<30} {'GATE':<20} NOTE")
        lines.append("─" * 90)

        for idx, d in enumerate(plan.decisions, 1):
            icon    = _OUTCOME_ICON.get(d.outcome, "?")
            outcome = d.outcome.value.upper()
            gate    = d.step.policy_gate or "—"
            note    = (
                d.skip_reason or d.block_reason or d.error_reason
                or (d.policy_decision.reason if d.policy_decision and d.policy_decision.overridden else "")
                or ""
            )
            # Truncate long notes for display
            if len(note) > 60:
                note = note[:57] + "…"
            lines.append(
                f"{idx:<3} {icon} {outcome:<8}  {d.step.id:<30} {gate:<20} {note}"
            )

        if issues:
            lines.append("")
            lines.append("Validation Issues")
            lines.append("─" * 50)
            for issue in issues:
                icon = _SEVERITY_ICON.get(issue.severity, "·")
                lines.append(f"  {icon} [{issue.severity.upper():7s}] {issue.step_id}: {issue.message}")

        return "\n".join(lines)

    def render_dict(
        self,
        plan: ExecutionPlan,
        issues: Optional[List[ValidationIssue]] = None,
    ) -> Dict[str, Any]:
        return {
            "workflow":      plan.workflow.name,
            "version":       plan.workflow.version,
            "policy_mode":   plan.policy_mode.value,
            "context":       plan.context_snapshot,
            "summary": {
                "total":   len(plan),
                "run":     len(plan.steps_that_will_run()),
                "skip":    len(plan.steps_that_will_skip()),
                "deny":    len(plan.steps_that_will_be_denied()),
                "block":   len(plan.steps_that_will_be_blocked()),
                "errors":  sum(1 for d in plan.decisions if d.outcome == PredictedOutcome.ERROR),
            },
            "decisions": [
                {
                    "step_id":         d.step.id,
                    "step_name":       d.step.name,
                    "outcome":         d.outcome.value,
                    "policy_gate":     d.step.policy_gate,
                    "environment":     d.step.environment,
                    "depends_on":      d.step.depends_on,
                    "condition":       (
                        {
                            "operator": d.step.condition.operator,
                            "var":      d.step.condition.var,
                            "value":    d.step.condition.value,
                        }
                        if d.step.condition else None
                    ),
                    "policy_overridden": (
                        d.policy_decision.overridden
                        if d.policy_decision else False
                    ),
                    "note": (
                        d.skip_reason or d.block_reason or d.error_reason
                        or (d.policy_decision.reason if d.policy_decision and d.policy_decision.overridden else None)
                    ),
                }
                for d in plan.decisions
            ],
            "issues": [
                {
                    "severity": i.severity,
                    "step_id":  i.step_id,
                    "message":  i.message,
                }
                for i in (issues or [])
            ],
        }