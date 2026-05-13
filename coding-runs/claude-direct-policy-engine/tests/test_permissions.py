"""Tests for PermissionModel."""
from policy_engine.permissions import PermissionModel, PRODUCTION_GATES


def test_developer_role_passes_dev_gate():
    perm = PermissionModel()
    assert perm.allowed("dev_gate", ["developer"]) is True


def test_developer_role_fails_qa_gate():
    perm = PermissionModel()
    assert perm.allowed("qa_gate", ["developer"]) is False


def test_production_gate_denied_by_default():
    perm = PermissionModel()
    for gate in PRODUCTION_GATES:
        assert perm.allowed(gate, ["release_manager", "developer", "qa"]) is False


def test_production_gate_allowed_after_explicit_grant():
    perm = PermissionModel(
        role_gates={"release_manager": {"production_approval"}},
        production_grants={"production_approval"},
    )
    assert perm.allowed("production_approval", ["release_manager"]) is True


def test_multiple_roles_any_match():
    perm = PermissionModel()
    # qa has qa_gate; developer does not
    assert perm.allowed("qa_gate", ["developer", "qa"]) is True