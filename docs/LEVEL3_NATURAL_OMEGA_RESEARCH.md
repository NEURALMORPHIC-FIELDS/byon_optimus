# Level 3 — Natural Omega Research

**Status:** DESIGN DOCUMENT — design questions Q1–Q8 resolved by operator 2026-05-12 (see §0.1 Decision Log). First code commit lands the skeleton + schemas + transcript fixtures (no Omega creation, no `check_coagulation` modifications, no production imports). All subsequent implementation work proceeds on this branch.
**Branch:** `research/level-3-natural-omega` (separate from `main` and from any prior `research/level-3` work).
**Branch base:** post-v0.6.9.1 `main` at `15a7c478afcb394169ed74d89060bd494c8ea169`.
**Operational classification of `main`:** stays **Level 2 of 4 — Morphogenetic Advisory Memory**, unchanged, until a reproducible natural-Omega demonstration is achieved on this branch AND independently audited.

**This document is a research proposal, not a release claim.** We do not declare Level 3. We test whether a natural OmegaRecord can form under the operator-locked thresholds via the existing `check_coagulation` path, by changing only the *information shape* that feeds the coagulation rule — never the rule itself, never the thresholds.

**Patent:** EP25216372.0 — Omni-Qube-Vault — Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.

---

## 0. Hard constraints (operator-locked, non-negotiable)

These are framing constraints, not subject to design trade-offs. Any code in this branch that violates them is a defect:

| # | Constraint | Why it is non-negotiable |
|---|---|---|
| C1 | `theta_s = 0.28` unchanged | The whole point of v0.6.5/F4 is that θ_s is not relaxed for demo convenience. A "natural Omega" demonstrated at lowered θ_s is not a demonstration — it is a re-parameterisation. |
| C2 | `tau_coag = 12` consecutive cycles unchanged | Same reasoning. The 12-cycle germinal-incubation window is what makes a coagulation event mean something. |
| C3 | OmegaRecord appears ONLY through `check_coagulation` | No alternative coagulation paths. The existing FCE-M coagulation routine is the single source of truth for "a center has just become Omega." |
| C4 | No LLM-created Omega | No prompt that asks the LLM "should this be remembered as Omega" and writes back. The LLM is downstream of Omega, never upstream. |
| C5 | No manual `registry.register(...)` | Code in this branch may not call `OmegaRegistry.register` from outside the coagulation check. |
| C6 | No `is_omega_anchor=true` flag, no "operator declares this an anchor" knob | If we add such a flag we are back-doored into manufactured Omega. |
| C7 | Rolling summaries do NOT create Omega | Summaries shrink `Z_active`. They do not enter the registry. They do not increase `S_t` directly. They are an *input transformation*, not a coagulation pathway. |
| C8 | Raw events are archived, never deleted | Provenance survives summarisation. Every Omega (if one ever forms) must be reconstructible from raw events. |
| C9 | Full provenance is mandatory | `source_event_ids`, summary chain, observer perspective, residue history, timestamps — all stored, all replayable. |
| C10 | `main` stays Level 2 until reproducible | Even if one Omega forms on this branch, we do NOT update `main` operational classification until: (a) the run is reproducible from raw seed, (b) it survives an audit by the operator OR an independent reader, (c) the `Z_total` / `Z_active` / `Z_resolved` / `Z_archived` accounting holds end-to-end. |
| C11 | `research/level-3` branch (previous) is untouched | This research lives on the NEW branch `research/level-3-natural-omega`. The older `research/level-3` reference (if any) is preserved as historical state. |

---

## 0.1 Decision log (operator answers to §11 Q1–Q8, 2026-05-12)

The eight open design questions from §11 are resolved as follows. Every later section in this document is interpreted under these decisions. Any deviation during implementation requires a separate amendment commit to this document.

| # | Topic | Decision |
|---|---|---|
| Q1 | Harness domain v1 | **BYON-architecture deep-dive.** Richest recurring centers: SYSTEM_CANONICAL, VERIFIED_PROJECT_FACT, DOMAIN_VERIFIED, release history, FCE-M, Auditor / Executor boundaries, trust hierarchy, contradictions, receipts, benchmark results. Operator has the full mental model — most authentic transcript. |
| Q2 | Transcript length / author | **500 turns, hand-authored / curated.** Not 300 (insufficient signal). Not 1000 (premature). Five-phase structure mandatory: 100 turns architecture-recap / stable-center-formation → 100 turns trust-hierarchy / verified-facts / domain-facts → 100 turns contradictions / adversarial-claims / corrections → 100 turns receipts / benchmark-results / release-decisions → 100 turns return-to-same-centers after drift. Phase order is fixed for v1. |
| Q3 | LLM-generated summaries | **Not allowed in v1.** `RollingCenterSummary` v1 is deterministic only (correction chains, receipt success, expression_pattern_stable heuristic — see §3.3). LLM summaries remain a v2 research option, gated on an adversarial-summary-test design that is NOT scoped in this branch. |
| Q4 | Fan-out depth | **4 initial perspectives** for v1: `factual`, `project_state`, `domain_verified`, `security_boundary`. The other 4 (`preference`, `style`, `execution_boundary`, `narrative`) are deferred to v2. The §5.1 table is for reference; v1 implementation honours only the 4 listed here. |
| Q5 | `PotentialOmegaCenter` window K | **K = 12** to align with `τ_coag = 12`. Detector remains advisory-only. It does not write Omega and does not influence recall priority. |
| Q6 | Independent reproduction | **Different transcript + different seed, same code.** Run 1 = Transcript A + seed 42. Run 2 = Transcript B + seed 1337. Both must reach the same gates (L3-G1..L3-G9). L3-G10 is satisfied when at least one natural Omega forms under BOTH runs. Same `θ_s = 0.28`, same `τ_coag = 12`, same gate matrix. |
| Q7 | Harness location | **Local first.** No CI default for Level 3 harness. After runtime / cost / GHCR-space are known, an OPTIONAL `workflow_dispatch`-triggered CI job may be added on this branch. Not in `ci.yml` and not in `release.yml`. |
| Q8 | Branch isolation rigour | **Parallel directory `byon-orchestrator/level3-research/`.** This package MUST NOT be imported by any production code on `main`. No FCE-M facade hooks. No feature-flagged production paths. The research lives entirely in this directory tree on this branch. Linter / import-guard test (when added) verifies the constraint. |

These eight decisions are locked in. **Branch policy:** implementation begins now on `research/level-3-natural-omega`. `main` stays Level 2 of 4 until §8 L3-G10 holds AND operator explicitly approves a v0.7+ release proposal.

---

## 1. Problem statement

### 1.1 Where Level 2 of 4 sits today

`main` is at Level 2 — Morphogenetic Advisory Memory. The FCE-M layer:

- Computes per-center signals (`S_t`, `B_t`, `Z_t`, `AR`, `κ`).
- Tracks ReferenceField stability.
- Surfaces advisory recommendations (priority, contested-expression flags, residue alerts).
- **Never approves actions, never produces a verdict, never overrides the Auditor.**

`check_coagulation` exists. It is *operational*. But under the realistic seeded harnesses (R10b family, FCE-M deep functional reports v0.6.0–v0.6.4) **no natural OmegaRecord has been observed to form on `main`** at the operator-locked thresholds across the workloads we run. Bench v0.6.5 through v0.6.9.1 confirm: `omega_active = 0` across hundreds of multi-turn items.

### 1.2 What Level 3 would mean operationally

Level 3 — Morphogenetic Operational Memory — would mean: an Omega center has formed *naturally* (not seeded, not forced, not parameter-tweaked) and is now influencing recall priority, advisory weighting, or ReferenceField behaviour in a way that is reproducible, audited, and survives a from-scratch replay.

We are **not** claiming this. We are designing the conditions under which it *could* be tested.

### 1.3 The principal blocker — Z metabolism

The FCE-M coagulation rule (`r10b_integrated_phoenix.py` family + `facade/config.py` defaults):

```
S_t = expression_signal(center) * B_t
B_t = 1 / (1 + Z_t)
```

`Z_t` is residue — accumulated *un-resolved* tensioned-expression mass per center. As a long conversation progresses on a coherent topic, `Z_t` should EVENTUALLY come down (the topic resolves, the center stabilises, residue dissipates). In our current implementation, `Z_t` is closer to *cumulative* than *active* — it accumulates without a path back down for resolved-but-archived events. Result: `B_t` stays low, `S_t` never crosses `θ_s = 0.28`, no coagulation can happen.

This is **not** a thresholds problem. The thresholds are healthy. It is a **residue-accounting** problem: we are summing residue that no longer applies. The research question is: **can we redefine which residue counts as "active" (`Z_active`) vs which counts as "resolved or archived" (`Z_resolved`, `Z_archived`), without lowering θ_s or τ_coag, such that long natural conversations produce a non-zero `S_t` trajectory that eventually clears the bar?**

If yes, natural Omega becomes possible without parameter manipulation. If no, Level 3 stays out of reach on this architecture and we need a different research line.

---

## 2. Architecture (new components, on this branch only)

All components below are **research**: they sit alongside the existing FCE-M facade, none of them is wired into the production memory-service on `main`. The branch may carry shims that show how a future v0.7+ release *could* integrate them, but main behaviour does not depend on them.

```
                   (existing)
   raw user turn → MemoryEvent  ─────►  MemoryStore (FAISS)
                                  ─────►  FCE_OmegaObserver  ─►  check_coagulation
                                                                  │
                                                                  └─►  OmegaRegistry  (target)
                                                                  
                   (new on this branch — research)
   raw user turn → MemoryEvent ─►  CenterEventBuffer[center_id]
                                    │
                                    ├──► RollingCenterSummary  ─►  SummaryEvent (raw archived, NOT deleted)
                                    │
                                    ├──► Z_total / Z_active / Z_resolved / Z_archived accounting
                                    │
                                    ├──► Multi-perspective fan-out (observer slices)
                                    │
                                    └──► PotentialOmegaCenter detector (advisory only)

                   (also new — research harness)
   synthetic transcript  ────►  LongNaturalTranscriptHarness  ─►  replay
```

### 2.1 `CenterEventBuffer`

Per-center ring of `MemoryEvent` records. Indexed by `center_id` (the FCE-M existing identifier). Bounded by event count and by age. Stores:

- `event_id`, `ts`, `kind` (aligned / tensioned / contested / receipt / correction)
- `embedding` (already computed)
- `provenance` (channel, thread_id, source)
- `Z_contribution` (how much this single event added to that center's `Z_t` at write time)
- `resolution_status` (`unresolved` | `resolved` | `archived`)

Function: collect, not transform. Buffer is the input to summarisation and to accounting.

### 2.2 `RollingCenterSummary`

A compact, append-only summary per center. Produced by a deterministic policy (NOT by the LLM in this design — see §3 for why and §11 for the open question on whether LLM-summaries are admissible later). Stores:

- `summary_id`
- `center_id`
- `summary_text` (≤ 280 chars; structured digest of resolved positions)
- `source_event_ids` (the raw events this summary digests; **never empty**)
- `resolved_event_ids` (subset of `source_event_ids` whose `resolution_status` flipped to `resolved` because of this summary)
- `archived_event_ids` (subset that flipped to `archived` — resolved AND no longer carrying active residue)
- `Z_reduction` (numeric: how much `Z_active` decreased after this summary)
- `provenance.summary_chain` (parent summary_id, if this is a re-summary of an earlier summary)

**The summary text itself does NOT enter FAISS as a separate fact**, does NOT enter OmegaRegistry, and does NOT participate in coagulation as a center on its own. It is purely a `Z_active` reducer.

### 2.3 `SummaryEvent`

The on-disk record for each rolling summary. Stored in a sibling table alongside `MemoryEvent`. Includes:

- the full `RollingCenterSummary` object
- a `tombstone_pointer` list to the archived raw events (so a future replay can rebuild raw `Z_t` from scratch and verify the summary's `Z_reduction` claim)

### 2.4 `Z_total` / `Z_active` / `Z_resolved` / `Z_archived` accounting

Four numeric counters per center:

| Counter | Semantics | When it changes |
|---|---|---|
| `Z_total` | All-time residue mass that ever entered this center | Monotonic increase. Never decreases. Audit trail. |
| `Z_active` | Residue mass still carried by **unresolved** events | Increases on new tensioned/contested events; decreases when a summary marks events resolved/archived. |
| `Z_resolved` | Residue mass attached to events the summary policy has marked `resolved` but not yet `archived` | Bookkeeping layer between active and archived. |
| `Z_archived` | Residue mass attached to events the summary policy has marked `archived` | Audit-visible. Cannot be re-activated except by explicit operator action (e.g. revoking a summary). |

Invariant: `Z_active + Z_resolved + Z_archived == Z_total` at all times.

`check_coagulation` is fed with **`Z_active`**, not `Z_total`. This is the single load-bearing semantic change vs Level 2. It is *minimal* — the rule and thresholds do not change; only the input to `B_t = 1/(1 + Z_active)` changes.

### 2.5 Multi-perspective fan-out

A single raw user turn rarely belongs to exactly one center. A natural conversation overlays:

- a factual claim (gets a center in the *factual* slice)
- a preference signal (gets a center in the *preference* slice)
- a style choice (gets a center in the *style* slice)
- a security/jurisdictional boundary (gets a center in the *security_boundary* / *domain_verified* slice)
- a project-state update (in the *project_state* slice)
- an execution-time directive (in the *execution_boundary* slice)
- optionally a narrative/creative throughline (in the *narrative/creative* slice)

In v0.6.x, fact-extractor + fact-tagging puts most facts into *one* kind/subject pair, which collapses the conversation onto fewer centers — so each center sees fewer aligned events and fewer chances to coagulate. Multi-perspective fan-out **registers the same turn into multiple per-perspective centers**, each with its own `S_t / B_t / Z_t` accounting. This is closer to how a human listener tracks multiple parallel facets of a conversation simultaneously.

Hard rule: fan-out does **not** create new Omega paths. It only creates new centers, each subject to the same `check_coagulation` rule with the same θ_s / τ_coag. A center in a "narrative" slice cannot coagulate any easier than one in a "factual" slice.

### 2.6 `PotentialOmegaCenter` detector

An advisory-only signal. Reads the per-center trajectory of `S_t`, `AR`, `κ`, and `Z_active` over a sliding window. Flags centers as `potential_omega` when:

- `S_t` has been rising over the last K turns (configurable; default K = 8)
- `AR` is stable or rising (alignment ratio holding)
- `κ` is stable (no sudden expression-pattern shift)
- `Z_active` is non-increasing over the last K turns

**Critical:** flagging a center as `potential_omega` does NOT create an OmegaRecord. It does NOT call `registry.register`. It does NOT pre-write anything to the registry. It emits a single telemetry event:

```
{"event": "potential_omega_observed", "center_id": "...", "S_t_trend": [...], "Z_active_trend": [...], "advisory": true}
```

The advisory is consumed by the priority-recommendations subsystem (which already exists as priority-only advisory in v0.6.0) and by the test harness for measuring "how many centers reached the doorstep". The OmegaRegistry is updated **only and exclusively** by `check_coagulation` reaching its 12-cycle confirmation under `S_t ≥ θ_s`.

### 2.7 `LongNaturalTranscriptHarness`

A research harness that replays a 300–1000-turn synthetic transcript through the full pipeline, with deterministic seeding, and measures every relevant signal. See §7 for the harness specification.

---

## 3. `RollingCenterSummary` — detailed semantics

### 3.1 What a summary IS

A summary is a **compressed view of a center's resolved positions**. It says: "across raw events e1 ... eN, this center has settled on the following compact statement; the residue attached to e1 ... eM (subset) is now resolved and contributes only to `Z_resolved` / `Z_archived`, not to `Z_active`."

A summary IS:

- compact (≤ 280 chars text, plus structured fields)
- per-center (one summary chain per `center_id`)
- append-only (summaries replace each other in display, but the chain is preserved on disk)
- evidenced (`source_event_ids` is non-empty and every id resolves to a real `MemoryEvent` row)

### 3.2 What a summary is NOT

A summary is **not**:

- a coagulation event (does not register Omega, see §6)
- a fact (does not enter FAISS as a queryable fact; does not enter `formatFactsForPrompt`)
- a recall input on its own (recall continues to operate on raw events; the summary is a *display* and a *Z-reducer*, not a substitute)
- a deletion (the raw events it digests stay in the `MemoryEvent` store; only their `resolution_status` flips)

### 3.3 The summarisation policy in this design

For v1 of the harness, the summarisation policy is **deterministic, rule-based, not LLM-generated**. Reasons:

- An LLM-generated summary opens a side-channel for LLM-influenced Omega formation (the LLM could craft a summary that artificially drops `Z_active` to push `S_t` over θ_s).
- A deterministic policy is reproducible from raw events alone — replay yields identical summaries.
- We can verify Z-accounting from raw → summary mathematically.

The deterministic policy (v1):

- A `corrected_by` chain (event A is later corrected by event B, B by C, …): mark A and B as `resolved`, attach their residue to `Z_resolved`. The latest correction stays `unresolved` until itself superseded.
- A confirmed `receipt: success` for a center: mark all `unresolved` tensioned events on that center as `resolved` (the action succeeded; the residue is no longer load-bearing for prediction).
- An `expression_pattern_stable` heuristic (the last K events have the same kind + similar embedding) reduces `Z_active` by a small per-event delta and moves the *oldest* events in the window to `archived`. The summary text captures the stable pattern.

LLM-generated summaries — possibly admissible later — are an **open design question (Q3 §11)**, not part of v1.

---

## 4. Z metabolism — the load-bearing change

### 4.1 The diff from Level 2

Level 2:

```python
B_t = 1.0 / (1.0 + Z_t)              # Z_t == cumulative residue ≈ Z_total
S_t = expression_signal * B_t
if S_t >= theta_s and consecutive >= tau_coag:
    omega = OmegaRegistry.register(...)
```

Level 3 research candidate:

```python
B_t = 1.0 / (1.0 + Z_active)         # Z_active excludes resolved + archived residue
S_t = expression_signal * B_t
if S_t >= theta_s and consecutive >= tau_coag:
    omega = OmegaRegistry.register(...)   # SAME RULE, SAME THRESHOLDS
```

The thresholds, the consecutive-cycle requirement, the registration path — all identical. Only the residue input changes.

### 4.2 Invariants

- `Z_active(t) + Z_resolved(t) + Z_archived(t) == Z_total(t)` for all `t` and all centers.
- `Z_total` is monotonic non-decreasing per center.
- A summary may decrease `Z_active` and increase `Z_resolved + Z_archived` by the same amount. The sum is conserved.
- Operator revocation of a summary (rare, audit-only) moves residue back from `Z_resolved`/`Z_archived` → `Z_active`. This is the **only** path back; no implicit reactivation.

### 4.3 What this enables

- A long, coherent conversation that *resolves* its early-turn tensions can show `Z_active → 0` over time, even though `Z_total` keeps growing.
- A persistently disputed line of conversation cannot game the system: contested events stay `unresolved` until the contradiction is resolved by a downstream correction or receipt.
- An adversarial input cannot push `Z_active` down through the summary path — the summary policy only resolves events on receipts or correction chains, not on assertion.

### 4.4 What this does NOT enable

- It does not change the meaning of `θ_s` or `τ_coag`.
- It does not skip the 12-cycle confirmation window.
- It does not let any operator path bypass `check_coagulation`.
- It does not generate Omega via summary or via PotentialOmega advisory.

---

## 5. Multi-perspective fan-out

### 5.1 Default perspectives

| Perspective | What it tracks | Example center |
|---|---|---|
| `factual` | Truth-conditional claims | "Worker plans, never executes" |
| `preference` | User stylistic / behavioural preferences | "no emoji in responses" |
| `style` | Tone, register, formality | "concise, Romanian for spec discussion" |
| `security_boundary` | Hard refusals, air-gap, token policy | "Executor has `network_mode: none`" |
| `domain_verified` | Operator-asserted external facts (per v0.6.8) | "GDPR breach notification within 72h" |
| `project_state` | Versions, tags, commits, infra state | "main is at SHA `15a7c47`" |
| `execution_boundary` | What may be executed at all | "shell commands need Ed25519 signature" |
| `narrative` | Optional — long-form continuity in creative or research conversations | only enabled when the conversation domain warrants it |

### 5.2 How fan-out works

A raw user turn produces a single `MemoryEvent` as today, plus a per-perspective set of *signal projections*. Each non-empty projection contributes a `Z_contribution` to that perspective's center. The fan-out is deterministic given the turn text and the prototype centroids of the perspectives (similar to the v0.6.9 contextual stabilization classifier).

### 5.3 Why this helps natural Omega formation

In v0.6.x, a 300-turn conversation about Bavarian construction codes lights up one or two centers (mostly `construction/Bavaria`), and most other centers stay near-zero. With fan-out, the same conversation simultaneously builds `security_boundary` (mortar safety), `domain_verified` (DIN citations), `project_state` (which project the codes apply to), and `factual` (the codes themselves). Multiple centers reach measurable `S_t` independently — and each is still subject to the same θ_s / τ_coag rule. We are not making coagulation easier; we are giving multiple parallel chances for *one of them* to succeed honestly.

### 5.4 Hard rule (restated)

Fan-out is information layering, not coagulation acceleration. A `narrative` center coagulates ONLY when its own `S_t` trajectory clears θ_s for τ_coag consecutive cycles, with `Z_active` computed only from its own resolved-event accounting. There is no cross-perspective Omega lift.

---

## 6. `PotentialOmegaCenter` detector

### 6.1 Purpose

Surface the SET of centers that look like they MIGHT coagulate, so the operator can watch them and so the harness can report a "doorstep count". It is the radar; the registry is the runway.

### 6.2 Signals (sliding window K turns, default K = 8)

- `S_t_trend`: list of last-K `S_t` values; **rising** means each is ≥ previous minus a small δ.
- `AR_trend`: list of last-K alignment ratios; **stable** means within ±0.05 of the median.
- `κ_trend`: list of last-K expression-pattern values; **stable** means no jump > 0.10 between consecutive.
- `Z_active_trend`: list of last-K `Z_active` values; **non-increasing** means each ≤ previous + small δ.

A center is `potential_omega` when ALL four conditions hold simultaneously over the last K turns.

### 6.3 What happens when a center is flagged

```
emit telemetry: { "event": "potential_omega_observed", "center_id": "...", ... }
```

That is the entire write-side effect. No registry mutation. No advisory weight changes. No recall priority bump. The flag is consumed by:

- `priority-recommendations` advisory output (the existing v0.6.0 channel) — purely to expose to the operator
- the harness — to count and report

### 6.4 Why advisory-only

Because the moment we let `potential_omega` influence anything beyond visibility, we have created a side-door to Omega. The contract is: only `check_coagulation` ever writes Omega. Everything else, including this detector, is read-side.

---

## 7. `LongNaturalTranscriptHarness`

### 7.1 Shape

A research harness that runs **one** 300–1000-turn synthetic conversation through the full pipeline and records every signal. It is NOT the v0.6.x A/B benchmark — it is a single-thread deep replay. Its purpose is to surface whether any center crosses θ_s for τ_coag consecutive cycles under realistic conversational rhythm.

### 7.2 Transcript composition

The transcript is hand-authored (initially) and constrained to be *coherent within a single domain* over a long window, with realistic perturbations:

| Composition element | Target frequency |
|---|---|
| On-topic statements (factual / preference / domain) | 60-70% of turns |
| Corrections ("actually, X is Y, not Z") | 5-10% |
| Contradictions ("now I want the opposite of what I said earlier") | 3-5% |
| Receipts (action confirmed / failed) | 5-8% |
| Verified-fact citations (operator-asserted) | 5-8% |
| Domain-verified citations (DOMAIN_VERIFIED) | 5-8% |
| Recurring center references (re-touching the same center across long gaps) | 10-20% |
| Off-topic / chit-chat | < 5% |

This is the rhythm of a working conversation, not a benchmark adversarial-injection mix.

### 7.3 Domain candidates for v1

The harness should run in a domain where:

- The user is genuinely an expert (so the transcript is authentic, not LLM-generated).
- A coherent thread can be sustained for 300+ turns without artificially repeating.
- Multiple perspectives (§5.1) are naturally present.

Candidates: BYON-architecture deep-dive (operator already has the full mental model), construction codes (Bavaria) deep design conversation, or a multi-week project log. The choice is **open design question Q1 (§11)**.

### 7.4 What the harness measures

For each turn:

- per-center `S_t`, `B_t`, `Z_total`, `Z_active`, `Z_resolved`, `Z_archived`
- summary events emitted (with `Z_reduction`)
- `potential_omega_observed` telemetry
- any `check_coagulation` PASS (this is the headline number — we report `omega_observed_count` and `omega_observed_centers` for the run)

For each summary:

- `source_event_ids`, `resolved_event_ids`, `archived_event_ids`
- raw replay test: rebuild `Z_t` from raw events, verify the summary's `Z_reduction` claim holds

For the full run:

- max `S_t` reached per center (and turn index)
- longest `S_t ≥ θ_s` streak per center (and whether it reached τ_coag)
- `Z_active` end-of-run distribution
- audit recoverability: pick 10 random `archived` event_ids and verify the raw event is recoverable from disk

### 7.5 Reproducibility

The harness is seeded (`seed=42` for the embedder dropout / FCE-M numerical signature, identical to R10b family). Two runs from the same seed and the same transcript MUST produce identical telemetry. This is the bar for "reproducible" in C10.

---

## 8. PASS gates (Level 3 research, NOT release gates)

These are research-level gates. None of them is a release criterion for `main`. They are the conditions a demonstration must meet on this branch before we even start to discuss tightening them into a future release proposal.

| # | Gate | Criterion |
|---|---|---|
| L3-G1 | Omega only by check_coagulation | code audit: zero `OmegaRegistry.register` calls outside `check_coagulation` in this branch |
| L3-G2 | `S_t ≥ 0.28` at coagulation moment | logged per Omega event from harness |
| L3-G3 | `τ_coag = 12` consecutive cycles | the 12 prior-cycle `S_t` values are logged and verified ≥ 0.28 |
| L3-G4 | ReferenceField created only AFTER OmegaRecord | for every ReferenceField in the run, its parent Omega's `coagulated_at_turn` precedes it |
| L3-G5 | Disputed post-Omega contests expression but does NOT delete Omega | a deliberate post-Omega contradiction in the harness contests expression; the OmegaRecord row is still in the registry, with a contestation note |
| L3-G6 | `Z_active` decreases without deleting `Z_total` | end-of-run check: `Z_total` ≥ `Z_active` for every center; if any summaries emitted, at least one center has `Z_active < Z_total` |
| L3-G7 | Raw events recoverable | random-sample audit: 10 archived event_ids → all readable from disk with full payload |
| L3-G8 | `source_event_ids` complete | every summary's `source_event_ids` is non-empty and every id resolves |
| L3-G9 | No regression on D/E/F/M/N | A/B benchmark (v0.6.9.1 bench) re-run on this branch's tip MUST show D ≥ 5.00 - 0.2, E ≥ 5.00 - 0.2, F ≥ 5.00 - 0.2, M ≥ 5.00 - 0.2, N ≥ 4.60 - 0.2. The research components add no production load if disabled. |
| L3-G10 | No Level 3 claim on `main` until reproduced | `main` README and canonical facts continue to read "Level 2 of 4" until: gates L3-G1..L3-G8 all pass on this branch AND a second independent run (different seed or different transcript) shows at least one natural Omega forming under the same gates. |

**A single observed Omega is not a release.** It is the trigger for the conversation about whether to move toward Level 3 on `main`. The release decision belongs to the operator, not to the harness.

---

## 9. Non-goals (what this research will NOT do)

- **No forced Omega.** No "if no Omega has formed by turn 500, write one anyway" fallback. If none forms, the run reports zero.
- **No synthetic Omega.** No "the operator/LLM declares this center Omega" path.
- **No threshold lowering.** Not in this branch, not anywhere. θ_s / τ_coag stay at 0.28 / 12.
- **No Level 3 claim on `main`.** Not now, not after the first Omega forms — only after the criteria in §8 L3-G10 hold AND the operator says so.
- **No self-applying production memory yet.** Even when an Omega forms naturally on this branch, the production WhatsApp / orchestrator pipeline on `main` does NOT use that Omega until it has gone through the gate process.
- **No public Level 3 release claim.** No GitHub Release, no README update, no marketing material until §8 L3-G10 is met *and* explicitly approved.
- **No deletion of the older `research/level-3` branch** (if it exists). This work is on a NEW branch name to make the separation explicit.

---

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | The `Z_active` reframing produces apparent Omega coagulation but the underlying conversation never "really" stabilised | Audit test: replay raw events end-to-end; verify the same Omega forms; manual inspection of the 12 cycles by the operator |
| R2 | Summary policy resolves events too aggressively, dropping `Z_active` for tactical (not real) reasons | Deterministic v1 summary policy that resolves only on correction chains and confirmed receipts; LLM summaries explicitly excluded (open question Q3) |
| R3 | Fan-out + summary together produce a Goodhart's-law effect — we optimise for *any* center reaching θ_s, not for the *right* center | Per-perspective audit; a center that reaches Omega must have a coherent semantic identity an outside reader can describe |
| R4 | Reproducibility breaks across machines (different numpy / faiss / sentence-transformers minor versions) | Pin all numerical deps in `requirements-level3-research.txt` on this branch; seed everything; report the exact dep versions in every harness output |
| R5 | The harness transcript is too clean; real WhatsApp conversations would never produce one | After v1, replay against an anonymised real conversation log (operator decision) |
| R6 | The flag-but-don't-write contract on PotentialOmegaCenter leaks somewhere | Static analysis: zero `register` call sites outside `check_coagulation`; unit test that asserts the contract; replay invariant |
| R7 | This branch becomes the "real" Level 3 in folklore even though `main` stays Level 2 | Every doc on this branch carries the "Level 2 on `main`, no Level 3 claim" disclaimer; the technical report (when written) is explicit; release notes (if any) are explicit |

---

## 11. Open design questions (for operator decision before any code lands)

These are explicit asks before the first commit on this branch beyond this document.

| # | Question |
|---|---|
| Q1 | **Domain for the v1 harness transcript.** BYON-architecture deep-dive (operator already has the model)? Bavarian construction-codes (test-bench domain familiar from O2/O5/O7)? A multi-week project log? Each has trade-offs — BYON-arch is most authentic and reproducible but its centers may be small in number; construction has clear DOMAIN_VERIFIED hooks; project log has the most multi-perspective fan-out but is the noisiest. |
| Q2 | **Transcript length and authorship.** 300, 500, or 1000 turns? Hand-authored by the operator, or assembled from real conversation excerpts (anonymised)? Real excerpts are most representative; hand-authored is most controllable. |
| Q3 | **Are LLM-generated summaries admissible (after v1)?** The v1 design forbids them (deterministic policy only). v2 could relax — but only if we can prove the LLM-summary cannot game `Z_active` to push `S_t` over θ_s. This needs a separate adversarial test design before we admit it. |
| Q4 | **Fan-out depth.** All 8 perspectives in v1, or only the 4 most clearly demarcated (factual / preference / domain_verified / project_state)? Wider fan-out → more centers → more chances for Omega, but also more risk of Goodhart (R3). |
| Q5 | **`PotentialOmegaCenter` window K.** Default 8 turns. Operator may want K = 12 to match `τ_coag`; or smaller K = 5 to surface candidates earlier. |
| Q6 | **Audit criteria for "the same Omega forms in a second independent run" (L3-G10).** Second run = same transcript + different seed? Different transcript in same domain? Same transcript on a different machine? The choice affects how strong the reproducibility claim can be. |
| Q7 | **Where does the harness run.** On the operator's machine only (same setup as the v0.6.9.1 bench)? In CI as a separate workflow on this branch? In a sandbox container? CI gives stronger reproducibility evidence but uses GHCR space and run-time. |
| Q8 | **Branch isolation rigour.** Are the new components (CenterEventBuffer, RollingCenterSummary, etc.) implemented in a parallel `byon-orchestrator/level3-research/` directory that is *never imported* from production code on `main`? Or do we extend the existing FCE-M facade with feature-flagged hooks (off on `main`, on for this branch)? Parallel directory is safer; feature flags are more economical. |

These eight questions are the gate for *any* implementation work on this branch. The expected resolution path is: operator answers → this doc gets an addendum (or a §0 Decision Log like the v0.6.9 design doc) → THEN first implementation commit.

---

## 12. Branch policy

- Branch name: `research/level-3-natural-omega` (this branch).
- Branch base: `main` at `15a7c47` (post v0.6.9.1 + CI fix).
- `main` is NOT merged-into from this branch unless §8 L3-G10 is satisfied AND the operator explicitly approves a v0.7+ release proposal.
- This branch may diverge from `main` indefinitely. Periodic `git merge main` to keep up with bug fixes is allowed; the reverse is not.
- No tag created from this branch unless §8 L3-G10 holds AND the operator approves.
- No GitHub Release from this branch under any circumstances during the research phase.

---

## 13. Document policy

- This is a design document. **No code changes accompany it on this commit.**
- The doc is committed on `research/level-3-natural-omega` and is the entry point for the operator-decision phase.
- After operator decides Q1–Q8, an addendum or §0 Decision Log will be added to this same file, then the first implementation commit lands.
- The doc may be amended on this branch as the research progresses. Amendments are visible in git history.

---

*Design only. No implementation. No tag. No release. Operational classification on `main` remains Level 2 of 4 — Morphogenetic Advisory Memory. Awaiting operator decisions on Q1–Q8 (§11) before any code lands.*
