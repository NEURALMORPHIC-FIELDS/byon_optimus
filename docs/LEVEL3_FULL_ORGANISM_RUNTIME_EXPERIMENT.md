# Level 3 Full Organism Runtime Experiment

> Branch: `research/level3-full-organism-runtime` (forked from `main` @ `15a7c47`).
> Production branch on `main` remains at **Level 2 of 4 (Morphogenetic
> Advisory Memory)** and is not modified by this experiment.

This document records the next step after the isolated diagnostic
research line on branch `research/level-3-natural-omega` was closed
by commit 13. It explains **why** the isolated approach is
insufficient as a Level 3 validation, **what** the full-organism
experiment runs, and **what is forbidden** under it.

---

## 1. Why the isolated branch is diagnostic, not validation

`research/level-3-natural-omega` produced 13 sequential commits, with
242 tests passing on the research suite and zero diff against
production code paths. It demonstrated:

- a deterministic projection / Z-metabolism / summary / detector / harness
  pipeline,
- two 500-turn hand-authored transcripts,
- an A/B comparison + formal L3-G1..L3-G10 gate audit,
- a surrogate-level controlled coagulation observation,
- and an isolated real-FCE-M observation adapter.

Each component was tested *in isolation* — the harness replays
transcript events into a fresh `Agent`, with no Claude API in the loop,
no production embeddings, and no relational coupling between centers.
That is appropriate for diagnostics but it is not a morphogenetic
system. **A morphogenetic system is, by construction, a coupled
organism whose centers stabilize through the relational field that the
full runtime produces.**

The isolated branch therefore remains diagnostic / reference only and
must not be merged into `main`. This new branch starts fresh from main.

## 2. What commit 13 proved

Commit 13 on the isolated branch closed it with the explicit synthesis
`level3_research_synthesis_after_real_fce.md`. Concretely:

- **Z_active semantics works.** Conservation invariant holds on both
  500-row replays with `audit_flags = []`.
- **Summaries preserve `Z_total` and reduce `Z_active`.** A: 105
  summaries → z_active 34.75/151.40 (≈23 %). B: 130 summaries →
  z_active 22.30/144.40 (≈15 %).
- **PotentialOmega surrogate signals reproduce across A and B.** 49 + 76
  signals, all `advisory_only = True`.
- **Surrogate temporal rule passes.** Commit 11 verdict
  `ISOLATED_RULE_OBSERVED_NO_OMEGA_CREATED`.
- **Real FCE-M math does NOT coagulate.** Commit 12 verdict
  `REAL_FCE_NO_COAGULATION` across all six (bucket × transcript) pairs.

Max real `S_t` observed across all six observations: **≈ 0.13–0.14**;
`longest_run_above_theta = 0`. `theta_s = 0.28` and `tau_coag = 12`
remained unchanged in every artifact.

## 3. Why commit 12 blocked Level 3 under real FCE-M

Real FCE-M computes the self-index as a **multiplicative product**:

    S_t = AR * kappa * I_t * B_t

where each factor is in `[0, 1]`. The isolated adapter fed the
production `Agent` deterministic SHA-256-derived field vectors
because the operator's isolation rules forbade LLM and embedding
imports on that branch. Hash-derived vectors are reproducible but
have **no semantic alignment** with the agent's internal direction
`Phi_s`. The component `I_t = ||E|| / (||delta_X|| + eps)` — where
`E` is the Phi_s-aligned excitation — therefore stayed small, and
the product `S_t` stayed near 0.13 max.

## 4. Why the bottleneck is `I_t / semantic assimilation fidelity`

The arithmetic mean surrogate (`(AR + kappa + B_t) / 3`) stayed high
because three near-one quantities average to near one. The product
form collapses if any single factor is small. `I_t` was the small
factor and it was small **specifically because the field vectors
lacked alignment with `Phi_s`** — the production rule does not see a
recognizable self-direction in hash-derived vectors. The production
FCE-M is conservative by design: it refuses to declare coagulation on
alignment-free noise. That is the correct behavior.

## 5. Why the isolated event is insufficient

The diagnostic harness asks: *can a sequence of isolated events
trigger coagulation under FCE-M?* The answer commit 12 returned is
*no, on hash inputs* — but this answer does not tell us whether real
events, embedded in a full runtime with retrieval, trust ranking,
prompt building, response generation, fact extraction, receipt
assimilation and FCE consolidation, would produce sufficient `I_t`.
The hypothesis under test is exactly that hypothesis.

## 6. Why the relational field is the architectural unit

In the isolated harness a center accumulates `z_active` from events
that the projection policy assigns to it. The center does not feel
the support of other centers (a verified project fact that *stabilizes*
the release state center, for example). The production runtime, by
contrast, routes facts across trust tiers, runs compliance, and lets
multiple sources reinforce or contest the same center.

This is what `RelationalFieldRegistry` instruments: not just events
on a center, but typed relations between centers, facts, claims,
rules and boundaries. The relational layer is read-only: it does not
write to OmegaRegistry, it does not create OmegaRecord, it does not
create ReferenceField. It records the structure that the full
runtime exhibits during a scenario.

## 7. Why Claude API must be live

Without a live LLM in the loop the runtime has no semantic surface.
Prompt building, fact extraction (LLM-driven), and response generation
all depend on a real Claude Sonnet 4.6 call. A mock LLM would
re-introduce exactly the isolation problem the isolated branch
demonstrated. The official run requires `ANTHROPIC_API_KEY` to be
present and a real call to be made; in the absence of `ANTHROPIC_API_KEY`
the runner emits the verdict
`CLAUDE_API_REQUIRED_FOR_FULL_ORGANISM_TEST` and refuses to claim a
full-organism result.

The runner does NOT impose a cost ceiling. Tokens and estimated cost
are measured and reported per turn; the decision to run a long
scenario belongs to the operator.

## 8. Which BYON organs are active

The runner uses the production memory-service pipeline. Active organs:

- **Memory store** — `store` action (conversation + user message +
  assistant reply).
- **Retrieval** — `search_all` (FAISS over conversations + facts +
  code) and trust-tier-aware re-rank.
- **System prompt builder** — same as `byon-chat-once.mjs` template
  plus injected canonical facts.
- **FCE-M advisory layer** — `fce_morphogenesis_report`,
  `fce_state`, `fce_priority_recommendations`, `fce_advisory`.
- **Claude Sonnet 4.6** — live API call with `messages.create`.
- **Receipt assimilation** — `fce_assimilate_receipt` after each turn.
- **Fact extraction** — production `scripts/lib/fact-extractor.mjs`
  (LLM-driven), the optional path that promotes turn content to
  `verified_fact_add` candidates.
- **FCE consolidate** — `fce_consolidate` at scenario boundaries.
- **Trust hierarchy** — `verified_fact_list`, `domain_fact_search`,
  the trust-tier surfaces.
- **Contextual Pathway Stabilization v0.6.9.1** — already part of the
  production memory-service.
- **OmegaRegistry / ReferenceField snapshots** — `fce_omega_registry`,
  `fce_reference_fields` captured per turn for the report.

## 9. What instrumentation is read-only

The new `byon-orchestrator/scripts/lib/relational-field.mjs` exposes
`RelationalFieldRegistry`, `RelationEvent`, `RelationType`,
`CenterFieldState`, `RelationTension`, `FieldCoherence`,
`FieldResonance`. The runner instantiates these objects from the
per-turn telemetry that memory-service exposes; it does **not** write
back to memory-service. The objects exist only in the runner process
for the duration of the run, are serialized to JSONL artifacts in
`test-results/level3-full-organism-live/`, and have no side effects.

Optional experimental memory-service endpoints (`/level3/...`) are
**also** read-only and are registered only when
`BYON_LEVEL3_FULL_ORGANISM_EXPERIMENT=true`. When the flag is unset
the endpoints either return 403 or are not registered at all, and
production behavior is byte-identical to upstream.

## 10. How the experiment's memory is isolated

Every memory write the runner makes carries the marker fields:

    {
      "run_id":              "<uuid-or-iso>",
      "scenario_id":         "<scenario-1 | scenario-2>",
      "thread_id":           "level3_full_organism_<run_id>",
      "is_level3_experiment": true,
      "channel":             "level3-experiment-runner"
    }

The `thread_id` prefix `level3_full_organism_` is reserved exclusively
for the experiment. The runner exposes
`--cleanup-run <run_id>` to delete the conversation entries in that
namespace. The runner never auto-deletes; cleanup requires explicit
operator invocation.

Production conversations on other thread ids are untouched.

## 11. What "live" means

This experiment uses precise definitions for each service:

| Service | "Live" means |
|---|---|
| **Claude** | `ANTHROPIC_API_KEY` present, `messages.create` to `claude-sonnet-4-6` succeeds, model id + tokens recorded. |
| **memory-service** | `GET /health` returns `status: healthy`; a round-trip `store` + `search` on the experiment namespace returns the stored content. |
| **FAISS** | a `search_all` returns a hit with a real cosine similarity (not a hash-equality fallback). |
| **production embeddings** | the embedder loaded by memory-service is the production model (not a `SimpleEmbedder` fallback); the runner's pre-flight asserts this via the `stats` action. |
| **FCE-M backend** | `fce_state`, `fce_morphogenesis_report`, `fce_omega_registry`, `fce_reference_fields`, `fce_consolidate`, `fce_assimilate_receipt` all respond. |

If any of these check fails, the runner records the failure and emits
a verdict from the admitted set (typically
`CLAUDE_API_REQUIRED_FOR_FULL_ORGANISM_TEST` for the API case, or
`INCONCLUSIVE_NEEDS_LONGER_RUN` for partial-service degradation).

## 12. Why a single Omega observation is not Level 3

If, during a live run, the production FCE-M observer naturally
detects `S_t >= 0.28` for 12 consecutive cycles and writes a fresh
`OmegaRecord`, the run reports
`OMEGA_OBSERVED_BY_CHECK_COAGULATION_NO_MANUAL_WRITE`. This is a
**research observation**, not a Level 3 declaration. Level 3 requires
all three of:

- **Independent reproduction (L3-G10).** The same coagulation pattern
  must be observed in a second run, ideally with a different operator
  identity, different scenario seeds and different transcript
  workload.
- **No regression (L3-G9).** The D / E / F / M / N benchmark suites
  on `main` must continue to pass. The research branch is zero-diff
  against production paths and therefore does not regress production
  by construction; the explicit benchmark run is a separate gate.
- **Operator approval.** A separate, deliberate operator decision —
  not an automatic verdict.

The runner therefore never emits the strings
`LEVEL_3_REACHED`, `OMEGA_CREATED_MANUALLY`, `SYNTHETIC_OMEGA`,
`THRESHOLD_LOWERED`, or `REFERENCEFIELD_CREATED_WITHOUT_OMEGA` —
those are the operator-locked forbidden verdicts.

## 13. Cost handling (operator decides)

The runner measures and reports per turn:

- `model_id`,
- `input_tokens`,
- `output_tokens`,
- `latency_ms`,
- `estimated_cost_usd` (best-effort, public pricing table).

It also reports `total_run_estimated_cost_usd` at the end of the run.
The runner does **not** impose a hard ceiling, does **not** abort on
cost, and does **not** require `--max-cost-usd`. CLI options
`--estimate-cost` and `--report-cost` are read-only inspections. The
operator owns the decision to launch a long scenario.

## 14. What is forbidden

- Modifying `theta_s = 0.28` or `tau_coag = 12` anywhere.
- Modifying `check_coagulation` or the FCE-M vendor.
- Calling `OmegaRegistry.register(...)` manually.
- Creating `OmegaRecord` instances manually.
- Creating `ReferenceField` before an `OmegaRecord` exists.
- Introducing the identifier `is_omega_anchor`.
- Declaring Level 3 on `main`.
- Tagging or creating a GitHub Release.
- Changing production default behavior when the env flag
  `BYON_LEVEL3_FULL_ORGANISM_EXPERIMENT` is absent. The test
  `production default behavior unchanged when flag OFF` enforces this.
- Calculating a fake `S_t` and presenting it as the production
  `S_t`. Relational-field metrics are reported in a separate
  section, with separate field names (`field_coherence`,
  `field_resonance`, `field_tension`), and are never claimed to
  replace `S_t`.
- Emitting the forbidden verdict strings as standalone identifiers
  in any artifact.
- Auto-cleaning the experiment memory namespace. Cleanup happens
  only when the operator passes `--cleanup-run <run_id>`.

---

## Branch contents (this commit)

- `docs/LEVEL3_FULL_ORGANISM_RUNTIME_EXPERIMENT.md` — this document.
- `byon-orchestrator/scripts/lib/relational-field.mjs` —
  read-only relational-field instrumentation library.
- `byon-orchestrator/scripts/level3-full-organism-live-runner.mjs` —
  the full-organism live runner CLI.
- `byon-orchestrator/scripts/lib/level3-flag.mjs` — env-flag helper
  with strict boolean parsing.
- `byon-orchestrator/scripts/lib/scenarios/scenario-1-byon-arch.mjs` —
  Scenario 1 fixture.
- `byon-orchestrator/scripts/lib/scenarios/scenario-2-adversarial.mjs` —
  Scenario 2 fixture.
- `byon-orchestrator/memory-service/level3_experimental_endpoints.py` —
  env-flagged read-only endpoints registered only when the flag is on.
- `byon-orchestrator/tests/unit/level3-full-organism.test.mjs` —
  Vitest tests (14 required).
- `test-results/level3-full-organism-live/.gitkeep` — output dir
  scaffold.

The default production behavior is unchanged when the env flag is OFF;
this is enforced by tests.
