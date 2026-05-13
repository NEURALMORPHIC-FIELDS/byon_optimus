"""Tests specifically for the AuditLog."""
import threading
from policy_engine.audit import AuditLog


def test_audit_records_entry():
    log = AuditLog()
    log.record("event_type", "some detail", step_id="s1", actor="user")
    entries = log.entries()
    assert len(entries) == 1
    e = entries[0]
    assert e.event == "event_type"
    assert e.detail == "some detail"
    assert e.step_id == "s1"
    assert e.actor == "user"


def test_audit_entries_immutable_frozen():
    log = AuditLog()
    log.record("ev", "d")
    entry = log.entries()[0]
    # AuditEntry is frozen dataclass — mutation must raise
    import pytest
    with pytest.raises((AttributeError, TypeError)):
        entry.event = "changed"  # type: ignore[misc]


def test_audit_thread_safe():
    log = AuditLog()
    errors = []

    def worker(i):
        try:
            for j in range(10):
                log.record("thread_event", f"worker {i} iter {j}")
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors
    assert len(log) == 50


def test_audit_jsonl_persistence(tmp_path):
    import json
    path = tmp_path / "audit.jsonl"
    log = AuditLog(jsonl_path=path)
    log.record("ev1", "detail one")
    log.record("ev2", "detail two")

    lines = path.read_text().splitlines()
    assert len(lines) == 2
    first = json.loads(lines[0])
    assert first["event"] == "ev1"