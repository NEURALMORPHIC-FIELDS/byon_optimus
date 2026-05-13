"""PolicyEngine — orchestrates plan execution with gate checks and audit.

REQ_FAILED_BLOCKS_DEPENDENTS, REQ_NO_POLICY_BYPASS.

Operator fast-path (NOT workflow-config-controlled):
  policy_mode='permissive' may be passed by the operator (CLI flag or test
  fixture).  It is NEVER read from workflow YAML/JSON (REQ_CONFIG_UNTRUSTED).
  Every gate decision made under permissive mode is recorded as 'OVERRIDDEN'
  in the audit log — it is never silent.
"""
from __future__ import annotations
from typing import Any, Literal

from .audit import AuditLog
from .models import ExecutionPlan, WorkflowStep
from .permissions import PermissionModel
from .rollback import RollbackManager

PolicyMode = Literal["enforced", "permissive"]
_VALID_POLICY_MODES: frozenset[str] = frozenset({"enforced", "permissive"})


class PolicyEngine:
    def __init__(
        self,
        permissions: PermissionModel,
        audit: AuditLog | None = None,
        context: dict[str, Any] | None = None,
        policy_mode: PolicyMode = "enforced",
    ) -> None:
        if policy_mode not in _VALID_POLICY_MODES:
            raise ValueError(
                f"Invalid policy_mode '{policy_mode}'. "
                f"Must be one of: {sorted(_VALID_POLICY_MODES)}"
            )
        self.permissions = permissions
        self.audit = audit or AuditLog()
        self.rollback_manager = RollbackManager(self.audit)
        self.context: dict[str, Any] = context or {}
        self.policy_mode: PolicyMode = policy_mode

    def run(self, plan: ExecutionPlan) -> dict[str, str]:
        """Execute plan. Returns {step_name: status} for each step.

        Statuses:
          'success'     — step ran and completed
          'skipped'     — condition evaluated to False; step did not run
          'gate_denied' — policy gate blocked execution (enforced mode)
          'blocked'     — a hard-failed predecessor blocked this step

        REQ_FAILED_BLOCKS_DEPENDENTS: only gate_denied and blocked propagate
        as hard failures.  A skipped step does NOT block its dependents.
        """
        self.audit.append(
            "run_start",
            workflow=plan.workflow.name,
            policy_mode=self.policy_mode,
        )
        if self.policy_mode == "permissive":
            self.audit.append(
                "policy_mode_warning",
                workflow=plan.workflow.name,
                detail="OPERATOR permissive mode active — gate decisions will be OVERRIDDEN",
            )

        # hard_failed: steps that actually failed (gate_denied or blocked).
        # skipped steps are NOT added here — their dependents may still run.
        hard_failed: set[str] = set()
        results: dict[str, str] = {}

        for step in plan.ordered_steps:
            # REQ_FAILED_BLOCKS_DEPENDENTS — only hard failures propagate.
            # A skipped predecessor is NOT a hard failure; dependents still run.
            if any(dep in hard_failed for dep in step.depends_on):
                results[step.name] = "blocked"
                hard_failed.add(step.name)
                self.audit.append("blocked", step=step.name, reason="dependency_failed")
                continue

            # Condition evaluation — skipped is NOT a failure.
            if step.condition is not None:
                cond_result = step.condition.evaluate(self.context)
                if not cond_result:
                    results[step.name] = "skipped"
                    # NOTE: skipped is intentionally NOT added to hard_failed.
                    self.audit.append(
                        "skipped",
                        step=step.name,
                        reason="condition not met",
                        operator=step.condition.operator,
                        var=step.condition.var,
                        expected=step.condition.value,
                        actual=self.context.get(step.condition.var),
                    )
                    continue

            # Gate evaluation — REQ_NO_POLICY_BYPASS
            denied_gates = [
                g for g in step.policy_gates
                if not self.permissions.check(g, step.environment)
            ]
            if denied_gates:
                if self.policy_mode == "permissive":
                    self.audit.append(
                        "gate_overridden",
                        step=step.name,
                        denied_gates=denied_gates,
                        detail="OVERRIDDEN by operator permissive mode",
                    )
                    # Fall through to execution below.
                else:
                    results[step.name] = "gate_denied"
                    hard_failed.add(step.name)
                    self.audit.append(
                        "gate_denied", step=step.name, denied_gates=denied_gates
                    )
                    continue

            # Simulate execution — no real side effects
            self.audit.append(
                "step_start", step=step.name, action=step.action, simulated=True
            )
            results[step.name] = "success"
            self.rollback_manager.record_success(step)
            self.audit.append("step_success", step=step.name)

        self.audit.append(
            "run_end",
            workflow=plan.workflow.name,
            total=len(results),
            failed=len(hard_failed),
        )
        return results