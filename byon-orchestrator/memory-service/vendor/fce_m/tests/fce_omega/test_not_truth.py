"""Not-truth test: an Omega registration must not overwrite the runtime's
epistemic decision on the underlying slot.

Mission §6: "Nu trebuie ca Ω să devină sinonim cu 'adevăr'. Nu trebuie ca
un Ω să blocheze corecția epistemică."

Mission §8 test 5: "Un Ω nu are voie să suprascrie o decizie epistemică
de tip disputed/rejected."
"""

from __future__ import annotations


def test_omega_does_not_change_runtime_zone_of_underlying_slot():
    """We force coagulation on a center, then write a disputed entry to
    the same slot. The runtime adapter must still see the disputed event
    in its tension/slot logs, unmodified by FCE-Omega."""
    from unified_fragmergent_memory import UnifiedMemoryStore, Config

    store = UnifiedMemoryStore(Config(
        fce_omega_enabled=True, fce_omega_D=8,
        fce_omega_theta_s=0.0, fce_omega_tau_coag=1,
    ))

    # Coagulate the center.
    for i in range(3):
        store.write({
            "entity_id": "dragon", "attr_type": "color",
            "value_str": "red", "value_idx": 1,
            "episode_id": i + 1, "write_step": 0,
            "zone_after": "committed",
        })
        store.consolidate(episode_id=i + 1)
    assert store.omega_registry_snapshot()["count"] >= 1

    # Now contest the same slot.
    store.write({
        "entity_id": "dragon", "attr_type": "color",
        "value_str": "blue", "value_idx": 2,
        "episode_id": 99, "write_step": 0,
        "zone_after": "disputed",
    })
    store.consolidate(episode_id=99)

    # The runtime adapter still saw the disputed write — FCE-Omega has
    # NOT prevented it nor overwritten it.
    adapter = store._runtime_adapter
    assert adapter is not None
    last_slot = adapter.slot_event_log[-1]
    assert last_slot["entity"] == "dragon"
    assert last_slot["family"] == "color"
    assert last_slot["zone_after"] == "DISPUTED"
    # The Omega record may now be in "contested" / "active" but its
    # historical coagulation episode is unchanged.
    rec = store.omega_registry_snapshot()["records"][0]
    assert rec["coagulated_at_episode"] < 99


def test_registry_cannot_invent_records_via_expression_calls():
    """OmegaRegistry refuses to create a record from a transition call —
    that would let the morphogenetic layer pretend a coagulation existed.
    """
    import pytest
    from unified_fragmergent_memory.runtime.omega_registry import OmegaRegistry

    reg = OmegaRegistry()
    with pytest.raises(KeyError):
        reg.mark_contested("phantom::center", episode_id=1, reason="x")
    with pytest.raises(KeyError):
        reg.mark_inexpressed("phantom::center", episode_id=1, reason="x")
    with pytest.raises(KeyError):
        reg.mark_active("phantom::center", episode_id=1, reason="x")
    assert len(reg) == 0


def test_registry_rejects_unknown_expression_state():
    import pytest
    from unified_fragmergent_memory.runtime.omega_registry import OmegaRegistry

    reg = OmegaRegistry()
    reg.register(
        "dragon::color", 1, 1, 0.5, 0.5, "integrative",
        source_episodes=[1], source_events=[],
        duration_above_threshold=1,
    )
    with pytest.raises(ValueError):
        reg.set_expression_state("dragon::color", "uncoagulated",
                                  episode_id=2, reason="nope")
    with pytest.raises(ValueError):
        reg.set_expression_state("dragon::color", "true",
                                  episode_id=2, reason="nope")
