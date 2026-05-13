"""Workflow loader — validates untrusted YAML/JSON input.

invariant_config_is_untrusted: every field is validated before use.
invariant_no_policy_bypass: workflow YAML/JSON may never disable policy gates.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml

from .conditions import ConditionError, validate_condition
from .models import Step, Workflow

_SAFE_ID = re.compile(r'^[A-Za-z0-9_\-]+$')
_VALID_ENVS = {"development", "staging", "production"}
_VALID_ACTIONS = {
    "deploy", "test", "build", "notify", "validate",
    "migrate", "rollback", "approve",
}

# Allowlist of gate names that may appear in workflow files.
# "bypass_all" and any other meta-gate are explicitly excluded.
# invariant_no_policy_bypass: this list must never include bypass sentinels.
_VALID_GATES = {
    "build_gate",
    "test_gate",
    "deploy_gate",
    "notify_gate",
    "migrate_gate",
    "production_gate",
    "approve_gate",
}

# Sentinel values that must never be accepted from untrusted input.
# We keep an explicit denylist as defence-in-depth even though the allowlist
# already excludes them — belt-and-braces.
_GATE_DENYLIST = {
    "bypass_all",
    "bypass",
    "skip_policy",
    "no_policy",
    "allow_all",
    "permit_all",
    "disable_policy",
}


def _require(cond: bool, msg: str) -> None:
    if not cond:
        raise ValueError(msg)


def _validate_gate_name(gate: Any, step_id: str) -> None:
    """Validate a policy_gate value from untrusted input.

    Raises ValueError for:
      - any bypass/sentinel value            (invariant_no_policy_bypass)
      - any value not on the known-gate allowlist
    """
    if gate is None:
        return  # absent gate is always fine
    _require(isinstance(gate, str), f"Step {step_id}: policy_gate must be a string")
    # Denylist check first — loud, clear error message
    if gate.lower() in _GATE_DENYLIST:
        raise ValueError(
            f"Step {step_id!r}: policy_gate value {gate!r} is not permitted. "
            "Workflow YAML/JSON must not disable or bypass policy gates "
            "(invariant_no_policy_bypass). "
            "If you need a permissive mode for testing, use the CLI flag "
            "--policy-mode=permissive, which is operator-controlled and audited."
        )
    # Allowlist check — rejects unknown gate names
    _require(
        gate in _VALID_GATES,
        f"Step {step_id!r}: unknown policy_gate {gate!r}. "
        f"Known gates: {sorted(_VALID_GATES)}",
    )


def _validate_step_dict(raw: Any, step_ids: set[str]) -> None:
    _require(isinstance(raw, dict), "Each step must be a mapping")
    _require("id" in raw, "Step missing 'id'")
    _require("action" in raw, f"Step {raw.get('id')} missing 'action'")

    sid = raw["id"]
    _require(isinstance(sid, str) and bool(_SAFE_ID.match(sid)),
             f"Invalid step id: {sid!r}")
    _require(raw["action"] in _VALID_ACTIONS,
             f"Unknown action {raw['action']!r} in step {sid}")

    env = raw.get("environment", "development")
    _require(env in _VALID_ENVS,
             f"Invalid environment {env!r} in step {sid}")

    for dep in raw.get("depends_on", []):
        _require(dep in step_ids,
                 f"Step {sid} depends_on unknown step {dep!r}")

    # Gate validation — allowlist + denylist (invariant_no_policy_bypass)
    _validate_gate_name(raw.get("policy_gate"), sid)

    # Condition structural validation (invariant_config_is_untrusted)
    if "condition" in raw:
        try:
            validate_condition(raw["condition"])
        except ConditionError as exc:
            raise ValueError(f"Step {sid} has invalid condition: {exc}") from exc


def _parse_raw(data: Any) -> Workflow:
    _require(isinstance(data, dict), "Workflow config must be a mapping")
    _require("id" in data, "Workflow missing 'id'")
    _require("steps" in data, "Workflow missing 'steps'")

    wid = data["id"]
    _require(isinstance(wid, str) and bool(_SAFE_ID.match(wid)),
             f"Invalid workflow id: {wid!r}")

    raw_steps = data["steps"]
    _require(isinstance(raw_steps, list) and raw_steps,
             "steps must be a non-empty list")

    # Collect IDs first for dependency validation
    step_ids: set[str] = set()
    for rs in raw_steps:
        if isinstance(rs, dict) and "id" in rs:
            step_ids.add(rs["id"])

    steps: list[Step] = []
    seen: set[str] = set()
    for rs in raw_steps:
        _validate_step_dict(rs, step_ids)
        sid = rs["id"]
        _require(sid not in seen, f"Duplicate step id: {sid!r}")
        seen.add(sid)
        steps.append(Step(
            id=sid,
            name=rs.get("name", sid),
            action=rs["action"],
            depends_on=list(rs.get("depends_on", [])),
            policy_gate=rs.get("policy_gate"),
            condition=rs.get("condition"),
            params=dict(rs.get("params", {})),
            environment=rs.get("environment", "development"),
        ))

    _detect_cycles(steps)

    variables = data.get("variables", {})
    _require(isinstance(variables, dict),
             "workflow 'variables' must be a mapping")

    return Workflow(
        id=wid,
        name=data.get("name", wid),
        steps=steps,
        metadata=dict(data.get("metadata", {})),
        variables=dict(variables),
    )


def _detect_cycles(steps: list[Step]) -> None:
    graph: dict[str, list[str]] = {s.id: s.depends_on for s in steps}
    visited: set[str] = set()
    stack: set[str] = set()

    def dfs(node: str) -> None:
        if node in stack:
            raise ValueError(f"Cycle detected involving step {node!r}")
        if node in visited:
            return
        stack.add(node)
        for dep in graph.get(node, []):
            dfs(dep)
        stack.discard(node)
        visited.add(node)

    for sid in graph:
        dfs(sid)


def load_workflow(path: str | Path) -> Workflow:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Workflow file not found: {path}")
    raw_text = p.read_text(encoding="utf-8")
    suffix = p.suffix.lower()
    if suffix in {".yaml", ".yml"}:
        data = yaml.safe_load(raw_text)
    elif suffix == ".json":
        data = json.loads(raw_text)
    else:
        raise ValueError(f"Unsupported file type: {suffix}")
    return _parse_raw(data)