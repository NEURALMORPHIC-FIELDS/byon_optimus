"""Omega irreversibility: once Omega = 1 for a center, no subsequent S_t
decrease can flip it back to 0.

Mission §8 test 4 / mission §6 ("un nucleu coagulat poate fi identitar
pentru sistem, dar dacă datele brute îl contrazic, stratul epistemic
trebuie să rămână capabil să marcheze conflictul")  — the registry
expresses contestation, but never erases the coagulation event.
"""

from __future__ import annotations


def test_omega_record_persists_after_expression_change():
    from unified_fragmergent_memory.runtime.omega_registry import (
        OmegaRegistry,
        EXPRESSION_ACTIVE,
        EXPRESSION_CONTESTED,
        EXPRESSION_INEXPRESSED,
    )

    reg = OmegaRegistry()
    rec = reg.register(
        semantic_center="dragon::color",
        coagulated_at_episode=5,
        coagulated_at_cycle=42,
        S_t_at_coagulation=0.51,
        kappa_at_coagulation=0.62,
        sine_type="integrative",
        source_episodes=[1, 2, 3, 4, 5],
        source_events=[{"entity": "dragon", "family": "color"}],
        duration_above_threshold=12,
    )
    omega_id_before = rec.omega_id
    assert rec.expression_state == EXPRESSION_ACTIVE

    # Expression cycles: contested -> inexpressed -> active.
    reg.mark_contested("dragon::color", episode_id=10, reason="new disputed evidence")
    reg.mark_inexpressed("dragon::color", episode_id=12, reason="no expression")
    reg.mark_active("dragon::color", episode_id=15, reason="reconfirmed")

    rec_after = reg.get("dragon::color")
    # Coagulation episode and id never change.
    assert rec_after.coagulated_at_episode == 5
    assert rec_after.S_t_at_coagulation == 0.51
    assert rec_after.omega_id == omega_id_before
    # History captures the cycle of transitions.
    states = [h["new_state"] for h in rec_after.expression_history]
    assert EXPRESSION_ACTIVE in states
    assert EXPRESSION_CONTESTED in states
    assert EXPRESSION_INEXPRESSED in states


def test_re_registering_same_center_is_idempotent():
    from unified_fragmergent_memory.runtime.omega_registry import OmegaRegistry
    reg = OmegaRegistry()
    a = reg.register(
        "dragon::color", 5, 42, 0.51, 0.62, "integrative",
        source_episodes=[1, 2], source_events=[],
        duration_above_threshold=12,
    )
    b = reg.register(
        "dragon::color", 99, 999, 0.10, 0.10, "turbulent",
        source_episodes=[99], source_events=[],
        duration_above_threshold=1,
    )
    assert a is b
    # The original record is preserved — no overwrite by the second
    # register call.
    assert b.coagulated_at_episode == 5
    assert b.S_t_at_coagulation == 0.51
    assert b.sine_type == "integrative"


def test_registry_persistence_roundtrip(tmp_path):
    from unified_fragmergent_memory.runtime.omega_registry import OmegaRegistry
    reg = OmegaRegistry()
    reg.register(
        "dragon::color", 5, 42, 0.51, 0.62, "integrative",
        source_episodes=[1, 2, 3], source_events=[{"kind": "slot_event"}],
        duration_above_threshold=12,
    )
    reg.mark_contested("dragon::color", episode_id=10, reason="dispute")
    path = str(tmp_path / "omega_reg.json")
    reg.persist(path)

    reg2 = OmegaRegistry()
    reg2.load(path)
    assert len(reg2) == 1
    rec = reg2.get("dragon::color")
    assert rec is not None
    assert rec.coagulated_at_episode == 5
    assert rec.expression_state == "contested"
    # The history is preserved across reload — Omega is a historical fact.
    states = [h["new_state"] for h in rec.expression_history]
    assert states == ["active", "contested"]


def test_observer_omega_irreversible_after_drop_in_S_t():
    """Drive the observer until a center coagulates, then bombard it
    with low-S_t observations; Omega must stay at 1."""
    from unified_fragmergent_memory import UnifiedMemoryStore, Config

    store = UnifiedMemoryStore(Config(
        fce_omega_enabled=True,
        fce_omega_D=8,
        fce_omega_theta_s=0.05,   # easy threshold for testing
        fce_omega_tau_coag=2,     # quick coagulation
    ))

    # Drive coagulation with COMMITTED writes to the same slot.
    for i in range(6):
        store.write({
            "entity_id": "dragon", "attr_type": "color",
            "value_str": "red", "value_idx": 1,
            "episode_id": i + 1, "write_step": 0,
            "zone_after": "committed",
        })
        store.consolidate(episode_id=i + 1)

    snap = store.omega_registry_snapshot()
    if snap["count"] == 0:
        # Threshold/tau were not reached on this seed. Mark soft pass
        # rather than fail — the observer's job is also to NOT coagulate
        # spuriously. We re-run with even softer params.
        store2 = UnifiedMemoryStore(Config(
            fce_omega_enabled=True,
            fce_omega_D=8,
            fce_omega_theta_s=0.0,
            fce_omega_tau_coag=1,
        ))
        for i in range(4):
            store2.write({
                "entity_id": "dragon", "attr_type": "color",
                "value_str": "red", "value_idx": 1,
                "episode_id": i + 1, "write_step": 0,
                "zone_after": "committed",
            })
            store2.consolidate(episode_id=i + 1)
        snap = store2.omega_registry_snapshot()
        store = store2

    assert snap["count"] >= 1, (
        "Could not drive any coagulation under permissive thresholds; "
        "the test cannot verify irreversibility."
    )
    rec_before = snap["records"][0]
    omega_id_before = rec_before["omega_id"]
    coag_ep_before = rec_before["coagulated_at_episode"]

    # Now bombard the same slot with disputed writes (which lower S_t).
    for i in range(20):
        store.write({
            "entity_id": "dragon", "attr_type": "color",
            "value_str": f"variant_{i}",
            "value_idx": 999 - i,
            "episode_id": 100 + i, "write_step": 0,
            "zone_after": "disputed",
        })
        store.consolidate(episode_id=100 + i)

    snap2 = store.omega_registry_snapshot()
    rec_after = next(r for r in snap2["records"]
                     if r["semantic_center"] == "dragon::color")
    # Omega remains coagulated; the identity of the record is unchanged.
    assert rec_after["omega_id"] == omega_id_before
    assert rec_after["coagulated_at_episode"] == coag_ep_before
    # Expression state may change (active/contested), but never reverts to
    # any "uncoagulated"-like sentinel.
    assert rec_after["expression_state"] in ("active", "inexpressed", "contested")
