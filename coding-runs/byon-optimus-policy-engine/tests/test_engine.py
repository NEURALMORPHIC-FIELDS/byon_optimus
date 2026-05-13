"""
Integration tests for WorkflowEngine.

Covers:
  - Happy path execution
  - Dependency ordering
  - Failed step blocks dependents [invariant_failed_step_blocks_dependents]
  - Condition evaluation (true / false / error)
  - Policy denial stops step execution
  - Rollback is audited [invariant_rollback_preserves_audit]
  - Audit log is append-only [invariant_audit_append_only]
"""

from __future__ import annotations

import pytest

from policy_engine.audit import AuditLog
from policy_engine.engine import WorkflowEngine
from policy_engine.loader import load_workflow_dict
from policy_engine.models import Step, WorkflowDefinition
from policy_engine.policy import PolicyEngine, PolicyGrants, PolicyMode


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_engine(
    allow_production: bool = False,
    mode: str = PolicyMode.ENFORCING,
) -> tuple[WorkflowEngine, AuditLog]:
    audit = AuditLog()
    grants = PolicyGrants(allow_production=allow_production)
    policy = PolicyEngine(grants=grants, audit=audit, mode=mode)
    engine = WorkflowEngine(policy=policy, audit=audit)
    return engine, audit


def _simple_workflow(steps_data: list[dict]) -> WorkflowDefinition:
    audit = AuditLog()
    return load_workflow_dict({"name": "test-wf", "steps": steps_data}, audit)


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------

class TestHappyPath:
    def test_single_step_completes(self):
        engine, audit = _make_engine()
        wf = _simple_workflow([{"name": "build", "action": "build"}])
        results = engine.run(wf, context={"environment": "staging"})
        assert results["build"]["status"] == "completed"

    def test_dependency_chain_completes_in_order(self):
        executed = []

        def make_action(name):
            def action(step, context):
                executed.append(name)
                return {}
            return action

        audit = AuditLog()
        grants = PolicyGrants.default()
        policy = PolicyEngine(grants=grants, audit=audit, mode=PolicyMode.ENFORCING)
        engine = WorkflowEngine(
            policy=policy,
            audit=audit,
            actions={
                "build": make_action("build"),
                "test": make_action("test"),
                "deploy": make_action("deploy"),
            },
        )
        wf = _simple_workflow([
            {"name": "build", "action": "build"},
            {"name": "test", "action": "test", "depends_on": ["build"]},
            {"name": "deploy", "action": "deploy", "depends_on": ["test"]},
        ])
        results = engine.run(wf, context={"environment": "staging"})
        assert executed == ["build", "test", "deploy"]
        assert all(r["status"] == "completed" for r in results.values())


# ---------------------------------------------------------------------------
# Dependency / failure propagation
# ---------------------------------------------------------------------------

class TestFailurePropagation:
    def test_failed_step_blocks_dependent(self):
        """[invariant_failed_step_blocks_dependents]"""
        def failing_action(step, context):
            raise RuntimeError("build exploded")

        audit = AuditLog()
        policy = PolicyEngine(
            grants=PolicyGrants.default(), audit=audit, mode=PolicyMode.ENFORCING
        )
        engine = WorkflowEngine(
            policy=policy,
            audit=audit,
            actions={"build": failing_action},
        )
        wf = _simple_workflow([
            {"name": "build", "action": "build"},
            {"name": "test", "action": "test", "depends_on": ["build"]},
            {"name": "deploy", "action": "deploy", "depends_on": ["test"]},
        ])
        results = engine.run(wf, context={"environment": "staging"})
        assert results["build"]["status"] == "failed"
        assert results["test"]["status"] == "skipped"
        assert results["deploy"]["status"] == "skipped"

    def test_failed_step_audit_entries(self):
        def failing_action(step, context):
            raise RuntimeError("oops")

        audit = AuditLog()
        policy = PolicyEngine(
            grants=PolicyGrants.default(), audit=audit, mode=PolicyMode.ENFORCING
        )
        engine = WorkflowEngine(
            policy=policy, audit=audit, actions={"build": failing_action}
        )
        wf = _simple_workflow([