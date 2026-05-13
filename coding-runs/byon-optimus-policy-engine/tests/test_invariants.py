"""
test_invariants.py — Cross-cutting invariant regression tests.

These tests assert the seven project invariants hold regardless of
other implementation changes. They are mandatory CI gates.
"""

from __future__ import annotations

import pytest

from policy_engine.loader import load_workflow_from_string, ValidationError
from policy_engine.audit import AuditLog
from policy_engine.models import WorkflowDefinition, Step


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _simple_workflow_yaml(extra_step_key: str = "") -> str:
    extra = f"\n    {extra_step_key}" if extra_step_key else ""
    return f"""
name: test_wf
steps:
  - name: build
    handler: build_handler{extra}
  - name: deploy
    handler: deploy_handler
    depends_on: [build]
"""


# ---------------------------------------------------------------------------
# invariant_no_policy_bypass
# ---------------------------------------------------------------------------

class TestNoPolicyBypass:
    """policy_gate or any bypass key in workflow YAML must be rejected."""

    def test_policy_gate_bypass_all_rejected(self):
        """
        Core regression: `policy_gate: bypass_all` in a workflow step
        must raise ValidationError. The engine must never execute any step
        from such a workflow.
        """
        yaml_text = """
name: malicious_wf
steps:
  - name: build
    handler: build_handler
    policy_gate: bypass_all
"""
        with pytest.raises(ValidationError) as exc_info:
            load_workflow_from_string(yaml_text)
        assert "policy_gate" in str(exc_info.value)

    def test_policy_gate_at_root_rejected(self):
        yaml_text = """
name: malicious_wf
policy_gate: bypass_all
steps:
  - name: build
    handler: build_handler
"""
        with pytest.raises(ValidationError) as exc_info:
            load_workflow_from_string(yaml_text)
        assert "policy_gate" in str(exc_info.value)

    def test_arbitrary_unknown_step_key_rejected(self):
        yaml_text = """
name: wf
steps:
  - name: build
    handler: build_handler
    __proto__: injected
"""
        with pytest.raises(ValidationError):
            load_workflow_from_string(yaml_text)

    def test_arbitrary_unknown_root_key_rejected(self):
        yaml_text = """
name: wf
disable_security: true
steps:
  - name: build
    handler: build_handler
"""
        with pytest.raises(ValidationError):
            load_workflow_from_string(yaml_text)

    def test_valid_workflow_not_rejected(self):
        """Sanity: a clean workflow must load without error."""
        wf = load_workflow_from_string(_simple_workflow_yaml())
        assert wf.name == "test_wf"
        assert len(wf.steps) == 2


# ---------------------------------------------------------------------------
# invariant_audit_append_only
# ---------------------------------------------------------------------------

class TestAuditAppendOnly:
    """AuditLog must not expose any delete/update/clear operation."""

    def test_no_delete_method(self):
        log = AuditLog()
        assert not hasattr(log, "delete"), "AuditLog must not have a delete method"

    def test_no_clear_method(self):
        log = AuditLog()
        assert not hasattr(log, "clear"), "AuditLog must not have a clear method"

    def test_no_update_method(self):
        log = AuditLog()
        assert not hasattr(log, "update"), "AuditLog must not have an update method"

    def test_entries_are_immutable_sequence(self):
        """entries property must return a tuple or other immutable sequence."""
        from policy_engine.audit import AuditEntry
        import datetime
        log = AuditLog()
        entry = AuditEntry(
            step="build",
            status="COMPLETED",
            timestamp=datetime.datetime.utcnow(),
        )
        log.append(entry)
        entries = log.entries
        # Must not be a plain mutable list that callers can mutate
        with pytest.raises((TypeError, AttributeError)):
            entries[0] = None  # type: ignore[index]

    def test_append_only_grows(self):
        from policy_engine.audit import AuditEntry
        import datetime
        log = AuditLog()
        e1 = AuditEntry(step="a", status="COMPLETED", timestamp=datetime.datetime.utcnow())
        e2 = AuditEntry(step="b", status="COMPLETED", timestamp=datetime.datetime.utcnow())
        log.append(e1)
        assert len(log.entries) == 1
        log.append(e2)
        assert len(log.entries) == 2
        assert log.entries[0].step == "a"
        assert log.entries[1].step == "b"


# ---------------------------------------------------------------------------
# invariant_config_is_untrusted
# ---------------------------------------------------------------------------

class TestConfigIsUntrusted:
    """Loader must reject malformed, oversized, or structurally invalid input."""

    def test_empty_steps_rejected(self):
        yaml_text = "name: wf\nsteps: []\n"
        with pytest.raises(ValidationError):
            load_workflow_from_string(yaml_text)

    def test_missing_name_rejected(self):
        yaml_text = "steps:\n  - name: build\n    handler: h\n"
        with pytest.raises(ValidationError):
            load_workflow_from_string(yaml_text)

    def test_step_name_with_special_chars_rejected(self):
        yaml_text = """
name: wf
steps:
  - name: "../../etc/passwd"
    handler: h
"""
        with pytest.raises(ValidationError):
            load_workflow_from_string(yaml_text)

    def test_depends_on_unknown_step_rejected(self):
        yaml_text = """
name: wf
steps:
  - name: deploy
    handler: h
    depends_on: [nonexistent]
"""
        with pytest.raises(ValidationError):
            load_workflow_from_string(yaml_text)

    def test_self_loop_rejected(self):
        yaml_text = """
name: wf
steps:
  - name: build
    handler: h
    depends_on: [build]
"""
        with pytest.raises(ValidationError):
            load_workflow_from_string(yaml_text)

    def test_non_mapping_root_rejected(self):
        with pytest.raises(ValidationError):
            load_workflow_from_string("- item1\n- item2\n")

    def test_json_format_accepted(self):
        json_text = '{"name": "wf", "steps": [{"name": "build", "handler": "h"}]}'
        wf = load_workflow_from_string(json_text, fmt="json")
        assert wf.name == "wf"

    def test_unknown_format_rejected(self):
        with pytest.raises(ValidationError):
            load_workflow_from_string("name: wf", fmt="toml")


# ---------------------------------------------------------------------------
# invariant_failed_step_blocks_dependents
# (structural: loader ensures depends_on references are valid;
#  execution-level blocking is tested in test_executor.py)
# ---------------------------------------------------------------------------

class TestFailedStepBlocksDependents:
    """Loader-level: dependency graph must be internally consistent."""

    def test_transitive_dependency_names_are_valid(self):
        yaml_text = """
name: wf
steps:
  - name: a
    handler: h
  - name: b
    handler: h
    depends_on: [a]
  - name: c
    handler: h
    depends_on: [b]
"""
        wf = load_workflow_from_string(yaml_text)
        step_names = {s.name for s in wf.steps}
        for step in wf.steps:
            for dep in step.depends_on:
                assert dep in step_names


# ---------------------------------------------------------------------------
# invariant_production_requires_grant
# ---------------------------------------------------------------------------

class TestProductionRequiresGrant:
    """
    Production approval must come from PolicyEngine configuration,
    not from workflow YAML.
    """

    def test_workflow_cannot_grant_production_approval(self):
        """
        A workflow YAML must not be able to set any key that grants
        production approval. Any such key is an unknown key and must
        be rejected.
        """
        yaml_text = """
name: wf
steps:
  - name: deploy_production
    handler: deploy_handler
    production_approved: true
"""
        with pytest.raises(ValidationError) as exc_info:
            load_workflow_from_string(yaml_text)
        assert "production_approved" in str(exc_info.value)

    def test_workflow_cannot_set_approved_flag_at_root(self):
        yaml_text = """
name: wf
approved: true
steps:
  - name: deploy
    handler: h
"""
        with pytest.raises(ValidationError):
            load_workflow_from_string(yaml_text)