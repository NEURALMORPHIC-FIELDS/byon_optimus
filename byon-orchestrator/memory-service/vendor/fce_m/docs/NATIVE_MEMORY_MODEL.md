# Native Memory Model — OmegaRecord → ReferenceField

This document is the central conceptual reference for FCE-M v0.6.0.
It explains the distinction between *memory as archive* and *memory as
internal reference structure*, and how the two are represented in code.

## The distinction

```
                Memory as archive                  Memory as internal reference
                ─────────────────                  ────────────────────────────
What is stored: past events                        past events PLUS
                                                   coagulated identities

What does it   stays inert; consulted on demand    SHAPES how future events
do?            via retrieval                       are READ and CLASSIFIED

Mutability:    indexed once, updated on            historical fact IMMUTABLE,
               re-indexing                        functional field MAY FLUCTUATE

Truth         (a separate layer's responsibility)  (still a separate layer's
authority:                                          responsibility — never the
                                                   memory's own)
```

FCE-M implements the right-hand column WITHOUT collapsing the
distinction between truth and becoming.

## The two structures

### `OmegaRecord` — the irreversible historical fact

Defined in `unified_fragmergent_memory/runtime/omega_registry.py`.

```
OmegaRecord
├── omega_id                     stable 16-hex id (sha256-based)
├── semantic_center              "entity_id::attr_type"
├── coagulated_at_episode        IMMUTABLE
├── coagulated_at_cycle          IMMUTABLE
├── S_t_at_coagulation           IMMUTABLE
├── kappa_at_coagulation         IMMUTABLE
├── sine_type                    integrative / operational / turbulent
├── source_episodes              IMMUTABLE list
├── source_events                IMMUTABLE breadcrumbs
├── duration_above_threshold     τ_coag
├── expression_state             active / contested / inexpressed
│                                (the ONLY mutable field)
└── expression_history           append-only log
```

What `OmegaRecord` ANSWERS:
- *Did this semantic center coagulate?*
- *When? With what trajectory?*
- *What was its sine_type at coagulation?*

What `OmegaRecord` does NOT answer:
- *Should a new event be read as aligned or contested with respect to
  this center?* — that is `ReferenceField`'s job.
- *Is the runtime's current decision about this slot correct?* —
  that is D_Cortex's job.

`OmegaRecord` is created exclusively when
`agent.check_coagulation(S_t, t, θ_s, τ_coag)` returns `True`. No
other code path produces a registered Omega. This is enforced by
tests (`test_17`, `test_05`) and by the registry's API: there is no
public method to flip Omega manually outside `register()`.

### `ReferenceField` — the derived functional field

Defined in `unified_fragmergent_memory/runtime/reference_field.py`.
New in v0.6.0.

```
ReferenceField
├── reference_id                 stable 16-hex id derived from omega_id + center
├── omega_id                     anchor link (must exist in registry)
├── center_key                   "entity_id::attr_type"
├── field_vector                 FROZEN at coagulation time;
│                                blend of agent.Phi_s and ΔX
├── strength ∈ [0, 1]            FLUCTUATES with classified events
├── expression_state             active / contested / inexpressed
├── created_at_episode
├── last_updated_episode
└── source_omega_record          provenance link back to the OmegaRecord
```

What `ReferenceField` ANSWERS:
- *Is this new observation aligned, tensioned, contested, orthogonal,
  expression-reinforcing, or residue-amplifying with respect to the
  coagulated identity of this center?*
- *Has the field been weakened by accumulated contestation?*

What `ReferenceField` does NOT answer:
- *What is the truth of this new observation?* — D_Cortex authority.
- *Should the runtime change a slot zone?* — D_Cortex authority.
- *Should a NEW Omega be created on a different center?* — only
  `check_coagulation` decides, never the RF.

## Event classification

`classify_event_against_reference(delta_X, zone, residue_weight, field_vector)`
returns one of six kinds:

| Zone | cos(ΔX, field) band | Additional condition | Kind |
|---|---|---|---|
| COMMITTED | cos > 0.75 | — | `expression_reinforcing` |
| COMMITTED | 0.30 < cos ≤ 0.75 | — | `aligned` |
| COMMITTED | |cos| < 0.30 | — | `orthogonal` |
| COMMITTED | otherwise | — | `tensioned` |
| DISPUTED | |cos| < 0.40 | residue_weight > 0.70 | `residue_amplifying` |
| DISPUTED | cos < 0.30 | — | `contested_expression` |
| DISPUTED | otherwise | — | `tensioned` |
| PROVISIONAL / NONE | cos > 0.50 | — | `aligned` |
| PROVISIONAL / NONE | |cos| < 0.30 | — | `orthogonal` |
| PROVISIONAL / NONE | otherwise | — | `tensioned` |

The classification is *purely morphogenetic*. It says nothing about
the truth of the new observation. The runtime's zone for the new
slot_event remains its own — never rewritten by classification.

## Strength dynamics

```
strength_{t+1} = clamp(strength_t + Δ, 0, 1)

Δ by event kind:
    expression_reinforcing   +0.05
    aligned                  +0.05
    tensioned                -0.02
    orthogonal                0.00
    contested_expression     -0.08
    residue_amplifying       -0.04

Expression-state transitions (bounded by strength bands):
    strength ≥ 0.30  →  active
    0.10 ≤ strength < 0.30  →  contested
    strength < 0.10  →  inexpressed
```

The dynamics are bounded and monotone in their direction; sustained
contestation gradually moves the field through `active → contested →
inexpressed`, but the underlying `OmegaRecord` is preserved.

## Inter-RF interactions

`OmegaFieldInteraction` records the relationship between two
ReferenceFields that are co-active in the same consolidate pass:

```
field_alignment   = cos(field_vec_i, field_vec_j)
field_tension     = 1 - |field_alignment|
resonance_score   = max(0, field_alignment) * min(strength_i, strength_j)
interference_score = (1 - |field_alignment|) * min(strength_i, strength_j)
```

Centers WITHOUT an OmegaRecord cannot appear in this trace. The trace
is informational; it never auto-coagulates a third center, never
modifies either RF's `strength` directly, and never alters UFME.

## Mission alignment

From `misiunea.txt` §10:

> *„nu memorie ca arhivă, ci memorie ca formă internă care
> influențează cum viitoarele evenimente sunt asimilate, tensionate,
> contestate sau aliniate."*

In v0.6.0 we close this loop in code:

```
coherent input drives S_t above θ_s
  → check_coagulation flips Ω = 1
  → OmegaRecord registered (irreversible)
  → ReferenceField projected (functional, fluctuating)
  → future events classified against the field
  → expression may strengthen (aligned) or weaken (contested)
  → Ω stays; truth-status stays
```

This is the prototype: not retrieval of a past, but *the past becoming
internal structure that orients future reading*.
