"""RollbackManager: undo successful steps in reverse order. REQ_ROLLBACK_PRESERVES_AUDIT."""
from __future__ import annotations
from policy_engine.audit import AuditLog


class RollbackManager:
    def __init__(self, audit: AuditLog) -> None:
        self._audit = audit
        self._completed: list[str] = []  # step names in execution order

    def record_success(self, step_name: str) -> None:
        self._completed.append(step_name)

    def rollback(self) -> list[str]:
        """Undo in reverse order. Returns list of rolled-back step names.
        REQ_ROLLBACK_PRESERVES_AUDIT: audit entries are ADDED, never removed."""
        rolled = []
        for step_name in reversed(self._completed):
            # Simulated undo — no real side effects
            self._audit.append("ROLLBACK", step_name, {"simulated": True})
            rolled.append(step_name)
        self._completed.clear()
        return rolled