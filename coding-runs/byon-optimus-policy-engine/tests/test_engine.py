"""Tests for engine, planner, permissions, audit, rollback."""
import pytest
from policy_engine.models import WorkflowDefinition, WorkflowStep, StepCondition
from policy_engine.planner import build_plan, PlanValidator, PlanError
from policy_engine.audit import AuditLog
from policy_engine.permissions import PermissionModel
from policy_engine.rollback import RollbackManager
from policy_engine.engine import PolicyEngine


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def simple_wf():
    return WorkflowDefinition(
        name="simple",
        steps=[
            WorkflowStep(name="build", action="compile"),
            WorkflowStep(name="test", action="pytest", depends_on=["build"]),
            WorkflowStep(name="deploy", action="ship", depends_on=["test"],
                         policy_gates=["dev-gate"]),
        ],
    )


@pytest.fixture
def dev_engine():
    audit = AuditLog()
    perms = PermissionModel(role="developer")
    return PolicyEngine(permissions=perms, audit=audit)


# ── PlanValidator ─────────────────────────────────────────────────────────────

def test_plan_validator_unknown_dep():
    wf = WorkflowDefinition(
        name="bad",
        steps=[WorkflowStep(name="s1", action="x", depends_on=["ghost"])],
    )
    with pytest.raises(PlanError, match="unknown step"):
        PlanValidator().validate(wf)


def test_plan_validator_cycle():
    wf = WorkflowDefinition(
        name="cycle",
        steps=[
            WorkflowStep(name="a", action="x", depends_on=["b"]),
            WorkflowStep(name="b", action="x", depends_on=["a"]),
        ],
    )
    with pytest.raises(PlanError, match="Cycle"):
        PlanValidator().validate(wf)


def test_topological_order(simple_wf):
    plan = build_plan(simple_wf)
    names = [s.name for s in plan.ordered_steps]
    assert names.index("build") < names.index("test")
    assert names.index("test") < names.index("deploy")


# ── AuditLog ──────────────────────────────────────────────────────────────────

def test_audit_append_only():
    log = AuditLog()
    log.append("start", step="s1", x=1)
    entries = log.entries
    entries.clear()  # mutating the copy must not affect the log
    assert len(log.entries) == 1  # REQ_AUDIT_APPEND_ONLY


def test_audit_dump_jsonl():
    import json
    log = AuditLog()
    log.append("ev", step="s", foo="bar")
    lines = log.dump_jsonl().splitlines()
    assert len(lines) == 1
    obj = json.loads(lines[0])
    assert obj["event"] == "ev"


# ── PermissionModel ───────────────────────────────────────────────────────────

def test_permission_dev_gate_allowed():
    pm = PermissionModel(role="developer")
    assert pm.check("dev-gate", "dev") is True


def test_permission_prod_gate_denied_wrong_role():
    """REQ_PROD_REQUIRES_GRANT: developer cannot pass prod-gate."""
    pm = PermissionModel(role="developer")
    assert pm.check("prod-gate", "prod") is False


def test_permission_unknown_gate_denied():
    """REQ_NO_POLICY_BYPASS: unknown gate is denied."""
    pm = PermissionModel(role="superuser")
    assert pm.check("nonexistent-gate", "dev") is False


# ── RollbackManager ───────────────────────────────────────────────────────────

def test_rollback_preserves_audit():
    """REQ_ROLLBACK_PRESERVES_AUDIT."""
    audit = AuditLog()
    audit.append("step_success", step="s1")
    rm = RollbackManager(audit)
    step = WorkflowStep(name="s1", action="x")
    rm.record_success(step)
    rolled = rm.rollback()
    assert "s1" in rolled
    # Original entry still present
    events = [e.event for e in audit.entries]
    assert "step_success" in events
    assert "rollback" in events


def test_rollback_reverse_order():
    audit = AuditLog()
    rm = RollbackManager(audit)
    s1 = WorkflowStep(name="s1", action="a")
    s2 = WorkflowStep(name="s2", action="b")
    rm.record_success(s1)
    rm.record_success(s2)
    rolled = rm.rollback()
    assert rolled == ["s2", "s1"]


# ── PolicyEngine ──────────────────────────────────────────────────────────────

def test_engine_success(simple_wf, dev_engine):
    plan = build_plan(simple_wf)
    results = dev_engine.run(plan)
    assert results["build"] == "success"
    assert results["test"] == "success"
    assert results["deploy"] == "success"


def test_engine_gate_denied():
    """REQ_NO_POLICY_BYPASS: prod-gate blocks deployer-less role."""
    wf = WorkflowDefinition(
        name="prod-wf",
        steps=[WorkflowStep(name="release", action="deploy",
                            policy_gates=["prod-gate"], environment="prod")],
    )
    plan = build_plan(wf)
    pm = PermissionModel(role="developer")
    engine = PolicyEngine(permissions=pm)
    results = engine.run(plan)
    assert results["release"] == "gate_denied"


def test_engine_failed_blocks_dependents():
    """REQ_FAILED_BLOCKS_DEPENDENTS."""
    wf = WorkflowDefinition(
        name="chain",
        steps=[
            WorkflowStep(name="gated", action="x",
                         policy_gates=["prod-gate"], environment="prod"),
            WorkflowStep(name="child", action="y", depends_on=["gated"]),
            WorkflowStep(name="grandchild", action="z", depends_on=["child"]),
        ],
    )
    plan = build_plan(wf)
    pm = PermissionModel(role="developer")
    engine = PolicyEngine(permissions=pm)
    results = engine.run(plan)
    assert results["gated"] == "gate_denied"
    assert results["child"] == "blocked"
    assert results["grandchild"] == "blocked"


def test_engine_audit_populated(simple_wf, dev_engine):
    plan = build_plan(simple_wf)
    dev_engine.run(plan)
    events = [e.event for e in dev_engine.audit.entries]
    assert "run_start" in events
    assert "step_success" in events
    assert "run_end" in events


# ── Conditional steps ─────────────────────────────────────────────────────────

def _make_engine(role: str = "developer", context: dict | None = None) -> PolicyEngine:
    return PolicyEngine(
        permissions=PermissionModel(role=role),
        audit=AuditLog(),
        context=context or {},
    )


def test_condition_true_runs_step():
    """Condition evaluates to True → step runs normally."""
    wf = WorkflowDefinition(
        name="cond-true",
        steps=[
            WorkflowStep(
                name="deploy",
                action="ship",
                condition=StepCondition(operator="equals", var="environment", value="production"),
            )
        ],
    )
    plan = build_plan(wf)
    engine = _make_engine(context={"environment": "production"})
    results = engine.run(plan)
    assert results["deploy"] == "success"


def test_condition_false_skips_step():
    """Condition evaluates to False → step is skipped."""
    wf = WorkflowDefinition(
        name="cond-false",
        steps=[
            WorkflowStep(
                name="deploy",
                action="ship",
                condition=StepCondition(operator="equals", var="environment", value="production"),
            )
        ],
    )
    plan = build_plan(wf)
    engine = _make_engine(context={"environment": "staging"})
    results = engine.run(plan)
    assert results["deploy"] == "skipped"


def test_condition_false_audit_records_skipped():
    """Audit log records SKIPPED with reason 'condition not met'."""
    wf = WorkflowDefinition(
        name="audit-skip",
        steps=[
            WorkflowStep(
                name="deploy",
                action="ship",
                condition=StepCondition(operator="equals", var="environment", value="production"),
            )
        ],
    )
    plan = build_plan(wf)
    engine = _make_engine(context={"environment": "dev"})
    engine.run(plan)
    skip_entries = [e for e in engine.audit.entries if e.event == "skipped"]
    assert len(skip_entries) == 1
    assert skip_entries[0].step == "deploy"
    assert skip_entries[0].detail["reason"] == "condition not met"


def test_condition_absent_runs_step():
    """No condition → step always runs."""
    wf = WorkflowDefinition(
        name="no-cond",
        steps=[WorkflowStep(name="build", action="compile")],
    )
    plan = build_plan(wf)
    engine = _make_engine(context={})
    results = engine.run(plan)
    assert results["build"] == "success"


def test_skipped_predecessor_does_not_block_dependent():
    """Skipped is NOT failure — dependent steps still run (REQ_FAILED_BLOCKS_DEPENDENTS
    only applies to gate_denied/blocked, not skipped)."""
    wf = WorkflowDefinition(
        name="skip-chain",
        steps=[
            WorkflowStep(
                name="optional-notify",
                action="notify",
                condition=StepCondition(operator="equals", var="notify", value=True),
            ),
            WorkflowStep(
                name="cleanup",
                action="clean",
                depends_on=["optional-notify"],
            ),
        ],
    )
    plan = build_plan(wf)
    # notify=False → optional-notify skipped; cleanup must still run
    engine = _make_engine(context={"notify": False})
    results = engine.run(plan)
    assert results["optional-notify"] == "skipped"
    assert results["cleanup"] == "success"


def test_all_conditions_true():
    """All conditions true → all steps succeed."""
    wf = WorkflowDefinition(
        name="all-true",
        steps=[
            WorkflowStep(
                name="build",
                action="compile",
                condition=StepCondition(operator="equals", var="env", value="ci"),
            ),
            WorkflowStep(
                name="test",
                action="pytest",
                depends_on=["build"],
                condition=StepCondition(operator="equals", var="env", value="ci"),
            ),
            WorkflowStep(
                name="deploy",
                action="ship",
                depends_on=["test"],
                condition=StepCondition(operator="equals", var="env", value="ci"),
            ),
        ],
    )
    plan = build_plan(wf)
    engine = _make_engine(context={"env": "ci"})
    results = engine.run(plan)
    assert results["build"] == "success"
    assert results["test"] == "success"
    assert results["deploy"] == "success"


def test_all_conditions_false():
    """All conditions false → all steps skipped, none blocked."""
    wf = WorkflowDefinition(
        name="all-false",
        steps=[
            WorkflowStep(
                name="build",
                action="compile",
                condition=StepCondition(operator="equals", var="env", value="ci"),
            ),
            WorkflowStep(
                name="test",
                action="pytest",
                depends_on=["build"],
                condition=StepCondition(operator="equals", var="env", value="ci"),
            ),
            WorkflowStep(
                name="deploy",
                action="ship",
                depends_on=["test"],
                condition=StepCondition(operator="equals", var="env", value="ci"),
            ),
        ],
    )
    plan = build_plan(wf)
    engine = _make_engine(context={"env": "nightly"})
    results = engine.run(plan)
    assert results["build"] == "skipped"
    assert results["test"] == "skipped"
    assert results["deploy"] == "skipped"


def test_mixed_conditions():
    """Some conditions true, some false — skipped steps do not block successors."""
    wf = WorkflowDefinition(
        name="mixed",
        steps=[
            WorkflowStep(name="always", action="compile"),
            WorkflowStep(
                name="optional",
                action="notify",
                depends_on=["always"],
                condition=StepCondition(operator="equals", var="notify", value=True),
            ),
            WorkflowStep(
                name="final",
                action="finish",
                depends_on=["optional"],
            ),
        ],
    )
    plan = build_plan(wf)
    engine = _make_engine(context={"notify": False})
    results = engine.run(plan)
    assert results["always"] == "success"
    assert results["optional"] == "skipped"
    assert results["final"] == "success"


def test_chained_skips():
    """A chain of conditional steps all skipped — no step is blocked."""
    wf = WorkflowDefinition(
        name="chained-skips",
        steps=[
            WorkflowStep(
                name="step-a",
                action="a",
                condition=StepCondition(operator="equals", var="run", value=True),
            ),
            WorkflowStep(
                name="step-b",
                action="b",
                depends_on=["step-a"],
                condition=StepCondition(operator="equals", var="run", value=True),
            ),
            WorkflowStep(
                name="step-c",
                action="c",
                depends_on=["step-b"],
                condition=StepCondition(operator="equals", var="run", value=True),
            ),
        ],
    )
    plan = build_plan(wf)
    engine = _make_engine(context={"run": False})
    results = engine.run(plan)
    assert results["step-a"] == "skipped"
    assert results["step-b"] == "skipped"
    assert results["step-c"] == "skipped"


def test_skipped_not_in_hard_failed_set():
    """Skipped predecessor + unconditional dependent → dependent runs (not blocked)."""
    wf = WorkflowDefinition(
        name="skip-then-unconditional",
        steps=[
            WorkflowStep(
                name="maybe",
                action="x",
                condition=StepCondition(operator="equals", var="flag", value="yes"),
            ),
            WorkflowStep(
                name="always",
                action="y",
                depends_on=["maybe"],
            ),
        ],
    )
    plan = build_plan(wf)
    engine = _make_engine(context={"flag": "no"})
    results = engine.run(plan)
    assert results["maybe"] == "skipped"
    assert results["always"] == "success"


# ── Regression: truncated test file (PATCH_0003 guard_blocked) ───────────────

def test_regression_test_file_complete():
    """Regression: ensure all conditional-step test functions are importable
    (guards against the truncated-file failure that caused PATCH_0003 guard_block)."""
    import tests.test_engine as m
    required = [
        "test_condition_true_runs_step",
        "test_condition_false_skips_step",
        "test_condition_false_audit_records_skipped",
        "test_condition_absent_runs_step",
        "test_skipped_predecessor_does_not_block_dependent",
        "test_all_conditions_true",
        "test_all_conditions_false",
        "test_mixed_conditions",
        "test_chained_skips",
        "test_skipped_not_in_hard_failed_set",
    ]
    for name in required:
        assert hasattr(m, name), f"Missing test function: {name}"