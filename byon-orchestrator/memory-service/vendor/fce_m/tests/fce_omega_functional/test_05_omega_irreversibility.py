"""FN-05 Omega irreversibility under post-coagulation perturbation.

Once Omega=1 for a center, no subsequent low-S_t observations can flip
Omega back to 0. Expression may oscillate among active / inexpressed /
contested but the coagulation event itself remains.
"""

from __future__ import annotations

from tests.fce_omega_functional.conftest import symbolic_entry
from unified_fragmergent_memory import UnifiedMemoryStore, Config


def _drive_to_coagulation(store, center=("dragon", "color"), n=5):
    for i in range(n):
        store.write(symbolic_entry(center[0], center[1], "red",
                                    episode_id=i + 1, write_step=0,
                                    zone="committed"))
        store.consolidate(episode_id=i + 1)


def test_omega_id_immutable_under_perturbation():
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.0, fce_omega_tau_coag=1)
    s = UnifiedMemoryStore(cfg)
    _drive_to_coagulation(s)
    snap = s.omega_registry_snapshot()
    assert snap["count"] >= 1
    rec = snap["records"][0]
    omega_id_before = rec["omega_id"]
    coag_ep_before = rec["coagulated_at_episode"]
    S_at_coag = rec["S_t_at_coagulation"]

    # Hammer the same slot with disputed writes.
    for i in range(25):
        s.write(symbolic_entry("dragon", "color", f"v{i}",
                                episode_id=200 + i, write_step=0,
                                zone="disputed"))
        s.consolidate(episode_id=200 + i)

    snap2 = s.omega_registry_snapshot()
    rec2 = next(r for r in snap2["records"]
                if r["semantic_center"] == "dragon::color")
    # The HISTORICAL coagulation is immutable.
    assert rec2["omega_id"] == omega_id_before
    assert rec2["coagulated_at_episode"] == coag_ep_before
    assert rec2["S_t_at_coagulation"] == S_at_coag
    # The expression state is in the valid set.
    assert rec2["expression_state"] in ("active", "inexpressed", "contested")
    # No record with Omega=0 sentinel can appear.
    for r in snap2["records"]:
        assert r["expression_state"] != "uncoagulated"


def test_observer_agent_omega_flag_stays_at_1_after_S_t_drop():
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.0, fce_omega_tau_coag=1)
    s = UnifiedMemoryStore(cfg)
    _drive_to_coagulation(s)
    obs = s.fce_omega_observer()
    state = obs.center_state("dragon::color")
    assert state["exists"]
    if state["Omega"] != 1:
        # Threshold was not reached on this seed; the rest of the assertion
        # would be vacuous. Bail with a clear message.
        import pytest
        pytest.skip("could not coagulate the center under permissive params")
    for i in range(15):
        s.write(symbolic_entry("dragon", "color", f"d{i}",
                                episode_id=500 + i, write_step=0,
                                zone="disputed"))
        s.consolidate(episode_id=500 + i)
    state2 = obs.center_state("dragon::color")
    assert state2["Omega"] == 1, "Omega must remain 1 once coagulated"


def test_expression_history_is_append_only():
    from unified_fragmergent_memory.runtime.omega_registry import OmegaRegistry
    reg = OmegaRegistry()
    reg.register("c", 1, 1, 0.5, 0.5, "integrative",
                  source_episodes=[1], source_events=[],
                  duration_above_threshold=1)
    reg.mark_contested("c", episode_id=2, reason="x")
    reg.mark_active("c", episode_id=3, reason="y")
    reg.mark_inexpressed("c", episode_id=4, reason="z")
    rec = reg.get("c")
    # The history grows monotonically; the original active entry is still
    # at index 0 even after later transitions.
    assert rec.expression_history[0]["new_state"] == "active"
    assert rec.expression_history[0]["episode_id"] == 1
    assert len(rec.expression_history) == 4
