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
