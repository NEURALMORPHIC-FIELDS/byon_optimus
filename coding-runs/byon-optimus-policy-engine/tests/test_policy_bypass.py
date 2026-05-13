"""Tests for REQ_NO_POLICY_BYPASS and the operator permissive fast-path.

These tests verify:
  1. policy_gate: bypass_all in a workflow file is REJECTED at load time.
  2. All known bypass key/value variants are rejected.
  3. The operator --policy-mode=permissive path works correctly AND audits every
     override — it is never silent.
  4. policy_mode cannot be sourced from workflow YAML/JSON.
  5. PolicyEngine rejects unknown policy_mode values.
"""
from __future__ import annotations
import json
import pathlib
import pytest

from policy_engine.loader import load_workflow, LoadError
from policy_engine.models import WorkflowDefinition, WorkflowStep
from policy_engine.planner import build_plan
from policy_engine.audit import AuditLog
from policy_engine.permissions import PermissionModel
from policy_engine.engine import PolicyEngine


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write(tmp_path: pathlib.Path, name: str, content: str) -> pathlib.Path:
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


def _make_engine(
    role: str = "developer",
    context: dict | None = None,
    policy_mode: str = "enforced",
) -> PolicyEngine:
    return PolicyEngine(
        permissions=PermissionModel(role=role),
        audit=AuditLog(),
        context=context or {},
        policy_mode=policy_mode,  # type: ignore[arg-type]
    )


# ---------------------------------------------------------------------------
# REQ_NO_POLICY_BYPASS — loader rejects bypass attempts in YAML
# ---------------------------------------------------------------------------

class TestLoaderRejectsBypassYAML:
    """policy_gate: bypass_all (and variants) in YAML must be rejected."""

    def test_top_level_policy_gate_key_rejected(self, tmp_path):
        """Top-level 'policy_gate: bypass_all' must raise LoadError."""
        p = _write(tmp_path, "bad.yaml", """
name: bad-wf
policy_gate: bypass_all
steps:
  - name: build
    action: compile
""")
        with pytest.raises(LoadError, match="forbidden key 'policy_gate'"):
            load_workflow(p)

    def test_step_level_policy_gate_key_rejected(self, tmp_path):
        """Step-level 'policy_gate: bypass_all' must raise LoadError."""
        p = _write(tmp_path, "bad_step.yaml", """
name: bad-wf
steps:
  - name: build
    action: compile
    policy_gate: bypass_all
""")
        with pytest.raises(LoadError, match="forbidden key 'policy_gate'"):
            load_workflow(p)

    def test_bypass_all_as_gate_value_rejected(self, tmp_path):
        """policy_gates: [bypass_all] must raise LoadError."""
        p = _write(tmp_path, "bypass_val.yaml", """
name: bad-wf
steps:
  - name: build
    action: compile
    policy_gates: [bypass_all]
""")
        with pytest.raises(LoadError, match="forbidden policy_gates value 'bypass_all'"):
            load_workflow(p)

    def test_bypass_all_hyphen_variant_rejected(self, tmp_path):
        """policy_gates: [bypass-all] must raise LoadError."""
        p = _write(tmp_path, "bypass_hyphen.yaml", """
name: bad-wf
steps:
  - name: build
    action: compile
    policy_gates: [bypass-all]
""")
        with pytest.raises(LoadError, match="forbidden policy_gates value 'bypass-all'"):
            load_workflow(p)

    def test_skip_all_gate_value_rejected(self, tmp_path):
        """policy_gates: [skip_all] must raise LoadError."""
        p = _write(tmp_path, "skip_all.yaml", """
name: bad-wf
steps:
  - name: build
    action: compile
    policy_gates: [skip_all]
""")
        with pytest.raises(LoadError, match="forbidden policy_gates value 'skip_all'"):
            load_workflow(p)

    def test_wildcard_gate_value_rejected(self, tmp_path):
        """policy_gates: ['*'] must raise LoadError."""
        p = _write(tmp_path, "wildcard.yaml", """
name: bad-wf
steps:
  - name: build
    action: compile
    policy_gates: ['*']
""")
        with pytest.raises(LoadError, match=r"forbidden policy_gates value '\*'"):
            load_workflow(p)

    def test_bypass_policy_key_rejected(self, tmp_path):
        """'bypass_policy' key at top level must raise LoadError."""
        p = _write(tmp_path, "bypass_policy.yaml", """
name: bad-wf
bypass_policy: true
steps:
  - name: build
    action: compile
""")
        with pytest.raises(LoadError, match="forbidden key 'bypass_policy'"):
            load_workflow(p)

    def test_disable_policy_key_rejected(self, tmp_path):
        """'disable_policy' key at step level must raise LoadError."""
        p = _write(tmp_path, "disable_policy.yaml", """
name: bad-wf
steps:
  - name: build
    action: compile
    disable_policy: true
""")
        with pytest.raises(LoadError, match="forbidden key 'disable_policy'"):
            load_workflow(p)

    def test_policy_gates_override_key_rejected(self, tmp_path):
        """'policy_gates_override' key must raise LoadError."""
        p = _write(tmp_path, "override_key.yaml", """
name: bad-wf
steps:
  - name: build
    action: compile
    policy_gates_override: []
""")
        with pytest.raises(LoadError, match="forbidden key 'policy_gates_override'"):
            load_workflow(p)

    def test_bypass_all_in_json_rejected(self, tmp_path):
        """JSON workflow with bypass_all gate value must raise LoadError."""
        data = {
            "name": "bad-json-wf",
            "steps": [
                {"name": "build", "action": "compile", "policy_gates": ["bypass_all"]}
            ],
        }
        p = _write(tmp_path, "bad.json", json.dumps(data))
        with pytest.raises(LoadError, match="forbidden policy_gates value 'bypass_all'"):
            load_workflow(p)

    def test_error_message_references_requirements(self, tmp_path):
        """LoadError message must reference REQ_NO_POLICY_BYPASS."""
        p = _write(tmp_path, "req_ref.yaml", """
name: bad-wf
policy_gate: bypass_all
steps:
  - name: build
    action: compile
""")
        with pytest.raises(LoadError, match="REQ_NO_POLICY_BYPASS"):
            load_workflow(p)

    def test_valid_workflow_not_rejected(self, tmp_path):
        """A clean workflow with no bypass attempts must load successfully."""
        p = _write(tmp_path, "good.yaml", """
name: good-wf
steps:
  - name: build
    action: compile
  - name: deploy
    action: ship
    depends_on: [build]
    policy_gates: [dev-gate]
""")
        wf = load_workflow(p)
        assert wf.name == "good-wf"
        assert len(wf.steps) == 2


# ---------------------------------------------------------------------------
# REQ_NO_POLICY_BYPASS — engine rejects invalid policy_mode
# ---------------------------------------------------------------------------

class TestEnginePolicyModeValidation:
    """PolicyEngine must reject unknown policy_mode values."""

    def test_invalid_policy_mode_raises(self):
        with pytest.raises(ValueError, match="Invalid policy_mode"):
            PolicyEngine(
                permissions=PermissionModel(role="developer"),
                policy_mode="bypass_all",  # type: ignore[arg-type]
            )

    def test_enforced_mode_is_default(self):
        engine = PolicyEngine(permissions=PermissionModel(role="developer"))
        assert engine.policy_mode == "enforced"

    def test_permissive_mode_accepted(self):
        engine = PolicyEngine(
            permissions=PermissionModel(role="developer"),
            policy_mode="permissive",
        )
        assert engine.policy_mode == "permissive"


# ---------------------------------------------------------------------------
# Operator permissive mode — correct behaviour and audit trail
# ---------------------------------------------------------------------------

class TestOperatorPermissiveMode:
    """Permissive mode must override gates AND always audit every override."""

    def _prod_wf(self) -> WorkflowDefinition:
        return WorkflowDefinition(
            name="prod-wf",
            steps=[
                WorkflowStep(
                    name="release",
                    action="deploy",
                    policy_gates=["prod-gate"],
                    environment="prod",
                )
            ],
        )

    def test_permissive_mode_allows_gated_step(self):
        """In permissive mode a gate-denied step runs as 'success'."""
        plan = build_plan(self._prod_wf())
        engine = _make_engine(role="developer", policy_mode="permissive")
        results = engine.run(plan)
        assert results["release"] == "success"

    def test_permissive_mode_audits_override(self):
        """Every gate override in permissive mode produces a 'gate_overridden' audit entry."""
        plan = build_plan(self._prod_wf())
        engine = _make_engine(role="developer", policy_mode="permissive")
        engine.run(plan)
        events = [e.event for e in engine.audit.entries]
        assert "gate_overridden" in events

    def test_permissive_mode_override_entry_contains_denied_gates(self):
        """The gate_overridden audit entry must name the gates that were overridden."""
        plan = build_plan(self._prod_wf())
        engine = _make_engine(role="developer", policy_mode="permissive")
        engine.run(plan)
        overrides = [e for e in engine.audit.entries if e.event == "gate_overridden"]
        assert len(overrides) == 1
        assert "prod-gate" in overrides[0].detail["denied_gates"]

    def test_permissive_mode_override_entry_says_overridden(self):
        """The gate_overridden audit entry detail must contain the word 'OVERRIDDEN'."""
        plan = build_plan(self._prod_wf())
        engine = _make_engine(role="developer", policy_mode="permissive")
        engine.run(plan)
        overrides = [e for e in engine.audit.entries if e.event == "gate_overridden"]
        assert "OVERRIDDEN" in overrides[0].detail["detail"]

    def test_permissive_mode_run_start_records_mode(self):
        """run_start audit entry must record policy_mode='permissive'."""
        plan = build_plan(self._prod_wf())
        engine = _make_engine(role="developer", policy_mode="permissive")
        engine.run(plan)
        run_start = next(e for e in engine.audit.entries if e.event == "run_start")
        assert run_start.detail["policy_mode"] == "permissive"

    def test_permissive_mode_emits_policy_mode_warning(self):
        """A 'policy_mode_warning' audit entry must be emitted when permissive."""
        plan = build_plan(self._prod_wf())
        engine = _make_engine(role="developer", policy_mode="permissive")
        engine.run(plan)
        events = [e.event for e in engine.audit.entries]
        assert "policy_mode_warning" in events

    def test_enforced_mode_still_denies(self):
        """Enforced mode (default) must still deny the gate."""
        plan = build_plan(self._prod_wf())
        engine = _make_engine(role="developer", policy_mode="enforced")
        results = engine.run(plan)
        assert results["release"] == "gate_denied"

    def test_permissive_mode_does_not_produce_gate_denied(self):
        """In permissive mode there must be no 'gate_denied' audit entries."""
        plan = build_plan(self._prod_wf())
        engine = _make_engine(role="developer", policy_mode="permissive")
        engine.run(plan)
        events = [e.event for e in engine.audit.entries]
        assert "gate_denied" not in events

    def test_permissive_mode_preserves_audit_append_only(self):
        """REQ_AUDIT_APPEND_ONLY: permissive mode must not remove any audit entries."""
        plan = build_plan(self._prod_wf())
        audit = AuditLog()
        audit.append("pre_existing_entry", step=None)
        engine = PolicyEngine(
            permissions=PermissionModel(role="developer"),
            audit=audit,
            policy_mode="permissive",
        )
        engine.run(plan)
        events = [e.event for e in audit.entries]
        # The pre-existing entry must still be there.
        assert "pre_existing_entry" in events
        # And the override was appended, not inserted before it.
        assert events[0] == "pre_existing_entry"

    def test_no_gates_permissive_mode_no_override_entry(self):
        """If a step has no gates, permissive mode must not emit gate_overridden."""
        wf = WorkflowDefinition(
            name="no-gates",
            steps=[WorkflowStep(name="build", action="compile")],
        )
        plan = build_plan(wf)
        engine = _make_engine(role="developer", policy_mode="permissive")
        engine.run(plan)
        events = [e.event for e in engine.audit.entries]
        assert "gate_overridden" not in events


# ---------------------------------------------------------------------------
# REQ_CONFIG_UNTRUSTED — policy_mode cannot come from workflow YAML
# ---------------------------------------------------------------------------

class TestPolicyModeCannotComeFromYAML:
    """Workflow YAML/JSON must not be able to set policy_mode."""

    def test_policy_mode_key_in_yaml_is_ignored_not_honoured(self, tmp_path):
        """A 'policy_mode' key in YAML is not a forbidden key (it's just ignored
        by the loader), but it must NOT influence engine behaviour.

        The engine's policy_mode is set by the operator, not by the workflow file.
        This test loads a YAML that contains 'policy_mode: permissive', then
        verifies that the engine still runs in enforced mode (gate is denied).
        """
        p = _write(tmp_path, "sneaky.yaml", """
name: sneaky-wf
policy_mode: permissive
steps:
  - name: release
    action: deploy
    policy_gates: [prod-gate]
    environment: prod
""")
        # The loader does not read policy_mode — it is silently ignored.
        wf = load_workflow(p)
        plan = build_plan(wf)
        # Engine is constructed WITHOUT permissive mode — default is enforced.
        engine = PolicyEngine(
            permissions=PermissionModel(role="developer"),
            audit=AuditLog(),
            # policy_mode NOT passed → defaults to "enforced"
        )
        results = engine.run(plan)
        # Gate must be denied — the YAML's policy_mode field had no effect.
        assert results["release"] == "gate_denied"

    def test_workflow_definition_has_no_policy_mode_attribute(self, tmp_path):
        """WorkflowDefinition must not expose a policy_mode field."""
        p = _write(tmp_path, "no_attr.yaml", """
name: attr-test
steps:
  - name: build
    action: compile
""")
        wf = load_workflow(p)
        assert not hasattr(wf, "policy_mode"), (
            "WorkflowDefinition must not have a policy_mode attribute — "
            "policy_mode is operator-controlled, not workflow-controlled."
        )