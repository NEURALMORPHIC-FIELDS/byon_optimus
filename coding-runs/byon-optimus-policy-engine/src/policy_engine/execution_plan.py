"""
ExecutionPlan, PlanValidator, and PlanRenderer collaborators.

ExecutionPlan  — pure data: ordered list of StepPlan records.
PlanValidator  — validates a plan against policies + invariants without running anything.
PlanRenderer   — renders a plan as human-readable text and machine-readable dict.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class StepPlan:
    """Immutable record describing one step's planned execution."""

    step_name: str
    depends_on: List[str]
    condition_met: Optional[bool]          # None  → no condition defined
    policy_result: str                     # "allow" | "deny" | "skip"
    will_execute: bool                     # True if the step is expected to run
    skip_reason: Optional[str] = None      # populated when will_execute is False


@dataclass
class ExecutionPlan:
    """
    Pure-data container: ordered list of StepPlan records.

    Invariants encoded here (checked by PlanValidator):
      - No step appears twice.
      - Dependency references must resolve to earlier steps in the list.
    """

    steps: List[StepPlan] = field(default_factory=list)

    def step_names(self) -> List[str]:
        return [s.step_name for s in self.steps]

    def get(self, name: str) -> Optional[StepPlan]:
        for s in self.steps:
            if s.step_name == name:
                return s
        return None


# ---------------------------------------------------------------------------
# Validator
# ---------------------------------------------------------------------------

@dataclass
class PlanValidationError:
    step_name: Optional[str]
    message: str


class PlanValidator:
    """
    Validates an ExecutionPlan against policies and structural invariants
    WITHOUT running anything.

    Returns a (valid: bool, errors: list[PlanValidationError]) tuple.
    """

    def validate(
        self, plan: ExecutionPlan
    ) -> tuple[bool, List[PlanValidationError]]:
        errors: List[PlanValidationError] = []

        seen: Dict[str, int] = {}
        for idx, sp in enumerate(plan.steps):
            # Invariant: no duplicate step names
            if sp.step_name in seen:
                errors.append(
                    PlanValidationError(
                        sp.step_name,
                        f"Duplicate step name '{sp.step_name}' "
                        f"(first at index {seen[sp.step_name]}, again at {idx}).",
                    )
                )
            seen[sp.step_name] = idx

            # Invariant: dependencies must be declared before this step
            for dep in sp.depends_on:
                if dep not in seen or seen[dep] >= idx:
                    errors.append(
                        PlanValidationError(
                            sp.step_name,
                            f"Step '{sp.step_name}' depends on '{dep}' "
                            f"which is not declared before it.",
                        )
                    )

            # Invariant: policy_result must be a known value
            if sp.policy_result not in ("allow", "deny", "skip"):
                errors.append(
                    PlanValidationError(
                        sp.step_name,
                        f"Unknown policy_result '{sp.policy_result}' "
                        f"for step '{sp.step_name}'.",
                    )
                )

            # Invariant: [invariant_no_policy_bypass]
            # A step that is denied by policy must NOT be marked will_execute=True.
            if sp.policy_result == "deny" and sp.will_execute:
                errors.append(
                    PlanValidationError(
                        sp.step_name,
                        f"[invariant_no_policy_bypass] Step '{sp.step_name}' "
                        f"is denied by policy but will_execute=True.",
                    )
                )

            # Invariant: [invariant_failed_step_blocks_dependents]
            # If a dependency is denied/skipped, this step must not execute.
            for dep in sp.depends_on:
                dep_plan = plan.get(dep)
                if dep_plan is not None and not dep_plan.will_execute and sp.will_execute:
                    errors.append(
                        PlanValidationError(
                            sp.step_name,
                            f"[invariant_failed_step_blocks_dependents] "
                            f"Step '{sp.step_name}' will_execute=True but "
                            f"dependency '{dep}' will not execute.",
                        )
                    )

        valid = len(errors) == 0
        return valid, errors


# ---------------------------------------------------------------------------
# Renderer
# ---------------------------------------------------------------------------

class PlanRenderer:
    """
    Renders an ExecutionPlan as:
      - human-readable text  (render_text)
      - machine-readable dict (render_dict)
    """

    _POLICY_SYMBOL = {
        "allow": "[ALLOW]",
        "deny":  "[DENY] ",
        "skip":  "[SKIP] ",
    }

    def render_text(self, plan: ExecutionPlan) -> str:
        if not plan.steps:
            return "ExecutionPlan: (empty)\n"

        lines = ["ExecutionPlan", "=" * 60]
        for i, sp in enumerate(plan.steps, 1):
            symbol = self._POLICY_SYMBOL.get(sp.policy_result, "[?????]")
            execute_flag = "RUN " if sp.will_execute else "SKIP"
            cond_str = ""
            if sp.condition_met is not None:
                cond_str = f"  condition={'met' if sp.condition_met else 'not met'}"
            deps_str = ""
            if sp.depends_on:
                deps_str = f"  depends_on={sp.depends_on}"
            reason_str = ""
            if sp.skip_reason:
                reason_str = f"  reason='{sp.skip_reason}'"

            lines.append(
                f"  {i:2d}. {execute_flag}  {symbol}  {sp.step_name}"
                f"{deps_str}{cond_str}{reason_str}"
            )
        lines.append("=" * 60)
        return "\n".join(lines) + "\n"

    def render_dict(self, plan: ExecutionPlan) -> Dict[str, Any]:
        return {
            "execution_plan": [
                {
                    "step_name": sp.step_name,
                    "depends_on": list(sp.depends_on),
                    "condition_met": sp.condition_met,
                    "policy_result": sp.policy_result,
                    "will_execute": sp.will_execute,
                    "skip_reason": sp.skip_reason,
                }
                for sp in plan.steps
            ]
        }