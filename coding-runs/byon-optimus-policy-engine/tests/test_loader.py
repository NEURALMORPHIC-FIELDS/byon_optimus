"""Tests for loader.py — REQ_CONFIG_UNTRUSTED."""
import json
import pathlib
import pytest
from policy_engine.loader import load_workflow, LoadError
from policy_engine.models import WorkflowDefinition


def _write(tmp_path: pathlib.Path, name: str, content: str) -> pathlib.Path:
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


def test_load_valid_yaml(tmp_path):
    p = _write(tmp_path, "wf.yaml", """
name: test-wf
steps:
  - name: build
    action: compile
  - name: deploy
    action: ship
    depends_on: [build]
""")
    wf = load_workflow(p)
    assert isinstance(wf, WorkflowDefinition)
    assert wf.name == "test-wf"
    assert len(wf.steps) == 2
    assert wf.steps[1].depends_on == ["build"]


def test_load_valid_json(tmp_path):
    data = {"name": "json-wf", "steps": [{"name": "s1", "action": "run"}]}
    p = _write(tmp_path, "wf.json", json.dumps(data))
    wf = load_workflow(p)
    assert wf.name == "json-wf"
    assert wf.steps[0].name == "s1"


def test_load_missing_file():
    with pytest.raises(LoadError, match="not found"):
        load_workflow("/nonexistent/path/wf.yaml")


def test_load_unsupported_extension(tmp_path):
    p = _write(tmp_path, "wf.toml", "name = 'x'")
    with pytest.raises(LoadError, match="Unsupported"):
        load_workflow(p)


def test_load_duplicate_step_names(tmp_path):
    p = _write(tmp_path, "wf.yaml", """
name: dup
steps:
  - name: step1
    action: a
  - name: step1
    action: b
""")
    with pytest.raises(LoadError, match="duplicate"):
        load_workflow(p)