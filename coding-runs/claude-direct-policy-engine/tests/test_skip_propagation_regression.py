"""Regression tests for the SKIPPED-step propagation bug (v0.2.1).

Bug report
----------
A workflow with a SKIPPED optional step caused downstream steps to FAIL
(or be BLOCKED) incorrectly.  When an upstream step was skipped because its
condition evaluated to False, any step that depended on it was being treated
as having a failed predecessor and was itself marked FAILED/BLOCKED instead
of running normally.

Expected semantics (spec)
-------------------------
- SKIPPED  → condition evaluated False → treated as *satisfied* for dependency
             purposes → dependents STILL RUN (unless they have their own
             failing condition or gate).
- FAILED   → execution error or gate denial → dependents are BLOCKED.
- BLOCKED  → a dependency FAILED or was BLOCKED → propagates transitively.

These tests must FAIL on the pre-fix engine (without the explicit
``skipped_ids`` tracking) and PASS after the fix.

Test matrix
-----------
Engine tests  (runtime behaviour):
  1.  Single skipped dep  → dependent runs            (simple case)
  2.  Skipped dep with gate on dependent              → gate still evaluated normally
  3.  Chain: skip → run → skip                        → middle step runs
  4.  Chain: skip → skip (both conditioned)           → both skipped, no BLOCK
  5.  Parallel branches: one skipped, one failed      → only failed branch blocks
  6.  Diamond: shared dep is skipped                  → both consumers run
  7.  Skipped dep + failing gate on dependent         → dependent FAILED (not BLOCKED)
  8.  Three-layer chain: A skip → B run → C run       → B and C run
  9.  Skipped steps are absent from rollback list
  10. Audit log never contains step_blocked for skipped predecessors

Planner tests (plan-time behaviour mirrors engine):
  11. Planner: skipped dep → dependent is RUN (not BLOCK)
  12. Planner: bad_ids never contains skipped step IDs
  13. Planner: skipped + denied → only denied causes BLOCK on shared dependent
  14. Planner counts reflect correct SKIP vs BLOCK distinction
"""
from __future__ import annotations

import pytest

from policy_engine.audit import AuditLog
from policy_engine.engine import WorkflowEngine
from policy_engine.models import PolicyGate, Step, StepStatus, Workflow
from policy_engine.permissions import PermissionModel
from policy_engine.planner import Decision, Planner
from policy_engine.policy_mode import PolicyMode


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _wf(steps, gates=None):
    return Workflow(
        name="regression-test",
        version="1.0",
        steps=steps,
        gates=gates or {},
    )


def _engine(wf, variables=None, roles=None, mode=PolicyMode.ENFORCING):
    return WorkflowEngine(
        workflow         = wf,
        audit            = AuditLog(),
        permission_model = PermissionModel(),
        actor_roles      = roles     or [],
        variables        = variables or {},
        policy_mode      = mode,
    )


def _planner(wf, variables=None, roles=None, perm=None, mode=PolicyMode.ENFORCING):
    return Planner(
        workflow         = wf,
        permission_model = perm or PermissionModel(),
        actor_roles      = roles     or [],
        variables        = variables or {},
        policy_mode      = mode,
    )


def _step_status(wf, step_id):
    return next(s.status for s in wf.steps if s.id == step_id)


def _audit_events(engine):
    return [(e.event, e.step_id) for e in engine.audit.entries()]


def _plan_decision(plan, step_id):
    return next(sp.decision for sp in plan.step_plans if sp.step_id == step_id)


# ---------------------------------------------------------------------------
# Engine regression tests
# ---------------------------------------------------------------------------

class TestSkipDoesNotBlockDependents:
    """Core invariant: SKIPPED ≠ FAILED for dependency purposes."""

    def test_01_single_skipped_dep_dependent_runs(self):
        """
        A ──(skip)──► B
        B should RUN, not be BLOCKED.
        """
        a = Step(id="a", name="A", action="a.run",
                 condition={"equals": {"var": "env", "value": "prod"}})
        b = Step(id="b", name="B", action="b.run", depends_on=["a"])
        wf = _wf([a, b])
        eng = _engine(wf, variables={"env": "dev"})

        result = eng.run()

        assert result is True, "Workflow should succeed when only optional step is skipped"
        assert _step_status(wf, "a") == StepStatus.SKIPPED
        assert _step_status(wf, "b") == StepStatus.SUCCESS   # THE REGRESSION CASE

    def test_02_skipped_dep_dependent_with_passing_gate_runs(self):
        """
        A ──(skip)──► B [dev_gate, role=developer]
        B should have its gate evaluated and pass.
        """
        gate = PolicyGate(name="dev_gate", required_role="developer")
        a = Step(id="a", name="A", action="a.run",
                 condition={"equals": {"var": "env", "value": "prod"}})
        b = Step(id="b", name="B", action="b.run",
                 depends_on=["a"], policy_gates=["dev_gate"])
        wf = _wf([a, b], gates={"dev_gate": gate})
        perm = PermissionModel(role_gates={"developer": {"dev_gate"}})
        eng = WorkflowEngine(wf, AuditLog(), perm, actor_roles=["developer"],
                             variables={"env": "dev"})

        result = eng.run()

        assert result is True
        assert _step_status(wf, "a") == StepStatus.SKIPPED
        assert _step_status(wf, "b") == StepStatus.SUCCESS

    def test_03_chain_skip_run_skip(self):
        """
        A ──(skip)──► B ──(run)──► C ──(skip)
        B runs; C is skipped by its own condition (not by A's skip).
        """
        a = Step(id="a", name="A", action="a.run",
                 condition={"equals": {"var": "flag", "value": "yes"}})
        b = Step(id="b", name="B", action="b.run", depends_on=["a"])
        c = Step(id="c", name="C", action="c.run", depends_on=["b"],
                 condition={"equals": {"var": "flag", "value": "yes"}})
        wf = _wf([a, b, c])
        eng = _engine(wf, variables={"flag": "no"})

        result = eng.run()

        assert result is True
        assert _step_status(wf, "a") == StepStatus.SKIPPED
        assert _step_status(wf, "b") == StepStatus.SUCCESS
        assert _step_status(wf, "c") == StepStatus.SKIPPED

    def test_04_two_consecutive_skipped_no_block(self):
        """
        A ──(skip)──► B ──(skip)
        Both have their own conditions; neither should be BLOCKED.
        """
        a = Step(id="a", name="A", action="a.run",
                 condition={"equals": {"var": "x", "value": "1"}})
        b = Step(id="b", name="B", action="b.run", depends_on=["a"],
                 condition={"equals": {"var": "y", "value": "1"}})
        wf = _wf([a, b])
        eng = _engine(wf, variables={"x": "0", "y": "0"})

        result = eng.run()

        assert result is True
        assert _step_status(wf, "a") == StepStatus.SKIPPED
        assert _step_status(wf, "b") == StepStatus.SKIPPED   # SKIPPED, not BLOCKED

    def test_05_parallel_skipped_and_failed_branches(self):
        """
        start ──► A (skip)    ──► merge
               ──► B (fail)   ──► merge
        merge depends on A and B.  B fails → merge is BLOCKED.
        A being skipped must not additionally affect the BLOCK classification.
        """
        class FailingEngine(WorkflowEngine):
            def _execute_step(self, step):
                if step.id == "b":
                    step.status = StepStatus.FAILED
                    self.audit.record("step_failed", "forced failure", step_id=step.id)
                else:
                    super()._execute_step(step)

        start = Step(id="start", name="Start", action="start.run")
        a = Step(id="a", name="A", action="a.run", depends_on=["start"],
                 condition={"equals": {"var": "env", "value": "prod"}})
        b = Step(id="b", name="B", action="b.run", depends_on=["start"])
        merge = Step(id="merge", name="Merge", action="merge.run",
                     depends_on=["a", "b"])
        wf = _wf([start, a, b, merge])
        eng = FailingEngine(wf, AuditLog(), PermissionModel(),
                            variables={"env": "dev"})

        result = eng.run()

        assert result is False
        assert _step_status(wf, "start") == StepStatus.SUCCESS
        assert _step_status(wf, "a") == StepStatus.SKIPPED
        assert _step_status(wf, "b") == StepStatus.FAILED
        assert _step_status(wf, "merge") == StepStatus.BLOCKED

    def test_06_diamond_shared_skipped_dep(self):
        """
           root (skip)
           /         \\
          B           C
           \\         /
             merge
        root is skipped; B, C, and merge all run.
        """
        root  = Step(id="root",  name="Root",  action="root.run",
                     condition={"equals": {"var": "skip_root", "value": "yes"}})
        b     = Step(id="b",     name="B",     action="b.run",     depends_on=["root"])
        c     = Step(id="c",     name="C",     action="c.run",     depends_on=["root"])
        merge = Step(id="merge", name="Merge", action="merge.run", depends_on=["b", "c"])
        wf = _wf([root, b, c, merge])
        eng = _engine(wf, variables={"skip_root": "no"})

        result = eng.run()

        assert result is True
        assert _step_status(wf, "root")  == StepStatus.SKIPPED
        assert _step_status(wf, "b")     == StepStatus.SUCCESS
        assert _step_status(wf, "c")     == StepStatus.SUCCESS
        assert _step_status(wf, "merge") == StepStatus.SUCCESS

    def test_07_skipped_dep_failing_gate_on_dependent(self):
        """
        A ──(skip)──► B [gate → DENY]
        B should be FAILED (gate denied) — not BLOCKED (blocked would be wrong).
        FAILED and BLOCKED are distinct statuses; this test verifies the
        distinction is preserved even when the predecessor was skipped.
        """
        gate = PolicyGate(name="admin_gate", required_role="admin")
        a = Step(id="a",