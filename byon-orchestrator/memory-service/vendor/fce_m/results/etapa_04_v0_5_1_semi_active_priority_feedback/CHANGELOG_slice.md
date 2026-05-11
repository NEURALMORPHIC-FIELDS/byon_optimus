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
