"""FN-03 Residue accumulation under repeated conflict.

A sequence of conflicting writes on the same semantic center must grow
the active residue norm Z_t, and the center must not get downgraded out
of the morphogenesis log just because consolidate ran.
"""

from __future__ import annotations

from tests.fce_omega_functional.conftest import symbolic_entry


def test_residue_grows_with_disputed_writes(store_on):
    """One disputed write per episode so the observer sees the per-event
    trajectory (it aggregates within-episode events as one observation)."""
    values = ["red", "blue", "green", "yellow", "violet", "cyan", "ochre"]
    for k, v in enumerate(values):
        store_on.write(symbolic_entry(
            "dragon", "color", v, episode_id=k + 1,
            write_step=0, zone="disputed",
        ))
        store_on.consolidate(episode_id=k + 1)
    rows = [r for r in store_on.fce_morphogenesis_log()
            if r["semantic_center"] == "dragon::color"]
    assert len(rows) == len(values), (
        f"expected one row per disputed episode, got {len(rows)}"
    )
    final = rows[-1]
    # The residue norm should be visibly active after repeated conflict.
    assert final["Z_norm"] > 0.3
    # Z trajectory grows from the first row — residue accumulates, not
    # cancels.
    assert final["Z_norm"] >= rows[0]["Z_norm"] * 0.9


def test_committed_writes_do_not_destroy_residue(store_on):
    """If a center has accumulated residue from disputes, a single
    committed write should NOT wipe the residue back to zero. UFME may
    promote a value epistemically but FCE-Omega's residue is its own
    morphogenetic signal."""
    for k, v in enumerate(["a", "b", "c", "d"]):
        store_on.write(symbolic_entry("phoenix", "color", v,
                                       episode_id=k + 1, write_step=0,
                                       zone="disputed"))
        store_on.consolidate(episode_id=k + 1)
    log_before = [r for r in store_on.fce_morphogenesis_log()
                  if r["semantic_center"] == "phoenix::color"]
    Z_after_conflict = log_before[-1]["Z_norm"]

    store_on.write(symbolic_entry("phoenix", "color", "gold",
                                   episode_id=99, write_step=0,
                                   zone="committed"))
    store_on.consolidate(episode_id=99)
    log_after = [r for r in store_on.fce_morphogenesis_log()
                 if r["semantic_center"] == "phoenix::color"]
    Z_post_commit = log_after[-1]["Z_norm"]
    # The committed write decays residue (mu=0.9), but it should not
    # collapse it: morphogenetic memory persists.
    assert Z_post_commit > 0.4 * Z_after_conflict, (
        f"residue collapsed too fast: pre-commit={Z_after_conflict}, "
        f"post-commit={Z_post_commit}"
    )
