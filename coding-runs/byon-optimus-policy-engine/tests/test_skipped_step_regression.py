"""
Regression tests for P5: skipped-step dependency bug.

Bug: when an upstream step was SKIPPED (condition evaluated to false),
downstream steps were incorrectly marked FAILED instead of running.

Fix: SKIPPED is not in BLOCKING_STATUSES; only FAILED blocks dependents.
[invariant_failed_step_blocks_dependents] is preserved — FAILED still blocks.
"""

from __future__ import annotations

import pytest

from policy_engine.executor import (
 AuditLog,
 ExecutionPlan,
 ExecutionPlanner,
 StepStatus,
 WorkflowExecutor,
)
from policy_engine.loader import WorkflowLoader
from policy_engine.policy import PolicyEngine


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_engine() -> tuple[PolicyEngine, AuditLog, ExecutionPlanner, WorkflowExecutor]:
 policy = PolicyEngine()
 audit = AuditLog()
 planner = ExecutionPlanner(policy)
 executor = WorkflowExecutor(audit, policy)
 return policy, audit, planner, executor


def _run(yaml_text: str, context: dict) -> dict:
 loader = WorkflowLoader()
 workflow = loader.load_string(yaml_text)
 _, _, planner, executor = _make_engine()
 plan = planner.plan(workflow, context)
 return executor.execute(plan)


# ---------------------------------------------------------------------------
# Core regression: skipped upstream must NOT block downstream
# ---------------------------------------------------------------------------

WORKFLOW_SKIPPED_UPSTREAM = """
name: skipped-upstream-test
steps:
 - name: optional_deploy
 condition:
 equals:
 var: environment
 value: production
 action:
 type: echo
 message: deploying

 - name: notify
 depends_on: [optional_deploy]
 action:
 type: echo
 message: notifying
"""


def test_skipped_upstream_does_not_block_downstream():
 """
 Reproduces the P5 bug.

 Before fix: 'notify' was FAILED because 'optional_deploy' was SKIPPED.
 After fix: 'notify' is SUCCESS because SKIPPED is non-blocking.
 """
 states = _run(WORKFLOW_SKIPPED_UPSTREAM, context={"environment": "staging"})

 assert states["optional_deploy"].status == StepStatus.SKIPPED, (
 "optional_deploy should be SKIPPED when environment!= production"
 )
 assert states["notify"].status == StepStatus.SUCCESS, (
 "notify should succeed — a SKIPPED predecessor must not block dependents"
 )


def test_skipped_upstream_audit_entries_present():
 """Audit log must record both the skip and the downstream success."""
 loader = WorkflowLoader()
 workflow = loader.load_string(WORKFLOW_SKIPPED_UPSTREAM)
 policy = PolicyEngine()
 audit = AuditLog()
 planner = ExecutionPlanner(policy)
 executor = WorkflowExecutor(audit, policy)

 plan = planner.plan(workflow, {"environment": "staging"})
 executor.execute(plan)

 events = {e.step_name: e.event for e in audit.entries()}
 assert events.get("optional_deploy") == "step_skipped"
 assert events.get("notify") == "step_succeeded"


# ---------------------------------------------------------------------------
# Invariant preserved: FAILED still blocks dependents
# ---------------------------------------------------------------------------

WORKFLOW_FAILED_UPSTREAM = """
name: failed-upstream-test
steps:
 - name: build
 action:
 type: fail
 message: build exploded

 - name: deploy
 depends_on: [build]
 action:
 type: echo
 message: deploying
"""


def test_failed_upstream_still_blocks_downstream():
 """
 [invariant_failed_step_blocks_dependents] must not be broken by the fix.
 A FAILED predecessor must still block its dependents.
 """
 states = _run(WORKFLOW_FAILED_UPSTREAM, context={})

 assert states["build"].status == StepStatus.FAILED
 assert states["deploy"].status == StepStatus.FAILED, (
 "deploy must be FAILED when its dependency 'build' failed"
 )


# ---------------------------------------------------------------------------
# Transitive skip: skip chain must not block terminal step
# ---------------------------------------------------------------------------

WORKFLOW_TRANSITIVE_SKIP = """
name: transitive-skip-test
steps:
 - name: step_a
 condition:
 equals:
 var: run_a
 value: "yes"
 action:
 type: noop

 - name: step_b
 depends_on: [step_a]
 condition:
 equals:
 var: run_b
 value: "yes"
 action:
 type: noop

 - name: step_c
 depends_on: [step_b]
 action:
 type: echo
 message: "step_c running"
"""


def test_transitive_skip_does_not_block_terminal():
 """
 step_a SKIPPED → step_b SKIPPED → step_c should still run.
 """
 states = _run(WORKFLOW_TRANSITIVE_SKIP, context={"run_a": "no", "run_b": "no"})

 assert states["step_a"].status == StepStatus.SKIPPED
 assert states["step_b"].status == StepStatus.SKIPPED
 assert states["step_c"].status == StepStatus.SUCCESS, (
 "step_c must run even when all its transitive predecessors are SKIPPED"
 )


# ---------------------------------------------------------------------------
# Mixed: one dep skipped, one dep succeeded → downstream runs
# ---------------------------------------------------------------------------

WORKFLOW_MIXED_DEPS = """
name: mixed-deps-test
steps:
 - name: optional_step
 condition:
 equals:
 var: flag
 value: "on"
 action:
 type: noop

 - name: required_step
 action:
 type: echo
 message: required

 - name: final_step
 depends_on: [optional_step, required_step]
 action:
 type: echo
 message: final
"""


def test_mixed_deps_skipped_and_succeeded():
 """
 final_step depends on optional_step (SKIPPED) and required_step (SUCCESS).
 final_step must run.
 """
 states = _run(WORKFLOW_MIXED_DEPS, context={"flag": "off"})

 assert states["optional_step"].status == StepStatus.SKIPPED
 assert states["required_step"].status == StepStatus.SUCCESS
 assert states["final_step"].status == StepStatus.SUCCESS


# ---------------------------------------------------------------------------
# Mixed: one dep failed, one dep skipped → downstream blocked
# ---------------------------------------------------------------------------

WORKFLOW_MIXED_FAIL_SKIP = """
name: mixed-fail-skip-test
steps:
 - name: optional_step
 condition:
 equals:
 var: flag
 value: "on"
 action:
 type: noop

 - name: failing_step
 action:
 type: fail
 message: forced failure

 - name: final_step
 depends_on: [optional_step, failing_step]
 action:
 type: echo
 message: final
"""


def test_mixed_deps_skipped_and_failed_blocks():
 """
 final_step depends on optional_step (SKIPPED) and failing_step (FAILED).
 final_step must be FAILED because failing_step is a blocking dependency.
 """
 states = _run(WORKFLOW_MIXED_FAIL_SKIP, context={"flag": "off"})

 assert states["optional_step"].status == StepStatus.SKIPPED
 assert states["failing_step"].status == StepStatus.FAILED
 assert states["final_step"].status == StepStatus.FAILED, (
 "final_step must be blocked when any dependency is FAILED"
 )


# ---------------------------------------------------------------------------
# Audit immutability: entries are never removed after execution
# ---------------------------------------------------------------------------

def test_audit_log_is_append_only():
 """[invariant_audit_append_only] — entries cannot be removed."""
 loader = WorkflowLoader()
 workflow = loader.load_string(WORKFLOW_SKIPPED_UPSTREAM)
 policy = PolicyEngine()
 audit = AuditLog()
 planner = ExecutionPlanner(policy)
 executor = WorkflowExecutor(audit, policy)

 plan = planner.plan(workflow, {"environment": "staging"})
 executor.execute(plan)

 snapshot_before = audit.entries()
 count_before = len(snapshot_before)

 # Simulate an attempt to clear entries externally — the public API
 # returns a copy, so the internal list is unaffected.
 snapshot_before.clear()

 assert len(audit.entries()) == count_before, (
 "Clearing the snapshot must not affect the internal audit log"
 )