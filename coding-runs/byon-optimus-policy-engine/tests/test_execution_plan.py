"""
Tests for ExecutionPlan, PlanValidator, PlanRenderer (P4).
"""

import pytest
from policy_engine.execution_plan import (
    ExecutionPlan,
    PlanRenderer,
    PlanValidator,
    StepPlan,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_plan(*steps: StepPlan) -> ExecutionPlan:
    p = ExecutionPlan()
    p.steps.extend(steps)
    return p


def _allow(name: str, depends_on=None) -> StepPlan:
    return StepPlan(
        step_name=name,
        depends_on=depends_on or [],
        condition_met=None,
        policy_result="allow",
        will_execute=True,
    )


def _deny(name: str, depends_on=None) -> StepPlan:
    return StepPlan(
        step_name=name,
        depends_on=depends_on or [],
        condition_met=None,
        policy_result="deny",
        will_execute=False,
        skip_reason="denied by policy",
    )


def _skip(name: str, depends_on=None, reason="condition not met") -> StepPlan:
    return StepPlan(
        step_name=name,
        depends_on=depends_on or [],
        condition_met=False,
        policy_result="skip",
        will_execute=False,
        skip_reason=reason,
    )


# ---------------------------------------------------------------------------
# ExecutionPlan
# ---------------------------------------------------------------------------

class TestExecutionPlan:
    def test_empty_plan(self):
        plan = ExecutionPlan()
        assert plan.steps == []
        assert plan.step_names() == []

    def test_step_names(self):
        plan = _make_plan(_allow("build"), _allow("test"), _allow("deploy"))
        assert plan.step_names() == ["build", "test", "deploy"]

    def test_get_existing(self):
        plan = _make_plan(_allow("build"), _allow("test"))
        sp = plan.get("test")
        assert sp is not None
        assert sp.step_name == "test"

    def test_get_missing(self):
        plan = _make_plan(_allow("build"))
        assert plan.get("nonexistent") is None

    def test_step_plan_is_frozen(self):
        sp = _allow("build")
        with pytest.raises((AttributeError, TypeError)):
            sp.step_name = "other"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# PlanValidator
# ---------------------------------------------------------------------------

class TestPlanValidator:
    def setup_method(self):
        self.validator = PlanValidator()

    def test_valid_simple_plan(self):
        plan = _make_plan(_allow("build"), _allow("test", ["build"]))
        valid, errors = self.validator.validate(plan)
        assert valid
        assert errors == []

    def test_valid_empty_plan(self):
        plan = ExecutionPlan()
        valid, errors = self.validator.validate(plan)
        assert valid
        assert errors == []

    def test_duplicate_step_name(self):
        plan = _make_plan(_allow("build"), _allow("build"))
        valid, errors = self.validator.validate(plan)
        assert not valid
        assert any("Duplicate" in e.message for e in errors)

    def test_unknown_dependency(self):
        plan = _make_plan(_allow("deploy", ["nonexistent"]))
        valid, errors = self.validator.validate(plan)
        assert not valid
        assert any("nonexistent" in e.message for e in errors)

    def test_forward_dependency_rejected(self):
        # 'build' depends on 'test' but 'test' comes after
        build = StepPlan(
            step_name="build",
            depends_on=["test"],
            condition_met=None,
            policy_result="allow",
            will_execute=True,
        )
        test = _allow("test")
        plan = _make_plan(build, test)
        valid, errors = self.validator.validate(plan)
        assert not valid
        assert any("test" in e.message for e in errors)

    def test_invariant_no_policy_bypass(self):
        # denied step must not have will_execute=True
        bad = StepPlan(
            step_name="deploy",
            depends_on=[],
            condition_met=None,
            policy_result="deny",
            will_execute=True,   # violation
        )
        plan = _make_plan(bad)
        valid, errors = self.validator.validate(plan)
        assert not valid
        assert any("invariant_no_policy_bypass" in e.message for e in errors)

    def test_invariant_failed_step_blocks_dependents(self):
        # 'test' depends on 'build' which will not execute
        build = _deny("build")
        test = StepPlan(
            step_name="test",
            depends_on=["build"],
            condition_met=None,
            policy_result="allow",
            will_execute=True,   # violation: build is blocked
        )
        plan = _make_plan(build, test)
        valid, errors = self.validator.validate(plan)
        assert not valid
        assert any("invariant_failed_step_blocks_dependents" in e.message for e in errors)

    def test_unknown_policy_result(self):
        bad = StepPlan(
            step_name="build",
            depends_on=[],
            condition_met=None,
            policy_result="maybe",   # invalid
            will_execute=False,
        )
        plan = _make_plan(bad)
        valid, errors = self.validator.validate(plan)
        assert not valid
        assert any("maybe" in e.message for e in errors)

    def test_valid_plan_with_skipped_step(self):
        plan = _make_plan(
            _allow("build"),
            _skip("deploy