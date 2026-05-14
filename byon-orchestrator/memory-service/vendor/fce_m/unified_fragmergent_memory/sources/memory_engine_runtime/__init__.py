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
_ENV_ROOT: Path = Path(
    os.environ.get("FCEM_MEMORY_ENGINE_ROOT", str(_DEFAULT_ROOT))
)

# FSOAT 2026-05-14: FCEM_MEMORY_ENGINE_ROOT may point EITHER at the parent
# `fragmergent-memory-engine` dir OR directly at the `13_v15_7a_consolidation`
# subdir. Resolve both: if the env path itself contains `d_cortex/__init__.py`
# it IS the consolidation dir; otherwise append the v15.7a subdir.
if (_ENV_ROOT / "d_cortex" / "__init__.py").exists():
    _CONSOLIDATION_DIR = _ENV_ROOT
    _SOURCE_ROOT = _ENV_ROOT.parent
elif (_ENV_ROOT / "13_v15_7a_consolidation" / "d_cortex" / "__init__.py").exists():
    _SOURCE_ROOT = _ENV_ROOT
    _CONSOLIDATION_DIR = _ENV_ROOT / "13_v15_7a_consolidation"
else:
    # Neither layout resolved — keep the historical behaviour so the
    # shim-not-found warning still names a sensible path.
    _SOURCE_ROOT = _ENV_ROOT
    _CONSOLIDATION_DIR = _ENV_ROOT / "13_v15_7a_consolidation"

AVAILABLE: bool = (_CONSOLIDATION_DIR / "d_cortex" / "__init__.py").exists()

# FSOAT 2026-05-14: runtime-source provenance, exported so memory-service and
# the FSOAT runner can prove whether the EXTERNAL v15.7a runtime was loaded or
# the vendored minimal in-memory shim was used. Set definitively below.
RUNTIME_SOURCE: str = "external_v15_7a" if AVAILABLE else "vendored_minimal_shim"
SHIM_USED: bool = not AVAILABLE
RUNTIME_ROOT: str = str(_CONSOLIDATION_DIR)
ADAPTER_CLASS_NAME: str = "unknown"  # set after adapter selection below

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

        # FSOAT 2026-05-14: real external v15.7a runtime loaded.
        RUNTIME_SOURCE = "external_v15_7a"
        SHIM_USED = False
        ADAPTER_CLASS_NAME = getattr(DCortexAdapter, "__name__", "DCortexAdapter")
        _log.info(
            "memory_engine_runtime: EXTERNAL v15.7a runtime loaded from %s "
            "(adapter=%s, shim_used=False)",
            _CONSOLIDATION_DIR, ADAPTER_CLASS_NAME,
        )
    except ImportError as _e:
        _log.warning(
            "memory_engine_runtime path exists but d_cortex import failed: %s. "
            "Falling back to stub mode.",
            _e,
        )
        AVAILABLE = False
        RUNTIME_SOURCE = "vendored_minimal_shim"
        SHIM_USED = True
else:
    _log.warning(
        "memory_engine_runtime source not found at %s (set FCEM_MEMORY_ENGINE_ROOT). "
        "Loading vendored minimal in-memory DCortexAdapter shim. The shim satisfies "
        "the FCE-M write/consolidate contract for receipt assimilation but does NOT "
        "implement the full v15.7a consolidation pipeline (no real reconcile/prune/"
        "retrograde/promote, no Omega coagulation, no theta_s/tau_coag dynamics). "
        "Set FCEM_MEMORY_ENGINE_ROOT to the v15.7a source root to load the real runtime.",
        _CONSOLIDATION_DIR,
    )

    # ------------------------------------------------------------------
    # Vendored minimal in-memory shim
    # ------------------------------------------------------------------
    # FSOAT 2026-05-13 fix: the upstream fragmergent-memory-engine v15.7a research
    # source is the operator's own project, not vendored here. Without a valid
    # FCEM_MEMORY_ENGINE_ROOT, FCE-M's symbolic write path raised
    # `TypeError("'NoneType' object is not callable")` because DCortexAdapter was
    # left as None. This shim restores the minimum contract that FCE-M uses:
    #
    #   DCortexAdapter(mode, N_promote, M_retrograde, K_promote_age, K_prune_stale)
    #       .ingest_slot_event(slot_event_dict)      -- called by memory_store.write
    #       .end_episode(episode_id)                 -- called by store.consolidate
    #       .metrics_snapshot()                      -- called by store.consolidate
    #
    # The shim is deliberately inert beyond record-keeping: it does NOT perform
    # consolidation, propagation, Omega coagulation, or any latent dynamics. It
    # exists so receipt assimilation can complete on a clean repo checkout. When
    # the real v15.7a source is provided via FCEM_MEMORY_ENGINE_ROOT, this branch
    # is bypassed and the real DCortexAdapter loads above.

    LATENT_MODE_OFF = "off"
    LATENT_MODE_WRITE_ONLY = "write_only"
    LATENT_MODE_ADVISORY = "advisory"

    class _MinimalDCortexAdapter:
        """In-memory shim for DCortexAdapter. Records slot_events without coagulation.

        Operator-locked invariants this shim respects:
          - theta_s is NOT read or written by this shim.
          - tau_coag is NOT read or written by this shim.
          - No Omega anchor is created.
          - No ReferenceField is created.
          - operator_seeded origin is never mutated by this shim.
        """

        def __init__(
            self,
            mode: str = LATENT_MODE_OFF,
            N_promote: int = 0,
            M_retrograde: int = 0,
            K_promote_age: int = 0,
            K_prune_stale: int = 0,
        ) -> None:
            self.mode = mode
            self.N_promote = int(N_promote or 0)
            self.M_retrograde = int(M_retrograde or 0)
            self.K_promote_age = int(K_promote_age or 0)
            self.K_prune_stale = int(K_prune_stale or 0)
            self._events: list = []
            self._episode_count = 0
            self._is_shim = True

        def ingest_slot_event(self, slot_event):
            """Record a slot_event. Returns nothing; in-memory list is the side effect."""
            if not isinstance(slot_event, dict):
                raise TypeError(
                    "ingest_slot_event requires a dict; got %r" % type(slot_event).__name__
                )
            for key in ("entity", "family", "zone_after"):
                if key not in slot_event:
                    raise KeyError(
                        "slot_event missing required key %r (shim contract)" % key
                    )
            self._events.append(dict(slot_event))

        def end_episode(self, episode_id: int):
            """Mark episode boundary. Returns inert LatentSignals-shaped dict."""
            self._episode_count += 1
            return {
                "episode_id": int(episode_id),
                "shim_mode": True,
                "events_in_episode": sum(
                    1 for _ in self._events
                ),
                "note": "minimal in-memory shim; no real propagation performed",
            }

        def metrics_snapshot(self):
            """Inert metrics shape used by FCE-Omega observer for read-only inspection."""
            return {
                "last_pipeline_ops": {
                    "reconcile": 0,
                    "prune": 0,
                    "retrograde": 0,
                    "promote": 0,
                },
                "shim_mode": True,
                "total_slot_events": len(self._events),
                "episodes_closed": self._episode_count,
            }

    DCortexAdapter = _MinimalDCortexAdapter

    # FSOAT 2026-05-14: shim path — runtime-source provenance is explicit.
    RUNTIME_SOURCE = "vendored_minimal_shim"
    SHIM_USED = True
    ADAPTER_CLASS_NAME = "_MinimalDCortexAdapter"

    # AVAILABLE intentionally stays False so any code path that gates on it
    # (e.g. _load_ignition) still raises a clear error rather than silently
    # using the shim for a feature it does not implement.


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
    "RUNTIME_SOURCE",
    "SHIM_USED",
    "RUNTIME_ROOT",
    "ADAPTER_CLASS_NAME",
]


def runtime_provenance() -> dict:
    """FSOAT 2026-05-14: machine-readable proof of which FCE-M runtime loaded.

    Returns the four provenance fields the FSOAT external-runtime validation
    consumes. `shim_used == True` means the vendored minimal in-memory shim is
    active and the external v15.7a runtime was NOT loaded.
    """
    return {
        "enabled": True,
        "runtime_source": RUNTIME_SOURCE,
        "runtime_root": RUNTIME_ROOT,
        "shim_used": SHIM_USED,
        "adapter_class": ADAPTER_CLASS_NAME,
        "available": AVAILABLE,
    }
