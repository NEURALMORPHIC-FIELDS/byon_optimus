"""Source provenance: every OmegaRecord can be traced back to the UFME
episodes and slot_events that produced it.

Mission §8 test 7: "Fiecare Ω trebuie să poată fi urmărit până la sursele
și episoadele care l-au produs."
"""

from __future__ import annotations


def test_omega_record_carries_source_episodes_and_events():
    from unified_fragmergent_memory import UnifiedMemoryStore, Config

    store = UnifiedMemoryStore(Config(
        fce_omega_enabled=True, fce_omega_D=8,
        fce_omega_theta_s=0.0, fce_omega_tau_coag=1,
    ))

    episodes = [1, 2, 3]
    for ep in episodes:
        store.write({
            "entity_id": "dragon", "attr_type": "color",
            "value_str": "red", "value_idx": 1,
            "episode_id": ep, "write_step": 0,
            "zone_after": "committed",
        })
        store.consolidate(episode_id=ep)

    snap = store.omega_registry_snapshot()
    assert snap["count"] >= 1, "no coagulation occurred under permissive params"
    rec = next(r for r in snap["records"]
               if r["semantic_center"] == "dragon::color")
    # Episodes that fed the coagulation are recorded.
    for ep in episodes:
        if ep <= rec["coagulated_at_episode"]:
            assert ep in rec["source_episodes"], (
                f"episode {ep} missing from omega.source_episodes; "
                f"got {rec['source_episodes']}"
            )
    # And the originating slot_events left audit-friendly breadcrumbs.
    assert len(rec["source_events"]) >= 1
    se = rec["source_events"][0]
    assert se.get("kind") == "slot_event"
    assert se.get("entity") == "dragon"
    assert se.get("family") == "color"


def test_morphogenesis_log_links_to_omega_id_on_coagulation():
    from unified_fragmergent_memory import UnifiedMemoryStore, Config

    store = UnifiedMemoryStore(Config(
        fce_omega_enabled=True, fce_omega_D=8,
        fce_omega_theta_s=0.0, fce_omega_tau_coag=1,
    ))
    for ep in range(1, 4):
        store.write({
            "entity_id": "phoenix", "attr_type": "color",
            "value_str": "gold", "value_idx": 7,
            "episode_id": ep, "write_step": 0,
            "zone_after": "committed",
        })
        store.consolidate(episode_id=ep)

    log = store.fce_morphogenesis_log()
    assert log, "morphogenesis log must not be empty after activity"
    # At least one record must carry an omega_id once coagulation occurs.
    snap = store.omega_registry_snapshot()
    if snap["count"] >= 1:
        coag_rec = snap["records"][0]
        matching = [r for r in log
                    if r["semantic_center"] == coag_rec["semantic_center"]
                    and r["omega_id"] == coag_rec["omega_id"]]
        assert matching, (
            "morphogenesis log must carry omega_id back to coagulated center"
        )
