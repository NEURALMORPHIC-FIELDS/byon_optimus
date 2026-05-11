"""FN-17 R10b integrated reproduction (v0.4.2).

Pins down the contract that an Omega coagulation can be produced END TO
END inside the integrated UFME + FCE-Omega runtime, via the threshold
rule (check_coagulation), without anyone setting Omega manually.

Mission §7 Etapa 2: "Ω trebuie să apară prin regulă, nu setat manual.
Trebuie să rulezi o traiectorie completă."

This is the test that proves we have not built a registry full of
synthetic Omegas — the registry receives only what the observer's
threshold mechanism produced from a coherent committed sequence.

After coagulation, we drive a perturbation phase and assert all the
irreversibility / not-truth / provenance invariants from §6.
"""

from __future__ import annotations

from pathlib import Path

from experiments.r10b_integrated_phoenix import (
    THETA_S_DEFAULT, TAU_COAG_DEFAULT,
    GERMINAL_EPISODES_DEFAULT, PERTURBATION_EPISODES_DEFAULT,
    run as run_r10b,
)


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_r10b_omega_emerges_from_rule_not_synthetic(tmp_path):
    """Omega must be produced by check_coagulation, not by a test
    that flips agent.Omega = 1 or calls registry.register directly."""
    rep = run_r10b(out_dir=tmp_path)
    assert rep.coagulation_observed, (
        "no Omega coagulation occurred in the germinal phase; the "
        "experiment failed to reproduce R10b principle"
    )
    assert rep.coagulation_was_synthetic is False
    # The duration above threshold must equal at least tau_coag (and
    # in this experiment exactly tau_coag, since coagulation fires at
    # the very first cycle that completes the tau window).
    assert rep.duration_above_threshold >= rep.tau_coag


def test_r10b_realistic_thresholds_not_permissive():
    """Catch any regression where someone re-introduces theta_s=0.0
    or tau_coag=1 in the experiment to "make it pass"."""
    assert THETA_S_DEFAULT >= 0.05, (
        f"theta_s={THETA_S_DEFAULT} is too permissive for a realistic "
        f"R10b reproduction"
    )
    assert TAU_COAG_DEFAULT >= 2, (
        f"tau_coag={TAU_COAG_DEFAULT} is too short for a germinal "
        f"incubation window"
    )


def test_r10b_coagulation_metrics_are_meaningful(tmp_path):
    """S_t, AR, kappa at coagulation must reflect a real trajectory."""
    rep = run_r10b(out_dir=tmp_path)
    assert rep.coagulation_observed
    # S_t at coagulation crossed the threshold (with small numerical
    # slack for the comparison).
    assert rep.S_t_at_coagulation >= rep.theta_s - 1e-9
    # kappa at coagulation is in the operational range.
    assert 0.01 < rep.kappa_at_coagulation < 1.0
    # AR has had time to settle (well above zero).
    assert rep.AR_at_coagulation > 0.5
    # sine_type belongs to the recognized set.
    assert rep.sine_type in {"integrative", "operational", "turbulent"}


def test_r10b_omega_irreversible_after_disputed_perturbation(tmp_path):
    """Mission §6 invariant: Omega remains 1 after perturbation, and
    the historical fact (id + coagulation episode + S_t_at_coag) is
    immutable."""
    rep = run_r10b(out_dir=tmp_path)
    assert rep.omega_remained_1
    assert rep.omega_id_immutable
    assert rep.coagulation_episode_immutable
    assert rep.S_t_at_coagulation_immutable
    # The last perturbation row's Omega must be 1.
    last = rep.trajectory[-1]
    assert last.phase == "perturbation"
    assert last.omega == 1


def test_r10b_disputed_zone_preserved_in_runtime_log(tmp_path):
    """Mission §6 (FCE not truth): the runtime's slot_event for the
    last disputed write must still report DISPUTED. FCE-Omega must
    not have rewritten it."""
    rep = run_r10b(out_dir=tmp_path)
    assert rep.runtime_log_last_disputed_zone_intact


def test_r10b_provenance_complete(tmp_path):
    """The OmegaRecord must carry source_episodes and source_events
    back to the runtime events that drove coagulation."""
    rep = run_r10b(out_dir=tmp_path)
    assert rep.source_episodes_complete
    assert rep.source_events_complete


def test_r10b_persist_load_roundtrip_preserves_omega(tmp_path):
    """An OmegaRecord that was produced via the threshold rule must
    survive a persist/load cycle of the observer state."""
    rep = run_r10b(out_dir=tmp_path)
    assert rep.persist_load_roundtrip_ok


def test_r10b_artifact_saved_to_disk(tmp_path):
    rep = run_r10b(out_dir=tmp_path)
    json_path = tmp_path / "r10b_trajectory.json"
    txt_path = tmp_path / "r10b_trajectory.txt"
    assert json_path.exists()
    assert txt_path.exists()
    # The txt artifact must mention the by-rule coagulation, not a
    # synthetic flip.
    txt = txt_path.read_text(encoding="utf-8")
    assert "Omega produced by RULE (check_coagulation): True" in txt
    assert "Was Omega set synthetically? False" in txt


def test_r10b_no_other_centers_coagulated(tmp_path):
    """The experiment touches only phoenix::identity. No other center
    should appear in the registry (per the v0.4.1 per-center isolation
    contract: an unrelated center cannot piggyback on phoenix's Omega)."""
    rep = run_r10b(out_dir=tmp_path)
    # Re-run minimal: construct a store with the same config and check
    # the registry has exactly one record for phoenix::identity.
    from unified_fragmergent_memory import UnifiedMemoryStore, Config
    cfg = Config(fce_omega_enabled=True, fce_omega_D=rep.D,
                 fce_omega_theta_s=rep.theta_s,
                 fce_omega_tau_coag=rep.tau_coag,
                 fce_omega_seed=rep.seed)
    s = UnifiedMemoryStore(cfg)
    for ep in range(1, rep.germinal_episodes + 1):
        s.write({"entity_id": "phoenix", "attr_type": "identity",
                 "value_str": "fire-bird", "value_idx": 1,
                 "episode_id": ep, "write_step": 0,
                 "zone_after": "committed"})
        s.consolidate(episode_id=ep)
    centers = {r["semantic_center"]
               for r in s.omega_registry_snapshot()["records"]}
    assert centers == {"phoenix::identity"}, (
        f"unexpected coagulated centers: {centers}"
    )
