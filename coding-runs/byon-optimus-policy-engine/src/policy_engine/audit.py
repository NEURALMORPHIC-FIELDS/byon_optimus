"""Append-only AuditLog. REQ_AUDIT_APPEND_ONLY + REQ_ROLLBACK_PRESERVES_AUDIT."""
from __future__ import annotations
import json
import time
from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class AuditEntry:
    timestamp: float
    event: str
    step: str | None
    detail: dict[str, Any]


class AuditLog:
    """In-memory append-only log. Entries are never removed (REQ_AUDIT_APPEND_ONLY)."""

    def __init__(self) -> None:
        self._entries: list[AuditEntry] = []

    def append(self, event: str, step: str | None = None, **detail: Any) -> None:
        self._entries.append(
            AuditEntry(timestamp=time.time(), event=event, step=step, detail=detail)
        )

    @property
    def entries(self) -> list[AuditEntry]:
        return list(self._entries)  # defensive copy — caller cannot mutate

    def dump_jsonl(self) -> str:
        lines = []
        for e in self._entries:
            lines.append(json.dumps(asdict(e)))
        return "\n".join(lines)