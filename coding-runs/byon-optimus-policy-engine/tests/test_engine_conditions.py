"""
Integration tests for conditional step execution in WorkflowEngine.

Covers:
  - all conditions true
  - all conditions false (all skipped)
  - mixed (some run, some skipped)
  - chained skips (skipped predecessor → dependent still runs)
  - skipped step is NOT treated as failure (dependents not blocked)
  - failed step still blocks dependents (invariant_failed_step_blocks_dependents)
  - condition evaluation error → step FAILED, not skipped
  - audit log records SKIPPED with reason 'condition not met'
  - audit log is append-only (invariant_audit_append_only)
"""

import pytest

from policy_engine.audit import AuditLog
from policy_engine.engine import WorkflowEngine
from policy_engine.models import (
    ExecutionContext,
    StepDefinition,
    StepStatus,
    WorkflowDefinition,
)
from policy_engine.policy import PolicyEngine


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_engine() -> tuple[WorkflowEngine, AuditLog]:
    audit = AuditLog()
    policy = PolicyEngine()
    engine = WorkflowEngine(policy_engine=policy, audit_log=audit)
    engine.register_action("noop", lambda step, ctx: f"ran:{step.name}")
    engine.register_action("fail", lambda step, ctx: (_ for _ in ()).throw(RuntimeError("deliberate failure")))
    return engine, audit


def _workflow(*steps: StepDefinition) -> WorkflowDefinition:
    return WorkflowDefinition(name="test-wf", steps=list(steps))


def _step(name, *, depends_on=None, condition=None, action="noop") -> StepDefinition:
    return StepDefinition(
        name=name,
        action=action,
        depends_on=depends_on or [],
        condition=condition,
    )


# ---------------------------------------------------------------------------
# All conditions true → all steps run
# ---------------------------------------------------------------------------

class TestAllConditionsTrue:
    def test_all_run(self):
        engine, audit = _make_engine()
        wf = _workflow(
            _step("build"),
            _step("test", depends_on=["build"],
                  condition={"equals": {"var": "run_tests", "value": True}}),
            _step("deploy", depends_on=["test"],
                  condition={"equals": {"var": "env", "value": "production"}}),
        )
        ctx = engine.run(wf, variables={"run_tests": True, "env": "production"})

        assert ctx.results["build"].status == StepStatus.SUCCESS
        assert ctx.results["test"].status == StepStatus.SUCCESS
        assert ctx.results["deploy"].status == StepStatus.SUCCESS

    def test_no_skip_events_in_audit(self):
        engine, audit = _make_engine()
        wf = _workflow(
            _step("a", condition={"equals": {"var": "x", "value": 1}}),
        )
        engine.run(wf, variables={"x": 1})
        assert "step_skipped" not in audit.events()


# ---------------------------------------------------------------------------
# All conditions false → all steps skipped
# ---------------------------------------------------------------------------

class TestAllConditionsFalse:
    def test_all_skipped(self):
        engine, audit = _make_engine()
        wf = _workflow(
            _step("build", condition={"equals": {"var": "env", "value": "production"}}),
            _step("deploy", condition={"equals": {"var": "env", "value": "production"}}),
        )
        ctx = engine.run(wf, variables={"env": "staging"})

        assert ctx.results["build"].status == StepStatus.SKIPPED
        assert ctx.results["deploy"].status == StepStatus.SKIPPED

    def test_skip_reason_recorded(self):
        engine, audit = _make_engine()
        wf = _workflow(
            _step("a", condition={"equals": {"var": "x", "value": "yes"}}),
        )
        ctx = engine.run(wf, variables={"x": "no"})
        assert ctx.results["a"].skip_reason == "condition not met"

    def test_audit_records_skipped_with_reason(self):
        engine, audit = _make_engine()
        wf = _workflow(
            _step("a", condition={"equals": {"var": "x", "value": "yes"}}),
        )
        engine.run(wf, variables={"x": "no"})
        skip_entries = [e for e in audit.entries() if e.event == "step_skipped"]
        assert len(skip_entries) == 1
        assert skip_entries[0].details["reason"] == "condition not met"
        assert skip_entries[0].details["step"] == "a"


# ---------------------------------------------------------------------------
# Mixed: some run, some skipped
# ---------------------------------------------------------------------------

class TestMixedConditions:
    def test_mixed(self):
        engine, audit = _make_engine()
        wf = _workflow(
            _step("build"),
            _step("lint", condition={"equals": {"var": "run_lint", "value": True}}),
            _step("deploy", condition={"equals": {"var": "env", "value": "production"}}),
        )
        ctx = engine.run(wf, variables={"run_lint": False, "env": "staging"})

        assert ctx.results["build"].status == StepStatus.SUCCESS
        assert ctx.results["lint"].status == StepStatus.SKIPPED
        assert ctx.results["deploy"].status == StepStatus.SKIPPED

    def test_unconditional_step_always_runs(self):
        engine, audit = _make_engine()
        wf = _workflow(
            _step("always"),
            _step("maybe", condition={"equals": {"var": "flag", "value": True}}),
        )
        ctx = engine.run(wf, variables={"flag": False})
        assert ctx.results["always"].status == StepStatus.SUCCESS
        assert ctx.results["maybe"].status == StepStatus.SKIPPED


# ---------------------------------------------------------------------------
# Chained skips: skipped predecessor → dependent still runs
# ---------------------------------------------------------------------------

class TestChainedSkips:
    def test_skipped_predecessor_does_not_block_dependent(self):
        """
        build (skipped) → deploy (no condition) must still run.
        Skipped is treated as 'satisfied' for ordering.
        """
        engine, audit = _make_engine()
        wf = _workflow(
            _step("build", condition={"equals": {"var": "env", "value": "production"}}),
            _step("deploy", depends_on=["build"]),
        )
        ctx = engine.run(wf, variables={"env": "staging"})

        assert ctx.results["build"].status == StepStatus.SKIPPED
        assert ctx.results["deploy"].status == StepStatus.SUCCESS

    def test_chain_of_three_skips_then_run(self):
        """
        a (skipped) → b (skipped) → c (no condition) → c runs.
        """
        engine, audit = _make_engine()
        wf = _workflow(
            _step("a", condition={"equals": {"var": "x", "value": 1}}),
            _step("b", depends_on=["a"], condition={"equals": {"var": "x", "value": 1}}),
            _step("c", depends_on=["b"]),
        )
        ctx = engine.run(wf, variables={"x": 0})

        assert ctx.results["a"].status == StepStatus.SKIPPED
        assert ctx.results["b"].status == StepStatus.SKIPPED
        assert ctx.results["c"].status == StepStatus.SUCCESS

    def test_execution_context_reflects_skipped(self):
        """ExecutionContext.results must show SKIPPED, not SUCCESS, for skipped steps."""
        engine, audit = _make_engine()
        wf = _workflow(
            _step("a", condition={"equals": {"var": "go", "value": True}}),
            _step("b", depends_on=["a"]),
        )
        ctx = engine.run(wf, variables={"go": False})
        assert ctx.results["a"].status == StepStatus.SKIPPED
        assert ctx.results["b"].status == StepStatus.SUCCESS

    def test_all_chained_skipped(self):
        """
        a (skipped) → b (skipped via condition) → c (skipped via condition).
        All three skipped; no failures.
        """
        engine, audit = _make_engine()
        cond = {"equals": {"var": "x", "value": 1}}
        wf = _workflow(
            _step("a", condition=cond),
            _step("b", depends_on=["a"], condition=cond),
            _step("c", depends_on=["b"], condition=cond),
        )
        ctx = engine.run(wf, variables={"x": 0})
        for name in ("a", "b", "c"):
            assert ctx.results[name].status == StepStatus.SKIPPED


# ---------------------------------------------------------------------------
# Failed step still blocks dependents (invariant_failed_step_blocks_dependents)
# ---------------------------------------------------------------------------

class TestFailedStepBlocksDependents:
    def test_failed_blocks_dependent(self):
        engine, audit = _make_engine()
        wf = _workflow(
            _step("build", action="fail"),
            _step("deploy", depends_on=["build"]),
        )
        ctx = engine.run(wf, variables={})
        assert ctx.results["build"].status == StepStatus.FAILED
        assert ctx.results["deploy"].status == StepStatus.FAILED
        assert "Blocked" in ctx.results["deploy"].error

    def test_failed_does_not_propagate_as_skip(self):
        """A failed step must NOT be treated as skipped by dependents."""
        engine, audit = _make_engine()
        wf = _workflow(
            _step("a", action="fail"),
            _step("b", depends_on=["a"]),
        )
        ctx = engine.run(wf, variables={})
        assert ctx.results["b"].status == StepStatus.FAILED
        assert ctx.results["b"].status != StepStatus.SKIPPED


# ---------------------------------------------------------------------------
# Condition evaluation error → FAILED
# ---------------------------------------------------------------------------

class TestConditionError:
    def test_invalid_condition_causes_failure(self):
        engine, audit = _make_engine()
        # "gt" is not a valid operator
        wf = _workflow(
            _step("a", condition={"gt": {"var": "x", "value": 1}}),
        )
        ctx = engine.run(wf, variables={"x": 5})
        assert ctx.results["a"].status == StepStatus.FAILED
        assert "Condition evaluation error" in ctx.results["a"].error

    def test_condition_error_audit_entry(self):
        engine, audit = _make_engine()
        wf = _workflow(
            _step("a", condition={"gt": {"var": "x", "value": 1}}),
        )
        engine.run(wf, variables={"x": 5})
        assert "step_condition_error" in audit.events()


# ---------------------------------------------------------------------------
# Audit log invariants
# ---------------------------------------------------------------------------

class TestAuditInvariants:
    def test_audit_is_append_only(self):
        """Entries list only grows; no removal possible via public API."""
        engine, audit = _make_engine()
        wf = _workflow(_step("a"))
        engine.run(wf, variables={})
        before = audit.entries()
        count_before = len(before)
        # Run again — more entries appended
        engine.run(wf, variables={})
        assert len(audit.entries()) > count_before

    def test_audit_entries_are_immutable(self):
        engine, audit = _make_engine()
        wf = _workflow(_step("a"))
        engine.run(wf, variables={})
        entry = audit.entries()[0]
        with pytest.raises((AttributeError, TypeError)):
            entry.event = "tampered"  # type: ignore[misc]

    def test_skipped_step_audit_contains_condition(self):
        engine, audit = _make_engine()
        cond = {"equals": {"var": "env", "value": "prod"}}
        wf = _workflow(_step("a", condition=cond))
        engine.run(wf, variables={"env": "dev"})
        skip_entry = next(e for e in audit.entries() if e.event == "step_skipped")
        assert skip_entry.details["condition"] == cond