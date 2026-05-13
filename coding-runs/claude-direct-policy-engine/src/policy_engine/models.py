"""Core data models."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class StepStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"
    BLOCKED = "blocked"


@dataclass
class PolicyGate:
    """Gate that must pass before a step executes."""

    name: str
    required_role: str
    description: str = ""

    def check(self, roles: List[str]) -> bool:
        return self.required_role in roles


@dataclass
class Step:
    """A single unit of work in the workflow."""

    id: str
    name: str
    action: str
    depends_on: List[str] = field(default_factory=list)
    policy_gates: List[str] = field(default_factory=list)
    params: Dict[str, Any] = field(default_factory=dict)
    # Raw condition mapping from YAML/JSON (already validated by loader)
    condition: Optional[Dict[str, Any]] = field(default=None)
    status: StepStatus = field(default=StepStatus.PENDING)
    result: Optional[str] = field(default=None)


@dataclass
class Workflow:
    """A complete workflow definition."""

    name: str
    version: str
    steps: List[Step]
    gates: Dict[str, PolicyGate]
    description: str = ""