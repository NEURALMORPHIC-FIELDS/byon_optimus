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
class ConditionExpr:
    """A single condition expression parsed from workflow YAML/JSON."""
    operator: str          # e.g. 'equals', 'not_equals', 'in', 'not_in'
    var: str               # context variable name
    value: Any             # expected value


@dataclass
class Step:
    id: str
    name: str
    action: str
    depends_on: List[str] = field(default_factory=list)
    policy_gate: Optional[str] = None
    params: dict = field(default_factory=dict)
    environment: str = "development"
    condition: Optional[ConditionExpr] = None

    def __post_init__(self):
        if not self.id:
            raise ValueError("Step id must not be empty")
        if not self.action:
            raise ValueError("Step action must not be empty")


@dataclass
class WorkflowDefinition:
    name: str
    version: str
    steps: List[Step]
    metadata: dict = field(default_factory=dict)


@dataclass
class PolicyGate:
    name: str
    required_role: str
    description: str = ""
    # Production gates are never granted by default (invariant_production_requires_grant)
    is_production: bool = False