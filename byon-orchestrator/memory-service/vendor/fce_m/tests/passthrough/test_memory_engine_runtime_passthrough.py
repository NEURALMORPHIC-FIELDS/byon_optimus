"""Verify memory_engine_runtime source primitives are reachable through the
unified namespace.

Invariant I1, I3, I4: the public symbols extracted in
sources/memory_engine_runtime/__init__.py must point to the same callables
the runtime project exposes.
"""

from __future__ import annotations

import pytest


def test_runtime_v15_7a_core_symbols_reachable():
    from unified_fragmergent_memory.sources import memory_engine_runtime
    expected = [
        "reconcile", "prune", "retrograde", "promote",
        "run_consolidator_pipeline",
        "ConsolidationRecord", "json_safe", "serialize_tuple_key",
        "N_PROMOTE", "M_RETROGRADE", "K_PROMOTE_AGE", "K_PRUNE_STALE",
        "AttributeSlot", "ObjectRecord", "MiniBank",
        "ProvisionalEntry", "ProvisionalMemory", "BankStabilityIndex",
    ]
    for name in expected:
        assert hasattr(memory_engine_runtime, name), \
            f"missing {name} on unified memory_engine_runtime namespace"


def test_runtime_constants_match_sealed_v15_7a_values():
    from unified_fragmergent_memory.sources import memory_engine_runtime as runtime
    assert runtime.N_PROMOTE == 2
    assert runtime.M_RETROGRADE == 2
    assert runtime.K_PROMOTE_AGE == 2
    assert runtime.K_PRUNE_STALE == 3


def test_runtime_minibank_construction_and_basic_ops():
    from unified_fragmergent_memory.sources import memory_engine_runtime as runtime
    bank = runtime.MiniBank()
    assert bank.find_by_entity_id("dragon") is None
    rec = bank.allocate_entity("dragon")
    assert rec is not None
    assert bank.find_by_entity_id("dragon") is not None


def test_runtime_provisional_memory_basic_ops():
    from unified_fragmergent_memory.sources import memory_engine_runtime as runtime
    pm = runtime.ProvisionalMemory()
    pm.reset()
    pm.add(runtime.ProvisionalEntry(
        entity_id="dragon", attr_type="color", value_idx=1,
        episode_id=1, write_step=0, source_text="the dragon is red",
    ))
    assert len(pm.entries) == 1


def test_runtime_consolidator_pipeline_callable_signature():
    from unified_fragmergent_memory.sources import memory_engine_runtime as runtime
    bank = runtime.MiniBank()
    pm = runtime.ProvisionalMemory()
    bsi = runtime.BankStabilityIndex()
    audit = []
    counts = runtime.run_consolidator_pipeline(
        provisional_memory=pm, bank=bank, stability_index=bsi,
        current_episode=1, audit=audit,
        N=runtime.N_PROMOTE, M=runtime.M_RETROGRADE,
        K_age=runtime.K_PROMOTE_AGE, K_stale=runtime.K_PRUNE_STALE,
    )
    assert isinstance(counts, dict)
    for op in ("RECONCILE", "PRUNE", "RETROGRADE", "PROMOTE"):
        assert op in counts


def test_runtime_dcortex_adapter_construction():
    from unified_fragmergent_memory.sources import memory_engine_runtime as runtime
    adapter = runtime.DCortexAdapter(
        mode=runtime.LATENT_MODE_ADVISORY,
        N_promote=2, M_retrograde=2, K_promote_age=2, K_prune_stale=3,
    )
    snap = adapter.metrics_snapshot()
    assert isinstance(snap, dict)
