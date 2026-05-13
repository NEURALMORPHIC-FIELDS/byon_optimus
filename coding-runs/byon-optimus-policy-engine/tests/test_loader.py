"""Tests for loader.py — REQ_CONFIG_UNTRUSTED."""
import json
import textwrap
import pytest
from pathlib import Path

from policy_engine.loader import load_workflow, LoadError


def _write(tmp_path: Path, name: str, content: str) -> Path:
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


def test_load_valid_yaml(tmp_path):
    p = _write(tmp_path, "wf.yaml", textwrap.dedent("""\
        name: test-wf
        steps:
          - name: step-a
            action: deploy
            environment: dev
            policy_gates: [dev-gate]
          - name: step-b
            action: verify
            depends_on: [step-a]
    """))
    wf = load_workflow(p)
    assert wf.name == "test-wf"
    assert len(wf.steps) == 2
    assert wf.steps[0].name == "step-a"
    assert wf.steps[1].depends_on == ["step-a"]


def test_load_valid_json(tmp_path):
    data = {"name": "json-wf", "steps": [{"name": "s1", "action": "build"}]}
    p = _write(tmp_path, "wf.json", json.dumps(data))
    wf = load_workflow(p)
    assert wf.name == "json-wf"
    assert wf.steps[0].action == "build"


def test_load_missing_file():
    with pytest.raises(LoadError, match="not found"):
        load_workflow("/nonexistent/path/wf.yaml")


def test_load_duplicate_step_names(tmp_path):
    p = _write(tmp_path, "bad.yaml", textwrap.dedent("""\
        name: bad
        steps:
          - name: dup
            action: a
          - name: dup
            action: b
    """))
    with pytest.raises(LoadError, match="Duplicate"):
        load_workflow(p)


def test_load_unsupported_extension(tmp_path):
    p = _write(tmp_path, "wf.toml", "name = 'x'")
    with pytest.raises(LoadError, match="Unsupported"):
        load_workflow(p)