"""FN-19 Semi-active advisory feedback (v0.5.1).

`fce_advisory_mode = "priority_only"` lets the observer emit bounded
priority-metadata recommendations after each consolidate. Defaults to
`"read_only"` so v0.5.0 behavior is preserved exactly.

Mission §4 Etapa 4 invariants:
  - FCE-Omega can RECOMMEND consolidation priorities; cannot change
    truth status (committed/provisional/disputed/rejected).
  - FCE-Omega cannot create Omega via advisory feedback.
  - FCE-Omega cannot delete residue, Omega history, or runtime state.
  - Advisory feedback is bounded and provenance-tracked.
  - `read_only` is bitwise identical to v0.5.0.
"""

from __future__ import annotations

from tests.fce_omega_functional.conftest import (
    symbolic_entry, runtime_view,
)
from unified_fragmergent_memory import UnifiedMemoryStore, Config


def _cfg_priority(**kwargs) -> Config:
    base = dict(
        fce_omega_enabled=True,
        fce_omega_D=8,
        fce_omega_theta_s=0.10,
        fce_omega_tau_coag=3,
        fce_advisory_mode="priority_only",
    )
    base.update(kwargs)
    return Config(**base)


# ---------------------------------------------------------------------
# 1. test_default_mode_is_read_only
# ---------------------------------------------------------------------

def test_default_mode_is_read_only():
    cfg = Config()
    assert cfg.fce_advisory_mode == "read_only"
    # Constructing a store with default config and consolidating must
    # leave the feedback log empty even when FCE-Omega is enabled.
    s = UnifiedMemoryStore(Config(fce_omega_enabled=True, fce_omega_D=8))
    s.write(symbolic_entry("dragon", "color", "red", 1, 0))
    s.consolidate(episode_id=1)
    assert s.fce_advisory_feedback() == []
    assert s.metrics_snapshot()["fce_omega"]["advisory_mode"] == "read_only"


# ---------------------------------------------------------------------
# 2. test_read_only_mode_has_zero_side_effects
# ---------------------------------------------------------------------

def test_read_only_mode_has_zero_side_effects():
    """Read-only mode must be byte-identical to v0.5.0: advisory_hints
    snapshot still works, but advisory_feedback_log stays empty."""
    s = UnifiedMemoryStore(Config(
        fce_omega_enabled=True, fce_omega_D=8,
        fce_omega_theta_s=0.05, fce_omega_tau_coag=2,
    ))
    for ep in range(1, 5):
        s.write(symbolic_entry("dragon", "color", "red", ep, 0))
        s.consolidate(episode_id=ep)
    assert s.fce_advisory_feedback() == []
    assert s.fce_priority_recommendations() == []
    # advisory_hints (a snapshot of current state) still returns content.
    assert s.fce_advisory_hints(), "advisory_hints should still work in read_only"


# ---------------------------------------------------------------------
# 3. test_priority_only_creates_feedback_metadata
# ---------------------------------------------------------------------

def test_priority_only_creates_feedback_metadata():
    s = UnifiedMemoryStore(_cfg_priority(
        fce_omega_theta_s=0.05, fce_omega_tau_coag=2,
    ))
    for ep in range(1, 5):
        s.write(symbolic_entry("dragon", "color", "red", ep, 0))
        s.consolidate(episode_id=ep)
    fbs = s.fce_advisory_feedback()
    assert fbs, "priority_only must produce at least one feedback item"
    kinds = {fb["kind"] for fb in fbs}
    # high_residue accumulates as Z grows; coagulated_reference appears
    # once Omega has been registered for the center.
    assert "high_residue" in kinds or "coagulated_reference" in kinds
    # All items expose the required schema fields.
    for fb in fbs:
        for k in ("feedback_id", "center_key", "kind", "priority_delta",
                  "recommended_action", "reason", "source_trace_ids",
                  "source_omega_ids", "source_relation_candidate_ids",
                  "applied", "mode", "created_at_episode"):
            assert k in fb, f"missing field {k!r} in feedback item"
        assert fb["mode"] == "priority_only"


# ---------------------------------------------------------------------
# 4. test_priority_only_does_not_change_epistemic_status
# ---------------------------------------------------------------------

def test_priority_only_does_not_change_epistemic_status():
    """Even when feedback recommends incubation/delay/review, the
    runtime slot_event_log preserves the original zone."""
    s = UnifiedMemoryStore(_cfg_priority())
    # Drive a disputed event and then a few committed events.
    s.write(symbolic_entry("dragon", "color", "red", 1, 0, zone="committed"))
    s.consolidate(episode_id=1)
    s.write(symbolic_entry("dragon", "color", "blue", 2, 0, zone="disputed"))
    s.consolidate(episode_id=2)
    s.write(symbolic_entry("dragon", "color", "blue", 3, 1, zone="disputed"))
    s.consolidate(episode_id=3)
    # Feedback may now contain advisory items.
    assert s.fce_advisory_feedback()
    # The runtime adapter's slot_event_log still reports the original
    # zones — no rewriting.
    adapter = s._runtime_adapter
    zones_seen = [ev["zone_after"] for ev in adapter.slot_event_log]
    assert zones_seen == ["COMMITTED", "DISPUTED", "DISPUTED"]


# ---------------------------------------------------------------------
# 5. test_near_coagulation_recommends_incubation_not_omega
# ---------------------------------------------------------------------

def test_near_coagulation_recommends_incubation_not_omega():
    """A center within one tau-step of the rule firing must produce
    a `near_coagulation` recommendation. Until check_coagulation
    fires, no OmegaRecord exists."""
    s = UnifiedMemoryStore(_cfg_priority(
        fce_omega_theta_s=0.05, fce_omega_tau_coag=5,
    ))
    # Drive ramp; expect the 4th cycle to surface near_coagulation
    # because consec_above_threshold reaches tau-1 before Omega fires.
    saw_near_coag_before_omega = False
    for ep in range(1, 6):
        s.write(symbolic_entry("dragon", "color", "red", ep, 0))
        s.consolidate(episode_id=ep)
        snap = s.omega_registry_snapshot()
        latest_kinds = {fb["kind"] for fb in s.fce_advisory_feedback()
                        if fb["created_at_episode"] == ep}
        if "near_coagulation" in latest_kinds and snap["count"] == 0:
            saw_near_coag_before_omega = True
    assert saw_near_coag_before_omega, (
        "expected at least one near_coagulation hint while Omega had "
        "not yet been registered"
    )


# ---------------------------------------------------------------------
# 6. test_contested_omega_recommends_review_without_uncoagulating
# ---------------------------------------------------------------------

def test_contested_omega_recommends_review_without_uncoagulating():
    s = UnifiedMemoryStore(_cfg_priority(
        fce_omega_theta_s=0.05, fce_omega_tau_coag=2,
    ))
    for ep in range(1, 5):
        s.write(symbolic_entry("dragon", "color", "red", ep, 0))
        s.consolidate(episode_id=ep)
    assert s.omega_registry_snapshot()["count"] == 1
    # Contest the expression.
    rec = s.omega_registry_snapshot()["records"][0]
    s.fce_omega_observer().omega_registry.mark_contested(
        rec["semantic_center"], episode_id=100, reason="external review"
    )
    # Now drive another consolidate so the observer emits new feedback.
    s.write(symbolic_entry("dragon", "color", "red", 101, 0))
    s.consolidate(episode_id=101)
    fbs_now = [fb for fb in s.fce_advisory_feedback()
               if fb["created_at_episode"] == 101]
    kinds = {fb["kind"] for fb in fbs_now}
    assert "contested_expression" in kinds, (
        f"contested_expression should be recommended after mark_contested; "
        f"saw kinds={kinds}"
    )
    # Omega is still active (irreversible).
    rec_after = s.omega_registry_snapshot()["records"][0]
    assert rec_after["omega_id"] == rec["omega_id"]
    assert rec_after["coagulated_at_episode"] == rec["coagulated_at_episode"]


# ---------------------------------------------------------------------
# 7. test_relation_candidate_recommends_relation_review_without_mutation
# ---------------------------------------------------------------------

def test_relation_candidate_recommends_relation_review_without_mutation():
    """Co-active high-S_t pair produces a relation_candidate. With
    priority_only mode on, a `relation_candidate` feedback item is
    emitted, but NO Omega is set on either center and no new
    "relation registry" is created."""
    s = UnifiedMemoryStore(_cfg_priority(
        fce_multiperspectival_enabled=True,
        fce_omega_theta_s=0.05, fce_omega_tau_coag=99,
        fce_multiperspectival_theta_pair=0.05,
    ))
    for k, e in enumerate(["A", "B", "C"]):
        s.write(symbolic_entry(e, "x", "red", 1, k, zone="committed"))
    s.consolidate(episode_id=1)
    rcs = s.fce_relation_candidates()
    assert rcs, "expected relation candidates for 3 co-active centers"
    fbs = s.fce_advisory_feedback()
    rel_fbs = [fb for fb in fbs if fb["kind"] == "relation_candidate"]
    assert rel_fbs, "priority_only should emit relation_candidate items"
    # No center coagulated (tau_coag=99).
    assert s.omega_registry_snapshot()["count"] == 0


# ---------------------------------------------------------------------
# 8. test_priority_feedback_has_complete_provenance
# ---------------------------------------------------------------------

def test_priority_feedback_has_complete_provenance():
    s = UnifiedMemoryStore(_cfg_priority(
        fce_multiperspectival_enabled=True,
        fce_omega_theta_s=0.05, fce_omega_tau_coag=2,
        fce_multiperspectival_theta_pair=0.05,
    ))
    for k, e in enumerate(["A", "B"]):
        s.write(symbolic_entry(e, "x", "red", 1, k, zone="committed"))
    s.consolidate(episode_id=1)
    fbs = s.fce_advisory_feedback()
    for fb in fbs:
        # Provenance fields are always lists, never None.
        assert isinstance(fb["source_trace_ids"], list)
        assert isinstance(fb["source_omega_ids"], list)
        assert isinstance(fb["source_relation_candidate_ids"], list)
        # feedback_id is the stable 16-hex hash.
        assert isinstance(fb["feedback_id"], str)
        assert len(fb["feedback_id"]) == 16


# ---------------------------------------------------------------------
# 9. test_priority_feedback_persist_load_roundtrip
# ---------------------------------------------------------------------

def test_priority_feedback_persist_load_roundtrip(tmp_path):
    cfg = _cfg_priority(
        fce_omega_theta_s=0.05, fce_omega_tau_coag=2,
    )
    s = UnifiedMemoryStore(cfg)
    for ep in range(1, 5):
        s.write(symbolic_entry("dragon", "color", "red", ep, 0))
        s.consolidate(episode_id=ep)
    fbs_before = s.fce_advisory_feedback()
    assert fbs_before
    path = str(tmp_path / "obs_v051.json")
    s.fce_omega_observer().persist(path)
    s2 = UnifiedMemoryStore(cfg)
    s2._ensure_fce_observer().load(path)
    fbs_after = s2.fce_advisory_feedback()
    assert fbs_after == fbs_before
    # Omega survives too.
    assert (s.omega_registry_snapshot()
            == s2.omega_registry_snapshot())


# ---------------------------------------------------------------------
# 10. test_priority_only_passive_outputs_unchanged_except_metadata
# ---------------------------------------------------------------------

def test_priority_only_passive_outputs_unchanged_except_metadata():
    """Read/write/consolidate output equals the read_only run, except
    that priority_only additionally surfaces advisory_feedback."""
    common = dict(fce_omega_enabled=True, fce_omega_D=8,
                  fce_omega_theta_s=0.05, fce_omega_tau_coag=2)
    s_ro = UnifiedMemoryStore(Config(**common, fce_advisory_mode="read_only"))
    s_po = UnifiedMemoryStore(Config(**common, fce_advisory_mode="priority_only"))
    seq = [
        symbolic_entry("dragon", "color", "red", 1, 0, zone="committed"),
        symbolic_entry("dragon", "color", "blue", 2, 0, zone="disputed"),
        symbolic_entry("dragon", "color", "red", 3, 0, zone="committed"),
    ]
    out_ro = []
    out_po = []
    for k, ev in enumerate(seq):
        s_ro.write(ev)
        s_po.write(ev)
        out_ro.append(s_ro.consolidate(episode_id=k + 1))
        out_po.append(s_po.consolidate(episode_id=k + 1))
    for r, p in zip(out_ro, out_po):
        assert r["ops"] == p["ops"]
        assert r["signals_summary"] == p["signals_summary"]
    assert runtime_view(s_ro) == runtime_view(s_po)
    assert len(s_ro.audit_log()) == len(s_po.audit_log())
    # The only legitimate divergence: the priority-mode feedback log.
    assert s_ro.fce_advisory_feedback() == []
    assert s_po.fce_advisory_feedback()


# ---------------------------------------------------------------------
# 11. test_no_hidden_writeback_to_runtime_sources
# ---------------------------------------------------------------------

def test_no_hidden_writeback_to_runtime_sources():
    """The runtime adapter event logs and counters must be identical
    between read_only and priority_only runs, byte for byte."""
    common = dict(fce_omega_enabled=True, fce_omega_D=8,
                  fce_omega_theta_s=0.05, fce_omega_tau_coag=2)
    s_ro = UnifiedMemoryStore(Config(**common, fce_advisory_mode="read_only"))
    s_po = UnifiedMemoryStore(Config(**common, fce_advisory_mode="priority_only"))
    for ep in range(1, 5):
        s_ro.write(symbolic_entry("dragon", "color", "red", ep, 0))
        s_po.write(symbolic_entry("dragon", "color", "red", ep, 0))
        s_ro.consolidate(episode_id=ep)
        s_po.consolidate(episode_id=ep)
    # Slot event log bit-equal across runs.
    a_ro = s_ro._runtime_adapter.slot_event_log
    a_po = s_po._runtime_adapter.slot_event_log
    assert a_ro == a_po
    # All metric counters of the adapter equal.
    snap_ro = s_ro._runtime_adapter.metrics_snapshot()
    snap_po = s_po._runtime_adapter.metrics_snapshot()
    for k in ("n_slot_events", "n_tension_events", "n_resolution_events",
              "audit_log_size", "n_committed_slots",
              "n_provisional_entries", "last_pipeline_ops"):
        assert snap_ro.get(k) == snap_po.get(k), (
            f"runtime metric {k!r} diverged: ro={snap_ro.get(k)} "
            f"po={snap_po.get(k)}"
        )


# ---------------------------------------------------------------------
# 12. test_priority_scores_are_bounded
# ---------------------------------------------------------------------

def test_priority_scores_are_bounded():
    s = UnifiedMemoryStore(_cfg_priority(
        fce_multiperspectival_enabled=True,
        fce_omega_theta_s=0.05, fce_omega_tau_coag=2,
        fce_multiperspectival_theta_pair=0.05,
    ))
    # Drive many episodes with multiple centers and disputed mix so
    # all feedback kinds appear.
    for ep in range(1, 11):
        for k, ent in enumerate(["A", "B", "C", "D"]):
            zone = "committed" if (ep + k) % 2 == 0 else "disputed"
            s.write(symbolic_entry(ent, "x", f"v{ep}{k}",
                                    ep, k, zone=zone))
        s.consolidate(episode_id=ep)
    fbs = s.fce_advisory_feedback()
    assert fbs
    for fb in fbs:
        assert -1.0 <= fb["priority_delta"] <= 1.0, (
            f"priority_delta out of [-1, 1]: {fb}"
        )


# ---------------------------------------------------------------------
# Bonus invariant (mission §6): "FCE-Omega cannot create Omega via
# advisory feedback". Tested as a difference: the Omega registry is
# identical between a read_only and a priority_only run on the same
# sequence. If priority-mode emission introduced any registry side
# effect, this test would fail.
# ---------------------------------------------------------------------

def test_advisory_does_not_alter_omega_registry_versus_read_only():
    common = dict(fce_omega_enabled=True, fce_omega_D=8,
                  fce_omega_theta_s=0.10, fce_omega_tau_coag=3)
    s_ro = UnifiedMemoryStore(Config(**common, fce_advisory_mode="read_only"))
    s_po = UnifiedMemoryStore(Config(**common, fce_advisory_mode="priority_only"))
    for ep in range(1, 8):
        ev_committed = symbolic_entry("dragon", "color", "red",
                                       ep, 0, zone="committed")
        ev_disputed = symbolic_entry("phoenix", "color", f"v{ep}",
                                      ep, 1, zone="disputed")
        for ev in (ev_committed, ev_disputed):
            s_ro.write(ev); s_po.write(ev)
        s_ro.consolidate(episode_id=ep)
        s_po.consolidate(episode_id=ep)
    # The Omega registry must be byte-equal between the two runs.
    assert s_ro.omega_registry_snapshot() == s_po.omega_registry_snapshot(), (
        "priority_only mode altered the OmegaRegistry relative to "
        "read_only; advisory feedback must NOT create Omega"
    )
    # And priority_only DOES produce feedback (proves the test is not
    # vacuously passing because the channel is silent).
    assert s_po.fce_advisory_feedback()
    assert s_ro.fce_advisory_feedback() == []
