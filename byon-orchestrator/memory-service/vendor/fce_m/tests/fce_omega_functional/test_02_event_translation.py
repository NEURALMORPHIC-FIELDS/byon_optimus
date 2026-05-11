"""FN-02 FCE event translation.

UFME operations -> FCE observations:
  - committed  : high coherence, low residue (assimilation-leaning)
  - provisional: moderate coherence, active tension
  - disputed   : low coherence, dominant residue
  - consolidate: triggers S_t evaluation per touched center
  - propagate  : numerical-only; bridge does not pretend it produced
                 morphogenetic observations.
"""

from __future__ import annotations

import numpy as np

from tests.fce_omega_functional.conftest import symbolic_entry
from unified_fragmergent_memory.bridges.fce_translator import (
    FCEObservation, ZONE_FIELD_WEIGHTS,
    slot_event_to_observation, tension_event_to_observation,
    semantic_center_key,
)


def _slot_event(entity, attr, value, zone, episode_id, write_step):
    return {
        "entity": entity, "family": attr,
        "value_after": value, "value_before": None,
        "zone_before": "NONE", "zone_after": zone.upper(),
        "episode_id": episode_id, "write_step": write_step, "reason": "",
    }


def test_zone_field_weights_have_expected_ordering():
    c = ZONE_FIELD_WEIGHTS["COMMITTED"]
    p = ZONE_FIELD_WEIGHTS["PROVISIONAL"]
    d = ZONE_FIELD_WEIGHTS["DISPUTED"]
    # Committed pushes mostly assimilation.
    assert c["coherence"] > c["residue"]
    # Disputed pushes mostly residue.
    assert d["residue"] > d["coherence"]
    # Provisional sits between the two on the residue axis.
    assert c["residue"] < p["residue"] < d["residue"]
    # And on the coherence axis it sits between disputed and committed.
    assert d["coherence"] < p["coherence"] < c["coherence"]


def test_committed_observation_dominated_by_coherence():
    ev = _slot_event("dragon", "color", "red", "COMMITTED", 1, 0)
    obs = slot_event_to_observation(ev, D=12)
    assert isinstance(obs, FCEObservation)
    assert obs.zone == "COMMITTED"
    assert obs.coherence_weight > obs.residue_weight
    assert obs.center_key == semantic_center_key("dragon", "color")
    # Provenance is preserved.
    assert obs.source_event["entity"] == "dragon"
    assert obs.source_event["episode_id"] == 1


def test_disputed_observation_dominated_by_residue():
    ev = _slot_event("dragon", "color", "blue", "DISPUTED", 2, 0)
    obs = slot_event_to_observation(ev, D=12)
    assert obs.zone == "DISPUTED"
    assert obs.residue_weight > obs.coherence_weight


def test_provisional_carries_tension():
    ev = _slot_event("phoenix", "size", "tiny", "PROVISIONAL", 3, 0)
    obs = slot_event_to_observation(ev, D=12)
    assert obs.zone == "PROVISIONAL"
    # Provisional is not committed and not disputed: it has both signals.
    assert 0.0 < obs.coherence_weight < 1.0
    assert 0.0 < obs.residue_weight < 1.0


def test_same_slot_different_value_perturbs_same_center():
    ev_a = _slot_event("dragon", "color", "red", "COMMITTED", 1, 0)
    ev_b = _slot_event("dragon", "color", "blue", "DISPUTED", 1, 1)
    obs_a = slot_event_to_observation(ev_a, D=12)
    obs_b = slot_event_to_observation(ev_b, D=12)
    assert obs_a.center_key == obs_b.center_key
    # The delta vectors are different (different values, different zone),
    # so the same center receives different excitations.
    assert not np.allclose(obs_a.delta_X, obs_b.delta_X)


def test_tension_event_is_residue_heavy():
    tev = {"entity": "dragon", "family": "color", "tension_id": "t1",
           "episode_id": 4}
    obs = tension_event_to_observation(tev, D=12)
    assert obs.zone == "DISPUTED"
    assert obs.residue_weight > obs.coherence_weight
    assert obs.source_event["kind"] == "tension_event"


def test_consolidate_triggers_S_t_evaluation_per_touched_center(store_on):
    """End-to-end: every center touched in this episode lands a row in
    the morphogenesis log with a finite S_t."""
    store_on.write(symbolic_entry("dragon", "color", "red", 1, 0))
    store_on.write(symbolic_entry("phoenix", "size", "tiny", 1, 1))
    store_on.consolidate(episode_id=1)
    log = store_on.fce_morphogenesis_log()
    centers = {r["semantic_center"] for r in log}
    assert "dragon::color" in centers
    assert "phoenix::size" in centers
    for r in log:
        assert np.isfinite(r["S_t"])
        assert np.isfinite(r["AR"])
        assert np.isfinite(r["Z_norm"])


def test_propagate_does_not_produce_morphogenesis(store_on):
    """Propagate is a tf_engine numerical op; it is not consolidate, so
    it must NOT add morphogenesis entries (only consolidate does)."""
    from tests.fce_omega_functional.conftest import numerical_entry
    for i in range(4):
        store_on.write(numerical_entry(label=i, mi=0.5 * i, dim=8, seed=i),
                       source="tf_engine")
    q = numerical_entry(label=0, mi=1.0, dim=8, seed=99)
    before = len(store_on.fce_morphogenesis_log())
    _ = store_on.propagate(q, n_steps=2, method="softmax", source="tf_engine")
    after = len(store_on.fce_morphogenesis_log())
    assert before == after, (
        "propagate must not produce morphogenesis records — only "
        "consolidate is the FCE observation window"
    )
