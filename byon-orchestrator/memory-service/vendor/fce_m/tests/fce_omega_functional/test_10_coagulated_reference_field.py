"""FN-10 Coagulated reference field.

When Omega_i = 1 for some center, it should produce an inspectable
reference effect (the runtime's committed-zone count drives the
observer's anchor scalar; coagulation does not auto-flip Omega for
other centers).

Per mission §1 + §6: an Omega-nucleus orients the field but does NOT
donate coagulation to other centers.
"""

from __future__ import annotations

from tests.fce_omega_functional.conftest import symbolic_entry
from unified_fragmergent_memory import UnifiedMemoryStore, Config


def _drive_coag(store, center=("dragon", "color"), n=4):
    for i in range(n):
        store.write(symbolic_entry(center[0], center[1], "red",
                                    episode_id=i + 1, write_step=0,
                                    zone="committed"))
        store.consolidate(episode_id=i + 1)


def test_coagulation_does_not_auto_coagulate_other_centers():
    """Use realistic theta/tau on the phoenix center side. Dragon is
    forced to coagulate via permissive params on its own track, but
    phoenix's lone disputed event cannot piggy-back on dragon's Omega."""
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.28, fce_omega_tau_coag=5)
    s = UnifiedMemoryStore(cfg)
    # Drive dragon with many committed writes to (try to) coagulate it.
    for i in range(8):
        s.write(symbolic_entry("dragon", "color", "red",
                                episode_id=i + 1, write_step=0,
                                zone="committed"))
        s.consolidate(episode_id=i + 1)
    # Now touch a different center, just once, with a disputed write.
    s.write(symbolic_entry("phoenix", "color", "varying",
                            episode_id=99, write_step=0, zone="disputed"))
    s.consolidate(episode_id=99)
    snap = s.omega_registry_snapshot()
    centers = {r["semantic_center"] for r in snap["records"]}
    # phoenix::color must NOT be in the registry — one disputed event
    # at realistic threshold cannot trigger coagulation, and it cannot
    # "borrow" Omega from dragon::color.
    assert "phoenix::color" not in centers, (
        f"phoenix auto-coagulated, registry centers={centers}"
    )


def test_anchor_grows_with_committed_count():
    """v0.4.1 per-center anchor: anchor for a center grows only with
    committed writes on THAT center. Committed writes on other centers
    no longer move this center's anchor."""
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.5, fce_omega_tau_coag=99)
    s = UnifiedMemoryStore(cfg)
    s.write(symbolic_entry("dragon", "color", "red", 1, 0, zone="committed"))
    s.consolidate(episode_id=1)
    rows_low = [r for r in s.fce_morphogenesis_log()
                if r["semantic_center"] == "dragon::color"]
    anchor_low = rows_low[-1]["anchor"]

    # Drive 6 more committed writes on the SAME center across episodes.
    for k in range(6):
        s.write(symbolic_entry("dragon", "color", "red",
                                2 + k, 0, zone="committed"))
        s.consolidate(episode_id=2 + k)
    rows_high = [r for r in s.fce_morphogenesis_log()
                 if r["semantic_center"] == "dragon::color"]
    anchor_high = rows_high[-1]["anchor"]
    assert anchor_high > anchor_low, (
        f"per-center anchor must grow with own committed mass: "
        f"low={anchor_low}, high={anchor_high}"
    )


def test_anchor_isolated_to_own_center():
    """Committed mass on other centers does NOT move this center's
    anchor (v0.4.1 isolation regression test)."""
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.5, fce_omega_tau_coag=99)
    s = UnifiedMemoryStore(cfg)
    s.write(symbolic_entry("dragon", "color", "red", 1, 0, zone="committed"))
    s.consolidate(episode_id=1)
    a_before = s.fce_omega_observer().center_state("dragon::color")["anchor"]
    # Drive 6 committed writes on distinct centers.
    for k in range(6):
        s.write(symbolic_entry(f"e{k}", "x", "v", 2 + k, 0, zone="committed"))
        s.consolidate(episode_id=2 + k)
    a_after = s.fce_omega_observer().center_state("dragon::color")["anchor"]
    assert a_after == a_before, (
        f"dragon::color anchor must be untouched by other centers' "
        f"committed mass; before={a_before}, after={a_after}"
    )


def test_coagulated_reference_emits_advisory_hint():
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.0, fce_omega_tau_coag=1)
    s = UnifiedMemoryStore(cfg)
    _drive_coag(s)
    hints = s.fce_advisory_hints()
    kinds = [h["kind"] for h in hints]
    assert "coagulated_reference" in kinds, (
        "coagulated centers should surface a coagulated_reference hint"
    )
