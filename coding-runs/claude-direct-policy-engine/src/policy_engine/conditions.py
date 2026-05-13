"""Condition evaluation for workflow steps.

Supported condition types:
    equals      - var == value
    not_equals  - var != value
    in          - var in values  (values is a list)
    not_in      - var not in values
    exists      - var is present in context (truthy check)
    not_exists  - var is absent or falsy

All evaluation is pure / side-effect-free.
"""
from __future__ import annotations

from typing import Any


class ConditionError(ValueError):
    """Raised when a condition definition is structurally invalid."""


# ── individual operators ──────────────────────────────────────────────────────

def _eval_equals(expr: dict, ctx: dict[str, Any]) -> bool:
    var = _require_str(expr, "var", "equals")
    value = _require_key(expr, "value", "equals")
    return ctx.get(var) == value


def _eval_not_equals(expr: dict, ctx: dict[str, Any]) -> bool:
    var = _require_str(expr, "var", "not_equals")
    value = _require_key(expr, "value", "not_equals")
    return ctx.get(var) != value


def _eval_in(expr: dict, ctx: dict[str, Any]) -> bool:
    var = _require_str(expr, "var", "in")
    values = _require_list(expr, "values", "in")
    return ctx.get(var) in values


def _eval_not_in(expr: dict, ctx: dict[str, Any]) -> bool:
    var = _require_str(expr, "var", "not_in")
    values = _require_list(expr, "values", "not_in")
    return ctx.get(var) not in values


def _eval_exists(expr: dict, ctx: dict[str, Any]) -> bool:
    var = _require_str(expr, "var", "exists")
    return bool(ctx.get(var))


def _eval_not_exists(expr: dict, ctx: dict[str, Any]) -> bool:
    var = _require_str(expr, "var", "not_exists")
    return not bool(ctx.get(var))


def _eval_and(expr: dict, ctx: dict[str, Any]) -> bool:
    clauses = _require_list(expr, "clauses", "and")
    return all(evaluate_condition(c, ctx) for c in clauses)


def _eval_or(expr: dict, ctx: dict[str, Any]) -> bool:
    clauses = _require_list(expr, "clauses", "or")
    return any(evaluate_condition(c, ctx) for c in clauses)


_OPERATORS: dict[str, Any] = {
    "equals": _eval_equals,
    "not_equals": _eval_not_equals,
    "in": _eval_in,
    "not_in": _eval_not_in,
    "exists": _eval_exists,
    "not_exists": _eval_not_exists,
    "and": _eval_and,
    "or": _eval_or,
}


# ── public API ────────────────────────────────────────────────────────────────

def evaluate_condition(condition: dict[str, Any], ctx: dict[str, Any]) -> bool:
    """Return True if *condition* is satisfied given *ctx*.

    condition must have exactly one top-level operator key.
    """
    if not isinstance(condition, dict):
        raise ConditionError(f"Condition must be a mapping, got {type(condition)!r}")

    op_keys = [k for k in condition if k in _OPERATORS]
    if len(op_keys) == 0:
        known = ", ".join(sorted(_OPERATORS))
        raise ConditionError(
            f"Condition has no recognised operator. Known: {known}"
        )
    if len(op_keys) > 1:
        raise ConditionError(
            f"Condition has multiple operators: {op_keys}. Use 'and'/'or' to combine."
        )

    op = op_keys[0]
    expr = condition[op]
    if not isinstance(expr, dict):
        raise ConditionError(
            f"Operator {op!r} value must be a mapping, got {type(expr)!r}"
        )
    return _OPERATORS[op](expr, ctx)


def validate_condition(condition: Any) -> None:
    """Validate condition structure without a runtime context.

    Raises ConditionError if the structure is invalid.
    Does NOT evaluate — just structural checks.
    """
    if not isinstance(condition, dict):
        raise ConditionError("Condition must be a mapping")

    op_keys = [k for k in condition if k in _OPERATORS]
    if not op_keys:
        known = ", ".join(sorted(_OPERATORS))
        raise ConditionError(f"No recognised operator. Known: {known}")
    if len(op_keys) > 1:
        raise ConditionError(f"Multiple operators in condition: {op_keys}")

    op = op_keys[0]
    expr = condition[op]
    if not isinstance(expr, dict):
        raise ConditionError(f"Operator {op!r} value must be a mapping")

    if op in {"equals", "not_equals"}:
        _require_str(expr, "var", op)
        _require_key(expr, "value", op)
    elif op in {"in", "not_in"}:
        _require_str(expr, "var", op)
        _require_list(expr, "values", op)
    elif op in {"exists", "not_exists"}:
        _require_str(expr, "var", op)
    elif op in {"and", "or"}:
        clauses = _require_list(expr, "clauses", op)
        for c in clauses:
            validate_condition(c)  # recurse


# ── helpers ───────────────────────────────────────────────────────────────────

def _require_key(d: dict, key: str, op: str) -> Any:
    if key not in d:
        raise ConditionError(f"Operator {op!r} requires key {key!r}")
    return d[key]


def _require_str(d: dict, key: str, op: str) -> str:
    v = _require_key(d, key, op)
    if not isinstance(v, str):
        raise ConditionError(f"Operator {op!r}: {key!r} must be a string")
    return v


def _require_list(d: dict, key: str, op: str) -> list:
    v = _require_key(d, key, op)
    if not isinstance(v, list):
        raise ConditionError(f"Operator {op!r}: {key!r} must be a list")
    return v