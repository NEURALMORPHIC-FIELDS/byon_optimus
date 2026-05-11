"""Verify d_cortex source files are reachable and the SHA256 seal holds.

Per O11 user resolution, the consolidation step's primitives are re-exported
from memory_engine_runtime; we verify the alias works.
"""

from __future__ import annotations


def test_d_cortex_source_root_exists():
    from unified_fragmergent_memory.sources import d_cortex
    assert d_cortex.SOURCE_ROOT.exists(), \
        f"d_cortex SOURCE_ROOT {d_cortex.SOURCE_ROOT} does not exist"
    assert d_cortex.MISSION_PATH.exists(), "MISIUNEA.txt missing"
    assert d_cortex.PROGRESS_PATH.exists(), "PROGRESS.md missing"


def test_d_cortex_step_13_seal_byte_identical():
    from unified_fragmergent_memory.sources import d_cortex
    assert d_cortex.STEP_13_CODE_PATH.exists()
    actual_hash = d_cortex.step_13_sha256()
    assert actual_hash.startswith(d_cortex.STEP_13_EXPECTED_SHA256_PREFIX), \
        f"step 13 code.py hash {actual_hash} does not match expected prefix " \
        f"{d_cortex.STEP_13_EXPECTED_SHA256_PREFIX}"
    assert d_cortex.verify_step_13_seal()


def test_d_cortex_step_13_alias_to_runtime_O11():
    """O11: d_cortex consolidation step primitives re-exported from runtime."""
    from unified_fragmergent_memory.sources import d_cortex
    from unified_fragmergent_memory.sources import memory_engine_runtime
    # The passthrough alias must point to the same module identity.
    assert d_cortex.step_13_passthrough is memory_engine_runtime
    # And must expose the same v15_7a_core constants.
    assert d_cortex.step_13_passthrough.N_PROMOTE == 2
    assert d_cortex.step_13_passthrough.M_RETROGRADE == 2


def test_d_cortex_other_step_files_exist():
    from unified_fragmergent_memory.sources import d_cortex
    assert d_cortex.STEP_08_10_CODE_PATH.exists(), "step 08-10 code.py missing"
    assert d_cortex.STEP_12_CODE_PATH.exists(), "step 12 code.py missing"
