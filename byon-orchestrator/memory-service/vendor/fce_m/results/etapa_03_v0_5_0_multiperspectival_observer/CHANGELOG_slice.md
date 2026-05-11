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
