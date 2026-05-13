"""PolicyEngine: orchestrates plan execution with policy gates and audit.

REQ_NO_POLICY_BYPASS  — gates are always checked; workflow config cannot skip them.
REQ_FAILED_BLOCKS_DEPENDENTS — a failed/denied step blocks all transitive dependents.
REQ_CONFIG_UNTRUSTED  — variables dict is caller-supplied but never used to bypass gates.

Operator-controlled permissive mode (PolicyMode.PERMISSIVE):
  When active, a gate that would normally deny a step is instead recorded as
  OVERRIDDEN in the audit log and execution continues.  This mode is set via
  the --policy-mode CLI flag or POLICY_MODE env var — never via workflow YAML.
"""
from __future__ import annotations
from typing import Any

from policy_engine.audit import AuditLog
from policy_engine.conditions import evaluate_condition, ConditionError
from policy_engine.models import ExecutionPlan, WorkflowStep
from policy_engine.permissions import PermissionModel
from policy_engine.policy_mode import PolicyMode
from policy_engine.rollback import RollbackManager


class ExecutionContext:
    """Tracks per-run state: results, which steps were skipped, and runtime variables.

    Skipped steps (condition not met) are recorded here so that downstream
    consumers can inspect whether a predecessor actually executed.
    """

    def __init__(self, variables: dict[str, Any] | None = None) -> None:
        self.variables: dict[str, Any] = dict(variables or {})
        self.results: dict[str, str] = {}
        # Steps skipped because their condition evaluated to False.
        self.condition_skipped: set[str] = set()

    def record(self, step_name: str, status: str) -> None:
        self.results[step_name] = status

    def was_condition_skipped(self, step_name: str) -> bool:
        return step_name in self.condition_skipped


class PolicyEngine:
    def __init__(
        self,
        permission_model: PermissionModel | None = None,
        audit: AuditLog | None = None,
        role: str = "developer",
        policy_mode: PolicyMode = PolicyMode.ENFORCE,
    ) -> None:
        self.permissions = permission_model or PermissionModel.default()
        self.audit = audit or AuditLog()
        self.role = role
        self.policy_mode = policy_mode
        self._rollback = RollbackManager(self.audit)

    def run(
        self,
        plan: ExecutionPlan,
        variables: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Execute plan. Returns result summary.

        Parameters
        ----------
        plan:
            The validated execution plan.
        variables:
            Runtime variables used to evaluate step conditions.
            E.g. {"environment": "production"}.
            These variables are NEVER used to bypass policy gates.
        """
        ctx = ExecutionContext(variables=variables)
        # Steps that are blocked (failed or denied) — dependents must not run.
        # Condition-skipped steps are NOT added here; their dependents still run.
        blocked: set[str] = set()

        self.audit.append(
            "WORKFLOW_START",
            plan.workflow.name,
            {"policy_mode": self.policy_mode.value},
        )

        for step in plan.ordered_steps:
            # ── REQ_FAILED_BLOCKS_DEPENDENTS ──────────────────────────────────
            # A step is blocked only when a *failed/denied* predecessor is in
            # blocked. Condition-skipped predecessors do NOT block dependents.
            if any(dep in blocked for dep in step.depends_on):
                self.audit.append("SKIPPED", step.name, {"reason": "blocked_dependency"})
                blocked.add(step.name)
                ctx.record(step.name, "skipped")
                continue

            # ── Condition evaluation ──────────────────────────────────────────
            if step.condition is not None:
                try:
                    condition_met = evaluate_condition(step.condition, ctx.variables)
                except ConditionError as exc:
                    # Malformed condition in config — treat as a configuration
                    # error; block the step and its dependents.
                    self.audit.append(
                        "SKIPPED", step.name,
                        {"reason": "condition_error", "detail": str(exc)},
                    )
                    blocked.add(step.name)
                    ctx.record(step.name, "skipped:condition_error")
                    continue

                if not condition_met:
                    self.audit.append(
                        "SKIPPED", step.name,
                        {
                            "reason": "condition_not_met",
                            "condition_operator": step.condition.operator,
                            "condition_var": step.condition.var,
                            "condition_value": step.condition.value,
                            "actual_value": ctx.variables.get(step.condition.var),
                        },
                    )
                    # NOT added to blocked — dependents may still run.
                    ctx.condition_skipped.add(step.name)
                    ctx.record(step.name, "skipped:condition_not_met")
                    continue

            # ── REQ_NO_POLICY_BYPASS: check every declared gate ───────────────
            # Gate checks happen regardless of policy_mode; the mode only
            # controls whether a failure blocks execution or is overridden.
            denied_gate = self._check_gates(step)
            if denied_gate:
                if self.policy_mode is PolicyMode.PERMISSIVE:
                    # Operator-controlled override: record but do NOT block.
                    self.audit.append(
                        "OVERRIDDEN",
                        step.name,
                        {
                            "gate": denied_gate,
                            "role": self.role,
                            "policy_mode": self.policy_mode.value,
                        },
                    )
                    # Fall through to execute the step despite gate denial.
                else:
                    # ENFORCE mode: gate denial blocks this step and dependents.
                    self.audit.append(
                        "DENIED",
                        step.name,
                        {"gate": denied_gate, "role": self.role},
                    )
                    blocked.add(step.name)
                    ctx.record(step.name, "denied")
                    continue

            # ── Execute ───────────────────────────────────────────────────────
            self.audit.append(
                "SUCCESS",
                step.name,
                {"action": step.action, "environment": step.environment},
            )
            self._rollback.record_success(step.name)
            ctx.record(step.name, "success")

        self.audit.append("WORKFLOW_END", plan.workflow.name, {})
        return ctx.results

    def _check_gates(self, step: WorkflowStep) -> str | None:
        """Return the name of the first denied gate, or None if all pass."""
        for gate_name in step.policy_gates:
            if not self.permissions.is_allowed(gate_name, self.role, step.environment):
                return gate_name
        return None

    def rollback(self) -> list[str]:
        """Roll back all successfully executed steps in reverse order.

        REQ_ROLLBACK_PRESERVES_AUDIT: audit entries are added, never removed.
        """
        return self._rollback.rollback()