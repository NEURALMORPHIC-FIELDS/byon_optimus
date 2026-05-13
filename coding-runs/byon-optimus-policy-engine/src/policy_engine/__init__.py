"""
policy-gated-workflow-engine

Public API:
  WorkflowEngine      — plan + execute workflows
  WorkflowLoader      — load WorkflowDefinition from YAML/JSON
  ExecutionPlan       — pure-data plan (P4)
  StepPlan            — single step plan record (P4)
  PlanValidator       — validate a plan without executing (P4)
  PlanRenderer        — render a plan as text or dict (P4)
  WorkflowPlanner     — build an ExecutionPlan (P4)
  PolicyEngine        — evaluate step permissions
  PolicyGrant         — explicit permission grant
  AuditLog            — append-only audit log
  AuditEntry          — immutable audit entry
  ExecutionResult     — result of engine.run()
  StepResult          — per-step execution result
"""

from .audit import AuditEntry, AuditLog
from .conditions import evaluate_condition
from .engine import ExecutionResult, StepResult, WorkflowEngine
from .execution_plan import ExecutionPlan, PlanRenderer, PlanValidator, StepPlan
from .planner import WorkflowPlanner
from .policies import PolicyEngine, PolicyGrant, make_permissive_policy, make_production_policy
from .workflow import WorkflowDefinition, WorkflowLoader, WorkflowStep

__all__ = [
    "AuditEntry",
    "AuditLog",
    "evaluate_condition",
    "ExecutionPlan",
    "ExecutionResult",
    "PlanRenderer",
    "PlanValidator",
    "PolicyEngine",
    "PolicyGrant",
    "StepPlan",
    "StepResult",
    "WorkflowDefinition",
    "WorkflowEngine",
    "WorkflowLoader",
    "WorkflowPlanner",
    "WorkflowStep",
    "make_permissive_policy",
    "make_production_policy",
]