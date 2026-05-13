"""RollbackManager — thin wrapper kept separate for testability."""
from __future__ import annotations
from .audit import AuditLog
from .engine import WorkflowEngine


class RollbackManager:
    """Manages rollback lifecycle for a WorkflowEngine."""

    def __init__(self, engine: WorkflowEngine, audit: AuditLog):
        self._engine = engine
        self._audit = audit

    def execute_rollback(self) -> None:
        """Trigger rollback. Audit history is NEVER erased (invariant)."""
        self._engine.rollback()