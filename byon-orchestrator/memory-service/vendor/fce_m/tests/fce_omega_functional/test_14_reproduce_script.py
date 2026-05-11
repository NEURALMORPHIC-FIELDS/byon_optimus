"""FN-14 reproduce.sh smoke test.

The reproduction script exists and (a) is syntactically valid bash,
(b) names entry points the package actually exports. We do NOT execute
the editable install / pytest steps in this test — those would touch
the user's environment and duplicate the test run that just ran. We
exercise only the import contract that the script depends on.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
REPRODUCE = REPO_ROOT / "reproduce.sh"


def test_reproduce_script_exists():
    assert REPRODUCE.exists(), "reproduce.sh must be present at repo root"


def test_reproduce_script_is_valid_bash_when_bash_available():
    bash = shutil.which("bash")
    if bash is None:
        pytest.skip("bash not available on this system")
    proc = subprocess.run(
        [bash, "-n", str(REPRODUCE)],
        capture_output=True, text=True,
    )
    assert proc.returncode == 0, (
        f"reproduce.sh failed syntax check: stderr={proc.stderr!r}"
    )


def test_reproduce_script_demo_entry_points_resolve():
    """The script imports several `run_*_demo` helpers from
    unified_fragmergent_memory.runtime. Verify they exist and are
    callable; otherwise the script is bit-rot."""
    from unified_fragmergent_memory import runtime as rt
    for name in (
        "run_end_to_end_demo",
        "run_cross_substrate_demo",
        "run_organism_driven_demo",
        "run_natural_coupling_demo",
        "run_natural_branch_flip_demo",
        "run_auto_registration_demo",
        "run_async_coupling_demo",
    ):
        fn = getattr(rt, name, None)
        assert callable(fn), (
            f"reproduce.sh references {name!r} which is no longer "
            f"exported from unified_fragmergent_memory.runtime"
        )


def test_reproduce_script_invokes_pytest_on_tests_dir():
    """A regression guard: if anyone removes the pytest step, the
    script no longer reproduces the suite."""
    text = REPRODUCE.read_text(encoding="utf-8")
    assert "pytest" in text
    assert "tests/" in text or "${HERE}/tests/" in text
