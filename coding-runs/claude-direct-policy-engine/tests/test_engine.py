"""
Tests for WorkflowEngine, ExecutionContext, PolicyEngine, AuditLog, RollbackManager.

Includes the regression test for the "skipped-blocks-dependents" bug
(see CHANGELOG.md).
"""
from __future__ import annotations

import pytest

from policy_engine.audit import AuditLog
from policy_engine.engine import ExecutionContext, StepResult, WorkflowEngine
from policy_engine.models import (
    ConditionExpr,
    PolicyGate,
    Step,
    StepStatus,
    WorkflowDefinition,
)
from policy_engine.permissions import PermissionModel
from policy_engine.policy import DEFAULT_GATES, PolicyEngine, PolicyMode, PolicyViolation
from policy_engine.rollback import RollbackManager


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_wf(*steps: Step) -> WorkflowDefinition:
    return WorkflowDefinition(name="test-wf", version="0.1", steps=list(steps))


def _step(
    sid: str,
    action: str = "build",
    depends_on=None,
    gate=None,
    env: str = "development",
    condition=None,
) -> Step:
    return Step(
        id          = sid,
        name        = sid.capitalize(),
        action      = action,
        depends_on  = depends_on or [],
        policy_gate = gate,
        environment = env,
        condition   = condition,
    )


def _cond(op: str, var: str, value=None) -> ConditionExpr:
    return ConditionExpr(operator=op, var=var, value=value)


def _engine(
    workflow: WorkflowDefinition,
    role: str = "developer",
    mode: PolicyMode = PolicyMode.ENFORCED,
    ctx: ExecutionContext | None = None,
) -> tuple[WorkflowEngine, AuditLog]:
    audit  = AuditLog()
    perms  = PermissionModel.from_defaults(role)
    policy = PolicyEngine(DEFAULT_GATES, perms, role, mode=mode)
    eng    = WorkflowEngine(workflow, policy, audit, context=ctx)
    return eng, audit


def _statuses(results) -> dict:
    return {r.step.id: r.status for r in results}


# ---------------------------------------------------------------------------
# AuditLog — append-only invariant
# ---------------------------------------------------------------------------

def test_audit_log_append_only():
    log = AuditLog()
    log.record("event_a", x=1)
    log.record("event_b", x=2)
    snapshot = log.entries()
    assert len(snapshot) == 2
    snapshot.clear()
    assert len(log) == 2


def test_audit_entries_snapshot_is_independent():
    log = AuditLog()
    log.record("evt", key="original")
    snap = log.entries()
    snap[0]["key"] = "mutated"
    assert log.entries()[0]["key"] == "original"


# ---------------------------------------------------------------------------
# PolicyEngine
# ---------------------------------------------------------------------------

def test_policy_gate_blocks_insufficient_role():
    perms  = PermissionModel.from_defaults("developer")
    policy = PolicyEngine(DEFAULT_GATES, perms, "developer")
    step   = _step("deploy-prod", action="deploy", gate="production-gate", env="production")
    with pytest.raises(PolicyViolation, match="not permitted"):
        policy.check(step)


def test_policy_gate_passes_for_allowed_role():
    perms  = PermissionModel.from_defaults("deployer")
    policy = PolicyEngine(DEFAULT_GATES, perms, "deployer")
    step   = _step("deploy-staging", action="deploy", gate="staging-gate", env="staging")
    policy.check(step)  # must not raise


def test_production_gate_not_granted_to_developer():
    perms = PermissionModel.from_defaults("developer")
    assert not perms.can_pass_gate("developer", "production-gate")


# ---------------------------------------------------------------------------
# WorkflowEngine — basic linear execution
# ---------------------------------------------------------------------------

def test_successful_linear_workflow():
    wf  = _make_wf(
        _step("lint",  action="lint"),
        _step("test",  action="test",  depends_on=["lint"]),
        _step("build", action="build", depends_on=["test"]),
    )
    eng, _ = _engine(wf)
    st = _statuses(eng.run())
    assert st["lint"]  == StepStatus.SUCCESS
    assert st["test"]  == StepStatus.SUCCESS
    assert st["build"] == StepStatus.SUCCESS


def test_failed_step_blocks_dependents():
    """invariant_failed_step_blocks_dependents holds for policy failures."""
    wf  = _make_wf(
        _step("deploy", action="deploy", gate="production-gate", env="production"),
        _step("notify", action="notify", depends_on=["deploy"]),
    )
    eng, audit = _engine(wf, role="developer")
    st = _statuses(eng.run())
    assert st["deploy"] == StepStatus.FAILED
    assert st["notify"] == StepStatus.BLOCKED

    events = [e["event"] for e in audit.entries()]
    assert "step_policy_violation" in events
    assert "step_blocked" in events


def test_audit_records_workflow_lifecycle():
    wf = _make_wf(_step("build", action="build"))
    eng, audit = _engine(wf)
    eng.run()
    events = [e["event"] for e in audit.entries()]
    assert "workflow_start" in events
    assert "step_start"     in events
    assert "step_end"       in events
    assert "workflow_end"   in events


# ---------------------------------------------------------------------------
# REGRESSION TEST — "skipped-blocks-dependents" bug
# See CHANGELOG.md for full description.
# ---------------------------------------------------------------------------

def test_skipped_step_does_not_block_direct_dependent():
    """
    Regression: a step whose condition evaluates to False is SKIPPED.
    Its direct dependent must still run (SKIPPED ≠ failure).

    This test would FAIL on the buggy code where SKIPPED was treated the same
    as FAILED for dependency propagation purposes.
    """
    cond = _cond("equals", "environment", "production")
    wf   = _make_wf(
        # This step is optional — only runs in production
        _step("optional-scan", action="scan", condition=cond),
        # This step must ALWAYS run, regardless of whether the scan ran
        _step("build",         action="build", depends_on=["optional-scan"]),
    )
    ctx = ExecutionContext({"environment": "staging"})  # condition → False
    eng, audit = _engine(wf, ctx=ctx)
    results = eng.run()
    st = _statuses(results)

    assert st["optional-scan"] == StepStatus.SKIPPED, (
        "Step with false condition should be SKIPPED"
    )
    assert st["build"] == StepStatus.SUCCESS, (
        "Dependent of a SKIPPED step must not be blocked — it should run normally"
    )


def test_skipped_step_does_not_block_transitive_dependents():
    """
    Regression (transitive): skip → child → grandchild
    All of child and grandchild must run when the root is skipped.
    """
    cond = _cond("equals", "deploy_env", "production")
    wf   = _make_wf(
        _step("gate-check", action="approve", condition=cond),
        _step("package",    action="package", depends_on=["gate-check"]),
        _step("notify",     action="notify",  depends_on=["package"]),
    )
    ctx = ExecutionContext({"deploy_env": "staging"})  # gate-check → SKIPPED
    eng, _ = _engine(wf, ctx=ctx)
    st = _statuses(eng.run())

    assert st["gate-check"] == StepStatus.SKIPPED
    assert st["package"]    == StepStatus.SUCCESS, "package must run after a skipped predecessor"
    assert st["notify"]     == StepStatus.SUCCESS, "notify must run after a skipped chain"


def test_skipped_not_added_to_hard_failed_set():
    """
    Whitebox: after running, no SKIPPED step's id should appear
    in the set that blocks dependents.  We verify this indirectly by
    checking that a downstream step succeeds.
    """
    cond = _cond("not_equals", "tier", "free")
    wf   = _make_wf(
        _step("premium-deploy", action="deploy", condition=cond),
        _step("send-receipt",   action="notify", depends_on=["premium-deploy"]),
    )
    ctx = ExecutionContext({"tier": "free"})   # condition → False → SKIP
    eng, audit = _engine(wf, ctx=ctx)
    results = eng.run()
    st = _statuses(results)

    assert st["premium-deploy"] == StepStatus.SKIPPED
    assert st["send-receipt"]   == StepStatus.SUCCESS

    # Audit must contain a skipped entry, and no blocked entry
    events = [e["event"] for e in audit.entries()]
    assert "step_skipped"  in events
    assert "step_blocked"  not in events


def test_skipped_audit_records_reason():
    """Audit entry for a skipped step must include reason='condition not met'."""
    cond = _cond("equals", "env", "production")
    wf   = _make_wf(_step("opt", action="scan", condition=cond))
    ctx  = ExecutionContext({"env": "staging"})
    eng, audit = _engine(wf, ctx=ctx)
    eng.run()

    skipped_entries = [e for e in audit.entries() if e["event"] == "step_skipped"]
    assert skipped_entries, "Expected a step_skipped audit entry"
    assert skipped_entries[0]["reason"] == "condition not met"
    assert skipped_entries[0]["step_id"] == "opt"


def test_mixed_skipped_and_failed_dependents():
    """
    Diamond topology:
        root (skipped)
        ├── left  (depends on root, no gate → should RUN)
        └── right (depends on root, production-gate, developer role → FAIL)
        └── final (depends on left + right → BLOCKED because right fails)
    """
    cond = _cond("equals", "env", "production")
    wf   = _make_wf(
        _step("root",  action="approve",  condition=cond),
        _step("left",  action="build",    depends_on=["root"]),
        _step("right", action="deploy",   depends_on=["root"],
              gate="production-gate", env="production"),
        _step("final", action="notify",   depends_on=["left", "right"]),
    )
    ctx = ExecutionContext({"env": "staging"})  # root → SKIPPED
    eng, _ = _engine(wf, role="developer", ctx=ctx)
    st = _statuses(eng.run())

    assert st["root"]  == StepStatus.SKIPPED   # condition false
    assert st["left"]  == StepStatus.SUCCESS    # root skipped ≠ failed → left runs
    assert st["right"] == StepStatus.FAILED     # developer denied production-gate
    assert st["final"] == StepStatus.BLOCKED    # right failed → final blocked


def test_all_conditions_false_no_step_blocked():
    """
    When every step has a false condition the entire workflow is SKIPPED
    and no step should be BLOCKED (all skipped, none failed).
    """
    cond = _cond("equals", "trigger", "never")
    wf   = _make_wf(
        _step("a", condition=cond),
        _step("b", condition=cond, depends_on=["a"]),
        _step("c", condition=cond, depends_on=["b"]),
    )
    ctx = ExecutionContext({})  # "trigger" absent → condition false
    eng, audit = _engine(wf, ctx=ctx)
    results = eng.run()
    st = _statuses(results)

    assert all(s == StepStatus.SKIPPED for s in st.values()), (
        f"All steps should be SKIPPED, got: {st}"
    )

    events = [e["event"] for e in audit.entries()]
    assert "step_blocked" not in events


def test_all_conditions_true_all_steps_succeed():
    """All conditions true → all steps succeed (no skips, no blocks)."""
    cond = _cond("equals", "env", "production")
    wf   = _make_wf(
        _step("a", condition=cond),
        _step("b", condition=cond, depends_on=["a"]),
    )
    ctx = ExecutionContext({"env": "production"})
    eng, _ = _engine(wf, ctx=ctx)
    st = _statuses(eng.run())

    assert st["a"] == StepStatus.SUCCESS
    assert st["b"] == StepStatus.SUCCESS


def test_condition_in_operator_skips_when_false():
    """'in' operator with context value not in list → SKIP."""
    cond = _cond("in", "tier", ["gold", "platinum"])
    wf   = _make_wf(
        _step("premium", action="deploy", condition=cond),
        _step("receipt", action="notify", depends_on=["premium"]),
    )
    ctx = ExecutionContext({"tier": "bronze"})
    eng, _ = _engine(wf, ctx=ctx)
    st = _statuses(eng.run())

    assert st["premium"] == StepStatus.SKIPPED
    assert st["receipt"] == StepStatus.SUCCESS


# ---------------------------------------------------------------------------
# Rollback — invariants
# ---------------------------------------------------------------------------

def test_rollback_audited_preserves_history():
    """invariant_rollback_preserves_audit — original entries survive rollback."""
    wf  = _make_wf(
        _step("build",  action="build"),
        _step("deploy", action="deploy", depends_on=["build"]),
    )
    eng, audit = _engine(wf)
    results    = eng.run()
    count_before = len(audit)

    RollbackManager(audit).rollback(results, reason="test rollback")

    assert len(audit) > count_before
    events = [e["event"] for e in audit.entries()]
    # Original execution events still present
    assert "step_start"     in events
    assert "step_end"       in events
    # Rollback events appended (not replacing)
    assert "rollback_start" in events
    assert "rollback_step"  in events
    assert "rollback_end"   in events


def test_rollback_does_not_roll_back_skipped_steps():
    """
    Skipped steps never executed, so rollback must not attempt to reverse them.
    Only successful steps appear in the rollback list.
    """
    cond = _cond("equals", "env", "production")
    wf   = _make_wf(
        _step("opt",   action="scan",  condition=cond),
        _step("build", action="build", depends_on=["opt"]),
    )
    ctx = ExecutionContext({"env": "staging"})
    eng, audit = _engine(wf, ctx=ctx)
    results = eng.run()

    st = _statuses(results)
    assert st["opt"]   == StepStatus.SKIPPED
    assert st["build"] == StepStatus.SUCCESS

    RollbackManager(audit).rollback(results, reason="test")

    rollback_entries = [e for e in audit.entries() if e["event"] == "rollback_step"]
    rolled_back_ids = {e["step_id"] for e in rollback_entries}

    assert "build" in rolled_back_ids,  "build (successful) must be rolled back"
    assert "opt"   not in rolled_back_ids, "opt (skipped) must NOT be rolled back"


# ---------------------------------------------------------------------------
# PermissionModel
# ---------------------------------------------------------------------------

def test_permission_grant_revoke():
    perms = PermissionModel()
    assert not perms.can_pass_gate("qa", "test-gate")
    perms.grant("qa", "test-gate")
    assert perms.can_pass_gate("qa", "test-gate")
    perms.revoke("qa", "test-gate")
    assert not perms.can_pass_gate("qa", "test-gate")


# ---------------------------------------------------------------------------
# Permissive mode
# ---------------------------------------------------------------------------

def test_permissive_mode_overrides_and_audits():
    wf  = _make_wf(
        _step("prod", action="deploy", gate="production-gate", env="production")
    )
    eng, audit = _engine(wf, role="developer", mode=PolicyMode.PERMISSIVE)
    results = eng.run()

    assert results[0].status == StepStatus.SUCCESS
    overrides = [e for e in audit.entries() if e["event"] == "policy_overridden"]
    assert len(overrides) == 1
    assert "OVERRIDDEN" in overrides[0]["reason"]