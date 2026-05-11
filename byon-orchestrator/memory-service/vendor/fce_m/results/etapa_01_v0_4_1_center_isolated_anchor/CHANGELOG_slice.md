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
