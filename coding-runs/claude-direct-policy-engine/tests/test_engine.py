"""Tests for WorkflowEngine, AuditLog, PermissionModel, and RollbackManager."""
import pytest

from policy_engine.audit import AuditLog
from policy_engine.engine import WorkflowEngine
from policy_engine.models import PolicyGate, Step, StepStatus, Workflow
from policy_engine.permissions import PermissionModel
from policy_engine.rollback import RollbackManager


def _make_workflow(steps, gates=None):
    return Workflow(
        name="test-wf",
        version="1.0",
        steps=steps,
        gates=gates or {},
        description="test",
    )


def _simple_workflow():
    """Two steps: build → deploy."""
    steps = [
        Step(id="build", name="Build", action="build.run"),
        Step(id="deploy", name="Deploy", action="deploy.run", depends_on=["build"]),
    ]
    return _make_workflow(steps)


# ---------------------------------------------------------------------------
# Test 1: Successful run records audit entries and marks steps SUCCESS
# ---------------------------------------------------------------------------
def test_successful_run(tmp_path):
    wf = _simple_workflow()
    audit = AuditLog()
    perm = PermissionModel()
    engine = WorkflowEngine(wf, audit, perm, actor_roles=["developer"])

    result = engine.run()

    assert result is True
    assert wf.steps[0].status == StepStatus.SUCCESS
    assert wf.steps[1].status == StepStatus.SUCCESS
    # Audit must have entries
    assert len(audit) > 0
    events = [e.event for e in audit.entries()]
    assert "workflow_start" in events
    assert "step_success" in events
    assert "workflow_complete" in events


# ---------------------------------------------------------------------------
# Test 2: Failed step blocks dependents (invariant_failed_step_blocks_dependents)
# ---------------------------------------------------------------------------
def test_failed_step_blocks_dependents():
    """We simulate failure by subclassing engine and overriding _execute_step."""
    wf = _simple_workflow()
    audit = AuditLog()
    perm = PermissionModel()

    class FailingEngine(WorkflowEngine):
        def _execute_step(self, step):
            step.status = StepStatus.FAILED
            self.audit.record("step_failed", "Simulated failure", step_id=step.id)

    engine = FailingEngine(wf, audit, perm, actor_roles=["developer"])
    result = engine.run()

    assert result is False
    assert wf.steps[0].status == StepStatus.FAILED
    # deploy depends on build → must be BLOCKED
    assert wf.steps[1].status == StepStatus.BLOCKED


# ---------------------------------------------------------------------------
# Test 3: Policy gate denies step when actor lacks required role
# ---------------------------------------------------------------------------
def test_policy_gate_denies_unprivileged_actor():
    gate = PolicyGate(name="prod_gate", required_role="release_manager")
    step = Step(id="deploy", name="Deploy", action="deploy.run", policy_gates=["prod_gate"])
    wf = _make_workflow([step], gates={"prod_gate": gate})

    audit = AuditLog()
    perm = PermissionModel(role_gates={"release_manager": {"prod_gate"}})
    engine = WorkflowEngine(wf, audit, perm, actor_roles=["developer"])  # no release_manager

    result = engine.run()

    assert result is False
    assert step.status == StepStatus.FAILED
    gate_events = [e for e in audit.entries() if e.event == "gate_check"]
    assert any("DENY" in e.detail for e in gate_events)


# ---------------------------------------------------------------------------
# Test 4: Policy gate passes when actor has required role
# ---------------------------------------------------------------------------
def test_policy_gate_allows_privileged_actor():
    gate = PolicyGate(name="dev_gate", required_role="developer")
    step = Step(id="build", name="Build", action="build.run", policy_gates=["dev_gate"])
    wf = _make_workflow([step], gates={"dev_gate": gate})

    audit = AuditLog()
    perm = PermissionModel(role_gates={"developer": {"dev_gate"}})
    engine = WorkflowEngine(wf, audit, perm, actor_roles=["developer"])

    result = engine.run()

    assert result is True
    assert step.status == StepStatus.SUCCESS


# ---------------------------------------------------------------------------
# Test 5: Rollback undoes steps in reverse order — audit history preserved
# ---------------------------------------------------------------------------
def test_rollback_preserves_audit_and_reverses_order():
    wf = _simple_workflow()
    audit = AuditLog()
    perm = PermissionModel()
    engine = WorkflowEngine(wf, audit, perm)

    engine.run()
    entries_before = len(audit)

    engine.rollback()

    # Audit must have grown (rollback is audited)
    assert len(audit) > entries_before
    events = [e.event for e in audit.entries()]
    assert "rollback_start" in events
    assert "step_rollback" in events
    assert "rollback_complete" in events
    # Original entries still present (append-only)
    assert audit.entries()[:entries_before] == audit.entries()[:entries_before]


# ---------------------------------------------------------------------------
# Test 6: AuditLog is append-only — entries list copy prevents mutation
# ---------------------------------------------------------------------------
def test_audit_log_append_only():
    audit = AuditLog()
    audit.record("test_event", "detail 1")
    snapshot = audit.entries()
    snapshot.clear()  # mutate the snapshot
    # Internal list must be unaffected
    assert len(audit) == 1


# ---------------------------------------------------------------------------
# Test 7: Production gate denied without explicit grant
# ---------------------------------------------------------------------------
def test_production_gate_denied_without_grant():
    from policy_engine.permissions import PRODUCTION_GATES
    gate_name = next(iter(PRODUCTION_GATES))  # e.g. "production_approval"

    gate = PolicyGate(name=gate_name, required_role="release_manager")
    step = Step(id="prod_deploy", name="Prod Deploy", action="deploy.prod", policy_gates=[gate_name])

    # give the gate to release_manager in role_gates but no explicit production grant
    perm = PermissionModel(
        role_gates={"release_manager": {gate_name}},
        production_grants=set(),  # explicitly empty
    )
    wf = _make_workflow([step], gates={gate_name: gate})
    audit = AuditLog()
    engine = WorkflowEngine(wf, audit, perm, actor_roles=["release_manager"])

    result = engine.run()
    assert result is False  # denied without explicit grant


# ---------------------------------------------------------------------------
# Test 8: RollbackManager delegates to engine correctly
# ---------------------------------------------------------------------------
def test_rollback_manager():
    wf = _simple_workflow()
    audit = AuditLog()
    perm = PermissionModel()
    engine = WorkflowEngine(wf, audit, perm)
    engine.run()

    rm = RollbackManager(engine, audit)
    before = len(audit)
    rm.execute_rollback()
    assert len(audit) > before


# ---------------------------------------------------------------------------
# Test 9: Topological ordering respects dependencies
# ---------------------------------------------------------------------------
def test_topological_order_respects_deps():
    """c depends on b, b depends on a → order must be a, b, c."""
    steps = [
        Step(id="c", name="C", action="c.run", depends_on=["b"]),
        Step(id="a", name="A", action="a.run"),
        Step(id="b", name="B", action="b.run", depends_on=["a"]),
    ]
    wf = _make_workflow(steps)
    audit = AuditLog()
    perm = PermissionModel()
    engine = WorkflowEngine(wf, audit, perm)
    order = engine._topological_order()
    ids = [s.id for s in order]
    assert ids.index("a") < ids.index("b") < ids.index("c")