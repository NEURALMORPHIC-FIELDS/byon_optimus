"""Load WorkflowDefinition from YAML or JSON. REQ_CONFIG_UNTRUSTED: validate on load.

REQ_NO_POLICY_BYPASS: workflow files are untrusted input and MUST NOT be able to
disable or bypass policy gates.  Any attempt to set a bypass directive in the
workflow file (e.g. ``policy_gate: bypass_all``) is rejected at load time with a
LoadError.  The only operator-controlled fast-path is the ``--policy-mode``
CLI flag / ``POLICY_MODE`` environment variable, which lives outside the
untrusted workflow file and is always audited.
"""
from __future__ import annotations
import json
import pathlib
from typing import Any

try:
    import yaml
    _YAML_AVAILABLE = True
except ImportError:
    _YAML_AVAILABLE = False

from policy_engine.models import WorkflowDefinition, WorkflowStep, StepCondition


class LoadError(ValueError):
    pass


# ---------------------------------------------------------------------------
# REQ_NO_POLICY_BYPASS — forbidden keys that must never appear in untrusted
# workflow config.  Checked at both the workflow level and the step level.
# ---------------------------------------------------------------------------

# Top-level workflow keys that attempt to influence policy enforcement.
_FORBIDDEN_WORKFLOW_KEYS: dict[str, str] = {
    "policy_gate": (
        "Top-level 'policy_gate' is not a valid workflow field. "
        "Workflow files cannot disable or bypass policy gates. "
        "If you need a permissive mode for testing, use the "
        "'--policy-mode=permissive' CLI flag or the POLICY_MODE "
        "environment variable (operator-controlled, always audited)."
    ),
    "policy_mode": (
        "Top-level 'policy_mode' is not a valid workflow field. "
        "Policy mode is an operator-controlled setting; it cannot be "
        "set inside an untrusted workflow file."
    ),
}

# Step-level keys that attempt to influence policy enforcement.
_FORBIDDEN_STEP_KEYS: dict[str, str] = {
    "policy_gate": (
        "Step field 'policy_gate' (singular) is not valid. "
        "Use 'policy_gates' (plural) to declare gates. "
        "If this was an attempt to bypass policy, it is rejected: "
        "REQ_NO_POLICY_BYPASS."
    ),
}

# Specific values that are unconditionally forbidden wherever they appear.
_FORBIDDEN_VALUES: set[str] = {"bypass_all", "bypass-all", "BYPASS_ALL"}


def load_workflow(path: str | pathlib.Path) -> WorkflowDefinition:
    p = pathlib.Path(path)
    if not p.exists():
        raise LoadError(f"File not found: {path}")
    raw = p.read_text(encoding="utf-8")
    suffix = p.suffix.lower()
    if suffix in (".yaml", ".yml"):
        if not _YAML_AVAILABLE:
            raise LoadError("PyYAML not installed")
        data: Any = yaml.safe_load(raw)
    elif suffix == ".json":
        data = json.loads(raw)
    else:
        raise LoadError(f"Unsupported format: {suffix}")
    return _parse(data)


def _check_forbidden_value(key: str, value: Any, context: str) -> None:
    """Raise LoadError if *value* is a known bypass directive. REQ_NO_POLICY_BYPASS."""
    if isinstance(value, str) and value in _FORBIDDEN_VALUES:
        raise LoadError(
            f"REQ_NO_POLICY_BYPASS: {context}: field {key!r} contains forbidden "
            f"bypass value {value!r}. Workflow files cannot disable policy gates. "
            f"Use '--policy-mode=permissive' (operator-controlled CLI flag) for "
            f"testing instead."
        )


def _parse_condition(raw: Any, step_name: str) -> StepCondition:
    """Parse a condition block from untrusted config. REQ_CONFIG_UNTRUSTED."""
    if not isinstance(raw, dict):
        raise LoadError(f"Step {step_name!r}: 'condition' must be a mapping")

    known_operators = {"equals"}
    operator_keys = [k for k in raw if k in known_operators]
    unknown_keys = [k for k in raw if k not in known_operators]

    if unknown_keys:
        raise LoadError(
            f"Step {step_name!r}: unknown condition operator(s): {unknown_keys}. "
            f"Supported: {sorted(known_operators)}"
        )
    if len(operator_keys) != 1:
        raise LoadError(
            f"Step {step_name!r}: condition must contain exactly one operator "
            f"(supported: {sorted(known_operators)}), got {operator_keys}"
        )

    operator = operator_keys[0]
    body = raw[operator]

    if not isinstance(body, dict):
        raise LoadError(
            f"Step {step_name!r}: condition.{operator} must be a mapping with "
            f"'var' and 'value' keys"
        )

    if "var" not in body:
        raise LoadError(f"Step {step_name!r}: condition.{operator} missing 'var'")
    if "value" not in body:
        raise LoadError(f"Step {step_name!r}: condition.{operator} missing 'value'")

    return StepCondition(
        operator=operator,
        var=str(body["var"]),
        value=body["value"],
    )


def _parse(data: Any) -> WorkflowDefinition:
    if not isinstance(data, dict):
        raise LoadError("Workflow must be a mapping")

    # ── REQ_NO_POLICY_BYPASS: reject forbidden top-level keys ────────────────
    for forbidden_key, message in _FORBIDDEN_WORKFLOW_KEYS.items():
        if forbidden_key in data:
            raise LoadError(
                f"REQ_NO_POLICY_BYPASS: forbidden workflow field {forbidden_key!r}. "
                f"{message}"
            )

    # Also scan all top-level values for bypass directives.
    for key, value in data.items():
        _check_forbidden_value(key, value, context="workflow level")

    name = str(data.get("name", "unnamed"))
    raw_steps = data.get("steps", [])
    if not isinstance(raw_steps, list):
        raise LoadError("'steps' must be a list")

    steps = []
    seen: set[str] = set()
    for i, s in enumerate(raw_steps):
        if not isinstance(s, dict):
            raise LoadError(f"Step {i} must be a mapping")
        sname = s.get("name")
        if not sname or not isinstance(sname, str):
            raise LoadError(f"Step {i} missing 'name'")
        if sname in seen:
            raise LoadError(f"Duplicate step name: {sname!r}")
        seen.add(sname)

        # ── REQ_NO_POLICY_BYPASS: reject forbidden step-level keys ────────────
        for forbidden_key, message in _FORBIDDEN_STEP_KEYS.items():
            if forbidden_key in s:
                raise LoadError(
                    f"REQ_NO_POLICY_BYPASS: step {sname!r} contains forbidden "
                    f"field {forbidden_key!r}. {message}"
                )

        # Scan all step values for bypass directives.
        for key, value in s.items():
            _check_forbidden_value(key, value, context=f"step {sname!r}")

        raw_condition = s.get("condition")
        condition = _parse_condition(raw_condition, sname) if raw_condition is not None else None

        steps.append(WorkflowStep(
            name=sname,
            action=str(s.get("action", "noop")),
            depends_on=list(s.get("depends_on", [])),
            policy_gates=list(s.get("policy_gates", [])),
            params=dict(s.get("params", {})),
            environment=str(s.get("environment", "dev")),
            condition=condition,
        ))

    return WorkflowDefinition(name=name, steps=steps)