"""Tests for Phase P4: ExecutionPlan, PlanStep, PlanValidator (with permissions),
PlanRenderer (text + dict), build_plan (with/without permissions), and the
'workflow plan' CLI subcommand.

REQ_TESTS_NOT_OPTIONAL — all new behaviour is covered here.
"""
from __future__ import annotations
import json
import pathlib

import pytest

from policy_engine.models import (
    ExecutionPlan,
    PlanStep,
    StepCondition,
    WorkflowDefinition,
    WorkflowStep,
)
from policy_engine.permissions import PermissionModel
from policy_engine.planner import PlanError, PlanRenderer, PlanValidator, build_plan
from policy_engine.cli import main as cli_main


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _simple_wf() -> WorkflowDefinition:
    return WorkflowDefinition(
        name="simple",
        steps=[
            WorkflowStep(name="build", action="compile"),
            WorkflowStep(name="test", action="pytest", depends_on=["build"]),
            WorkflowStep(
                name="deploy",
                action="ship",
                depends_on=["test"],
                policy_gates=["dev-gate"],
            ),
        ],
    )


def _prod_wf() -> WorkflowDefinition:
    return WorkflowDefinition(
        name="prod",
        steps=[
            WorkflowStep(name="build", action="compile"),
            WorkflowStep(
                name="release",
                action="deploy",
                depends_on=["build"],
                policy_gates=["prod-gate"],
                environment="prod",
            ),
            WorkflowStep(
                name="notify",
                action="notify",
                depends_on=["release"],
            ),
        ],
    )


def _write(tmp_path: pathlib.Path, name: str, content: str) -> pathlib.Path:
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


# ---------------------------------------------------------------------------
# PlanStep dataclass
# ---------------------------------------------------------------------------

class TestPlanStep:
    def test_plan_step_fields(self):
        step = WorkflowStep(name="s", action="x")
        ps = PlanStep(step=step, decision="run", predicted_policy="no gates")
        assert ps.step is step
        assert ps.decision == "run"
        assert ps.predicted_policy == "no gates"

    def test_plan_step_gate_denied(self):
        step = WorkflowStep(name="s", action="x", policy_gates=["prod-gate"])
        ps = PlanStep(
            step=step,
            decision="gate_denied",
            predicted_policy="gate_denied: prod-gate denied for role 'developer'",
        )
        assert ps.decision == "gate_denied"
        assert "prod-gate" in ps.predicted_policy


# ---------------------------------------------------------------------------
# ExecutionPlan — backward compatibility
# ---------------------------------------------------------------------------

class TestExecutionPlanBackwardCompat:
    """ordered_steps must still be present and usable by PolicyEngine."""

    def test_ordered_steps_present(self):
        plan = build_plan(_simple_wf())
        assert len(plan.ordered_steps) == 3

    def test_plan_steps_present(self):
        plan = build_plan(_simple_wf())
        assert len(plan.plan_steps) == 3

    def test_ordered_steps_and_plan_steps_same_order(self):
        plan = build_plan(_simple_wf())
        ordered_names = [s.name for s in plan.ordered_steps]
        plan_names = [ps.step.name for ps in plan.plan_steps]
        assert ordered_names == plan_names

    def test_plan_steps_default_empty_list_without_build_plan(self):
        """ExecutionPlan can be constructed without plan_steps (default=[])."""
        wf = _simple_wf()
        plan = ExecutionPlan(workflow=wf, ordered_steps=wf.steps)
        assert plan.plan_steps == []


# ---------------------------------------------------------------------------
# build_plan — without permissions
# ---------------------------------------------------------------------------

class TestBuildPlanWithoutPermissions:
    def test_returns_execution_plan(self):
        plan = build_plan(_simple_wf())
        assert isinstance(plan, ExecutionPlan)

    def test_all_decisions_run_when_no_permissions(self):
        plan = build_plan(_simple_wf())
        for ps in plan.plan_steps:
            assert ps.decision == "run"

    def test_predicted_policy_unknown_when_no_permissions(self):
        plan = build_plan(_simple_wf())
        for ps in plan.plan_steps:
            assert "unknown" in ps.predicted_policy

    def test_topological_order_preserved(self):
        plan = build_plan(_simple_wf())
        names = [s.name for s in plan.ordered_steps]
        assert names.index("build") < names.index("test")
        assert names.index("test") < names.index("deploy")


# ---------------------------------------------------------------------------
# build_plan — with permissions
# ---------------------------------------------------------------------------

class TestBuildPlanWithPermissions:
    def test_dev_role_passes_dev_gate(self):
        perms = PermissionModel(role="developer")
        plan = build_plan(_simple_wf(), permissions=perms)
        deploy_ps = next(ps for ps in plan.plan_steps if ps.step.name == "deploy")
        assert deploy_ps.decision == "run"
        assert "all gates pass" in deploy_ps.predicted_policy

    def test_dev_role_denied_prod_gate(self):
        perms = PermissionModel(role="developer")
        plan = build_plan(_prod_wf(), permissions=perms)
        release_ps = next(ps for ps in plan.plan_steps if ps.step.name == "release")
        assert release_ps.decision == "gate_denied"
        assert "prod-gate" in release_ps.predicted_policy
        assert "developer" in release_ps.predicted_policy

    def test_release_manager_passes_prod_gate(self):
        perms = PermissionModel(role="release-manager")
        plan = build_plan(_prod_wf(), permissions=perms)
        release_ps = next(ps for ps in plan.plan_steps if ps.step.name == "release")
        assert release_ps.decision == "run"

    def test_blocked_propagates_from_gate_denied(self):
        """notify depends on release; if release is gate_denied, notify is blocked."""
        perms = PermissionModel(role="developer")
        plan = build_plan(_prod_wf(), permissions=perms)
        notify_ps = next(ps for ps in plan.plan_steps if ps.step.name == "notify")
        assert notify_ps.decision == "blocked"

    def test_no_gates_step_shows_no_gates(self):
        perms = PermissionModel(role="developer")
        plan = build_plan(_simple_wf(), permissions=perms)
        build_ps = next(ps for ps in plan.plan_steps if ps.step.name == "build")
        assert build_ps.decision == "run"
        assert "no gates" in build_ps.predicted_policy

    def test_multiple_gates_all_pass(self):
        from policy_engine.models import PolicyGate
        extra = {"custom-gate": PolicyGate(name="custom-gate", required_role="developer")}
        perms = PermissionModel(role="developer", extra_gates=extra)
        wf = WorkflowDefinition(
            name="multi-gate",
            steps=[
                WorkflowStep(
                    name="step",
                    action="x",
                    policy_gates=["dev-gate", "custom-gate"],
                )
            ],
        )
        plan = build_plan(wf, permissions=perms)
        ps = plan.plan_steps[0]
        assert ps.decision == "run"
        assert "dev-gate" in ps.predicted_policy
        assert "custom-gate" in ps.predicted_policy

    def test_multiple_gates_one_denied(self):
        perms = PermissionModel(role="developer")
        wf = WorkflowDefinition(
            name="mixed-gates",
            steps=[
                WorkflowStep(
                    name="step",
                    action="x",
                    policy_gates=["dev-gate", "prod-gate"],
                    environment="prod",
                )
            ],
        )
        plan = build_plan(wf, permissions=perms)
        ps = plan.plan_steps[0]
        assert ps.decision == "gate_denied"
        assert "prod-gate" in ps.predicted_policy


# ---------------------------------------------------------------------------
# PlanValidator — with permissions (informational unknown-gate surfacing)
# ---------------------------------------------------------------------------

class TestPlanValidatorWithPermissions:
    def test_valid_dag_passes(self):
        perms = PermissionModel(role="developer")
        PlanValidator().validate(_simple_wf(), permissions=perms)  # no exception

    def test_unknown_dep_raises(self):
        wf = WorkflowDefinition(
            name="bad",
            steps=[WorkflowStep(name="s1", action="x", depends_on=["ghost"])],
        )
        with pytest.raises(PlanError, match="unknown step"):
            PlanValidator().validate(wf)

    def test_cycle_raises(self):
        wf = WorkflowDefinition(
            name="cycle",
            steps=[
                WorkflowStep(name="a", action="x", depends_on=["b"]),
                WorkflowStep(name="b", action="x", depends_on=["a"]),
            ],
        )
        with pytest.raises(PlanError, match="Cycle"):
            PlanValidator().validate(wf)

    def test_validate_with_permissions_does_not_raise_for_unknown_gate(self):
        """Unknown gate names are denied at runtime but do NOT raise at validation time.
        They are surfaced via PlanStep.predicted_policy in build_plan."""
        perms = PermissionModel(role="developer")
        wf = WorkflowDefinition(
            name="unknown-gate-wf",
            steps=[
                WorkflowStep(name="s", action="x", policy_gates=["nonexistent-gate"])
            ],
        )
        # Should not raise — unknown gates are a runtime deny, not a structural error
        PlanValidator().validate(wf, permissions=perms)  # no exception


# ---------------------------------------------------------------------------
# PlanRenderer — text output
# ---------------------------------------------------------------------------

class TestPlanRendererText:
    def test_render_contains_workflow_name(self):
        plan = build_plan(_simple_wf())
        text = PlanRenderer().render(plan)
        assert "simple" in text

    def test_render_contains_all_step_names(self):
        plan = build_plan(_simple_wf())
        text = PlanRenderer().render(plan)
        assert "build" in text
        assert "test" in text
        assert "deploy" in text

    def test_render_with_permissions_shows_decision(self):
        perms = PermissionModel(role="developer")
        plan = build_plan(_simple_wf(), permissions=perms)
        text = PlanRenderer().render(plan)
        assert "run" in text

    def test_render_with_permissions_shows_gate_denied(self):
        perms = PermissionModel(role="developer")
        plan = build_plan(_prod_wf(), permissions=perms)
        text = PlanRenderer().render(plan)
        assert "gate_denied" in text

    def test_render_without_permissions_no_decision_shown(self):
        """Backward-compat path: no PlanStep data → no decision arrow."""
        wf = _simple_wf()
        plan = ExecutionPlan(workflow=wf, ordered_steps=wf.steps)
        text = PlanRenderer().render(plan)
        # Should still render step names
        assert "build" in text
        # No decision arrow in backward-compat path
        assert "→" not in text

    def test_render_shows_condition(self):
        wf = WorkflowDefinition(
            name="cond-wf",
            steps=[
                WorkflowStep(
                    name="deploy",
                    action="ship",
                    condition=StepCondition(operator="equals", var="env", value="prod"),
                )
            ],
        )
        plan = build_plan(wf)
        text = PlanRenderer().render(plan)
        assert "equals" in text
        assert "env" in text


# ---------------------------------------------------------------------------
# PlanRenderer — dict output
# ---------------------------------------------------------------------------

class TestPlanRendererDict:
    def test_render_dict_returns_list(self):
        plan = build_plan(_simple_wf())
        result = PlanRenderer().render_dict(plan)
        assert isinstance(result, list)
        assert len(result) == 3

    def test_render_dict_keys_present(self):
        plan = build_plan(_simple_wf())
        result = PlanRenderer().render_dict(plan)
        expected_keys = {
            "name", "action", "environment", "depends_on",
            "policy_gates", "condition", "decision", "predicted_policy",
        }
        for entry in result:
            assert expected_keys == set(entry.keys())

    def test_render_dict_with_permissions(self):
        perms = PermissionModel(role="developer")
        plan = build_plan(_prod_wf(), permissions=perms)
        result = PlanRenderer().render_dict(plan)
        release = next(e for e in result if e["name"] == "release")
        assert release["decision"] == "gate_denied"

    def test_render_dict_condition_serialised(self):
        wf = WorkflowDefinition(
            name="cond-wf",
            steps=[
                WorkflowStep(
                    name="deploy",
                    action="ship",
                    condition=StepCondition(operator="equals", var="env", value="prod"),
                )
            ],
        )
        plan = build_plan(wf)
        result = PlanRenderer().render_dict(plan)
        cond = result[0]["condition"]
        assert cond is not None
        assert cond["operator"] == "equals"
        assert cond["var"] == "env"
        assert cond["value"] == "prod"

    def test_render_dict_no_condition_is_none(self):
        plan = build_plan(_simple_wf())
        result = PlanRenderer().render_dict(plan)
        build_entry = next(e for e in result if e["name"] == "build")
        assert build_entry["condition"] is None

    def test_render_dict_backward_compat_no_plan_steps(self):
        """render_dict on a plan with no plan_steps uses ordered_steps fallback."""
        wf = _simple_wf()
        plan = ExecutionPlan(workflow=wf, ordered_steps=wf.steps)
        result = PlanRenderer().render_dict(plan)
        assert len(result) == 3
        for entry in result:
            assert entry["decision"] == "run"
            assert "unknown" in entry["predicted_policy"]


# ---------------------------------------------------------------------------
# CLI — 'workflow plan' subcommand
# ---------------------------------------------------------------------------

_SIMPLE_YAML = """\
name: simple
steps:
  - name: build
    action: compile
  - name: test
    action: pytest
    depends_on: [build]
  - name: deploy
    action: ship
    depends_on: [test]
    policy_gates: [dev-gate]
"""

_PROD_YAML = """\
name: prod
steps:
  - name: build
    action: compile
  - name: release
    action: deploy
    depends_on: [build]
    policy_gates: [prod-gate]
    environment: prod
  - name: notify
    action: notify
    depends_on: [release]
"""


class TestCLIPlanSubcommand:
    def test_plan_text_output_exits_zero(self, tmp_path, capsys):
        p = _write(tmp_path, "wf.yaml", _SIMPLE_YAML)
        with pytest.raises(SystemExit) as exc:
            cli_main(["plan", str(p)])
        assert exc.value.code == 0

    def test_plan_text_output_contains_workflow_name(self, tmp_path, capsys):
        p = _write(tmp_path, "wf.yaml", _SIMPLE_YAML)
        with pytest.raises(SystemExit):
            cli_main(["plan", str(p)])
        out = capsys.readouterr().out
        assert "simple" in out

    def test_plan_text_output_contains_step_names(self, tmp_path, capsys):
        p = _write(tmp_path, "wf.yaml", _SIMPLE_YAML)
        with pytest.raises(SystemExit):
            cli_main(["plan", str(p)])
        out = capsys.readouterr().out
        assert "build" in out
        assert "test" in out
        assert "deploy" in out

    def test_plan_json_output_is_valid_json(self, tmp_path, capsys):
        p = _write(tmp_path, "wf.yaml", _SIMPLE_YAML)
        with pytest.raises(SystemExit):
            cli_main(["plan", str(p), "--format", "json"])
        out = capsys.readouterr().out
        data = json.loads(out)
        assert isinstance(data, list)
        assert len(data) == 3

    def test_plan_json_output_has_required_keys(self, tmp_path, capsys):
        p = _write(tmp_path, "wf.yaml", _SIMPLE_YAML)
        with pytest.raises(SystemExit):
            cli_main(["plan", str(p), "--format", "json"])
        out = capsys.readouterr().out
        data = json.loads(out)
        for entry in data:
            assert "name" in entry
            assert "decision" in entry
            assert "predicted_policy" in entry

    def test_plan_with_role_developer_shows_gate_denied_for_prod(self, tmp_path, capsys):
        p = _write(tmp_path, "prod.yaml", _PROD_YAML)
        with pytest.raises(SystemExit):
            cli_main(["plan", str(p), "--role", "developer", "--format", "json"])
        out = capsys.readouterr().out
        data = json.loads(out)
        release = next(e for e in data if e["name"] == "release")
        assert release["decision"] == "gate_denied"

    def test_plan_with_role_release_manager_passes_prod_gate(self, tmp_path, capsys):
        p = _write(tmp_path, "prod.yaml", _PROD_YAML)
        with pytest.raises(SystemExit):
            cli_main(["plan", str(p), "--role", "release-manager", "--format", "json"])
        out = capsys.readouterr().out
        data = json.loads(out)
        release = next(e for e in data if e["name"] == "release")
        assert release["decision"] == "run"

    def test_plan_missing_file_exits_nonzero(self, tmp_path, capsys):
        with pytest.raises(SystemExit) as exc:
            cli_main(["plan", str(tmp_path / "nonexistent.yaml")])
        assert exc.value.code != 0

    def test_plan_does_not_write_audit_entries(self, tmp_path, capsys):
        """'workflow plan' must not produce audit side-effects for the workflow."""
        from policy_engine import cli as cli_module
        before = len(cli_module._GLOBAL_AUDIT.entries)
        p = _write(tmp_path, "wf.yaml", _SIMPLE_YAML)
        with pytest.raises(SystemExit):
            cli_main(["plan", str(p)])
        after = len(cli_module._GLOBAL_AUDIT.entries)
        assert after == before

    def test_plan_blocked_step_shown_in_json(self, tmp_path, capsys):
        """notify is blocked when release is gate_denied for developer."""
        p = _write(tmp_path, "prod.yaml", _PROD_YAML)
        with pytest.raises(SystemExit):
            cli_main(["plan", str(p), "--role", "developer", "--format", "json"])
        out = capsys.readouterr().out
        data = json.loads(out)
        notify = next(e for e in data if e["name"] == "notify")
        assert notify["decision"] == "blocked"

    def test_existing_explain_subcommand_still_works(self, tmp_path, capsys):
        """Regression: 'workflow explain' must still work after P4 changes."""
        p = _write(tmp_path, "wf.yaml", _SIMPLE_YAML)
        with pytest.raises(SystemExit) as exc:
            cli_main(["explain", str(p)])
        assert exc.value.code == 0
        out = capsys.readouterr().out
        assert "simple" in out
        assert "build" in out