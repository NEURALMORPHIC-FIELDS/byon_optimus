"""Pytest conftest for the Level 3 research package.

The package lives at `byon-orchestrator/level3-research/`. The hyphen in
the directory name means the directory itself is not a valid Python
module identifier, so we put it on `sys.path` here so the `schemas`
sub-package becomes importable as `schemas` for the tests.

This sys.path manipulation is LOCAL to the test process. It does NOT
affect production modules. It only makes `schemas/*` importable from
the test files in this directory.

Isolation policy (restated): nothing in this conftest may import from
`byon-orchestrator/src/`, `byon-orchestrator/scripts/`, or
`byon-orchestrator/memory-service/`. See `__init__.py` at the package
root for the isolation guard.
"""

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_PKG_ROOT = os.path.dirname(_HERE)   # byon-orchestrator/level3-research/

if _PKG_ROOT not in sys.path:
    sys.path.insert(0, _PKG_ROOT)
