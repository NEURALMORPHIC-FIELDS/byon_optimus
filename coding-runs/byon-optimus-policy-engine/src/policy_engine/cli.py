"""CLI entry point: workflow validate|run|audit|explain|plan.

--policy-mode is an OPERATOR-controlled flag.  It is never read from workflow
YAML/JSON (REQ_CONFIG_UNTRUSTED, REQ_NO_POLICY_BYPASS).
"""
from __future__ import annotations
import argparse
import json
import sys

from .audit import AuditLog
from .loader import LoadError, load_workflow
from .permissions import PermissionModel
from .planner import PlanError, PlanRenderer, PlanValidator, build_plan
from .engine import PolicyEngine

_GLOBAL_AUDIT = AuditLog()


def cmd_validate(args: argparse.Namespace) -> int:
    try:
        wf = load_workflow(args.file)
        PlanValidator().validate(wf)
        print(f"OK: '{wf.name}' — {len(wf.steps)} steps, DAG valid.")
        return 0
    except (LoadError, PlanError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        _GLOBAL_AUDIT.append("validation_error", detail=str(exc))
        return 1


def cmd_run(args: argparse.Namespace) -> int:
    policy_mode = getattr(args, "policy_mode", "enforced")
    if policy_mode not in ("enforced", "permissive"):
        print(
            f"ERROR: invalid --policy-mode '{policy_mode}'. "
            "Must be 'enforced' or 'permissive'.",
            file=sys.stderr,
        )
        return 1

    if policy_mode == "permissive":
        # Audit the operator's decision to use permissive mode BEFORE running.
        _GLOBAL_AUDIT.append(
            "operator_permissive_mode_activated",
            detail=(
                "OPERATOR explicitly activated permissive policy mode via CLI. "
                "All gate overrides will be recorded."
            ),
        )
        print(
            "WARNING: --policy-mode=permissive is active. "
            "All policy gate decisions will be OVERRIDDEN and audited.",
            file=sys.stderr,
        )

    try:
        wf = load_workflow(args.file)
        plan = build_plan(wf)
    except (LoadError, PlanError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        _GLOBAL_AUDIT.append("load_error", detail=str(exc))
        return 1

    role = getattr(args, "role", "developer")
    perms = PermissionModel(role=role)
    engine = PolicyEngine(
        permissions=perms,
        audit=_GLOBAL_AUDIT,
        policy_mode=policy_mode,
    )
    results = engine.run(plan)
    for step, status in results.items():
        icon = "✓" if status == "success" else "✗"
        print(f"  {icon} {step}: {status}")
    return 0 if all(s == "success" for s in results.values()) else 1


def cmd_audit(_args: argparse.Namespace) -> int:
    entries = _GLOBAL_AUDIT.entries
    if not entries:
        print("Audit log is empty.")
        return 0
    for e in entries:
        print(f"[{e.event}] step={e.step} {e.detail}")
    return 0


def cmd_explain(args: argparse.Namespace) -> int:
    try:
        wf = load_workflow(args.file)
        plan = build_plan(wf)
    except (LoadError, PlanError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(PlanRenderer().render(plan))
    return 0


def cmd_plan(args: argparse.Namespace) -> int:
    """Print the execution plan WITHOUT executing anything.

    Uses --role to predict gate outcomes.  Output format is controlled by
    --format (text [default] or json).

    This command NEVER executes steps, modifies state, or writes audit entries
    for the workflow itself.  It is a pure read/predict operation.
    """
    role = getattr(args, "role", "developer")
    fmt = getattr(args, "format", "text")

    try:
        wf = load_workflow(args.file)
        perms = PermissionModel(role=role)
        plan = build_plan(wf, permissions=perms)
    except (LoadError, PlanError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    renderer = PlanRenderer()
    if fmt == "json":
        output = json.dumps(renderer.render_dict(plan), indent=2)
        print(output)
    else:
        print(renderer.render(plan))
    return 0


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="workflow")
    sub = parser.add_subparsers(dest="command", required=True)

    p_val = sub.add_parser("validate", help="Validate workflow file")
    p_val.add_argument("file")

    p_run = sub.add_parser("run", help="Run workflow (simulated)")
    p_run.add_argument("file")
    p_run.add_argument("--role", default="developer", help="Caller role")
    p_run.add_argument(
        "--policy-mode",
        dest="policy_mode",
        default="enforced",
        choices=["enforced", "permissive"],
        help=(
            "OPERATOR ONLY. 'permissive' overrides gate denials and records every "
            "override in the audit log. NEVER set this from workflow YAML/JSON. "
            "Default: enforced."
        ),
    )

    sub.add_parser("audit", help="Print audit log")

    p_exp = sub.add_parser("explain", help="Explain execution plan")
    p_exp.add_argument("file")

    p_plan = sub.add_parser(
        "plan",
        help=(
            "Print the execution plan (with predicted gate outcomes) "
            "WITHOUT executing anything."
        ),
    )
    p_plan.add_argument("file")
    p_plan.add_argument(
        "--role",
        default="developer",
        help="Role used to predict gate outcomes (default: developer)",
    )
    p_plan.add_argument(
        "--format",
        dest="format",
        default="text",
        choices=["text", "json"],
        help="Output format: 'text' (default) or 'json'",
    )

    args = parser.parse_args(argv)
    dispatch = {
        "validate": cmd_validate,
        "run": cmd_run,
        "audit": cmd_audit,
        "explain": cmd_explain,
        "plan": cmd_plan,
    }
    sys.exit(dispatch[args.command](args))


if __name__ == "__main__":
    main()