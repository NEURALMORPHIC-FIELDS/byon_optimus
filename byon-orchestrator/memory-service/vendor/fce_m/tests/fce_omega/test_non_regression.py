"""Non-regression: UnifiedMemoryStore must behave identically with
FCE-Omega disabled (default) as it did before v0.4.0.

Mission §6 / §7 Etapa 1: "Toate testele actuale UFME trebuie să treacă
neschimbate" — this file checks the simple end-to-end contract of write
+ consolidate + audit_log when fce_omega_enabled=False (the default).
"""

from __future__ import annotations


def _entry(entity: str, attr: str, value: str, episode_id: int, write_step: int):
    return {
        "entity_id": entity,
        "attr_type": attr,
        "value_str": value,
        "value_idx": hash(value) & 0xFFFF,
        "episode_id": episode_id,
        "write_step": write_step,
        "zone_after": "committed",
    }


def test_default_config_has_fce_omega_disabled():
    from unified_fragmergent_memory import Config
    cfg = Config()
    assert cfg.fce_omega_enabled is False


def test_consolidate_works_with_fce_omega_disabled():
    from unified_fragmergent_memory import UnifiedMemoryStore
    store = UnifiedMemoryStore()
    store.write(_entry("dragon", "color", "red", 1, 0))
    store.write(_entry("dragon", "size", "large", 1, 1))
    out = store.consolidate(episode_id=1)
    assert out["episode_id"] == 1
    assert "ops" in out
    assert "signals_summary" in out
    # The key exists in the contract but stays None when disabled, so old
    # callers can ignore it.
    assert out["fce_omega_report"] is None


def test_observer_not_constructed_when_disabled():
    from unified_fragmergent_memory import UnifiedMemoryStore
    store = UnifiedMemoryStore()
    store.write(_entry("dragon", "color", "red", 1, 0))
    store.consolidate(episode_id=1)
    assert store.fce_omega_observer() is None
    snap = store.metrics_snapshot()
    assert snap["fce_omega"] == {"enabled": False, "initialized": False}


def test_audit_log_unchanged_by_fce_omega():
    """The observer's morphogenesis log is separate from audit_log; the
    UFME audit_log must contain exactly the runtime entries, no FCE rows.
    """
    from unified_fragmergent_memory import UnifiedMemoryStore, Config
    enabled_store = UnifiedMemoryStore(Config(fce_omega_enabled=True,
                                              fce_omega_D=8,
                                              fce_omega_tau_coag=3))
    enabled_store.write(_entry("dragon", "color", "red", 1, 0))
    enabled_store.consolidate(episode_id=1)
    audit = enabled_store.audit_log()
    # All audit rows must come from the runtime — none of them is an
    # FCE-Omega morphogenesis record.
    for row in audit:
        assert "S_t" not in (
            row if isinstance(row, dict) else getattr(row, "__dict__", {})
        ), "audit_log must not be polluted with FCE-Omega rows"

    # And the morphogenesis log is reachable via the separate accessor.
    mlog = enabled_store.fce_morphogenesis_log()
    assert len(mlog) >= 1
    assert all("S_t" in r and "semantic_center" in r for r in mlog)
