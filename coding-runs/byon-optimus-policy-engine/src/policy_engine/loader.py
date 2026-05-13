"""
Workflow loader with validation.

Security invariant [invariant_no_policy_bypass] / [invariant_config_is_untrusted]:
 Untrusted workflow YAML/JSON is never allowed to disable policy enforcement.
 All fields are validated before use.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import yaml


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class StepDefinition:
 name: str
 depends_on: List[str] = field(default_factory=list)
 condition: Optional[Dict[str, Any]] = None
 action: Optional[Dict[str, Any]] = None
 rollback_action: Optional[Dict[str, Any]] = None
 policy_tags: List[str] = field(default_factory=list)


@dataclass
class WorkflowDefinition:
 name: str
 steps: List[StepDefinition]
 variables: Dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Loader / validator
# ---------------------------------------------------------------------------

class WorkflowLoader:
 """
 Loads and validates a workflow from a YAML string or file.
 [invariant_config_is_untrusted]: validates structure before returning.
 """

 # Fields that are NOT allowed to appear in untrusted step config
 # (prevents policy-bypass attempts via workflow YAML).
 _FORBIDDEN_STEP_KEYS = {"policy_override", "skip_policy", "bypass_policy", "disable_policy"}

 def load_string(self, yaml_text: str) -> WorkflowDefinition:
 try:
 raw = yaml.safe_load(yaml_text)
 except yaml.YAMLError as exc:
 raise ValueError(f"Invalid YAML: {exc}") from exc
 return self._parse(raw)

 def load_file(self, path: str) -> WorkflowDefinition:
 with open(path, "r", encoding="utf-8") as fh:
 raw = yaml.safe_load(fh)
 return self._parse(raw)

 # ------------------------------------------------------------------
 # Internal
 # ------------------------------------------------------------------

 def _parse(self, raw: Any) -> WorkflowDefinition:
 if not isinstance(raw, dict):
 raise ValueError("Workflow must be a YAML mapping at the top level.")

 name = self._require_str(raw, "name")
 raw_steps = raw.get("steps", [])
 if not isinstance(raw_steps, list):
 raise ValueError("'steps' must be a list.")

 variables: Dict[str, Any] = raw.get("variables", {}) or {}
 if not isinstance(variables, dict):
 raise ValueError("'variables' must be a mapping.")

 steps = [self._parse_step(s) for s in raw_steps]
 self._validate_dependencies(steps)

 return WorkflowDefinition(name=name, steps=steps, variables=variables)

 def _parse_step(self, raw: Any) -> StepDefinition:
 if not isinstance(raw, dict):
 raise ValueError(f"Each step must be a mapping, got: {type(raw)}")

 # [invariant_no_policy_bypass] — reject forbidden keys.
 forbidden = self._FORBIDDEN_STEP_KEYS & raw.keys()
 if forbidden:
 raise ValueError(
 f"Step contains forbidden policy-bypass keys: {sorted(forbidden)}"
 )

 name = self._require_str(raw, "name")

 depends_on = raw.get("depends_on", []) or []
 if not isinstance(depends_on, list):
 raise ValueError(f"Step '{name}': 'depends_on' must be a list.")
 depends_on = [str(d) for d in depends_on]

 condition = raw.get("condition")
 if condition is not None and not isinstance(condition, dict):
 raise ValueError(f"Step '{name}': 'condition' must be a mapping.")

 action = raw.get("action")
 if action is not None and not isinstance(action, dict):
 raise ValueError(f"Step '{name}': 'action' must be a mapping.")

 rollback_action = raw.get("rollback_action")
 if rollback_action is not None and not isinstance(rollback_action, dict):
 raise ValueError(f"Step '{name}': 'rollback_action' must be a mapping.")

 policy_tags = raw.get("policy_tags", []) or []
 if not isinstance(policy_tags, list):
 raise ValueError(f"Step '{name}': 'policy_tags' must be a list.")
 policy_tags = [str(t) for t in policy_tags]

 return StepDefinition(
 name=name,
 depends_on=depends_on,
 condition=condition,
 action=action,
 rollback_action=rollback_action,
 policy_tags=policy_tags,
 )

 def _validate_dependencies(self, steps: List[StepDefinition]) -> None:
 names = {s.name for s in steps}
 for step in steps:
 for dep in step.depends_on:
 if dep not in names:
 raise ValueError(
 f"Step '{step.name}' depends on unknown step '{dep}'."
 )

 @staticmethod
 def _require_str(mapping: dict, key: str) -> str:
 val = mapping.get(key)
 if not isinstance(val, str) or not val.strip():
 raise ValueError(f"Required string field '{key}' is missing or empty.")
 return val.strip()