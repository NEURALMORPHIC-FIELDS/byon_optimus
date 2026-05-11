# Methodology

This document describes WHAT each test category in the FCE-M suite
validates and WHY. Tests are organized along three layers:

- **`tests/`** legacy UFME tests (140 tests, pre-v0.4.0) — preserved
  verbatim; never weakened.
- **`tests/fce_omega/`** v0.4.0 unit tests for the FCE-Ω wrapper +
  registry + bridge + observer basic behavior (20 tests).
- **`tests/fce_omega_functional/`** v0.4.0–v0.6.0 functional battery
  (108 tests across 20 files), one file per validation theme.

## Test category map

### 1. Baseline invariance (FN-01)

[`test_01_baseline_invariance.py`](../tests/fce_omega_functional/test_01_baseline_invariance.py)

> *Enabling the FCE-Ω observer does not change UFME's
> read/write/consolidate/propagate decisions.*

The four asserted equalities:

- `consolidate.ops`, `consolidate.signals_summary` identical on/off.
- `runtime_view(store)` (counters of slot/tension/resolution events,
  audit_log size, last_pipeline_ops, etc.) identical.
- `tf_engine` read results bitwise identical via `numpy.testing.assert_array_equal`.
- `audit_log()` length identical.

The only allowed delta is the additional `fce_omega_report` key in
`consolidate()` return value.

### 2. FCE event translation (FN-02)

[`test_02_event_translation.py`](../tests/fce_omega_functional/test_02_event_translation.py)

> *UFME slot_events / tension_events are translated into FCE-Ω
> observations with the correct zone-driven weights.*

`ZONE_FIELD_WEIGHTS` ordering pinned:
- `COMMITTED.coherence > COMMITTED.residue`
- `DISPUTED.residue > DISPUTED.coherence`
- `committed.residue < provisional.residue < disputed.residue`

`tension_event` → `FCEObservation` with `residue_weight=0.90`,
`coherence_weight=0.15`. `propagate()` on numerical entries does NOT
produce morphogenesis records (only `consolidate()` is the observation
window).

### 3. Residue accumulation (FN-03)

[`test_03_residue_accumulation.py`](../tests/fce_omega_functional/test_03_residue_accumulation.py)

> *Repeated disputed writes grow the residue norm `Z`; a committed
> write does not collapse residue to zero.*

Each disputed event is consolidated on its own episode so the
observer sees the per-event trajectory.

### 4. Assimilation vs residue discrimination (FN-04)

[`test_04_assimilation_vs_residue.py`](../tests/fce_omega_functional/test_04_assimilation_vs_residue.py)

> *A coherent committed sequence assimilates better than a conflicting
> disputed sequence — but on AR / κ axes, not on Z_norm.*

This file pins the methodological correction we discovered: `Z_norm`
alone is misleading because coherent residue sums in one direction
while conflicting residue cancels orthogonally. Discrimination is on
`AR_t` and `κ_t`, with `S_t` as a secondary indicator.

### 5. Omega irreversibility (FN-05)

[`test_05_omega_irreversibility.py`](../tests/fce_omega_functional/test_05_omega_irreversibility.py)

> *Once `Ω = 1`, no subsequent drop in `S_t` flips it back. Expression
> history is append-only.*

Drives R10b-style coagulation, then bombards with disputed events.
Asserts `omega_id` / `coagulated_at_episode` / `S_t_at_coagulation`
immutable. The `expression_history` field grows monotonically.

### 6. Omega is not truth (FN-06)

[`test_06_omega_not_truth.py`](../tests/fce_omega_functional/test_06_omega_not_truth.py)

> *A coagulated Omega does not override a disputed runtime decision.*

After coagulation, a disputed write on the same slot still lands in
`slot_event_log` with `zone_after = DISPUTED`. The registry refuses
to invent records via expression transitions on phantom centers, and
rejects unknown expression states.

### 7. Advisory channel (FN-07)

[`test_07_advisory_channel.py`](../tests/fce_omega_functional/test_07_advisory_channel.py)

> *`advisory_hints()` has zero side effects. The schema is inspectable
> and stable.*

Advisory state before/after calling `advisory_hints()` repeatedly:
runtime_view, morphogenesis_log, omega_registry — all byte-equal.

### 8. Multiperspectival normalization (FN-08)

[`test_08_multiperspectival_normalization.py`](../tests/fce_omega_functional/test_08_multiperspectival_normalization.py)

> *Number of active centers `N` does not blow up per-center quantities.*

Tests N=1,4,8,16 and asserts the per-center mean `delta_X` and max `Z`
stay bounded as N grows. Confirms the v0.4.1 per-center isolation:
centers with different histories produce distinct AR / κ.

### 9. Directed interaction asymmetry (FN-09)

[`test_09_directed_interaction.py`](../tests/fce_omega_functional/test_09_directed_interaction.py)

> *Vendor primitives are directional; observer per-center state is
> bitwise isolated when centers do not co-act.*

Interference is exactly antisymmetric (`K_ij = -K_ji`). Absorption is
asymmetric under unequal capacities. Repulsion depends on receiver
projector. With v0.4.1 anchor isolation, solo-A and mixed-A-with-B
runs produce bit-equal `A.kappa` and `A.Z_norm`.

### 10. Coagulated reference field (FN-10)

[`test_10_coagulated_reference_field.py`](../tests/fce_omega_functional/test_10_coagulated_reference_field.py)

> *Coagulation does not auto-coagulate other centers. Per-center
> anchor grows only with own committed mass.*

A single disputed event on a fresh center cannot inherit Omega from
a coagulated neighbor under realistic thresholds.

### 11. Provenance chain (FN-11)

[`test_11_provenance_chain.py`](../tests/fce_omega_functional/test_11_provenance_chain.py)

> *Every OmegaRecord and morphogenesis row traces back to a runtime
> slot_event / tension_event.*

`OmegaRecord.source_episodes` is a subset of the episodes that fed
coagulation. `source_events` contains the small breadcrumb dicts
emitted by the bridge. `tf_engine` propagation does NOT inject
phantom provenance.

### 12. Persistence / reload (FN-12)

[`test_12_persistence_reload.py`](../tests/fce_omega_functional/test_12_persistence_reload.py)

> *Observer state survives persist/load; Omega irreversibility
> survives reload.*

Accepts payload versions v0.4.0 through v0.6.0; older payloads load
with newer fields empty (backward-compat). JSON-inspectable.

### 13. Vendor integrity (FN-13)

[`test_13_vendor_integrity.py`](../tests/fce_omega_functional/test_13_vendor_integrity.py)

> *`vendor/fce_omega_source/` resolves via relative path. No nested
> redundant folders, no stale egg-info, no legacy top-level project
> folders.*

Confirms the integrated workspace layout is preserved.

### 14. Reproduce.sh smoke (FN-14)

[`test_14_reproduce_script.py`](../tests/fce_omega_functional/test_14_reproduce_script.py)

> *`reproduce.sh` exists, parses as valid bash, names entry points
> that the package actually exports.*

Bit-rot guard.

### 15. Functional report generation (FN-15)

[`test_15_functional_report.py`](../tests/fce_omega_functional/test_15_functional_report.py)

> *`tools/fce_functional_report.py` runs end-to-end and emits report
> files with all required capability flags.*

### 16. Center-isolated anchor (FN-16, v0.4.1)

[`test_16_center_isolated_anchor.py`](../tests/fce_omega_functional/test_16_center_isolated_anchor.py)

> *Anchor is per-center; disputed writes on B do not move A's anchor;
> persist/load roundtrips per-center zone counts.*

Closes the v0.4.0 global-anchor coupling channel. Two-center
trajectories now bit-equal under non-coactive interleaving.

### 17. Integrated R10b reproduction (FN-17, v0.4.2)

[`test_17_r10b_integrated_reproduction.py`](../tests/fce_omega_functional/test_17_r10b_integrated_reproduction.py)

> *Omega `phoenix::identity` is produced inside the integrated runtime
> by the threshold rule, not by manual injection.*

Realistic thresholds (`θ_s = 0.10`, `τ_coag = 3`). Coagulation at
ep 3 / cycle 3, `S_t = 0.10227`, `κ = 0.458`, `AR = 0.677`, sine_type
`integrative`. After perturbation, `Ω` immutable and `slot_event_log`
preserved.

### 18. Multiperspectival observer (FN-18, v0.5.0)

[`test_18_multiperspectival_observer.py`](../tests/fce_omega_functional/test_18_multiperspectival_observer.py)

> *Directional inter-center interactions wired in the runtime, not
> just in vendor.*

`I_{i←j} ≠ I_{j←i}`. Interference antisymmetry residual < 1e-12.
Class-wise normalization keeps total directional norm bounded across
N=1,4,8,16. RelationCandidate emitted but does not flip Omega.
Passive invariance vs OFF mode holds.

### 19. Semi-active advisory (FN-19, v0.5.1)

[`test_19_semi_active_advisory.py`](../tests/fce_omega_functional/test_19_semi_active_advisory.py)

> *`priority_only` emits bounded `FCEAdvisoryFeedback` with full
> provenance; never modifies UFME or OmegaRegistry.*

Strongest invariant: OmegaRegistry byte-equal between `read_only` and
`priority_only` on the same input.

### 20. Native memory: ReferenceField (FN-20, v0.6.0)

[`test_20_reference_field_native_memory.py`](../tests/fce_omega_functional/test_20_reference_field_native_memory.py)

> *RF created only from OmegaRecord; OmegaRecord immutable through
> any RF activity; centers without Omega cannot enter the Omega-field.*

Includes the inter-RF interaction trace (`OmegaFieldInteraction`) for
co-active pairs and the bounded strength / expression_state updates.

## Test discipline rules

Encoded in [`docs/EVOLUTION_PROTOCOL.md`](EVOLUTION_PROTOCOL.md), but
worth restating here:

1. **Never weaken an assertion to make it pass.** Distinguish "test on
   wrong axis" from "model regression"; fix the right one.
2. **Never set `Ω` manually in non-registry tests.** Coagulation must
   arise from `check_coagulation`.
3. **Mission invariants are red lines.** Tests that contradict them
   are deleted, not relaxed.
4. **Per-stage transcript + manifest** is part of the validation, not
   an afterthought. See [`results/etapa_*/`](../results/).
