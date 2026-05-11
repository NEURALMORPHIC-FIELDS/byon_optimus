# Changelog

All notable changes to the FCE-Ω + UFME integrated project.

## Current status (snapshot)

| Field | Value |
|---|---|
| Version | v0.6.0 |
| Tests | 268 / 268 passing |
| Verdict | NATIVE MEMORY PROTOTYPE (ReferenceField from Omega; passive on truth) |
| Layer | UFME + multiperspectival observer + semi-active priority + ReferenceField |
| Future work | self-application loop (NOT yet implemented; v0.6.0 deliberately stops short) |

The v0.3.x backlog is complete: vector perturbation (v0.3.0), factor
calibration (v0.3.1), bidirectional auto-registration (v0.3.2), and async
cycle (v0.3.3). The v0.4.0 release added FCE-Ω as the morphogenetic layer
(passive integration + read-only advisory). v0.4.1 closes the
v0.4.0 anchor-coupling limitation: anchor is computed per center now.

## 0.6.0 (2026-05-11) — Native Memory Prototype: ReferenceField from OmegaRecord

First version where Omega becomes a FUNCTIONAL FIELD, not just a record.
The architectural distinction is now explicit in code:

  - **OmegaRecord**    = irreversible historical fact of coagulation.
                         omega_id / coagulated_at_episode /
                         S_t_at_coagulation / kappa_at_coagulation /
                         source_episodes / source_events are IMMUTABLE
                         for the life of the system.
  - **ReferenceField** = a derived, FLUCTUATING field that uses the
                         OmegaRecord as anchor and classifies future
                         observations morphogenetically. strength /
                         expression_state may drift; OmegaRecord
                         cannot.

This is the first version where memory becomes INTERNAL FORM that
shapes how future inputs are READ — not a database queried for
answers. The classification kinds (aligned, expression_reinforcing,
tensioned, orthogonal, contested_expression, residue_amplifying) are
PURELY morphogenetic; the runtime adapter's slot_event_log,
audit_log, and D_Cortex truth verdicts are NEVER altered.

### Added

- `Config.fce_reference_fields_enabled: bool = False` (default OFF
  preserves v0.5.1 behavior byte-identical)
- `unified_fragmergent_memory/runtime/reference_field.py`:
  - `ReferenceField` dataclass: reference_id, omega_id, center_key,
    field_vector (frozen at coag), strength, expression_state,
    created_at_episode, last_updated_episode, source_omega_record
  - `ReferenceFieldRegistry` (register + update_with_event +
    snapshot/persist/load)
  - `ReferenceFieldEvent` dataclass for classification audit
  - `OmegaFieldInteraction` dataclass for inter-RF pair traces
  - `classify_event_against_reference()` pure function: zone-aware
    classification into the six event kinds above
- Observer wiring (`FCEOmegaObserver`):
  - When `newly_coagulated`, auto-register a ReferenceField with
    `field_vector = normalize(0.5 * agent.Phi_s + 0.5 * delta_X_unit)`
    at coag time (blends internal direction with content vector)
  - After agent steps, classify each new observation against the
    active RF for its center; update RF strength + expression_state
  - For co-active pairs that BOTH have RF, record
    `OmegaFieldInteraction` (field_alignment, field_tension,
    resonance_score, interference_score)
  - In `priority_only` mode, surface RF events and omega_field
    interactions as advisory feedback with new bounded kinds:
    `expression_reinforcing`, `rf_aligned`,
    `rf_contested_expression`, `rf_residue_amplifying`,
    `omega_field_resonance`, `omega_field_interference`
- `UnifiedMemoryStore.fce_reference_fields()`,
  `fce_reference_field(center_key)`,
  `fce_reference_field_events()`,
  `fce_omega_field_interactions()` — read-only endpoints
- `metrics_snapshot()["fce_omega"]` adds `reference_fields_enabled`,
  `reference_fields_count`, `reference_field_events_size`,
  `omega_field_interactions_size`
- Persistence: payload version `v0.6.0` includes
  `reference_fields_enabled`, `reference_field_registry`,
  `reference_field_events`, `omega_field_interactions`; older
  payloads load with empty RF state (backward-compat)
- `tests/fce_omega_functional/test_20_reference_field_native_memory.py`
  — 14 functional tests:
    1. RF not created without OmegaRecord
    2. RF created from OmegaRecord with omega_id provenance
    3. OmegaRecord stays bitwise-immutable across all RF activity
    4. Committed aligned events keep RF strength stable / above
       contested threshold
    5. Disputed event after coag classified as contested_expression
       OR residue_amplifying; slot_event_log still DISPUTED; Omega
       unchanged
    6. Persist/load roundtrip preserves RF + events + advisory +
       Omega registry
    7. Default OFF preserves v0.5.1 byte-identical
    8. Centers without Omega cannot enter omega_field_interactions
    9. Two coagulated centers produce OmegaFieldInteraction trace
    10. Omega-field interaction does NOT create individual Omega
        for a third co-active center (threshold rule still required)
    11. priority_only emits RF-derived feedback kinds; no UFME
        write-back
    12. No epistemic override: 8 disputed events post-coag keep all
        slot_event_log zones as DISPUTED and Omega still in registry
    13. RF source_omega_record carries complete provenance
        (omega_id, coag episode, S_t / kappa at coag, source_episodes,
        source_event_count)
    14. RF expression_state can fluctuate across active / contested /
        inexpressed; OmegaRecord stays anchored

### Changed

- Payload version bumped to `v0.6.0`.
- `test_12::test_persisted_payload_is_json_inspectable` accepts
  `v0.6.0` payloads.
- `_emit_priority_feedback` signature extended (backward-compatible):
  optional `reference_field_events` and `omega_field_interactions`
  parameters surface RF-derived feedback when supplied.

### Invariants preserved (mission §6 + §10)

- OmegaRecord remains immutable on historical fields.
- ReferenceField never modifies UFME memory, slot zones, or
  D_Cortex truth verdicts.
- Centers without Omega cannot enter the Omega-field.
- omega_field interactions never create third-center Omega.
- All 254 v0.5.1 tests still PASS; +14 new RF tests → 268 total.
- Default OFF means v0.5.1 byte-identical for callers that do not
  opt into native memory.

### What v0.6.0 deliberately does NOT yet do

- No self-application loop: feedback is still inspectable metadata
  that consumers MAY act on; no autonomous queue mutation.
- No first-class RelationRegistry: relation candidates remain
  ephemeral RelationCandidate items in the observer.
- No epistemic write-back of any kind. ReferenceField is the morphogenetic
  reader of future events; the runtime is still the truth speaker.

## 0.5.1 (2026-05-11) — Semi-Active Advisory Feedback

Adds a semi-active priority channel that emits bounded, provenance-
tracked recommendations after each consolidate. The channel is OPT-IN
through `Config.fce_advisory_mode`:

  - `"read_only"` (default) — observer behavior is bit-identical to
    v0.5.0; `advisory_hints()` snapshots remain available and the
    `advisory_feedback_log` stays empty.
  - `"priority_only"` — the observer derives `FCEAdvisoryFeedback`
    items each consolidate. Each item carries a bounded
    `priority_delta` in [-1, 1], a `recommended_action`, a `reason`
    that always disclaims epistemic authority, and complete
    provenance (trace ids, omega ids, relation-candidate ids).

The mode is named after its scope: ONLY priorities and consolidation
hints are recommended. The runtime adapter, slot_event_log, audit_log,
D_Cortex, and tf_engine are NEVER touched in either mode. The Omega
registry is byte-identical between `read_only` and `priority_only`
runs on the same input (proven by
`test_advisory_does_not_alter_omega_registry_versus_read_only`).

### Added

- `Config.fce_advisory_mode: str = "read_only"`
- `FCEAdvisoryFeedback` dataclass with feedback_id, center_key, kind,
  priority_delta, recommended_action, reason, source_trace_ids,
  source_omega_ids, source_relation_candidate_ids, applied, mode,
  created_at_episode
- `FCEOmegaObserver.advisory_feedback_log` + `_emit_priority_feedback`
- Kinds emitted: `high_residue`, `near_coagulation`,
  `coagulated_reference`, `contested_expression`, `fragmented`,
  `relation_candidate`
- Bounded priority class constants on the observer:
  `PRIORITY_DELTA_HIGH_RESIDUE_CAP=1.0`,
  `PRIORITY_DELTA_FRAGMENTED=-0.50`,
  `PRIORITY_DELTA_NEAR_COAG_CAP=0.80`,
  `PRIORITY_DELTA_COAG_REFERENCE=0.40`,
  `PRIORITY_DELTA_CONTESTED=0.30`,
  `PRIORITY_DELTA_RELATION_CANDIDATE_CAP=0.50`
- `UnifiedMemoryStore.fce_advisory_feedback()` and
  `fce_priority_recommendations()` (positive-delta filter)
- `metrics_snapshot()["fce_omega"]` now reports `advisory_mode` and
  `advisory_feedback_log_size`
- Persistence: payload version `v0.5.1` includes `advisory_mode` and
  `advisory_feedback_log`; older payloads load with feedback empty.
- `tests/fce_omega_functional/test_19_semi_active_advisory.py`
  — 13 functional tests:
    1. default mode is read_only
    2. read_only has zero side effects (advisory_feedback empty)
    3. priority_only creates feedback metadata with full schema
    4. priority_only does NOT change epistemic status (slot_event_log
       zones preserved)
    5. near_coagulation recommends incubation BEFORE Omega is set
    6. contested_expression recommends review WITHOUT uncoagulating
    7. relation_candidate emits feedback WITHOUT mutating Omega or
       creating any new relation registry
    8. every feedback item carries complete provenance (lists + 16-hex
       feedback_id)
    9. persist/load roundtrip preserves the feedback log
    10. passive outputs unchanged between read_only and priority_only
        (ops, signals, audit_log, runtime_view identical)
    11. no hidden write-back: slot_event_log, audit_log_size,
        n_committed_slots etc. all bit-equal across modes
    12. priority_delta bounded in [-1, 1] across a large mixed
        workload
    13. bonus: OmegaRegistry byte-equal between read_only and
        priority_only on the same input

### Changed

- Payload version bumped to `v0.5.1`.
- `test_12_persistence_reload::test_persisted_payload_is_json_inspectable`
  accepts `v0.5.1`.

### Invariants preserved (mission §6)

- FCE-Omega still does not decide epistemic truth.
- Omega still produced only by `check_coagulation` rule; advisory
  feedback cannot create Omega — proven by registry-equality test.
- Read-only mode is the default and is bit-identical to v0.5.0.
- Advisory feedback recommendations are bounded and provenance-tracked.
- All 241 v0.5.0 tests still PASS; +13 new advisory tests → 254 total.

## 0.5.0 (2026-05-11) — Multiperspectival Observer

Activates inter-center composition in the FCE-Omega observer. When
multiple centers are co-active inside the same `consolidate` pass,
the observer computes directional interactions for every ordered
pair using the FCE-Omega primitives vendored at
`vendor/fce_omega_source/src/core/interactions.py`:

  - absorption    `A_{i<-j}` (driven by receiver's projector and capacity)
  - repulsion     `R_{i<-j}` (driven by misalignment)
  - interference  `K_{i<-j}` (commutator of Lie-algebra elements;
                  anti-symmetric in i, j)
  - directional   `C_{i<-j}` (asymmetric coagulation pull)
  - shared coag   `C^{shared}_{ij}` for unordered pairs that both
                  cross THETA_PAIR; produces RelationCandidate entries

All composition is class-wise normalized per mission §3:
  - directional terms divided by N*(N-1)
  - shared-coag candidates divided by N*(N-1)/2

so the total inter-center magnitude stays bounded as the active set
grows. test_18 verifies this for N=1, 4, 8, 16.

Coagulated centers project a reference-field anchor onto co-active
neighbors via `agent.step(anchor=...)`: contribution scales with
Phi_s alignment and is divided by (N_active - 1). The contribution
is bounded by `fce_multiperspectival_anchor_eta` (default 0.30) and
the effective anchor is clamped to [0, 1]. **A reference anchor
CANNOT auto-coagulate a target center**: coagulation still requires
the threshold rule (S_t >= theta_s for tau_coag consecutive cycles)
on the target itself.

The mode is OFF by default. With `fce_multiperspectival_enabled=False`
the observer behaves exactly as in v0.4.1 — all 231 prior tests stay
bit-identical.

### Added

- `Config.fce_multiperspectival_enabled: bool = False`,
  `fce_multiperspectival_anchor_eta: float = 0.30`,
  `fce_multiperspectival_theta_pair: float = 0.20`
- `MultiperspectiveInteractionTrace` and `RelationCandidate` dataclasses
- `FCEOmegaObserver.interaction_log`, `.relation_candidates`,
  `._last_delta_X` cache, `._compose_multiperspectival()`,
  `_build_Phi_a_for_pair()` helpers
- `MorphogenesisReport.interaction_traces`,
  `MorphogenesisReport.relation_candidates`
- `UnifiedMemoryStore.fce_interaction_log()`,
  `fce_relation_candidates()` read-only endpoints
- Persistence: `persist()` writes `version="v0.5.0"` and includes
  `interaction_log`, `relation_candidates`, multiperspectival params;
  `load()` treats them as optional so v0.4.x payloads still resume.
- `metrics_snapshot()["fce_omega"]` now reports
  `multiperspectival_enabled`, `multiperspectival_anchor_eta`,
  `multiperspectival_theta_pair`, `interaction_log_size`,
  `relation_candidates_count`.
- `tests/fce_omega_functional/test_18_multiperspectival_observer.py`
  (10 functional tests):
    1. active-center detection (3 co-active centers -> 6 ordered traces)
    2. directional asymmetry: `I_{A<-B} != I_{B<-A}` for absorption and
       repulsion under unequal capacities
    3. interference antisymmetry residual ~0 in the runtime, not just
       in vendor
    4. absorption / repulsion direction asymmetric on at least one
       pair under unequal histories
    5. normalization bounded for N=1, 4, 8, 16; total directional
       interaction norm stays < 2 (would explode without /N(N-1))
    6. no auto-coagulation from reference field: A coagulated does
       not coagulate a co-active B with a single disputed event
    7. relation-candidate does NOT modify individual Omega; the
       candidate's note explicitly disclaims epistemic authority
    8. per-center isolation preserved when centers never co-active
       in the same consolidate pass (v0.4.1 regression guard)
    9. passive invariance: runtime ops, signals, audit_log identical
       between multiperspectival OFF and ON
    10. persist / load roundtrip preserves interaction_log and
        relation_candidates

### Changed

- Payload version bumped to `v0.5.0`.
- `test_12_persistence_reload::test_persisted_payload_is_json_inspectable`
  accepts `v0.5.0` payloads in addition to v0.4.0 / v0.4.1.

### Invariants preserved (mission §6)

- FCE-Omega still does not decide epistemic truth. Reference-field
  anchor influences disrupt_eff for kappa update, not slot status.
- Omega still produced only by `check_coagulation` rule; reference
  anchor cannot replace the threshold mechanism.
- Advisory channel still read-only.
- Per-center isolation (v0.4.1) preserved when centers are not in
  the same consolidate pass.
- All 231 v0.4.2 tests still PASS; +10 new multiperspectival tests
  → 241 total.

## 0.4.2 (2026-05-11) — Integrated R10b Reproduction

Reproduces the central FCE-Ω event end-to-end inside the integrated
runtime: a coherent committed sequence on a single semantic center
drives S_t above theta_s for tau_coag consecutive cycles, and the
observer's `check_coagulation` flips `Ω=1` **by rule**, not by
manual injection.

Under the realistic thresholds picked in this release (`theta_s=0.10`,
`tau_coag=3`, `D=16`, `seed=42`), the `phoenix::identity` center
coagulates at episode 3 / cycle 3 with `S_t=0.1023`, `κ=0.458`,
`AR=0.677`. The agent's classification at coagulation is
`integrative` (κ_coag ≥ 0.40 per Agent.sine_type).

After coagulation, an 8-cycle disputed perturbation phase drives S_t
from 0.026 down to 0.003 and AR from 0.56 to 0.32, while:

  - `Ω` remains 1 (irreversibility);
  - `omega_id`, `coagulated_at_episode`, `S_t_at_coagulation`,
    `kappa_at_coagulation` are immutable in the OmegaRecord;
  - the runtime adapter's `slot_event_log` continues to report
    `zone_after=DISPUTED` for the last write (truth status preserved);
  - `source_episodes` and `source_events` provenance are complete;
  - persist / load roundtrip preserves the OmegaRecord.

### Added

- `experiments/r10b_integrated_phoenix.py` — driveable R10b experiment
  that emits `results/etapa_02_v0_4_2_r10b_integrated/r10b_trajectory.{json,txt}`
  (full cycle-by-cycle trajectory of S_t / AR / κ / Z / Omega across
  germinal + perturbation phases, plus the post-experiment invariant
  flags).
- `experiments/__init__.py` so the experiment module is importable
  from tests.
- `tests/fce_omega_functional/test_17_r10b_integrated_reproduction.py`
  — 9 functional tests pinning the contract:
  - Omega emerges from `check_coagulation`, not from a synthetic
    `agent.Omega = 1` flip nor a direct `registry.register` call;
  - thresholds are realistic (theta_s ≥ 0.05, tau_coag ≥ 2);
  - S_t / AR / κ at coagulation are meaningful (S_t crosses θ, AR > 0.5);
  - irreversibility after disputed perturbation;
  - runtime log zone preserved as DISPUTED;
  - provenance complete (source_episodes + source_events);
  - persist / load roundtrip preserves Omega;
  - artifact files written to disk;
  - no auto-coagulation on other centers.

### Changed

- `CHANGELOG.md` status block bumped to v0.4.2; verdict updated to
  reflect that integrated coagulation is now demonstrated, not just
  observed.

### Invariants preserved (mission §6)

- Omega is produced by the threshold rule, never set manually.
- D_Cortex / runtime stays the truth authority — disputed writes
  remain disputed in `slot_event_log` even when the same center has
  Ω=1.
- Advisory channel still read-only; observer still passive.
- All 222 v0.4.1 tests still PASS; +9 new R10b tests → 231 total.

## 0.4.1 (2026-05-11) — Center-Isolated Anchor

Closes the v0.4.0 limitation where the FCE-Ω observer derived a single
GLOBAL anchor scalar from the runtime adapter's aggregate metrics —
disputed writes on center B leaked into disrupt_eff for center A. With
v0.4.1, the observer maintains per-center zone counts and computes
anchor strictly from that center's own history.

### Added

- `unified_fragmergent_memory.bridges.fce_translator.anchor_from_center_counts(committed, provisional, disputed) -> float`
  per-center anchor primitive
- `FCEOmegaObserver._center_zone_counts: Dict[str, Dict[str, int]]`
  per-center COMMITTED / PROVISIONAL / DISPUTED / NONE counters
- `metrics_snapshot()["fce_omega"]["center_zone_counts"]` and
  `["center_anchors"]` for inspection
- `center_state()` now returns `zone_counts` and `anchor`
- `persist()` / `load()` roundtrip zone counts; payload `version` bumped
  to `v0.4.1`; loader treats zone counts as optional so v0.4.0 payloads
  still resume (with empty counters)
- `tests/fce_omega_functional/test_16_center_isolated_anchor.py`: 8
  functional tests for the isolation contract (disputed-on-B does not
  touch A, per-center anchor monotone, two-center bitwise isolation,
  Omega-on-A does not seed B mass, metrics snapshot shape,
  persist/load roundtrip, backward-compat global helper still exists)

### Changed

- `FCEOmegaObserver.observe_after_consolidate` now updates per-center
  zone counters from each observation and passes a per-center anchor to
  `Agent.step(anchor=...)`; the global `anchor_from_runtime_snapshot`
  is no longer routed through, although it is still exported for
  backward-compat callers
- `tests/fce_omega_functional/test_09_directed_interaction.py::test_observer_centers_are_isolated_in_v0_4_0`:
  assertion strengthened from `< 5% relative` to bitwise equality on
  kappa and Z_norm
- `tests/fce_omega_functional/test_10_coagulated_reference_field.py::test_anchor_grows_with_committed_count`:
  rewritten to drive committed mass on the SAME center and assert
  growth; new `test_anchor_isolated_to_own_center` ensures other-center
  committed mass does NOT move this center's anchor
- `tests/fce_omega_functional/test_12_persistence_reload.py::test_persisted_payload_is_json_inspectable`:
  accepts both `v0.4.0` and `v0.4.1` payload versions

### Invariants preserved (mission §6)

- FCE-Ω still observes, never decides truth
- Omega Registry still ireversibil; coagulation events immutable
- Advisory channel still read-only (no UFME write-back)
- Runtime adapter state still unchanged by observer activity
- All 213 v0.4.0 tests still PASS; +9 new tests (1 in test_10 +
  8 in test_16) → 222 total

## 0.3.3 (2026-05-07)

Async cross-substrate cycle. Decouples the four phases of the cycle
(perceive, consolidate, propagate, reconstruct, apply) so they no
longer run 1:1:1 per episode. Pressure produced by a consolidation
tick is queued, applied at a later episode (with explicit delay), and
expired if it ages past max_age without application.

### Added

- `runtime.async_orchestrator.AsyncSchedule` dataclass: three knobs
  (consolidate_every_n_episodes, apply_pressure_delay_episodes,
  stale_pressure_max_age_episodes) plus is_consolidate_episode helper
  and validate.
- `runtime.async_orchestrator.PendingPressure` dataclass: a pressure
  object queued for delayed application with full provenance
  (pressure_id, produced_at_episode, earliest_apply_at, expires_at,
  target_slots, consolidation_record_ids, pressure_vectors_summary,
  auto_registration_ids, applied_at_episode, expired,
  expired_at_episode, delay_steps property).
- `runtime.async_orchestrator.AsyncProvenanceChain` dataclass with
  delay metadata (queued_at_episode, applied_at_episode, delay_steps,
  expired) extending the v0.3.0 ProvenanceChain.
- `runtime.async_orchestrator.AsyncOrchestratorOrganismDriven` subclass
  of OrchestratorOrganismDriven adding run_async(scenario, schedule,
  ...) method. Phase order per episode:
    1. Apply due, non-stale pressures (FIFO, slot-safe).
    2. Mirror priming + organism perceive(s) + auto-register.
    3. End_episode.
    4. If schedule.is_consolidate_episode(ep), run cross-substrate
       cycle and queue pressure as PendingPressure (NOT applied
       immediately).
    5. Expire stale pressures (produced_at + max_age < ep).
- `runtime.async_orchestrator.AsyncEpisodeRecord` extends EpisodeRecord
  with applied_pressure_ids, expired_pressure_ids,
  consolidation_fired_this_episode, pending_pressure_count.
- `runtime.async_orchestrator.run_async_coupling_demo()`: 5-episode
  scenario with consolidate_every_n=1, apply_delay=1, max_age=10.
  Demonstrates pressure produced at ep3 applied at ep4 (delay=1).
- `tests/async_coupling/test_async.py`: 14 tests covering 6 mandatory
  scenarios + safety + provenance + sync regression + R1.
- reproduce.sh extended with PHASE 4 step 9 (async demo).

### Verdict

**ASYNC BRANCH-LEVEL COGNITIVE COUPLING CONFIRMED**.

The async demo with apply_pressure_delay_episodes=1 produces the
v0.3.1 branch flip at ep4 via queued pressure delivered after a
1-episode delay, and a downstream effect at ep5 (slot persists in
DISPUTED, REINFORCE_COMMITTED_UNDER_DISPUTE under continuing pressure):

  ep4 OFF: NOOP, IDEMPOTENT, COMMITTED, COMMIT_DONE
  ep4 ON:  MARK_DISPUTED_LATENT_RETROGRADE, LATENT_RETROGRADE_PRESSURE_ON_IDEMPOTENT,
           DISPUTED, DISPUTED_STORED, latent_retrograde_pressure
  ep5 OFF: NOOP, IDEMPOTENT, COMMITTED
  ep5 ON:  REINFORCE_COMMITTED_UNDER_DISPUTE, DISPUTED,
           latent_retrograde_pressure (from ep4-applied pressure)

Two pending pressures applied with delay_steps=1 each:
  pressure_id=dd2dbcd4f6b756c2 produced=3 applied=4 (delay 1)
  pressure_id=4e467ca3111b457b produced=4 applied=5 (delay 1)

### Async safety

  wrong_commit=0
  false_promote=0
  false_retrograde=0
  query_override=0
  entity_leakage=0
  attr_leakage=0
  stale_pressure_applied=0   (defense in depth: stale never installs)
  wrong_slot_pressure_applied=0   (target_slots tracking)

### Async provenance chain

PendingPressure carries: pressure_id (deterministic SHA256 prefix),
produced_at_episode, earliest_apply_at, expires_at, target_slots,
consolidation_record_ids, pressure_vectors_summary, auto_registration_ids,
applied_at_episode, expired, expired_at_episode, delay_steps. The chain
is reconstructible from these plus the orchestrator's audit logs.

### Sync recovery

AsyncSchedule(1, 0, 5) reproduces v0.3.2 behavior. Test
`test_sync_recovered_with_default_schedule` confirms branch flip at
ep4 with the default schedule.

### Six scenarios validated

  1. delayed consolidation: consolidate_every_n=2 fires on ep2/ep4 only
  2. delayed propagation: pressure not lost when consolidation late
  3. delayed pressure application: apply_delay=2 enforced
  4. multiple pending pressures: two slots, slot-safe distinct queues
  5. stale pressure expiry: max_age=2 forces expiry, not applied
  6. branch or marker effect: branch flip confirmed in demo

140/140 pytest passing (126 v0.3.2 + 14 v0.3.3 async). R1: 6 source
SHA256 byte-identical. Strictly additive over v0.3.2.

## 0.3.2 (2026-05-07)

Bidirectional auto-registration / self-registering substrate coupling.
A new symbolic slot observed via Organism.perceive() is auto-registered
as a tf label without manual mapping. The natural cycle then targets
the auto-allocated label with pressure vectors, propagation runs, and
reconstructed pressure flows back to the same symbolic slot, completing
the lifecycle without any pre-declared registry.

### Added

- `runtime.organism_driven.AutoRegistration` dataclass: provenance
  metadata per auto-registered slot. Carries entity_id, attr_type,
  label, organism_trace_id (the trace that triggered registration),
  episode_id, write_step, auto_registration_id (SHA256 prefix from
  slot+trace+episode), epistemic_status, memory_target_zone.
  JSON-serializable via to_json_safe / from_json_safe.
- `TraceSummary.slot_entity` / `TraceSummary.slot_attr`: extracted from
  the arbiter's last decision (or fallback to head_entity + first
  value_candidate.family) so auto-registration has a deterministic
  (entity, attr) pair per trace.
- `UnifiedMemoryStore.auto_register_from_trace(trace_summary, episode_id)`:
  validation + registration entry point. Rejects (returns None) when:
    1. trace.intent != 'WRITE'
    2. slot_entity or slot_attr missing
    3. epistemic_status in {PARSER_FAILURE, PARSE_UNCERTAIN, REJECTED}
    4. memory_target_zone is None or 'NONE'
  Otherwise registers (idempotent), assigns label, stores AutoRegistration.
- `UnifiedMemoryStore.lookup_slot_by_label(label)`: reverse lookup
  (tf label -> slot tuple). Bidirectional contract.
- `UnifiedMemoryStore.persist_auto_registrations(path)` and
  `load_auto_registrations(path)`: JSON-safe round-trip persistence.
  load_auto_registrations also rebuilds the forward registry from the
  loaded records so the store is consistent on reload.
- `UnifiedMemoryStore.auto_registrations_snapshot()`: JSON-safe list of
  all current registrations.
- `OrchestratorOrganismDriven.run`: after each Organism.perceive(),
  calls store.auto_register_from_trace on the trace summary when
  coupling=True and pressure_provider is None. Auto-registration
  metadata is recorded per episode in EpisodeRecord.auto_registrations.
- `EpisodeRecord.auto_registrations: List[Dict[str, Any]]`: per-episode
  list of auto-registration JSON snapshots.
- `runtime.run_auto_registration_demo()`: v0.3.2 main demo. NO slot is
  pre-registered; the orchestrator's perceive loop auto-registers
  (dragon, color) -> label 0 from the first valid COMMIT trace.
  Mirror priming with "blue" challengers triggers RECONCILE+RETROGRADE
  on the auto-registered label at end of ep3. Pressure produced flows
  back to the same symbolic slot. ep4 idempotent re-affirmation hits
  the v0.3.1 LATENT_RETROGRADE_PRESSURE_ON_IDEMPOTENT branch.
- `tests/auto_registration/test_auto_registration.py`: 14 tests covering
  the 8 mandatory + 6 supplementary cases:
    1. test_auto_registers_slot_after_first_valid_commit
    2. test_auto_registered_label_round_trip
    3. test_no_registration_on_parser_failure_or_uncertain (5 invalid cases)
    4. test_auto_registered_slot_receives_pressure_vector
    5. test_auto_registered_pressure_returns_to_symbolic_slot
    6. test_auto_registration_can_participate_in_branch_flip_or_marker_diff
    7. test_safety_metrics_zero_under_auto_registration
    8. test_auto_registration_does_not_mutate_source_files
    plus: provenance_chain_includes_auto_reg, persistence_round_trip,
    idempotent_for_repeated_trace, v0.3.1_regression,
    bidirectional_round_trip_verified, registry_grows_only_through_auto.
- reproduce.sh extended with PHASE 4 step 8 (auto-registration demo).

### Verdict

**AUTO-REGISTRATION BRANCH-LEVEL CONFIRMED**.

Concrete observable lifecycle without any manual registration:

  registry_before:  {} (empty)
  ep1 perceive:     "the dragon is red" -> COMMIT
                    auto_register_from_trace -> slot (dragon, color)
                    assigned label 0
  registry_after:   {('dragon', 'color'): 0}
  ep2/ep3 priming:  external "blue" challengers added to mirror only
                    (organism continues perceiving "the dragon is red")
  end ep3:          consolidator fires RECONCILE+RETROGRADE on the
                    auto-registered label
                    SlotPressureVector list with provenance back to
                    auto_registration_id
                    pressure.retrograde_slots[(dragon, color)] = "red"
  ep4 perceive:     idempotent re-affirmation; CommitArbiter Pas 5
                    branch fires
  diff at ep4:      arbiter_decision NOOP -> MARK_DISPUTED_LATENT_RETROGRADE
                    zone COMMITTED -> DISPUTED
                    status COMMIT_DONE -> DISPUTED_STORED
                    marker None -> LATENT_RETROGRADE_PRESSURE
                    influence_effect [] -> [latent_retrograde_pressure]

Bidirectional round-trip verified: registry_after maps (dragon, color)
-> 0; lookup_slot_by_label(0) returns ("dragon", "color"). Provenance:
auto_registration_id 16-char SHA256 prefix from
hash(slot+label+trace_id+episode); organism_trace_id traces back to
Organism.trace_log; episode_id and write_step pinpoint when the slot
entered the registry.

### Validation rules enforced (v0.3.2 spec rules 1..6)

  Rule 1 (only valid slots): test_no_registration_on_parser_failure_or_uncertain
  Rule 2 (no parser failure): same test, PARSER_FAILURE branch
  Rule 3 (no uncertain without provenance): same test, PARSE_UNCERTAIN branch
  Rule 4 (bidirectional mapping): test_auto_registered_label_round_trip
  Rule 5 (persistent JSON-safe): test_auto_registration_persistence_round_trip
  Rule 6 (no entity/attr leakage): test_safety_metrics_zero_under_auto_registration

### Safety table

  wrong_commit=0, false_promote=0, false_retrograde=0,
  query_override=0, entity_leakage=0, attr_leakage=0

### R1

6 watched source files SHA256 byte-identical before/after demo.
Verified by test_auto_registration_does_not_mutate_source_files.

### Tests

126/126 pytest passing (112 v0.3.1 + 14 v0.3.2 auto_registration).

## 0.3.1 (2026-05-07)

Natural pressure calibration. v0.3.0 confirmed natural cognitive coupling
at the marker level; v0.3.1 demonstrates a natural arbiter-decision
branch flip (not just marker change), with provenance traceable end to
end and no synthetic helper used.

### Added

- `OrchestratorOrganismDriven.run(... mirror_priming=...)`: optional
  per-episode list of slot_event dicts written directly to the
  cross-substrate store, BEFORE the Organism perceives. This decouples
  the mirror's state from the Organism's state so the mirror can see
  external context (challengers, alternative writes from peer agents,
  etc.) the Organism is not directly exposed to. The organism's slot
  can stay in the COMMITTED zone while the mirror accumulates
  challengers and the natural cycle produces retrograde pressure for
  the next episode.
- `runtime.run_natural_branch_flip_demo()`: v0.3.1 main demo. Uses
  mirror_priming to feed external "blue" challengers at ep2 and ep3
  while the Organism only ever perceives "the dragon is red". Natural
  cycle at end of ep3 produces RETROGRADE pressure on (dragon, color).
  At ep4 the pressure is installed; CommitArbiter's Pas 5 branch
  fires; arbiter_decision flips from NOOP to
  MARK_DISPUTED_LATENT_RETROGRADE.
- `tests/natural_branch_flip/test_branch_flip.py`: 10 tests covering
  arbiter_decision flip assertion, zone+status alignment with the flip,
  influence_effect channel emission, no-synthetic inspection check,
  provenance chain at branch level, RETROGRADE in chain's record IDs,
  safety table all-zero, marker-only-not-sufficient distinguishing,
  R1 source mtime invariance, default-factor calibration confirmation.
- reproduce.sh extended with PHASE 4 step 7 demonstrating the natural
  branch-flip cycle.

### Verdict

**NATURAL BRANCH-LEVEL COGNITIVE COUPLING CONFIRMED**.

Concrete observable diff at ep4 input "the dragon is red":
  coupling=OFF: arbiter_decision=NOOP, reason=IDEMPOTENT,
                memory_target_zone=COMMITTED,
                epistemic_status=COMMIT_DONE,
                latent_pressure_marker=None,
                influence_effect_channels=[]
  coupling=ON:  arbiter_decision=MARK_DISPUTED_LATENT_RETROGRADE,
                reason=LATENT_RETROGRADE_PRESSURE_ON_IDEMPOTENT,
                memory_target_zone=DISPUTED,
                epistemic_status=DISPUTED_STORED,
                latent_pressure_marker=LATENT_RETROGRADE_PRESSURE,
                influence_effect_channels=[latent_retrograde_pressure]

Pressure produced naturally by:
  ep2/ep3 priming: mirror writes for "blue" disputed challenger
  end ep3: consolidator fires RECONCILE+RETROGRADE on (dragon, color)
  consolidation_to_pressure_vectors: emits SlotPressureVector list with
    OPERATION_RETROGRADE on slot, factor=0.5, direction=ATTENUATE,
    provenance_id="3::RETROGRADE::dragon::color"
  apply_pressure_vectors_to_bank: derived bank with attenuated MI on label 0
  propagate(method='mi'): tf propagation on derived bank
  audit_and_tf_to_signals: signals.retrograde_candidate[(dragon, color)] = 0
    (adapter v_idx of "red")
  receptor.update_from_signals: pressure.retrograde_slots[(dragon, color)] = "red"
  organism.current_latent_pressure = pressure (installed before ep4)
  organism.perceive("the dragon is red"): trace.latent_decision_pressure
    populated, CommitArbiter branch 1697 fires.

### Factor calibration L1-L5

Sweep across PROMOTE in {1.5, 2.0, 3.0}, RETROGRADE in {0.5, 0.25, 0.1},
PRUNE_MASK in {0.0, 0.01}, method in {mi, softmax}. All 36 combinations
produce the branch flip in the engineered scenario; the v0.3.0 defaults
(PROMOTE=1.5, RETROGRADE=0.5, PRUNE_MASK=0.0) are RETAINED as the
minimum-perturbation choice with the smallest deviation from the sealed
neutral baseline.

L1-L5 family op counts (from sealed v15_7a_selfcheck EXPECTED_PER_FAMILY,
unchanged by cross-substrate cycle):

| Family | RECONCILE | PRUNE | RETROGRADE | PROMOTE | Description |
|---|---|---|---|---|---|
| L1 promote_cycle | 1 | 0 | 1 | 1 | commit, dispute, retro, distractor, promote |
| L2 retrograde_only | 1 | 0 | 1 | 0 | retro without subsequent promote |
| L3 completion | 0 | 0 | 0 | 0 | three different attrs, no conflict (no-op) |
| L4 no_inflation | 1 | 0 | 0 | 0 | three writes same episode, anti-inflation |
| L5 stale_prune | 1 | 2 | 0 | 0 | conflict then K=3 silent episodes |

Sealed v15_7a_selfcheck.main() rc=0 (gates 3..9 all green) under the
chosen factors, verified by test_core_v15_7a_still_sealed (still
passing in v0.3.1).

### Safety table (under natural branch flip)

  wrong_commit=0, false_promote=0, false_retrograde=0,
  query_override=0, entity_leakage=0, attr_leakage=0

The MARK_DISPUTED_LATENT_RETROGRADE decision is the intended Pas 5
escalation, NOT a wrong_commit (the committed value is preserved
unchanged; only the slot zone goes COMMITTED -> DISPUTED, which is the
canonical "longitudinal-memory drives decision" pathway).

### Provenance chain at branch level

  source_symbolic_trace_id    -> Organism trace at ep4
  consolidation_record_ids    -> ep3::RECONCILE::dragon::color,
                                 ep3::RETROGRADE::dragon::color
  vector_perturbation_ids     -> deterministic SHA256 prefixes
  tf_propagation_id           -> hash(bank perturbation, ep)
  reconstructed_pressure_id   -> hash(pressure summary)
  organism_trace_id_off / on  -> the diffing trace pair
  decision_diff_id            -> hash(diff fields)

ProvenanceChain.is_complete() == True. All 7 IDs populated.
chain.decision_diff_fields includes arbiter_decision (the flip).

### R1

6 watched source files SHA256 byte-identical before/after the branch-
flip demo. Verified by test_natural_branch_flip_does_not_mutate_source_files.

### Tests

112/112 pytest passing (102 v0.3.0 + 10 new branch-flip).

## 0.3.0 (2026-05-07)

Natural cross-substrate pressure. v0.2.1 confirmed cognitive coupling at
the arbiter-decision level using a synthetic pressure helper. v0.3.0
demotes the synthetic helper to test scaffolding only and demonstrates
that pressure produced by the FULL natural cycle modifies a symbolic
decision in the Organism, with full provenance reconstructible end to end.

### Added

- `bridges/cross_substrate_pressure.SlotPressureVector`: dataclass
  replacing the scalar perturbation dict as the primary representation.
  Carries (entity_id, attr_type, operation_type, value_idx, confidence,
  provenance_id, direction, factor). JSON-serializable via to_json_safe
  / from_json_safe. operation_type in {PROMOTE, RETROGRADE, PRUNE,
  RECONCILE, PERSISTENT_CONFLICT}; direction in {AMPLIFY, ATTENUATE,
  MASK, NEUTRAL}.
- `consolidation_to_pressure_vectors(audit, episode, registry, ...)`:
  emits one SlotPressureVector per (op, slot) with full provenance.
  Order PRUNE -> RETROGRADE -> RECONCILE -> PROMOTE preserved.
- `pressure_vectors_to_perturbation_dict`: derives the v0.2.0 scalar
  factor dict from vectors for backward compatibility.
- `apply_pressure_vectors_to_bank`: vector form of the parametric
  perturbation, no source mutation, returns derived bank.
- `audit_and_tf_to_signals(audit, episode, registry, prop_result,
  triggered_by_idempotent_step)`: v0.3.0 canonical natural-pressure
  builder. Replaces v0.2.0 `tf_result_to_synthetic_signals` as the
  primary signal builder used inside `cross_substrate_step`. Semantic
  correction over v0.2.0: pressure value_idx values are in the runtime
  adapter's namespace (not tf engine label namespace), so the receptor
  resolves to the correct value_str. v0.2.0 builder retained as
  fallback for callers that want only the tf side.
- `Config.cross_substrate_propagation_method` (default "softmax",
  override "mi"): chooses the propagation method used by
  `cross_substrate_step` so MI perturbations can flip predict_label
  when method='mi'.
- `runtime/organism_driven.ProvenanceChain` dataclass with seven IDs
  per spec: source_symbolic_trace_id, consolidation_record_ids,
  vector_perturbation_ids, tf_propagation_id, reconstructed_pressure_id,
  organism_trace_id_off, organism_trace_id_on, decision_diff_id.
  to_json_safe + is_complete methods.
- `build_provenance_chain(report_off, report_on, diff)`: constructs the
  ProvenanceChain from an A/B comparison run.
- `OrchestratorOrganismDriven` smart-mirror: tracks per-slot last
  committed value in a private dict and decides zone_after based on
  whether the slot was already committed with a different value
  (committed -> committed for idempotent, committed -> disputed for
  challenger). Matches the Organism's projection so the mirror store
  accumulates challengers consistently with the Organism's view.
- `run_natural_coupling_demo()`: v0.3.0 main demo. Five-episode L1-style
  scenario, propagation method='mi', no synthetic pressure helper.
  Pressure produced by the full cycle modifies the trace's
  latent_pressure_marker at episodes ep4 and ep5 (LATENT_RETROGRADE_PRESSURE
  then LATENT_PROMOTE_PRESSURE).
- `tests/natural_coupling/test_natural_pressure.py`: 14 tests covering
  vector serialization, vector-to-dict composition, parametric
  no-mutation, audit-derived value_idx semantics (regression test for
  the `0 or -1` falsy bug), natural A/B coupling without synthetic
  helper, no-synthetic-import inspection check, safety table all-zero,
  provenance chain completeness, source-file SHA256 invariance under
  natural coupling, v0.2.1 synthetic demo regression, vector
  provenance presence in CrossSubstrateRecord.
- reproduce.sh extended with PHASE 4 step 6 demonstrating the natural
  coupling cycle.

### Verdict

**NATURAL COGNITIVE COUPLING CONFIRMED**. Decision-field diff observed
between coupling=OFF and coupling=ON without any synthetic helper:

  ep4 input "the dragon is blue" (organic challenger reaffirmation):
    coupling=OFF: latent_pressure_marker=None, pressure_was_active=False
    coupling=ON:  latent_pressure_marker=LATENT_RETROGRADE_PRESSURE,
                  pressure_was_active=True

  ep5 input "the dragon is blue" (consolidator promotes via SelfObserver
  pathway in both runs; pressure adds the latent annotation in ON):
    coupling=OFF: latent_pressure_marker=None
    coupling=ON:  latent_pressure_marker=LATENT_PROMOTE_PRESSURE

Both diffs are in the spec-permitted set (latent_pressure_marker is
explicitly listed). Natural pressure was produced from real
consolidator audit ops (RECONCILE+RETROGRADE at ep3, RECONCILE+PROMOTE
at ep4) plus tf_engine MI-method propagation perturbed by the audit-
derived SlotPressureVector list.

The arbiter_decision branch (REINFORCE_CHALLENGER -> CONSOLIDATION_PROMOTED)
converges between OFF and ON because SelfObserver organically reinforces
across episodes 3-5. The synthetic-pressure demo from v0.2.1
(test scaffolding) still demonstrates the stronger NOOP -> MARK_DISPUTED
arbiter-branch flip; both are tested (separate paths, both passing).

Provenance chain end to end:
  source_symbolic_trace_id (Organism trace)
    -> consolidation_record_ids (audit ep::op::ent::attr)
    -> vector_perturbation_ids (SlotPressureVector.provenance_id)
    -> tf_propagation_id (hash of bank+perturbation+episode)
    -> reconstructed_pressure_id (hash of pressure summary)
    -> organism_trace_id_on (the diffing trace)
    -> decision_diff_id (hash of diffing fields)

Safety table: wrong_commit=0, false_promote=0, false_retrograde=0,
query_override=0, entity_leakage=0, attr_leakage=0.

R1: 6 watched source files (MISIUNEA.txt, code.py, ignition_build_v0.py,
v15_7a_core.py, adapter.py, receptor.py) byte-identical SHA256 verified
before and after the natural demo.

102/102 pytest passing (88 prior + 14 natural coupling). Strictly
additive over v0.2.1.

### Bug fixed

- `audit_and_tf_to_signals`: `int(getattr(r, 'value_idx', -1) or -1)`
  was converting v_idx=0 to -1 because `0 or -1` is falsy in Python.
  This silently dropped the v_idx of the demoted/promoted value when
  it happened to be 0 (the first interned value, often the committed
  value). Replaced with explicit None check
  `int(raw_v) if raw_v is not None else -1`. Regression test
  `test_audit_and_tf_to_signals_preserves_v_idx_zero`.

## 0.2.1 (2026-05-06)

Pas 5+: Organism-driven cross-substrate coupling. v0.2.0 was structural
coupling only; v0.2.1 closes the cognitive gap. Pressure derived from the
cross-substrate cycle (or synthesized for unit tests) is installed into
Organism.current_latent_pressure between episodes, and the runtime
CommitArbiter Pas 5 branch (`ignition_build_v0.py:1697-1731`,
LATENT_RETROGRADE_PRESSURE_ON_IDEMPOTENT) actually fires, changing the
symbolic decision.

### Added

- `runtime/organism_driven.py`: OrchestratorOrganismDriven class that
  instantiates Organism(latent_mode='off'), routes symbolic writes via
  Organism.perceive(), optionally injects pressure between episodes, and
  records full provenance per episode (pressure pre/post, traces, op
  counts, perturbations, pressure_origin).
- TraceSummary dataclass condensing the fields needed for cognitive-
  coupling diff (decision, zone, status, latent_pressure_marker,
  influence_effect_channels, pressure_was_active).
- EpisodeRecord dataclass with full provenance chain per episode.
- OrganismDrivenReport dataclass for A/B comparisons.
- diff_reports(report_off, report_on) function: diffs decision fields per
  trace and returns a structured difference summary. Used by all
  comparison tests.
- build_synthetic_retrograde_pressure(slot_key, challenger_value,
  confidence) helper: constructs a runtime LatentDecisionPressure with
  retrograde_slots populated. Used by tests that want to demonstrate the
  decision branch without engineering a full natural-cycle scenario.
- run_organism_driven_demo() public entry point: runs an L1-style
  scenario (commit ep1, idempotent re-affirmation ep2 with synthetic
  retrograde pressure injected) and returns both reports plus diff.
- tests/organism_driven/test_cognitive_coupling.py: 5 mandatory tests
  per v0.2.1 spec plus 3 supplemental sanity tests:
    1. test_pressure_changes_subsequent_commit_decision (CONFIRMS
       cognitive coupling: NOOP vs MARK_DISPUTED_LATENT_RETROGRADE on
       ep2 idempotent re-affirmation).
    2. test_no_symbolic_safety_regression_with_coupling (wrong_commit=0,
       false_promote=0, false_retrograde=0, query_override=0,
       entity_leakage=0, attr_leakage=0).
    3. test_core_v15_7a_still_sealed (invokes runtime
       d_cortex.v15_7a_selfcheck.main() in isolation; gates 3..9 PASS).
    4. test_organism_coupling_does_not_mutate_source_files (R1: SHA256
       of 9 source files unchanged before/after demo run).
    5. test_cross_substrate_provenance_chain_decision_level (chain
       reconstructible from pressure_origin -> pressure_pre_install_summary
       -> trace_id -> diff field set).
  Plus: baseline-off NOOP sanity, synthetic-pressure shape compatibility,
  diff_reports identical-runs returns 0.

### Verdict

**COGNITIVE COUPLING CONFIRMED**. Concrete observable difference at ep2
input "the dragon is red":
  - coupling=OFF: arbiter_decision=NOOP, zone=COMMITTED, status=COMMIT_DONE.
  - coupling=ON:  arbiter_decision=MARK_DISPUTED_LATENT_RETROGRADE,
                  zone=DISPUTED, status=DISPUTED_STORED,
                  latent_pressure_marker=LATENT_RETROGRADE_PRESSURE,
                  influence_effect_channel=latent_retrograde_pressure.

Provenance chain end-to-end: synthetic_provider -> pressure_origin tag
-> pressure_pre_install_summary at ep2 -> trace_id E0002_S000001_*** ->
diff_field set.

Safety table: wrong_commit=0, false_promote=0, false_retrograde=0,
query_override=0, entity_leakage=0, attr_leakage=0. Core sealed: gates
3..9 PASS in isolation.

R1, R2, R4, R5, R6, R7 all honored. Source files byte-identical
(SHA256 verified). Strictly additive over v0.2.0.

## 0.2.0 (2026-05-06)

Pas 5: cross-substrate coupling. The three sources can now influence each
other through the facade with provenance preserved end-to-end. First
form of multi-substrat cognition.

### Added

- `bridges/cross_substrate_pressure.py`: three pure translators
  (`consolidation_to_tf_perturbation`, `apply_mi_perturbations_to_bank`,
  `tf_result_to_synthetic_signals`, `pressure_to_query_seed`) plus
  `tag_pressure_origin` / `get_pressure_origin` via
  `weakref.WeakKeyDictionary` (Q2: no id() recycling, dataclass not
  modified).
- `facade/cross_substrate.py`: `CrossSubstrateRecord` (audit dataclass with
  `to_json_safe`) and `cross_substrate_step(store, episode_id)` (pure
  functional, A1 user resolution).
- `runtime/orchestrator.run_with_cross_substrate_coupling` and
  `run_cross_substrate_demo` driving the cycle in a loop (1:1:1 sync per
  Q4).
- `Config.cross_substrate_n_steps`,
  `cross_substrate_promote_amplification` (default 1.5),
  `cross_substrate_retrograde_attenuation` (default 0.5),
  `cross_substrate_prune_mask_value` (default 0.0),
  `cross_substrate_pressure_seed_strength` (default 1.0). Op order
  PRUNE -> RETROGRADE -> RECONCILE (no-op) -> PROMOTE; multiplicative
  composition (A2).
- `UnifiedMemoryStore._label_slot_registry` plus
  `register_label_slot(entity_id, attr_type, label=None)`,
  `persist_label_slot_registry(path)`, `load_label_slot_registry(path)`
  (Q3: registry on store identity, JSON-persisted).
- `UnifiedMemoryStore._cross_substrate_receptor` and
  `_cross_substrate_last_pressure` for next-episode seeding.
- `tests/cross_substrate/`: 23 new tests covering perturbation rules
  (PRUNE/RETROGRADE/RECONCILE/PROMOTE), op order, episode filtering,
  unregistered slot skip, mi perturbation parametric (Q1: original bank
  not mutated), synthetic signals stable / oscillating / idempotent,
  pressure-to-query seed selection, weakref tagging, cycle round trip,
  provenance JSON safety, source-file mtime invariance (R1), end-to-end
  smoke test, perturbation observability, idempotent-step null-effect
  (A3), metrics_snapshot includes cross_substrate block.
- `docs/CROSS_SUBSTRATE.md`: full specification of the cycle, user
  decisions table, perturbation rules, synthetic LatentSignals mapping,
  provenance chain, deferred follow-ups for v0.3.0.
- ARCHITECTURE.md: overlap O12 (cross-substrate coupling) added.
- Updated metrics_snapshot to include `cross_substrate` block
  (registry_size, next_label_id, has_last_pressure,
  receptor_initialized).

### Notes

- v0.2.0 is strictly additive over v0.1.0. The unified API contract for
  v0.1.0 is unchanged. New entry point `cross_substrate_step` is opt-in.
- Pas 5 does not modify any source file (R1) and does not rename any
  primitive (R4). The runtime LatentSignals and LatentDecisionPressure
  dataclasses are constructed (not modified) via the runtime passthrough.
- Async cycle, vector perturbation, bidirectional auto-registration, and
  factor calibration are deferred to v0.3.0.

## 0.1.0 (2026-05-06)

Initial release. Composes three independent source projects into one
installable package without modifying any source.

### Added

- Package skeleton `unified_fragmergent_memory/` with sources passthrough,
  bridges, facade, runtime layers.
- `sources/d_cortex/` path-based access to D_CORTEX_ULTIMATE with sealed
  step 13 SHA256 verification (`f807db34...`).
- `sources/tf_engine/` sys.path extension to extracted fragmergent-tf-engine,
  re-exporting all 23 public symbols of the fragmergent_tf package.
- `sources/memory_engine_runtime/` sys.path extension to
  fragmergent-memory-engine, re-exporting v15_7a_core (reconcile, prune,
  retrograde, promote, run_consolidator_pipeline), DCortexAdapter,
  LatentRationalMemoryReceptor, LatentDecisionPressure, plus a lazy
  ignition_build_v0 proxy.
- `bridges/shape_translators.py` symbolic vs numerical entry detection and
  cross-shape skeleton conversions.
- `bridges/convention_translators.py` slot-key serialization, attribute family
  canonicalization, enum value to string.
- `facade/config.py` Config dataclass with sealed defaults (N_promote=2,
  M_retrograde=2, K_promote_age=2, K_prune_stale=3, alpha=0.3, k_top=5).
- `facade/encoder.py` thin wrappers over tf_engine encoders and symbolic
  attribute slot constructors.
- `facade/scoring.py` softmax, MI, hybrid scoring composing tf_engine
  primitives. Hybrid lambda-mixed score formula matches PAPER.md.
- `facade/propagation.py` propagate (numerical) and consolidate (symbolic)
  routers. Each raises NotImplementedError on unsupported source.
- `facade/memory_store.py` UnifiedMemoryStore with write, read, propagate,
  consolidate, audit_log, metrics_snapshot. Routing per docs/ROUTING.md.
- `runtime/orchestrator.py` end-to-end demonstration touching all three
  sources via the facade.
- `tests/passthrough/` invariant I1 and I3 verifiers for each source.
- `tests/bridges/` shape and convention translator tests.
- `tests/facade/` UnifiedMemoryStore contract tests + orchestrator smoke test.
- `docs/ARCHITECTURE.md` normative architecture spec including 11 cross-project
  overlap resolutions, 33 lower-priority resolved questions, public API
  contract, configuration, dependency policy, test strategy, source-side
  drift documentation, mission level claim, patent and IP resolution.
- `docs/ROUTING.md` routing policy specification with concrete examples per
  shape category and the operation matrix.
- `paper/UNIFIED_PAPER.md` preprint-style document.
- `pyproject.toml` BSD-3-Clause + Patent EP25216372.0 notice;
  numpy/scipy/matplotlib required, torch optional under [d_cortex] extras.
- `reproduce.sh` editable install + test suite + end-to-end demo.

### Notes

- Patent EP25216372.0 referenced; BSD-3-Clause governs the source code.
- No FHRSS-branded naming in the unified package (per memory_engine_runtime
  project's removal from public concept; user decision 2026-05-06).
- The byte-identical sealed file `13_v15_7a_consolidation/code.py` is
  canonically owned by memory_engine_runtime; d_cortex side is a passthrough
  alias (overlap O11; user decision 2026-05-06).
- Routing policy: symbolic entries default to memory_engine_runtime,
  numerical-vector entries default to tf_engine; explicit source= overrides
  (user decision 2026-05-06; CC1 resolution; Option 2 with runtime
  tie-breaker).
