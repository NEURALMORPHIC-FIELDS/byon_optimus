"""Passthrough wrapper for the fragmergent-memory-engine runtime project.

PATCHED FOR BYON INTEGRATION (2026-05-11):
- _SOURCE_ROOT now read from env FCEM_MEMORY_ENGINE_ROOT (fallback to original).
- Missing source no longer raises ImportError; module imports with stub state.
- Symbols re-exported from d_cortex remain None if source is unavailable.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from types import ModuleType
from typing import Any, Optional

_log = logging.getLogger("unified_fragmergent_memory.sources.memory_engine_runtime")

_DEFAULT_ROOT = Path("c:/Users/Lucian/Desktop/fragmergent-memory-engine")
_SOURCE_ROOT: Path = Path(
    os.environ.get("FCEM_MEMORY_ENGINE_ROOT", str(_DEFAULT_ROOT))
)
_CONSOLIDATION_DIR = _SOURCE_ROOT / "13_v15_7a_consolidation"

AVAILABLE: bool = (_CONSOLIDATION_DIR / "d_cortex" / "__init__.py").exists()

# Public exports — set to None in stub mode; populated below if AVAILABLE.
v15_7a_core: Optional[ModuleType] = None
adapter: Optional[ModuleType] = None
receptor: Optional[ModuleType] = None

reconcile = None
prune = None
retrograde = None
promote = None
run_consolidator_pipeline = None
ConsolidationRecord = None
json_safe = None
serialize_tuple_key = None
N_PROMOTE = None
M_RETROGRADE = None
K_PROMOTE_AGE = None
K_PRUNE_STALE = None
AttributeSlot = None
ObjectRecord = None
MiniBank = None
ProvisionalEntry = None
ProvisionalMemory = None
BankStabilityIndex = None

DCortexAdapter = None
LatentSignals = None
LATENT_MODE_OFF = "off"
LATENT_MODE_WRITE_ONLY = "write_only"
LATENT_MODE_ADVISORY = "advisory"
LatentRationalMemoryReceptor = None
LatentDecisionPressure = None


if AVAILABLE:
    _consolidation_str = str(_CONSOLIDATION_DIR)
    if _consolidation_str not in sys.path:
        sys.path.insert(0, _consolidation_str)

    try:
        import d_cortex as _d_cortex_runtime  # noqa: E402
        from d_cortex import v15_7a_core as _v15_7a_core  # noqa: E402
        from d_cortex import adapter as _adapter  # noqa: E402
        from d_cortex import receptor as _receptor  # noqa: E402

        v15_7a_core = _v15_7a_core
        adapter = _adapter
        receptor = _receptor

        reconcile = _v15_7a_core.reconcile
        prune = _v15_7a_core.prune
        retrograde = _v15_7a_core.retrograde
        promote = _v15_7a_core.promote
        run_consolidator_pipeline = _v15_7a_core.run_consolidator_pipeline
        ConsolidationRecord = _v15_7a_core.ConsolidationRecord
        json_safe = _v15_7a_core.json_safe
        serialize_tuple_key = _v15_7a_core.serialize_tuple_key
        N_PROMOTE = _v15_7a_core.N_PROMOTE
        M_RETROGRADE = _v15_7a_core.M_RETROGRADE
        K_PROMOTE_AGE = _v15_7a_core.K_PROMOTE_AGE
        K_PRUNE_STALE = _v15_7a_core.K_PRUNE_STALE
        AttributeSlot = _v15_7a_core.AttributeSlot
        ObjectRecord = _v15_7a_core.ObjectRecord
        MiniBank = _v15_7a_core.MiniBank
        ProvisionalEntry = _v15_7a_core.ProvisionalEntry
        ProvisionalMemory = _v15_7a_core.ProvisionalMemory
        BankStabilityIndex = _v15_7a_core.BankStabilityIndex

        DCortexAdapter = _adapter.DCortexAdapter
        LatentSignals = _adapter.LatentSignals
        LATENT_MODE_OFF = _adapter.LATENT_MODE_OFF
        LATENT_MODE_WRITE_ONLY = _adapter.LATENT_MODE_WRITE_ONLY
        LATENT_MODE_ADVISORY = _adapter.LATENT_MODE_ADVISORY
        LatentRationalMemoryReceptor = _receptor.LatentRationalMemoryReceptor
        LatentDecisionPressure = _receptor.LatentDecisionPressure
    except ImportError as _e:
        _log.warning(
            "memory_engine_runtime path exists but d_cortex import failed: %s. "
            "Falling back to stub mode.",
            _e,
        )
        AVAILABLE = False
else:
    _log.warning(
        "memory_engine_runtime source not found at %s (set FCEM_MEMORY_ENGINE_ROOT). "
        "Stub mode: write/read for symbolic entries will fail at runtime.",
        _CONSOLIDATION_DIR,
    )


_ignition_module: Optional[ModuleType] = None


def _load_ignition() -> ModuleType:
    """Lazily import ignition_build_v0 with stdout suppressed during the import."""
    global _ignition_module
    if _ignition_module is not None:
        return _ignition_module
    if not AVAILABLE:
        raise RuntimeError(
            "memory_engine_runtime unavailable (FCEM_MEMORY_ENGINE_ROOT not set or path missing). "
            "Cannot load ignition_build_v0."
        )
    import contextlib
    import io

    source_root_str = str(_SOURCE_ROOT)
    if source_root_str not in sys.path:
        sys.path.insert(0, source_root_str)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        import ignition_build_v0 as _ig  # noqa: F401, E402
    _ignition_module = _ig
    return _ignition_module


class _IgnitionLazyProxy:
    """Attribute-lookup proxy that loads ignition_build_v0 on first access."""

    def __getattr__(self, item: str) -> Any:
        module = _load_ignition()
        return getattr(module, item)


ignition = _IgnitionLazyProxy()

SOURCE_ROOT = _SOURCE_ROOT

__all__ = [
    "AVAILABLE",
    "v15_7a_core",
    "adapter",
    "receptor",
    "ignition",
    "reconcile",
    "prune",
    "retrograde",
    "promote",
    "run_consolidator_pipeline",
    "ConsolidationRecord",
    "json_safe",
    "serialize_tuple_key",
    "N_PROMOTE",
    "M_RETROGRADE",
    "K_PROMOTE_AGE",
    "K_PRUNE_STALE",
    "AttributeSlot",
    "ObjectRecord",
    "MiniBank",
    "ProvisionalEntry",
    "ProvisionalMemory",
    "BankStabilityIndex",
    "DCortexAdapter",
    "LatentSignals",
    "LATENT_MODE_OFF",
    "LATENT_MODE_WRITE_ONLY",
    "LATENT_MODE_ADVISORY",
    "LatentRationalMemoryReceptor",
    "LatentDecisionPressure",
    "SOURCE_ROOT",
]
