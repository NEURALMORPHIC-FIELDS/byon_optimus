"""
Domain models for the policy-gated workflow engine.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Condition:
    """A single conditional expression attached to a step."""
    operator: str          # equals | not_equals | in | not_in
    var: str
    value: Any             # str for equals/not_equals; list for in/not_in

    @classmethod
    def from_dict(cls, data: dict) -> "Condition":
        for op in ("equals", "not_equals", "in", "not_in"):
            if op in data:
                payload = data[op]
                return cls(
                    operator=op,
                    var=payload["var"],
                    value=payload["value"],
                )
        raise ValueError(f"Unknown condition operator in: {data}")


@dataclass
class Step:
    name: str
    action: str
    depends_on: list[str] = field(default_factory=list)
    condition: Condition | None = None
    policy_tags: list[str] = field(default_factory=list)
    params: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict) -> "Step":
        condition = None
        if "condition" in data:
            condition = Condition.from_dict(data["condition"])
        return cls(
            name=data["name"],
            action=data.get("action", data.get("name", "")),
            depends_on=data.get("depends_on", []),
            condition=condition,
            policy_tags=data.get("policy_tags", []),
            params=data.get("params", {}),
        )


@dataclass
class WorkflowDefinition:
    name: str
    steps: list[Step]
    context: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict) -> "WorkflowDefinition":
        steps = [Step.from_dict(s) for s in data.get("steps", [])]
        return cls(
            name=data.get("name", "unnamed"),
            steps=steps,
            context=data.get("context", {}),
        )