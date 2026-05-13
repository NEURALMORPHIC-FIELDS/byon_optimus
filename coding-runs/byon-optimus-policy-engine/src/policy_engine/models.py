"""Core data models. Each symbol defined here is canonical — do not redefine elsewhere."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any


@dataclass
class StepCondition:
    """Represents a condition that gates step execution.

    Currently supports one operator: 'equals'.
    condition:
      equals:
        var: <variable_name>
        value: <expected_value>
    """
    operator: str          # e.g. "equals"
    var: str               # variable name to look up in ExecutionContext.variables
    value: Any             # expected value


@dataclass
class WorkflowStep:
    """REQ_CONFIG_UNTRUSTED: all fields come from untrusted YAML/JSON."""
    name: str
    action: str
    depends_on: list[str] = field(default_factory=list)
    policy_gates: list[str] = field(default_factory=list)
    params: dict[str, Any] = field(default_factory=dict)
    environment: str = "dev"
    condition: StepCondition | None = None


@dataclass
class WorkflowDefinition:
    name: str
    steps: list[WorkflowStep]


@dataclass
class ExecutionPlan:
    workflow: WorkflowDefinition
    ordered_steps: list[WorkflowStep]  # topological order


@dataclass
class PolicyGate:
    """REQ_NO_POLICY_BYPASS: gates are enforced by the engine, not skippable via config."""
    name: str
    required_role: str
    environment_scope: str = "*"  # "*" means all environments

    def allows(self, role: str, environment: str) -> bool:
        env_ok = self.environment_scope == "*" or self.environment_scope == environment
        return env_ok and role == self.required_role