# Functional validation

This document is the audit-grade summary of what is concretely
validated by the FCE-M test suite. It maps each top-level claim made
by the project to the test(s) that prove it. If a claim is not pinned
by a test, it does not appear here.

## Claim → test mapping

### C1. Observer is non-invasive over UFME

> *Enabling FCE-Ω does not change UFME's epistemic outputs.*

| Sub-claim | Test |
|---|---|
| `consolidate.ops` identical OFF vs ON | `test_01::test_consolidate_signals_and_ops_identical` |
| `runtime_view(store)` identical | `test_01::test_runtime_view_identical` |
| `tf_engine` read results identical | `test_01::test_tf_engine_read_results_identical` |
| `audit_log` unchanged | `test_01::test_audit_log_unchanged_by_observer` |
| `slot_event_log` byte-equal OFF vs ON across all advisory modes | `test_19::test_no_hidden_writeback_to_runtime_sources` |
| OmegaRegistry identical OFF vs ON across all advisory modes | `test_19::test_advisory_does_not_alter_omega_registry_versus_read_only` |

### C2. Per-center anchor isolation (v0.4.1)

> *Anchor and disrupt_eff are computed strictly from a center's own
> zone history. Disputed writes on B do not modulate A.*

| Sub-claim | Test |
|---|---|
| `anchor_from_center_counts()` is monotone | `test_16::test_anchor_from_center_counts_monotone` |
| Backward-compat `anchor_from_runtime_snapshot` still exported | `test_16::test_backward_compat_global_anchor_still_exists` |
| Disputed on B does not touch A | `test_16::test_disputed_on_B_does_not_touch_A_state` |
| Committed on A raises only A's anchor | `test_16::test_committed_on_A_raises_only_A_anchor` |
| Two-center bitwise isolation | `test_16::test_two_independent_centers_bitwise_isolated` |
| Omega on A does not produce anchor mass on B | `test_16::test_omega_on_A_does_not_produce_anchor_mass_on_B` |
| Persist roundtrip preserves per-center counts | `test_16::test_persist_load_roundtrips_zone_counts` |
| Center-isolation preserved with multiperspectival ON when not co-active | `test_18::test_center_isolation_preserved_without_explicit_interaction` |

### C3. Omega produced by rule, not manually (v0.4.2)

> *Omega coagulation arises ONLY from `check_coagulation` firing
> after `S_t ≥ θ_s` for `τ_coag` consecutive cycles. There is no
> code path that sets `Ω = 1` outside this rule.*

| Sub-claim | Test |
|---|---|
| R10b coagulation emerges from `check_coagulation` | `test_17::test_r10b_omega_emerges_from_rule_not_synthetic` |
| Thresholds are realistic, not permissive | `test_17::test_r10b_realistic_thresholds_not_permissive` |
| Coagulation metrics are meaningful (S_t≥θ, AR>0.5, kappa in range) | `test_17::test_r10b_coagulation_metrics_are_meaningful` |
| Phoenix is the ONLY coagulated center in the experiment | `test_17::test_r10b_no_other_centers_coagulated` |

### C4. Omega irreversibility

> *Once `Ω = 1`, no subsequent drop in S_t flips it. Historical
> fields of OmegaRecord are immutable.*

| Sub-claim | Test |
|---|---|
| `omega_id` immutable under perturbation | `test_17::test_r10b_omega_irreversible_after_disputed_perturbation`, `test_05::test_omega_id_immutable_under_perturbation` |
| Observer agent `Omega` flag stays 1 after S_t drop | `test_05::test_observer_agent_omega_flag_stays_at_1_after_S_t_drop` |
| Expression history is append-only | `test_05::test_expression_history_is_append_only` |
| Re-registering same center is idempotent | `test_omega_irreversibility::test_re_registering_same_center_is_idempotent` |
| Registry persistence preserves history | `test_omega_irreversibility::test_registry_persistence_roundtrip` |

### C5. Truth-status preserved (Omega is not truth)

> *A coagulated Omega does not rewrite the runtime's epistemic
> verdict on the underlying slot.*

| Sub-claim | Test |
|---|---|
| Disputed write after coag still lands in runtime log | `test_06::test_disputed_write_after_coagulation_lands_in_runtime_log` |
| Registry refuses to invent records via expression calls | `test_06::test_registry_refuses_to_invent_records_via_expression_calls` |
| Registry rejects unknown expression states | `test_not_truth::test_registry_rejects_unknown_expression_state` |
| Advisory hint disclaims truth override in text | `test_06::test_advisory_hint_explicitly_disclaims_truth_override` |
| Last slot zone preserved after R10b perturbation | `test_17::test_r10b_disputed_zone_preserved_in_runtime_log` |
| No epistemic override from ReferenceField | `test_20::test_no_epistemic_override_from_reference_field` |

### C6. Multiperspectival observer bounded (v0.5.0)

> *Composition over N active centers does not produce
> super-turbulent total field magnitude.*

| Sub-claim | Test |
|---|---|
| Active-center detection (3 centers → 6 ordered traces) | `test_18::test_multiperspectival_observer_detects_active_centers` |
| Directional asymmetry of absorption / repulsion | `test_18::test_directional_interaction_i_to_j_differs_from_j_to_i`, `test_18::test_absorption_repulsion_are_directional` |
| Interference antisymmetry residual `< 1e-12` in runtime | `test_18::test_interference_antisymmetry_wired_in_observer` |
| Total directional norm bounded for N=1,4,8,16 | `test_18::test_multiperspectival_normalization_bounded_for_N_1_4_8_16` |
| Vendor primitives directional (proof at vendor level) | `test_09::test_interference_operator_is_antisymmetric`, `test_09::test_absorption_is_asymmetric_under_unequal_capacity`, `test_09::test_repulsion_depends_on_misalignment_only` |
| Passive invariance OFF vs ON for multiperspectival | `test_18::test_passive_invariance_still_holds` |
| Persist/load multiperspectival traces | `test_18::test_persist_load_multiperspectival_traces` |

### C7. Advisory is priority-only, never truth (v0.5.1)

> *`priority_only` mode emits bounded metadata; never modifies UFME
> state, slot zones, OmegaRegistry.*

| Sub-claim | Test |
|---|---|
| Default mode is `read_only` | `test_19::test_default_mode_is_read_only` |
| `read_only` has zero side effects | `test_19::test_read_only_mode_has_zero_side_effects` |
| `priority_only` creates feedback metadata with schema | `test_19::test_priority_only_creates_feedback_metadata` |
| Epistemic status preserved in `priority_only` | `test_19::test_priority_only_does_not_change_epistemic_status` |
| `near_coagulation` recommends incubation BEFORE Omega | `test_19::test_near_coagulation_recommends_incubation_not_omega` |
| `contested_expression` recommends review WITHOUT uncoagulating | `test_19::test_contested_omega_recommends_review_without_uncoagulating` |
| `relation_candidate` recommends review WITHOUT creating registry | `test_19::test_relation_candidate_recommends_relation_review_without_mutation` |
| Provenance complete on every item | `test_19::test_priority_feedback_has_complete_provenance` |
| Persist/load roundtrip of feedback | `test_19::test_priority_feedback_persist_load_roundtrip` |
| Passive outputs unchanged except metadata | `test_19::test_priority_only_passive_outputs_unchanged_except_metadata` |
| No hidden write-back to runtime sources | `test_19::test_no_hidden_writeback_to_runtime_sources` |
| Priority scores bounded in [-1, 1] | `test_19::test_priority_scores_are_bounded` |
| OmegaRegistry identical between modes | `test_19::test_advisory_does_not_alter_omega_registry_versus_read_only` |

### C8. ReferenceField is native morphogenetic memory (v0.6.0)

> *ReferenceField is created only from OmegaRecord, classifies future
> events morphogenetically, never overrides truth, never auto-creates
> Omega on third centers.*

| Sub-claim | Test |
|---|---|
| RF not created without OmegaRecord | `test_20::test_reference_field_not_created_without_omega` |
| RF created from OmegaRecord with omega_id provenance | `test_20::test_reference_field_created_from_omega_record` |
| OmegaRecord untouched by RF activity | `test_20::test_reference_field_does_not_modify_omega_record` |
| Aligned events reinforce expression | `test_20::test_committed_aligned_event_reinforces_expression` |
| Disputed contests expression, not truth | `test_20::test_disputed_event_contests_expression_not_truth` |
| Persist/load RF + events + interactions | `test_20::test_reference_field_persist_load_roundtrip` |
| Default OFF preserves v0.5.1 byte-identical | `test_20::test_reference_field_default_off_preserves_v0_5_1_behavior` |
| Centers without Omega cannot enter omega_field | `test_20::test_center_without_omega_cannot_enter_omega_field` |
| Two coagulated centers produce interaction trace | `test_20::test_two_omega_reference_fields_can_interact` |
| Omega-field interaction does not create individual Omega | `test_20::test_omega_field_interaction_does_not_create_individual_omega` |
| `priority_only` uses RF for feedback without write-back | `test_20::test_priority_only_uses_reference_field_for_feedback_without_writeback` |
| No epistemic override from RF | `test_20::test_no_epistemic_override_from_reference_field` |
| RF provenance complete | `test_20::test_reference_field_provenance_complete` |
| RF expression_state fluctuates; OmegaRecord stays | `test_20::test_reference_field_expression_state_can_fluctuate` |

### C9. Provenance and persistence

> *Every OmegaRecord, ReferenceField, and morphogenesis row traces
> back to runtime events. State survives persist/load across all
> versions.*

| Sub-claim | Test |
|---|---|
| OmegaRecord traces to slot_events | `test_11::test_omega_record_traces_back_to_runtime_slot_events`, `test_17::test_r10b_provenance_complete` |
| Morphogenesis rows carry episode_id | `test_11::test_morphogenesis_rows_carry_episode_id_back_to_runtime` |
| Propagate does not inject phantom provenance | `test_11::test_propagate_does_not_inject_phantom_provenance` |
| Observer roundtrip | `test_12::test_observer_roundtrip` |
| Omega survives reload | `test_12::test_omega_irreversibility_survives_reload`, `test_17::test_r10b_persist_load_roundtrip_preserves_omega` |
| Payload is JSON-inspectable | `test_12::test_persisted_payload_is_json_inspectable` |

## Summary

Every top-level capability claim made by FCE-M v0.6.0 has at least one
explicit test pinning it. The full mapping above is the audit-grade
guarantee that the README, PAPER, and CHANGELOG claims are not
unverified rhetoric.

Total tests: **268 passing**.
