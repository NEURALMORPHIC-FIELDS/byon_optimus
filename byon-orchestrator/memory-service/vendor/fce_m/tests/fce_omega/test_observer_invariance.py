"""Observer invariance: enabling the FCE-Omega passive observer does not
change UFME's read / write / consolidate decisions.

Mission §8 test 2: "Cu FCE activ pasiv, read/write/consolidate trebuie sa
dea aceleasi rezultate ca inainte."
"""

from __future__ import annotations


def _entry(e, a, v, ep, ws):
    return {
        "entity_id": e, "attr_type": a,
        "value_str": v, "value_idx": (hash(v) & 0xFFFF),
        "episode_id": ep, "write_step": ws,
        "zone_after": "committed",
    }


def test_consolidate_ops_identical_with_and_without_observer():
    from unified_fragmergent_memory import UnifiedMemoryStore, Config

    entries = [
        _entry("dragon", "color", "red", 1, 0),
        _entry("dragon", "size", "large", 1, 1),
        _entry("phoenix", "color", "gold", 2, 0),
    ]

    store_off = UnifiedMemoryStore(Config(fce_omega_enabled=False))
    store_on = UnifiedMemoryStore(Config(fce_omega_enabled=True,
                                         fce_omega_D=8,
                                         fce_omega_tau_coag=3))

    for e in entries:
        store_off.write(e)
        store_on.write(e)

    out_off = store_off.consolidate(episode_id=1)
    out_on = store_on.consolidate(episode_id=1)

    # The runtime-side fields are unchanged.
    assert out_off["episode_id"] == out_on["episode_id"]
    assert out_off["ops"] == out_on["ops"]
    assert out_off["signals_summary"] == out_on["signals_summary"]

    # Only difference: the optional fce_omega_report key.
    assert out_off["fce_omega_report"] is None
    assert out_on["fce_omega_report"] is not None
    assert out_on["fce_omega_report"]["episode_id"] == 1


def test_runtime_metrics_unchanged_by_observer():
    """The adapter's metrics_snapshot is the runtime's authoritative
    contract. The observer reads it but never writes back."""
    from unified_fragmergent_memory import UnifiedMemoryStore, Config

    store_off = UnifiedMemoryStore(Config(fce_omega_enabled=False))
    store_on = UnifiedMemoryStore(Config(fce_omega_enabled=True,
                                         fce_omega_D=8,
                                         fce_omega_tau_coag=3))

    for e in [
        _entry("dragon", "color", "red", 1, 0),
        _entry("dragon", "size", "large", 1, 1),
    ]:
        store_off.write(e)
        store_on.write(e)
    store_off.consolidate(episode_id=1)
    store_on.consolidate(episode_id=1)

    rt_off = store_off.metrics_snapshot()["memory_engine_runtime"]
    rt_on = store_on.metrics_snapshot()["memory_engine_runtime"]
    # Pop fields that depend on object identity / live time but not on
    # decisions. The op counts and event-log sizes are what matter.
    for key in ["last_pipeline_ops", "n_slot_events", "n_tension_events",
                "n_resolution_events", "n_identity_events",
                "n_self_observer_events", "audit_log_size",
                "n_provisional_entries", "n_committed_slots"]:
        assert rt_off.get(key) == rt_on.get(key), (
            f"runtime field {key!r} diverged between observer-off and "
            f"observer-on: off={rt_off.get(key)!r} on={rt_on.get(key)!r}"
        )
