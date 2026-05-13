"""CLI entry point.

Subcommands
-----------
  workflow validate <file>
  workflow run      <file>  [--var K=V …] [--roles …] [--policy-mode …]
  workflow plan     <file>  [--var K=V …] [--roles …] [--policy-mode …] [--json]
  workflow audit
  workflow explain  <file>

Public Python API changes in this phase
----------------------------------------
  WorkflowEngine now imports topological_order from policy_engine.topology
  (internal refactor — external callers are unaffected).

  Three new public types are available:
    policy_engine.planner       — ExecutionPlan, StepPlan, Decision, Planner
    policy_engine.plan_validator — PlanValidator, PlanViolation
    policy_engine.plan_renderer  — PlanRenderer
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict

from .audit import AuditLog
from .engine import WorkflowEngine
from .loader import WorkflowValidationError, load_workflow
from .permissions import PermissionModel
from .plan_renderer import PlanRenderer
from .plan_validator import PlanValidator
from .planner import Planner
from .policy_mode import PolicyMode, resolve_policy_mode

_AUDIT_LOG = AuditLog(jsonl_path=Path("workflow_audit.jsonl"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_vars(var_list: list) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for item in var_list or []:
        if "=" not in item:
            print(f"Warning: --var '{item}' ignored (expected key=value)", file=sys.stderr)
            continue
        k, _, v = item.partition("=")
        k = k.strip()
        try:
            result[k] = json.loads(v)
        except json.JSONDecodeError:
            result[k] = v
    return result


def _load_or_die(path: Path) -> Any:
    try:
        return load_workflow(path)
    except WorkflowValidationError as exc:
        _AUDIT_LOG.record("validate_rejected", f"File '{path}' rejected: {exc}")
        print(f"✗ Validation failed: {exc}", file=sys.stderr)
        sys.exit(1)


def _resolve_mode(args: argparse.Namespace) -> PolicyMode:
    return resolve_policy_mode(explicit=getattr(args, "policy_mode", None))


# ---------------------------------------------------------------------------
# Subcommand handlers
# ---------------------------------------------------------------------------

def cmd_validate(args: argparse.Namespace) -> int:
    path = Path(args.file)
    try:
        wf = load_workflow(path)
        print(f"✓ Workflow '{wf.name}' (v{wf.version}) is valid.")
        print(f"  Steps : {len(wf.steps)}")
        print(f"  Gates : {len(wf.gates)}")
        _AUDIT_LOG.record("validate", f"Validated workflow file '{path}'")
        return 0
    except WorkflowValidationError as exc:
        _AUDIT_LOG.record("validate_rejected", f"File '{path}' rejected: {exc}")
        print(f"✗ Validation failed: {exc}", file=sys.stderr)
        return 1


def cmd_run(args: argparse.Namespace) -> int:
    wf        = _load_or_die(Path(args.file))
    roles     = [r for r in args.roles.split(",") if r] if args.roles else []
    variables = _parse_vars(args.var)
    mode      = _resolve_mode(args)

    perm = PermissionModel()
    if args.grant_production:
        for gate in args.grant_production.split(","):
            perm.grant_production(gate.strip())

    engine = WorkflowEngine(
        wf, _AUDIT_LOG, perm,
        actor_roles=roles,
        variables=variables,
        policy_mode=mode,
    )
    success = engine.run()

    if not success and args.rollback_on_failure:
        print("Run failed — initiating rollback …")
        engine.rollback()

    _print_step_summary(wf.steps)
    return 0 if success else 2


def cmd_plan(args: argparse.Namespace) -> int:
    """Build and display the execution plan without running anything."""
    wf        = _load_or_die(Path(args.file))
    roles     = [r for r in args.roles.split(",") if r] if args.roles else []
    variables = _parse_vars(args.var)
    mode      = _resolve_mode(args)

    perm = PermissionModel()
    if getattr(args, "grant_production", ""):
        for gate in args.grant_production.split(","):
            perm.grant_production(gate.strip())

    planner = Planner(
        workflow         = wf,
        permission_model = perm,
        actor_roles      = roles,
        variables        = variables,
        policy_mode      = mode,
    )
    plan       = planner.build()
    validator  = PlanValidator()
    violations = validator.validate(plan)
    renderer   = PlanRenderer(colour=sys.stdout.isatty())

    _AUDIT_LOG.record(
        "plan_generated",
        f"Plan generated for '{wf.name}': would_succeed={plan.would_succeed()} "
        f"violations={len(violations)}",
    )

    if getattr(args, "json_output", False):
        print(renderer.render_json(plan, violations))
    else:
        print(renderer.render_text(plan, violations))

    # Exit 0 even when plan would fail — plan is informational only
    return 0


def cmd_audit(_args: argparse.Namespace) -> int:
    entries = _AUDIT_LOG.entries()
    if not entries:
        jpath = Path("workflow_audit.jsonl")
        if jpath.exists():
            for line in jpath.read_text().splitlines():
                if line.strip():
                    print(json.dumps(json.loads(line)))
            return 0
        print("No audit entries found.")
        return 0
    for e in entries:
        sid = f" step={e.step_id}" if e.step_id else ""
        print(f"{e.timestamp}  [{e.event}]{sid}  {e.detail}")
    return 0


def cmd_explain(args: argparse.Namespace) -> int:
    wf   = _load_or_die(Path(args.file))
    perm = PermissionModel()

    print(f"Workflow: {wf.name}  (v{wf.version})")
    if wf.description:
        print(f"  {wf.description}")
    print(f"\nSteps ({len(wf.steps)}):")
    for step in wf.steps:
        deps     = ", ".join(step.depends_on) or "none"
        gates    = ", ".join(step.policy_gates) or "none"
        cond_str = str(step.condition) if step.condition else "always run"
        print(f"  • {step.id}: {step.name}")
        print(f"      action={step.action}  depends_on=[{deps}]  gates=[{gates}]")
        print(f"      condition: {cond_str}")
        for gate_name in step.policy_gates:
            gate  = wf.gates[gate_name]
            roles = perm.roles_for_gate(gate_name)
            print(
                f"      Gate '{gate_name}': requires role='{gate.required_role}'  "
                f"granted_to={roles}"
            )
    return 0


# ---------------------------------------------------------------------------
# Shared step summary printer
# ---------------------------------------------------------------------------

def _print_step_summary(steps) -> None:
    icons = {
        "success": "✓",
        "failed":  "✗",
        "blocked": "⊘",
        "skipped": "↷",
        "pending": "?",
        "running": "…",
    }
    for step in steps:
        icon  = icons.get(step.status.value, "?")
        extra = f"  ({step.result})" if step.result else ""
        print(f"  {icon} [{step.status.value:8s}] {step.id}: {step.name}{extra}")


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

def _add_run_plan_args(p: argparse.ArgumentParser) -> None:
    """Arguments shared between `run` and `plan`."""
    p.add_argument("file", help="Path to workflow YAML/JSON")
    p.add_argument("--roles", default="", help="Comma-separated actor roles")
    p.add_argument(
        "--var",
        action="append",
        metavar="KEY=VALUE",
        default=[],
        help="Set a workflow variable (repeatable)",
    )
    p.add_argument(
        "--policy-mode",
        dest="policy_mode",
        choices=["enforcing", "permissive"],
        default=None,
        help=(
            "Operator policy mode. 'permissive' overrides gate denials and "
            "records them as OVERRIDDEN in the audit log. "
            "NEVER set from workflow YAML — operator/CI flag only."
        ),
    )
    p.add_argument(
        "--grant-production",
        default="",
        dest="grant_production",
        help="Comma-separated production gate names to grant (trusted config)",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="workflow",
        description="Policy-Gated Workflow Engine",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # validate
    p_val = sub.add_parser("validate", help="Validate a workflow file")
    p_val.add_argument("file", help="Path to workflow YAML/JSON")

    # run
    p_run = sub.add_parser("run", help="Run a workflow")
    _add_run_plan_args(p_run)
    p_run.add_argument(
        "--rollback-on-failure",
        action="store_true",
        dest="rollback_on_failure",
    )

    # plan  ← NEW
    p_plan = sub.add_parser(
        "plan",
        help="Preview execution plan without running anything",
    )
    _add_run_plan_args(p_plan)
    p_plan.add_argument(
        "--json",
        dest="json_output",
        action="store_true",
        help="Emit plan as JSON instead of human-readable text",
    )

    # audit
    sub.add_parser("audit", help="Print audit log")

    # explain
    p_exp = sub.add_parser("explain", help="Explain a workflow's steps and gates")
    p_exp.add_argument("file", help="Path to workflow YAML/JSON")

    return parser


def main(argv=None) -> None:
    parser = build_parser()
    args   = parser.parse_args(argv)
    dispatch = {
        "validate": cmd_validate,
        "run":      cmd_run,
        "plan":     cmd_plan,
        "audit":    cmd_audit,
        "explain":  cmd_explain,
    }
    sys.exit(dispatch[args.command](args))


if __name__ == "__main__":
    main()