"""Append-only audit log (invariant_audit_append_only)."""
from __future__ import annotations
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class AuditLog:
    """In-memory append-only log; optionally persisted to JSONL."""

    def __init__(self, jsonl_path: str | Path | None = None) -> None:
        self._entries: list[dict[str, Any]] = []
        self._lock = threading.Lock()
        self._path = Path(jsonl_path) if jsonl_path else None

    def append(self, event: str, **kwargs: Any) -> None:
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "event": event,
            **kwargs,
        }
        with self._lock:
            self._entries.append(entry)
            if self._path:
                with self._path.open("a", encoding="utf-8") as fh:
                    fh.write(json.dumps(entry) + "\n")

    def entries(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._entries)

    def dump(self) -> str:
        return json.dumps(self.entries(), indent=2)