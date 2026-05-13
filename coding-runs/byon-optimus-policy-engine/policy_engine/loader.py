"""
loader.py — Workflow file loader and validator.

All workflow YAML/JSON is UNTRUSTED INPUT (invariant_config_is_untrusted).
This module is the single entry point for external workflow data.
Unknown keys are rejected here before any domain object is constructed.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

from policy_engine.models import WorkflowDefinition, Step, Condition


class ValidationError(Exception):
    """Raised when a workflow file fails schema validation."""


# ---------------------------------------------------------------------------
# Allowlists — the ONLY keys permitted at each level.
# Any key not in these sets is rejected (including `policy_gate`).
# ---------------------------------------------------------------------------

_WORKFLOW_ALLOWED_KEYS = frozenset({"name", "steps"})

_STEP_ALLOWED_KEYS = frozenset(
    {"name", "handler", "depends_on", "condition"}
)

_CONDITION_ALLOWED_KEYS = frozenset(
    {"equals", "not_equals", "exists", "not_exists"}
)

_CONDITION_OPERAND_ALLOWED_KEYS = frozenset({"var", "value"})

# Identifier pattern: only safe characters allowed in names/handler refs.
import re
_IDENTIFIER_RE = re.compile(r"^[a-zA-Z0-9_-]{1,128}$")


def _check_identifier(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise ValidationError(f"{field} must be a string, got {type(value).__name__}")
    if not _IDENTIFIER_RE.match(value):
        raise ValidationError(
            f"{field} must match [a-zA-Z0-9_-] (1-128 chars), got: {value!r}"
        )
    return value


def _reject_unknown_keys(mapping: dict, allowed: frozenset, context: str) -> None:
    unknown = set(mapping.keys()) - allowed
    if unknown:
        # Sort for deterministic error messages.
        bad = ", ".join(sorted(unknown))
        raise ValidationError(
            f"Unknown key(s) in {context}: {bad}. "
            f"Allowed keys: {sorted(allowed)}. "
            f"Workflow config cannot override engine behaviour "
            f"(invariant_no_policy_bypass, invariant_config_is_untrusted)."
        )


def _parse_condition(raw: Any, step_name: str) -> Condition:
    if not isinstance(raw, dict):
        raise ValidationError(
            f"Step '{step_name}': condition must be a mapping, got {type(raw).__name__}"
        )
    _reject_unknown_keys(raw, _CONDITION_ALLOWED_KEYS, f"step '{step_name}' condition")

    if len(raw) != 1:
        raise ValidationError(
            f"Step '{step_name}': condition must have exactly one operator, got {list(raw.keys())}"
        )

    operator, operands = next(iter(raw.items()))

    if operator in ("equals", "not_equals"):
        if not isinstance(operands, dict):
            raise ValidationError(
                f"Step '{step_name}': condition '{operator}' operands must be a mapping"
            )
        _reject_unknown_keys(
            operands,
            _CONDITION_OPERAND_ALLOWED_KEYS,
            f"step '{step_name}' condition '{operator}'",
        )
        var = _check_identifier(operands.get("var", ""), f"step '{step_name}' condition var")
        value = operands.get("value")
        if value is None:
            raise ValidationError(
                f"Step '{step_name}': condition '{operator}' missing 'value'"
            )
        if not isinstance(value, (str, int, float, bool)):
            raise ValidationError(
                f"Step '{step_name}': condition value must be a scalar, got {type(value).__name__}"
            )
        return Condition(operator=operator, var=var, value=value)

    if operator in ("exists", "not_exists"):
        var = _check_identifier(
            operands if isinstance(operands, str) else "",
            f"step '{step_name}' condition var",
        )
        return Condition(operator=operator, var=var, value=None)

    raise ValidationError(
        f"Step '{step_name}': unknown condition operator '{operator}'"
    )


def _parse_step(raw: Any, index: int) -> Step:
    if not isinstance(raw, dict):
        raise ValidationError(f"Step at index {index} must be a mapping")

    _reject_unknown_keys(raw, _STEP_ALLOWED_KEYS, f"step[{index}]")

    name = _check_identifier(raw.get("name", ""), f"step[{index}].name")
    handler = _check_identifier(raw.get("handler", ""), f"step[{index}].handler")

    depends_on_raw = raw.get("depends_on", [])
    if not isinstance(depends_on_raw, list):
        raise ValidationError(f"Step '{name}': depends_on must be a list")
    depends_on = [
        _check_identifier(d, f"step '{name}' depends_on[{i}]")
        for i, d in enumerate(depends_on_raw)
    ]

    condition = None
    if "condition" in raw:
        condition = _parse_condition(raw["condition"], name)

    return Step(name=name, handler=handler, depends_on=depends_on, condition=condition)


def _parse_workflow(raw: Any) -> WorkflowDefinition:
    if not isinstance(raw, dict):
        raise ValidationError("Workflow must be a YAML/JSON mapping at the top level")

    _reject_unknown_keys(raw, _WORKFLOW_ALLOWED_KEYS, "workflow root")

    name = _check_identifier(raw.get("name", ""), "workflow.name")

    steps_raw = raw.get("steps", [])
    if not isinstance(steps_raw, list):
        raise ValidationError("workflow.steps must be a list")
    if not steps_raw:
        raise ValidationError("workflow.steps must not be empty")

    steps = [_parse_step(s, i) for i, s in enumerate(steps_raw)]

    # Validate depends_on references
    step_names = {s.name for s in steps}
    for step in steps:
        for dep in step.depends_on:
            if dep not in step_names:
                raise ValidationError(
                    f"Step '{step.name}' depends_on unknown step '{dep}'"
                )
        if step.name in step.depends_on:
            raise ValidationError(
                f"Step '{step.name}' depends_on itself (self-loop not allowed)"
            )

    return WorkflowDefinition(name=name, steps=steps)


def load_workflow(path: str | Path) -> WorkflowDefinition:
    """
    Load and validate a workflow from a YAML or JSON file.

    Raises ValidationError on any schema violation, unknown key, or
    structural problem. This is the untrusted-input boundary.
    """
    path = Path(path)
    if not path.exists():
        raise ValidationError(f"Workflow file not found: {path}")

    suffix = path.suffix.lower()
    text = path.read_text(encoding="utf-8")

    if suffix in (".yaml", ".yml"):
        try:
            raw = yaml.safe_load(text)
        except yaml.YAMLError as exc:
            raise ValidationError(f"YAML parse error: {exc}") from exc
    elif suffix == ".json":
        try:
            raw = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValidationError(f"JSON parse error: {exc}") from exc
    else:
        raise ValidationError(f"Unsupported file extension: {suffix!r} (use .yaml, .yml, or .json)")

    return _parse_workflow(raw)


def load_workflow_from_string(text: str, fmt: str = "yaml") -> WorkflowDefinition:
    """
    Load and validate a workflow from a string (for testing / API use).

    fmt: 'yaml' or 'json'
    """
    if fmt == "yaml":
        try:
            raw = yaml.safe_load(text)
        except yaml.YAMLError as exc:
            raise ValidationError(f"YAML parse error: {exc}") from exc
    elif fmt == "json":
        try:
            raw = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValidationError(f"JSON parse error: {exc}") from exc
    else:
        raise ValidationError(f"Unknown format: {fmt!r}")

    return _parse_workflow(raw)