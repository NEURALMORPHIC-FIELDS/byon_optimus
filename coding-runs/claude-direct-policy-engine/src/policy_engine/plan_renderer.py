"""PlanRenderer — human-readable and machine-readable plan output.

Renders an ExecutionPlan without any I/O side-effects; callers decide
where to write the output.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List

from .planner import Decision, ExecutionPlan, StepPlan
from .plan_validator import PlanViolation


# ANSI colour codes (used only when the caller opts in)
_COLOURS: Dict[str, str] = {
    Decision.RUN.value:   "\033[32m",   # green
    Decision.SKIP.value:  "\033[33m",   # yellow
    Decision.BLOCK.value: "\033[31m",   # red
    Decision.DENY.value:  "\033[31m",   # red
    "reset":              "\033[0m",
    "bold":               "\033[1m",
    "dim":                "\033[2m",
}

_ICONS: Dict[str, str] = {
    Decision.RUN.value:   "▶",
    Decision.SKIP.value:  "↷",
    Decision.BLOCK.value: "⊘",
    Decision.DENY.value:  "✗",
}


class PlanRenderer:
    """Renders an ExecutionPlan to text or dict without performing any I/O."""

    def __init__(self, colour: bool = False):
        self.colour = colour

    # ------------------------------------------------------------------ public

    def render_text(
        self,
        plan:       ExecutionPlan,
        violations: List[PlanViolation] | None = None,
    ) -> str:
        """Return a human-readable multi-line string describing the plan."""
        lines: List[str] = []

        lines.append(self._bold(f"Execution Plan — {plan.workflow_name} v{plan.workflow_version}"))
        lines.append(f"  Policy mode : {plan.policy_mode.value.upper()}")
        lines.append(f"  Actor roles : {plan.actor_roles or ['(none)']}")
        if plan.variables:
            lines.append(f"  Variables   : {plan.variables}")
        lines.append(f"  Would succeed: {'YES' if plan.would_succeed() else 'NO'}")
        counts = plan.counts()
        lines.append(
            f"  Steps       : "
            + "  ".join(f"{k}={v}" for k, v in counts.items() if v)
        )
        lines.append("")

        for i, sp in enumerate(plan.step_plans, 1):
            lines.extend(self._render_step(i, sp))

        if violations:
            lines.append("")
            lines.append(self._bold("⚠  Plan Violations"))
            for v in violations:
                lines.append(f"  • {v}")

        return "\n".join(lines)

    def render_dict(
        self,
        plan:       ExecutionPlan,
        violations: List[PlanViolation] | None = None,
    ) -> Dict[str, Any]:
        """Return the plan as a plain dict (JSON-serialisable)."""
        d = plan.as_dict()
        d["violations"] = [
            {
                "invariant": v.invariant,
                "step_id":   v.step_id,
                "message":   v.message,
            }
            for v in (violations or [])
        ]
        return d

    def render_json(
        self,
        plan:       ExecutionPlan,
        violations: List[PlanViolation] | None = None,
        indent:     int = 2,
    ) -> str:
        return json.dumps(self.render_dict(plan, violations), indent=indent)

    # ----------------------------------------------------------------- private

    def _render_step(self, index: int, sp: StepPlan) -> List[str]:
        icon  = _ICONS.get(sp.decision.value, "?")
        col   = _COLOURS.get(sp.decision.value, "")
        reset = _COLOURS["reset"] if self.colour else ""
        col   = col if self.colour else ""

        lines = [
            f"  {index:>2}. {col}{icon} [{sp.decision.value.upper():5s}]{reset} "
            f"{sp.step_id}: {sp.step_name}",
            f"        action : {sp.action}",
            f"        reason : {sp.reason}",
        ]

        if sp.condition_result is not None:
            lines.append(f"        condition: {sp.condition_result}")

        if sp.gate_results:
            gate_str = "  ".join(
                f"{g}={self._gate_colour(r)}{r}{reset}"
                for g, r in sp.gate_results.items()
            )
            lines.append(f"        gates    : {gate_str}")

        if sp.blocked_by:
            lines.append(f"        blocked by: {sp.blocked_by}")

        return lines

    def _gate_colour(self, result: str) -> str:
        if not self.colour:
            return ""
        mapping = {
            "PASS":       "\033[32m",
            "DENY":       "\033[31m",
            "OVERRIDDEN": "\033[33m",
            "ERROR":      "\033[31m",
        }
        return mapping.get(result, "")

    def _bold(self, text: str) -> str:
        if self.colour:
            return f"{_COLOURS['bold']}{text}{_COLOURS['reset']}"
        return text