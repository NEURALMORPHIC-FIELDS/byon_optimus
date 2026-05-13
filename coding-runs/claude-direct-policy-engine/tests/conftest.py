import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import pytest

from policy_engine.audit import AuditLog
from policy_engine.models import PolicyGate, Step, Workflow
from policy_engine.permissions import PermissionModel
from policy_engine.policy_mode import PolicyMode


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def audit():
    return AuditLog()


@pytest.fixture()
def base_permission_model():
    return PermissionModel()


@pytest.fixture()
def simple_two_step_workflow():
    """build → deploy, both gated on dev_gate."""
    gate = PolicyGate(name="dev_gate", required_role="developer")
    steps = [
        Step(id="build",  name="Build",  action="build.run",  policy_gates=["dev_gate"]),
        Step(id="deploy", name="Deploy", action="deploy.run",
             depends_on=["build"], policy_gates=["dev_gate"]),
    ]
    return Workflow(
        name="two-step", version="1.0",
        steps=steps,
        gates={"dev_gate": gate},
    )


@pytest.fixture()
def three_step_linear_workflow():
    """checkout → build → deploy (no gates, no conditions)."""
    steps = [
        Step(id="checkout", name="Checkout", action="git.checkout"),
        Step(id="build",    name="Build",    action="build.run",    depends_on=["checkout"]),
        Step(id="deploy",   name="Deploy",   action="deploy.run",   depends_on=["build"]),
    ]
    return Workflow(name="linear", version="1.0", steps=steps, gates={})


@pytest.fixture()
def permissive_engine_factory(audit):
    """
    Operator-controlled fixture — creates WorkflowEngine in PERMISSIVE mode.
    Safe alternative to 'bypass_all in YAML':
      * mode set here in trusted test code, not in workflow YAML
      * every gate override recorded as 'gate_overridden'
      * disabled by default; tests must explicitly request this fixture
    """
    from policy_engine.engine import WorkflowEngine

    def _factory(workflow, roles=None, variables=None):
        return WorkflowEngine(
            workflow         = workflow,
            audit            = audit,
            permission_model = PermissionModel(),
            actor_roles      = roles     or [],
            variables        = variables or {},
            policy_mode      = PolicyMode.PERMISSIVE,
        )

    return _factory


@pytest.fixture()
def make_planner():
    """Factory for Planner instances with sensible defaults."""
    from policy_engine.planner import Planner

    def _factory(workflow, roles=None, variables=None,
                 perm=None, mode=PolicyMode.ENFORCING):
        return Planner(
            workflow         = workflow,
            permission_model = perm or PermissionModel(),
            actor_roles      = roles     or [],
            variables        = variables or {},
            policy_mode      = mode,
        )

    return _factory