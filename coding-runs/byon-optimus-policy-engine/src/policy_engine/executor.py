"""
Workflow executor with plan/execute separation.

Security invariants enforced:
 [invariant_no_policy_bypass] Policy gates are checked before any step runs.
 [invariant_audit_append_only] Audit log is append-only; entries are never mutated.
 [invariant_rollback_preserves_audit] Rollback appends new entries; never erases old ones.
 [invariant_failed_step_blocks_dependents] FAILED blocks dependents; SKIPPED does NOT.
"""

from __future__ import annotations

import datetime
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

from.loader import WorkflowDefinition, StepDefinition
from.policy import PolicyEngine


# ---------------------------------------------------------------------------
# Step status
# ---------------------------------------------------------------------------

class StepStatus(str, Enum):
 PENDING = "pending"
 RUNNING = "running"
 SUCCESS = "success"
 FAILED = "failed"
 SKIPPED = "skipped"


# Terminal statuses — a step in one of these states will not be re-evaluated.
TERMINAL_STATUSES = {StepStatus.SUCCESS, StepStatus.FAILED, StepStatus.SKIPPED}

# Statuses that block dependents from running.
# SKIPPED is intentionally NOT in this set — a skipped step is a non-blocking terminal.
BLOCKING_STATUSES = {StepStatus.FAILED}


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

@dataclass
class AuditEntry:
 entry_id: str
 timestamp: str
 step_name: str
 event: str
 details: Dict[str, Any] = field(default_factory=dict)


class AuditLog:
 """Append-only audit log. [invariant_audit_append_only]"""

 def __init__(self) -> None:
 self._entries: List[AuditEntry] = []

 def append(self, step_name: str, event: str, details: Optional[Dict[str, Any]] = None) -> AuditEntry:
 entry = AuditEntry(
 entry_id=str(uuid.uuid4()),
 timestamp=datetime.datetime.utcnow().isoformat() + "Z",
 step_name=step_name,
 event=event,
 details=details or {},
 )
 self._entries.append(entry)
 return entry

 def entries(self) -> List[AuditEntry]:
 """Return a snapshot; the underlying list is never exposed directly."""
 return list(self._entries)

 def __len__(self) -> int:
 return len(self._entries)


# ---------------------------------------------------------------------------
# Execution plan (pure data — P4 separation)
# ---------------------------------------------------------------------------

class StepDecision(str, Enum):
 RUN = "run"
 SKIP = "skip"


@dataclass
class PlannedStep:
 step: StepDefinition
 decision: StepDecision
 reason: str


@dataclass
class ExecutionPlan:
 planned_steps: List[PlannedStep]
 context: Dict[str, Any]


# ---------------------------------------------------------------------------
# Planner
# ---------------------------------------------------------------------------

class ExecutionPlanner:
 """
 Builds an ExecutionPlan from a WorkflowDefinition and a runtime context.
 Pure computation — no side effects, no I/O.
 """

 def __init__(self, policy: PolicyEngine) -> None:
 self._policy = policy

 def plan(self, workflow: WorkflowDefinition, context: Dict[str, Any]) -> ExecutionPlan:
 planned: List[PlannedStep] = []
 for step in workflow.steps:
 decision, reason = self._decide(step, context)
 planned.append(PlannedStep(step=step, decision=decision, reason=reason))
 return ExecutionPlan(planned_steps=planned, context=dict(context))

 def _decide(self, step: StepDefinition, context: Dict[str, Any]) -> tuple[StepDecision, str]:
 # Evaluate the step's own condition (if any).
 if step.condition is not None:
 if not _evaluate_condition(step.condition, context):
 return StepDecision.SKIP, "condition evaluated to false"

 # Policy gate — [invariant_no_policy_bypass]
 allowed, reason = self._policy.check(step, context)
 if not allowed:
 return StepDecision.SKIP, f"policy denied: {reason}"

 return StepDecision.RUN, "all checks passed"


# ---------------------------------------------------------------------------
# Condition evaluator
# ---------------------------------------------------------------------------

def _evaluate_condition(condition: Dict[str, Any], context: Dict[str, Any]) -> bool:
 """
 Evaluate a condition dict against a runtime context.
 Supported operators: equals, not_equals.
 Unknown operators default to False (safe default).
 """
 if "equals" in condition:
 spec = condition["equals"]
 var_name = spec["var"]
 expected = spec["value"]
 actual = context.get(var_name)
 return actual == expected

 if "not_equals" in condition:
 spec = condition["not_equals"]
 var_name = spec["var"]
 expected = spec["value"]
 actual = context.get(var_name)
 return actual!= expected

 # Unknown condition type — fail safe.
 return False


# ---------------------------------------------------------------------------
# Runtime step state
# ---------------------------------------------------------------------------

@dataclass
class StepState:
 step_name: str
 status: StepStatus = StepStatus.PENDING
 output: Any = None
 error: Optional[str] = None


# ---------------------------------------------------------------------------
# Executor
# ---------------------------------------------------------------------------

class WorkflowExecutor:
 """
 Executes an ExecutionPlan step by step.

 Dependency semantics (BUG FIX — P5):
 - FAILED predecessor → dependent is FAILED (blocks) [invariant_failed_step_blocks_dependents]
 - SKIPPED predecessor → dependent is NOT blocked; it runs if its own condition/policy allows.
 - SUCCESS predecessor → dependent may run.

 The distinction between SKIPPED and FAILED is the core fix for the
 skipped-step regression.
 """

 def __init__(self, audit_log: AuditLog, policy: PolicyEngine) -> None:
 self._audit = audit_log
 self._policy = policy

 def execute(self, plan: ExecutionPlan) -> Dict[str, StepState]:
 states: Dict[str, StepState] = {
 ps.step.name: StepState(step_name=ps.step.name)
 for ps in plan.planned_steps
 }

 for planned in plan.planned_steps:
 step = planned.step
 state = states[step.name]

 # ----------------------------------------------------------------
 # 1. Check dependency states BEFORE applying the plan decision.
 # A FAILED dependency blocks this step regardless of the plan.
 # A SKIPPED dependency does NOT block. [invariant_failed_step_blocks_dependents]
 # ----------------------------------------------------------------
 blocking_dep = self._find_blocking_dependency(step, states)
 if blocking_dep is not None:
 state.status = StepStatus.FAILED
 state.error = f"blocked by failed dependency: {blocking_dep}"
 self._audit.append(
 step.name,
 "step_blocked",
 {"reason": state.error},
 )
 continue

 # ----------------------------------------------------------------
 # 2. Apply the planner's decision (SKIP / RUN).
 # ----------------------------------------------------------------
 if planned.decision == StepDecision.SKIP:
 state.status = StepStatus.SKIPPED
 self._audit.append(
 step.name,
 "step_skipped",
 {"reason": planned.reason},
 )
 continue

 # ----------------------------------------------------------------
 # 3. Run the step.
 # ----------------------------------------------------------------
 self._audit.append(step.name, "step_started", {})
 state.status = StepStatus.RUNNING

 try:
 output = self._run_step(step, plan.context)
 state.status = StepStatus.SUCCESS
 state.output = output
 self._audit.append(step.name, "step_succeeded", {"output": repr(output)})
 except Exception as exc: # noqa: BLE001
 state.status = StepStatus.FAILED
 state.error = str(exc)
 self._audit.append(step.name, "step_failed", {"error": state.error})

 return states

 # ------------------------------------------------------------------
 # Internal helpers
 # ------------------------------------------------------------------

 def _find_blocking_dependency(
 self,
 step: StepDefinition,
 states: Dict[str, StepState],
 ) -> Optional[str]:
 """
 Return the name of the first dependency that is in a BLOCKING_STATUSES
 state, or None if all dependencies are non-blocking.

 KEY INVARIANT: SKIPPED is NOT in BLOCKING_STATUSES.
 This is the fix for the P5 regression.
 """
 for dep_name in step.depends_on:
 dep_state = states.get(dep_name)
 if dep_state is None:
 # Dependency not found in plan — treat as failed (safe default).
 return dep_name
 if dep_state.status in BLOCKING_STATUSES:
 return dep_name
 return None

 def _run_step(self, step: StepDefinition, context: Dict[str, Any]) -> Any:
 """
 Execute a single step's action.
 Extend this method to dispatch to real action handlers.
 """
 action = step.action or {}
 action_type = action.get("type", "noop")

 if action_type == "noop":
 return None

 if action_type == "echo":
 message = action.get("message", "")
 print(f"[{step.name}] {message}")
 return message

 if action_type == "fail":
 raise RuntimeError(action.get("message", f"step {step.name} forced failure"))

 raise ValueError(f"Unknown action type: {action_type!r}")


# ---------------------------------------------------------------------------
# Rollback
# ---------------------------------------------------------------------------

class WorkflowRollback:
 """
 Rolls back successfully executed steps in reverse order.
 [invariant_rollback_preserves_audit] — appends rollback entries; never erases.
 """

 def __init__(self, audit_log: AuditLog) -> None:
 self._audit = audit_log

 def rollback(
 self,
 plan: ExecutionPlan,
 states: Dict[str, StepState],
 ) -> None:
 succeeded = [
 ps for ps in reversed(plan.planned_steps)
 if states[ps.step.name].status == StepStatus.SUCCESS
 ]
 for planned in succeeded:
 step = planned.step
 self._audit.append(step.name, "step_rollback_started", {})
 try:
 self._rollback_step(step)
 states[step.name].status = StepStatus.SKIPPED # neutralised
 self._audit.append(step.name, "step_rollback_succeeded", {})
 except Exception as exc: # noqa: BLE001
 self._audit.append(
 step.name,
 "step_rollback_failed",
 {"error": str(exc)},
 )

 def _rollback_step(self, step: StepDefinition) -> None:
 """Override or extend to implement real rollback logic."""
 rollback_action = step.rollback_action or {}
 action_type = rollback_action.get("type", "noop")
 if action_type == "noop":
 return
 raise NotImplementedError(f"Rollback action type {action_type!r} not implemented.")