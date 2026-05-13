"""Tests for workflow loader / validator."""
import json
from pathlib import Path

import pytest
import yaml

from policy_engine.loader import load_workflow, _detect_cycles
from policy_engine.models import Step


def write_yaml(tmp_path: Path, data: dict) -> Path:
    p = tmp_path / "wf.yaml"
    p.write_text(yaml.dump(data), encoding="utf-8")
    return p


def write_json(tmp_path: Path, data: dict) -> Path:
    p = tmp_path / "wf.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    return p


MINIMAL = {
    "id": "wf_test",
    "name": "Test Workflow",
    "steps": [{"id": "step_a", "action": "build"}],
}


def test_load_valid_yaml(tmp_path):
    wf = load_workflow(write_yaml(tmp_path, MINIMAL))
    assert wf.id == "wf_test"
    assert len(wf.steps) == 1


def test_load_valid_json(tmp_path):
    wf = load_workflow(write_json(tmp