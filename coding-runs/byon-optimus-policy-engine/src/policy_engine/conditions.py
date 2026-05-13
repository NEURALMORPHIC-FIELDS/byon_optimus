"""
Condition evaluation for workflow steps.

Supported condition types:
  - equals:      var == value
  - not_equals:  var != value
  - in:          var in values (list)
  - not_in:      var not in values (list)
  - exists:      var is present in context (non-None)
  - gt:          var > value  (numeric)
  - lt:          var < value  (numeric)

All evaluation is pure (no side effects).
[invariant_config_is_untrusted]: unknown condition types raise ValueError.
"""

from __future__ import annotations

from typing import Any, Dict


def evaluate_condition(condition: Dict[str, Any], context: Dict[str, Any]) -> bool:
    """
    Evaluate a condition dict against a context dict.

    Returns True if the condition is satisfied, False otherwise.
    Raises ValueError for unknown condition types (untrusted input guard).
    """
    if not isinstance(condition, dict):
        raise ValueError(f"Condition must be a dict, got {type(condition)}")

    if len(condition) != 1:
        raise ValueError(
            f"Condition must have exactly one key (the operator), got: {list(condition.keys())}"
        )

    operator, operands = next(iter(condition.items()))

    if operator == "equals":
        var, value = _require_var_value(operator, operands)
        return context.get(var) == value

    elif operator == "not_equals":
        var, value = _require_var_value(operator, operands)
        return context.get(var) != value

    elif operator == "in":
        var, values = _require_var_values(operator, operands)
        return context.get(var) in values

    elif operator == "not_in":
        var, values = _require_var_values(operator, operands)
        return context.get(var) not in values

    elif operator == "exists":
        if not isinstance(operands, dict) or "var" not in operands:
            raise ValueError(f"Condition 'exists' requires {{var: <name>}}, got: {operands}")
        return context.get(operands["var"]) is not None

    elif operator == "gt":
        var, value = _require_var_value(operator, operands)
        ctx_val = context.get(var)
        if ctx_val is None:
            return False
        return float(ctx_val) > float(value)

    elif operator == "lt":
        var, value = _require_var_value(operator, operands)
        ctx_val = context.get(var)
        if ctx_val is None:
            return False
        return float(ctx_val) < float(value)

    else:
        raise ValueError(
            f"[invariant_config_is_untrusted] Unknown condition operator: '{operator}'"
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_var_value(operator: str, operands: Any):
    if not isinstance(operands, dict):
        raise ValueError(f"Condition '{operator}' requires a dict operand, got: {type(operands)}")
    if "var" not in operands:
        raise ValueError(f"Condition '{operator}' requires 'var' key.")
    if "value" not in operands:
        raise ValueError(f"Condition '{operator}' requires 'value' key.")
    return operands["var"], operands["value"]


def _require_var_values(operator: str, operands: Any):
    if not isinstance(operands, dict):
        raise ValueError(f"Condition '{operator}' requires a dict operand, got: {type(operands)}")
    if "var" not in operands:
        raise ValueError(f"Condition '{operator}' requires 'var' key.")
    if "values" not in operands:
        raise ValueError(f"Condition '{operator}' requires 'values' key.")
    values = operands["values"]
    if not isinstance(values, (list, tuple, set)):
        raise ValueError(f"Condition '{operator}' 'values' must be a list.")
    return operands["var"], values