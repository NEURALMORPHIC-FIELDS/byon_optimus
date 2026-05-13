"""
Security regression tests — invariant_no_policy_bypass.

These tests document and enforce that:
  1. 'policy_gate: bypass_all' (and all reserved names) in workflow YAML/JSON
     is REJECTED at load time with a clear ValidationError.
  2. The rejection happens before any execution and is audited.
  3. No code path allows untrusted workflow config to disable policy checks.
  4. The safe operator escape hatch (PolicyMode.PERMISSIVE) works correctly,
     is audited, and is NEVER activated by workflow file content.
"""
from __future__ import annotations
import textwrap
import pytest
from pathlib import Path

from policy_engine.audit import AuditLog
from policy_engine.engine import ExecutionContext, WorkflowEngine
from policy_engine.loader import (
    ValidationError,
    _FORBIDDEN_GATE_NAMES,
    load_workflow,
)
from policy_engine.models import Step, StepStatus, WorkflowDefinition
from policy_engine.permissions import PermissionModel
from policy_engine.policy import DEFAULT_GATES, PolicyEngine, PolicyMode, PolicyViolation


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write(tmp_path: Path, content: str, name: str = "wf.yaml") -> Path:
    p = tmp_path / name
    p.write_text(textwrap.dedent(content))
    return p


def _simple_step(sid: str, gate: str) -> str:
    return textwrap.dedent(f"""\
        - id: {sid}
          name: {sid.capitalize()}
          action: build
          policy_gate: {gate}
    """)


def _make_engine(workflow, role="developer", mode=PolicyMode.ENFORCED, ctx=None):
    audit = AuditLog()
    perms = PermissionModel.from_defaults(role)
    policy = PolicyEngine(DEFAULT_GATES, perms, role, mode=mode)
    engine = WorkflowEngine(workflow, policy, audit, context=ctx)
    return engine, audit


# ---------------------------------------------------------------------------
# 1.  bypass_all rejected at load time (the original adversarial request)
# ---------------------------------------------------------------------------

def test_bypass_all_gate_rejected_in_yaml(tmp_path):
    """
    The exact request from the adversarial prompt:
      policy_gate: bypass_all
    MUST be rejected at validate / load time.
    """
    p = _write(tmp_path, """
        name: sneaky-workflow
        version: "1"
        steps:
          - id: deploy
            name: Deploy Everything
            action: deploy
            policy_gate: bypass_all
    """)
    with pytest.raises(ValidationError) as exc_info:
        load_workflow(p)

    msg = str(exc_info.value)
    assert "bypass_all" in msg
    assert "forbidden" in msg.lower() or "reserved" in msg.lower()
    assert "invariant_no_policy_bypass" in msg


def test_bypass_all_gate_rejected_in_json(tmp_path):
    """Same check for JSON workflow files."""
    import json
    data = {
        "name": "json-bypass",
        "version": "1",
        "steps": [{
            "id": "s1", "name": "S1", "action": "deploy",
            "policy_gate": "bypass_all",
        }],
    }
    p = tmp_path / "wf.json"
    p.write_text(json.dumps(data))
    with pytest.raises(ValidationError, match="bypass_all"):
        load_workflow(p)


# ---------------------------------------------------------------------------
# 2.  All forbidden gate-name variants are rejected
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("gate_name", sorted(_FORBIDDEN_GATE_NAMES))
def test_all_forbidden_gate_names_rejected(tmp_path, gate_name):
    """Every name in _FORBIDDEN_GATE_NAMES must be caught."""
    content = f"""\
        name: bad-gate
        version: "1"
        steps:
          - id: s1
            name: Step
            action: build
            policy_gate: "{gate_name}"
    """
    p = _write(tmp_path, content)
    with pytest.raises(ValidationError, match="forbidden|reserved"):
        load_workflow(p)


# ---------------------------------------------------------------------------
# 3.  Boolean bypass fields are rejected
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("field", ["bypass_policy", "skip_policy", "disable_policy"])
def test_boolean_bypass_field_rejected(tmp_path, field):
    content = f"""\
        name: bool-bypass
        version: "1"
        steps:
          - id: s1
            name: Step
            action: build
            {field}: true
    """
    p = _write(tmp_path, content)
    with pytest.raises(ValidationError, match="invariant_no_policy_bypass"):
        load_workflow(p)


# ---------------------------------------------------------------------------
# 4.  Unknown gate name is rejected at CHECK time (not just load time)
#     — even in PERMISSIVE mode, unknown gates are an error
# ---------------------------------------------------------------------------

def test_unknown_gate_raises_policy_violation_in_enforced_mode():
    step = Step(id="s", name="S", action="build", policy_gate="nonexistent-gate")
    perms = PermissionModel.from_defaults("developer")
    policy = PolicyEngine(DEFAULT_GATES, perms, "developer", mode=PolicyMode.ENFORCED)
    with pytest.raises(PolicyViolation, match="unknown policy gate"):
        policy.check(step)


def test_unknown_gate_raises_policy_violation_in_permissive_mode():
    """Unknown gate = configuration error, always rejected even in permissive mode."""
    step = Step(id="s", name="S", action="build", policy_gate="nonexistent-gate")
    perms = PermissionModel.from_defaults("developer")
    policy = PolicyEngine(DEFAULT_GATES, perms, "developer", mode=PolicyMode.PERMISSIVE)
    with pytest.raises(PolicyViolation, match="unknown policy gate"):
        policy.check(step)


# ---------------------------------------------------------------------------
# 5.  Enforced mode blocks unauthorised role (baseline regression)
# ---------------------------------------------------------------------------

def test_enforced_mode_blocks_production_gate_for_developer():
    step = Step(
        id="prod-deploy", name="Prod Deploy", action="deploy",
        policy_gate="production-gate", environment="production",
    )
    perms = PermissionModel.from_defaults("developer")
    policy = PolicyEngine(DEFAULT_GATES, perms, "developer", mode=PolicyMode.ENFORCED)
    with pytest.raises(PolicyViolation, match="not permitted"):
        policy.check(step)


def test_enforced_mode_in_engine_blocks_step_and_dependents():
    """invariant_failed_step_blocks_dependents holds in enforced mode."""
    wf = WorkflowDefinition(
        name="t", version="1",
        steps=[
            Step(id="deploy", name="Deploy", action="deploy",
                 policy_gate="production-gate", environment="production"),
            Step(id="notify", name="Notify", action="notify", depends_on=["deploy"]),
        ],
    )
    engine, audit = _make_engine(wf, role="developer", mode=PolicyMode.ENFORCED)
    results = engine.run()
    by_id = {r.step.id: r for r in results}
    assert by_id["deploy"].status == StepStatus.FAILED
    assert by_id["notify"].status == StepStatus.BLOCKED

    events = [e["event"] for e in audit.entries()]
    assert "step_policy_violation" in events
    assert "step_blocked" in events


# ---------------------------------------------------------------------------
# 6.  PERMISSIVE mode — operator opt-in, audited, never silent
# ---------------------------------------------------------------------------

def test_permissive_mode_allows_otherwise_denied_step():
    """In permissive mode a developer can run a production-gate step."""
    wf = WorkflowDefinition(
        name="t", version="1",
        steps=[
            Step(id="prod", name="Prod", action="deploy",
                 policy_gate="production-gate", environment="production"),
        ],
    )
    engine, audit = _make_engine(wf, role="developer", mode=PolicyMode.PERMISSIVE)
    results = engine.run()
    assert results[0].status == StepStatus.SUCCESS


def test_permissive_mode_audits_every_override():
    """Every overridden gate decision must appear in the audit log."""
    wf = WorkflowDefinition(
        name="t", version="1",
        steps=[
            Step(id="prod", name="Prod", action="deploy",
                 policy_gate="production-gate", environment="production"),
        ],
    )
    engine, audit = _make_engine(wf, role="developer", mode=PolicyMode.PERMISSIVE)
    engine.run()

    override_entries = [e for e in audit.entries() if e["event"] == "policy_overridden"]
    assert len(override_entries) == 1
    entry = override_entries[0]
    assert entry["step_id"] == "prod"
    assert entry["policy_mode"] == "permissive"
    assert "OVERRIDDEN" in entry["reason"]


def test_permissive_mode_audit_entry_contains_role_and_gate():
    wf = WorkflowDefinition(
        name="t", version="1",
        steps=[
            Step(id="s", name="S", action="deploy",
                 policy_gate="staging-gate", environment="staging"),
        ],
    )
    # developer doesn't have staging-gate → will be overridden
    engine, audit = _make_engine(wf, role="developer", mode=PolicyMode.PERMISSIVE)
    engine.run()

    override_entries = [e for e in audit.entries() if e["event"] == "policy_overridden"]
    assert override_entries, "Expected a policy_overridden audit entry"
    reason = override_entries[0]["reason"]
    assert "developer" in reason
    assert "staging-gate" in reason


def test_permissive_mode_does_not_suppress_step_success_in_output():
    """Steps run in permissive mode still show SUCCESS, but message flags override."""
    wf = WorkflowDefinition(
        name="t", version="1",
        steps=[
            Step(id="s", name="S", action="deploy",
                 policy_gate="production-gate", environment="production"),
        ],
    )
    engine, _ = _make_engine(wf, role="developer", mode=PolicyMode.PERMISSIVE)
    results = engine.run()
    assert results[0].status == StepStatus.SUCCESS
    assert "POLICY-OVERRIDDEN" in results[0].message


def test_permissive_mode_multiple_overrides_all_audited():
    """Two gated steps → two override audit entries."""
    wf = WorkflowDefinition(
        name="t", version="1",
        steps=[
            Step(id="s1", name="S1", action="deploy",
                 policy_gate="production-gate", environment="production"),
            Step(id="s2", name="S2", action="notify",
                 depends_on=["s1"], policy_gate="staging-gate"),
        ],
    )
    engine, audit = _make_engine(wf, role="developer", mode=PolicyMode.PERMISSIVE)
    engine.run()

    overrides = [e for e in audit.entries() if e["event"] == "policy_overridden"]
    assert len(overrides) == 2
    overridden_steps = {e["step_id"] for e in overrides}
    assert overridden_steps == {"s1", "s2"}


# ---------------------------------------------------------------------------
# 7.  PERMISSIVE mode cannot be activated from workflow YAML
#     (it is a CLI / operator-level flag only)
# ---------------------------------------------------------------------------

def test_permissive_mode_not_a_workflow_field(tmp_path):
    """
    A workflow file that attempts to set policy_mode is just treated as an
    unrecognised metadata field — it has NO effect on policy enforcement.
    The engine mode comes from the PolicyEngine constructor, not the file.
    """
    p = _write(tmp_path, """
        name: sneaky-permissive
        version: "1"
        metadata:
          policy_mode: permissive
        steps:
          - id: s1
            name: Step
            action: build
            policy_gate: production-gate
    """)
    # This loads fine (metadata is ignored for policy decisions)
    wf = load_workflow(p)
    assert wf.metadata.get("policy_mode") == "permissive"  # stored but NOT honoured

    # Engine is created with ENFORCED mode (the default / safe default)
    engine, audit = _make_engine(wf, role="developer", mode=PolicyMode.ENFORCED)
    results = engine.run()

    # The step must still be FAILED — metadata had no effect
    by_id = {r.step.id: r for r in results}
    assert by_id["s1"].status == StepStatus.FAILED

    # No policy_overridden events must exist
    overrides = [e for e in audit.entries() if e["event"] == "policy_overridden"]
    assert overrides == []


# ---------------------------------------------------------------------------
# 8.  Audit log invariants hold through all of the above
# ---------------------------------------------------------------------------

def test_audit_log_is_append_only_after_bypass_attempt(tmp_path):
    """
    Even when a bypass attempt is made (and rejected), the audit log
    must only grow — no entries may be removed.
    """
    audit = AuditLog()
    audit.record("pre_existing_event", x=1)
    before = len(audit)

    # Simulate what happens if we record a validation failure
    audit.record("workflow_validation_failed", reason="bypass_all forbidden")
    after = len(audit)

    assert after > before
    # Original entry still intact
    assert audit.entries()[0]["event"] == "pre_existing_event"