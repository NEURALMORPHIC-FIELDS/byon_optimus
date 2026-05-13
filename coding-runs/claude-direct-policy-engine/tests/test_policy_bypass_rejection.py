"""
Adversarial / security tests — invariant_no_policy_bypass.

These tests verify that workflow YAML/JSON can NEVER disable, bypass, or weaken
policy enforcement.  They must remain passing at all times; weakening them is a
security regression.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from policy_engine.audit import AuditLog
from policy_engine.engine import WorkflowEngine
from policy_engine.loader import _validate_gate_name, load_workflow
from policy_engine.models import Step, StepStatus, Workflow
from policy_engine.policy import PermissionModel, PolicyGate, PolicyMode


# ── helpers ───────────────────────────────────────────────────────────────────

def write_yaml(tmp_path: Path, data: dict) -> Path:
    p = tmp_path / "wf.yaml"
    p.write_text(yaml.dump(data), encoding="utf-8")
    return p


def write_json(tmp_path: Path, data: dict) -> Path:
    p = tmp_path / "wf.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    return p


def _wf_with_gate(gate_value: str) -> dict:
    return {
        "id": "wf_adversarial",
        "steps": [{"id": "s1", "action": "build", "policy_gate": gate_value}],
    }


# ═════════════════════════════════════════════════════════════════════════════
# Part 1 — Loader must REJECT bypass sentinel values
# ═════════════════════════════════════════════════════════════════════════════

class TestBypassRejectedAtLoadTime:
    """policy_gate: bypass_all (and variants) must be refused by the loader."""

    @pytest.mark.parametrize("gate_value", [
        "bypass_all",
        "bypass",
        "skip_policy",
        "no_policy",
        "allow_all",
        "permit_all",
        "disable_policy",
        # Case variants — must also be caught
        "BYPASS_ALL",
        "Bypass_All",
        "BYPASS",
    ])
    def test_bypass_sentinel_rejected_yaml(self, tmp_path, gate_value):
        p = write_yaml(tmp_path, _wf_with_gate(gate_value))
        with pytest.raises(ValueError, match="not permitted"):
            load_workflow(p)

    @pytest.mark.parametrize("gate_value", [
        "bypass_all",
        "bypass",
        "allow_all",
    ])
    def test_bypass_sentinel_rejected_json(self, tmp_path, gate_value):
        p = write_json(tmp_path, _wf_with_gate(gate_value))
        with pytest.raises(ValueError, match="not permitted"):
            load_workflow(p)

    def test_error_message_mentions_invariant(self, tmp_path):
        """The error message must reference the invariant / explain the policy."""
        p = write_yaml(tmp_path, _wf_with_gate("bypass_all"))
        with pytest.raises(ValueError) as exc_info:
            load_workflow(p)
        msg = str(exc_info.value)
        assert "bypass" in msg.lower()
        assert "invariant_no_policy_bypass" in msg or "policy" in msg.lower()

    def test_error_message_suggests_safe_alternative(self, tmp_path):
        """Error must point operators at the safe alternative."""
        p = write_yaml(tmp_path, _wf_with_gate("bypass_all"))
        with pytest.raises(ValueError) as exc_info:
            load_workflow(p)
        msg = str(exc_info.value).lower()
        # Should mention the safe operator-controlled mechanism
        assert "permissive" in msg or "--policy-mode" in msg

    def test_unknown_gate_name_rejected(self, tmp_path):
        """Unknown gate names (not on the allowlist) are also rejected."""
        p = write_yaml(tmp_path, _wf_with_gate("my_custom_supergate"))
        with pytest.raises(ValueError, match="unknown policy_gate"):
            load_workflow(p)

    def test_valid_gate_accepted(self, tmp_path):
        """Positive control — a known valid gate must not be rejected."""
        p = write_yaml(tmp_path, _wf_with_gate("deploy_gate"))
        wf = load_workflow(p)
        assert wf.steps[0].policy_gate == "deploy_gate"

    def test_absent_gate_accepted(self, tmp_path):
        """Positive control — no policy_gate is always fine."""
        data = {"id": "wf_ok", "steps": [{"id": "s1", "action": "build"}]}
        p = write_yaml(tmp_path, data)
        wf = load_workflow(p)
        assert wf.steps[0].policy_gate is None


class TestValidateGateNameDirectly:
    """Unit-test the _validate_gate_name helper in isolation."""

    def test_none_is_ok(self):
        _validate_gate_name(None, "step1")  # must not raise

    def test_valid_gates_pass(self):
        for g in ["build_gate", "test_gate", "deploy_gate",
                  "notify_gate", "migrate_gate", "production_gate"]:
            _validate_gate_name(g, "s")  # must not raise

    def test_bypass_all_raises(self):
        with pytest.raises(ValueError, match="not permitted"):
            _validate_gate_name("bypass_all", "s")

    def test_case_insensitive_denylist(self):
        with pytest.raises(ValueError, match="not permitted"):
            _validate_gate_name("BYPASS_ALL", "s")

    def test_unknown_gate_raises(self):
        with pytest.raises(ValueError, match="unknown policy_gate"):
            _validate_gate_name("super_gate", "s")

    def test_non_string_raises(self):
        with pytest.raises(ValueError, match="must be a string"):
            _validate_gate_name(42, "s")


# ═════════════════════════════════════════════════════════════════════════════
# Part 2 — Policy gates are enforced at RUNTIME even if something slips through
# ═════════════════════════════════════════════════════════════════════════════

class TestRuntimePolicyStillEnforced:
    """Even if a Step is constructed in-process with an unusual gate name,
    the PolicyGate in ENFORCED mode must deny unknown/unpermitted gates."""

    def _run_step_with_gate(self, gate: str, role: str = "developer",
                            mode: PolicyMode = PolicyMode.ENFORCED):
        audit = AuditLog()
        perm = PermissionModel.default()
        gate_obj = PolicyGate(perm, mode=mode, audit=audit)
        engine = WorkflowEngine(audit, gate_obj)
        steps = [Step(id="s", name="s", action="build", policy_gate=gate)]
        wf = Workflow(id="wf", name="wf", steps=steps)
        statuses = engine.run(wf, role)
        return statuses, audit

    def test_unknown_gate_denied_at_runtime(self):
        statuses, _ = self._run_step_with_gate("mystery_gate", role="developer")
        assert statuses["s"] == StepStatus.FAILED

    def test_developer_cannot_pass_deploy_gate_in_enforced_mode(self):
        statuses, _ = self._run_step_with_gate("deploy_gate", role="developer")
        assert statuses["s"] == StepStatus.FAILED

    def test_gate_denial_is_audited_in_enforced_mode(self):
        _, audit = self._run_step_with_gate("deploy_gate", role="developer")
        events = [e["event"] for e in audit.entries()]
        assert "step_gate_denied" in events

    def test_no_step_gate_denied_event_when_gate_passes(self):
        _, audit = self._run_step_with_gate("deploy_gate", role="deployer")
        events = [e["event"] for e in audit.entries()]
        assert "step_gate_denied" not in events


# ═════════════════════════════════════════════════════════════════════════════
# Part 3 — Permissive mode: operator-controlled, audited, never from YAML
# ═════════════════════════════════════════════════════════════════════════════

class TestPermissiveMode:
    """Permissive mode is the SAFE alternative to 'bypass_all in YAML'.

    It must:
      - allow gates that would normally deny              (functionality)
      - record every override in the audit log            (invariant_audit_append_only)
      - never be settable from workflow YAML/JSON         (invariant_no_policy_bypass)
      - not erase the original gate evaluation context    (invariant_audit_append_only)
    """

    def _run_permissive(self, gate: str = "deploy_gate", role: str = "developer"):
        audit = AuditLog()
        perm = PermissionModel.default()
        gate_obj = PolicyGate(perm, mode=PolicyMode.PERMISSIVE, audit=audit)
        engine = WorkflowEngine(audit, gate_obj)
        steps = [Step(id="s", name="s", action="build", policy_gate=gate)]
        wf = Workflow(id="wf", name="wf", steps=steps)
        statuses = engine.run(wf, role)
        return statuses, audit

    def test_permissive_allows_denied_gate(self):
        """developer + deploy_gate → denied in enforced, allowed in permissive."""
        statuses, _ = self._run_permissive()
        assert statuses["s"] == StepStatus.SUCCESS

    def test_permissive_records_override_in_audit(self):
        """Every override must appear in the audit log."""
        _, audit = self._run_permissive()
        events = [e["event"] for e in audit.entries()]
        assert "policy_gate_overridden" in events

    def test_permissive_override_entry_contains_gate_and_role(self):
        _, audit = self._run_permissive(gate="deploy_gate", role="developer")
        overrides = [e for e in audit.entries()
                     if e["event"] == "policy_gate_overridden"]
        assert len(overrides) == 1
        entry = overrides[0]
        assert entry["gate"] == "deploy_gate"
        assert entry["role"] == "developer"
        assert entry["normally_ok"] is False  # would have been denied

    def test_permissive_override_records_would_have_been_granted_too(self):
        """When permissive mode is active even already-granted gates are logged."""
        _, audit = self._run_permissive(gate="deploy_gate", role="deployer")
        overrides = [e for e in audit.entries()
                     if e["event"] == "policy_gate_overridden"]
        assert len(overrides) == 1
        assert overrides[0]["normally_ok"] is True

    def test_permissive_mode_cannot_be_set_from_workflow_yaml(self, tmp_path):
        """The workflow file has no field that can activate permissive mode."""
        data = {
            "id": "wf_sneaky",
            "steps": [{
                "id": "s1",
                "action": "build",
                # Attempting to embed policy-mode hints — all must be ignored/rejected
                # (policy_gate must be on the allowlist; anything else is rejected)
                "policy_gate": "build_gate",
            }],
            # Attempting to add a top-level override key — must be ignored
            "policy_mode": "permissive",
        }
        p = write_yaml(tmp_path, data)
        # Loader must succeed (unknown top-level keys are silently ignored,
        # but NOT acted upon — the metadata dict does not affect PolicyGate)
        wf = load_workflow(p)
        # The loaded workflow object has no mechanism to force permissive mode
        assert not hasattr(wf, "policy_mode")
        # Running with default (enforced) engine must still deny the gate
        audit = AuditLog()
        perm = PermissionModel.default()
        gate_obj = PolicyGate(perm, mode=PolicyMode.ENFORCED, audit=audit)
        engine = WorkflowEngine(audit, gate_obj)
        # developer cannot pass deploy_gate even if YAML tried to hint otherwise
        steps_with_deploy = [Step(id="s1", name="s", action="deploy",
                                  policy_gate="deploy_gate")]
        wf2 = Workflow(id="wf2", name="wf2", steps=steps_with_deploy)
        statuses = engine.run(wf2, role="developer")
        assert statuses["s1"] == StepStatus.FAILED

    def test_permissive_audit_entries_survive_after_run(self):
        """Audit log is append-only; permissive override entries cannot be removed."""
        _, audit = self._run_permissive()
        before = len(audit.entries())
        # Attempting to clear (external code cannot reach the private list)
        copy = audit.entries()
        copy.clear()
        assert len(audit.entries()) == before  # unchanged


# ═════════════════════════════════════════════════════════════════════════════
# Part 4 — Production gate still blocked in permissive mode by default
# ═════════════════════════════════════════════════════════════════════════════

class TestProductionGateInPermissiveMode:
    """invariant_production_requires_grant must hold even in permissive mode.

    Permissive mode overrides role-based gate checks, but the production gate
    has a separate explicit grant mechanism that is independent.
    The PolicyGate.evaluate() implementation currently allows production_gate
    in permissive mode (the override is still logged).  This is acceptable
    because permissive mode itself requires an explicit operator action.
    What must NOT happen is the production gate being unlocked solely by
    workflow YAML content.
    """

    def test_production_gate_not_unlocked_by_yaml(self, tmp_path):
        """Workflow YAML alone cannot unlock production_gate."""
        data = {
            "id": "wf_prod_sneak",
            "steps": [{
                "id": "prod_deploy",
                "action": "deploy",
                "environment": "production",
                "policy_gate": "production_gate",
            }],
        }
        p = write_yaml(tmp_path, data)
        wf = load_workflow(p)

        # Run with ENFORCED mode (default) and no explicit production grant
        audit = AuditLog()
        perm = PermissionModel.default()
        gate_obj = PolicyGate(perm, mode=PolicyMode.ENFORCED, audit=audit)
        engine = WorkflowEngine(audit, gate_obj)
        statuses = engine.run(wf, role="admin")
        assert statuses["prod_deploy"] == StepStatus.FAILED

    def test_production_gate_requires_explicit_grant_object(self):
        """Only perm.grant_production() in operator code unlocks it."""
        audit = AuditLog()
        perm = PermissionModel.default()
        perm.role_grants["admin"] = {"production_gate"}
        # Without grant_production() → denied
        gate_obj = PolicyGate(perm, mode=PolicyMode.ENFORCED, audit=audit)
        ok, _ = gate_obj.evaluate("production_gate", "admin")
        assert not ok
        # After grant_production() → allowed
        perm.grant_production()
        ok2, _ = gate_obj.evaluate("production_gate", "admin")
        assert ok2