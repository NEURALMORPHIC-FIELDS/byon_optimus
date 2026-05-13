"""Tests for the 'plan' CLI subcommand and PlanRenderer.render_dict.

REQ_TESTS_NOT_OPTIONAL: covers all new behaviour introduced in P4.
"""
from __future__ import annotations
import json
import textwrap
from pathlib import Path

import pytest

from policy_engine.models import WorkflowDefinition, WorkflowStep, StepCondition
from policy_engine.planner import build_plan, PlanRenderer, PlanError
from policy_engine.cli import main as cli_main


# ── helpers ───────────────────────────────────────────────────────────────────

def _write(tmp_path: Path, name: str, content: str) -> Path:
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


def make_wf(*steps: WorkflowStep, name: str = "plan-test") -> WorkflowDefinition:
    return WorkflowDefinition(name=name, steps=list(steps))


def simple_step(name: str, depends_on=None, gates=None, env="dev") -> WorkflowStep:
    return WorkflowStep(
        name=name,
        action="noop",
        depends_on=depends_on or [],
        policy_gates=gates or [],
        environment=env,
    )


# ── PlanRenderer.render (existing API — must not regress) ─────────────────────

def test_render_contains_workflow_name():
    wf = make_wf(simple_step("build"))
    plan = build_plan(wf)
    text = PlanRenderer().render(plan)
    assert "plan-test" in text


def test_render_lists_steps_in_order():
    # Workflow name must share NO substring with any step name.
    # Step names: "alpha", "bravo", "delta" — none appear in "sequential-workflow".
    wf = make_wf(
        simple_step("alpha"),
        simple_step("bravo", depends_on=["alpha"]),
        simple_step("delta", depends_on=["bravo"], gates=["dev-gate"]),
        name="sequential-workflow",
    )
    plan = build_plan(wf)
    text = PlanRenderer().render(plan)
    pos_alpha = text.index("alpha")
    pos_bravo = text.index("bravo")
    pos_delta = text.index("delta")
    assert pos_alpha < pos_bravo < pos_delta


def test_render_shows_gates():
    wf = make_wf(simple_step("deploy", gates=["prod-gate"]))
    plan = build_plan(wf)
    text = PlanRenderer().render(plan)
    assert "prod-gate" in text


def test_render_shows_no_gates_when_empty():
    wf = make_wf(simple_step("build"))
    plan = build_plan(wf)
    text = PlanRenderer().render(plan)
    assert "none" in text


def test_render_shows_condition():
    step = WorkflowStep(
        name="deploy",
        action="deploy",
        environment="prod",
        policy_gates=[],
        condition=StepCondition(operator="equals", var="env", value="prod"),
    )
    wf = make_wf(step)
    plan = build_plan(wf)
    text = PlanRenderer().render(plan)
    assert "condition" in text
    assert "env" in text
    assert "prod" in text


# ── PlanRenderer.render_dict ──────────────────────────────────────────────────

def test_render_dict_top_level_keys():
    wf = make_wf(simple_step("build"))
    plan = build_plan(wf)
    d = PlanRenderer().render_dict(plan)
    assert set(d.keys()) == {"workflow", "step_count", "steps"}


def test_render_dict_workflow_name():
    wf = make_wf(simple_step("build"))
    plan = build_plan(wf)
    d = PlanRenderer().render_dict(plan)
    assert d["workflow"] == "plan-test"


def test_render_dict_step_count():
    wf = make_wf(simple_step("a"), simple_step("b", depends_on=["a"]))
    plan = build_plan(wf)
    d = PlanRenderer().render_dict(plan)
    assert d["step_count"] == 2
    assert len(d["steps"]) == 2


def test_render_dict_step_order_field():
    wf = make_wf(
        simple_step("a"),
        simple_step("b", depends_on=["a"]),
        simple_step("c", depends_on=["b"]),
    )
    plan = build_plan(wf)
    d = PlanRenderer().render_dict(plan)
    orders = [s["order"] for s in d["steps"]]
    assert orders == [1, 2, 3]


def test_render_dict_step_names_in_topo_order():
    wf = make_wf(
        simple_step("a"),
        simple_step("b", depends_on=["a"]),
    )
    plan = build_plan(wf)
    d = PlanRenderer().render_dict(plan)
    names = [s["name"] for s in d["steps"]]
    assert names.index("a") < names.index("b")


def test_render_dict_gates_list():
    wf = make_wf(simple_step("deploy", gates=["dev-gate", "any-gate"]))
    plan = build_plan(wf)
    d = PlanRenderer().render_dict(plan)
    assert d["steps"][0]["policy_gates"] == ["dev-gate", "any-gate"]


def test_render_dict_depends_on_list():
    wf = make_wf(
        simple_step("build"),
        simple_step("check", depends_on=["build"]),
    )
    plan = build_plan(wf)
    d = PlanRenderer().render_dict(plan)
    check_entry = next(s for s in d["steps"] if s["name"] == "check")
    assert check_entry["depends_on"] == ["build"]


def test_render_dict_condition_none_when_absent():
    wf = make_wf(simple_step("build"))
    plan = build_plan(wf)
    d = PlanRenderer().render_dict(plan)
    assert d["steps"][0]["condition"] is None


def test_render_dict_condition_present():
    step = WorkflowStep(
        name="deploy",
        action="deploy",
        environment="prod",
        policy_gates=[],
        condition=StepCondition(operator="equals", var="env", value="prod"),
    )
    wf = make_wf(step)
    plan = build_plan(wf)
    d = PlanRenderer().render_dict(plan)
    cond = d["steps"][0]["condition"]
    assert cond == {"operator": "equals", "var": "env", "value": "prod"}


def test_render_dict_is_json_serialisable():
    """render_dict output must be JSON-serialisable (no custom objects)."""
    wf = make_wf(
        simple_step("build"),
        simple_step("deploy", depends_on=["build"], gates=["dev-gate"]),
    )
    plan = build_plan(wf)
    d = PlanRenderer().render_dict(plan)
    # Must not raise
    serialised = json.dumps(d)
    reparsed = json.loads(serialised)
    assert reparsed["workflow"] == "plan-test"


# ── CLI: plan subcommand ──────────────────────────────────────────────────────

def test_cli_plan_exits_zero(tmp_path, capsys):
    p = _write(tmp_path, "wf.yaml", textwrap.dedent("""\
        name: my-workflow
        steps:
          - name: build
            action: build_image
            environment: dev
            policy_gates: [dev-gate]
          - name: deploy
            action: deploy
            environment: dev
            depends_on: [build]
            policy_gates: [dev-gate]
    """))
    exit_code = cli_main(["plan", str(p)])
    assert exit_code == 0


def test_cli_plan_output_contains_workflow_name(tmp_path, capsys):
    p = _write(tmp_path, "wf.yaml", textwrap.dedent("""\
        name: my-workflow
        steps:
          - name: build
            action: build_image
            environment: dev
    """))
    cli_main(["plan", str(p)])
    captured = capsys.readouterr()
    assert "my-workflow" in captured.out


def test_cli_plan_output_contains_machine_readable(tmp_path, capsys):
    p = _write(tmp_path, "wf.yaml", textwrap.dedent("""\
        name: my-workflow
        steps:
          - name: build
            action: build_image
            environment: dev
    """))
    cli_main(["plan", str(p)])
    captured = capsys.readouterr()
    assert "machine-readable" in captured.out
    # Must be valid JSON after the separator line
    lines = captured.out.split("\n")
    sep_idx = next(i for i, l in enumerate(lines) if "machine-readable" in l)
    json_text = "\n".join(lines[sep_idx + 1:])
    parsed = json.loads(json_text)
    assert parsed["workflow"] == "my-workflow"


def test_cli_plan_invalid_file_exits_nonzero(tmp_path):
    p = _write(tmp_path, "bad.yaml", textwrap.dedent("""\
        name: bad
        policy_gate: bypass_all
        steps: []
    """))
    exit_code = cli_main(["plan", str(p)])
    assert exit_code != 0


def test_cli_validate_exits_zero(tmp_path):
    p = _write(tmp_path, "wf.yaml", textwrap.dedent("""\
        name: valid
        steps:
          - name: build
            action: build_image
            environment: dev
    """))
    exit_code = cli_main(["validate", str(p)])
    assert exit_code == 0


def test_cli_validate_exits_nonzero_on_bad_file(tmp_path):
    p = _write(tmp_path, "bad.yaml", textwrap.dedent("""\
        name: bad
        policy_gate: bypass_all
        steps: []
    """))
    exit_code = cli_main(["validate", str(p)])
    assert exit_code != 0


def test_cli_run_exits_zero_for_permitted_role(tmp_path):
    p = _write(tmp_path, "wf.yaml", textwrap.dedent("""\
        name: dev-workflow
        steps:
          - name: build
            action: build_image
            environment: dev
            policy_gates: [dev-gate]
    """))
    exit_code = cli_main(["run", str(p), "--role", "developer"])
    assert exit_code == 0


def test_cli_run_exits_nonzero_for_denied_gate(tmp_path):
    p = _write(tmp_path, "wf.yaml", textwrap.dedent("""\
        name: prod-workflow
        steps:
          - name: deploy
            action: deploy
            environment: prod
            policy_gates: [prod-gate]
    """))
    exit_code = cli_main(["run", str(p), "--role", "developer"])
    assert exit_code != 0