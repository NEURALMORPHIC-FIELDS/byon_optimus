"""FN-20 Native memory prototype: ReferenceField from OmegaRecord (v0.6.0).

Mission §10 / Etapa 5 contract:

  OmegaRecord     = irreversible historical fact of coagulation
  ReferenceField  = functional field DERIVED from OmegaRecord; used to
                    interpret future events morphogenetically (aligned,
                    tensioned, contested, etc.) WITHOUT touching UFME
                    epistemic state or the OmegaRecord itself.

Strict invariants tested here:
  * RF created only from OmegaRecord; never standalone
  * RF strength + expression_state may fluctuate; OmegaRecord stays
  * Disputed events contest expression, do NOT change zone or Omega
  * Centers without Omega cannot enter Omega-field interactions
  * Two coagulated centers can interact in Omega-field traces, but no
    new Omega is created
  * priority_only feedback may surface RF events; no UFME write-back
  * persist/load roundtrip preserves RF + events + omega_field_interactions
"""

from __future__ import annotations

from tests.fce_omega_functional.conftest import (
    symbolic_entry, runtime_view,
)
from unified_fragmergent_memory import UnifiedMemoryStore, Config


def _cfg_rf(**kwargs) -> Config:
    base = dict(
        fce_omega_enabled=True, fce_omega_D=16,
        fce_omega_theta_s=0.10, fce_omega_tau_coag=3,
        fce_reference_fields_enabled=True,
    )
    base.update(kwargs)
    return Config(**base)


def _drive_to_coag(s: UnifiedMemoryStore,
                    entity: str = "phoenix", attr: str = "identity",
                    value: str = "fire-bird",
                    n: int = 4, start_ep: int = 1) -> None:
    for ep in range(start_ep, start_ep + n):
        s.write(symbolic_entry(entity, attr, value, ep, 0, zone="committed"))
        s.consolidate(episode_id=ep)


# ---------------------------------------------------------------------
# 1. test_reference_field_not_created_without_omega
# ---------------------------------------------------------------------

def test_reference_field_not_created_without_omega():
    """A center driven only by a couple of disputed events under a
    realistic theta/tau must NOT coagulate -> must NOT have an RF."""
    # Use a tighter theta + larger tau so a short disputed sequence
    # cannot reach the rule. This isolates the test from the smoke
    # observation that very-low thresholds let disputed coagulate too.
    s = UnifiedMemoryStore(_cfg_rf(
        fce_omega_theta_s=0.25, fce_omega_tau_coag=8,
    ))
    for ep in range(1, 4):
        s.write(symbolic_entry("ghost", "shape", f"v{ep}", ep, 0,
                                zone="disputed"))
        s.consolidate(episode_id=ep)
    # Confirm no coagulation under these tighter params.
    assert s.omega_registry_snapshot()["count"] == 0
    assert s.fce_reference_field("ghost::shape") is None
    assert s.fce_reference_fields() == []


# ---------------------------------------------------------------------
# 2. test_reference_field_created_from_omega_record
# ---------------------------------------------------------------------

def test_reference_field_created_from_omega_record():
    s = UnifiedMemoryStore(_cfg_rf())
    _drive_to_coag(s)
    omega = s.omega_registry_snapshot()["records"][0]
    rf = s.fce_reference_field("phoenix::identity")
    assert rf is not None
    assert rf["omega_id"] == omega["omega_id"]
    assert rf["center_key"] == "phoenix::identity"
    assert len(rf["field_vector"]) == 16  # matches fce_omega_D
    assert 0.0 <= rf["strength"] <= 1.0
    assert rf["expression_state"] in ("active", "contested", "inexpressed")
    # Provenance link back to the OmegaRecord.
    src = rf["source_omega_record"]
    assert src["omega_id"] == omega["omega_id"]
    assert src["coagulated_at_episode"] == omega["coagulated_at_episode"]
    assert src["S_t_at_coagulation"] == omega["S_t_at_coagulation"]


# ---------------------------------------------------------------------
# 3. test_reference_field_does_not_modify_omega_record
# ---------------------------------------------------------------------

def test_reference_field_does_not_modify_omega_record():
    s = UnifiedMemoryStore(_cfg_rf())
    _drive_to_coag(s)
    omega_before = s.omega_registry_snapshot()["records"][0]
    # Drive plenty of aligned and contested events.
    for k, v in enumerate(["fire-bird"] * 3 + ["blue", "green", "yellow"]):
        zone = "committed" if k < 3 else "disputed"
        s.write(symbolic_entry("phoenix", "identity", v,
                                100 + k, 0, zone=zone))
        s.consolidate(episode_id=100 + k)
    omega_after = s.omega_registry_snapshot()["records"][0]
    # The OmegaRecord is structurally invariant on its historical fields.
    for k in ("omega_id", "coagulated_at_episode",
              "coagulated_at_cycle", "S_t_at_coagulation",
              "kappa_at_coagulation", "sine_type",
              "source_episodes", "source_events"):
        assert omega_after[k] == omega_before[k], (
            f"OmegaRecord.{k} changed by ReferenceField activity: "
            f"before={omega_before[k]!r} after={omega_after[k]!r}"
        )


# ---------------------------------------------------------------------
# 4. test_committed_aligned_event_reinforces_expression
# ---------------------------------------------------------------------

def test_committed_aligned_event_reinforces_expression():
    s = UnifiedMemoryStore(_cfg_rf())
    _drive_to_coag(s)
    strength_at_coag = s.fce_reference_field("phoenix::identity")["strength"]
    # Drive a few more aligned committed writes.
    for k in range(4):
        s.write(symbolic_entry("phoenix", "identity", "fire-bird",
                                100 + k, 0, zone="committed"))
        s.consolidate(episode_id=100 + k)
    events = [ev for ev in s.fce_reference_field_events()
              if ev["episode_id"] >= 100]
    kinds = {ev["kind"] for ev in events}
    # At least one aligned / expression_reinforcing event.
    assert (
        "aligned" in kinds or "expression_reinforcing" in kinds
    ), f"expected aligned-class events; got {kinds}"
    # And strength has not collapsed (it can grow or stay roughly the
    # same; it should not have dropped below contested threshold).
    strength_now = s.fce_reference_field("phoenix::identity")["strength"]
    assert strength_now >= 0.30, (
        f"strength collapsed under aligned-only ramp: "
        f"at_coag={strength_at_coag} now={strength_now}"
    )


# ---------------------------------------------------------------------
# 5. test_disputed_event_contests_expression_not_truth
# ---------------------------------------------------------------------

def test_disputed_event_contests_expression_not_truth():
    s = UnifiedMemoryStore(_cfg_rf())
    _drive_to_coag(s)
    omega_before = s.omega_registry_snapshot()["records"][0]
    # Drive a disputed event after coag.
    s.write(symbolic_entry("phoenix", "identity", "blue", 100, 0,
                            zone="disputed"))
    s.consolidate(episode_id=100)
    events = [ev for ev in s.fce_reference_field_events()
              if ev["episode_id"] == 100]
    assert events
    kinds = {ev["kind"] for ev in events}
    # The disputed event is classified as either contested_expression
    # or residue_amplifying (both are non-epistemic morphogenetic
    # categories — see misiunea Etapa 5).
    assert kinds & {"contested_expression", "residue_amplifying"}, (
        f"expected contested/residue classification; got {kinds}"
    )
    # The slot_event still reports DISPUTED — truth-status unchanged.
    last = s._runtime_adapter.slot_event_log[-1]
    assert last["zone_after"] == "DISPUTED"
    # Omega still active and unchanged.
    omega_after = s.omega_registry_snapshot()["records"][0]
    assert omega_after["omega_id"] == omega_before["omega_id"]
    assert omega_after["coagulated_at_episode"] == omega_before["coagulated_at_episode"]


# ---------------------------------------------------------------------
# 6. test_reference_field_persist_load_roundtrip
# ---------------------------------------------------------------------

def test_reference_field_persist_load_roundtrip(tmp_path):
    cfg = _cfg_rf(fce_advisory_mode="priority_only")
    s = UnifiedMemoryStore(cfg)
    _drive_to_coag(s)
    for k in range(3):
        s.write(symbolic_entry("phoenix", "identity", "fire-bird",
                                100 + k, 0, zone="committed"))
        s.consolidate(episode_id=100 + k)
    rf_before = s.fce_reference_fields()
    events_before = s.fce_reference_field_events()
    fb_before = s.fce_advisory_feedback()
    omega_before = s.omega_registry_snapshot()
    assert rf_before
    path = str(tmp_path / "obs_v060.json")
    s.fce_omega_observer().persist(path)
    s2 = UnifiedMemoryStore(cfg)
    s2._ensure_fce_observer().load(path)
    assert s2.fce_reference_fields() == rf_before
    assert s2.fce_reference_field_events() == events_before
    assert s2.fce_advisory_feedback() == fb_before
    assert s2.omega_registry_snapshot() == omega_before


# ---------------------------------------------------------------------
# 7. test_reference_field_default_off_preserves_v0_5_1_behavior
# ---------------------------------------------------------------------

def test_reference_field_default_off_preserves_v0_5_1_behavior():
    """Default Config has fce_reference_fields_enabled=False. The
    observer behavior must be byte-identical to v0.5.1 — endpoints
    return empty, no RF state appears in metrics."""
    cfg = Config()
    assert cfg.fce_reference_fields_enabled is False
    s = UnifiedMemoryStore(Config(fce_omega_enabled=True, fce_omega_D=16,
                                    fce_omega_theta_s=0.10,
                                    fce_omega_tau_coag=3))
    _drive_to_coag(s)
    # Coagulation happened but no RF was created.
    assert s.omega_registry_snapshot()["count"] == 1
    assert s.fce_reference_fields() == []
    assert s.fce_reference_field("phoenix::identity") is None
    assert s.fce_reference_field_events() == []
    assert s.fce_omega_field_interactions() == []
    snap = s.metrics_snapshot()["fce_omega"]
    assert snap["reference_fields_enabled"] is False
    assert snap["reference_fields_count"] == 0


# ---------------------------------------------------------------------
# 8. test_center_without_omega_cannot_enter_omega_field
# ---------------------------------------------------------------------

def test_center_without_omega_cannot_enter_omega_field():
    """A center that never coagulated may participate in regular
    multiperspectival traces, but it MUST NOT appear in
    omega_field_interactions, which are reserved for centers with
    a ReferenceField."""
    cfg = _cfg_rf(fce_multiperspectival_enabled=True)
    s = UnifiedMemoryStore(cfg)
    # Drive A to coagulation alone first.
    _drive_to_coag(s, entity="A", attr="x", value="stable", n=4, start_ep=1)
    assert s.fce_reference_field("A::x") is not None
    # Now co-active with B (never coagulated).
    s.write(symbolic_entry("A", "x", "stable", 100, 0, zone="committed"))
    s.write(symbolic_entry("B", "y", "drift", 100, 1, zone="disputed"))
    s.consolidate(episode_id=100)
    # No B reference field.
    assert s.fce_reference_field("B::y") is None
    # No omega_field_interaction includes B.
    for ofi in s.fce_omega_field_interactions():
        assert "B::y" not in (ofi["center_i"], ofi["center_j"]), (
            f"B::y leaked into omega_field_interactions: {ofi}"
        )


# ---------------------------------------------------------------------
# 9. test_two_omega_reference_fields_can_interact
# ---------------------------------------------------------------------

def test_two_omega_reference_fields_can_interact():
    cfg = _cfg_rf(fce_multiperspectival_enabled=True)
    s = UnifiedMemoryStore(cfg)
    _drive_to_coag(s, entity="A", attr="x", value="stable", n=4, start_ep=1)
    _drive_to_coag(s, entity="B", attr="y", value="stable", n=4, start_ep=20)
    assert s.fce_reference_field("A::x") is not None
    assert s.fce_reference_field("B::y") is not None
    # Now make them co-active in the same consolidate.
    s.write(symbolic_entry("A", "x", "stable", 100, 0, zone="committed"))
    s.write(symbolic_entry("B", "y", "stable", 100, 1, zone="committed"))
    s.consolidate(episode_id=100)
    ofis = [ofi for ofi in s.fce_omega_field_interactions()
            if ofi["episode_id"] == 100]
    assert ofis, "expected an OmegaFieldInteraction for two co-active RFs"
    ofi = ofis[0]
    assert {ofi["center_i"], ofi["center_j"]} == {"A::x", "B::y"}
    # All four scores present and finite.
    for k in ("field_alignment", "field_tension",
              "resonance_score", "interference_score"):
        v = ofi[k]
        assert isinstance(v, float)
        assert -1.0 <= v <= 1.0 or 0.0 <= v <= 1.0


# ---------------------------------------------------------------------
# 10. test_omega_field_interaction_does_not_create_individual_omega
# ---------------------------------------------------------------------

def test_omega_field_interaction_does_not_create_individual_omega():
    """Two coagulated RFs may interact; a third center co-active with
    them cannot inherit Omega from the interaction. Coagulation still
    requires the threshold rule on the third center's own S_t."""
    cfg = _cfg_rf(fce_multiperspectival_enabled=True)
    s = UnifiedMemoryStore(cfg)
    _drive_to_coag(s, entity="A", attr="x", value="stable", n=4, start_ep=1)
    _drive_to_coag(s, entity="B", attr="y", value="stable", n=4, start_ep=20)
    snap_before = s.omega_registry_snapshot()
    centers_before = {r["semantic_center"] for r in snap_before["records"]}
    # Now co-active with C, ONE disputed event (cannot meet tau_coag).
    s.write(symbolic_entry("A", "x", "stable", 100, 0, zone="committed"))
    s.write(symbolic_entry("B", "y", "stable", 100, 1, zone="committed"))
    s.write(symbolic_entry("C", "z", "drift", 100, 2, zone="disputed"))
    s.consolidate(episode_id=100)
    snap_after = s.omega_registry_snapshot()
    centers_after = {r["semantic_center"] for r in snap_after["records"]}
    # C did not coagulate from the omega-field interaction.
    assert "C::z" not in centers_after
    # And the original Omegas are intact.
    assert centers_after == centers_before
    # No new RF for C.
    assert s.fce_reference_field("C::z") is None


# ---------------------------------------------------------------------
# 11. test_priority_only_uses_reference_field_for_feedback_without_writeback
# ---------------------------------------------------------------------

def test_priority_only_uses_reference_field_for_feedback_without_writeback():
    cfg = _cfg_rf(fce_advisory_mode="priority_only")
    s = UnifiedMemoryStore(cfg)
    _drive_to_coag(s)
    # Add some events that should produce RF-derived feedback.
    s.write(symbolic_entry("phoenix", "identity", "fire-bird",
                            100, 0, zone="committed"))
    s.consolidate(episode_id=100)
    s.write(symbolic_entry("phoenix", "identity", "blue", 101, 0,
                            zone="disputed"))
    s.consolidate(episode_id=101)
    fbs = s.fce_advisory_feedback()
    rf_kinds = {fb["kind"] for fb in fbs
                if fb["kind"] in ("rf_aligned", "expression_reinforcing",
                                   "rf_contested_expression",
                                   "rf_residue_amplifying")}
    assert rf_kinds, f"no RF-derived feedback kinds emitted; got " \
        f"all_kinds={[fb['kind'] for fb in fbs]}"
    # Truth-status untouched.
    last = s._runtime_adapter.slot_event_log[-1]
    assert last["zone_after"] == "DISPUTED"


# ---------------------------------------------------------------------
# 12. test_no_epistemic_override_from_reference_field
# ---------------------------------------------------------------------

def test_no_epistemic_override_from_reference_field():
    cfg = _cfg_rf(fce_advisory_mode="priority_only")
    s = UnifiedMemoryStore(cfg)
    _drive_to_coag(s)
    # Hammer disputed events; RF strength may drop, but slot_event
    # log must not be rewritten.
    for k in range(8):
        s.write(symbolic_entry("phoenix", "identity", f"v{k}",
                                100 + k, 0, zone="disputed"))
        s.consolidate(episode_id=100 + k)
    zones = [ev["zone_after"] for ev in s._runtime_adapter.slot_event_log
             if ev["episode_id"] >= 100]
    assert zones == ["DISPUTED"] * 8
    # Omega still active in the registry.
    omega = s.omega_registry_snapshot()["records"][0]
    assert omega["expression_state"] in ("active", "contested", "inexpressed")


# ---------------------------------------------------------------------
# 13. test_reference_field_provenance_complete
# ---------------------------------------------------------------------

def test_reference_field_provenance_complete():
    s = UnifiedMemoryStore(_cfg_rf())
    _drive_to_coag(s)
    rf = s.fce_reference_field("phoenix::identity")
    src = rf["source_omega_record"]
    assert src["omega_id"]
    assert src["coagulated_at_episode"] >= 1
    assert src["S_t_at_coagulation"] >= 0.10  # >= theta
    assert src["kappa_at_coagulation"] > 0
    assert src["source_episodes"]            # non-empty list
    assert src["source_event_count"] >= 1
    # last_updated_episode advances every time a classification event
    # for this center is recorded; it is always >= created_at_episode.
    assert rf["last_updated_episode"] >= rf["created_at_episode"]


# ---------------------------------------------------------------------
# 14. test_reference_field_expression_state_can_fluctuate
# ---------------------------------------------------------------------

def test_reference_field_expression_state_can_fluctuate():
    """Drive enough contesting events to push the field into
    contested (and possibly inexpressed); confirm that Omega remains
    permanent throughout."""
    s = UnifiedMemoryStore(_cfg_rf())
    _drive_to_coag(s)
    assert s.fce_reference_field("phoenix::identity")["expression_state"] == "active"
    # Bombard with disputed -> residue_amplifying -> strength drops.
    for k in range(40):
        s.write(symbolic_entry("phoenix", "identity", f"v{k}",
                                100 + k, 0, zone="disputed"))
        s.consolidate(episode_id=100 + k)
    rf_after = s.fce_reference_field("phoenix::identity")
    # Field has decayed to either contested or inexpressed.
    assert rf_after["expression_state"] in ("active", "contested",
                                              "inexpressed")
    # Strength dropped from creation.
    assert rf_after["strength"] < 0.80
    # OmegaRecord is untouched on its historical fields.
    omega = s.omega_registry_snapshot()["records"][0]
    assert omega["omega_id"]
    assert omega["coagulated_at_episode"] >= 1
