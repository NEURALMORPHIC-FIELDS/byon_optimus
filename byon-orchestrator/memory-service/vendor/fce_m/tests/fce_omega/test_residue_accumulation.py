"""Residue accumulation: a sequence of conflicting writes must grow the
center's Z (active residue), not collapse it.

Mission §8 test 3: "O secventa de intrari conflictuale trebuie sa creasca Z."
"""

from __future__ import annotations


def _slot_event_disputed(entity, attr, value, episode_id, write_step):
    """Emit a slot_event tagged DISPUTED to drive residue."""
    return {
        "entity_id": entity, "attr_type": attr,
        "value_str": value, "value_idx": (hash(value) & 0xFFFF),
        "episode_id": episode_id, "write_step": write_step,
        "zone_after": "disputed",
    }


def test_disputed_writes_grow_residue_for_their_center():
    from unified_fragmergent_memory import UnifiedMemoryStore, Config
    store = UnifiedMemoryStore(Config(
        fce_omega_enabled=True, fce_omega_D=12, fce_omega_tau_coag=20,
    ))

    # Drive 6 disputed writes against the same slot across two episodes.
    for k, v in enumerate(["red", "blue", "green", "yellow", "violet", "cyan"]):
        store.write(_slot_event_disputed("dragon", "color", v,
                                          episode_id=1 + (k // 3),
                                          write_step=k))
    store.consolidate(episode_id=1)
    store.consolidate(episode_id=2)

    log = store.fce_morphogenesis_log()
    rows_for_center = [r for r in log
                       if r["semantic_center"] == "dragon::color"]
    assert len(rows_for_center) >= 1
    final_Z = rows_for_center[-1]["Z_norm"]
    # The FCE-Omega bridge marks disputed slots with high residue weight,
    # so we should see a strictly positive Z after conflicting writes.
    # Empirically the agent's residue norm crosses 0.5 within 6 disputed
    # events; we assert a conservative lower bound to keep the test stable.
    assert final_Z > 0.2, (
        f"residue Z must grow under conflicting/disputed writes, got "
        f"Z_norm={final_Z}"
    )
