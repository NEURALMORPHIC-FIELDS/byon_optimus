"""CLI entry point.

Subcommands
-----------
workflow validate <file>          Validate workflow schema.
workflow run <file>               Execute a workflow (simulated).
workflow plan <file>              Build and display execution plan (no execution).
workflow audit                    Print the in-process audit log.
workflow explain <file>           Show step-by-step textual explanation.

All previously working subcommands are preserved unchanged.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

from .audit import AuditLog
from .engine import RollbackManager, WorkflowEngine
from .loader import load_workflow
from .planner import PlanRenderer, PlanValidator, Planner
from .policy import PermissionModel, PolicyGate, PolicyMode

_GLOBAL_AUDIT = AuditLog()

_PERMISSIVE_ENV_VAR = "WORKFLOW_POLICY_MODE"


def _resolve_policy_mode(cli_flag: str | None) -> PolicyMode:
    source = cli_flag or os.environ.get(_PERMISSIVE_ENV_VAR, "enforced")
    source = source.strip().lower()
    if source == "permissive":
        return PolicyMode.PERMISSIVE
    if source == "enforced":
        return PolicyMode.ENFORCED
    raise ValueError(
        f"Unknown --policy-mode value {source!r}. "
        "Valid values: enforced (default), permissive."
    )


def _make_gate(
    role: str,
    production: bool = False,
    mode: PolicyMode = PolicyMode.ENFORCED,
    audit: AuditLog | None = None,
) -> PolicyGate:
    perm = PermissionModel.default()
    if production:
        perm.grant_production()
    return PolicyGate(perm, mode=mode, audit=audit or _GLOBAL_AUDIT)


def _make_engine(
    role: str,
    production: bool = False,
    mode: PolicyMode = PolicyMode.ENFORCED,
) -> WorkflowEngine:
    gate = _make_gate(role, production=production, mode=mode,
                      audit=_GLOBAL_AUDIT)
    if mode is PolicyMode.PERMISSIVE:
        _GLOBAL_AUDIT.append(
            "policy_mode_permissive_activated",
            role=role,
            warning=(
                "All policy gate denials are OVERRIDDEN. "
                "This mode must only be used by operators for testing."
            ),
        )
    return WorkflowEngine(_GLOBAL_AUDIT, gate)


def _parse_vars(var_list: list[str]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for item in var_list:
        if "=" not in item:
            raise argparse.ArgumentTypeError(
                f"--var must be KEY=VALUE, got {item!r}"
            )
        k, v = item.split("=", 1)
        k, v_str = k.strip(), v.strip()
        if v_str.lower() == "true":
            result[k] = True
        elif v_str.lower() == "false":
            result[k] = False
        else:
            try:
                result[k] = int(v_str)
            except ValueError:
                try:
                    result[k] = float(v_str)
                except ValueError:
                    result[k] = v_str
    return result


# ── subcommand handlers ───────────────────────────────────────────────────────


def cmd_validate(args: argparse.Namespace) -> int:
    try:
        wf = load_workflow(args.file)
        print(f"✓ Workflow '{wf.name}' ({wf.id}) is valid — {len(wf.steps)} steps.")
        return 0
    except Exception as exc:
        _GLOBAL_AUDIT.append("workflow_validation_failed", file=args.file,
                              error=str(exc))
        print(f"✗ Validation failed: {exc}", file=sys.stderr)
        return 1


def cmd_run(args: argparse.Namespace) -> int:
    try:
        wf = load_workflow(args.file)
    except Exception as exc:
        _GLOBAL_AUDIT.append("workflow_load_failed", file=args.file,
                              error=str(exc))
        print(f"✗ Load failed: {exc}", file=sys.stderr)
        return 1

    try:
        run_vars = _parse_vars(args.var or [])
    except argparse.ArgumentTypeError as exc:
        print(f"✗ Bad --var: {exc}", file=sys.stderr)
        return 1

    try:
        mode = _resolve_policy_mode(args.policy_mode)
    except ValueError as exc:
        print(f"✗ {exc}", file=sys.stderr)
        return 1

    role = args.role
    engine = _make_engine(role, production=args.grant_production, mode=mode)
    statuses = engine.run(wf, role, run_vars=run_vars)

    print(f"\nWorkflow '{wf.name}' execution summary:")
    for step_id, status in statuses.items():
        print(f"  {step_id:30s} → {status.value}")

    failed = [sid for sid, st in statuses.items()
              if st.value in ("failed", "blocked")]
    if failed and args.rollback_on_failure:
        print("\nRolling back...")
        rb = RollbackManager(_GLOBAL_AUDIT)
        rb.rollback(engine._executed, wf.id)
        print("Rollback complete.")

    return 0 if not failed else 2


def cmd_plan(args: argparse.Namespace) -> int:
    """Build and display an execution plan WITHOUT running any step."""
    try:
        wf = load_workflow(args.file)
    except Exception as exc:
        _GLOBAL_AUDIT.append("workflow_load_failed", file=args.file,
                              error=str(exc))
        print(f"✗ Load failed: {exc}", file=sys.stderr)
        return 1

    try:
        run_vars = _parse_vars(args.var or [])
    except argparse.ArgumentTypeError as exc:
        print(f"✗ Bad --var: {exc}", file=sys.stderr)
        return 1

    try:
        mode = _resolve_policy_mode(args.policy_mode)
    except ValueError as exc:
        print(f"✗ {exc}", file=sys.stderr)
        return 1

    role = args.role
    gate = _make_gate(role, production=args.grant_production, mode=mode)

    planner = Planner(gate)
    plan = planner.build(wf, role, run_vars=run_vars)

    validator = PlanValidator()
    validation = validator.validate(plan)

    colour = sys.stdout.isatty() and not args.no_colour
    renderer = PlanRenderer(colour=colour)

    if args.output_format == "json":
        output = {
            "plan": renderer.to_dict(plan),
            "validation": validation.to_dict(),
        }
        print(json.dumps(output, indent=2))
    else:
        print(renderer.to_text(plan, validation=validation))

    # Exit non-zero if plan has errors so CI pipelines can gate on it
    return 0 if validation.valid else 3


def cmd_audit(_args: argparse.Namespace) -> int:
    print(_GLOBAL_AUDIT.dump())
    return 0


def cmd_explain(args: argparse.Namespace) -> int:
    try:
        wf = load_workflow(args.file)
    except Exception as exc:
        print(f"✗ Load failed: {exc}", file=sys.stderr)
        return 1

    print(f"Workflow: {wf.name} ({wf.id})")
    if wf.variables:
        print(f"Variables (defaults): {wf.variables}")
    print(f"Steps ({len(wf.steps)}):")
    for s in wf.steps:
        deps = ", ".join(s.depends_on) or "none"
        gate = s.policy_gate or "none"
        cond = s.condition or "none"
        print(f"  [{s.id}] {s.name}")
        print(f"    action={s.action}  env={s.environment}")
        print(f"    depends_on={deps}  gate={gate}")
        print(f"    condition={cond}")
    return 0


# ── argument parser ───────────────────────────────────────────────────────────


def _add_run_args(p: argparse.ArgumentParser) -> None:
    """Shared arguments for run + plan subcommands."""
    p.add_argument("file")
    p.add_argument("--role", default="developer",
                   help="Role to execute as (default: developer)")
    p.add_argument("--grant-production", action="store_true",
                   help="Explicitly grant production gate (off by default)")
    p.add_argument("--var", metavar="KEY=VALUE", action="append",
                   help="Set a workflow variable (repeatable)")
    p.add_argument(
        "--policy-mode",
        metavar="MODE",
        default=None,
        help=(
            "Gate mode: 'enforced' (default) or 'permissive'. "
            "Permissive overrides gate denials but audits every override."
        ),
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="workflow",
        description="Policy-gated workflow engine",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # validate
    p_val = sub.add_parser("validate", help="Validate a workflow file")
    p_val.add_argument("file")

    # run
    p_run = sub.add_parser("run", help="Run a workflow (simulated)")
    _add_run_args(p_run)
    p_run.add_argument("--rollback-on-failure", action="store_true",
                       help="Roll back successful steps on any failure")

    # plan  ← NEW
    p_plan = sub.add_parser(
        "plan",
        help="Show execution plan without running anything",
    )
    _add_run_args(p_plan)
    p_plan.add_argument(
        "--output-format",
        choices=["text", "json"],
        default="text",
        help="Output format (default: text)",
    )
    p_plan.add_argument(
        "--no-colour",
        action="store_true",
        help="Disable ANSI colour in text output",
    )

    # audit
    sub.add_parser("audit", help="Print audit log")

    # explain
    p_exp = sub.add_parser("explain", help="Explain workflow steps")
    p_exp.add_argument("file")

    args = parser.parse_args(argv)
    dispatch = {
        "validate": cmd_validate,
        "run": cmd_run,
        "plan": cmd_plan,
        "audit": cmd_audit,
        "explain": cmd_explain,
    }
    sys.exit(dispatch[args.command](args))


if __name__ == "__main__":
    main()