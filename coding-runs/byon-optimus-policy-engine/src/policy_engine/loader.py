"""Load WorkflowDefinition from YAML or JSON. REQ_CONFIG_UNTRUSTED applies.

REQ_NO_POLICY_BYPASS: workflow files MUST NOT contain keys that attempt to
disable or bypass policy gates.  Any such key is rejected at load time with a
LoadError and (optionally) an audit entry.
"""
from __future__ import annotations
import json
import pathlib
from typing import Any

try:
    import yaml
    _YAML_AVAILABLE = True
except ImportError:  # pragma: no cover
    _YAML_AVAILABLE = False

from .models import WorkflowDefinition, WorkflowStep, StepCondition


class LoadError(ValueError):
    pass


# ---------------------------------------------------------------------------
# REQ_NO_POLICY_BYPASS — forbidden keys in workflow YAML/JSON
# ---------------------------------------------------------------------------
# These keys must never appear anywhere in a workflow file.  Workflow config
# is untrusted input (REQ_CONFIG_UNTRUSTED); it cannot grant itself elevated
# permissions or disable policy enforcement.
_FORBIDDEN_TOP_LEVEL_KEYS: frozenset[str] = frozenset({
    "policy_gate",       # singular variant
    "policy_gates_override",
    "bypass_policy",
    "skip_policy",
    "disable_policy",
})

_FORBIDDEN_STEP_KEYS: frozenset[str] = frozenset({
    "policy_gate",       # singular — only "policy_gates" (list) is valid
    "policy_gates_override",
    "bypass_policy",
    "skip_policy",
    "disable_policy",
})

# Values that are forbidden even when the key itself is otherwise valid.
# e.g. policy_gates: [bypass_all]  must be rejected.
_FORBIDDEN_GATE_VALUES: frozenset[str] = frozenset({
    "bypass_all",
    "bypass-all",
    "skip_all",
    "skip-all",
    "disable_all",
    "disable-all",
    "*",
})


def _check_forbidden_keys(data: dict[str, Any], source: str, context: str) -> None:
    """Raise LoadError if any forbidden key is present in *data*."""
    for key in _FORBIDDEN_TOP_LEVEL_KEYS if context == "top-level" else _FORBIDDEN_STEP_KEYS:
        if key in data:
            raise LoadError(
                f"{source}: [{context}] forbidden key '{key}' — "
                "workflow config cannot modify or bypass policy gates "
                "(REQ_NO_POLICY_BYPASS, REQ_CONFIG_UNTRUSTED)"
            )


def _check_forbidden_gate_values(
    gates: list[Any], source: str, step_name: str
) -> None:
    """Raise LoadError if any gate value is a known bypass token."""
    for g in gates:
        if str(g) in _FORBIDDEN_GATE_VALUES:
            raise LoadError(
                f"{source}: step '{step_name}': forbidden policy_gates value '{g}' — "
                "workflow config cannot bypass policy enforcement "
                "(REQ_NO_POLICY_BYPASS, REQ_CONFIG_UNTRUSTED)"
            )


def load_workflow(path: str | pathlib.Path) -> WorkflowDefinition:
    p = pathlib.Path(path)
    if not p.exists():
        raise LoadError(f"File not found: {p}")
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
    return _parse(data, source=str(p))


def _parse_condition(raw: Any, source: str, step_name: str) -> StepCondition | None:
    """Parse the optional `condition` block from a step definition.

    Accepted schema (only 'equals' for now):
        condition:
          equals:
            var: <str>
            value: <any>
    """
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise LoadError(
            f"{source}: step '{step_name}': 'condition' must be a mapping"
        )
    known_operators = {"equals"}
    found = [k for k in raw if k in known_operators]
    if not found:
        raise LoadError(
            f"{source}: step '{step_name}': 'condition' must contain a known "
            f"operator ({', '.join(sorted(known_operators))})"
        )
    if len(found) > 1:
        raise LoadError(
            f"{source}: step '{step_name}': 'condition' must contain exactly one operator"
        )
    operator = found[0]
    body = raw[operator]
    if not isinstance(body, dict):
        raise LoadError(
            f"{source}: step '{step_name}': condition operator '{operator}' "
            f"body must be a mapping"
        )
    if "var" not in body:
        raise LoadError(
            f"{source}: step '{step_name}': condition '{operator}' missing 'var'"
        )
    if "value" not in body:
        raise LoadError(
            f"{source}: step '{step_name}': condition '{operator}' missing 'value'"
        )
    return StepCondition(operator=operator, var=str(body["var"]), value=body["value"])


def _parse(data: Any, source: str) -> WorkflowDefinition:
    if not isinstance(data, dict):
        raise LoadError(f"{source}: top-level must be a mapping")

    # REQ_NO_POLICY_BYPASS: reject forbidden top-level keys before any parsing.
    _check_forbidden_keys(data, source, "top-level")

    name = str(data.get("name", "unnamed"))
    raw_steps = data.get("steps", [])
    if not isinstance(raw_steps, list):
        raise LoadError(f"{source}: 'steps' must be a list")

    steps: list[WorkflowStep] = []
    seen: set[str] = set()
    for i, s in enumerate(raw_steps):
        if not isinstance(s, dict):
            raise LoadError(f"{source}: step[{i}] must be a mapping")
        sname = str(s.get("name", f"step_{i}"))
        if sname in seen:
            raise LoadError(f"{source}: duplicate step name '{sname}'")
        seen.add(sname)

        # REQ_NO_POLICY_BYPASS: reject forbidden step-level keys.
        _check_forbidden_keys(s, source, f"step '{sname}'")

        raw_gates: list[Any] = list(s.get("policy_gates", []))
        # REQ_NO_POLICY_BYPASS: reject forbidden gate values.
        _check_forbidden_gate_values(raw_gates, source, sname)

        condition = _parse_condition(s.get("condition"), source, sname)
        steps.append(WorkflowStep(
            name=sname,
            action=str(s.get("action", "noop")),
            depends_on=list(s.get("depends_on", [])),
            policy_gates=raw_gates,
            params=dict(s.get("params", {})),
            environment=str(s.get("environment", "dev")),
            condition=condition,
        ))
    return WorkflowDefinition(name=name, steps=steps)