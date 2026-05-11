<p align="center">
  <img src="../assets/logo_fragmergent_causal_exponentiation_memory.png" alt="FCE-M" width="320">
</p>

# Architecture

FCE-M layers the **FCE-Ω** morphogenetic observer on top of the **UFME**
cognitive memory operating layer. The architectural formula is fixed
and held invariant across all stages of the project:

```
UFME           manages memory
D_Cortex       verifies truth
FCE-Ω          measures becoming (assimilation, residue, coagulation, reference)
OmegaRegistry  preserves coagulation irreversibly
ReferenceField transforms Omega into a field of reference
Advisory       recommends, does NOT override
```

## High-level diagram

```
            ┌──────────────────────────────────────────────┐
            │                  consumer                    │
            │   write / read / consolidate / propagate /   │
            │   audit_log / fce_advisory_* / fce_ref*      │
            └──────────────────────┬───────────────────────┘
                                   │ (single facade)
                                   ▼
                ┌──────────────────────────────────────┐
                │        UnifiedMemoryStore            │
                │            (UFME facade)             │
                └─┬────────────────┬───────────────┬───┘
                  │                │               │
        ┌─────────▼────┐  ┌────────▼────────┐  ┌───▼──────────────┐
        │  d_cortex    │  │   tf_engine     │  │ memory_engine_   │
        │ epistemic    │  │ numerical TF /  │  │   runtime        │
        │ verdicts     │  │ Husimi / MI     │  │ consolidator     │
        │ (TRUTH)      │  │ (NUMERICAL)     │  │ (LONGITUDINAL)   │
        └──────────────┘  └─────────────────┘  └────────┬─────────┘
                                                        │ slot_event_log
                                                        │ tension_event_log
                                                        ▼
                ┌──────────────────────────────────────────────┐
                │         FCEOmegaObserver (passive)           │
                │                                              │
                │  bridges.fce_translator → FCEObservation     │
                │  per-center Agent (FCE-Ω, vendored)          │
                │  agent.step → S_t → check_coagulation        │
                │  → OmegaRecord (irreversible)                │
                │  → ReferenceField (v0.6.0, derived)          │
                │  → ReferenceFieldEvent classification        │
                │  → OmegaFieldInteraction (co-active pairs)   │
                │  → FCEAdvisoryFeedback (priority_only)       │
                │                                              │
                │  WRITES BACK TO UFME / D_CORTEX: NEVER       │
                └──────────────────────────────────────────────┘
```

## Component responsibilities

### UFME (`unified_fragmergent_memory.facade`)

- `UnifiedMemoryStore` — single facade, routes writes/reads to the
  correct backend by entry shape, exposes `consolidate()`,
  `propagate()`, `audit_log()`.
- `Config` — central configuration including the FCE-Ω flags
  documented below.

### D_Cortex / memory_engine_runtime

- Owns the symbolic epistemic state. Decides slot zones
  (`COMMITTED` / `PROVISIONAL` / `DISPUTED` / `NONE`) through the
  v15.7a-sealed consolidation pipeline (`reconcile` → `prune` →
  `retrograde` → `promote`).
- Authority over truth. FCE-Ω reads from it but never writes.

### tf_engine

- Numerical time-frequency substrate (Wigner, Husimi, MI, hybrid
  attention, top-k EMA propagation). Used for numerical entries; not
  involved in the FCE-Ω observation pipeline directly.

### FCE-Ω observer (`unified_fragmergent_memory.runtime.fce_omega_observer`)

- One agent per semantic center `(entity_id, attr_type)`.
- Reads only the new tail of `slot_event_log` and `tension_event_log`
  per consolidate pass.
- Computes per-center anchor from per-center zone counters (v0.4.1).
- Optionally composes multiperspectival inter-center interactions
  (v0.5.0) and emits relation candidates.
- Optionally emits semi-active priority feedback (v0.5.1).
- Optionally projects ReferenceFields from new OmegaRecords (v0.6.0).
- Persists state to JSON; reload preserves all of the above without
  replaying UFME events.

### Omega Registry (`unified_fragmergent_memory.runtime.omega_registry`)

- Append-only. `OmegaRecord` is created exclusively through
  `agent.check_coagulation` firing — never via manual injection.
- `omega_id`, `coagulated_at_episode`, `coagulated_at_cycle`,
  `S_t_at_coagulation`, `kappa_at_coagulation`, `source_episodes`,
  `source_events` are **immutable** for the life of the system.
- `expression_state` may transition `active` ↔ `contested` ↔
  `inexpressed`, with full history.

### ReferenceField (`unified_fragmergent_memory.runtime.reference_field`)

- v0.6.0. Anchored to an existing `OmegaRecord`; cannot exist
  standalone.
- `field_vector` frozen at coagulation time as a normalized blend of
  `Φ_s` and `ΔX`.
- `strength ∈ [0, 1]` updates by bounded deltas per classified event.
- `ReferenceFieldEvent` classifies each new observation morphogenetically.
- `OmegaFieldInteraction` traces inter-RF pairs when both centers are
  co-active.

### Advisory (`fce_advisory_*` API)

- `read_only` (default) — read-only snapshots through `advisory_hints()`,
  no persisted log.
- `priority_only` — bounded `FCEAdvisoryFeedback` items with
  `priority_delta ∈ [-1, 1]`, `recommended_action`, full provenance.
- The runtime adapter, slot zones, audit_log, D_Cortex truth verdicts,
  Omega Registry are **byte-identical** between modes.

## Config flags (top-level overview)

| Flag | Default | Stage introduced | Purpose |
|---|---|---|---|
| `fce_omega_enabled` | False | v0.4.0 | enable the morphogenetic observer at all |
| `fce_omega_D` | 16 | v0.4.0 | FCE field dimension |
| `fce_omega_theta_s` | 0.28 | v0.4.0 | coagulation threshold |
| `fce_omega_tau_coag` | 12 | v0.4.0 | required consecutive cycles above θ |
| `fce_omega_seed` | 42 | v0.4.0 | per-center deterministic Agent init |
| `fce_multiperspectival_enabled` | False | v0.5.0 | compose inter-center interactions |
| `fce_multiperspectival_anchor_eta` | 0.30 | v0.5.0 | reference-anchor scaling |
| `fce_multiperspectival_theta_pair` | 0.20 | v0.5.0 | shared-coag candidate threshold |
| `fce_advisory_mode` | "read_only" | v0.5.1 | semi-active priority feedback channel |
| `fce_reference_fields_enabled` | False | v0.6.0 | project ReferenceFields from OmegaRecords |

All defaults are conservative; every flag at its default leaves the
UFME side bit-identical to the corresponding pre-FCE behavior.

## Data flow (one consolidate pass with all flags on)

```
  consolidate(episode_id)
        │
        ▼
  runtime adapter.end_episode(episode_id)
        │     (reconcile → prune → retrograde → promote)
        │     (slot_event_log, tension_event_log grow)
        ▼
  observer.observe_after_consolidate(adapter, episode_id)
        │
        ├── drain slot_event_log[since:cursor]
        │       → FCEObservation per event (bridge.fce_translator)
        │       → group by center (per_center dict)
        │
        ├── for each active center:
        │       update per-center zone_counts (v0.4.1)
        │       compute per-center anchor (v0.4.1)
        │       compute multiperspectival ref_anchor (v0.5.0)
        │       agent.step(delta_X, U_a, anchor=effective_anchor)
        │       check_coagulation(S_t, cycle, θ_s, τ_coag)
        │       if newly_coagulated:
        │           register OmegaRecord (irreversible)
        │           project ReferenceField (v0.6.0, opt-in)
        │       append MorphogenesisRecord
        │
        ├── (v0.5.0) compose pair traces + relation candidates
        ├── (v0.6.0) classify new observations against active RFs
        ├── (v0.6.0) compose OmegaFieldInteraction for co-active RF pairs
        └── (v0.5.1) emit bounded FCEAdvisoryFeedback (priority_only)

  WRITES TO UFME / D_CORTEX / tf_engine: ∅ (zero)
```

## Invariants encoded as tests

| Invariant | Test file |
|---|---|
| Observer is byte-passive when OFF | `tests/fce_omega/test_non_regression.py` |
| Observer does not change UFME outputs | `tests/fce_omega/test_observer_invariance.py` |
| Omega irreversibility | `tests/fce_omega/test_omega_irreversibility.py`, `tests/fce_omega_functional/test_05_omega_irreversibility.py` |
| Omega is not truth | `tests/fce_omega/test_not_truth.py`, `tests/fce_omega_functional/test_06_omega_not_truth.py` |
| Per-center anchor isolation | `tests/fce_omega_functional/test_16_center_isolated_anchor.py` |
| R10b coagulation by rule | `tests/fce_omega_functional/test_17_r10b_integrated_reproduction.py` |
| Multiperspectival normalization bounded | `tests/fce_omega_functional/test_18_multiperspectival_observer.py` |
| Advisory feedback never alters Omega | `tests/fce_omega_functional/test_19_semi_active_advisory.py` |
| ReferenceField only from OmegaRecord | `tests/fce_omega_functional/test_20_reference_field_native_memory.py` |
