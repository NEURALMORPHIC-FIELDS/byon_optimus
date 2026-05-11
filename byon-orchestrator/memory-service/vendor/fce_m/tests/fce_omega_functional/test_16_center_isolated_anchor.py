"""FN-16 Center-isolated anchor (v0.4.1).

Closes the v0.4.0 limitation where the FCE-Omega observer derived a
single global anchor scalar from the runtime adapter's aggregate
metrics. With v0.4.1, anchor is computed per center from per-center
zone counts.

Contract:
  - disputed writes on center B do NOT modulate disrupt_eff for A
  - committed writes on A do NOT alter B's anchor
  - two independent centers stay bitwise-isolated across kappa / Z / Omega
  - Omega on A does not seed anchor mass for B
  - the v0.4.0 anchor_from_runtime_snapshot helper still exists for
    backward-compat consumers; the observer no longer routes through it.
"""

from __future__ import annotations

from tests.fce_omega_functional.conftest import symbolic_entry
from unified_fragmergent_memory import UnifiedMemoryStore, Config
from unified_fragmergent_memory.bridges.fce_translator import (
    anchor_from_center_counts,
    anchor_from_runtime_snapshot,
)


def _cfg() -> Config:
    return Config(
        fce_omega_enabled=True, fce_omega_D=8,
        fce_omega_theta_s=0.5, fce_omega_tau_coag=99,
    )


def test_anchor_from_center_counts_monotone():
    """Sanity-check the new bridge primitive."""
    a0 = anchor_from_center_counts(0, 0, 0)
    a_c = anchor_from_center_counts(5, 0, 0)
    a_d = anchor_from_center_counts(0, 0, 5)
    a_cd = anchor_from_center_counts(5, 0, 5)
    assert 0.0 <= a0 < a_c <= 1.0
    assert a_d == 0.0
    assert a_c > a_cd > a_d  # disputed counts push anchor toward 0


def test_backward_compat_global_anchor_still_exists():
    """v0.4.0 callers can still import anchor_from_runtime_snapshot."""
    snap = {"n_committed_slots": 3, "n_provisional_entries": 0,
            "n_tension_events": 1}
    assert 0.0 < anchor_from_runtime_snapshot(snap) <= 1.0


def test_disputed_on_B_does_not_touch_A_state():
    """Hard isolation: A is committed-only and never sees B's events."""
    s = UnifiedMemoryStore(_cfg())
    s.write(symbolic_entry("A", "x", "stable", 1, 0, zone="committed"))
    s.consolidate(episode_id=1)
    a_solo = s.fce_omega_observer().center_state("A::x")
    for k in range(8):
        s.write(symbolic_entry("B", "y", f"v{k}", 2 + k, 0, zone="disputed"))
        s.consolidate(episode_id=2 + k)
    a_after = s.fce_omega_observer().center_state("A::x")
    for field in ("kappa", "alpha", "rho", "lambda_ar",
                  "Z_norm", "anchor", "Omega"):
        assert a_after[field] == a_solo[field], (
            f"A.{field} changed under B-only disputes: "
            f"solo={a_solo[field]} after_B={a_after[field]}"
        )


def test_committed_on_A_raises_only_A_anchor():
    """Committed mass on A grows A's anchor; B's anchor stays at the
    same value the engine would compute from B's own (empty) committed
    history (anchor ~= 0 with one disputed)."""
    s = UnifiedMemoryStore(_cfg())
    # Initialize B with a disputed write so B exists as a center.
    s.write(symbolic_entry("B", "y", "v", 1, 0, zone="disputed"))
    s.consolidate(episode_id=1)
    b_initial = s.fce_omega_observer().center_state("B::y")["anchor"]
    # Now hammer A with committed writes.
    for k in range(6):
        s.write(symbolic_entry("A", "x", "stable",
                                2 + k, 0, zone="committed"))
        s.consolidate(episode_id=2 + k)
    a_after = s.fce_omega_observer().center_state("A::x")["anchor"]
    b_after = s.fce_omega_observer().center_state("B::y")["anchor"]
    assert a_after > b_initial, (
        f"A's anchor should rise with its own committed mass: "
        f"a_after={a_after}"
    )
    assert b_after == b_initial, (
        f"B's anchor must stay independent of A's mass: "
        f"b_initial={b_initial} b_after={b_after}"
    )


def test_two_independent_centers_bitwise_isolated():
    """Run a sequence and assert that mixing center B in does not change
    A's trajectory at all (within numerical equality)."""
    cfg = _cfg()

    # Run A in isolation.
    s_solo = UnifiedMemoryStore(cfg)
    for k in range(6):
        s_solo.write(symbolic_entry("A", "x", "stable",
                                     1 + k, 0, zone="committed"))
        s_solo.consolidate(episode_id=1 + k)
    a_solo = s_solo.fce_omega_observer().center_state("A::x")

    # Run A interleaved with B's disputed events.
    s_mixed = UnifiedMemoryStore(cfg)
    for k in range(6):
        ep_a = 1 + 2 * k
        ep_b = 2 + 2 * k
        s_mixed.write(symbolic_entry("A", "x", "stable",
                                      ep_a, 0, zone="committed"))
        s_mixed.consolidate(episode_id=ep_a)
        s_mixed.write(symbolic_entry("B", "y", f"v{k}",
                                      ep_b, 0, zone="disputed"))
        s_mixed.consolidate(episode_id=ep_b)
    a_mixed = s_mixed.fce_omega_observer().center_state("A::x")

    for field in ("kappa", "alpha", "rho", "lambda_ar",
                  "Z_norm", "anchor", "Omega"):
        assert a_mixed[field] == a_solo[field], (
            f"A.{field} diverged between solo and mixed runs: "
            f"solo={a_solo[field]} mixed={a_mixed[field]}"
        )


def test_omega_on_A_does_not_produce_anchor_mass_on_B():
    """Force coagulation on A. B must not gain anchor mass from A's
    Omega — the registry's record about A has no effect on B's
    per-center counters."""
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.0, fce_omega_tau_coag=1)
    s = UnifiedMemoryStore(cfg)
    # Coagulate A.
    for k in range(4):
        s.write(symbolic_entry("A", "x", "stable",
                                1 + k, 0, zone="committed"))
        s.consolidate(episode_id=1 + k)
    assert s.omega_registry_snapshot()["count"] >= 1
    # B has never been written to.
    b_state = s.fce_omega_observer().center_state("B::y")
    assert b_state == {"exists": False}, (
        f"B should not exist yet; got {b_state}"
    )
    # Now write one disputed event on B. B's anchor must reflect only
    # its own zone counts — not A's coagulation.
    s.write(symbolic_entry("B", "y", "v0", 99, 0, zone="disputed"))
    s.consolidate(episode_id=99)
    b_state = s.fce_omega_observer().center_state("B::y")
    assert b_state["zone_counts"] == {
        "COMMITTED": 0, "PROVISIONAL": 0, "DISPUTED": 1, "NONE": 0,
    }
    # anchor with c=0,p=0,d=1 -> 0/(0+0+1+1) = 0.0
    assert b_state["anchor"] == 0.0


def test_metrics_snapshot_exposes_per_center_anchor_and_counts():
    s = UnifiedMemoryStore(_cfg())
    for k in range(3):
        s.write(symbolic_entry("A", "x", "stable",
                                1 + 2 * k, 0, zone="committed"))
        s.consolidate(episode_id=1 + 2 * k)
        s.write(symbolic_entry("B", "y", f"v{k}",
                                2 + 2 * k, 0, zone="disputed"))
        s.consolidate(episode_id=2 + 2 * k)
    snap = s.metrics_snapshot()["fce_omega"]
    assert "center_anchors" in snap and "center_zone_counts" in snap
    assert "A::x" in snap["center_anchors"]
    assert "B::y" in snap["center_anchors"]
    # A had only committed -> anchor > 0; B only disputed -> anchor == 0.
    assert snap["center_anchors"]["A::x"] > 0.0
    assert snap["center_anchors"]["B::y"] == 0.0
    assert snap["center_zone_counts"]["A::x"]["COMMITTED"] == 3
    assert snap["center_zone_counts"]["B::y"]["DISPUTED"] == 3


def test_persist_load_roundtrips_zone_counts(tmp_path):
    s = UnifiedMemoryStore(_cfg())
    for k in range(3):
        s.write(symbolic_entry("A", "x", "stable",
                                1 + 2 * k, 0, zone="committed"))
        s.consolidate(episode_id=1 + 2 * k)
        s.write(symbolic_entry("B", "y", f"v{k}",
                                2 + 2 * k, 0, zone="disputed"))
        s.consolidate(episode_id=2 + 2 * k)
    counts_before = s.metrics_snapshot()["fce_omega"]["center_zone_counts"]
    anchors_before = s.metrics_snapshot()["fce_omega"]["center_anchors"]
    path = str(tmp_path / "obs_v041.json")
    s.fce_omega_observer().persist(path)

    s2 = UnifiedMemoryStore(_cfg())
    s2._ensure_fce_observer().load(path)
    counts_after = s2.metrics_snapshot()["fce_omega"]["center_zone_counts"]
    anchors_after = s2.metrics_snapshot()["fce_omega"]["center_anchors"]
    assert counts_after == counts_before
    assert anchors_after == anchors_before
