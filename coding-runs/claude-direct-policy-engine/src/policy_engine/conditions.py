"""
Condition evaluation for conditional steps.

Supported operators:
  equals        var == value
  not_equals    var != value
  in            var in value   (value must be a list)
  not_in        var not in value
  exists        var is present in context (value ignored)
  not_exists    var is absent from context (value ignored)

All evaluation is pure / side-effect-free.
"""
from __future__ import annotations
from typing import Any, Dict

from .models import ConditionExpr


class ConditionError(Exception):
    """Raised when a condition expression is malformed or cannot be evaluated."""


SUPPORTED_OPERATORS = frozenset(
    {"equals", "not_equals", "in", "not_in", "exists", "not_exists"}
)


def evaluate(condition: ConditionExpr, context: Dict[str, Any]) -> bool:
    """
    Evaluate *condition* against *context*.
    Returns True  → step should run.
    Returns False → step should be skipped.
    Raises ConditionError on invalid expressions.
    """
    op = condition.operator
    if op not in SUPPORTED_OPERATORS:
        raise ConditionError(
            f"Unknown condition operator '{op}'. "
            f"Supported: {sorted(SUPPORTED_OPERATORS)}"
        )

    var_name = condition.var
    expected = condition.value

    present = var_name in context
    actual = context.get(var_name)

    if op == "exists":
        return present

    if op == "not_exists":
        return not present

    if op == "equals":
        return actual == expected

    if op == "not_equals":
        return actual != expected

    if op == "in":
        if not isinstance(expected, list):
            raise ConditionError(
                f"Operator 'in' requires value to be a list, got {type(expected).__name__}"
            )
        return actual in expected

    if op == "not_in":
        if not isinstance(expected, list):
            raise ConditionError(
                f"Operator 'not_in' requires value to be a list, got {type(expected).__name__}"
            )
        return actual not in expected

    # Should never reach here given the guard above, but keeps mypy happy.
    raise ConditionError(f"Unhandled operator '{op}'")  # pragma: no cover


def parse_condition(raw: Any, step_id: str) -> ConditionExpr:
    """
    Parse a raw condition dict from untrusted YAML/JSON into a ConditionExpr.
    Validates structure and operator name.
    """
    if not isinstance(raw, dict):
        raise ValueError(f"Step '{step_id}': condition must be a mapping, got {type(raw).__name__}")

    # Exactly one operator key expected.
    known_ops = SUPPORTED_OPERATORS
    found_ops = [k for k in raw if k in known_ops]

    if len(found_ops) == 0:
        raise ValueError(
            f"Step '{step_id}': condition must contain one of {sorted(known_ops)}. "
            f"Got keys: {list(raw.keys())}"
        )
    if len(found_ops) > 1:
        raise ValueError(
            f"Step '{step_id}': condition must contain exactly one operator, "
            f"found multiple: {found_ops}"
        )

    operator = found_ops[0]
    body = raw[operator]

    if not isinstance(body, dict):
        raise ValueError(
            f"Step '{step_id}': condition.{operator} must be a mapping with 'var' (and optionally 'value')"
        )

    var = body.get("var")
    if not isinstance(var, str) or not var.strip():
        raise ValueError(f"Step '{step_id}': condition.{operator}.var must be a non-empty string")

    # 'exists' / 'not_exists' don't need a value
    if operator in ("exists", "not_exists"):
        value = None
    else:
        if "value" not in body:
            raise ValueError(
                f"Step '{step_id}': condition.{operator} requires a 'value' field"
            )
        value = body["value"]

    return ConditionExpr(operator=operator, var=var.strip(), value=value)