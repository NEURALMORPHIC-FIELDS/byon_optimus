"""Tests for workflow loader and validation."""
import json
import textwrap
from pathlib import Path

import pytest

from policy_engine.loader import WorkflowValidationError, load_workflow


def _write(tmp_path: Path, content: str, name: str = "w