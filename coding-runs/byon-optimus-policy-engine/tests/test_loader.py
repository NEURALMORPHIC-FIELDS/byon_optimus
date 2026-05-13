"""Tests for the workflow loader."""
import json
import pathlib
import pytest

from policy_engine.loader import LoadError, load_workflow
from policy_engine.models import WorkflowDef


# ── helpers ──────────────────────────────────────────────────────────────────

def _write(tmp_path: pathlib.Path, data: dict, suffix: str = ".yaml") -> pathlib.Path:
    p = tmp_path / f"wf{suffix}"
    if suffix == ".json":
        p.write_text(json.dumps(data))
    else:
        import yaml
        p.write_text(yaml.dump(data))
    return p


MINIMAL = {
    "name": "minimal",
    "steps": [{"name": "lint", "gate": "lint"}],
}

LINEAR = {
    "name": "linear",
    "steps": [
        {"name": "lint", "gate": "lint"},
        {"name": "test", "gate": "test", "depends_on": ["lint"]},
        {"name": "build", "gate": "build", "depends_on": ["test"]},
    ],
}

CYCLIC = {
    "name": "cyclic",
    "steps": [
        {"name": "a", "gate": "lint", "depends_on": ["b"]},
        {"name": "b", "gate": "lint", "depends_on": ["a"]},
    ],
}


# ── tests ─────────────────────────────────────────────────────────────────────

def test_load_yaml_minimal(tmp_path):
    p = _write(tmp_path, MINIMAL)
    wf = load_workflow(p)
    assert isinstance(wf, WorkflowDef)
    assert wf.name == "minimal"
    assert len(wf.steps) == 1
    assert wf.steps[0].name == "lint"


def test_load_json(tmp_path):
    p = _write(tmp_path, LINEAR, suffix=".json")
    wf = load_workflow(p)
    assert wf.name == "linear"
    assert len(wf.steps) == 3


def test_depends_on_resolved(tmp_path):
    p = _write(tmp_path, LINEAR)
    wf = load_workflow(p)
    step_map = wf.step_map()
    assert step_map["test"].depends_on == ["lint"]
    assert step_map["build"].depends_on == ["test"]


def test_cycle_raises(tmp_path):
    p = _write(tmp_path, CYCLIC)
    with pytest.raises(LoadError, match="cycle"):
        load_workflow(p)


def test_unknown_dependency_raises(tmp_path):
    data = {
        "name": "bad",
        "steps": [{"name": "a", "gate": "lint", "depends_on": ["nonexistent"]}],
    }
    p = _write(tmp_path, data)
    with pytest.raises(LoadError, match="unknown step"):
        load_workflow(p)


def test_duplicate_step_name_raises(tmp_path):
    data = {
        "name": "dup",
        "steps": [
            {"name": "a", "gate": "lint"},
            {"name": "a", "gate": "test"},
        ],
    }
    p = _write(tmp_path, data)
    with pytest.raises(LoadError, match="Duplicate"):
        load_workflow(p)


def test_missing_gate_raises(tmp_path):
    data = {"name": "bad", "steps": [{"name": "a"}]}
    p = _write(tmp_path, data)
    with pytest.raises(LoadError, match="gate"):
        load_workflow(p)


def test_unsupported_extension_raises(tmp_path):
    p = tmp_path / "wf.toml"
    p.write_text("[workflow]")
    with pytest.raises(LoadError, match="Unsupported"):
        load_workflow(p)