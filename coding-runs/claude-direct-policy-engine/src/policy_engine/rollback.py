"""
RollbackManager — undoes successful steps in reverse order.
invariant_rollback_preserves_audit: rollback is audited; history is never erased.
"""
from __future__ import annotations
from typing import List

from .audit import AuditLog
from .engine import StepResult
from .models import StepStatus


class RollbackManager:
    def __init__(self, audit: AuditLog):
        self._audit = audit

    def rollback(self, results: List[StepResult], reason: str = "manual rollback") -> None:
        """
        Undo all successful steps in reverse execution order.
        Skipped steps are not rolled back (they never ran).
        Audit entries for original steps are preserved (invariant_rollback_preserves_audit).
        """
        successful = [r for r in results if r.status == StepStatus.SUCCESS]
        self._audit.record(
            "rollback_start",
            reason=reason,
            steps_to_rollback=[r.step.id for r in reversed(successful)],
        )
        for result in reversed(successful):
            step = result.step
            # Simulate rollback — no real side effects
            self._audit.record(
                "rollback_step",
                step_id=step.id,
                action=step.action,
                simulated=True,
                note=f"[SIMULATED ROLLBACK] reversing '{step.action}' on '{step.name}'",
            )
        self._audit.record("rollback_end", steps_rolled_back=len(successful))