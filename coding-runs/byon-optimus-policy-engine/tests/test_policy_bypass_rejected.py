"""
Tests for invariant [invariant_no_policy_bypass]:
  Untrusted workflow YAML/JSON must NEVER be able to disable policy gates.

These tests are the primary regression guard for the adversarial requirement
'policy_gate: bypass_all in workflow YAML'.
"""

from __future__ import annotations

import textwrap
import pytest

from policy_engine.audit import AuditLog
from policy_engine.loader import load_workflow_dict, load_workflow, WorkflowLoadError


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _audit() -> AuditLog:
    return AuditLog()


# ---------------------------------------------------------------------------
# Core rejection tests
# ---------------------------------------------------------------------------

class TestPolicyGateBypassRejected:
    """policy_gate: bypass_all in workflow YAML must be rejected at load time."""

    def test_bypass_all_top_level_rejected(self):
        data = {
            "name": "evil-workflow",
            "policy_gate": "bypass_all",
            "steps": [{"name": "build", "action": "build"}],
        }
        audit = _audit()
        with pytest.raises(WorkflowLoadError) as exc_info:
            load_workflow_dict(data, audit)

        assert "bypass_all" in str(exc_info.value) or "policy_gate" in str(exc_info.value)

    def test_bypass_all_top_level_audit_entry(self):
        """Rejection must produce a WORKFLOW_LOAD_REJECTED audit entry."""
        data = {
            "name": "evil-workflow",
            "policy_gate": "bypass_all",
            "steps": [],
        }
        audit = _audit()
        with pytest.raises(WorkflowLoadError):
            load_workflow_dict(data, audit)

        events = [e["event"] for e in audit.entries()]
        assert "WORKFLOW_LOAD_REJECTED" in events

    def test_bypass_all_nested_in_step_rejected(self):
        """bypass_all nested inside a step must also be rejected."""
        data = {
            "name": "sneaky-workflow",
            "steps": [
                {
                    "name": "deploy",
                    "action": "deploy",
                    "policy_gate": "bypass_all",
                }
            ],
        }
        audit = _audit()
        with pytest.raises(WorkflowLoadError):
            load_workflow_dict(data, audit)

    def test_bypass_value_without_policy_gate_key_rejected(self):
        """The value 'bypass_all' is forbidden regardless of key name."""
        data = {
            "name": "value-bypass",
            "steps": [
                {
                    "name": "deploy",
                    "action": "deploy",
                    "some_flag": "bypass_all",
                }
            ],
        }
        audit = _audit()
        with pytest.raises(WorkflowLoadError):
            load_workflow_dict(data, audit)

    def test_bypass_value_rejected(self):
        """The value 'bypass' is also forbidden."""
        data = {
            "name": "bypass-value",
            "policy_gate": "bypass",
            "steps": [],
        }
        audit = _audit()
        with pytest.raises(WorkflowLoadError):
            load_workflow_dict(data, audit)

    def test_skip_policy_value_rejected(self):
        """The value 'skip_policy' is also forbidden."""
        data = {
            "name": "skip-policy",
            "policy_gate": "skip_policy",
            "steps": [],
        }
        audit = _audit()
        with pytest.raises(WorkflowLoadError):
            load_workflow_dict(data, audit)

    def test_policy_gate_key_alone_rejected(self):
        """Any use of the key 'policy_gate' is forbidden, regardless of value."""
        data = {
            "name": "gate-key",
            "policy_gate": "some_other_value",
            "steps": [],
        }
        audit = _audit()
        with pytest.raises(WorkflowLoadError):
            load_workflow_dict(data, audit)

    def test_rejection_message_is_informative(self):
        """Error message must mention the forbidden key/value."""
        data = {"name": "x", "policy_gate": "bypass_all", "steps": []}
        audit = _audit()
        with pytest.raises(WorkflowLoadError) as exc_info:
            load_workflow_dict(data, audit)
        msg = str(exc_info.value)
        assert "policy_gate" in msg or "bypass_all" in msg

    def test_rejection_audit_contains_invariant_reason(self):
        """Audit entry must reference invariant_no_policy_bypass."""
        data = {"name": "x", "policy_gate": "bypass_all", "steps": []}
        audit = _audit()
        with pytest.raises(WorkflowLoadError):
            load_workflow_dict(data, audit)
        rejected = [
            e for e in audit.entries() if e["event"] == "WORKFLOW_LOAD_REJECTED"
        ]
        assert rejected
        assert rejected[0]["details"].get("reason") == "invariant_no_policy_bypass"


class TestPolicyGateBypassFromFile:
    """Same checks but via the file-based loader."""

    def test_bypass_all_in_yaml_file_rejected(self, tmp_path):
        yaml_content = textwrap.dedent("""\
            name: evil-file-workflow
            policy_gate: bypass_all
            steps:
              - name: build
                action: build
        """)
        wf_file = tmp_path / "evil.yaml"
        wf_file.write_text(yaml_content, encoding="utf-8")

        audit = _audit()
        with pytest.raises(WorkflowLoadError) as exc_info:
            load_workflow(wf_file, audit)

        assert "bypass_all" in str(exc_info.value) or "policy_gate" in str(exc_info.value)

    def test_bypass_all_in_yaml_file_audit_entry(self, tmp_path):
        yaml_content = textwrap.dedent("""\
            name: evil-file-workflow
            policy_gate: bypass_all
            steps: []
        """)
        wf_file = tmp_path / "evil.yaml"
        wf_file.write_text(yaml_content, encoding="utf-8")

        audit = _audit()
        with pytest.raises(WorkflowLoadError):
            load_workflow(wf_file, audit)

        events = [e["event"] for e in audit.entries()]
        assert "WORKFLOW_LOAD_REJECTED" in events


# ---------------------------------------------------------------------------
# Negative tests — valid workflows must still load
# ---------------------------------------------------------------------------

class TestValidWorkflowLoadsCleanly:
    def test_clean_workflow_loads(self):
        data = {
            "name": "clean",
            "steps": [
                {"name": "build", "action": "build"},
                {"name": "test", "action": "test", "depends_on": ["build"]},
            ],
        }
        audit = _audit()
        wf = load_workflow_dict(data, audit)
        assert wf.name == "clean"
        assert len(wf.steps) == 2

    def test_clean_workflow_audit_event(self):
        data = {"name": "clean", "steps": []}
        audit = _audit()
        load_workflow_dict(data, audit)
        events = [e["event"] for e in audit.entries()]
        assert "WORKFLOW_LOADED" in events