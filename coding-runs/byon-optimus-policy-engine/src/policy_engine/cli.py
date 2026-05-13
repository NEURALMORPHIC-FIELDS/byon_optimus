"""CLI entry point. Subcommands: validate, run, audit, explain, plan.

REQ_NO_POLICY_BYPASS: the only operator-controlled policy fast-path is
``--policy-mode=permissive`` (or ``POLICY_MODE=permissive`` env var).
It is disabled by default, always audited, and cannot be set from within
an untrusted workflow file.
"""
from __future__ import annotations
import argparse
import json
import os
import sys

from policy_engine.loader import load_workflow, LoadError
from policy_engine.planner import build_plan, PlanError, PlanRenderer
from policy_engine.engine import PolicyEngine
from policy_engine.audit import AuditLog
from policy_engine.permissions import PermissionModel
from policy_engine.policy_mode import PolicyMode, get_policy_mode_from_env


def _resolve_policy_mode(args: argparse.Namespace) -> PolicyMode:
    """Resolve policy mode from CLI flag, then env var, then default (ENFORCE).

    Precedence: --policy-mode flag > POLICY_MODE env var > ENFORCE (default).
    The workflow file itself cannot influence this value (REQ_NO_POLICY_BYPASS).
    """
    cli_value = getattr(args, "policy_mode", None)
    if cli_value is not None:
        cli_value = cli_value.strip().lower()
        if cli_value == PolicyMode.PERMISSIVE.value:
            return PolicyMode.PERMISSIVE
        if cli_value == PolicyMode.ENFORCE.value:
            return PolicyMode.ENFORCE
        # Unknown value — default to ENFORCE (fail-safe).
        print(
            f"WARNING: unknown --policy-mode value {cli_value!r}; "
            f"defaulting to 'enforce'.",
            file=sys.stderr,
        )
        return PolicyMode.ENFORCE
    return get_policy_mode_from_env()


def cmd_validate(args: argparse.Namespace) -> int:
    try:
        wf = load_workflow(args.file)
        build_plan(wf)
        print(f"OK: workflow {wf.name!r} is valid ({len(wf.steps)} steps)")
        return 0
    except (LoadError, PlanError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


def cmd_run(args: argparse.Namespace) -> int:
    try:
        wf = load_workflow(args.file)
        plan = build_plan(wf)
    except (LoadError, PlanError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    role = getattr(args, "role", "developer")
    policy_mode = _resolve_policy_mode(args)

    if policy_mode is PolicyMode.PERMISSIVE:
        print(
            "WARNING: policy-mode=permissive is active. "
            "Gate failures will be OVERRIDDEN and recorded in the audit log. "
            "Do NOT use this in production.",
            file=sys.stderr,
        )

    pm = PermissionModel.default()
    audit = AuditLog()
    engine = PolicyEngine(
        permission_model=pm,
        audit=audit,
        role=role,
        policy_mode=policy_mode,
    )
    results = engine.run(plan)

    print(f"Workflow: {wf.name}")
    for step_name, status in results.items():
        print(f"  {step_name}: {status}")

    if policy_mode is PolicyMode.PERMISSIVE:
        overridden = [e for e in audit.entries if e.event == "OVERRIDDEN"]
        if overridden:
            print(
                f"\nAUDIT: {len(overridden)} gate(s) were OVERRIDDEN "
                f"(permissive mode). These events are permanently recorded.",
                file=sys.stderr,
            )

    return 0 if all(v == "success" for v in results.values()) else 1


def cmd_audit(args: argparse.Namespace) -> int:
    print(
        "Audit log is in-memory per run. "
        "Use --audit-file with 'run' to persist (future feature)."
    )
    return 0


def cmd_explain(args: argparse.Namespace) -> int:
    """Explain subcommand: kept for backwards compatibility; delegates to cmd_plan."""
    try:
        wf = load_workflow(args.file)
        plan = build_plan(wf)
    except (LoadError, PlanError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(PlanRenderer().render(plan))
    return 0


def cmd_plan(args: argparse.Namespace) -> int:
    """Print the execution plan (human-readable + machine-readable dict).

    Does NOT execute the workflow. REQ_TESTS_NOT_OPTIONAL: covered in test_plan.py.
    """
    try:
        wf = load_workflow(args.file)
        plan = build_plan(wf)
    except (LoadError, PlanError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    renderer = PlanRenderer()

    # Human-readable section
    print(renderer.render(plan))

    # Machine-readable section
    print("\n--- machine-readable ---")
    print(json.dumps(renderer.render_dict(plan), indent=2))

    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="workflow",
        description="Policy-gated workflow engine",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_val = sub.add_parser("validate", help="Validate a workflow file")
    p_val.add_argument("file")

    p_run = sub.add_parser("run", help="Run a workflow")
    p_run.add_argument("file")
    p_run.add_argument("--role", default="developer", help="Caller role for policy gates")
    p_run.add_argument(
        "--policy-mode",
        dest="policy_mode",
        default=None,
        choices=["enforce", "permissive"],
        help=(
            "Operator-controlled policy mode. "
            "'enforce' (default): all gates enforced normally. "
            "'permissive': gate failures are OVERRIDDEN and audited — "
            "for operator-controlled test environments only. "
            "Cannot be set from within a workflow file (REQ_NO_POLICY_BYPASS)."
        ),
    )

    sub.add_parser("audit", help="Show audit log (in-memory note)")

    p_exp = sub.add_parser("explain", help="Explain execution plan (alias for plan)")
    p_exp.add_argument("file")

    p_plan = sub.add_parser(
        "plan",
        help="Print execution plan (human-readable + machine-readable dict). Does NOT execute.",
    )
    p_plan.add_argument("file")

    return parser


def main(argv: list[str] | None = None) -> int:
    """Entry point. Returns exit code (int). Does NOT call sys.exit() itself."""
    parser = build_parser()
    args = parser.parse_args(argv)
    dispatch = {
        "validate": cmd_validate,
        "run": cmd_run,
        "audit": cmd_audit,
        "explain": cmd_explain,
        "plan": cmd_plan,
    }
    return dispatch[args.command](args)


def _cli_entry() -> None:
    """Setuptools console_scripts entry point — calls sys.exit with return code."""
    sys.exit(main())