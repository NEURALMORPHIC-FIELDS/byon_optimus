"""RollbackManager — undoes completed steps in reverse order.
REQ_ROLLBACK_PRESERVES_AUDIT: rollback appends to audit, never removes entries."""
from __future__ import annotations
from .audit import AuditLog
from .models import WorkflowStep


class RollbackManager:
    def __init__(self, audit: AuditLog) -> None:
        self._audit = audit
        self._completed: list[WorkflowStep] = []

    def record_success(self, step: WorkflowStep) -> None:
        self._completed.append(step)

    def rollback(self) -> list[str]:
        """Simulate rollback of completed steps in reverse order.
        Returns list of rolled-back step names."""
        rolled: list[str] = []
        for step in reversed(self._completed):
            # Simulated undo — no real side effects
            self._audit.append(
                "rollback",
                step=step.name,
                action=step.action,
                simulated=True,
            )
            rolled.append(step.name)
        self._completed.clear()
        return rolled