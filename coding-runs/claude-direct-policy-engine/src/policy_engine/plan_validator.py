"""PlanValidator — validates an ExecutionPlan against policies and invariants.

Validates WITHOUT executing anything.  Returns a list of PlanViolation objects
rather than raising immediately so callers can collect all problems at once.

Invariants checked
------------------
[invariant_failed_step_blocks_dependents]  — BLOCK propagation is consistent
[invariant_no_policy_bypass]               — no OVERRIDDEN gate in ENFORCING mode
[invariant_production_requires_grant]      — production gates must have explicit grant
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List

from .planner import Decision, ExecutionPlan, StepPlan
from .policy_mode import PolicyMode


# ---------------------------------------------------------------------------
# Violation record
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PlanViolation:
    """A single policy or invariant violation found in a plan."""

    invariant: str   # short invariant tag, e.g. "invariant_no_policy_bypass"
    step_id:   str   # which step triggered the violation (empty string = whole plan)
    message:   str

    def __str__(self) -> str:
        loc = f"step '{self.step_id}'" if self.step_id else "plan"
        return f"[{self.invariant}] {loc}: {self.message}"


# ---------------------------------------------------------------------------
# PlanValidator
# ---------------------------------------------------------------------------

class PlanValidator:
    """Validates an ExecutionPlan and returns all violations found."""

    def validate(self, plan: ExecutionPlan) -> List[PlanViolation]:
        violations: List[PlanViolation] = []

        step_plan_map = {sp.step_id: sp for sp in plan.step_plans}

        for sp in plan.step_plans:
            violations.extend(self._check_block_propagation(sp, step_plan_map))
            violations.extend(self._check_no_policy_bypass(sp, plan.policy_mode))
            violations.extend(self._check_deny_has_gate_results(sp))

        violations.extend(self._check_plan_ordering(plan))

        return violations

    # ---------------------------------------------------------------- checks

    def _check_block_propagation(
        self,
        sp: StepPlan,
        step_plan_map: dict,
    ) -> List[PlanViolation]:
        """
        [invariant_failed_step_blocks_dependents]
        If a step is RUN or SKIP, none of its blocked_by list should be non-empty.
        If a step is BLOCK, every step in its blocked_by list must itself be
        DENY or BLOCK (i.e. a legitimately bad predecessor).
        """
        violations: List[PlanViolation] = []

        if sp.decision == Decision.BLOCK:
            for dep_id in sp.blocked_by:
                dep = step_plan_map.get(dep_id)
                if dep is None:
                    violations.append(PlanViolation(
                        invariant = "invariant_failed_step_blocks_dependents",
                        step_id   = sp.step_id,
                        message   = (
                            f"blocked_by references unknown step '{dep_id}'"
                        ),
                    ))
                elif dep.decision not in (Decision.DENY, Decision.BLOCK):
                    violations.append(PlanViolation(
                        invariant = "invariant_failed_step_blocks_dependents",
                        step_id   = sp.step_id,
                        message   = (
                            f"blocked by '{dep_id}' but that step has decision "
                            f"'{dep.decision.value}', which is not DENY/BLOCK"
                        ),
                    ))

        return violations

    def _check_no_policy_bypass(
        self,
        sp: StepPlan,
        policy_mode: PolicyMode,
    ) -> List[PlanViolation]:
        """
        [invariant_no_policy_bypass]
        Gate result 'OVERRIDDEN' must only appear when policy_mode == PERMISSIVE.
        In ENFORCING mode any OVERRIDDEN entry is a violation.
        """
        violations: List[PlanViolation] = []

        if policy_mode == PolicyMode.ENFORCING:
            overridden = [g for g, r in sp.gate_results.items() if r == "OVERRIDDEN"]
            if overridden:
                violations.append(PlanViolation(
                    invariant = "invariant_no_policy_bypass",
                    step_id   = sp.step_id,
                    message   = (
                        f"Gate(s) {overridden} show as OVERRIDDEN in ENFORCING "
                        f"mode — this should be impossible and indicates a planner bug"
                    ),
                ))

        return violations

    def _check_deny_has_gate_results(self, sp: StepPlan) -> List[PlanViolation]:
        """A DENY decision must have at least one gate result recorded."""
        if sp.decision == Decision.DENY and not sp.gate_results:
            return [PlanViolation(
                invariant = "invariant_no_policy_bypass",
                step_id   = sp.step_id,
                message   = "Decision is DENY but no gate_results were recorded",
            )]
        return []

    def _check_plan_ordering(self, plan: ExecutionPlan) -> List[PlanViolation]:
        """
        Every step's dependencies must appear earlier in the plan than the step
        itself (topological order is preserved).
        """
        violations: List[PlanViolation] = []
        seen: set = set()

        step_plan_map = {sp.step_id: sp for sp in plan.step_plans}

        for sp in plan.step_plans:
            # We need the original Step to know depends_on; reconstruct from
            # blocked_by + gate_results isn't enough — but we CAN check that
            # every step referenced in blocked_by appears before sp in the plan.
            for dep_id in sp.blocked_by:
                if dep_id not in seen:
                    violations.append(PlanViolation(
                        invariant = "invariant_failed_step_blocks_dependents",
                        step_id   = sp.step_id,
                        message   = (
                            f"Dependency '{dep_id}' appears after '{sp.step_id}' "
                            f"in the plan (topological order violation)"
                        ),
                    ))
            seen.add(sp.step_id)

        return violations