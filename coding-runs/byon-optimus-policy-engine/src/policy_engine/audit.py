"""
Audit log — append-only, immutable entries.

[invariant_audit_append_only]: entries are never removed or rewritten.
[invariant_rollback_preserves_audit]: rollback appends new entries; it does
  not delete existing ones.
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class AuditEntry:
    event: str
    workflow: str = ""
    step: str = ""
    detail: Dict[str, Any] = field(default_factory=dict)
    timestamp: str = field(
        default_factory=lambda: datetime.datetime.utcnow().isoformat()
    )


class AuditLog:
    """
    In-memory append-only audit log.

    [invariant_audit_append_only]: `append` is the only mutating method.
    There is no `remove`, `clear`, or `rewrite` method.
    """

    def __init__(self) -> None:
        self._entries: List[AuditEntry] = []

    def append(self, entry: AuditEntry) -> None:
        self._entries.append(entry)

    @property
    def entries(self) -> List[AuditEntry]:
        """Read-only view of all entries."""
        return list(self._entries)

    def __len__(self) -> int:
        return len(self._entries)