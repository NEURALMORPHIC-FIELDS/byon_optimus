"""Append-only audit log.

Invariant: [invariant_audit_append_only] — entries are immutable once written.
Invariant: [invariant_rollback_preserves_audit] — rollback is audited, not erased.
"""
from __future__ import annotations
import json
import threading
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional


@dataclass(frozen=True)
class AuditEntry:
    timestamp: str
    event: str
    step_id: Optional[str]
    detail: str
    actor: str


class AuditLog:
    """Thread-safe, append-only audit log backed by an in-memory list and optional JSONL file."""

    def __init__(self, jsonl_path: Optional[Path] = None):
        self._entries: List[AuditEntry] = []
        self._lock = threading.Lock()
        self._path = jsonl_path

    def record(self, event: str, detail: str, step_id: Optional[str] = None, actor: str = "system") -> None:
        entry = AuditEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            event=event,
            step_id=step_id,
            detail=detail,
            actor=actor,
        )
        with self._lock:
            self._entries.append(entry)
            if self._path:
                with self._path.open("a", encoding="utf-8") as fh:
                    fh.write(json.dumps(asdict(entry)) + "\n")

    def entries(self) -> List[AuditEntry]:
        with self._lock:
            return list(self._entries)  # snapshot — callers cannot mutate internal list

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)