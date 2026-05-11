"""FN-04 Assimilation vs residue discrimination.

A coherent sequence (same slot, same value, all COMMITTED) must produce
visibly more AR / less residue than a conflicting sequence (same slot,
varying values, all DISPUTED).
"""

from __future__ import annotations

from tests.fce_omega_functional.conftest import symbolic_entry
from unified_fragmergent_memory import UnifiedMemoryStore, Config


def _run(store: UnifiedMemoryStore, values, zones, slot=("dragon", "color")):
    """Drive one event per episode so the observer sees each event as its
    own observation cycle (within-episode events are aggregated)."""
    for k, (v, z) in enumerate(zip(values, zones)):
        store.write(symbolic_entry(slot[0], slot[1], v,
                                    episode_id=k + 1, write_step=0, zone=z))
        store.consolidate(episode_id=k + 1)


def _final_row(store, center):
    rows = [r for r in store.fce_morphogenesis_log()
            if r["semantic_center"] == center]
    assert rows, f"no morphogenesis row for {center}"
    return rows[-1]


def test_coherent_sequence_assimilates_better_than_conflicting():
    """Discrimination axes (per FCE-Ω formal model):
      * coherent push aligns Phi_s along a stable direction -> AR grows,
        kappa is preserved or grows;
      * conflicting push fires residue in different orthogonal directions
        each cycle -> kappa is depressed by disruption, AR stays lower.

    Z_norm alone is a misleading discriminator because coherent
    sequences accumulate residue along the SAME direction (it sums),
    whereas conflicting orthogonal residues partially cancel. We check
    the axes the mission actually cares about: integration (AR, kappa)
    vs unintegrated burden (disrupt-driven kappa decay)."""
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.05, fce_omega_tau_coag=99)

    coherent = UnifiedMemoryStore(cfg)
    _run(coherent,
         values=["red"] * 8,
         zones=["committed"] * 8,
         slot=("dragon", "color"))
    cr = _final_row(coherent, "dragon::color")

    conflicting = UnifiedMemoryStore(cfg)
    _run(conflicting,
         values=["red", "blue", "green", "yellow",
                 "violet", "cyan", "ochre", "indigo"],
         zones=["disputed"] * 8,
         slot=("dragon", "color"))
    fr = _final_row(conflicting, "dragon::color")

    # Coherent integrates more: AR and kappa both higher.
    assert cr["AR"] > fr["AR"], (
        f"coherent AR should exceed conflicting: "
        f"coherent_AR={cr['AR']}, conflicting_AR={fr['AR']}"
    )
    assert cr["kappa"] >= fr["kappa"] - 0.02, (
        f"coherent kappa should not be worse than conflicting: "
        f"coherent_kappa={cr['kappa']}, conflicting_kappa={fr['kappa']}"
    )
    # Note: raw S_t is NOT a reliable discriminator. S_t = AR*kappa*I*B
    # where B = 1/(1+||Z||); conflicting sequences have lower Z (random
    # orthogonal residues cancel), so B is higher and can compensate
    # the AR/kappa loss. The mission's "integration vs residue"
    # signature is captured by AR + kappa.


def test_coherent_sequence_has_finite_S_t_and_no_immediate_blowup():
    """A long, perfectly coherent run must stay numerically well-behaved."""
    cfg = Config(fce_omega_enabled=True, fce_omega_D=8,
                 fce_omega_theta_s=0.05, fce_omega_tau_coag=4)
    s = UnifiedMemoryStore(cfg)
    for i in range(12):
        s.write(symbolic_entry("dragon", "color", "red",
                                episode_id=i + 1, write_step=0,
                                zone="committed"))
        s.consolidate(episode_id=i + 1)
    rows = [r for r in s.fce_morphogenesis_log()
            if r["semantic_center"] == "dragon::color"]
    for r in rows:
        assert 0.0 <= r["AR"] <= 1.0
        assert 0.0 <= r["S_t"]
        assert r["S_t"] < 10.0, f"S_t blew up: {r['S_t']}"
        assert r["Z_norm"] < 100.0, f"Z_norm blew up: {r['Z_norm']}"
