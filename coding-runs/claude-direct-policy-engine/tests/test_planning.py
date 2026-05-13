"""
Tests for ExecutionPlan, PlanValidator, PlanRenderer, and build_plan().

Coverage targets
----------------
* build_plan produces correct PredictedOutcome for every scenario
* PlanValidator issues are correct severity and content
* PlanRenderer text and dict outputs are structurally sound
* Invariants hold: failed/blocked propagation, skipped does not propagate,
  permissive overrides are flagged as warnings not errors
"""
from __future__ import annotations

import json
from typing import List

import pytest

from policy_engine.audit import AuditLog
from policy_engine.engine import ExecutionContext, WorkflowEngine
from policy_engine.models import (
    ConditionExpr,
    Step,
    StepStatus,
    WorkflowDefinition,
)
from policy_engine.permissions import PermissionModel
from policy_engine.planning import (
    ExecutionPlan,
    PlanRenderer,
    PlanValidator,
    PredictedOutcome,
    StepDecision,
    ValidationIssue,
    build_plan,
)
from policy_engine.policy import DEFAULT_GATES, PolicyEngine, PolicyMode


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _wf(*steps: Step) -> WorkflowDefinition:
    return WorkflowDefinition(name="test-wf", version="0.1", steps=list(steps))


def _step(
    sid: str,
    action: str = "build",
    depends_on: List[str] | None = None,
    gate: str | None = None,
    env: str = "development",
    condition: ConditionExpr | None = None,
) -> Step:
    return Step(
        id=sid,
        name=sid.capitalize(),
        action=action,
        depends_on=depends_on or [],
        policy_gate=gate,
        environment=env,
        condition=condition,
    )


def _cond(op: str, var: str, value=None) -> ConditionExpr:
    return ConditionExpr(operator=op, var=var, value=value)


def _make_policy(role: str, mode: PolicyMode = PolicyMode.ENFORCED) -> PolicyEngine:
    perms = PermissionModel.from_defaults(role)
    return PolicyEngine(DEFAULT_GATES, perms, role, mode=mode)


def _plan(
    wf: WorkflowDefinition,
    role: str = "developer",
    mode: PolicyMode = PolicyMode.ENFORCED,
    ctx_vars: dict | None = None,
) -> ExecutionPlan:
    policy  = _make_policy(role, mode)
    ctx     = ExecutionContext(ctx_vars or {})
    return build_plan(wf, policy, ctx)


def _outcomes(plan: ExecutionPlan) -> dict:
    return {d.step.id: d.outcome for d in plan.decisions}


# ---------------------------------------------------------------------------
# build_plan — PredictedOutcome correctness
# ---------------------------------------------------------------------------

class TestBuildPlanOutcomes:

    def test_ungated_step_is_run(self):
        plan = _plan(_wf(_step("build")))
        assert _outcomes(plan)["build"] == PredictedOutcome.RUN

    def test_gated_step_allowed_role_is_run(self):
        plan = _plan(_wf(_step("lint", gate="lint-gate")), role="developer")
        assert _outcomes(plan)["lint"] == PredictedOutcome.RUN

    def test_gated_step_denied_role_is_deny(self):
        plan = _plan(
            _wf(_step("prod", gate="production-gate", env="production")),
            role="developer",
            mode=PolicyMode.ENFORCED,
        )
        assert _outcomes(plan)["prod"] == PredictedOutcome.DENY

    def test_gated_step_permissive_mode_is_override(self):
        plan = _plan(
            _wf(_step("prod", gate="production-gate", env="production")),
            role="developer",
            mode=PolicyMode.PERMISSIVE,
        )
        assert _outcomes(plan)["prod"] == PredictedOutcome.OVERRIDE

    def test_condition_false_is_skip(self):
        cond = _cond("equals", "env", "production")
        plan = _plan(
            _wf(_step("deploy", condition=cond)),
            ctx_vars={"env": "staging"},
        )
        assert _outcomes(plan)["deploy"] == PredictedOutcome.SKIP

    def test_condition_true_is_run(self):
        cond = _cond("equals", "env", "production")
        plan = _plan(
            _wf(_step("deploy", condition=cond)),
            ctx_vars={"env": "production"},
        )
        assert _outcomes(plan)["deploy"] == PredictedOutcome.RUN

    def test_denied_predecessor_blocks_dependent(self):
        """invariant_failed_step_blocks_dependents in plan layer."""
        wf = _wf(
            _step("prod", gate="production-gate", env="production"),
            _step("notify", depends_on=["prod"]),
        )
        plan = _plan(wf, role="developer")
        outcomes = _outcomes(plan)
        assert outcomes["prod"]   == PredictedOutcome.DENY
        assert outcomes["notify"] == PredictedOutcome.BLOCK

    def test_skipped_predecessor_does_not_block_dependent(self):
        """SKIP is not a hard failure — dependents should RUN."""
        cond = _cond("equals", "env", "production")
        wf = _wf(
            _step("optional", condition=cond),
            _step("always",   depends_on=["optional"]),
        )
        plan = _plan(wf, ctx_vars={"env": "staging"})
        outcomes = _outcomes(plan)
        assert outcomes["optional"] == PredictedOutcome.SKIP
        assert outcomes["always"]   == PredictedOutcome.RUN

    def test_chained_blocks_from_single_deny(self):
        """A single denial cascades to all transitive dependents."""
        wf = _wf(
            _step("root",  gate="production-gate", env="production"),
            _step("child", depends_on=["root"]),
            _step("grand", depends_on=["child"]),
        )
        plan = _plan(wf, role="developer")
        outcomes = _outcomes(plan)
        assert outcomes["root"]  == PredictedOutcome.DENY
        assert outcomes["child"] == PredictedOutcome.BLOCK
        assert outcomes["grand"] == PredictedOutcome.BLOCK

    def test_mixed_outcomes_in_single_plan(self):
        """Realistic pipeline: some run, one skip, one deny, one block."""
        wf = _wf(
            _step("lint",   gate="lint-gate"),
            _step("test",   gate="test-gate",   depends_on=["lint"]),
            _step("opt",    condition=_cond("equals", "env", "production"),
                  depends_on=["test"]),
            _step("deploy", gate="production-gate", env="production",
                  depends_on=["test"]),
            _step("notify", depends_on=["deploy"]),
        )
        # developer: lint+test pass, deploy denied, opt skipped, notify blocked
        plan = _plan(wf, role="developer", ctx_vars={"env": "staging"})
        outcomes = _outcomes(plan)
        assert outcomes["lint"]   == PredictedOutcome.RUN
        assert outcomes["test"]   == PredictedOutcome.RUN
        assert outcomes["opt"]    == PredictedOutcome.SKIP
        assert outcomes["deploy"] == PredictedOutcome.DENY
        assert outcomes["notify"] == PredictedOutcome.BLOCK

    def test_condition_error_is_error_outcome(self):
        """An unsupported operator in a condition yields ERROR, not a crash."""
        bad_cond = ConditionExpr(operator="greater_than", var="x", value=5)
        plan = _plan(_wf(_step("s", condition=bad_cond)), ctx_vars={"x": 10})
        assert _outcomes(plan)["s"] == PredictedOutcome.ERROR

    def test_error_outcome_blocks_dependents(self):
        bad_cond = ConditionExpr(operator="greater_than", var="x", value=5)
        wf = _wf(
            _step("s",    condition=bad_cond),
            _step("down", depends_on=["s"]),
        )
        plan = _plan(wf, ctx_vars={"x": 10})
        assert _outcomes(plan)["s"]    == PredictedOutcome.ERROR
        assert _outcomes(plan)["down"] == PredictedOutcome.BLOCK


# ---------------------------------------------------------------------------
# ExecutionPlan — data access and immutability
# ---------------------------------------------------------------------------

class TestExecutionPlan:

    def test_decisions_snapshot_is_copy(self):
        plan = _plan(_wf(_step("s")))
        snap = plan.decisions
        snap.clear()
        assert len(plan.decisions) == 1

    def test_context_snapshot_is_copy(self):
        plan = _plan(_wf(_step("s")), ctx_vars={"k": "v"})
        snap = plan.context_snapshot
        snap["k"] = "mutated"
        assert plan.context_snapshot["k"] == "v"

    def test_steps_that_will_run_filters_correctly(self):
        cond = _cond("equals", "x", "yes")
        wf = _wf(
            _step("a"),
            _step("b", condition=cond),
        )
        plan = _plan(wf, ctx_vars={"x": "no"})
        run_ids = {s.id for s in plan.steps_that_will_run()}
        assert "a" in run_ids
        assert "b" not in run_ids

    def test_steps_that_will_skip_filters_correctly(self):
        cond = _cond("equals", "x", "yes")
        plan = _plan(_wf(_step("b", condition=cond)), ctx_vars={"x": "no"})
        assert plan.steps_that_will_skip()[0].id == "b"

    def test_steps_that_will_be_denied(self):
        plan = _plan(
            _wf(_step("p", gate="production-gate", env="production")),
            role="developer",
        )
        assert plan.steps_that_will_be_denied()[0].id == "p"

    def test_steps_that_will_be_blocked(self):
        wf = _wf(
            _step("p", gate="production-gate", env="production"),
            _step("c", depends_on=["p"]),
        )
        plan = _plan(wf, role="developer")
        assert plan.steps_that_will_be_blocked()[0].id == "c"

    def test_has_errors_true_when_deny_present(self):
        plan = _plan(
            _wf(_step("p", gate="production-gate", env="production")),
            role="developer",
        )
        assert plan.has_denials()

    def test_has_errors_false_for_clean_plan(self):
        plan = _plan(_wf(_step("b")))
        assert not plan.has_errors()
        assert not plan.has_denials()

    def test_len_matches_step_count(self):
        wf = _wf(_step("a"), _step("b"), _step("c"))
        plan = _plan(wf)
        assert len(plan) == 3

    def test_iteration_yields_decisions(self):
        plan = _plan(_wf(_step("a"), _step("b")))
        ids = [d.step.id for d in plan]
        assert set(ids) == {"a", "b"}


# ---------------------------------------------------------------------------
# PlanValidator
# ---------------------------------------------------------------------------

class TestPlanValidator:

    def _validate(self, plan: ExecutionPlan) -> List[ValidationIssue]:
        return PlanValidator().validate(plan)

    def test_clean_plan_has_no_errors(self):
        plan = _plan(_wf(_step("build")))
        issues = self._validate(plan)
        assert not any(i.severity == "error" for i in issues)

    def test_is_valid_true_for_clean_plan(self):
        plan = _plan(_wf(_step("build")))
        assert PlanValidator().is_valid(plan)

    def test_deny_produces_error_issue(self):
        plan = _plan(
            _wf(_step("p", gate="production-gate", env="production")),
            role="developer",
        )
        issues = self._validate(plan)
        errors = [i for i in issues if i.severity == "error" and i.step_id == "p"]
        assert errors, "Expected an error-severity issue for denied step"
        assert "production-gate" in errors[0].message

    def test_block_produces_error_issue(self):
        wf = _wf(
            _step("p", gate="production-gate", env="production"),
            _step("c", depends_on=["p"]),
        )
        plan = _plan(wf, role="developer")
        issues = self._validate(plan)
        block_errors = [i for i in issues if i.severity == "error" and i.step_id == "c"]
        assert block_errors

    def test_override_produces_warning_not_error(self):
        plan = _plan(
            _wf(_step("p", gate="production-gate", env="production")),
            role="developer",
            mode=PolicyMode.PERMISSIVE,
        )
        issues = self._validate(plan)
        warnings = [i for i in issues if i.severity == "warning" and i.step_id == "p"]
        errors   = [i for i in issues if i.severity == "error"   and i.step_id == "p"]
        assert warnings, "Expected a warning for permissive override"
        assert not errors

    def test_is_valid_false_when_deny_present(self):
        plan = _plan(
            _wf(_step("p", gate="production-gate", env="production")),
            role="developer",
        )
        assert not PlanValidator().is_valid(plan)

    def test_skip_produces_no_issues(self):
        cond = _cond("equals", "env", "production")
        plan = _plan(
            _wf(_step("opt", condition=cond)),
            ctx_vars={"env": "staging"},
        )
        issues = self._validate(plan)
        assert not any(i.step_id == "opt" for i in issues)

    def test_production_gate_run_produces_warning(self):
        plan = _plan(
            _wf(_step("prod", gate="production-gate", env="production")),
            role="release-manager",
        )
        issues = self._validate(plan)
        warnings = [
            i for i in issues
            if i.severity == "warning" and i.step_id == "prod"
        ]
        assert warnings, "Expected production-gate-will-execute warning"

    def test_error_outcome_produces_error_issue(self):
        bad_cond = ConditionExpr(operator="greater_than", var="x", value=5)
        plan = _plan(_wf(_step("s", condition=bad_cond)), ctx_vars={"x": 10})
        issues = self._validate(plan)
        errors = [i for i in issues if i.severity == "error" and i.step_id == "s"]
        assert errors


# ---------------------------------------------------------------------------
# PlanRenderer
# ---------------------------------------------------------------------------

class TestPlanRenderer:

    def _render_text(self, plan, issues=None) -> str:
        return PlanRenderer().render_text(plan, issues or [])

    def _render_dict(self, plan, issues=None) -> dict:
        return PlanRenderer().render_dict(plan, issues or [])

    def test_text_contains_workflow_name(self):
        plan = _plan(_wf(_step("b")))
        assert "test-wf" in self._render_text(plan)

    def test_text_contains_all_step_ids(self):
        wf   = _wf(_step("lint"), _step("test", depends_on=["lint"]))
        plan = _plan(wf)
        text = self._render_text(plan)
        assert "lint" in text
        assert "test" in text

    def test_text_contains_outcome_labels(self):
        plan = _plan(
            _wf(_step("p", gate="production-gate", env="production")),
            role="developer",
        )
        text = self._render_text(