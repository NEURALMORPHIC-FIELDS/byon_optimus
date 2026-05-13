"""Condition evaluation for workflow steps.

Supported condition types:
  equals:      var == value
  not_equals:  var != value
  in:          var in values (list)
  not_in:      var not in values (list)
  exists:      var is present in context (non-None)
  not_exists:  var is absent / None

All inputs come from untrusted workflow config → validated before use.
[invariant_config_is_untrusted]
"""
from __future__ import annotations

from typing import Any, Dict, Optional

# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

_SUPPORTED_OPERATORS = frozenset(
    ["equals", "not_equals", "in", "not_in", "exists", "not_exists"]
)


class ConditionError(Exception):
    """Raised when a condition definition is malformed."""


def validate_condition(cond: Any, step_id: str) -> None:
    """Raise ConditionError if *cond* is not a valid condition mapping."""
    if cond is None:
        return  # absent condition → always run

    if not isinstance(cond, dict):
        raise ConditionError(f"Step '{step_id}': condition must be a mapping, got {type(cond).__name__}")

    keys = set(cond.keys())
    matched = keys & _SUPPORTED_OPERATORS
    if not matched:
        raise ConditionError(
            f"Step '{step_id}': condition has no recognised operator. "
            f"Supported: {sorted(_SUPPORTED_OPERATORS)}"
        )
    if len(matched) > 1:
        raise ConditionError(
            f"Step '{step_id}': condition must have exactly one operator, got {sorted(matched)}"
        )

    op = next(iter(matched))
    body = cond[op]

    if op in ("exists", "not_exists"):
        if not isinstance(body, dict) or "var" not in body:
            raise ConditionError(
                f"Step '{step_id}': '{op}' condition requires a 'var' key"
            )
        _require_string(body["var"], f"Step '{step_id}': '{op}'.var")
    elif op in ("in", "not_in"):
        if not isinstance(body, dict) or "var" not in body or "values" not in body:
            raise ConditionError(
                f"Step '{step_id}': '{op}' condition requires 'var' and 'values' keys"
            )
        _require_string(body["var"], f"Step '{step_id}': '{op}'.var")
        if not isinstance(body["values"], list):
            raise ConditionError(
                f"Step '{step_id}': '{op}'.values must be a list"
            )
    else:  # equals / not_equals
        if not isinstance(body, dict) or "var" not in body or "value" not in body:
            raise ConditionError(
                f"Step '{step_id}': '{op}' condition requires 'var' and 'value' keys"
            )
        _require_string(body["var"], f"Step '{step_id}': '{op}'.var")


def _require_string(val: Any, context: str) -> None:
    if not isinstance(val, str) or not val.strip():
        raise ConditionError(f"{context} must be a non-empty string")


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

class ConditionResult:
    __slots__ = ("passed", "reason")

    def __init__(self, passed: bool, reason: str) -> None:
        self.passed = passed
        self.reason = reason

    def __repr__(self) -> str:  # pragma: no cover
        return f"ConditionResult(passed={self.passed}, reason={self.reason!r})"


def evaluate_condition(
    cond: Optional[Dict[str, Any]],
    context: Dict[str, Any],
) -> ConditionResult:
    """Evaluate *cond* against *context* variables.

    Returns ConditionResult(passed=True, …) if the step should run,
    ConditionResult(passed=False, …) if the step should be skipped.
    """
    if cond is None:
        return ConditionResult(passed=True, reason="no condition")

    op = next(k for k in cond if k in _SUPPORTED_OPERATORS)
    body = cond[op]

    if op == "equals":
        var, expected = body["var"], body["value"]
        actual = context.get(var)
        passed = actual == expected
        reason = f"{var!r}=={actual!r} {'==' if passed else '!='} {expected!r}"
        return ConditionResult(passed=passed, reason=f"equals: {reason}")

    if op == "not_equals":
        var, expected = body["var"], body["value"]
        actual = context.get(var)
        passed = actual != expected
        reason = f"{var!r}=={actual!r} {'!=' if passed else '=='} {expected!r}"
        return ConditionResult(passed=passed, reason=f"not_equals: {reason}")

    if op == "in":
        var, values = body["var"], body["values"]
        actual = context.get(var)
        passed = actual in values
        return ConditionResult(
            passed=passed,
            reason=f"in: {var!r}=={actual!r} {'∈' if passed else '∉'} {values}",
        )

    if op == "not_in":
        var, values = body["var"], body["values"]
        actual = context.get(var)
        passed = actual not in values
        return ConditionResult(
            passed=passed,
            reason=f"not_in: {var!r}=={actual!r} {'∉' if passed else '∈'} {values}",
        )

    if op == "exists":
        var = body["var"]
        passed = var in context and context[var] is not None
        return ConditionResult(
            passed=passed,
            reason=f"exists: {var!r} {'present' if passed else 'absent'}",
        )

    if op == "not_exists":
        var = body["var"]
        passed = var not in context or context[var] is None
        return ConditionResult(
            passed=passed,
            reason=f"not_exists: {var!r} {'absent' if passed else 'present'}",
        )

    # Should be unreachable after validation
    return ConditionResult(passed=True, reason="unknown operator — defaulting to run")  # pragma: no cover