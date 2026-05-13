"""Workflow loader — validates and deserialises YAML/JSON workflow definitions.

Invariant: [invariant_config_is_untrusted] — all input is validated before use.
Invariant: [invariant_no_policy_bypass]    — workflow YAML cannot disable policy gates.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict

import yaml

from .conditions import ConditionError, validate_condition
from .models import PolicyGate, Step, Workflow

_VALID_ACTION_RE = re.compile(r"^[a-zA-Z0-9_\-\.]+$")
_SAFE_ID_RE = re.compile(r"^[a-zA-Z0-9_\-]+$")

# ---------------------------------------------------------------------------
# Reserved gate names that MUST be rejected at load time.
# These names are blocked regardless of casing or surrounding whitespace so
# that no creative spelling can slip through validation.
# [invariant_no_policy_bypass]
# ---------------------------------------------------------------------------
_RESERVED_GATE_NAMES: frozenset = frozenset(
    [
        "bypass_all",
        "bypass",
        "skip_all",
        "skip",
        "no_policy",
        "nopolicy",
        "disable_policy",
        "disable",
        "allow_all",
        "allowall",
        "passthrough",
        "open",
        "unrestricted",
    ]
)


class WorkflowValidationError(Exception):
    pass


def _require(cond: bool, msg: str) -> None:
    if not cond:
        raise WorkflowValidationError(msg)


def _validate_id(value: str, context: str) -> None:
    _require(isinstance(value, str) and bool(value), f"{context}: id must be a non-empty string")
    _require(bool(_SAFE_ID_RE.match(value)), f"{context}: id '{value}' contains invalid characters")


def _reject_reserved_gate_name(name: str, context: str) -> None:
    """Raise WorkflowValidationError if *name* is a reserved bypass keyword.

    This is the primary enforcement point for [invariant_no_policy_bypass].
    The check is case-insensitive and strip()-normalised so that 'Bypass_All',
    ' bypass_all ', etc. are all caught.
    """
    normalised = name.strip().lower()
    if normalised in _RESERVED_GATE_NAMES:
        raise WorkflowValidationError(
            f"{context}: '{name}' is a reserved name that cannot be used as a gate "
            f"identifier. Workflow YAML/JSON is untrusted input and must never be "
            f"allowed to bypass policy enforcement. "
            f"[invariant_no_policy_bypass]"
        )


def _load_raw(path: Path) -> Any:
    suffix = path.suffix.lower()
    text = path.read_text(encoding="utf-8")
    if suffix in (".yaml", ".yml"):
        # safe_load — never full_load on untrusted input
        return yaml.safe_load(text)
    if suffix == ".json":
        return json.loads(text)
    raise WorkflowValidationError(
        f"Unsupported file extension: {suffix!r}. Use .yaml, .yml, or .json"
    )


def load_workflow(path: Path) -> Workflow:
    """Load, validate, and return a Workflow from a YAML/JSON file.

    Raises WorkflowValidationError for any structural or security violation.
    """
    _require(path.exists(), f"Workflow file not found: {path}")
    raw = _load_raw(path)
    return _parse_workflow(raw)


def _parse_workflow(raw: Any) -> Workflow:
    _require(isinstance(raw, dict), "Workflow must be a YAML/JSON mapping")

    name = raw.get("name", "")
    _require(isinstance(name, str) and name.strip(), "Workflow 'name' must be a non-empty string")

    version = str(raw.get("version", "1.0"))

    # ------------------------------------------------------------------ gates
    gates_raw = raw.get("gates", {}) or {}
    _require(isinstance(gates_raw, dict), "'gates' must be a mapping")
    gates: Dict[str, PolicyGate] = {}
    for gate_name, gate_def in gates_raw.items():
        # Security: reject reserved/bypass names before any other processing
        _reject_reserved_gate_name(gate_name, f"gate definition '{gate_name}'")
        _validate_id(gate_name, f"gate '{gate_name}'")
        _require(isinstance(gate_def, dict), f"Gate '{gate_name}' must be a mapping")
        required_role = gate_def.get("required_role", "")
        _require(
            isinstance(required_role, str) and required_role.strip(),
            f"Gate '{gate_name}': 'required_role' must be a non-empty string",
        )
        gates[gate_name] = PolicyGate(
            name=gate_name,
            required_role=required_role,
            description=str(gate_def.get("description", "")),
        )

    # ------------------------------------------------------------------ steps
    steps_raw = raw.get("steps", []) or []
    _require(isinstance(steps_raw, list) and steps_raw, "Workflow must have at least one step")

    step_ids: set = set()
    steps: list = []
    for i, s in enumerate(steps_raw):
        _require(isinstance(s, dict), f"Step #{i} must be a mapping")
        sid = s.get("id", "")
        _validate_id(sid, f"step #{i}")
        _require(sid not in step_ids, f"Duplicate step id: '{sid}'")
        step_ids.add(sid)

        action = s.get("action", "")
        _require(isinstance(action, str) and bool(action), f"Step '{sid}': 'action' must be non-empty")
        _require(
            bool(_VALID_ACTION_RE.match(action)),
            f"Step '{sid}': invalid action '{action}'",
        )

        depends_on = s.get("depends_on", []) or []
        _require(isinstance(depends_on, list), f"Step '{sid}': 'depends_on' must be a list")
        for dep in depends_on:
            _require(isinstance(dep, str), f"Step '{sid}': dependency must be a string, got {dep!r}")

        policy_gates = s.get("policy_gates", []) or []
        _require(isinstance(policy_gates, list), f"Step '{sid}': 'policy_gates' must be a list")
        for pg in policy_gates:
            _require(isinstance(pg, str), f"Step '{sid}': policy gate ref must be a string")
            # Security: reject reserved names in step-level gate references too
            _reject_reserved_gate_name(pg, f"step '{sid}' policy_gates entry")
            _require(pg in gates, f"Step '{sid}': references unknown gate '{pg}'")

        params = s.get("params", {}) or {}
        _require(isinstance(params, dict), f"Step '{sid}': 'params' must be a mapping")

        condition = s.get("condition", None)
        try:
            validate_condition(condition, sid)
        except ConditionError as exc:
            raise WorkflowValidationError(str(exc)) from exc

        steps.append(
            Step(
                id=sid,
                name=str(s.get("name", sid)),
                action=action,
                depends_on=depends_on,
                policy_gates=policy_gates,
                params=params,
                condition=condition,
            )
        )

    for step in steps:
        for dep in step.depends_on:
            _require(dep in step_ids, f"Step '{step.id}': unknown dependency '{dep}'")

    _check_no_cycles(steps)

    return Workflow(
        name=name,
        version=version,
        steps=steps,
        gates=gates,
        description=str(raw.get("description", "")),
    )


def _check_no_cycles(steps: list) -> None:
    in_degree: Dict[str, int] = {s.id: 0 for s in steps}
    dependents: Dict[str, list] = {s.id: [] for s in steps}

    for s in steps:
        for dep in s.depends_on:
            in_degree[s.id] += 1
            dependents[dep].append(s.id)

    queue = [sid for sid, deg in in_degree.items() if deg == 0]
    visited = 0
    while queue:
        node = queue.pop(0)
        visited += 1
        for dep in dependents[node]:
            in_degree[dep] -= 1
            if in_degree[dep] == 0:
                queue.append(dep)

    if visited != len(steps):
        raise WorkflowValidationError("Workflow contains a dependency cycle")