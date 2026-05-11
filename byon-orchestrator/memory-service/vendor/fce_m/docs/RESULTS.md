# Results

This document records the per-stage evolution of FCE-M from passive
integration (v0.4.0) through Native Memory Prototype (v0.6.0).

## Stage summary

| Stage | Version | Capability | Tests | Verdict | Stage folder |
|---|---|---|---|---|---|
| 0 | v0.4.0 | baseline passive integration | 213 | PASS | [`results/etapa_00_v0_4_0_baseline/`](../results/etapa_00_v0_4_0_baseline/) |
| 1 | v0.4.1 | center-isolated anchor | 222 | PASS | [`results/etapa_01_v0_4_1_center_isolated_anchor/`](../results/etapa_01_v0_4_1_center_isolated_anchor/) |
| 2 | v0.4.2 | integrated R10b reproduction by rule | 231 | PASS | [`results/etapa_02_v0_4_2_r10b_integrated/`](../results/etapa_02_v0_4_2_r10b_integrated/) |
| 3 | v0.5.0 | multiperspectival observer (passive) | 241 | PASS | [`results/etapa_03_v0_5_0_multiperspectival_observer/`](../results/etapa_03_v0_5_0_multiperspectival_observer/) |
| 4 | v0.5.1 | semi-active advisory priority feedback | 254 | PASS | [`results/etapa_04_v0_5_1_semi_active_priority_feedback/`](../results/etapa_04_v0_5_1_semi_active_priority_feedback/) |
| 5 | v0.6.0 | native memory prototype (ReferenceField) | **268** | **PASS** | [`results/etapa_05_v0_6_0_native_memory_reference_field/`](../results/etapa_05_v0_6_0_native_memory_reference_field/) |

Each stage folder contains:
`pytest_full.txt`, `pytest_summary.txt`, `report.txt`, `report.json`,
`manifest.json`, `CHANGELOG_slice.md`.

## Stage 0 — v0.4.0 baseline passive integration

**Goal:** confirm pre-integration UFME state and lock the 213-test
baseline before any modifications.

**Result:** 213 passed in 15.80s. ETAPA 0 manifest noted that the
baseline transcript is the authoritative pre-FCE-M snapshot; later
stages add to this count, never subtract.

## Stage 1 — v0.4.1 center-isolated anchor

**Goal:** close the v0.4.0 global-anchor coupling channel. Disputed
writes on center B were modulating `disrupt_eff` for center A via the
aggregated `anchor_from_runtime_snapshot`. Required: per-center
counters, bitwise isolation.

**Implementation:** new primitive `anchor_from_center_counts()` in
`bridges/fce_translator.py`. Observer maintains `_center_zone_counts`
incremented per observation. `metrics_snapshot` exposes per-center
anchors.

**Tests added (9):**
- 8 new tests in `test_16_center_isolated_anchor.py`
- 1 strengthened test in `test_10_coagulated_reference_field.py`

**Result:** 222 passed. Tests `test_09::test_observer_centers_are_isolated_in_v0_4_0`
strengthened from "< 5% relative tolerance" to bitwise equality on
`kappa` and `Z_norm`.

**Capability confirmed:** bitwise per-center isolation under
non-coactive interleaving of centers.

## Stage 2 — v0.4.2 integrated R10b reproduction

**Goal:** demonstrate that the integrated runtime can produce an
Omega coagulation event end-to-end by RULE, not by manual injection.

**Implementation:** new experiment `experiments/r10b_integrated_phoenix.py`.
Drives `phoenix::identity` through a germinal incubation phase, then
a perturbation phase.

**Parameters:** `θ_s = 0.10`, `τ_coag = 3`, `D = 16`, `seed = 42`.

**Trajectory (germinal):**

```
ep cyc  S_t    AR    κ     Z     Ω
 1   1  0.178  0.681 0.521 0.334 0
 2   2  0.134  0.682 0.490 0.660 0
 3   3  0.102  0.677 0.458 0.981 1  ← coagulation by rule
```

Sine type at coagulation: `integrative` (κ_coag ≥ 0.40).
`omega_id = a91dd7187d0d632e`, `duration_above_threshold = 3 = τ`.

**Trajectory (perturbation, 8 disputed events ep 100–107):**

```
S_t:    0.027 → 0.003   (decays sub-threshold)
AR:     0.562 → 0.323
κ:      0.294 → 0.093
Z:      2.32 → 2.16     (residue saturated)
Ω:      1 → 1            (irreversible)
omega_id, coagulated_at_episode, S_t_at_coagulation: invariant
last slot_event zone_after: DISPUTED  (truth preserved)
```

**Tests added (9):** all in `test_17_r10b_integrated_reproduction.py`.

**Result:** 231 passed. R10b integrated reproduction confirmed end-to-end.

**Capability confirmed:** Omega produced by rule + irreversible
under perturbation + truth preserved + provenance complete +
persist/load roundtrips Omega.

**Artifacts:** [`results/etapa_02_v0_4_2_r10b_integrated/r10b_trajectory.json`](../results/etapa_02_v0_4_2_r10b_integrated/r10b_trajectory.json)
and `r10b_trajectory.txt` carry the full cycle-by-cycle trajectory.

## Stage 3 — v0.5.0 multiperspectival observer

**Goal:** activate directional inter-center interactions in the
observer using the vendor FCE-Ω primitives, normalized so the field
does not explode as N grows.

**Implementation:** new `MultiperspectiveInteractionTrace` and
`RelationCandidate` dataclasses. `_compose_multiperspectival()`
iterates over ordered pairs and computes absorption, repulsion,
interference, directional coagulation per-pair. Class-wise
normalization: directional terms `/N(N-1)`, shared coag candidates
`/N(N-1)/2`.

**Tests added (10):** all in `test_18_multiperspectival_observer.py`.

**Result:** 241 passed.

**Capability confirmed:**
- Active-center detection per consolidate pass.
- `I_{i←j} ≠ I_{j←i}` under unequal histories.
- Interference antisymmetry residual `< 1e-12` in the runtime
  (Phi_a seeded deterministically per `(center, episode)`).
- Total directional norm bounded for N=1,4,8,16: at most ~O(1).
- Shared-coagulation candidates surface for high-S_t pairs.
- Reference-field anchor from coagulated neighbors influences
  receiver's `disrupt_eff` but cannot replace the threshold rule.
- Per-center isolation (v0.4.1) preserved when centers are not
  co-active in the same consolidate pass.

## Stage 4 — v0.5.1 semi-active advisory feedback

**Goal:** first semi-active channel. FCE-Ω may emit bounded priority
recommendations after each consolidate, BUT only as inspectable
metadata, never as UFME write-back.

**Implementation:** `Config.fce_advisory_mode: str = "read_only"`.
`FCEAdvisoryFeedback` dataclass with 6 kinds:
`high_residue`, `near_coagulation`, `coagulated_reference`,
`contested_expression`, `fragmented`, `relation_candidate`.
`priority_delta ∈ [-1, 1]`. Full provenance back to traces, omega ids,
relation candidate ids.

**Tests added (13):** all in `test_19_semi_active_advisory.py`.

**Result:** 254 passed.

**Capability confirmed:**
- `read_only` (default) preserves v0.5.0 byte-identical.
- `priority_only` emits bounded provenance-tracked recommendations.
- `runtime_view`, `audit_log`, slot zones, Omega registry all byte-equal
  between modes (the strongest no-write-back guarantee).
- `near_coagulation` recommended BEFORE Omega fires.
- `contested_expression` recommends review WITHOUT uncoagulating.
- `relation_candidate` recommends review WITHOUT creating any new
  registry.
- Persist/load roundtrips the feedback log.

## Stage 5 — v0.6.0 native memory prototype

**Goal:** first version where `Ω` becomes a FUNCTIONAL FIELD —
not just a registry entry.

**Implementation:**
- New module `unified_fragmergent_memory/runtime/reference_field.py`
  with `ReferenceField`, `ReferenceFieldRegistry`,
  `ReferenceFieldEvent`, `OmegaFieldInteraction`,
  `classify_event_against_reference()`.
- On every `newly_coagulated` event, if
  `fce_reference_fields_enabled = True`, project a `ReferenceField`
  with `field_vector = normalize(0.5·Φ_s + 0.5·ΔX/‖ΔX‖)`.
- After agent steps, classify each new observation against active
  RFs for that center; update RF `strength` ∈ [0, 1] by bounded
  deltas and transition `expression_state` between `active`,
  `contested`, `inexpressed`.
- For co-active pairs that BOTH have RFs, compose
  `OmegaFieldInteraction` traces with `field_alignment`,
  `field_tension`, `resonance_score`, `interference_score`.
- `priority_only` mode surfaces RF events and omega_field interactions
  as new advisory feedback kinds.

**Tests added (14):** all in
`test_20_reference_field_native_memory.py`.

**Result:** 268 passed.

**Capability confirmed:**
- RF created exclusively from `OmegaRecord`.
- OmegaRecord bitwise-immutable through all RF activity.
- Future events classified in 6 morphogenetic kinds.
- Disputed events post-coag classified as
  `contested_expression` / `residue_amplifying`; truth-status intact.
- Centers without Omega cannot enter omega_field interactions.
- Two coagulated centers produce `OmegaFieldInteraction` traces.
- omega_field interactions do NOT auto-coagulate a third co-active
  center.
- RF expression_state can fluctuate; OmegaRecord stays.
- persist/load roundtrips RFs + events + interactions.
- Default OFF (`fce_reference_fields_enabled = False`) preserves
  v0.5.1 byte-identical.

## Cumulative invariants pinned across all stages

```
✓ FCE-Ω never writes to UFME (runtime adapter, slot_event_log,
  audit_log, D_Cortex, tf_engine).
✓ Omega is produced ONLY by the threshold rule check_coagulation.
✓ OmegaRecord historical fields (omega_id, coagulated_at_episode,
  S_t_at_coagulation, kappa_at_coagulation, source_episodes,
  source_events) are immutable.
✓ ReferenceField is created ONLY from an existing OmegaRecord.
✓ Centers without Omega cannot enter the Omega-field.
✓ Advisory feedback is bounded, provenance-tracked, never modifies
  truth-status, never creates Omega.
✓ Multiperspectival composition is class-wise normalized; field
  does not explode with N.
✓ Vendor source is read-only; no nested .git, no stale egg-info.
✓ Persist/load roundtrips ALL observer state across versions
  (with backward-compat).
```
