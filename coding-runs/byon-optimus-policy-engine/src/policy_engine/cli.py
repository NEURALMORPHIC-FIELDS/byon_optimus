"""
CLI entry point for the policy-gated workflow engine.

Subcommands:
  workflow run  <workflow-file>  [--context key=value ...]  — execute workflow
  workflow plan <workflow-file>  [--context key=value ...]  — print plan, no execution
  workflow validate <workflow-file>                         — validate file only

[invariant_config_is_untrusted]: all file paths and context values are
validated before use.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, Any

from .audit import AuditLog
from .engine import WorkflowEngine
from .execution_plan import PlanValidator, PlanRenderer
from .planner import WorkflowPlanner
from .policies import make_permissive_policy
from .workflow import WorkflowLoader


# ---------------------------------------------------------------------------
# Context parsing
# ---------------------------------------------------------------------------

def _parse_context(pairs: list[str]) -> Dict[str, Any]:
    """Parse key=value strings into a dict. Values are JSON-decoded if possible."""
    ctx: Dict[str, Any] = {}
    for pair in pairs:
        if "=" not in pair:
            raise argparse.ArgumentTypeError(
                f"Context entry must be key=value, got: {pair!r}"
            )
        key, _, raw_value = pair.partition("=")
        try:
            ctx[key.strip()] = json.loads(raw_value.strip())
        except json.JSONDecodeError:
            ctx[key.strip()] = raw_value.strip()
    return ctx


# ---------------------------------------------------------------------------
# Subcommand handlers
# ---------------------------------------------------------------------------

def cmd_run(args: argparse.Namespace) -> int:
    path = Path(args.workflow_file)
    loader = WorkflowLoader()
    try:
        workflow = loader.load(path)
    except (ValueError, FileNotFoundError) as exc:
        print(f"ERROR loading workflow: {exc}", file=sys.stderr)
        return 1

    context = _parse_context(args.context or [])

    policy = make_permissive_policy()   # replace with real policy in production
    audit = AuditLog()
    engine = WorkflowEngine(policy_engine=policy, audit_log=audit)

    result = engine.run(workflow, context)

    print(f"Workflow '{result.workflow_name}': {result.status.upper()}")
    for sr in result.step_results:
        marker = {"success": "OK", "failed": "FAIL", "skipped": "SKIP", "denied": "DENY"}.get(
            sr.status, sr.status.upper()
        )
        line = f"  [{marker}] {sr.step_name}"
        if sr.error:
            line += f"  ({sr.error})"
        print(line)

    if args.audit:
        print("\nAudit log:")
        for entry in audit.entries:
            print(f"  {entry.timestamp}  {entry.event}  step={entry.step!r}  {entry.detail}")

    return 0 if result.succeeded else 1


def cmd_plan(args: argparse.Namespace) -> int:
    path = Path(args.workflow_file)
    loader = WorkflowLoader()
    try:
        workflow = loader.load(path)
    except (ValueError, FileNotFoundError) as exc:
        print(f"ERROR loading workflow: {exc}", file=sys.stderr)
        return 1

    context = _parse_context(args.context or [])
    merged_context = {**workflow.context, **context}

    policy = make_permissive_policy()
    planner = WorkflowPlanner(policy)
    plan = planner.build_plan(workflow, merged_context)

    validator = PlanValidator()
    valid, errors = validator.validate(plan)

    renderer = PlanRenderer()

    if args.format == "json":
        import json as _json
        d = renderer.render_dict(plan)
        d["valid"] = valid
        if errors:
            d["errors"] = [{"step": e.step_name, "message": e.message} for e in errors]
        print(_json.dumps(d, indent=2))
    else:
        print(renderer.render_text(plan))
        if not valid:
            print("VALIDATION ERRORS:")
            for e in errors:
                print(f"  - [{e.step_name}] {e.message}")

    return 0 if valid else 1


def cmd_validate(args: argparse.Namespace) -> int:
    path = Path(args.workflow_file)
    loader = WorkflowLoader()
    try:
        workflow = loader.load(path)
        print(f"Workflow '{workflow.name}' is structurally valid ({len(workflow.steps)} steps).")
        return 0
    except (ValueError, FileNotFoundError) as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 1


# ---------------------------------------------------------------------------
# Argument parser
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="workflow",
        description="Policy-gated workflow engine CLI",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # --- run ---
    p_run = sub.add_parser("run", help="Execute a workflow.")
    p_run.add_argument("workflow_file", help="Path to workflow YAML/JSON file.")
    p_run.add_argument(
        "--context", nargs="*", metavar="KEY=VALUE",
        help="Context variables (key=value pairs, JSON-decoded).",
    )
    p_run.add_argument(
        "--audit", action="store_true",
        help="Print audit log after execution.",
    )
    p_run.set_defaults(func=cmd_run)

    # --- plan ---
    p_plan = sub.add_parser("plan", help="Print execution plan without running.")
    p_plan.add_argument("workflow_file", help="Path to workflow YAML/JSON file.")
    p_plan.add_argument(
        "--context", nargs="*", metavar="KEY=VALUE",
        help="Context variables (key=value pairs, JSON-decoded).",
    )
    p_plan.add_argument(
        "--format", choices=["text", "json"], default="text",
        help="Output format (default: text).",
    )
    p_plan.set_defaults(func=cmd_plan)

    # --- validate ---
    p_val = sub.add_parser("validate", help="Validate workflow file structure.")
    p_val.add_argument("workflow_file", help="Path to workflow YAML/JSON file.")
    p_val.set_defaults(func=cmd_validate)

    return parser


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())