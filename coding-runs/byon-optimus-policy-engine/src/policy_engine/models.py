"""Core data models. Each symbol defined here is canonical — do not redefine elsewhere."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any


@dataclass
class StepCondition:
    """Represents a single condition expression on a workflow step.

    Supported operators:
      equals   — evaluates to True when context[var] == value
    """
    operator: str          # e.g. "equals"
    var: str               # variable name looked up in ExecutionContext
    value: Any             # expected value

    def evaluate(self, context: dict[str, Any]) -> bool:
        if self.operator == "equals":
            return context.get(self.var) == self.value
        # Unknown operator → conservative deny (treat as False)
        return False


@dataclass
class WorkflowStep:
    """REQ_CONFIG_UNTRUSTED: all fields come from untrusted YAML/JSON."""
    name: str
    action: str
    depends_on: list[str] = field(default_factory=list)
    policy_gates: list[str] = field(default_factory=list)
    params: dict[str, Any] = field(default_factory=dict)
    environment: str = "dev"
    condition: StepCondition | None = None  # None → always run


@dataclass
class WorkflowDefinition:
    name: str
    steps: list[WorkflowStep]


@dataclass
class PlanStep:
    """One entry in a planned (not yet executed) ExecutionPlan.

    Fields
    ------
    step            : the WorkflowStep being planned
    decision        : 'run' | 'skipped' | 'gate_denied' | 'blocked'
                      Predicted outcome based on static analysis.
                      'run'         — no static reason to skip or deny
                      'skipped'     — condition is statically False (only when
                                      a context is supplied and evaluates False)
                      'gate_denied' — at least one policy gate will deny this
                                      step for the given role
                      'blocked'     — a predecessor is predicted gate_denied or
                                      blocked
    predicted_policy: human-readable summary of the gate prediction,
                      e.g. 'all gates pass', 'prod-gate denied for role developer'
    """
    step: WorkflowStep
    decision: str           # 'run' | 'skipped' | 'gate_denied' | 'blocked'
    predicted_policy: str   # human-readable gate prediction


@dataclass
class ExecutionPlan:
    """Pure-data execution plan produced by build_plan().

    ordered_steps   : topologically sorted WorkflowStep list (unchanged from P3,
                      kept for backward compatibility with PolicyEngine.run())
    plan_steps      : richer list of PlanStep entries in the same order,
                      carrying decision + predicted_policy for each step.
                      Present only when build_plan() is called with permissions;
                      otherwise each PlanStep has decision='run' and
                      predicted_policy='unknown (no permissions supplied)'.
    """
    workflow: WorkflowDefinition
    ordered_steps: list[WorkflowStep]          # backward-compat: engine uses this
    plan_steps: list[PlanStep] = field(default_factory=list)  # new in P4


@dataclass
class PolicyGate:
    """REQ_NO_POLICY_BYPASS: gate logic lives here, not in workflow config."""
    name: str
    required_role: str
    environment_restriction: str | None = None  # None = any env

    def evaluate(self, role: str, environment: str) -> bool:
        if self.required_role != role:
            return False
        if self.environment_restriction and self.environment_restriction != environment:
            return False
        return True