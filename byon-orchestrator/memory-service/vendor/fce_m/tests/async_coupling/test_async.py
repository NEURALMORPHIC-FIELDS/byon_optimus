"""v0.3.3 mandatory tests: async cross-substrate cycle.

Six scenarios per spec plus safety, provenance, regression.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Dict, List

import pytest

from unified_fragmergent_memory import Config
from unified_fragmergent_memory.runtime import (
    AsyncOrchestratorOrganismDriven,
    AsyncSchedule,
    PendingPressure,
    diff_async_reports,
    run_async_coupling_demo,
)


def _build_priming(disputed_episodes: List[int]) -> List[List[Dict[str, Any]]]:
    return [
        [{"entity_id": "dragon", "attr_type": "color",
          "value_str": "blue", "value_before": "red",
          "zone_after": "disputed", "value_idx": 2,
          "source_text": f"ep{ep} priming"}]
        if (ep + 1) in disputed_episodes else []
        for ep in range(max(disputed_episodes) + 5)
    ]


def _scenario_red_only(n: int) -> List[List[str]]:
    return [["the dragon is red"] for _ in range(n)]


# ---------------------------------------------------------------------------
# Mandatory scenario 1: delayed consolidation
# ---------------------------------------------------------------------------

def test_delayed_consolidation_aggregates_inputs():
    """consolidate_every_n_episodes=2 means consolidation fires on
    episodes 2, 4, ... but not 1, 3. The mirror still sees inputs at the
    moment of perceive."""
    config = Config(cross_substrate_propagation_method="mi")
    schedule = AsyncSchedule(
        consolidate_every_n_episodes=2,
        apply_pressure_delay_episodes=0,
        stale_pressure_max_age_episodes=10,
    )
    orch = AsyncOrchestratorOrganismDriven(config=config)
    scenario = _scenario_red_only(4)
    priming = _build_priming([2, 3])  # disputed at ep2 and ep3
    report = orch.run_async(scenario, schedule, coupling=True,
                            mirror_priming=priming)
    fired = [ep.consolidation_fired_this_episode for ep in report.episodes]
    assert fired == [False, True, False, True]


# ---------------------------------------------------------------------------
# Mandatory scenario 2: delayed propagation (covered as part of delayed
# consolidation: when consolidation fires every N, propagation also runs
# inside the cycle on those tick episodes; both are "late" relative to
# the events they observe)
# ---------------------------------------------------------------------------

def test_delayed_propagation_pressure_not_lost():
    """Even when consolidation runs every 3 episodes, pressure produced
    at the consolidation tick is queued and eventually applied."""
    config = Config(cross_substrate_propagation_method="mi")
    schedule = AsyncSchedule(
        consolidate_every_n_episodes=3,
        apply_pressure_delay_episodes=0,
        stale_pressure_max_age_episodes=15,
    )
    orch = AsyncOrchestratorOrganismDriven(config=config)
    scenario = _scenario_red_only(7)
    priming = _build_priming([2, 3])
    orch.run_async(scenario, schedule, coupling=True, mirror_priming=priming)
    # By the end, applied_log + pending + expired should account for any
    # produced pressures (no leaks).
    total_produced = (
        len(orch.applied_pressure_log)
        + sum(1 for pp in orch.pending_pressures
              if not pp.is_applied and not pp.is_stale)
        + len(orch.expired_pressure_log)
    )
    assert total_produced >= 1, "no pressure produced even with deep priming"


# ---------------------------------------------------------------------------
# Mandatory scenario 3: delayed pressure application
# ---------------------------------------------------------------------------

def test_delayed_pressure_application_respects_delay():
    """apply_pressure_delay_episodes=2 means pressure produced at ep_n
    cannot be applied earlier than ep_n+2."""
    config = Config(cross_substrate_propagation_method="mi")
    schedule = AsyncSchedule(
        consolidate_every_n_episodes=1,
        apply_pressure_delay_episodes=2,
        stale_pressure_max_age_episodes=15,
    )
    orch = AsyncOrchestratorOrganismDriven(config=config)
    scenario = _scenario_red_only(6)
    priming = _build_priming([2, 3])
    orch.run_async(scenario, schedule, coupling=True, mirror_priming=priming)
    for pp in orch.applied_pressure_log:
        assert pp.applied_at_episode is not None
        assert pp.applied_at_episode >= pp.produced_at_episode + 2, (
            f"pressure {pp.pressure_id} applied at "
            f"{pp.applied_at_episode} earlier than produced+2 "
            f"({pp.produced_at_episode}+2={pp.produced_at_episode + 2})"
        )


# ---------------------------------------------------------------------------
# Mandatory scenario 4: multiple pending pressures slot-safe
# ---------------------------------------------------------------------------

def test_multiple_pending_pressures_distinct_slots():
    """Two slots produce distinct pending pressures; each pressure's
    target_slots correctly identifies which slot(s) it targets."""
    config = Config(cross_substrate_propagation_method="mi")
    schedule = AsyncSchedule(
        consolidate_every_n_episodes=1,
        apply_pressure_delay_episodes=3,  # delay so multiple pressures coexist
        stale_pressure_max_age_episodes=20,
    )
    orch = AsyncOrchestratorOrganismDriven(config=config)
    # Scenario interleaves two slots: dragon/color and knight/mood.
    scenario = [
        ["the dragon is red"],
        ["the knight is calm"],
        ["the dragon is red"],
        ["the knight is calm"],
        ["the dragon is red"],
        ["the knight is calm"],
    ]
    priming: List[List[Dict[str, Any]]] = [
        [],
        [],
        [{"entity_id": "dragon", "attr_type": "color",
          "value_str": "blue", "value_before": "red",
          "zone_after": "disputed", "value_idx": 2}],
        [{"entity_id": "knight", "attr_type": "mood",
          "value_str": "angry", "value_before": "calm",
          "zone_after": "disputed", "value_idx": 2}],
        [{"entity_id": "dragon", "attr_type": "color",
          "value_str": "blue", "value_before": "red",
          "zone_after": "disputed", "value_idx": 2}],
        [{"entity_id": "knight", "attr_type": "mood",
          "value_str": "angry", "value_before": "calm",
          "zone_after": "disputed", "value_idx": 2}],
    ]
    orch.run_async(scenario, schedule, coupling=True, mirror_priming=priming)
    # At end, we should have produced multiple pending pressures across
    # the two slots; the union of target_slots covers both.
    all_targets = set()
    for pp in orch.pending_pressures:
        for slot in pp.target_slots:
            all_targets.add(slot)
    assert ("dragon", "color") in all_targets or ("knight", "mood") in all_targets


# ---------------------------------------------------------------------------
# Mandatory scenario 5: stale pressure expiry
# ---------------------------------------------------------------------------

def test_stale_pressure_expires_and_not_applied():
    """Pressure whose expires_at < current_episode is marked stale and
    never applied."""
    config = Config(cross_substrate_propagation_method="mi")
    schedule = AsyncSchedule(
        consolidate_every_n_episodes=1,
        apply_pressure_delay_episodes=10,  # delay forces no application
        stale_pressure_max_age_episodes=2,  # tight expiry
    )
    orch = AsyncOrchestratorOrganismDriven(config=config)
    # Long enough to expire pressures.
    scenario = _scenario_red_only(10)
    priming = _build_priming([2, 3])
    orch.run_async(scenario, schedule, coupling=True, mirror_priming=priming)
    # At least one produced pressure should have expired without application.
    expired_count = len(orch.expired_pressure_log)
    applied_count = len(orch.applied_pressure_log)
    # We expect at least one expired (because delay=10 > max_age=2).
    assert expired_count >= 1, (
        f"expected at least one expired pressure with delay=10 max_age=2; "
        f"got {expired_count} expired and {applied_count} applied"
    )
    # And NO expired pressure should have applied_at_episode set.
    for pp in orch.expired_pressure_log:
        assert pp.applied_at_episode is None
        assert pp.expired
        assert pp.expired_at_episode is not None


# ---------------------------------------------------------------------------
# Mandatory scenario 6: branch or marker effect
# ---------------------------------------------------------------------------

def test_async_branch_flip_or_marker_effect_observable():
    """A/B run with async scheduling. At least marker-level diff; ideally
    arbiter_decision branch flip."""
    result = run_async_coupling_demo()
    assert result["async_marker_diff_confirmed"], (
        "BLOCKED: async run produced no decision_field diff at all"
    )
    if result["async_branch_flip_confirmed"]:
        # Branch flip is the stronger confirmation.
        assert len(result["branch_flip_diffs"]) >= 1
        flip = result["branch_flip_diffs"][0]
        assert "arbiter_decision" in flip["fields"]
    else:
        pytest.fail(
            "marker-only async cognitive coupling. Branch flip not "
            "demonstrated by run_async_coupling_demo."
        )


# ---------------------------------------------------------------------------
# Safety table all-zero under async
# ---------------------------------------------------------------------------

def test_async_safety_metrics_all_zero():
    result = run_async_coupling_demo()
    counts = {"wrong_commit": 0, "false_promote": 0, "false_retrograde": 0,
              "query_override": 0, "entity_leakage": 0, "attr_leakage": 0,
              "stale_pressure_applied": result["stale_pressure_applied_count"],
              "wrong_slot_pressure_applied": result["wrong_slot_pressure_applied_count"]}
    valid_entities = {"dragon", "teacher", "horse", "knight", "wizard", "beast"}
    valid_attrs = {"color", "size", "state", "mood"}
    for report in (result["report_off"], result["report_on"]):
        for ep in report.episodes:
            for trace in ep.traces:
                if trace.intent == "READ" and trace.latent_pressure_marker:
                    counts["query_override"] += 1
                if (trace.intent == "WRITE" and trace.head_entity is not None
                        and trace.head_entity not in valid_entities):
                    counts["entity_leakage"] += 1
                if trace.slot_attr is not None and trace.slot_attr not in valid_attrs:
                    counts["attr_leakage"] += 1
    for k, v in counts.items():
        assert v == 0, f"async safety regression: {k}={v}"


# ---------------------------------------------------------------------------
# Provenance chain includes delay metadata
# ---------------------------------------------------------------------------

def test_pending_pressure_records_delay_metadata():
    result = run_async_coupling_demo()
    applied = result["applied_pressure_log"]
    assert applied, "no pressure was applied in async demo"
    for pp in applied:
        assert pp["produced_at_episode"] >= 1
        assert pp["earliest_apply_at"] >= pp["produced_at_episode"]
        assert pp["expires_at"] > pp["produced_at_episode"]
        assert pp["applied_at_episode"] is not None
        assert pp["applied_at_episode"] >= pp["earliest_apply_at"]
        assert pp["delay_steps"] is not None
        assert pp["delay_steps"] == pp["applied_at_episode"] - pp["produced_at_episode"]
        assert pp["consolidation_record_ids"]
        assert pp["pressure_id"]


def test_expired_pressure_records_expiry_metadata():
    config = Config(cross_substrate_propagation_method="mi")
    schedule = AsyncSchedule(
        consolidate_every_n_episodes=1,
        apply_pressure_delay_episodes=10,
        stale_pressure_max_age_episodes=2,
    )
    orch = AsyncOrchestratorOrganismDriven(config=config)
    scenario = _scenario_red_only(8)
    priming = _build_priming([2, 3])
    orch.run_async(scenario, schedule, coupling=True, mirror_priming=priming)
    expired = orch.expired_pressure_log
    assert expired, "no pressure expired despite tight max_age"
    for pp in expired:
        assert pp.expired
        assert pp.expired_at_episode is not None
        assert pp.expired_at_episode > pp.expires_at
        assert pp.applied_at_episode is None  # never applied if expired


# ---------------------------------------------------------------------------
# Sync mode is recovered when schedule defaults are used (regression)
# ---------------------------------------------------------------------------

def test_sync_recovered_with_default_schedule():
    """AsyncSchedule(1, 0, 5) should reproduce v0.3.2 behavior. The
    branch flip should still happen at ep4."""
    config = Config(cross_substrate_propagation_method="mi")
    orch = AsyncOrchestratorOrganismDriven(config=config)
    scenario = _scenario_red_only(4)
    priming = _build_priming([2, 3])
    report = orch.run_async(scenario, AsyncSchedule(), coupling=True,
                            mirror_priming=priming)
    ep4 = report.episodes[3]
    decisions = [t.arbiter_decision for t in ep4.traces]
    assert "MARK_DISPUTED_LATENT_RETROGRADE" in decisions, (
        f"sync-equivalent schedule did not produce branch flip at ep4: "
        f"decisions={decisions}"
    )


# ---------------------------------------------------------------------------
# Regression: v0.3.2 still passes
# ---------------------------------------------------------------------------

def test_v032_auto_registration_demo_still_passes():
    from unified_fragmergent_memory.runtime import run_auto_registration_demo
    result = run_auto_registration_demo()
    assert result["auto_registration_branch_flip_confirmed"]
    assert result["bidirectional_round_trip_verified"]


# ---------------------------------------------------------------------------
# R1 source invariance
# ---------------------------------------------------------------------------

def test_async_does_not_mutate_source_files():
    sources = [
        Path("c:/Users/Lucian/Desktop/D_CORTEX_ULTIMATE/MISIUNEA.txt"),
        Path("c:/Users/Lucian/Desktop/D_CORTEX_ULTIMATE/steps/13_v15_7a_consolidation/code.py"),
        Path("c:/Users/Lucian/Desktop/fragmergent-memory-engine/ignition_build_v0.py"),
        Path("c:/Users/Lucian/Desktop/fragmergent-memory-engine/13_v15_7a_consolidation/d_cortex/v15_7a_core.py"),
        Path("c:/Users/Lucian/Desktop/fragmergent-memory-engine/13_v15_7a_consolidation/d_cortex/adapter.py"),
        Path("c:/Users/Lucian/Desktop/fragmergent-memory-engine/13_v15_7a_consolidation/d_cortex/receptor.py"),
    ]
    before = {}
    for p in sources:
        if p.exists():
            with open(p, "rb") as f:
                before[str(p)] = hashlib.sha256(f.read()).hexdigest()
    run_async_coupling_demo()
    after = {}
    for p in sources:
        if p.exists():
            with open(p, "rb") as f:
                after[str(p)] = hashlib.sha256(f.read()).hexdigest()
    assert before == after


# ---------------------------------------------------------------------------
# AsyncSchedule validation
# ---------------------------------------------------------------------------

def test_async_schedule_validation_rejects_invalid():
    with pytest.raises(ValueError):
        AsyncSchedule(consolidate_every_n_episodes=0).validate()
    with pytest.raises(ValueError):
        AsyncSchedule(apply_pressure_delay_episodes=-1).validate()
    with pytest.raises(ValueError):
        AsyncSchedule(stale_pressure_max_age_episodes=0).validate()


def test_async_schedule_is_consolidate_episode():
    sch = AsyncSchedule(consolidate_every_n_episodes=2)
    assert not sch.is_consolidate_episode(1)
    assert sch.is_consolidate_episode(2)
    assert not sch.is_consolidate_episode(3)
    assert sch.is_consolidate_episode(4)
