"""Append-only audit log (invariant_audit_append_only)."""
from __future__ import annotations
import json
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


class AuditLog:
    """
    In-memory append-only audit log.
    Entries are immutable once written; no deletion or rewrite is supported.
    Optionally persists to a JSONL file.
    """

    def __init__(self, jsonl_path: Optional[str] = None):
        self._entries: List[Dict[str, Any]] = []
        self._lock = threading.Lock()
        self._jsonl_path = jsonl_path

    def record(self, event_type: str, **kwargs: Any) -> Dict[str, Any]:
        """Append an immutable entry to the log."""
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": event_type,
            **kwargs,
        }
        with self._lock:
            self._entries.append(entry)
            if self._jsonl_path:
                with open(self._jsonl_path, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps(entry) + "\n")
        return entry

    def entries(self) -> List[Dict[str, Any]]:
        """Return a snapshot of all entries (read-only copy)."""
        with self._lock:
            return list(self._entries)

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)