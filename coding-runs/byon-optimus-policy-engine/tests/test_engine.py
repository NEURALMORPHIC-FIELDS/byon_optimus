"""Tests for engine, planner, audit, rollback, permissions — all major classes."""
import pytest

from policy_engine.models import WorkflowDefinition, WorkflowStep, PolicyGate
from policy_engine.planner import build_plan, PlanValidator, PlanRenderer, PlanError
from policy_engine.engine import PolicyEngine
from policy_engine.audit import AuditLog
from policy_engine.permissions import PermissionModel
from policy_engine.rollback import RollbackManager
from policy_engine.policy_mode import PolicyMode


# ── helpers ──────────────────────────────────────────────────────────────────

def make_wf(*steps: WorkflowStep) -> WorkflowDefinition:
    return WorkflowDefinition(name="test", steps=list(steps))


def simple_step(name: str, depends_on=None, gates=None, env="dev") -> WorkflowStep:
    return WorkflowStep(
        name=name,
        action="noop",
        depends_on=depends_on or [],
        policy_gates=gates or [],
        environment=env,
    )


# ── PlanValidator ─────────────────────────────────────────────────────────────

def test_validator_accepts_valid_dag():
    wf = make_wf(simple_step("a"), simple_step("b", depends_on=["a"]))
    PlanValidator().validate(wf)  # must not raise


def test_validator_rejects_unknown_dep():
    wf = make_wf(simple_step("a", depends_on=["ghost"]))
    with pytest.raises(PlanError, match="unknown step"):
        PlanValidator().validate(wf)


def test_validator_rejects_cycle():
    # a -> b -> a
    wf = make_wf(
        simple_step("a", depends_on=["b"]),
        simple_step("b", depends_on=["a"]),
    )
    with pytest.raises(PlanError, match="cycle"):
        PlanValidator().validate(wf)


# ── PlanRenderer ──────────────────────────────────────────────────────────────

def test_renderer_output():
    wf = make_wf(simple_step("deploy", gates=["dev-gate"]))
    plan = build_plan(wf)
    text = PlanRenderer().render(plan)
    assert "deploy" in text
    assert "dev-gate" in text


def test_renderer_dict_structure():
    """render_dict returns a dict with workflow name and steps list."""
    wf = make_wf(
        simple_step("build"),
        simple_step("deploy", depends_on=["build"], gates=["dev-gate"]),
    )
    plan = build_plan(wf)
    d = PlanRenderer().render_dict(plan)
    assert d["workflow"] == "test"
    assert d["step_count"] == 2
    assert isinstance(d["steps"], list)
    assert len(d["steps"]) == 2


def test_renderer_dict_step_fields():
    """Each step entry in render_dict has the expected keys."""
    wf = make_wf(simple_step("build", gates=["dev-gate"]))
    plan = build_plan(wf)
    d = PlanRenderer().render_dict(plan)
    step = d["steps"][0]
    assert step["name"] == "build"
    assert step["action"] == "noop"
    assert step["environment"] == "dev"
    assert step["policy_gates"] == ["dev-gate"]
    assert step["depends_on"] == []
    assert step["condition"] is None
    assert step["order"] == 1


def test_renderer_dict_condition_included():
    """render_dict includes condition details when present."""
    from policy_engine.models import StepCondition
    step = WorkflowStep(
        name="deploy",
        action="deploy",
        environment="prod",
        policy_gates=[],
        condition=StepCondition(operator="equals", var="env", value="prod"),
    )
    wf = make_wf(step)
    plan = build_plan(wf)
    d = PlanRenderer().render_dict(plan)
    cond = d["steps"][0]["condition"]
    assert cond is not None
    assert cond["operator"] == "equals"
    assert cond["var"] == "env"
    assert cond["value"] == "prod"


def test_renderer_dict_no_condition_is_none():
    """render_dict sets condition to None when step has no condition."""
    wf = make_wf(simple_step("build"))
    plan = build_plan(wf)
    d = PlanRenderer().render_dict(plan)
    assert d["steps"][0]["condition"] is None


# ── PolicyEngine — happy path ─────────────────────────────────────────────────

def test_engine_runs_ungated_steps():
    wf = make_wf(simple_step("build"), simple_step("test", depends_on=["build"]))
    plan = build_plan(wf)
    engine = PolicyEngine(role="developer")
    results = engine.run(plan)
    assert results["build"] == "success"
    assert results["test"] == "success"


def test_engine_respects_gate_allow():
    wf = make_wf(simple_step("build", gates=["dev-gate"], env="dev"))
    plan = build_plan(wf)
    engine = PolicyEngine(role="developer")
    results = engine.run(plan)
    assert results["build"] == "success"


def test_engine_respects_gate_deny():
    wf = make_wf(simple_step("deploy", gates=["prod-gate"], env="prod"))
    plan = build_plan(wf)
    engine = PolicyEngine(role="developer")
    results = engine.run(plan)
    assert results["deploy"] == "denied"


def test_engine_blocks_dependents_on_failure():
    """REQ_FAILED_BLOCKS_DEPENDENTS: denied step blocks all transitive dependents."""
    wf = make_wf(
        simple_step("deploy", gates=["prod-gate"], env="prod"),
        simple_step("notify", depends_on=["deploy"]),
    )
    plan = build_plan(wf)
    engine = PolicyEngine(role="developer")
    results = engine.run(plan)
    assert results["deploy"] == "denied"
    assert results["notify"] == "skipped"


def test_engine_audit_records_events():
    wf = make_wf(simple_step("build", gates=["dev-gate"], env="dev"))
    plan = build_plan(wf)
    audit = AuditLog()
    engine = PolicyEngine(audit=audit, role="developer")
    engine.run(plan)
    events = [e.event for e in audit.entries]
    assert "WORKFLOW_START" in events
    assert "SUCCESS" in events


def test_engine_audit_records_denied():
    wf = make_wf(simple_step("deploy", gates=["prod-gate"], env="prod"))
    plan = build_plan(wf)
    audit = AuditLog()
    engine = PolicyEngine(audit=audit, role="developer")
    engine.run(plan)
    events = [e.event for e in audit.entries]
    assert "DENIED" in events


# ── PolicyEngine — permissive mode ────────────────────────────────────────────

def test_permissive_mode_overrides_gate():
    """PolicyMode.PERMISSIVE: denied gate is overridden, step still runs."""
    wf = make_wf(simple_step("deploy", gates=["prod-gate"], env="prod"))
    plan = build_plan(wf)
    audit = AuditLog()
    engine = PolicyEngine(audit=audit, role="developer", policy_mode=PolicyMode.PERMISSIVE)
    results = engine.run(plan)
    assert results["deploy"] == "success"
    overridden = [e for e in audit.entries if e.event == "OVERRIDDEN"]
    assert len(overridden) == 1


def test_enforce_mode_denies_normally():
    """PolicyMode.ENFORCE (default): gate denial blocks the step."""
    wf = make_wf(simple_step("deploy", gates=["prod-gate"], env="prod"))
    plan = build_plan(wf)
    engine = PolicyEngine(role="developer", policy_mode=PolicyMode.ENFORCE)
    results = engine.run(plan)
    assert results["deploy"] == "denied"


# ── RollbackManager ───────────────────────────────────────────────────────────

def test_rollback_preserves_audit():
    """REQ_ROLLBACK_PRESERVES_AUDIT: rollback adds entries, never removes."""
    audit = AuditLog()
    rm = RollbackManager(audit)
    rm.record_success("build")
    rm.record_success("test")
    rolled = rm.rollback()
    assert rolled == ["test", "build"]  # reverse order
    events = [e.event for e in audit.entries]
    assert all(ev == "ROLLBACK" for ev in events)
    assert len(events) == 2


def test_rollback_clears_completed():
    audit = AuditLog()
    rm = RollbackManager(audit)
    rm.record_success("build")
    rm.rollback()
    # Second rollback should do nothing
    rolled2 = rm.rollback()
    assert rolled2 == []


# ── AuditLog ──────────────────────────────────────────────────────────────────

def test_audit_append_only():
    """REQ_AUDIT_APPEND_ONLY: entries list grows, never shrinks."""
    audit = AuditLog()
    audit.append("START", "wf")
    audit.append("SUCCESS", "step-a")
    assert len(audit.entries) == 2
    # Mutating the returned list must not affect internal state.
    entries_copy = audit.entries
    entries_copy.clear()
    assert len(audit.entries) == 2


def test_audit_dump_format():
    audit = AuditLog()
    audit.append("SUCCESS", "build", {"role": "developer"})
    dump = audit.dump()
    assert "SUCCESS" in dump
    assert "build" in dump


# ── PermissionModel ───────────────────────────────────────────────────────────

def test_permission_model_allows_known_role():
    pm = PermissionModel.default()
    assert pm.is_allowed("dev-gate", "developer", "dev") is True


def test_permission_model_denies_wrong_role():
    pm = PermissionModel.default()
    assert pm.is_allowed("prod-gate", "developer", "prod") is False


def test_permission_model_denies_unknown_gate():
    """REQ_NO_POLICY_BYPASS: unknown gate = deny."""
    pm = PermissionModel.default()
    assert pm.is_allowed("ghost-gate", "developer", "dev") is False


def test_permission_model_prod_requires_release_manager():
    """REQ_PROD_REQUIRES_GRANT: prod-gate requires release-manager role."""
    pm = PermissionModel.default()
    assert pm.is_allowed("prod-gate", "release-manager", "prod") is True
    assert pm.is_allowed("prod-gate", "developer", "prod") is False
    assert pm.is_allowed("prod-gate", "qa-engineer", "prod") is False