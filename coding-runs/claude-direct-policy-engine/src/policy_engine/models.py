"""Core data models."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class StepStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"
    BLOCKED = "blocked"


@dataclass
class Step:
    id: str
    name: str
    action: str
    depends_on: list[str] = field(default_factory=list)
    policy_gate: str | None = None
    condition: dict[str, Any] | None = None   # NEW
    params: dict[str, Any] = field(default_factory=dict)
    environment: str = "development"
    status: StepStatus = StepStatus.PENDING

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "action": self.action,
            "depends_on": self.depends_on,
            "policy_gate": self.policy_gate,
            "condition": self.condition,
            "params": self.params,
            "environment": self.environment,
            "status": self.status.value,
        }


@dataclass
class Workflow:
    id: str
    name: str
    steps: list[Step]
    metadata: dict[str, Any] = field(default_factory=dict)
    # Runtime variables injected at execution time (merged with CLI --var k=v)
    variables: dict[str, Any] = field(default_factory=dict)