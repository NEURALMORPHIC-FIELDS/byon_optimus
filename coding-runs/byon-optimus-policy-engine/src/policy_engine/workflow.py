"""
Workflow definition loading and validation.

WorkflowDefinition  — top-level container
WorkflowStep        — single step descriptor

All data loaded from untrusted YAML/JSON is validated here before use
([invariant_config_is_untrusted]).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class WorkflowStep:
    name: str
    action: str
    depends_on: List[str] = field(default_factory=list)
    condition: Optional[Dict[str, Any]] = None
    params: Dict[str, Any] = field(default_factory=dict)


@dataclass
class WorkflowDefinition:
    name: str
    steps: List[WorkflowStep] = field(default_factory=list)
    context: Dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------

class WorkflowLoader:
    """
    Loads and validates a WorkflowDefinition from a YAML or JSON file.

    [invariant_config_is_untrusted]: all fields are validated; unknown or
    dangerous keys (e.g. policy_gate: bypass_all) are rejected.
    """

    _ALLOWED_TOP_KEYS = {"name", "steps", "context"}
    _ALLOWED_STEP_KEYS = {"name", "action", "depends_on", "condition", "params"}
    _FORBIDDEN_KEYS = {"policy_gate", "bypass_policy", "skip_policy"}

    def load(self, path: Path) -> WorkflowDefinition:
        raw = self._read(path)
        self._validate_top(raw)
        return self._parse(raw)

    # ------------------------------------------------------------------

    def _read(self, path: Path) -> Dict[str, Any]:
        text = path.read_text(encoding="utf-8")
        suffix = path.suffix.lower()
        if suffix in (".yaml", ".yml"):
            data = yaml.safe_load(text)
        elif suffix == ".json":
            data = json.loads(text)
        else:
            raise ValueError(f"Unsupported workflow file format: {suffix!r}")
        if not isinstance(data, dict):
            raise ValueError("Workflow file must be a YAML/JSON mapping at the top level.")
        return data

    def _validate_top(self, raw: Dict[str, Any]) -> None:
        # [invariant_no_policy_bypass] + [invariant_config_is_untrusted]
        for key in raw:
            if key in self._FORBIDDEN_KEYS:
                raise ValueError(
                    f"[invariant_no_policy_bypass] Forbidden key '{key}' in workflow config. "
                    f"Policy gates cannot be bypassed by workflow configuration."
                )
        unknown = set(raw.keys()) - self._ALLOWED_TOP_KEYS
        if unknown:
            raise ValueError(f"Unknown top-level workflow keys: {unknown}")
        if "name" not in raw:
            raise ValueError("Workflow must have a 'name' field.")
        if "steps" not in raw or not isinstance(raw["steps"], list):
            raise ValueError("Workflow must have a 'steps' list.")

    def _parse(self, raw: Dict[str, Any]) -> WorkflowDefinition:
        steps = [self._parse_step(s) for s in raw["steps"]]
        return WorkflowDefinition(
            name=str(raw["name"]),
            steps=steps,
            context=dict(raw.get("context", {})),
        )

    def _parse_step(self, raw: Any) -> WorkflowStep:
        if not isinstance(raw, dict):
            raise ValueError(f"Each step must be a mapping, got: {type(raw)}")
        for key in raw:
            if key in self._FORBIDDEN_KEYS:
                raise ValueError(
                    f"[invariant_no_policy_bypass] Forbidden key '{key}' in step config."
                )
        unknown = set(raw.keys()) - self._ALLOWED_STEP_KEYS
        if unknown:
            raise ValueError(f"Unknown step keys: {unknown}")
        if "name" not in raw:
            raise ValueError("Each step must have a 'name' field.")
        if "action" not in raw:
            raise ValueError(f"Step '{raw['name']}' must have an 'action' field.")
        return WorkflowStep(
            name=str(raw["name"]),
            action=str(raw["action"]),
            depends_on=list(raw.get("depends_on", [])),
            condition=raw.get("condition"),
            params=dict(raw.get("params", {})),
        )