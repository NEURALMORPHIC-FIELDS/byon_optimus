"""Passthrough wrapper for the D_CORTEX_ULTIMATE source project.

PATCHED FOR BYON INTEGRATION (2026-05-11):
- SOURCE_ROOT now read from env FCEM_DCORTEX_ROOT (fallback to original path).
- Missing source no longer raises ImportError at import time; module imports
  with stub state and logs a warning. Functions that need the source raise
  informative RuntimeError when actually called.

Per user decision 2026-05-06 (overlap O11), the byte-identical sealed file
13_v15_7a_consolidation/code.py is canonically owned by memory_engine_runtime.
"""

from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path
from typing import Optional

_log = logging.getLogger("unified_fragmergent_memory.sources.d_cortex")

_DEFAULT_ROOT = Path("c:/Users/Lucian/Desktop/D_CORTEX_ULTIMATE")
SOURCE_ROOT: Path = Path(os.environ.get("FCEM_DCORTEX_ROOT", str(_DEFAULT_ROOT)))

AVAILABLE: bool = (SOURCE_ROOT / "MISIUNEA.txt").exists()

if AVAILABLE:
    STEP_13_CODE_PATH = SOURCE_ROOT / "steps" / "13_v15_7a_consolidation" / "code.py"
    STEP_13_EXPECTED_SHA256_PREFIX = "f807db34f427baa2"
    STEP_08_10_CODE_PATH = SOURCE_ROOT / "steps" / "08-10_v15_5_to_v15_6_pas3" / "code.py"
    STEP_12_CODE_PATH = SOURCE_ROOT / "steps" / "12_v15_6_pas6_romr" / "code.py"
    MISSION_PATH = SOURCE_ROOT / "MISIUNEA.txt"
    PROGRESS_PATH = SOURCE_ROOT / "PROGRESS.md"
    README_PATH = SOURCE_ROOT / "README.md"
else:
    _log.warning(
        "d_cortex source not found at %s (set FCEM_DCORTEX_ROOT). "
        "Stub mode: morphogenetic features remain available, "
        "but step_13_passthrough / d_cortex-specific calls will fail at runtime.",
        SOURCE_ROOT,
    )
    STEP_13_CODE_PATH: Optional[Path] = None
    STEP_13_EXPECTED_SHA256_PREFIX = "f807db34f427baa2"
    STEP_08_10_CODE_PATH: Optional[Path] = None
    STEP_12_CODE_PATH: Optional[Path] = None
    MISSION_PATH: Optional[Path] = None
    PROGRESS_PATH: Optional[Path] = None
    README_PATH: Optional[Path] = None


def step_13_sha256() -> str:
    """Return SHA256 of the sealed step 13 code.py."""
    if not AVAILABLE or STEP_13_CODE_PATH is None:
        raise RuntimeError(
            "d_cortex source unavailable (FCEM_DCORTEX_ROOT not set or path missing). "
            "Cannot compute step_13_sha256."
        )
    h = hashlib.sha256()
    with open(STEP_13_CODE_PATH, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_step_13_seal() -> bool:
    """Verify the sealed step 13 code.py has the expected SHA256 prefix."""
    if not AVAILABLE:
        return False
    return step_13_sha256().startswith(STEP_13_EXPECTED_SHA256_PREFIX)


# Per O11: the d_cortex consolidation step's primitives are re-exported from
# the runtime project. Import lazily — if memory_engine_runtime is also stubbed,
# this still works because the import itself doesn't raise anymore.
try:
    from unified_fragmergent_memory.sources import memory_engine_runtime as step_13_passthrough  # noqa: E402,F401
except ImportError as _e:
    _log.warning("memory_engine_runtime passthrough unavailable: %s", _e)
    step_13_passthrough = None  # type: ignore[assignment]


__all__ = [
    "AVAILABLE",
    "SOURCE_ROOT",
    "STEP_13_CODE_PATH",
    "STEP_13_EXPECTED_SHA256_PREFIX",
    "STEP_08_10_CODE_PATH",
    "STEP_12_CODE_PATH",
    "MISSION_PATH",
    "PROGRESS_PATH",
    "README_PATH",
    "step_13_sha256",
    "verify_step_13_seal",
    "step_13_passthrough",
]
