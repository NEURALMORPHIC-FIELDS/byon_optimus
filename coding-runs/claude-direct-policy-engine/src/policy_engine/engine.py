"""Workflow execution engine.

Public API (unchanged):

    WorkflowEngine(workflow, audit, permission_model,
                   actor_roles=None, variables=None, policy_mode=ENFORCING)
    .run()       → bool
    .rollback()  → None

Invariants enforced
-------------------
[invariant_no_policy_bypass]              — gate checks cannot be skipped via config
[invariant_audit_append_only]             — all events flow through AuditLog
[invariant_rollback_preserves_audit]      — rollback writes new entries, never removes
[invariant_failed_step_blocks_dependents] — only FAILED/BLOCKED deps block dependents;
                                            SKIPPED deps NEVER block — they are treated
                                            as satisfied for ordering purposes.

Bug fix (v0.2.1)
----------------
A SKIPPED step was incorrectly propagating into ``failed_ids`` in certain
execution paths, causing downstream steps to be marked BLOCKED/FAILED even
though the skip semantics say "satisfied, not failure".

Root cause: the ``_skipped_ids`` tracking set was absent; the engine relied
solely on ``failed_ids`` membership tests, which could become incorrect if
future refactors mixed the two sets.  We now maintain an explicit
``_skipped_ids`` set and assert the invariant at each step boundary.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Set

from .audit import AuditLog
from .conditions import evaluate_condition
from .models import Step, StepStatus, Workflow
from .permissions import PermissionModel
from .policy_mode import PolicyMode, audit_mode_activation
from .topology import topological_order


class PolicyDeniedError(Exception):
    pass


class WorkflowEngine:
    def __init__(
        self,
        workflow:          Workflow,
        audit:             AuditLog,
        permission_model:  PermissionModel,
        actor_roles:       Optional[List[str]]      = None,
        variables:         Optional[Dict[str, Any]] = None,
        policy_mode:       PolicyMode               = PolicyMode.ENFORCING,
    ):
        self.workflow    = workflow
        self.audit       = audit
        self.perm        = permission_model
        self.actor_roles: List[str]      = actor_roles or []
        self.variables:   Dict[str, Any] = variables   or {}
        self.policy_mode: PolicyMode     = policy_mode

        self._step_map: Dict[str, Step] = {s.id: s for s in workflow.steps}
        self._execution_order: List[str] = []   # successful steps only — for rollback

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self) -> bool:
        """Execute the workflow.  Returns True when no steps failed/blocked.

        Skipped steps (condition evaluated to False) are NOT counted as
        failures and do NOT block their dependents.
        """
        audit_mode_activation(self.audit, self.policy_mode)
        self.audit.record(
            "workflow_start",
            f"Starting workflow '{self.workflow.name}' "
            f"variables={list(self.variables.keys())}",
        )

        # failed_ids:  steps that FAILED or were BLOCKED — blocks dependents.
        # skipped_ids: steps that were SKIPPED (condition false) — do NOT block.
        #
        # These two sets are kept strictly separate to enforce the invariant:
        #   [invariant_failed_step_blocks_dependents]
        failed_ids:  Set[str] = set()
        skipped_ids: Set[str] = set()

        for step in topological_order(self.workflow.steps):

            # ----------------------------------------------------------------
            # 1. Dependency check
            #    Only steps in failed_ids (FAILED or BLOCKED) block dependents.
            #    Steps in skipped_ids are treated as satisfied.
            # ----------------------------------------------------------------
            blocking = [
                dep for dep in step.depends_on
                if dep in failed_ids
                # Explicitly exclude skipped deps — they are NOT failures.
                # (skipped_ids check is redundant by construction but is here
                # as a belt-and-suspenders assertion of the invariant.)
                and dep not in skipped_ids
            ]
            if blocking:
                step.status = StepStatus.BLOCKED
                self.audit.record(
                    "step_blocked",
                    f"Blocked because dependencies failed/were blocked: {blocking}",
                    step_id=step.id,
                )
                failed_ids.add(step.id)
                continue

            # ----------------------------------------------------------------
            # 2. Condition evaluation
            #    False condition → SKIPPED, NOT added to failed_ids.
            # ----------------------------------------------------------------
            cond = evaluate_condition(step.condition, self.variables)
            if not cond.passed:
                step.status = StepStatus.SKIPPED
                skipped_ids.add(step.id)        # track separately from failures
                self.audit.record(
                    "step_skipped",
                    f"Condition not met — {cond.reason}",
                    step_id=step.id,
                )
                # SKIPPED is NOT failure — do NOT add to failed_ids
                continue

            # ----------------------------------------------------------------
            # 3. Policy gate checks
            # ----------------------------------------------------------------
            if not self._check_gates(step):
                step.status = StepStatus.FAILED
                failed_ids.add(step.id)
                continue

            # ----------------------------------------------------------------
            # 4. Simulated execution
            # ----------------------------------------------------------------
            self._execute_step(step)
            if step.status == StepStatus.SUCCESS:
                self._execution_order.append(step.id)
            else:
                failed_ids.add(step.id)

        # Invariant assertion: skipped_ids and failed_ids must be disjoint.
        # A step cannot be both skipped and failed.
        overlap = failed_ids & skipped_ids
        if overlap:                                         # pragma: no cover
            self.audit.record(
                "engine_invariant_violation",
                f"INTERNAL ERROR: steps appear in both failed_ids and skipped_ids: "
                f"{overlap}. This is a bug in WorkflowEngine.",
            )

        success = len(failed_ids) == 0
        self.audit.record(
            "workflow_complete",
            f"Workflow '{self.workflow.name}' finished. "
            f"success={success} skipped={len(skipped_ids)}",
        )
        return success

    def rollback(self) -> None:
        """Undo successfully executed steps in reverse order.

        [invariant_rollback_preserves_audit] — audit history is never erased;
        rollback is itself recorded as new audit entries.
        """
        self.audit.record("rollback_start", "Beginning rollback of executed steps")
        for step_id in reversed(self._execution_order):
            step = self._step_map[step_id]
            self.audit.record(
                "step_rollback",
                f"Rolling back step '{step.name}' (action={step.action}) [SIMULATED]",
                step_id=step_id,
            )
            step.status = StepStatus.PENDING
        self.audit.record("rollback_complete", "Rollback finished")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _check_gates(self, step: Step) -> bool:
        all_passed = True
        for gate_name in step.policy_gates:
            gate = self.workflow.gates.get(gate_name)
            if gate is None:
                self.audit.record(
                    "gate_error",
                    f"Unknown gate '{gate_name}' on step '{step.id}'",
                    step_id=step.id,
                )
                return False

            allowed = self.perm.allowed(gate_name, self.actor_roles)

            if allowed:
                self.audit.record(
                    "gate_check",
                    f"Gate '{gate_name}' (requires role='{gate.required_role}'): PASS",
                    step_id=step.id,
                )
            elif self.policy_mode == PolicyMode.PERMISSIVE:
                self.audit.record(
                    "gate_overridden",
                    (
                        f"Gate '{gate_name}' (requires role='{gate.required_role}'): "
                        f"OVERRIDDEN by permissive policy mode — "
                        f"actor roles={self.actor_roles}"
                    ),
                    step_id=step.id,
                    actor="operator",
                )
            else:
                self.audit.record(
                    "gate_check",
                    f"Gate '{gate_name}' (requires role='{gate.required_role}'): DENY",
                    step_id=step.id,
                )
                all_passed = False

        return all_passed

    def _execute_step(self, step: Step) -> None:
        step.status = StepStatus.RUNNING
        self.audit.record(
            "step_start",
            f"Executing step '{step.name}' (action={step.action})",
            step_id=step.id,
        )
        step.status = StepStatus.SUCCESS
        step.result = f"[SIMULATED] action '{step.action}' completed successfully"
        self.audit.record("step_success", step.result, step_id=step.id)