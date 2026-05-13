"""Test JSONL file persistence for AuditLog."""
import json
from pathlib import Path

from policy_engine.audit import AuditLog


def test_jsonl_file_written(tmp_path):
    log_file = tmp_path / "audit.jsonl"
    log = AuditLog(jsonl_path=log_file)
    log.append("ev1", data=1)
    log.append("ev2", data=2)
    lines = log_file.read_text().strip().splitlines()
    assert len(lines) == 2
    first = json.loads(lines[0])
    assert first["event"] == "ev1"


def test_jsonl_is_append_only(tmp_path):
    log_file = tmp_path / "audit.jsonl"
    log = AuditLog(jsonl_path=log_file)
    log.append("first")
    log.append("second")
    # Re-open same file — lines must not be overwritten
    lines = log_file.read_text().strip().splitlines()
    events = [json.loads(l)["event"] for l in lines]
    assert events == ["first", "second"]