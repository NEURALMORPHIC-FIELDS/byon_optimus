"""Tests for REQ_NO_POLICY_BYPASS — the core security requirement.

Covers:
  1. Workflow YAML/JSON with ``policy_gate: bypass_all`` is REJECTED at load time.
  2. Variants of the bypass directive are also rejected.
  3. Step-level ``policy_gate`` (singular) is rejected.
  4. The forbidden key triggers a LoadError with a clear message.
  5. A valid workflow without bypass directives still loads correctly.
  6. Operator-controlled permissive mode (PolicyMode.PERMISSIVE):
     - Gate failures are recorded as OVERRIDDEN, not silently elided.
     - Execution continues in permissive mode.
     - Audit log contains OVERRIDDEN entries with gate name and role.
     - ENFORCE mode (default) still denies normally.
  7. PolicyMode cannot be set from within a workflow file.
  8. POLICY_MODE env var activates permissive mode when set by operator.
"""
from __future__ import annotations
import json
import os
import textwrap
import pytest
from pathlib import Path

from policy_engine.loader import load_workflow, LoadError
from policy_engine.models import WorkflowDefinition, WorkflowStep
from policy_engine.planner import build_plan
from policy_engine.engine import PolicyEngine
from policy_engine.audit import AuditLog
from policy_engine.permissions import PermissionModel
from policy_engine.policy_mode import PolicyMode, get_policy_mode_from_env


# ── helpers ───────────────────────────────────────────────────────────────────

def _write(tmp_path: Path, name: str, content: str) -> Path:
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


def _gated_step(name: str = "deploy", gate: str = "prod-gate", env: str = "prod") -> WorkflowStep:
    return WorkflowStep(
        name=name,
        action="deploy",
        depends_on=[],
        policy_gates=[gate],
        environment=env,
    )


# ── 1. Top-level bypass_all is rejected ──────────────────────────────────────

def test_bypass_all_yaml_rejected(tmp_path):
    """REQ_NO_POLICY_BYPASS: policy_gate: bypass_all in YAML must raise LoadError."""
    p = _write(tmp_path, "bad.yaml", textwrap.dedent("""\
        name: evil-workflow
        policy_gate: bypass_all
        steps:
          - name: deploy
            action: deploy
            environment: prod
            policy_gates: [prod-gate]
    """))
    with pytest.raises(LoadError, match="REQ_NO_POLICY_BYPASS"):
        load_workflow(p)


def test_bypass_all_json_rejected(tmp_path):
    """REQ_NO_POLICY_BYPASS: policy_gate: bypass_all in JSON must raise LoadError."""
    data = {
        "name": "evil-workflow",
        "policy_gate": "bypass_all",
        "steps": [{"name": "deploy", "action": "deploy"}],
    }
    p = _write(tmp_path, "bad.json", json.dumps(data))
    with pytest.raises(LoadError, match="REQ_NO_POLICY_BYPASS"):
        load_workflow(p)


def test_bypass_all_error_message_is_informative(tmp_path):
    """The LoadError message must explain the rejection and the safe alternative."""
    p = _write(tmp_path, "bad.yaml", textwrap.dedent("""\
        name: evil-workflow
        policy_gate: bypass_all
        steps: []
    """))
    with pytest.raises(LoadError) as exc_info:
        load_workflow(p)
    msg = str(exc_info.value)
    assert "bypass" in msg.lower() or "policy_gate" in msg.lower()
    # Must mention the safe alternative.
    assert "--policy-mode" in msg or "POLICY_MODE" in msg or "operator" in msg.lower()


# ── 2. Bypass value variants are rejected ────────────────────────────────────

@pytest.mark.parametrize("bypass_value", ["bypass_all", "bypass-all", "BYPASS_ALL"])
def test_bypass_value_variants_rejected(tmp_path, bypass_value):
    """All known bypass value spellings must be rejected."""
    data = {
        "name": "evil",
        "policy_gate": bypass_value,
        "steps": [],
    }
    p = _write(tmp_path, "bad.json", json.dumps(data))
    with pytest.raises(LoadError, match="REQ_NO_POLICY_BYPASS"):
        load_workflow(p)


def test_bypass_all_as_step_value_rejected(tmp_path):
    """bypass_all as a value anywhere in a step is rejected."""
    p = _write(tmp_path, "bad.yaml", textwrap.dedent("""\
        name: evil
        steps:
          - name: deploy
            action: deploy
            environment: bypass_all
    """))
    with pytest.raises(LoadError, match="REQ_NO_POLICY_BYPASS"):
        load_workflow(p)


# ── 3. Step-level policy_gate (singular) is rejected ─────────────────────────

def test_step_level_policy_gate_singular_rejected(tmp_path):
    """REQ_NO_POLICY_BYPASS: 'policy_gate' (singular) at step level is forbidden."""
    p = _write(tmp_path, "bad.yaml", textwrap.dedent("""\
        name: evil
        steps:
          - name: deploy
            action: deploy
            policy_gate: bypass_all
    """))
    with pytest.raises(LoadError, match="REQ_NO_POLICY_BYPASS"):
        load_workflow(p)


def test_step_level_policy_gate_singular_without_bypass_rejected(tmp_path):
    """Even 'policy_gate: some-gate' (singular, not bypass) at step level is rejected.

    The singular form is not a valid field; only 'policy_gates' (plural) is.
    This prevents confusion and potential future bypass vectors.
    """
    p = _write(tmp_path, "bad.yaml", textwrap.dedent("""\
        name: evil
        steps:
          - name: deploy
            action: deploy
            policy_gate: dev-gate
    """))
    with pytest.raises(LoadError, match="REQ_NO_POLICY_BYPASS"):
        load_workflow(p)


# ── 4. Top-level policy_mode key is rejected ─────────────────────────────────

def test_top_level_policy_mode_key_rejected(tmp_path):
    """REQ_NO_POLICY_BYPASS: workflow files cannot set policy_mode."""
    p = _write(tmp_path, "bad.yaml", textwrap.dedent("""\
        name: evil
        policy_mode: permissive
        steps:
          - name: deploy
            action: deploy
    """))
    with pytest.raises(LoadError, match="REQ_NO_POLICY_BYPASS"):
        load_workflow(p)


# ── 5. Valid workflow still loads correctly ───────────────────────────────────

def test_valid_workflow_loads_without_error(tmp_path):
    """Sanity check: a legitimate workflow without bypass directives loads fine."""
    p = _write(tmp_path, "ok.yaml", textwrap.dedent("""\
        name: good-workflow
        steps:
          - name: build
            action: build
            environment: dev
            policy_gates: [dev-gate]
          - name: deploy
            action: deploy
            environment: prod
            depends_on: [build]
            policy_gates: [prod-gate]
    """))
    wf = load_workflow(p)
    assert wf.name == "good-workflow"
    assert len(wf.steps) == 2


# ── 6. Permissive mode: OVERRIDDEN recorded, not silently elided ──────────────

def test_permissive_mode_records_overridden_not_denied():
    """PolicyMode.PERMISSIVE must record OVERRIDDEN, not DENIED, and not block."""
    wf = WorkflowDefinition(name="test", steps=[_gated_step()])
    plan = build_plan(wf)
    audit = AuditLog()
    engine = PolicyEngine(
        role="developer",  # developer cannot pass prod-gate
        audit=audit,
        policy_mode=PolicyMode.PERMISSIVE,
    )
    results = engine.run(plan)

    # Step must have executed (not denied/blocked).
    assert results["deploy"] == "success"

    # Audit must contain OVERRIDDEN, not DENIED.
    events = [e.event for e in audit.entries]
    assert "OVERRIDDEN" in events
    assert "DENIED" not in events


def test_permissive_mode_overridden_entry_has_gate_and_role():
    """OVERRIDDEN audit entry must record gate name and role."""
    wf = WorkflowDefinition(name="test", steps=[_gated_step(gate="prod-gate")])
    plan = build_plan(wf)
    audit = AuditLog()
    engine = PolicyEngine(
        role="developer",
        audit=audit,
        policy_mode=PolicyMode.PERMISSIVE,
    )
    engine.run(plan)

    overridden = [e for e in audit.entries if e.event == "OVERRIDDEN"]
    assert len(overridden) == 1
    assert overridden[0].details["gate"] == "prod-gate"
    assert overridden[0].details["role"] == "developer"
    assert overridden[0].details["policy_mode"] == "permissive"


def test_permissive_mode_overridden_entry_has_warning():
    """OVERRIDDEN entry must carry a human-readable warning."""
    wf = WorkflowDefinition(name="test", steps=[_gated_step()])
    plan = build_plan(wf)
    audit = AuditLog()
    engine = PolicyEngine(role="developer", audit=audit, policy_mode=PolicyMode.PERMISSIVE)
    engine.run(plan)

    overridden = [e for e in audit.entries if e.event == "OVERRIDDEN"]
    assert "warning" in overridden[0].details
    assert len(overridden[0].details["warning"]) > 0


def test_permissive_mode_multiple_gates_all_overridden():
    """All failing gates on a step are checked; the first failure triggers OVERRIDDEN."""
    step = WorkflowStep(
        name="deploy",
        action="deploy",
        depends_on=[],
        policy_gates=["prod-gate", "staging-gate"],
        environment="prod",
    )
    wf = WorkflowDefinition(name="test", steps=[step])
    plan = build_plan(wf)
    audit = AuditLog()
    engine = PolicyEngine(role="developer", audit=audit, policy_mode=PolicyMode.PERMISSIVE)
    results = engine.run(plan)

    assert results["deploy"] == "success"
    overridden = [e for e in audit.entries if e.event == "OVERRIDDEN"]
    assert len(overridden) == 1  # first failing gate triggers override


def test_permissive_mode_workflow_start_records_mode():
    """WORKFLOW_START audit entry must record the active policy_mode."""
    wf = WorkflowDefinition(name="test", steps=[_gated_step()])
    plan = build_plan(wf)
    audit = AuditLog()
    engine = PolicyEngine(role="developer", audit=audit, policy_mode=PolicyMode.PERMISSIVE)
    engine.run(plan)

    start_entries = [e for e in audit.entries if e.event == "WORKFLOW_START"]
    assert len(start_entries) == 1
    assert start_entries[0].details["policy_mode"] == "permissive"


# ── 6b. ENFORCE mode still denies normally ───────────────────────────────────

def test_enforce_mode_still_denies():
    """Default ENFORCE mode must still deny gate failures (regression guard)."""
    wf = WorkflowDefinition(name="test", steps=[_gated_step()])
    plan = build_plan(wf)
    audit = AuditLog()
    engine = PolicyEngine(
        role="developer",
        audit=audit,
        policy_mode=PolicyMode.ENFORCE,  # explicit default
    )
    results = engine.run(plan)

    assert results["deploy"].startswith("denied:")
    events = [e.event for e in audit.entries]
    assert "DENIED" in events
    assert "OVERRIDDEN" not in events


def test_default_policy_mode_is_enforce():
    """PolicyEngine default must be ENFORCE — permissive is never the default."""
    engine = PolicyEngine()
    assert engine.policy_mode is PolicyMode.ENFORCE


# ── 7. PolicyMode cannot be set from workflow file ───────────────────────────

def test_workflow_file_cannot_set_policy_mode(tmp_path):
    """Attempting to set policy_mode in the workflow file must be rejected."""
    p = _write(tmp_path, "bad.yaml", textwrap.dedent("""\
        name: evil
        policy_mode: permissive
        steps: []
    """))
    with pytest.raises(LoadError):
        load_workflow(p)


# ── 8. POLICY_MODE env var (operator-controlled) ─────────────────────────────

def test_env_var_permissive_activates_permissive_mode(monkeypatch):
    """POLICY_MODE=permissive env var must activate PolicyMode.PERMISSIVE."""
    monkeypatch.setenv("POLICY_MODE", "permissive")
    assert get_policy_mode_from_env() is PolicyMode.PERMISSIVE


def test_env_var_enforce_activates_enforce_mode(monkeypatch):
    monkeypatch.setenv("POLICY_MODE", "enforce")
    assert get_policy_mode_from_env() is PolicyMode.ENFORCE


def test_env_var_absent_defaults_to_enforce(monkeypatch):
    monkeypatch.delenv("POLICY_MODE", raising=False)
    assert get_policy_mode_from_env() is PolicyMode.ENFORCE


def test_env_var_unknown_value_defaults_to_enforce(monkeypatch):
    """Unknown POLICY_MODE values must default to ENFORCE (fail-safe)."""
    monkeypatch.setenv("POLICY_MODE", "turbo_bypass_everything")
    assert get_policy_mode_from_env() is PolicyMode.ENFORCE


def test_env_var_case_insensitive_permissive(monkeypatch):
    """POLICY_MODE matching is case-insensitive."""
    monkeypatch.setenv("POLICY_MODE", "PERMISSIVE")
    assert get_policy_mode_from_env() is PolicyMode.PERMISSIVE


# ── 9. Audit log immutability is preserved in permissive mode ────────────────

def test_permissive_mode_audit_is_append_only():
    """REQ_AUDIT_APPEND_ONLY: permissive mode adds entries, never removes them."""
    wf = WorkflowDefinition(name="test", steps=[_gated_step()])
    plan = build_plan(wf)
    audit = AuditLog()
    engine = PolicyEngine(role="developer", audit=audit, policy_mode=PolicyMode.PERMISSIVE)

    engine.run(plan)
    count_after_run = len(audit.entries)
    assert count_after_run > 0

    # Defensive copy: mutating returned list must not affect internal state.
    audit.entries.clear()  # this is a copy — should have no effect
    assert len(audit.entries) == count_after_run


# ── 10. Permissive mode does not affect condition evaluation ──────────────────

def test_permissive_mode_does_not_skip_condition_evaluation():
    """Conditions are still evaluated in permissive mode; only gate failures differ."""
    from policy_engine.models import StepCondition
    step = WorkflowStep(
        name="deploy",
        action="deploy",
        depends_on=[],
        policy_gates=["prod-gate"],
        environment="prod",
        condition=StepCondition(operator="equals", var="env", value="prod"),
    )
    wf = WorkflowDefinition(name="test", steps=[step])
    plan = build_plan(wf)

    # Condition NOT met → step skipped regardless of permissive mode.
    engine = PolicyEngine(role="developer", policy_mode=PolicyMode.PERMISSIVE)
    results = engine.run(plan, variables={"env": "staging"})
    assert results["deploy"] == "skipped:condition_not_met"

    # Condition met → gate overridden → step executes.
    engine2 = PolicyEngine(role="developer", policy_mode=PolicyMode.PERMISSIVE)
    results2 = engine2.run(plan, variables={"env": "prod"})
    assert results2["deploy"] == "success"