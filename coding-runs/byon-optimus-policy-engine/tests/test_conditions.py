"""Tests for conditional step execution — all branches per spec."""
from __future__ import annotations
import pytest

from policy_engine.models import (
    WorkflowDefinition,
    WorkflowStep,
    StepCondition,
)
from policy_engine.planner import build_plan
from policy_engine.engine import PolicyEngine, ExecutionContext
from policy_engine.audit import AuditLog
from policy_engine.conditions import evaluate_condition, ConditionError


# ── helpers ───────────────────────────────────────────────────────────────────

def make_wf(*steps: WorkflowStep) -> WorkflowDefinition:
    return WorkflowDefinition(name="cond-test", steps=list(steps))


def cond_step(
    name: str,
    *,
    depends_on: list[str] | None = None,
    condition: StepCondition | None = None,
    gates: list[str] | None = None,
    env: str = "dev",
) -> WorkflowStep:
    return WorkflowStep(
        name=name,
        action="noop",
        depends_on=depends_on or [],
        policy_gates=gates or [],
        environment=env,
        condition=condition,
    )


def eq_cond(var: str, value: object) -> StepCondition:
    return StepCondition(operator="equals", var=var, value=value)


# ── evaluate_condition unit tests ─────────────────────────────────────────────

def test_evaluate_equals_true():
    cond = eq_cond("environment", "production")
    assert evaluate_condition(cond, {"environment": "production"}) is True


def test_evaluate_equals_false():
    cond = eq_cond("environment", "production")
    assert evaluate_condition(cond, {"environment": "staging"}) is False


def test_evaluate_missing_var_is_false():
    """A variable not present in context evaluates to None, which != any value."""
    cond = eq_cond("environment", "production")
    assert evaluate_condition(cond, {}) is False


def test_evaluate_unknown_operator_raises():
    cond = StepCondition(operator="gt", var="count", value=5)
    with pytest.raises(ConditionError, match="Unknown condition operator"):
        evaluate_condition(cond, {"count": 10})


# ── No condition → step runs normally ─────────────────────────────────────────

def test_no_condition_step_runs():
    wf = make_wf(cond_step("build"))
    plan = build_plan(wf)
    engine = PolicyEngine(role="developer")
    results = engine.run(plan)
    assert results["build"] == "success"


# ── Condition true → step runs ────────────────────────────────────────────────

def test_condition_true_step_runs():
    wf = make_wf(
        cond_step("deploy", condition=eq_cond("environment", "production")),
    )
    plan = build_plan(wf)
    engine = PolicyEngine(role="developer")
    results = engine.run(plan, variables={"environment": "production"})
    assert results["deploy"] == "success"


# ── Condition false → step skipped ───────────────────────────────────────────

def test_condition_false_step_skipped():
    wf = make_wf(
        cond_step("deploy", condition=eq_cond("environment", "production")),
    )
    plan = build_plan(wf)
    engine = PolicyEngine(role="developer")
    results = engine.run(plan, variables={"environment": "staging"})
    assert results["deploy"] == "skipped:condition_not_met"


def test_condition_false_audit_records_reason():
    """Audit log must record SKIPPED with reason 'condition_not_met'."""
    wf = make_wf(
        cond_step("deploy", condition=eq_cond("environment", "production")),
    )
    plan = build_plan(wf)
    audit = AuditLog()
    engine = PolicyEngine(audit=audit, role="developer")
    engine.run(plan, variables={"environment": "staging"})

    skipped_entries = [
        e for e in audit.entries
        if e.event == "SKIPPED" and e.step == "deploy"
    ]
    assert len(skipped_entries) == 1
    assert skipped_entries[0].details["reason"] == "condition_not_met"


# ── Skipped step does NOT block dependents ────────────────────────────────────

def test_condition_skipped_does_not_block_dependent():
    """Spec: skipped (condition) is treated as 'satisfied' for ordering."""
    wf = make_wf(
        cond_step("deploy", condition=eq_cond("environment", "production")),
        cond_step("notify", depends_on=["deploy"]),
    )
    plan = build_plan(wf)
    engine = PolicyEngine(role="developer")
    results = engine.run(plan, variables={"environment": "staging"})
    assert results["deploy"] == "skipped:condition_not_met"
    assert results["notify"] == "success"


def test_condition_skipped_reflected_in_context():
    """ExecutionContext.was_condition_skipped must return True for skipped steps."""
    wf = make_wf(
        cond_step("deploy", condition=eq_cond("environment", "production")),
    )
    plan = build_plan(wf)
    audit = AuditLog()
    engine = PolicyEngine(audit=audit, role="developer")

    # Run and inspect context indirectly via audit entries.
    results = engine.run(plan, variables={"environment": "staging"})
    assert results["deploy"] == "skipped:condition_not_met"

    # Verify audit captured condition details.
    skipped = [e for e in audit.entries if e.event == "SKIPPED" and e.step == "deploy"]
    assert skipped[0].details["condition_var"] == "environment"
    assert skipped[0].details["condition_value"] == "production"
    assert skipped[0].details["actual_value"] == "staging"


# ── All conditions true ───────────────────────────────────────────────────────

def test_all_conditions_true():
    wf = make_wf(
        cond_step("build"),
        cond_step("check", depends_on=["build"], condition=eq_cond("run_tests", True)),
        cond_step("deploy", depends_on=["check"], condition=eq_cond("environment", "production")),
    )
    plan = build_plan(wf)
    engine = PolicyEngine(role="developer")
    results = engine.run(plan, variables={"run_tests": True, "environment": "production"})
    assert results["build"] == "success"
    assert results["check"] == "success"
    assert results["deploy"] == "success"


# ── All conditions false ──────────────────────────────────────────────────────

def test_all_conditions_false():
    wf = make_wf(
        cond_step("build", condition=eq_cond("run_build", True)),
        cond_step("check", depends_on=["build"], condition=eq_cond("run_tests", True)),
        cond_step("deploy", depends_on=["check"], condition=eq_cond("environment", "production")),
    )
    plan = build_plan(wf)
    engine = PolicyEngine(role="developer")
    results = engine.run(plan, variables={})
    assert results["build"] == "skipped:condition_not_met"
    assert results["check"] == "skipped:condition_not_met"
    assert results["deploy"] == "skipped:condition_not_met"


# ── P5 REGRESSION: skipped optional step must not block downstream steps ──────

def test_p5_skipped_optional_does_not_fail_downstream():
    """Regression (P5): a condition-skipped step must NOT cause downstream steps
    to be treated as having a failed predecessor.

    Topology: build → optional-notify (skipped) → final-report
    Expected: final-report runs successfully despite optional-notify being skipped.

    Before the fix, optional-notify was incorrectly added to the blocked set,
    causing final-report to receive status 'skipped' (blocked_dependency).
    """
    wf = make_wf(
        cond_step("build"),
        cond_step(
            "optional-notify",
            depends_on=["build"],
            condition=eq_cond("notify_enabled", True),
        ),
        cond_step("final-report", depends_on=["optional-notify"]),
    )
    plan = build_plan(wf)
    engine = PolicyEngine(role="developer")
    # notify_enabled is False → optional-notify is skipped
    results = engine.run(plan, variables={"notify_enabled": False})

    assert results["build"] == "success"
    assert results["optional-notify"] == "skipped:condition_not_met"
    # final-report must run, not be blocked
    assert results["final-report"] == "success"


def test_p5_skipped_step_audit_does_not_show_blocked_dependency():
    """Regression (P5): audit log must NOT contain a blocked_dependency entry
    for a step whose only skipped predecessor was condition-skipped (not failed).
    """
    wf = make_wf(
        cond_step("build"),
        cond_step(
            "optional-notify",
            depends_on=["build"],
            condition=eq_cond("notify_enabled", True),
        ),
        cond_step("final-report", depends_on=["optional-notify"]),
    )
    plan = build_plan(wf)
    audit = AuditLog()
    engine = PolicyEngine(audit=audit, role="developer")
    engine.run(plan, variables={"notify_enabled": False})

    blocked_entries = [
        e for e in audit.entries
        if e.event == "SKIPPED"
        and e.step == "final-report"
        and e.details.get("reason") == "blocked_dependency"
    ]
    assert blocked_entries == [], (
        "final-report must not appear as blocked_dependency in the audit log "
        "when its only skipped predecessor was condition-skipped"
    )


def test_p5_transitive_skipped_chain_does_not_block():
    """Regression (P5): a chain of condition-skipped steps must not block
    the first unconditional step at the end of the chain.

    Topology: A (skipped) → B (skipped) → C (no condition, must run)
    """
    wf = make_wf(
        cond_step("step-a", condition=eq_cond("flag_a", True)),
        cond_step("step-b", depends_on=["step-a"], condition=eq_cond("flag_b", True)),
        cond_step("step-c", depends_on=["step-b"]),
    )
    plan = build_plan(wf)
    engine = PolicyEngine(role="developer")
    results = engine.run(plan, variables={})

    assert results["step-a"] == "skipped:condition_not_met"
    assert results["step-b"] == "skipped:condition_not_met"
    assert results["step-c"] == "success"


def test_p5_failed_step_still_blocks_downstream():
    """REQ_FAILED_BLOCKS_DEPENDENTS must not be broken by the P5 fix.

    A genuinely denied/failed step must still block its dependents.
    """
    wf = make_wf(
        cond_step("deploy", gates=["prod-gate"], env="prod"),
        cond_step("notify", depends_on=["deploy"]),
    )
    plan = build_plan(wf)
    engine = PolicyEngine(role="developer")  # developer cannot pass prod-gate
    results = engine.run(plan)

    assert results["deploy"] == "denied"
    assert results["notify"] == "skipped"


def test_p5_mixed_skipped_and_real_deps():
    """A step with two predecessors — one skipped, one successful — must run."""
    wf = make_wf(
        cond_step("build"),
        cond_step(
            "optional-lint",
            depends_on=["build"],
            condition=eq_cond("lint_enabled", True),
        ),
        cond_step("package", depends_on=["build"]),
        cond_step("deploy", depends_on=["optional-lint", "package"]),
    )
    plan = build_plan(wf)
    engine = PolicyEngine(role="developer")
    results = engine.run(plan, variables={"lint_enabled": False})

    assert results["build"] == "success"
    assert results["optional-lint"] == "skipped:condition_not_met"
    assert results["package"] == "success"
    assert results["deploy"] == "success"