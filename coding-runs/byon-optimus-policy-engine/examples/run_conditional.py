"""
Runnable example demonstrating conditional step execution.

Usage:
  python examples/run_conditional.py --env staging
  python examples/run_conditional.py --env production
  python examples/run_conditional.py --env dev
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow running from repo root without installing
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from policy_engine import AuditLog, PolicyEngine, WorkflowEngine
from policy_engine.loader import load_workflow


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", default="staging",
                        choices=["dev", "staging", "production"])
    parser.add_argument("--integration-tests", action="store_true", default=False)
    args = parser.parse_args()

    audit = AuditLog()
    policy = PolicyEngine()
    engine = WorkflowEngine(policy_engine=policy, audit_log=audit)

    # Register a simple noop handler that prints what it's doing
    def noop_handler(step, ctx):
        print(f"  [RUN]  {step.name}")
        return f"ok:{step.name}"

    engine.register_action("noop", noop_handler)

    wf = load_workflow(Path(__file__).parent / "conditional_workflow.yaml")

    variables