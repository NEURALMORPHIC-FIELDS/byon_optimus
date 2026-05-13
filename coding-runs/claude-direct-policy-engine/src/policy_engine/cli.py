"""
CLI entry point.

Subcommands
-----------
  workflow validate <file>          Validate a workflow file
  workflow plan     <file>          Show execution plan WITHOUT running
  workflow run      <file>          Run a workflow
  workflow audit                    Print the audit log
  workflow explain  <file>          Describe steps, gates, conditions

Safe operator escape hatch
--------------------------
  --policy-mode=permissive

  This flag is the ONLY way to relax policy enforcement.  It is:
    * An operator/CLI-level flag — never set from workflow YAML/JSON.
    * Disabled by default (default: enforced).
    * Audited: every gate override is recorded as 'policy_overridden'.
    * Never silent: overridden steps are clearly marked in output and audit.

  DO NOT use 'policy_gate: bypass_all' (or any reserved name) in workflow
  files — that is rejected at load time (invariant_no_policy_bypass).

API stability note
------------------
WorkflowEngine.__init__ gained an optional `context` parameter in Phase 2.
PlanValidator / PlanRenderer / ExecutionPlan are new in Phase 4; they are
pure-data collaborators and do not alter WorkflowEngine's public API.
The `workflow plan` subcommand is new in Phase 4.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .audit import AuditLog
from .engine import ExecutionContext, WorkflowEngine
from .loader import ValidationError, load_workflow
from .models import StepStatus
from .permissions import PermissionModel
from .planning import PlanRenderer, PlanValidator, build_plan
from .policy import DEFAULT_GATES, PolicyEngine, PolicyMode
from .rollback import RollbackManager

_AUDIT = AuditLog(jsonl_path="workflow_audit.jsonl")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _make_policy_engine(role: str, mode: PolicyMode) -> PolicyEngine:
    perms = PermissionModel.from_defaults(role)
    return PolicyEngine(DEFAULT_GATES, perms, role, mode=mode)


def _parse_policy_mode(value: str) -> PolicyMode:
    try:
        return PolicyMode(value.lower())
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"Invalid policy mode '{value}'. Choose: enforced, permissive"
        )


def _build_context(args: argparse.Namespace) -> ExecutionContext:
    ctx = ExecutionContext()
    for item in getattr(args, "var", []) or []:
        if "=" not in item:
            print(
                f"Warning: ignoring malformed --var '{item}' (expected KEY=VALUE)",
                file=sys.stderr,
            )
            continue
        key, _, val = item.partition("=")
        for coerce in (int, float, _try_bool):
            try:
                val = coerce(val)  # type: ignore[assignment]
                break
            except (ValueError, TypeError):
                pass
        ctx.set(key.strip(), val)
    return ctx


def _try_bool(s: str):
    if s.lower() in ("true", "yes", "1"):
        return True
    if s.lower() in ("false", "no", "0"):
        return False
    raise ValueError


def _add_common_run_args(p: argparse.ArgumentParser) -> None:
    """Shared arguments for `run` and `plan`."""
    p.add_argument("file", type=Path)
    p.add_argument("--role", default="developer")
    p.add_argument(
        "--policy-mode",
        dest="policy_mode",
        type=_parse_policy_mode,
        default=PolicyMode.ENFORCED,
        metavar="{enforced,permissive}",
        help=(
            "Operator-controlled policy mode. "
            "'permissive' overrides gate denials but AUDITS every override. "
            "Default: enforced."
        ),
    )
    p.add_argument(
        "--var", metavar="KEY=VALUE", action="append",
        help="Set a context variable (repeatable)",
    )


# ---------------------------------------------------------------------------
# Subcommand handlers
# ---------------------------------------------------------------------------

def cmd_validate(args: argparse.Namespace) -> int:
    try:
        wf = load_workflow(args.file)
        print(f"✓ Workflow '{wf.name}' v{wf.version} is valid ({len(wf.steps)} steps)")
        return 0
    except (ValidationError, Exception) as exc:
        print(f"✗ Validation failed: {exc}", file=sys.stderr)
        _AUDIT.record("workflow_validation_failed", file=str(args.file), reason=str(exc))
        return 1


def cmd_plan(args: argparse.Namespace) -> int:
    """
    Build and display an execution plan WITHOUT running anything.
    Nothing is written to the audit log (plan is pure / read-only).
    Exit codes: 0 = plan is valid, 1 = load error, 3 = plan has errors.
    """
    try:
        wf = load_workflow(args.file)
    except (ValidationError, Exception) as exc:
        print(f"✗ Validation failed: {exc}", file=sys.stderr)
        return 1

    mode: PolicyMode = args.policy_mode
    policy = _make_policy_engine(args.role, mode)
    ctx    = _build_context(args)

    plan    = build_plan(wf, policy, ctx)
    issues  = PlanValidator().validate(plan)
    renderer = PlanRenderer()

    if getattr(args, "json_output", False):
        print(json.dumps(renderer.render_dict(plan, issues), indent=2))
    else:
        print(renderer.render_text(plan, issues))

    if any(i.severity == "error" for i in issues):
        return 3   # distinct from run-time failures (exit 2)
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    try:
        wf = load_workflow(args.file)
    except (ValidationError, Exception) as exc:
        print(f"✗ Validation failed: {exc}", file=sys.stderr)
        _AUDIT.record("workflow_validation_failed", file=str(args.file), reason=str(exc))
        return 1

    mode: PolicyMode = args.policy_mode
    if mode is PolicyMode.PERMISSIVE:
        _AUDIT.record(
            "policy_mode_activated",
            mode="permissive",
            role=args.role,
            workflow=wf.name,
            warning=(
                "Permissive policy mode is active. "
                "Gate decisions will be overridden and audited."
            ),
        )
        print(
            "⚠  WARNING: --policy-mode=permissive is active. "
            "All gate overrides will be audited.",
            file=sys.stderr,
        )

    policy = _make_policy_engine(args.role, mode)
    ctx    = _build_context(args)
    engine = WorkflowEngine(wf, policy, _AUDIT, context=ctx, dry_run=args.dry_run)
    results = engine.run()

    print(
        f"\nWorkflow : {wf.name}  |  Role: {args.role}  "
        f"|  Policy: {mode.value}  |  Dry-run: {args.dry_run}"
    )
    if ctx.as_dict():
        print(f"Context  : {ctx.as_dict()}")
    print("-" * 64)

    icons = {
        "success": "✓", "failed": "✗", "blocked": "⊘",
        "skipped": "↷", "pending": "…",
    }
    for r in results:
        icon = icons.get(r.status.value, "?")
        override_tag = " [POLICY OVERRIDDEN]" if "POLICY-OVERRIDDEN" in r.message else ""
        print(f"  {icon} [{r.status.value:8s}] {r.step.id}: {r.step.name}{override_tag}")
        if r.message and r.status != StepStatus.SUCCESS:
            print(f"           {r.message}")

    failed = [r for r in results if r.status in (StepStatus.FAILED, StepStatus.BLOCKED)]
    if failed and args.rollback_on_failure:
        print("\n⟳ Rolling back successful steps…")
        RollbackManager(_AUDIT).rollback(results, reason="auto-rollback on failure")
        print("  Rollback complete (simulated).")

    return 0 if not failed else 2


def cmd_audit(args: argparse.Namespace) -> int:
    entries = _AUDIT.entries()
    if not entries:
        try:
            with open("workflow_audit.jsonl", "r", encoding="utf-8") as fh:
                entries = [json.loads(line) for line in fh if line.strip()]
        except FileNotFoundError:
            print("No audit entries found.")
            return 0
    for entry in entries:
        ts   = entry.get("timestamp", "")
        ev   = entry.get("event", "")
        rest = {k: v for k, v in entry.items() if k not in ("timestamp", "event")}
        print(f"{ts}  {ev:35s}  {json.dumps(rest)}")
    return 0


def cmd_explain(args: argparse.Namespace) -> int:
    try:
        wf = load_workflow(args.file)
    except (ValidationError, Exception) as exc:
        print(f"✗ {exc}", file=sys.stderr)
        return 1

    print(f"Workflow : {wf.name}")
    print(f"Version  : {wf.version}")
    print(f"Steps    : {len(wf.steps)}")
    print()
    for step in wf.steps:
        deps = ", ".join(step.depends_on) if step.depends_on else "(none)"
        gate = step.policy_gate or "(none)"
        print(f"  Step: {step.id}")
        print(f"    name       : {step.name}")
        print(f"    action     : {step.action}")
        print(f"    environment: {step.environment}")
        print(f"    depends_on : {deps}")
        print(f"    policy_gate: {gate}")
        if step.condition:
            c = step.condition
            print(f"    condition  : {c.operator}({c.var!r}, {c.value!r})")
        if step.params:
            print(f"    params     : {step.params}")
        print()
    return 0


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        prog="workflow",
        description="Policy-gated workflow engine",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # validate
    p_val = sub.add_parser("validate", help="Validate a workflow file")
    p_val.add_argument("file", type=Path)

    # plan  (NEW in Phase 4)
    p_plan = sub.add_parser(
        "plan",
        help="Show execution plan without running (exit 3 if plan has errors)",
    )
    _add_common_run_args(p_plan)
    p_plan.add_argument(
        "--json", dest="json_output", action="store_true",
        help="Emit plan as JSON instead of human-readable text",
    )

    # run
    p_run = sub.add_parser("run", help="Run a workflow")
    _add_common_run_args(p_run)
    p_run.add_argument("--dry-run", action="store_true")
    p_run.add_argument("--rollback-on-failure", action="store_true")

    # audit
    sub.add_parser("audit", help="Print audit log")

    # explain
    p_exp = sub.add_parser("explain", help="Explain workflow steps, gates, conditions")
    p_exp.add_argument("file", type=Path)

    args = parser.parse_args()
    dispatch = {
        "validate": cmd_validate,
        "plan":     cmd_plan,
        "run":      cmd_run,
        "audit":    cmd_audit,
        "explain":  cmd_explain,
    }
    sys.exit(dispatch[args.command](args))


if __name__ == "__main__":
    main()