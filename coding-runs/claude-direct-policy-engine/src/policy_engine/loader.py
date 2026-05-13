"""Load and validate workflow definitions from YAML or JSON.

invariant_config_is_untrusted: ALL fields from workflow files are untrusted input.
invariant_no_policy_bypass: policy gates CANNOT be disabled via workflow config.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
from typing import Any, Dict

import yaml

from .conditions import parse_condition
from .models import Step, WorkflowDefinition


ALLOWED_ENVIRONMENTS = {"development", "staging", "production"}
ALLOWED_ACTIONS = {
    "deploy", "test", "build", "notify", "migrate", "rollback",
    "approve", "scan", "lint", "package",
}
MAX_STEPS = 100
MAX_NAME_LEN = 128

# ---------------------------------------------------------------------------
# Reserved / forbidden gate names that must never appear in untrusted YAML.
# Attempting to reference one of these is an invariant violation.
# ---------------------------------------------------------------------------
_FORBIDDEN_GATE_NAMES: frozenset = frozenset({
    "bypass_all",
    "bypass-all",
    "skip_all",
    "skip-all",
    "no_policy",
    "no-policy",
    "disable_policy",
    "disable-policy",
    "allow_all",
    "allow-all",
    "open",
    "none",
    "*",
})

# Workflow-level keys that signal an attempted bypass (invariant_no_policy_bypass)
_BYPASS_KEYS: frozenset = frozenset({
    "skip_policy", "bypass_policy", "disable_policy",
    "skip-policy", "bypass-policy", "disable-policy",
})


class ValidationError(Exception):
    pass


def _load_raw(path: Path) -> Dict[str, Any]:
    suffix = path.suffix.lower()
    with open(path, "r", encoding="utf-8") as fh:
        if suffix in (".yaml", ".yml"):
            data = yaml.safe_load(fh)
        elif suffix == ".json":
            data = json.load(fh)
        else:
            raise ValidationError(f"Unsupported file format: {suffix}")
    if not isinstance(data, dict):
        raise ValidationError("Workflow file must be a YAML/JSON object at the top level")
    return data


def _validate_str(value: Any, field: str, max_len: int = MAX_NAME_LEN) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"'{field}' must be a non-empty string")
    if len(value) > max_len:
        raise ValidationError(f"'{field}' exceeds maximum length of {max_len}")
    return value.strip()


def _reject_bypass_keys(raw: dict, step_index: int) -> None:
    """Reject any step-level field that attempts to disable policy enforcement."""
    for key in _BYPASS_KEYS:
        if raw.get(key):
            raise ValidationError(
                f"steps[{step_index}]: field '{key}' is forbidden — "
                "policy bypass via workflow config violates invariant_no_policy_bypass"
            )


def _reject_forbidden_gate(gate_name: str, step_id: str) -> None:
    """Reject reserved gate names that signal a bypass attempt."""
    normalised = gate_name.lower().strip()
    if normalised in _FORBIDDEN_GATE_NAMES:
        raise ValidationError(
            f"Step '{step_id}': policy_gate value '{gate_name}' is reserved and forbidden. "
            "Policy gates cannot be bypassed via workflow config "
            "(invariant_no_policy_bypass). "
            "If you need a permissive mode for testing, use the operator-controlled "
            "--policy-mode=permissive CLI flag instead."
        )


def _parse_step(raw: Any, index: int) -> Step:
    if not isinstance(raw, dict):
        raise ValidationError(f"Step #{index} must be a mapping")

    step_id = _validate_str(raw.get("id", ""), f"steps[{index}].id")
    name = _validate_str(raw.get("name", ""), f"steps[{index}].name")
    action = _validate_str(raw.get("action", ""), f"steps[{index}].action")

    if action not in ALLOWED_ACTIONS:
        raise ValidationError(
            f"steps[{index}].action '{action}' is not allowed. "
            f"Allowed: {sorted(ALLOWED_ACTIONS)}"
        )

    depends_on = raw.get("depends_on", [])
    if not isinstance(depends_on, list):
        raise ValidationError(f"steps[{index}].depends_on must be a list")
    depends_on = [
        _validate_str(d, f"steps[{index}].depends_on[{i}]")
        for i, d in enumerate(depends_on)
    ]

    policy_gate = raw.get("policy_gate")
    if policy_gate is not None:
        policy_gate = _validate_str(policy_gate, f"steps[{index}].policy_gate")
        # invariant_no_policy_bypass: reject forbidden/reserved gate names
        _reject_forbidden_gate(policy_gate, step_id)

    environment = raw.get("environment", "development")
    if environment not in ALLOWED_ENVIRONMENTS:
        raise ValidationError(
            f"steps[{index}].environment '{environment}' invalid. "
            f"Allowed: {sorted(ALLOWED_ENVIRONMENTS)}"
        )

    params = raw.get("params", {})
    if not isinstance(params, dict):
        raise ValidationError(f"steps[{index}].params must be a mapping")

    # invariant_no_policy_bypass: reject boolean bypass fields
    _reject_bypass_keys(raw, index)

    condition = None
    raw_condition = raw.get("condition")
    if raw_condition is not None:
        try:
            condition = parse_condition(raw_condition, step_id)
        except ValueError as exc:
            raise ValidationError(str(exc)) from exc

    return Step(
        id=step_id,
        name=name,
        action=action,
        depends_on=depends_on,
        policy_gate=policy_gate,
        params=params,
        environment=environment,
        condition=condition,
    )


def load_workflow(path: os.PathLike) -> WorkflowDefinition:
    """Load, validate, and return a WorkflowDefinition (invariant_config_is_untrusted)."""
    path = Path(path)
    if not path.exists():
        raise ValidationError(f"File not found: {path}")

    raw = _load_raw(path)

    name = _validate_str(raw.get("name", ""), "name")
    version = _validate_str(raw.get("version", ""), "version")

    raw_steps = raw.get("steps", [])
    if not isinstance(raw_steps, list):
        raise ValidationError("'steps' must be a list")
    if len(raw_steps) > MAX_STEPS:
        raise ValidationError(f"Too many steps (max {MAX_STEPS})")
    if not raw_steps:
        raise ValidationError("Workflow must have at least one step")

    steps = [_parse_step(s, i) for i, s in enumerate(raw_steps)]

    seen_ids: set = set()
    for s in steps:
        if s.id in seen_ids:
            raise ValidationError(f"Duplicate step id: '{s.id}'")
        seen_ids.add(s.id)

    for s in steps:
        for dep in s.depends_on:
            if dep not in seen_ids:
                raise ValidationError(
                    f"Step '{s.id}' depends_on unknown step '{dep}'"
                )

    _check_no_cycles(steps)

    metadata = raw.get("metadata", {})
    if not isinstance(metadata, dict):
        metadata = {}

    return WorkflowDefinition(name=name, version=version, steps=steps, metadata=metadata)


def _check_no_cycles(steps: list) -> None:
    from collections import deque
    in_degree: dict = {s.id: 0 for s in steps}
    for s in steps:
        for dep in s.depends_on:
            in_degree[s.id] += 1

    queue = deque(sid for sid, deg in in_degree.items() if deg == 0)
    visited = 0
    while queue:
        node = queue.popleft()
        visited += 1
        for s in steps:
            if node in s.depends_on:
                in_degree[s.id] -= 1
                if in_degree[s.id] == 0:
                    queue.append(s.id)

    if visited != len(steps):
        raise ValidationError("Workflow steps contain a cycle")