"""Condition evaluation for conditional workflow steps.

Conditions shape whether a step runs; they never bypass policy gates.
REQ_NO_POLICY_BYPASS: a condition evaluating to True does NOT skip gate checks —
gates are always enforced by the engine after condition evaluation.
"""
from __future__ import annotations
from typing import Any

from policy_engine.models import StepCondition


class ConditionError(ValueError):
    """Raised when a condition is malformed or references an unknown operator."""


def evaluate_condition(condition: StepCondition, variables: dict[str, Any]) -> bool:
    """Evaluate *condition* against *variables*.

    Returns True  → step should run.
    Returns False → step should be skipped.

    Raises ConditionError for unknown operators (REQ_CONFIG_UNTRUSTED: treat
    unrecognised operators as configuration errors, not silent passes).
    """
    if condition.operator == "equals":
        actual = variables.get(condition.var)
        return actual == condition.value
    raise ConditionError(
        f"Unknown condition operator: {condition.operator!r}. "
        f"Supported operators: ['equals']"
    )