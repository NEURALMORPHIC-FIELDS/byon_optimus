"""
Security regression tests: ensure that untrusted workflow YAML/JSON CANNOT
bypass policy gates.

[invariant_no_policy_bypass]

These tests document and enforce the correct REJECTION of adversarial input.
They must NEVER be changed to make bypass_all pass validation — if they ever
fail it means a security regression has been introduced.
"""
from __future__ import annotations

import json
import textwrap
from pathlib import Path

import pytest

from policy_engine.audit import AuditLog
from policy_engine.engine import WorkflowEngine
from policy_engine.loader import WorkflowValidationError, _RESERVED_GATE_NAMES, load_workflow
from policy_engine.models import PolicyGate, Step, Workflow
from policy_engine.permissions import PermissionModel
from policy_engine.policy_mode import PolicyMode, resolve_policy_mode


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _yaml_file(tmp_path: Path, content: str, name: str = "wf.yaml") -> Path:
    p = tmp_path / name
    p.write_text(textwrap.dedent(content), encoding="utf-8")
    return p


def _json_file(tmp_path: Path, data: dict, name: str = "wf.json") -> Path:
    p = tmp_path / name
    p.write_text(json.dumps(data), encoding="utf-8")
    return p


# ---------------------------------------------------------------------------
# 1. bypass_all as a gate DEFINITION name is rejected at load time
# ---------------------------------------------------------------------------

class TestBypassAllGateNameRejected:
    def test_bypass_all_gate_definition_yaml(self, tmp_path):
        p = _yaml_file(tmp_path, """
            name: evil-workflow
            gates:
              bypass_all:
                required_role: anyone
            steps:
              - id: deploy
                name: Deploy
                action: deploy.run
                policy_gates: [bypass_all]
        """)
        with pytest.raises(WorkflowValidationError, match="reserved name"):
            load_workflow(p)

    def test_bypass_all_gate_definition_json(self, tmp_path):
        p = _json_file(tmp_path, {
            "name": "evil-json",
            "gates": {
                "bypass_all": {"required_role": "anyone"},
            },
            "steps": [{"id": "s", "name": "S", "action": "s.run", "policy_gates": ["bypass_all"]}],
        })
        with pytest.raises(WorkflowValidationError, match="reserved name"):
            load_workflow(p)

    def test_bypass_all_case_insensitive_rejected(self, tmp_path):
        """Capitalisation variants must all be caught."""
        for variant in ("Bypass_All", "BYPASS_ALL", "Bypass_all"):
            p = _yaml_file(tmp_path, f"""
                name: evil
                gates:
                  {variant}:
                    required_role: x
                steps:
                  - id: s
                    name: S
                    action: s.run
            """, name=f"wf_{variant}.yaml")
            with pytest.raises(WorkflowValidationError, match="reserved name"):
                load_workflow(p)

    def test_bypass_gate_name_rejected(self, tmp_path):
        p = _yaml_file(tmp_path, """
            name: evil
            gates:
              bypass:
                required_role: anyone
            steps:
              - id: s
                name: S
                action: s.run
        """)
        with pytest.raises(WorkflowValidationError, match="reserved name"):
            load_workflow(p)


# ---------------------------------------------------------------------------
# 2. bypass_all as a step-level policy_gates REFERENCE is rejected
# ---------------------------------------------------------------------------

class TestBypassAllStepReferenceRejected:
    def test_bypass_all_in_policy_gates_list(self, tmp_path):
        """
        Even if the gate is not defined in the gates section, referencing
        'bypass_all' by name in a step's policy_gates must be rejected.
        """
        p = _yaml_file(tmp_path, """
            name: evil2
            gates: {}
            steps:
              - id: deploy
                name: Deploy
                action: deploy.run
                policy_gates: [bypass_all]
        """)
        with pytest.raises(WorkflowValidationError, match="reserved name"):
            load_workflow(p)

    def test_all_reserved_names_rejected_in_step(self, tmp_path):
        """Every name in _RESERVED_GATE_NAMES is rejected at step level."""
        for name in _RESERVED_GATE_NAMES:
            p = _yaml_file(tmp_path, f"""
                name: evil
                gates: {{}}
                steps:
                  - id: s
                    name: S
                    action: s.run
                    policy_gates: [{name}]
            """, name=f"wf_{name}.yaml")
            with pytest.raises(WorkflowValidationError, match="reserved name"):
                load_workflow(p)


# ---------------------------------------------------------------------------
# 3. All reserved names are rejected as gate definitions
# ---------------------------------------------------------------------------

class TestAllReservedNamesRejected:
    def test_all_reserved_names_rejected_in_gate_definition(self, tmp_path):
        for reserved in _RESERVED_GATE_NAMES:
            p = _yaml_file(tmp_path, f"""
                name: evil
                gates:
                  {reserved}:
                    required_role: anyone
                steps:
                  - id: s
                    name: S
                    action: s.run
            """, name=f"wf_{reserved}.yaml")
            with pytest.raises(WorkflowValidationError, match="reserved name"):
                load_workflow(p)


# ---------------------------------------------------------------------------
# 4. Legitimate gate names are NOT rejected (sanity check)
# ---------------------------------------------------------------------------

class TestLegitimateGatesAccepted:
    def test_normal_gate_names_pass(self, tmp_path):
        p = _yaml_file(tmp_path, """
            name: legit
            gates:
              dev_gate:
                required_role: developer
              qa_gate:
                required_role: qa
            steps:
              - id: build
                name: Build
                action: build.run
                policy_gates: [dev_gate]
        """)
        wf = load_workflow(p)
        assert "dev_gate" in wf.gates
        assert "qa_gate" in wf.gates


# ---------------------------------------------------------------------------
# 5. policy_mode cannot be set from YAML (no such field in schema)
# ---------------------------------------------------------------------------

class TestPolicyModeCannotComeFromYAML:
    def test_policy_mode_field_in_yaml_is_ignored_not_honoured(self, tmp_path):
        """
        A workflow YAML containing 'policy_mode: permissive' must not cause
        the engine to run in permissive mode.  The field is unknown and ignored
        at parse time; the engine always defaults to ENFORCING.
        """
        p = _yaml_file(tmp_path, """
            name: sneaky
            policy_mode: permissive
            gates:
              secure_gate:
                required_role: admin
            steps:
              - id: deploy
                name: Deploy
                action: deploy.run
                policy_gates: [secure_gate]
        """)
        # Workflow loads fine (unknown top-level fields are ignored by our parser)
        wf = load_workflow(p)
        audit = AuditLog()
        # Run WITHOUT passing any roles — in enforcing mode this must FAIL
        engine = WorkflowEngine(
            wf,
            audit,
            PermissionModel(role_gates={"admin": {"secure_gate"}}),
            actor_roles=[],  # no roles
            policy_mode=PolicyMode.ENFORCING,  # default — YAML field does not matter
        )
        result = engine.run()
        assert result is False, (
            "Engine must deny the step; 'policy_mode: permissive' in YAML "
            "must have NO effect on policy enforcement."
        )
        # Confirm deny was recorded
        events = [e.event for e in audit.entries()]
        assert "gate_check" in events
        deny_entries = [e for e in audit.entries() if "DENY" in e.detail]
        assert deny_entries, "Gate denial must be audited"

    def test_resolve_policy_mode_ignores_workflow_content(self):
        """resolve_policy_mode() only reads its explicit arg or env var."""
        mode = resolve_policy_mode(explicit=None)
        assert mode == PolicyMode.ENFORCING

    def test_resolve_policy_mode_permissive_via_explicit(self):
        mode = resolve_policy_mode(explicit="permissive")
        assert mode == PolicyMode.PERMISSIVE

    def test_resolve_policy_mode_permissive_via_env(self, monkeypatch):
        monkeypatch.setenv("WORKFLOW_POLICY_MODE", "permissive")
        mode = resolve_policy_mode(explicit=None)
        assert mode == PolicyMode.PERMISSIVE

    def test_resolve_policy_mode_enforcing_by_default_even_with_env_unset(self, monkeypatch):
        monkeypatch.delenv("WORKFLOW_POLICY_MODE", raising=False)
        mode = resolve_policy_mode(explicit=None)
        assert mode == PolicyMode.ENFORCING


# ---------------------------------------------------------------------------
# 6. Permissive mode — safe operator alternative — is audited, never silent
# ---------------------------------------------------------------------------

class TestPermissiveModeIsAuditedNotSilent:
    """
    The SAFE alternative for fast testing is permissive mode, which:
      - must be set by the operator (test fixture / CLI flag / env var)
      - must audit every override as 'gate_overridden'
      - must never silently elide policy decisions
    """

    def test_permissive_mode_gate_override_is_audited(self, simple_two_step_workflow):
        audit = AuditLog()
        engine = WorkflowEngine(
            simple_two_step_workflow,
            audit,
            PermissionModel(),  # developer role not granted
            actor_roles=[],  # no roles at all
            policy_mode=PolicyMode.PERMISSIVE,
        )
        result = engine.run()
        assert result is True  # permissive → steps run

        events = [e.event for e in audit.entries()]
        # override must be recorded
        assert "gate_overridden" in events, "Permissive mode must audit every gate override"
        # mode activation must be recorded
        assert "policy_mode_override" in events

        override_entries = [e for e in audit.entries() if e.event == "gate_overridden"]
        for entry in override_entries:
            assert "OVERRIDDEN" in entry.detail
            assert entry.actor == "operator"

    def test_permissive_mode_records_mode_activation(self, simple_two_step_workflow):
        audit = AuditLog()
        engine = WorkflowEngine(
            simple_two_step_workflow,
            audit,
            PermissionModel(),
            actor_roles=[],
            policy_mode=PolicyMode.PERMISSIVE,
        )
        engine.run()
        mode_entries = [e for e in audit.entries() if e.event == "policy_mode_override"]
        assert mode_entries, "Permissive mode activation must be audited"
        assert "PERMISSIVE" in mode_entries[0].detail

    def test_enforcing_mode_records_enforcing_activation(self, simple_two_step_workflow):
        audit = AuditLog()
        engine = WorkflowEngine(
            simple_two_step_workflow,
            audit,
            PermissionModel(role_gates={"developer": {"dev_gate"}}),
            actor_roles=["developer"],
            policy_mode=PolicyMode.ENFORCING,
        )
        engine.run()
        mode_entries = [e for e in audit.entries() if e.event == "policy_mode"]
        assert mode_entries
        assert "ENFORCING" in mode_entries[0].detail

    def test_permissive_mode_cannot_be_set_from_workflow_yaml(self, tmp_path):
        """
        Constructing an engine with ENFORCING mode while the YAML claims permissive
        must result in enforcing behaviour.  Belt-and-suspenders: engine policy_mode
        is fully independent of workflow file content.
        """
        p = Path(tmp_path) / "wf.yaml"
        p.write_text(textwrap.dedent("""
            name: bypass-attempt
            policy_mode: permissive
            gates:
              locked_gate:
                required_role: superadmin
            steps:
              - id: evil_deploy
                name: Evil Deploy
                action: deploy.prod
                policy_gates: [locked_gate]
        """), encoding="utf-8")
        wf = load_workflow(p)
        audit = AuditLog()
        engine = WorkflowEngine(
            wf,
            audit,
            PermissionModel(role_gates={"superadmin": {"locked_gate"}}),
            actor_roles=["developer"],          # not superadmin
            policy_mode=PolicyMode.ENFORCING,   # engine decides, not YAML
        )
        result = engine.run()
        assert result is False
        assert wf.steps[0].status.value == "failed"

    def test_no_silent_elision_in_permissive_mode(self, simple_two_step_workflow):
        """
        Every gate check in permissive mode must produce an audit entry.
        There must be no step that has gates but produced zero gate audit events.
        """
        audit = AuditLog()
        engine = WorkflowEngine(
            simple_two_step_workflow,
            audit,
            PermissionModel(),
            actor_roles=[],
            policy_mode=PolicyMode.PERMISSIVE,
        )
        engine.run()

        gate_events = {e.step_id for e in audit.entries()
                       if e.event in ("gate_check", "gate_overridden", "gate_error")}
        gated_steps = {s.id for s in simple_two_step_workflow.steps if s.policy_gates}
        assert gated_steps.issubset(gate_events), (
            "Every gated step must have at least one gate audit entry"
        )


# ---------------------------------------------------------------------------
# 7. Conftest permissive_engine_factory fixture works correctly
# ---------------------------------------------------------------------------

class TestPermissiveEngineFixture:
    def test_fixture_creates_permissive_engine(self, permissive_engine_factory, simple_two_step_workflow, audit):
        engine = permissive_engine_factory(simple_two_step_workflow, roles=[])
        assert engine.policy_mode == PolicyMode.PERMISSIVE

    def test_fixture_engine_audits_overrides(self, permissive_engine_factory, simple_two_step_workflow, audit):
        engine = permissive_engine_factory(simple_two_step_workflow, roles=[])
        engine.run()
        override_events = [e for e in audit.entries() if e.event == "gate_overridden"]
        assert override_events, "Fixture engine must audit gate overrides"

    def test_fixture_engine_audit_is_not_empty(self, permissive_engine_factory, simple_two_step_workflow, audit):
        engine = permissive_engine_factory(simple_two_step_workflow)
        engine.run()
        assert len(audit) > 0