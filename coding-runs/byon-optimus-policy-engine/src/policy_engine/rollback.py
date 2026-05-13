"""Rollback manager.

Invariant: rollback undoes successful steps in reverse order but NEVER erases audit history.
Rollback itself is audited.
"""
from __future__ import annotations
from .audit import AuditLog


class RollbackManager:
    def __init__(self, audit: AuditLog) -> None:
        self._audit = audit
        self._completed: list[str] = []  # step names in execution order

    def record_success(self, step_name: str) -> None:
        self._completed.append(step_name)

    def rollback(self) -> list[str]:
        """Undo completed steps in reverse order. Returns list of rolled-back step names."""
        rolled_back: list[str] = []
        for step_name in reversed(self._completed):
            # Simulate undo — no real side effects
            self._audit.append("ROLLBACK", step=step_name, detail="Step undone (simulated)")
            rolled_back.append(step_name)
        self._completed.clear()
        return rolled_back