# Limitations

Honest accounting of what FCE-M v0.6.0 does and does NOT do. Updated
per release.

## 1. No self-application loop

The observer never marks `FCEAdvisoryFeedback.applied = True` itself.
A consumer (external orchestrator, agentic shell, human reviewer)
must read `fce_advisory_feedback()` and decide whether to act on the
recommendation.

**Why it matters:** without self-application, FCE-M is a measurement
instrument, not an autonomous self-modifying agent. We consider this
correct for v0.6.0: opening the self-application loop requires a
separate safety discipline (feature flag, allow-list of permitted
actions, additional tests). Slated for v0.7.0.

## 2. No first-class RelationRegistry

`RelationCandidate` items are persisted on the observer (and survive
`persist`/`load`), but they are not promoted to a top-level registry
analogous to `OmegaRegistry`. There is no "RelationRecord" that lives
across the system independently of the observer.

**Why it matters:** relation candidates are informational. They are
not yet load-bearing structural facts that other parts of the system
can query as primary objects. Slated for v0.7.0 alongside the
self-application loop.

## 3. `field_vector` is heuristic, not a learned embedding

`ReferenceField.field_vector` is computed at coagulation time as

```
field_vector = normalize(0.5 · Φ_s + 0.5 · ΔX / ‖ΔX‖)
```

This blends the agent's internal direction (`Φ_s`) with the content
vector that contributed to coagulation (`ΔX`). It is deterministic
and stable, but it is not a learned semantic representation. Two
centers with semantically similar content (e.g. "phoenix::identity"
and "phoenix::nature") would have different field vectors driven by
hash-derived direction signatures, not by meaning.

**Why it matters:** the morphogenetic classification (aligned vs
contested) is correct in the formal sense but does not yet reflect
semantic similarity in the natural-language sense. Slated for a
future release that integrates learned representations.

## 4. Omega-field interactions only over co-active pairs

`OmegaFieldInteraction` is emitted only when two centers both have a
`ReferenceField` AND were observed in the same `consolidate()` pass.
There is no temporal aggregation across episodes; an interaction
trace produced at episode `t` does not influence the trace produced
at episode `t + N` even if both centers remain coagulated throughout.

**Why it matters:** structural relations that exist persistently are
not yet detected; only point-in-time co-activation is. A persistent
relation registry (item 2) would address this together with item 6.

## 5. In-episode aggregation

The observer aggregates multiple observations on the same center
within a single `consolidate()` pass into one `delta_X` before
calling `agent.step()`. This is an explicit implementation choice
documented in the observer source.

**Why it matters:** for fine-grained per-event trajectories, callers
must call `consolidate()` once per write. The functional tests
demonstrate this idiom but the API does not enforce it. A future
release may add a configurable "per-event" mode at the cost of
performance.

## 6. `Z_norm` is not a single reliable discrimination axis

Naive intuition: "high residue should mean strong conflict". Empirical
reality in the integrated runtime: a coherent committed sequence
accumulates residue *along the same `direction`* (Z grows), while a
conflicting disputed sequence injects residue in *different orthogonal
directions* per event, leading to partial cancellation.

The right discrimination axes are `AR_t` and `κ_t`. This is documented
in `tests/fce_omega_functional/test_04_assimilation_vs_residue.py`
and the assertion phrasing was deliberately rewritten to reflect the
correct semantics. Consumers should not interpret `Z_norm` alone as
"how much conflict".

## 7. Advisory consumption is the caller's responsibility

`priority_only` mode produces `FCEAdvisoryFeedback` items with
bounded `priority_delta`, `recommended_action`, and provenance.
The observer does NOT:

- modify consolidation queue priorities
- delay or accelerate any consolidation
- pause / suspend consolidation of any center

These actions are *recommendations*. A consumer pipeline that wants
to act on them must read them and implement its own scheduling
strategy.

**Why it matters:** mission §6 explicitly bans hidden write-back.
The observer respects this. The downside is that "applied" semantics
are absent until v0.7.0.

## 8. Single-shot R10b reproduction

The R10b reproduction (`experiments/r10b_integrated_phoenix.py`) is
deterministic with `seed=42` and a single phoenix center. It does
NOT yet:

- run a multi-center germinal incubation (R10c-style)
- compare integrative / operational / turbulent sine_type
  distributions across seeds
- aggregate statistics over Monte-Carlo runs

These are valuable validation extensions but out of scope for v0.6.0.

## 9. Phi_a for interference is synthetic

When the observer needs Lie-algebra elements for the interference
operator, it generates them via
`build_Phi_a(shared_X, kappa, rng=seeded_rng)` with a deterministic
SHA-256-derived seed. The result is reproducible but synthetic — it
does not correspond to a "real" learned action element. For the
mathematical properties asserted in tests (antisymmetry, directional
asymmetry), this is sufficient. For future semantic interpretation,
real action representations would be needed.

## 10. Persistence is JSON, not a database

Observer state is saved to one JSON file per `persist()` call.
There is no incremental persistence, no compaction, no append-only
log on disk. For large workloads this would need to be replaced by
a more scalable backend.

---

## Out of scope (by design)

The following are explicitly NOT goals of FCE-M:

- **Truth verification.** D_Cortex / runtime owns this.
- **Numerical retrieval.** tf_engine and the UFME numerical side own
  this; FCE-Ω does not propagate numerical queries.
- **Replacing UFME.** FCE-M is a layer over UFME. Removing UFME
  removes FCE-M.
- **Autonomous decision-making.** No version of FCE-M decides what to
  commit. Slot zones are runtime decisions.
- **Memory of language.** FCE-M's `field_vector` is direction-based,
  not text-based. Pairing FCE-M with a language model is a separate
  integration question.

## Versions where each limitation might be addressed

| Limitation | Target version |
|---|---|
| No self-application loop | v0.7.0 (controlled self-app) |
| No first-class RelationRegistry | v0.7.0 |
| Heuristic field_vector | v0.8.0 (learned embeddings) |
| Co-active-only inter-RF | v0.7.0 |
| In-episode aggregation | v0.7.x optional flag |
| Z_norm discrimination | (documented; no code change planned) |
| Advisory consumption | v0.7.0 |
| Single-shot R10b | v0.7.x experiments |
| Synthetic Phi_a | v0.8.0 |
| JSON-only persistence | v0.8.0 |
