"""Append-only audit log. REQ_AUDIT_APPEND_ONLY + REQ_ROLLBACK_PRESERVES_AUDIT."""
from __future__ import annotations
import json
import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class AuditEntry:
    timestamp: float
    event: str
    step: str
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "event": self.event,
            "step": self.step,
            "details": self.details,
        }


class AuditLog:
    """REQ_AUDIT_APPEND_ONLY: entries are never removed or mutated."""

    def __init__(self, jsonl_path: str | None = None) -> None:
        self._entries: list[AuditEntry] = []
        self._path = jsonl_path

    def append(self, event: str, step: str, details: dict[str, Any] | None = None) -> None:
        entry = AuditEntry(
            timestamp=time.time(),
            event=event,
            step=step,
            details=details or {},
        )
        self._entries.append(entry)
        if self._path:
            with open(self._path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry.to_dict()) + "\n")

    @property
    def entries(self) -> list[AuditEntry]:
        return list(self._entries)  # defensive copy; callers cannot mutate internal list

    def dump(self) -> str:
        lines = []
        for e in self._entries:
            lines.append(f"[{e.event:20s}] step={e.step!r:30s} details={e.details}")
        return "\n".join(lines)