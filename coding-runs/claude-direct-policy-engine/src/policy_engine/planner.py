"""Execution planning — pure data structures and planning logic.

Separates WHAT WOULD happen (planning) from WHAT DOES happen (execution).

Key types
---------
Decision      — enum: RUN | SKIP | BLOCK | DENY
StepPlan      — immutable record for one step's predicted outcome
ExecutionPlan — ordered list of StepPlan + summary metadata

Bug fix (v0.2.1)
----------------
The Planner mirrored the same structural fix applied to WorkflowEngine:
``bad_ids`` (which drives BLOCK propagation) now only contains steps with
decision DENY or BLOCK.  SKIP decisions are tracked in a separate
``skipped_ids`` set and are explicitly excluded from ``bad_ids`` to make
the invariant impossible to accidentally violate in future refactors.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set

from .conditions import evaluate_condition
from .models import Step, Workflow
from .permissions import PermissionModel
from .policy_mode import PolicyMode
from .topology import topological_order


# ---------------------------------------------------------------------------
# Decision enum
# ---------------------------------------------------------------------------

class Decision(str, Enum):
    RUN   = "run"    # condition passes, gates pass → step will execute
    SKIP  = "skip"   # condition evaluates to False → step is skipped (not failure)
    BLOCK = "block"  # a failed/denied dependency blocks this step
    DENY  = "deny"   # condition passes but a policy gate denies execution


# ---------------------------------------------------------------------------
# StepPlan — immutable record (frozen dataclass)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class StepPlan:
    """Predicted outcome for a single step, computed at plan time."""

    step_id:   str
    step_name: str
    action:    str
    decision:  Decision
    reason:    str

    # Gate-level detail: gate_name → "PASS" | "DENY" | "OVERRIDDEN"
    gate_results: Dict[str, str] = field(default_factory=dict)

    # Condition detail (None when step has no condition)
    condition_result: Optional[str] = field(default=None)

    # Which dependency IDs caused a BLOCK (empty unless decision == BLOCK)
    blocked_by: List[str] = field(default_factory=list)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "step_id":          self.step_id,
            "step_name":        self.step_name,
            "action":           self.action,
            "decision":         self.decision.value,
            "reason":           self.reason,
            "gate_results":     dict(self.gate_results),
            "condition_result": self.condition_result,
            "blocked_by":       list(self.blocked_by),
        }


# ---------------------------------------------------------------------------
# ExecutionPlan
# ---------------------------------------------------------------------------

@dataclass
class ExecutionPlan:
    """Ordered list of StepPlans plus whole-plan metadata."""

    workflow_name:    str
    workflow_version: str
    policy_mode:      PolicyMode
    actor_roles:      List[str]
    variables:        Dict[str, Any]
    step_plans:       List[StepPlan] = field(default_factory=list)

    def counts(self) -> Dict[str, int]:
        tally: Dict[str, int] = {d.value: 0 for d in Decision}
        for sp in self.step_plans:
            tally[sp.decision.value] += 1
        return tally

    def would_succeed(self) -> bool:
        """True when no step is predicted to be DENIED or BLOCKED."""
        return all(
            sp.decision not in (Decision.DENY, Decision.BLOCK)
            for sp in self.step_plans
        )

    def as_dict(self) -> Dict[str, Any]:
        return {
            "workflow_name":    self.workflow_name,
            "workflow_version": self.workflow_version,
            "policy_mode":      self.policy_mode.value,
            "actor_roles":      list(self.actor_roles),
            "variables":        {k: str(v) for k, v in self.variables.items()},
            "would_succeed":    self.would_succeed(),
            "counts":           self.counts(),
            "steps":            [sp.as_dict() for sp in self.step_plans],
        }


# ---------------------------------------------------------------------------
# Planner
# ---------------------------------------------------------------------------

class Planner:
    """Computes an ExecutionPlan for a workflow.

    Pure: no side-effects, no audit writes.
    """

    def __init__(
        self,
        workflow:          Workflow,
        permission_model:  PermissionModel,
        actor_roles:       Optional[List[str]]      = None,
        variables:         Optional[Dict[str, Any]] = None,
        policy_mode:       PolicyMode               = PolicyMode.ENFORCING,
    ):
        self.workflow    = workflow
        self.perm        = permission_model
        self.actor_roles = actor_roles or []
        self.variables   = variables   or {}
        self.policy_mode = policy_mode

        self._step_map: Dict[str, Step] = {s.id: s for s in workflow.steps}

    def build(self) -> ExecutionPlan:
        """Return a fully-populated ExecutionPlan."""
        plan = ExecutionPlan(
            workflow_name    = self.workflow.name,
            workflow_version = self.workflow.version,
            policy_mode      = self.policy_mode,
            actor_roles      = list(self.actor_roles),
            variables        = dict(self.variables),
        )

        # bad_ids:     steps predicted to DENY or BLOCK — propagates BLOCK to dependents.
        # skipped_ids: steps predicted to SKIP — treated as satisfied, never propagate.
        #
        # These sets are kept strictly separate to mirror the engine's invariant.
        bad_ids:     Set[str] = set()
        skipped_ids: Set[str] = set()

        for step in topological_order(self.workflow.steps):
            sp = self._plan_step(step, bad_ids, skipped_ids)
            plan.step_plans.append(sp)

            if sp.decision in (Decision.DENY, Decision.BLOCK):
                bad_ids.add(step.id)
            elif sp.decision == Decision.SKIP:
                skipped_ids.add(step.id)
            # RUN → neither set

        return plan

    # ----------------------------------------------------------------- private

    def _plan_step(
        self,
        step:        Step,
        bad_ids:     Set[str],
        skipped_ids: Set[str],
    ) -> StepPlan:
        # 1. Blocked by a failing/denied dependency?
        #    Skipped deps are excluded — they are satisfied, not failures.
        blocking = [
            dep for dep in step.depends_on
            if dep in bad_ids
            and dep not in skipped_ids   # belt-and-suspenders (bad_ids never has skips)
        ]
        if blocking:
            return StepPlan(
                step_id    = step.id,
                step_name  = step.name,
                action     = step.action,
                decision   = Decision.BLOCK,
                reason     = (
                    f"Depends on step(s) that would fail/be denied: {blocking}"
                ),
                blocked_by = blocking,
            )

        # 2. Condition check
        cond_result = evaluate_condition(step.condition, self.variables)
        cond_str    = cond_result.reason if step.condition is not None else None

        if not cond_result.passed:
            return StepPlan(
                step_id          = step.id,
                step_name        = step.name,
                action           = step.action,
                decision         = Decision.SKIP,
                reason           = f"Condition not met: {cond_result.reason}",
                condition_result = cond_str,
            )

        # 3. Gate evaluation (no side-effects — no audit writes)
        gate_results: Dict[str, str] = {}
        any_denied = False

        for gate_name in step.policy_gates:
            gate = self.workflow.gates.get(gate_name)
            if gate is None:
                gate_results[gate_name] = "ERROR"
                any_denied = True
                continue

            allowed = self.perm.allowed(gate_name, self.actor_roles)
            if allowed:
                gate_results[gate_name] = "PASS"
            elif self.policy_mode == PolicyMode.PERMISSIVE:
                gate_results[gate_name] = "OVERRIDDEN"
                # Permissive override is NOT a denial for plan purposes
            else:
                gate_results[gate_name] = "DENY"
                any_denied = True

        if any_denied:
            denied_gates = [g for g, r in gate_results.items() if r in ("DENY", "ERROR")]
            return StepPlan(
                step_id          = step.id,
                step_name        = step.name,
                action           = step.action,
                decision         = Decision.DENY,
                reason           = f"Policy gate(s) would deny: {denied_gates}",
                gate_results     = gate_results,
                condition_result = cond_str,
            )

        return StepPlan(
            step_id          = step.id,
            step_name        = step.name,
            action           = step.action,
            decision         = Decision.RUN,
            reason           = "Condition passes; all gates satisfied",
            gate_results     = gate_results,
            condition_result = cond_str,
        )