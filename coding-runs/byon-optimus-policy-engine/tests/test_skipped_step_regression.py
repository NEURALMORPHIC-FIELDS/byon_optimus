"""Regression tests — P5: skipped-step downstream failure bug.

Bug: when an upstream step is skipped (condition evaluates to False),
downstream dependent steps were incorrectly marked as 'blocked' / 'failed'
instead of running normally.

REQ_FAILED_BLOCKS_DEPENDENTS: only gate_denied and blocked are hard failures.
Skipped is NOT a hard failure and must NOT propagate as one.
REQ_TESTS_NOT_OPTIONAL.
"""
from __future__ import annotations

import pytest

from policy_engine.audit import AuditLog
from policy_engine.engine import PolicyEngine
from policy_engine.models import StepCondition, WorkflowDefinition, WorkflowStep
from policy_engine.permissions import PermissionModel
from policy_engine.planner import build_plan


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _engine(context: dict | None = None) -> PolicyEngine:
    return PolicyEngine(
        permissions=PermissionModel(role="developer"),
        audit=AuditLog(),
        context=context or {},
    )


# ---------------------------------------------------------------------------
# Core regression: skipped step must not block its dependent
# ---------------------------------------------------------------------------

class TestSkippedStepDoesNotBlockDependent:
    """Regression for P5 bug: skipped upstream → downstream incorrectly blocked."""

    def _skipped_chain_wf(self) -> WorkflowDefinition:
        """
        optional-step  (condition: env==prod → False when env=staging)
            └── downstream  (no condition, depends_on optional-step)

        Expected with env=staging:
          optional-step → skipped
          downstream    → success   ← was incorrectly 'blocked' before fix
        """
        return WorkflowDefinition(
            name="skipped-chain",
            steps=[
                WorkflowStep(
                    name="optional-step",
                    action="deploy",
                    condition=StepCondition(
                        operator="equals", var="env", value="prod"
                    ),
                ),
                WorkflowStep(
                    name="downstream",
                    action="notify",
                    depends_on=["optional-step"],
                ),
            ],
        )

    def test_downstream_runs_when_upstream_skipped(self):
        """Core regression: downstream must be 'success', not 'blocked'."""
        plan = build_plan(self._skipped_chain_wf())
        engine = _engine(context={"env": "staging"})
        results = engine.run(plan)

        assert results["optional-step"] == "skipped", (
            "optional-step should be skipped (condition false)"
        )
        assert results["downstream"] == "success", (
            "downstream must run when its only predecessor was skipped, not blocked"
        )

    def test_downstream_runs_when_upstream_skipped_audit(self):
        """Audit log must record skipped + step_success (not blocked)."""
        plan = build_plan(self._skipped_chain_wf())
        engine = _engine(context={"env": "staging"})
        engine.run(plan)

        events = [e.event for e in engine.audit.entries]
        assert "skipped" in events
        assert "step_success" in events
        assert "blocked" not in events

    def test_downstream_blocked_when_upstream_gate_denied(self):
        """Control: gate_denied IS a hard failure and must still block dependents.
        REQ_FAILED_BLOCKS_DEPENDENTS."""
        wf = WorkflowDefinition(
            name="gate-chain",
            steps=[
                WorkflowStep(
                    name="gated",
                    action="deploy",
                    policy_gates=["prod-gate"],
                    environment="prod",
                ),
                WorkflowStep(
                    name="downstream",
                    action="notify",
                    depends_on=["gated"],
                ),
            ],
        )
        plan = build_plan(wf)
        engine = _engine()  # developer role → prod-gate denied
        results = engine.run(plan)

        assert results["gated"] == "gate_denied"
        assert results["downstream"] == "blocked"

    def test_condition_true_upstream_runs_downstream(self):
        """When condition is True, upstream runs and downstream also runs."""
        plan = build_plan(self._skipped_chain_wf())
        engine = _engine(context={"env": "prod"})
        results = engine.run(plan)

        assert results["optional-step"] == "success"
        assert results["downstream"] == "success"


# ---------------------------------------------------------------------------
# Multi-level chain: skipped in the middle
# ---------------------------------------------------------------------------

class TestSkippedStepMiddleOfChain:
    """Skipped step in the middle of a longer chain."""

    def _three_step_wf(self) -> WorkflowDefinition:
        """
        build → optional-lint (condition: lint==true) → deploy

        With lint=false:
          build         → success
          optional-lint → skipped
          deploy        → success  ← must NOT be blocked
        """
        return WorkflowDefinition(
            name="three-step",
            steps=[
                WorkflowStep(name="build", action="compile"),
                WorkflowStep(
                    name="optional-lint",
                    action="lint",
                    depends_on=["build"],
                    condition=StepCondition(
                        operator="equals", var="lint", value=True
                    ),
                ),
                WorkflowStep(
                    name="deploy",
                    action="ship",
                    depends_on=["optional-lint"],
                ),
            ],
        )

    def test_middle_skipped_end_runs(self):
        plan = build_plan(self._three_step_wf())
        engine = _engine(context={"lint": False})
        results = engine.run(plan)

        assert results["build"] == "success"
        assert results["optional-lint"] == "skipped"
        assert results["deploy"] == "success"

    def test_all_run_when_condition_true(self):
        plan = build_plan(self._three_step_wf())
        engine = _engine(context={"lint": True})
        results = engine.run(plan)

        assert results["build"] == "success"
        assert results["optional-lint"] == "success"
        assert results["deploy"] == "success"

    def test_hard_failure_still_blocks_through_skipped(self):
        """If build fails (gate_denied), optional-lint is blocked, deploy is blocked.
        Skipped-not-blocking only applies when the step itself is skipped."""
        wf = WorkflowDefinition(
            name="hard-fail-chain",
            steps=[
                WorkflowStep(
                    name="build",
                    action="compile",
                    policy_gates=["prod-gate"],
                    environment="prod",
                ),
                WorkflowStep(
                    name="optional-lint",
                    action="lint",
                    depends_on=["build"],
                    condition=StepCondition(
                        operator="equals", var="lint", value=True
                    ),
                ),
                WorkflowStep(
                    name="deploy",
                    action="ship",
                    depends_on=["optional-lint"],
                ),
            ],
        )
        plan = build_plan(wf)
        engine = _engine(context={"lint": True})  # developer → prod-gate denied
        results = engine.run(plan)

        assert results["build"] == "gate_denied"
        assert results["optional-lint"] == "blocked"
        assert results["deploy"] == "blocked"


# ---------------------------------------------------------------------------
# Multiple skipped predecessors
# ---------------------------------------------------------------------------

class TestMultipleSkippedPredecessors:
    """Step with multiple dependencies, all skipped — must still run."""

    def test_two_skipped_deps_downstream_runs(self):
        """
        step-a (condition false) ─┐
                                   ├─ final (no condition)
        step-b (condition false) ─┘

        final must be 'success'.
        """
        wf = WorkflowDefinition(
            name="two-skipped-deps",
            steps=[
                WorkflowStep(
                    name="step-a",
                    action="a",
                    condition=StepCondition(
                        operator="equals", var="run_a", value=True
                    ),
                ),
                WorkflowStep(
                    name="step-b",
                    action="b",
                    condition=StepCondition(
                        operator="equals", var="run_b", value=True
                    ),
                ),
                WorkflowStep(
                    name="final",
                    action="finish",
                    depends_on=["step-a", "step-b"],
                ),
            ],
        )
        plan = build_plan(wf)
        engine = _engine(context={"run_a": False, "run_b": False})
        results = engine.run(plan)

        assert results["step-a"] == "skipped"
        assert results["step-b"] == "skipped"
        assert results["final"] == "success"

    def test_one_skipped_one_success_downstream_runs(self):
        """One dep skipped, one dep succeeds → downstream runs."""
        wf = WorkflowDefinition(
            name="mixed-deps",
            steps=[
                WorkflowStep(
                    name="step-a",
                    action="a",
                    condition=StepCondition(
                        operator="equals", var="run_a", value=True
                    ),
                ),
                WorkflowStep(name="step-b", action="b"),
                WorkflowStep(
                    name="final",
                    action="finish",
                    depends_on=["step-a", "step-b"],
                ),
            ],
        )
        plan = build_plan(wf)
        engine = _engine(context={"run_a": False})
        results = engine.run(plan)

        assert results["step-a"] == "skipped"
        assert results["step-b"] == "success"
        assert results["final"] == "success"

    def test_one_skipped_one_gate_denied_downstream_blocked(self):
        """One dep skipped, one dep gate_denied → downstream is blocked
        (gate_denied is a hard failure)."""
        wf = WorkflowDefinition(
            name="mixed-hard-fail",
            steps=[
                WorkflowStep(
                    name="step-a",
                    action="a",
                    condition=StepCondition(
                        operator="equals", var="run_a", value=True
                    ),
                ),
                WorkflowStep(
                    name="step-b",
                    action="b",
                    policy_gates=["prod-gate"],
                    environment="prod",
                ),
                WorkflowStep(
                    name="final",
                    action="finish",
                    depends_on=["step-a", "step-b"],
                ),
            ],
        )
        plan = build_plan(wf)
        engine = _engine(context={"run_a": False})  # developer → prod-gate denied
        results = engine.run(plan)

        assert results["step-a"] == "skipped"
        assert results["step-b"] == "gate_denied"
        assert results["final"] == "blocked"


# ---------------------------------------------------------------------------
# Audit integrity: skipped steps are recorded correctly
# ---------------------------------------------------------------------------

class TestSkippedAuditIntegrity:
    """Audit log entries for skipped steps must be accurate."""

    def test_skipped_audit_entry_has_correct_fields(self):
        """Skipped audit entry must record step name, operator, var, expected, actual."""
        wf = WorkflowDefinition(
            name="audit-check",
            steps=[
                WorkflowStep(
                    name="deploy",
                    action="ship",
                    condition=StepCondition(
                        operator="equals", var="env", value="prod"
                    ),
                ),
            ],
        )
        plan = build_plan(wf)
        engine = _engine(context={"env": "staging"})
        engine.run(plan)

        skipped = [e for e in engine.audit.entries if e.event == "skipped"]
        assert len(skipped) == 1
        entry = skipped[0]
        assert entry.step == "deploy"
        assert entry.detail["operator"] == "equals"
        assert entry.detail["var"] == "env"
        assert entry.detail["expected"] == "prod"
        assert entry.detail["actual"] == "staging"

    def test_no_skipped_entries_when_all_conditions_true(self):
        """When all conditions pass, no skipped entries appear in audit."""
        wf = WorkflowDefinition(
            name="all-pass",
            steps=[
                WorkflowStep(
                    name="build",
                    action="compile",
                    condition=StepCondition(
                        operator="equals", var="env", value="ci"
                    ),
                ),
                WorkflowStep(
                    name="test",
                    action="pytest",
                    depends_on=["build"],
                    condition=StepCondition(
                        operator="equals", var="env", value="ci"
                    ),
                ),
            ],
        )
        plan = build_plan(wf)
        engine = _engine(context={"env": "ci"})
        engine.run(plan)

        skipped = [e for e in engine.audit.entries if e.event == "skipped"]
        assert skipped == []