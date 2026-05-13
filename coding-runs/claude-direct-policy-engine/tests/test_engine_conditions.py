"""Tests for conditional step execution in WorkflowEngine.

Covers:
  - all-true conditions (all steps run)
  - all-false conditions (all steps skipped)
  - mixed conditions
  - chained skips (skipped predecessor → dependent still runs)
  - skipped ≠ failure (dependents not blocked)
  - failed ≠ skipped (dependents ARE blocked on failure)
  - audit records for skipped steps
"""
import pytest

from policy_engine.audit import AuditLog
from policy_engine.engine import WorkflowEngine
from policy_engine.models import PolicyGate, Step, StepStatus, Workflow
from policy_engine.permissions import PermissionModel


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _wf(steps, gates=None):
    return Workflow(name="test", version="1.0", steps=steps, gates=gates or {})


def _engine(wf, variables=None, roles=None):
    return WorkflowEngine(
        workflow=wf,
        audit=AuditLog(),
        permission_model=PermissionModel(),
        actor_roles=roles or [],
        variables=variables or {},
    )


def _audit_events(engine):
    return [e.event for e in engine.audit.entries()]


def _skipped_reason(engine, step_id):
    return next(
        e.detail
        for e in engine.audit.entries()
        if e.event == "step_skipped" and e.step_id == step_id
    )


# ---------------------------------------------------------------------------
# 1. No condition → always runs
# ---------------------------------------------------------------------------

def test_no_condition_step_runs():
    step = Step(id="build", name="Build", action="build.run")
    engine = _engine(_wf([step]), variables={})
    assert engine.run() is True
    assert step.status == StepStatus.SUCCESS


# ---------------------------------------------------------------------------
# 2. All-true conditions → all steps run
# ---------------------------------------------------------------------------

def test_all_true_conditions_all_steps_run():
    steps = [
        Step(id="a", name="A", action="a.run",
             condition={"equals": {"var": "env", "value": "prod"}}),
        Step(id="b", name="B", action="b.run", depends_on=["a"],
             condition={"in": {"var": "env", "values": ["prod", "staging"]}}),
    ]
    engine = _engine(_wf(steps), variables={"env": "prod"})
    result = engine.run()
    assert result is True
    assert steps[0].status == StepStatus.SUCCESS
    assert steps[1].status == StepStatus.SUCCESS


# ---------------------------------------------------------------------------
# 3. All-false conditions → all steps skipped, run() returns True (not failure)
# ---------------------------------------------------------------------------

def test_all_false_conditions_all_steps_skipped():
    steps = [
        Step(id="a", name="A", action="a.run",
             condition={"equals": {"var": "env", "value": "prod"}}),
        Step(id="b", name="B", action="b.run", depends_on=["a"],
             condition={"equals": {"var": "env", "value": "prod"}}),
    ]
    engine = _engine(_wf(steps), variables={"env": "dev"})
    result = engine.run()
    assert result is True  # skipped ≠ failure
    assert steps[0].status == StepStatus.SKIPPED
    assert steps[1].status == StepStatus.SKIPPED


# ---------------------------------------------------------------------------
# 4. Mixed conditions: first skipped, second runs (skipped ≠ blocking)
# ---------------------------------------------------------------------------

def test_mixed_conditions_skipped_predecessor_does_not_block():
    """
    deploy has no condition → should run regardless of checkout being skipped.
    """
    checkout = Step(
        id="checkout",
        name="Checkout",
        action="git.checkout",
        condition={"equals": {"var": "env", "value": "prod"}},
    )
    deploy = Step(
        id="deploy",
        name="Deploy",
        action="deploy.run",
        depends_on=["checkout"],
        # No condition on deploy itself
    )
    engine = _engine(_wf([checkout, deploy]), variables={"env": "dev"})
    result = engine.run()

    assert result is True
    assert checkout.status == StepStatus.SKIPPED
    assert deploy.status == StepStatus.SUCCESS


# ---------------------------------------------------------------------------
# 5. Chained skips: A skipped → B runs → C skips
# ---------------------------------------------------------------------------

def test_chained_skips_mixed():
    a = Step(id="a", name="A", action="a.run",
             condition={"equals": {"var": "flag", "value": "yes"}})  # will skip
    b = Step(id="b", name="B", action="b.run", depends_on=["a"])      # runs (no cond)
    c = Step(id="c", name="C", action="c.run", depends_on=["b"],
             condition={"equals": {"var": "flag", "value": "yes"}})   # will skip

    engine = _engine(_wf([a, b, c]), variables={"flag": "no"})
    result = engine.run()

    assert result is True
    assert a.status == StepStatus.SKIPPED
    assert b.status == StepStatus.SUCCESS
    assert c.status == StepStatus.SKIPPED


# ---------------------------------------------------------------------------
# 6. Skipped step is audited with 'condition not met' detail
# ---------------------------------------------------------------------------

def test_skipped_step_audited_with_reason():
    step = Step(
        id="release",
        name="Release",
        action="release.publish",
        condition={"equals": {"var": "env", "value": "prod"}},
    )
    engine = _engine(_wf([step]), variables={"env": "staging"})
    engine.run()

    assert step.status == StepStatus.SKIPPED
    assert "step_skipped" in _audit_events(engine)
    reason = _skipped_reason(engine, "release")
    assert "Condition not met" in reason


# ---------------------------------------------------------------------------
# 7. Failed step still blocks dependents (failure ≠ skip)
# ---------------------------------------------------------------------------

def test_failed_step_blocks_dependents_not_skipped():
    build = Step(id="build", name="Build", action="build.run")
    deploy = Step(id="deploy", name="Deploy", action="deploy.run", depends_on=["build"])
    wf = _wf([build, deploy])
    audit = AuditLog()
    perm = PermissionModel()

    class FailingEngine(WorkflowEngine):
        def _execute_step(self, step):
            step.status = StepStatus.FAILED
            self.audit.record("step_failed", "Simulated failure", step_id=step.id)

    engine = FailingEngine(wf, audit, perm)
    result = engine.run()

    assert result is False
    assert build.status == StepStatus.FAILED
    assert deploy.status == StepStatus.BLOCKED  # NOT skipped


# ---------------------------------------------------------------------------
# 8. exists / not_exists conditions
# ---------------------------------------------------------------------------

def test_exists_condition_true():
    step = Step(id="s", name="S", action="s.run",
                condition={"exists": {"var": "feature"}})
    engine = _engine(_wf([step]), variables={"feature": "on"})
    engine.run()
    assert step.status == StepStatus.SUCCESS


def test_exists_condition_false_skips():
    step = Step(id="s", name="S", action="s.run",
                condition={"exists": {"var": "feature"}})
    engine = _engine(_wf([step]), variables={})
    engine.run()
    assert step.status == StepStatus.SKIPPED


def test_not_exists_condition():
    step = Step(id="s", name="S", action="s.run",
                condition={"not_exists": {"var": "debug"}})
    engine = _engine(_wf([step]), variables={})
    engine.run()
    assert step.status == StepStatus.SUCCESS


# ---------------------------------------------------------------------------
# 9. not_equals / not_in conditions
# ---------------------------------------------------------------------------

def test_not_equals_condition():
    step = Step(id="s", name="S", action="s.run",
                condition={"not_equals": {"var": "env", "value": "production"}})
    engine = _engine(_wf([step]), variables={"env": "staging"})
    engine.run()
    assert step.status == StepStatus.SUCCESS


def test_not_in_condition_skips_when_in_list():
    step = Step(id="s", name="S", action="s.run",
                condition={"not_in": {"var": "env", "values": ["prod", "staging"]}})
    engine = _engine(_wf([step]), variables={"env": "prod"})
    engine.run()
    assert step.status == StepStatus.SKIPPED


# ---------------------------------------------------------------------------
# 10. Skipped steps are NOT rolled back
# ---------------------------------------------------------------------------

def test_skipped_steps_not_rolled_back():
    skipped = Step(id="a", name="A", action="a.run",
                   condition={"equals": {"var": "x", "value": "yes"}})
    ran = Step(id="b", name="B", action="b.run", depends_on=["a"])
    engine = _engine(_wf([skipped, ran]), variables={"x": "no"})
    engine.run()

    before = len(engine.audit)
    engine.rollback()

    # Only 'b' should appear in rollback (a was skipped, never executed)
    rollback_entries = [
        e for e in engine.audit.entries() if e.event == "step_rollback"
    ]
    rolled_ids = [e.step_id for e in rollback_entries]
    assert "b" in rolled_ids
    assert "a" not in rolled_ids