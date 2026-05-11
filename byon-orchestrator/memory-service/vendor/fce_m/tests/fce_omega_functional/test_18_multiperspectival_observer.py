"""FN-18 Multiperspectival observer (v0.5.0).

The observer composes directional inter-center interactions when two or
more centers are active in the same consolidate pass. Composition is
PASSIVE (records traces + relation candidates, does not write back to
UFME) and ADVISORY (the candidates do not auto-coagulate Omega).

Mission §3 Etapa 3:
  - I_i<-j != I_j<-i (asymmetry preserved)
  - interference antisymmetric in runtime: K_ij + K_ji ~ 0
  - normalization on term classes prevents field explosion
  - relation-candidate produced but does not flip Omega
  - reference-field anchor from Omega centers does not coagulate others
  - per-center isolation (v0.4.1) still holds when centers are not
    co-active in the same pass.
"""

from __future__ import annotations

from typing import Dict, List

from tests.fce_omega_functional.conftest import (
    symbolic_entry, runtime_view,
)
from unified_fragmergent_memory import UnifiedMemoryStore, Config


def _cfg(multiperspectival: bool = True, theta_pair: float = 0.05) -> Config:
    return Config(
        fce_omega_enabled=True,
        fce_omega_D=8,
        fce_omega_theta_s=0.05,
        fce_omega_tau_coag=99,  # never auto-coag via single-center rule
        fce_multiperspectival_enabled=multiperspectival,
        fce_multiperspectival_anchor_eta=0.30,
        fce_multiperspectival_theta_pair=theta_pair,
    )


def _three_coactive(s: UnifiedMemoryStore, episode_id: int = 1) -> None:
    for k, e in enumerate(["A", "B", "C"]):
        s.write(symbolic_entry(e, "x", "red", episode_id, k, zone="committed"))
    s.consolidate(episode_id=episode_id)


# ---------------------------------------------------------------------
# 1. test_multiperspectival_observer_detects_active_centers
# ---------------------------------------------------------------------

def test_multiperspectival_observer_detects_active_centers():
    s = UnifiedMemoryStore(_cfg())
    _three_coactive(s)
    snap = s.metrics_snapshot()["fce_omega"]
    assert snap["centers"] == 3
    # 3 centers -> 3 * 2 = 6 ordered pairs of directional traces.
    assert snap["interaction_log_size"] == 6
    log = s.fce_interaction_log()
    centers_in_traces = {(t["center_i"], t["center_j"]) for t in log}
    expected = {("A::x", "B::x"), ("A::x", "C::x"),
                ("B::x", "A::x"), ("B::x", "C::x"),
                ("C::x", "A::x"), ("C::x", "B::x")}
    assert centers_in_traces == expected


# ---------------------------------------------------------------------
# 2. test_directional_interaction_i_to_j_differs_from_j_to_i
# ---------------------------------------------------------------------

def test_directional_interaction_i_to_j_differs_from_j_to_i():
    """Two centers with asymmetric histories. A gets a long committed
    ramp; B gets a single committed write. Then they co-act in one
    consolidate. Their directional absorption traces must differ."""
    cfg = _cfg()
    s = UnifiedMemoryStore(cfg)
    # Warm A up alone so its alpha/kappa diverge from B's.
    for ep in range(1, 6):
        s.write(symbolic_entry("A", "x", "red", ep, 0, zone="committed"))
        s.consolidate(episode_id=ep)
    # B only sees a single committed write co-active with A in this pass.
    s.write(symbolic_entry("A", "x", "red", 100, 0, zone="committed"))
    s.write(symbolic_entry("B", "y", "blue", 100, 1, zone="committed"))
    s.consolidate(episode_id=100)
    log = s.fce_interaction_log()
    ab = next(t for t in log
              if t["center_i"] == "A::x" and t["center_j"] == "B::y")
    ba = next(t for t in log
              if t["center_i"] == "B::y" and t["center_j"] == "A::x")
    # A is the seasoned receiver and absorbs B's delta differently
    # than B (newcomer) absorbs A's delta.
    assert ab["absorption_norm"] != ba["absorption_norm"]
    assert ab["repulsion_norm"] != ba["repulsion_norm"]


# ---------------------------------------------------------------------
# 3. test_interference_antisymmetry_wired_in_observer
# ---------------------------------------------------------------------

def test_interference_antisymmetry_wired_in_observer():
    """K_{i<-j} + K_{j<-i} must vanish in the runtime, not only in
    the vendor primitive."""
    s = UnifiedMemoryStore(_cfg())
    _three_coactive(s)
    log = s.fce_interaction_log()
    for t in log:
        # The observer records the residual ||K_ij + K_ji||; this must
        # be at machine zero.
        assert t["interference_antisym_residual"] < 1e-12, (
            f"interference is not antisymmetric for "
            f"({t['center_i']}, {t['center_j']}): residual="
            f"{t['interference_antisym_residual']}"
        )


# ---------------------------------------------------------------------
# 4. test_absorption_repulsion_are_directional
# ---------------------------------------------------------------------

def test_absorption_repulsion_are_directional():
    """Across all pairs in a co-active set, at least one direction
    must have a different magnitude from its reverse."""
    s = UnifiedMemoryStore(_cfg())
    # Use 4 centers with different prior histories so absorption /
    # repulsion magnitudes differ in both directions.
    for ep in range(1, 4):
        s.write(symbolic_entry("A", "x", "red", ep, 0, zone="committed"))
        s.consolidate(episode_id=ep)
    s.write(symbolic_entry("D", "z", "violet", 4, 0, zone="disputed"))
    s.consolidate(episode_id=4)
    # Now drive a co-active pass with all four centers.
    s.write(symbolic_entry("A", "x", "red", 10, 0, zone="committed"))
    s.write(symbolic_entry("B", "y", "blue", 10, 1, zone="committed"))
    s.write(symbolic_entry("C", "w", "green", 10, 2, zone="committed"))
    s.write(symbolic_entry("D", "z", "violet", 10, 3, zone="disputed"))
    s.consolidate(episode_id=10)
    log = [t for t in s.fce_interaction_log() if t["episode_id"] == 10]
    asymmetric_pairs = 0
    for t in log:
        rev = next((r for r in log
                    if r["center_i"] == t["center_j"]
                    and r["center_j"] == t["center_i"]), None)
        if rev is None:
            continue
        if (abs(t["absorption_norm"] - rev["absorption_norm"]) > 1e-10
                or abs(t["repulsion_norm"] - rev["repulsion_norm"]) > 1e-10):
            asymmetric_pairs += 1
    assert asymmetric_pairs > 0, (
        "no directional pair showed asymmetric absorption/repulsion; "
        "primitives are not being differentiated"
    )


# ---------------------------------------------------------------------
# 5. test_multiperspectival_normalization_bounded_for_N_1_4_8_16
# ---------------------------------------------------------------------

def test_multiperspectival_normalization_bounded_for_N_1_4_8_16():
    """The total directional-interaction norm across an active set
    must stay bounded as N grows; if it scaled like N or N^2, the
    field would explode (R8). With class-wise normalization (terms /
    N*(N-1)), the per-pass total stays roughly constant."""
    def total_directional_norm(N: int) -> float:
        s = UnifiedMemoryStore(_cfg(theta_pair=0.5))  # avoid candidates
        for k in range(N):
            s.write(symbolic_entry(f"e{k}", "x", "red", 1, k,
                                    zone="committed"))
        s.consolidate(episode_id=1)
        log = s.fce_interaction_log()
        return sum(
            t["absorption_norm"] + t["repulsion_norm"]
            + t["interference_norm"] + t["directional_coag_norm"]
            for t in log
        )

    t_1 = total_directional_norm(1)   # 0 pairs (N < 2 -> no composition)
    t_4 = total_directional_norm(4)
    t_8 = total_directional_norm(8)
    t_16 = total_directional_norm(16)
    assert t_1 == 0.0, f"N=1 should have no pairs; got {t_1}"
    # The normalization clamps total to ~O(1), independent of N.
    # We assert the absolute total stays below a generous ceiling
    # so a regression that drops the normalization would fail loudly.
    for total, N in [(t_4, 4), (t_8, 8), (t_16, 16)]:
        assert total < 2.0, (
            f"directional total for N={N} exploded: {total}"
        )


# ---------------------------------------------------------------------
# 6. test_no_auto_coagulation_from_reference_field
# ---------------------------------------------------------------------

def test_no_auto_coagulation_from_reference_field():
    """A center with Omega=1 emits reference-field anchor influence to
    its co-active neighbors, but a single disputed event on a new
    center must NOT cross the threshold rule on its own."""
    cfg = Config(
        fce_omega_enabled=True,
        fce_omega_D=8,
        fce_omega_theta_s=0.10,
        fce_omega_tau_coag=3,
        fce_multiperspectival_enabled=True,
    )
    s = UnifiedMemoryStore(cfg)
    # Phase 1: drive A to coagulation alone.
    for ep in range(1, 6):
        s.write(symbolic_entry("A", "x", "red", ep, 0, zone="committed"))
        s.consolidate(episode_id=ep)
    snap = s.omega_registry_snapshot()
    assert snap["count"] == 1
    assert snap["records"][0]["semantic_center"] == "A::x"
    # Phase 2: co-active with B disputed. B receives ref anchor from A's
    # Omega but must not coagulate on a single disputed event.
    s.write(symbolic_entry("A", "x", "red", 50, 0, zone="committed"))
    s.write(symbolic_entry("B", "y", "blue", 50, 1, zone="disputed"))
    s.consolidate(episode_id=50)
    snap2 = s.omega_registry_snapshot()
    centers = {r["semantic_center"] for r in snap2["records"]}
    assert "B::y" not in centers, (
        f"B::y must not auto-coagulate from A's reference field; "
        f"registry now has {centers}"
    )


# ---------------------------------------------------------------------
# 7. test_relation_candidate_does_not_override_individual_omega
# ---------------------------------------------------------------------

def test_relation_candidate_does_not_override_individual_omega():
    """A shared-coag candidate produced for (A, B) does not set Omega
    on B if B has not crossed its own threshold rule."""
    s = UnifiedMemoryStore(_cfg(theta_pair=0.05))
    _three_coactive(s)
    cands = s.fce_relation_candidates()
    assert cands, "expected at least one relation candidate for 3 co-active centers"
    # No Omega was registered because tau_coag=99 in _cfg.
    assert s.omega_registry_snapshot()["count"] == 0
    # The candidate explicitly disclaims epistemic authority.
    for c in cands:
        assert "advisory" in c["note"]
        assert "does not modify individual Omega" in c["note"]


# ---------------------------------------------------------------------
# 8. test_center_isolation_preserved_without_explicit_interaction
# ---------------------------------------------------------------------

def test_center_isolation_preserved_without_explicit_interaction():
    """v0.4.1 isolation regression: with multiperspectival ON, two
    centers that NEVER co-active in the same consolidate pass must
    still stay bitwise-isolated on Z and kappa."""
    cfg = _cfg()
    # Run A in isolation (no co-active passes).
    s_solo = UnifiedMemoryStore(cfg)
    for ep in range(1, 7):
        s_solo.write(symbolic_entry("A", "x", "stable", ep, 0,
                                     zone="committed"))
        s_solo.consolidate(episode_id=ep)
    a_solo = s_solo.fce_omega_observer().center_state("A::x")

    # Run A interleaved with B, but ALWAYS in separate consolidates.
    s_mixed = UnifiedMemoryStore(cfg)
    for k in range(6):
        ep_a = 1 + 2 * k
        ep_b = 2 + 2 * k
        s_mixed.write(symbolic_entry("A", "x", "stable", ep_a, 0,
                                      zone="committed"))
        s_mixed.consolidate(episode_id=ep_a)
        s_mixed.write(symbolic_entry("B", "y", f"v{k}", ep_b, 0,
                                      zone="disputed"))
        s_mixed.consolidate(episode_id=ep_b)
    a_mixed = s_mixed.fce_omega_observer().center_state("A::x")
    for field in ("kappa", "alpha", "Z_norm", "Omega", "anchor"):
        assert a_mixed[field] == a_solo[field], (
            f"A.{field} diverged under non-coactive interleaving with B "
            f"(multiperspectival ON should not couple them when they "
            f"are not in the same consolidate pass): "
            f"solo={a_solo[field]} mixed={a_mixed[field]}"
        )
    # No interaction traces produced because A and B never overlapped.
    assert s_mixed.fce_interaction_log() == []


# ---------------------------------------------------------------------
# 9. test_passive_invariance_still_holds
# ---------------------------------------------------------------------

def test_passive_invariance_still_holds():
    """With multiperspectival ON but no advisory feedback wired (we
    are still in passive-with-advisory mode), the runtime adapter's
    decisions and audit_log must be identical to the OFF run."""
    cfg_off = Config(fce_omega_enabled=True, fce_omega_D=8,
                     fce_multiperspectival_enabled=False)
    cfg_on = Config(fce_omega_enabled=True, fce_omega_D=8,
                    fce_multiperspectival_enabled=True)
    s_off = UnifiedMemoryStore(cfg_off)
    s_on = UnifiedMemoryStore(cfg_on)
    for k, e in enumerate(["A", "B", "C"]):
        s_off.write(symbolic_entry(e, "x", "red", 1, k, zone="committed"))
        s_on.write(symbolic_entry(e, "x", "red", 1, k, zone="committed"))
    o_off = s_off.consolidate(episode_id=1)
    o_on = s_on.consolidate(episode_id=1)
    assert o_off["ops"] == o_on["ops"]
    assert o_off["signals_summary"] == o_on["signals_summary"]
    assert runtime_view(s_off) == runtime_view(s_on)
    assert len(s_off.audit_log()) == len(s_on.audit_log())
    # The only place difference appears is the FCE side.
    assert s_on.fce_interaction_log()
    assert s_off.fce_interaction_log() == []


# ---------------------------------------------------------------------
# 10. test_persist_load_multiperspectival_traces
# ---------------------------------------------------------------------

def test_persist_load_multiperspectival_traces(tmp_path):
    s = UnifiedMemoryStore(_cfg())
    _three_coactive(s)
    traces_before = s.fce_interaction_log()
    candidates_before = s.fce_relation_candidates()
    assert traces_before
    assert candidates_before

    path = str(tmp_path / "obs_v050.json")
    s.fce_omega_observer().persist(path)
    s2 = UnifiedMemoryStore(_cfg())
    s2._ensure_fce_observer().load(path)
    assert s2.fce_interaction_log() == traces_before
    assert s2.fce_relation_candidates() == candidates_before
    # The reloaded observer also reports multiperspectival_enabled True.
    assert s2.metrics_snapshot()["fce_omega"]["multiperspectival_enabled"] is True
