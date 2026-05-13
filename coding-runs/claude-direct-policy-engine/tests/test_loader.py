"""Tests for workflow loader / validator — including condition parsing."""
from __future__ import annotations
import json
import textwrap
import pytest
from pathlib import Path

from policy_engine.loader import load_workflow, ValidationError


def _write(tmp_path: Path, content: str, name: str = "wf.yaml") -> Path:
    p = tmp_path / name
    p.write_text(textwrap.dedent(content))
    return p


# ---------------------------------------------------------------------------
# Happy-path loading
# ---------------------------------------------------------------------------

def test_load_valid_yaml(tmp_path):
    p = _write(tmp_path, """
        name: my-workflow
        version: "1.0"
        steps:
          - id: step-lint
            name: Lint
            action: lint
          - id: step-test
            name: Test