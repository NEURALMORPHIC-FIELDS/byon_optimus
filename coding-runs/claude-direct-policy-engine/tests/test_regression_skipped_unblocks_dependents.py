"""
Regression tests for Phase-4 bug:

    A workflow with a SKIPPED optional step causes downstream steps to
    FAIL (or BLOCK) incorrectly.

Root cause
----------
``_BLOCKING`` must not contain ``StepStatus.SKIPPED``.  If it did (or if
``deps_satisfied`` treated SKIPPED as "not satisfied"), any step whose
predecessor was skipped via a false condition would be incorrectly treated
as having a failed dependency and be blocked/failed itself.

These tests are written in the *"proves the bug then proves the fix"* style:
  - The comment "BUG REPRODUCTION" marks what *used* to go wrong.
  - Each assertion documents the correct post-fix behaviour.

All tests in this file must pass on the fixed codebase and would have
FAILED on the pre-fix codebase.
"""
from __future__ import annotations

import pytest

from policy_engine.audit import AuditLog
from policy_engine.engine import (
    ExecutionContext,
    WorkflowEngine,
    _BLOCKING,
    _SATISFIED,
)
from policy_engine.models import Step, StepStatus, Workflow
from policy_engine.policy import PermissionModel, PolicyGate, PolicyMode
from policy_engine.planner import (
    Planner,
    PlanValidator,
    StepDecision,
)


# ── helpers ───────────────────────────────────────────────────────────────────


def _make_engine() -> tuple[WorkflowEngine, AuditLog]:
    audit = AuditLog()
    perm = PermissionModel.default()
    gate = PolicyGate(perm, mode=PolicyMode.ENFORCED, audit=audit)
    return WorkflowEngine(audit, gate), audit


def _run(steps: list[Step], role: str = "deployer",
         run_vars: dict | None = None) -> tuple[dict, WorkflowEngine, AuditLog]:
    engine, audit = _make_engine()
    wf = Workflow(id="wf_regression", name="Regression WF", steps=steps)
    statuses = engine.run(wf, role, run_vars=run_vars)
    return statuses, engine, audit


# ─────────────────────────────────────────────────────────────────────────────
# Part 1 — Module-level invariant: sets are disjoint
# ─────────────────────────────────────────────────────────────────────────────


def test_satisfied_and_blocking_sets_are_disjoint():
    """_SATISFIED and _BLOCKING must never share a member.

    BUG REPRODUCTION: if SKIPPED appeared in _BLOCKING this assertion fails.
    """
    assert _SATISFIED.isdisjoint(_BLOCKING), (
        "_SATISFIED and _BLOCKING share elements — SKIPPED must not be in _BLOCKING"
    )


def test_skipped_is_in_satisfied_not_blocking():
    """SKIPPED must be treated as a satisfied terminal state."""
    assert StepStatus.SKIPPED in _SATISFIED
    assert StepStatus.SKIPPED not in _BLOCKING


def test_failed_is_in_blocking_not_satisfied():
    assert StepStatus.FAILED in _BLOCKING
    assert StepStatus.FAILED not in _SATISFIED


def test_success_is_in_satisfied_not_blocking():
    assert StepStatus.SUCCESS in _SATISFIED
    assert StepStatus.SUCCESS not in _BLOCKING


# ─────────────────────────────────────────────────────────────────────────────
# Part 2 — ExecutionContext predicate unit tests
# ─────────────────────────────────────────────────────────────────────────────


def _make_ctx(steps: list[Step],
              statuses: dict[str, StepStatus]) -> ExecutionContext:
    audit = AuditLog()
    perm = PermissionModel.default()
    gate = PolicyGate(perm)
    wf = Workflow(id="wf", name="wf", steps=steps)
    ctx = ExecutionContext(wf, "deployer", audit, gate, {})
    for sid, st in statuses.items():
        ctx._status[sid] = st
    return ctx


def test_deps_satisfied_when_dep_is_skipped():
    """
    BUG REPRODUCTION: before the fix, deps_satisfied returned False when
    a predecessor was SKIPPED because SKIPPED was not in _SATISFIED.
    """
    upstream = Step(id="up", name="up", action="build")
    downstream = Step(id="down", name="down", action="test", depends_on=["up"])
    ctx = _make_ctx([upstream, downstream],
                    {"up": StepStatus.SKIPPED, "down": StepStatus.PENDING})
    # Must be True — skipped predecessor is satisfied
    assert ctx.deps_satisfied(downstream) is True


def test_deps_satisfied_when_dep_is_success():
    upstream = Step(id="up", name="up", action="build")
    downstream = Step(id="down", name="down", action="test", depends_on=["up"])
    ctx = _make_ctx([upstream, downstream],
                    {"up": StepStatus.SUCCESS, "down": StepStatus.PENDING})
    assert ctx.deps_satisfied(downstream) is True


def test_deps_not_satisfied_when_dep_is_pending():
    upstream = Step(id="up", name="up", action="build")
    downstream = Step(id="down", name="down", action="test", depends_on=["up"])
    ctx = _make_ctx([upstream, downstream],
                    {"up": StepStatus.PENDING, "down": StepStatus.PENDING})
    assert ctx.deps_satisfied(downstream) is False


def test_deps_not_satisfied_when_dep_is_running():
    upstream = Step(id="up", name="up", action="build")
    downstream = Step(id="down", name="down", action="test", depends_on=["up"])
    ctx = _make_ctx([upstream, downstream],
                    {"up": StepStatus.RUNNING, "down": StepStatus.PENDING})
    assert ctx.deps_satisfied(downstream) is False


def test_any_dep_blocking_false_when_dep_is_skipped():
    """
    BUG REPRODUCTION: before the fix, if SKIPPED were in _BLOCKING this
    would incorrectly return True and prevent the downstream from running.
    """
    upstream = Step(id="up", name="up", action="build")
    downstream = Step(id="down", name="down", action="test", depends_on=["up"])
    ctx = _make_ctx([upstream, downstream],
                    {"up": StepStatus.SKIPPED, "down": StepStatus.PENDING})
    # Must be False — skipped predecessor does not block dependents
    assert ctx.any_dep_blocking(downstream) is False


def test_any_dep_blocking_true_when_dep_is_failed():
    upstream = Step(id="up", name="up", action="build")
    downstream = Step(id="down", name="down", action="test", depends_on=["up"])
    ctx = _make_ctx([upstream, downstream],
                    {"up": StepStatus.FAILED, "down": StepStatus.PENDING})
    assert ctx.any_dep_blocking(downstream) is True


def test_any_dep_blocking_true_when_dep_is_blocked():
    upstream = Step(id="up", name="up", action="build")
    downstream = Step(id="down", name="down", action="test", depends_on=["up"])
    ctx = _make_ctx([upstream, downstream],
                    {"up": StepStatus.BLOCKED, "down": StepStatus.PENDING})
    assert ctx.any_dep_blocking(downstream) is True


def test_any_dep_blocking_false_when_dep_is_success():
    upstream = Step(id="up", name="up", action="build")
    downstream = Step(id="down", name="down", action="test", depends_on=["up"])
    ctx = _make_ctx([upstream, downstream],
                    {"up": StepStatus.SUCCESS, "down": StepStatus.PENDING})
    assert ctx.any_dep_blocking(downstream) is False


# ─────────────────────────────────────────────────────────────────────────────
# Part 3 — End-to-end engine regression tests
# ─────────────────────────────────────────────────────────────────────────────


def test_downstream_runs_when_upstream_skipped_by_condition():
    """
    Core regression: upstream is skipped (condition false) → downstream
    must run, not be blocked or failed.

    BUG REPRODUCTION: on the buggy code this test produced
        statuses["downstream"] == StepStatus.BLOCKED  (or FAILED)
    which is wrong.  After the fix it must be SUCCESS.
    """
    steps = [
        Step(
            id="optional",
            name="Optional deploy",
            action="deploy",
            policy_gate="deploy_gate",
            condition={"equals": {"var": "env", "value": "production"}},
        ),
        Step(
            id="notify",
            name="Notify",
            action="notify",
            depends_on=["optional"],
        ),
    ]
    # env=staging → condition false → optional is SKIPPED
    statuses, *_ = _run(steps, role="deployer",
                        run_vars={"env": "staging"})

    assert statuses["optional"] == StepStatus.SKIPPED, (
        "optional step should be SKIPPED when condition is false"
    )
    # BUG: was BLOCKED/FAILED before fix
    assert statuses["notify"] == StepStatus.SUCCESS, (
        "notify should run normally when its only dependency was SKIPPED"
    )


def test_chained_skips_allow_terminal_step_to_run():
    """
    Chain: A (skipped) → B (skipped) → C (no condition, must run).

    BUG REPRODUCTION: C was BLOCKED because B was SKIPPED, and B was
    BLOCKED because A was SKIPPED.
    """
    false_cond = {"equals": {"var": "x", "value": "never"}}
    steps = [
        Step(id="a", name="A", action="build", condition=false_cond),
        Step(id="b", name="B", action="test",
             depends_on=["a"], condition=false_cond),
        Step(id="c", name="C", action="notify", depends_on=["b"]),
    ]
    statuses, *_ = _run(steps, role="deployer", run_vars={})

    assert statuses["a"] == StepStatus.SKIPPED
    assert statuses["b"] == StepStatus.SKIPPED
    # BUG: was BLOCKED before fix
    assert statuses["c"] == StepStatus.SUCCESS


def test_mixed_skip_and_success_deps_all_satisfied():
    """
    Step D depends on both B (skipped) and C (success).
    D must run because all its deps are in _SATISFIED.
    """
    false_cond = {"equals": {"var": "flag", "value": "yes"}}
    steps = [
        Step(id="b", name="B", action="build", condition=false_cond),
        Step(id="c", name="C", action="test"),
        Step(id="d", name="D", action="notify", depends_on=["b", "c"]),
    ]
    statuses, *_ = _run(steps, role="deployer", run_vars={"flag": "no"})

    assert statuses["b"] == StepStatus.SKIPPED
    assert statuses["c"] == StepStatus.SUCCESS
    assert statuses["d"] == StepStatus.SUCCESS


def test_failed_dep_still_blocks_even_with_skipped_sibling():
    """
    Negative control: if one dep FAILS and another is SKIPPED, the
    downstream must still be BLOCKED (FAILED dep takes priority).
    """
    false_cond = {"equals": {"var": "flag", "value": "yes"}}
    steps = [
        Step(id="optional", name="Opt", action="build", condition=false_cond),
        Step(id="required", name="Req", action="test",
             params={"simulate_failure": True}),
        Step(id="downstream", name="Down", action="notify",
             depends_on=["optional", "required"]),
    ]
    statuses, *_ = _run(steps, role="deployer", run_vars={"flag": "no"})

    assert statuses["optional"] == StepStatus.SKIPPED
    assert statuses["required"] == StepStatus.FAILED
    # FAILED dep must still block downstream
    assert statuses["downstream"] == StepStatus.BLOCKED


def test_skipped_step_not_added_to_executed_list():
    """Skipped steps must not appear in engine._executed (rollback list)."""
    false_cond = {"equals": {"var": "x", "value": "never"}}
    steps = [
        Step(id="skip_me", name="Skip", action="build", condition=false_cond),
        Step(id="run_me", name="Run", action="test", depends_on=["skip_me"]),
    ]
    _, engine, _ = _run(steps, role="deployer", run_vars={})

    executed_ids = [s.id for s in engine._executed]
    assert "skip_me" not in executed_ids
    assert "run_me" in executed_ids


def test_skipped_produces_audit_entry_not_blocked():
    """
    Audit log must contain step_skipped for the skipped step and
    step_success for the downstream — NOT step_blocked.

    BUG REPRODUCTION: audit contained step_blocked for the downstream.
    """
    false_cond = {"equals": {"var": "env", "value": "prod"}}
    steps = [
        Step(id="gate", name="Gate", action="deploy",
             policy_gate="deploy_gate", condition=false_cond),
        Step(id="after", name="After", action="notify", depends_on=["gate"]),
    ]
    _, _, audit = _run(steps, role="deployer", run_vars={"env": "staging"})

    events = [e["event"] for e in audit.entries()]
    assert "step_skipped" in events
    assert "step_success" in events
    # BUG: this was present before the fix
    assert "step_blocked" not in events


def test_all_true_conditions_still_run():
    """Positive control: when all conditions are true everything runs."""
    true_cond = {"equals": {"var": "env", "value": "prod"}}
    steps = [
        Step(id="a", name="A", action="build", condition=true_cond),
        Step(id="b", name="B", action="test",
             depends_on=["a"], condition=true_cond),
        Step(id="c", name="C", action="notify", depends_on=["b"]),
    ]
    statuses, *_ = _run(steps, role="deployer", run_vars={"env": "prod"})

    assert statuses["a"] == StepStatus.SUCCESS
    assert statuses["b"] == StepStatus.SUCCESS
    assert statuses["c"] == StepStatus.SUCCESS


# ─────────────────────────────────────────────────────────────────────────────
# Part 4 — Planner regression: SKIP must not propagate as blocking
# ─────────────────────────────────────────────────────────────────────────────


def _make_planner(mode: PolicyMode = PolicyMode.ENFORCED) -> Planner:
    perm = PermissionModel.default()
    gate = PolicyGate(perm, mode=mode)
    return Planner(gate)


def test_planner_downstream_is_run_when_upstream_skipped():
    """
    Planner must predict RUN for a step whose only dependency is predicted
    to be SKIP.

    BUG REPRODUCTION: planner predicted BLOCK for downstream when upstream
    was SKIP because StepDecision.SKIP was absent from the non-blocking set
    in _plan_step.
    """
    false_cond = {"equals": {"var": "env", "value": "prod"}}
    steps = [
        Step(id="optional", name="Opt", action="deploy",
             policy_gate="deploy_gate", condition=false_cond),
        Step(id="notify", name="Notify", action="notify",
             depends_on=["optional"]),
    ]
    wf = Workflow(id="wf", name="wf", steps=steps)
    planner = _make_planner()
    plan = planner.build(wf, role="deployer", run_vars={"env": "staging"})

    step_map = {sp.step.id: sp for sp in plan.steps}
    assert step_map["optional"].decision == StepDecision.SKIP
    # BUG: was BLOCK before fix
    assert step_map["notify"].decision == StepDecision.RUN


def test_planner_chained_skips_terminal_step_is_run():
    false_cond = {"equals": {"var": "x", "value": "never"}}
    steps = [
        Step(id="a", name="A", action="build", condition=false_cond),
        Step(id="b", name="B", action="test",
             depends_on=["a"], condition=false_cond),
        Step(id="c", name="C", action="notify", depends_on=["b"]),
    ]
    wf = Workflow(id="wf", name="wf", steps=steps)
    planner = _make_planner()
    plan = planner.build(wf, role="deployer", run_vars={})

    step_map = {sp.step.id: sp for sp in plan.steps}
    assert step_map["a"].decision == StepDecision.SKIP
    assert step_map["b"].decision == StepDecision.SKIP
    assert step_map["c"].decision == StepDecision.RUN


def test_planner_validation_no_errors_for_skipped_chain():
    """PlanValidator must not raise errors for an all-skip chain with a
    running terminal step."""
    false_cond = {"equals": {"var": "x", "value": "never"}}
    steps = [
        Step(id="a", name="A", action="build", condition=false_cond),
        Step(id="b", name="B", action="notify", depends_on=["a"]),
    ]
    wf = Workflow(id="wf", name="wf", steps=steps)
    planner = _make_planner()
    plan = planner.build(wf, role="deployer", run_vars={})
    result = PlanValidator().validate(plan)

    errors = result.errors
    assert errors == [], f"Expected no errors, got: {errors}"
    assert result.valid


def test_planner_summary_counts_skips_correctly():
    false_cond = {"equals": {"var": "x", "value": "never"}}
    steps = [
        Step(id="a", name="A", action="build", condition=false_cond),
        Step(id="b", name="B", action="test",
             depends_on=["a"], condition=false_cond),
        Step(id="c", name="C", action="notify", depends_on=["b"]),
    ]
    wf = Workflow(id="wf", name="wf", steps=steps)
    planner = _make_planner()
    plan = planner.build(wf, role="deployer", run_vars={})

    assert plan.skip_count == 2
    assert plan.run_count == 1
    assert plan.block_count == 0
    assert plan.deny_count == 0