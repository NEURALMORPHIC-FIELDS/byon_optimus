"""Tests for engine, policy, audit, and rollback — including conditional steps."""
import pytest

from policy_engine.audit import AuditLog
from policy_engine.engine import RollbackManager, WorkflowEngine, _simulate_action
from policy_engine.models import Step, StepStatus, Workflow
from policy_engine.policy import PermissionModel, PolicyGate


# ── helpers ───────────────────────────────────────────────────────────────────

def make_gate(production: bool = False) -> PolicyGate:
    perm = PermissionModel.default()
    if production:
        perm.grant_production()
    return PolicyGate(perm)


def make_engine(production: bool = False) -> tuple[WorkflowEngine, AuditLog]:
    audit = AuditLog()
    gate = make_gate(production)
    return WorkflowEngine(audit, gate), audit


def run(steps, role="deployer", run_vars=None, production=False):
    engine, audit = make_engine(production)
    wf = Workflow(id="wf", name="wf", steps=steps)
    statuses = engine.run(wf, role, run_vars=run_vars)
    return statuses, engine, audit


# ── audit ─────────────────────────────────────────────────────────────────────

def test_audit_append_only():
    log = AuditLog()
    log.append("a")
    log.append("b")
    copy = log.entries()
    assert len(copy) == 2
    copy.clear()
    assert len(log.entries()) == 2  # original unaffected


def test_audit_entry_copy_immutable():
    log = AuditLog()
    log.append("x")
    log.entries()[0]["event"] = "tampered"
    assert log.entries()[0]["event"] == "x"


# ── policy ────────────────────────────────────────────────────────────────────

def test_policy_allows_granted_role():
    gate = make_gate()
    ok, _ = gate.evaluate("deploy_gate", "deployer")
    assert ok


def test_policy_denies_wrong_role():
    gate = make_gate()
    ok, reason = gate.evaluate("deploy_gate", "developer")
    assert not ok
    assert "denied" in reason


def test_production_gate_off_by_default():
    perm = PermissionModel.default()
    perm.role_grants["admin"] = {"production_gate"}
    gate = PolicyGate(perm)
    ok, _ = gate.evaluate("production_gate", "admin")
    assert not ok


def test_production_gate_on_after_grant():
    perm = PermissionModel.default()
    perm.role_grants["admin"] = {"production_gate"}
    perm.grant_production()
    ok, _ = PolicyGate(perm).evaluate("production_gate", "admin")
    assert ok


def test_no_gate_always_passes():
    ok, _ = make_gate().evaluate(None, "developer")
    assert ok


# ── basic execution ───────────────────────────────────────────────────────────

def test_simple_chain_succeeds():
    steps = [
        Step(id="build", name="Build", action="build"),
        Step(id="test", name="Test", action="test", depends_on=["build"]),
    ]
    statuses, *_ = run(steps)
    assert statuses["build"] == StepStatus.SUCCESS
    assert statuses["test"] == StepStatus.SUCCESS


def test_failed_step_blocks_dependents():
    """invariant_failed_step_blocks_dependents"""
    steps = [
        Step(id="build", name="Build", action="build",
             params={"simulate_failure": True}),
        Step(id="test", name="Test", action="test", depends_on=["build"]),
    ]
    statuses, *_ = run(steps)
    assert statuses["build"] == StepStatus.FAILED
    assert statuses["test"] == StepStatus.BLOCKED


def test_gate_denial_blocks_dependents():
    steps = [
        Step(id="deploy", name="Deploy", action="deploy",
             policy_gate="deploy_gate"),
        Step(id="notify", name="Notify", action="notify",
             depends_on=["deploy"]),
    ]
    statuses, *_ = run(steps, role="developer")
    assert statuses["deploy"] == StepStatus.FAILED
    assert statuses["notify"] == StepStatus.BLOCKED


def test_audit_has_key_events():
    steps = [Step(id="build", name="B", action="build")]
    _, engine, audit = run(steps)
    events = {e["event"] for e in audit.entries()}
    assert {"workflow_start", "step_start", "step_success", "workflow_end"} <= events


# ── conditional steps ─────────────────────────────────────────────────────────

class TestConditionalSteps:
    """All condition semantics."""

    def _steps_with_cond(self, condition, upstream_id="build"):
        return [
            Step(id=upstream_id, name="Build", action="build"),
            Step(id="cond_step", name="Cond", action="deploy",
                 depends_on=[upstream_id],
                 policy_gate="deploy_gate",
                 condition=condition),
        ]

    # condition → True → executes
    def test_condition_true_step_runs(self):
        cond = {"equals": {"var": "environment", "value": "production"}}
        steps = self._steps_with_cond(cond)
        statuses, *_ = run(steps, role="deployer",
                           run_vars={"environment": "production"})
        assert statuses["cond_step"] == StepStatus.SUCCESS

    # condition → False → SKIPPED
    def test_condition_false_step_skipped(self):
        cond = {"equals": {"var": "environment", "value": "production"}}
        steps = self._steps_with_cond(cond)
        statuses, *_ = run(steps, role="deployer",
                           run_vars={"environment": "staging"})
        assert statuses["cond_step"] == StepStatus.SKIPPED

    # SKIPPED is audited with reason
    def test_skipped_audit_entry(self):
        cond = {"equals": {"var": "environment", "value": "production"}}
        steps = self._steps_with_cond(cond)
        _, _engine, audit = run(steps, role="deployer",
                                run_vars={"environment": "staging"})
        skipped = [e for e in audit.entries() if e["event"] == "step_skipped"]
        assert len(skipped) == 1
        assert skipped[0]["reason"] == "condition not met"
        assert skipped[0]["step_id"] == "cond_step"

    # SKIPPED predecessor → downstream still runs
    def test_skipped_does_not_block_dependents(self):
        """SKIPPED is treated as satisfied, not failure."""
        steps = [
            Step(id="build", name="Build", action="build"),
            Step(id="maybe", name="Maybe", action="deploy",
                 depends_on=["build"],
                 policy_gate="deploy_gate",
                 condition={"equals": {"var": "env", "value": "prod"}}),
            Step(id="notify", name="Notify", action="notify",
                 depends_on=["maybe"]),
        ]
        statuses, *_ = run(steps, role="deployer",
                           run_vars={"env": "staging"})
        assert statuses["maybe"] == StepStatus.SKIPPED
        assert statuses["notify"] == StepStatus.SUCCESS

    # Failed predecessor still blocks even if the failing step has a condition
    def test_failed_step_still_blocks_despite_condition(self):
        steps = [
            Step(id="build", name="Build", action="build",
                 params={"simulate_failure": True}),
            Step(id="deploy", name="Deploy", action="deploy",
                 depends_on=["build"],
                 policy_gate="deploy_gate",
                 condition={"equals": {"var": "env", "value": "prod"}}),
        ]
        statuses, *_ = run(steps, role="deployer",
                           run_vars={"env": "prod"})
        assert statuses["build"] == StepStatus.FAILED
        assert statuses["deploy"] == StepStatus.BLOCKED  # blocked before cond checked

    # All-false conditions
    def test_all_conditions_false_all_skipped(self):
        cond = {"equals": {"var": "env", "value": "prod"}}
        steps = [
            Step(id="a", name="A", action="build",
                 condition=cond),
            Step(id="b", name="B", action="test",
                 depends_on=["a"], condition=cond),
            Step(id="c", name="C", action="notify",
                 depends_on=["b"], condition=cond),
        ]
        statuses, *_ = run(steps, role="deployer",
                           run_vars={"env": "staging"})
        assert all(s == StepStatus.SKIPPED for s in statuses.values())

    # All-true conditions
    def test_all_conditions_true_all_run(self):
        cond = {"equals": {"var": "env", "value": "prod"}}
        steps = [
            Step(id="a", name="A", action="