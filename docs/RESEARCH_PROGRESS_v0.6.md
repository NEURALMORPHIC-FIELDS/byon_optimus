# BYON Optimus × FCE-M — Research Progress (v0.6 cycle)

*Document status: research-in-progress. Last updated: 2026-05-11.*

> This document is the scientific narrative of the integration of [FCE-M v0.6.0](https://github.com/NEURALMORPHIC-FIELDS/fragmergent-causal-exponentiation-memory) (Fragmergent Causal Exponentiation Memory) into [BYON Optimus](https://github.com/NEURALMORPHIC-FIELDS/byon_optimus) (MACP v1.1 multi-agent orchestration). It documents the v0.6.0 baseline integration and the iterative v0.6.1 → v0.6.4 research line aimed at producing measurable morphogenetic dynamics through the conversational pipeline. The document reports both successful results and honest negative results (factors that block OmegaRecord coagulation under default thresholds).

## Table of contents

1. [Theoretical framing](#1-theoretical-framing)
2. [Integration architecture](#2-integration-architecture)
3. [Research questions](#3-research-questions)
4. [Methodology](#4-methodology)
5. [Experimental results — per stage](#5-experimental-results--per-stage)
6. [Cross-stage trend](#6-cross-stage-trend)
7. [Classification](#7-classification)
8. [Honest negative results](#8-honest-negative-results)
9. [Open problems / future work](#9-open-problems--future-work)
10. [Reproduction](#10-reproduction)
11. [References & artefacts](#11-references--artefacts)

---

## 1. Theoretical framing

FCE-Ω (Fragmergent Causal Exponentiation, the morphogenetic layer of FCE-M) is a passive observer that tracks per-semantic-center dynamics through a self-index

$$
S_t = AR_t \cdot \kappa_t \cdot I_t \cdot B_t
$$

with

- $AR_t = \frac{|\Phi_s^\top \Pi_s \Phi_s|}{\|\Phi_s\|^2}$ — autoreferential coupling on the perspective field $\Phi_s$,
- $\kappa_t \in [0.01,\,1]$ — internal coherence,
- $I_t = \frac{\|E_t\|}{\|\Delta X_t\| + \varepsilon}$ — integration ratio (energy captured per unit of state change),
- $B_t = \frac{1}{1 + \|Z_t\|}$ — residue stability (decreases as un-integrated residue accumulates).

Coagulation fires when $S_t \ge \theta_s$ for $\tau_{\text{coag}}$ consecutive cycles, registering an irreversible **OmegaRecord** and projecting a **ReferenceField** from its frozen signature. Subsequent observations on the same center are classified morphogenetically (`aligned`, `expression_reinforcing`, `tensioned`, `orthogonal`, `contested_expression`, `residue_amplifying`) — while epistemic truth verdicts (committed / provisional / disputed / rejected) remain authoritative and unchanged.

FCE-M defaults: $\theta_s = 0.28$, $\tau_{\text{coag}} = 12$. These thresholds are kept fixed throughout the present research line; we do not relax them to manufacture coagulation.

## 2. Integration architecture

```
                            +------------------+
       (WhatsApp / CLI)     |   Conversation   |
   ─────user message ──────▶|     surface      |───── reply ─────▶ user
                            +---------+--------+
                                      │
                  +-------------------▼-------------------+
                  |  store conversation + extract facts   |
                  |  (LLM distillation, v0.6.2)           |
                  +-------------------+-------------------+
                                      │
                +---------------------▼--------------------+
                |        memory-service (port 8000)        |
                |  ┌──────────────┐    ┌─────────────────┐ |
                |  │  FAISS       │    │  FCE-M v0.6.0   │ |
                |  │  IndexFlatIP │◀──▶│  UnifiedMemory- │ |
                |  │  (cosine     │    │  Store +        │ |
                |  │  retrieval)  │    │  FCE-Ω observer │ |
                |  └──────────────┘    └─────────────────┘ |
                +---------------------+--------------------+
                                      │
              ┌────── recall + morphogenesis_report ───────┐
              │                                            │
              ▼                                            │
    +─────────────────+  EvidencePack +─────────────────+  │
    │  Worker         │  + fce_context│  Auditor        │  │
    │  plans, never   ├──────────────▶│  validates +    │  │
    │  executes       │  metadata-only│  Ed25519 signs  │  │
    +─────────────────+               +────────+────────+  │
                                               │           │
                                       signed  ▼           │
                                       ExecutionOrder      │
                                       (network_mode:none) │
                                       +─────────────────+ │
                                       │  Executor       │ │
                                       │  air-gapped     │ │
                                       +────────+────────+ │
                                                │          │
                                       JohnsonReceipt      │
                                                │          │
                          fce_assimilate_receipt│          │
                          (success→aligned,     ▼          │
                           failed→residue,  +─────────────┐│
                           rejected→contested)│ FCE-M     │┘
                                              │ feedback  │
                                              +───────────+
```

**Invariants** (preserved across all v0.6.x stages):

- Worker plans, does not execute.
- Auditor signs the ExecutionOrder; it never executes.
- Executor runs `network_mode: none`; only Ed25519-signed orders are accepted.
- FCE-M may **shape attention and risk advisory** in EvidencePack, but **never approves an action, never overrides Auditor truth verdicts, and never bypasses user approval gates**.
- `EvidencePack.fce_context` is metadata-only (counts and hashed center identifiers; no labels, no text content).

## 3. Research questions

- **RQ1 (compatibility).** Can FCE-M be integrated into BYON without weakening the existing security boundaries or the backward-compatible memory API?
- **RQ2 (operational level).** Which native-memory level does the integrated system achieve?
  1. Semantic memory only.
  2. Morphogenetic advisory memory.
  3. Native memory with operational ReferenceFields (Omega coagulation from the BYON loop).
  4. Self-applying memory (orchestrator autonomously consumes its own advisory without LLM mediation).
- **RQ3 (coagulation feasibility).** Can OmegaRecord coagulation be reached through the conversational pipeline with default thresholds? If not, which factor of $S_t = AR \cdot \kappa \cdot I_t \cdot B_t$ is the operative bottleneck?

## 4. Methodology

We measure the integration with two complementary instruments:

### 4.1 BYON-FCE-M Deep Functional Test Suite

Located at [`byon-orchestrator/scripts/byon-fcem-deep-suite.mjs`](../byon-orchestrator/scripts/byon-fcem-deep-suite.mjs). The suite drives 100+ live assertions through 12 categories (A–L) against a running memory-service and against Claude Sonnet 4.6:

| Cat | Focus |
|---|---|
| A | Baseline compatibility (legacy API preserved) |
| B | Longitudinal memory across a 30-turn dialogue with corrections |
| C | Contradiction / residue handling |
| D | Omega / ReferenceField emergence in the BYON loop |
| E | Auditor `fce_context` gate (adversarial) |
| F | Executor isolation (dangerous prompts) |
| G | Receipt assimilation status mapping |
| H | Cross-thread separation |
| I | Persistence on disk |
| J | Performance metrics |
| K | Hallucination guard |
| L | End-to-end conversation quality |

Reports are emitted as paired Markdown / JSON in [`test-results/`](../test-results/).

### 4.2 Coagulation feasibility harness

Located at [`byon-orchestrator/scripts/byon-coagulation-harness.mjs`](../byon-orchestrator/scripts/byon-coagulation-harness.mjs). Drives N (default 60) semantically coherent paraphrases on a single morphogenetic center, captures per-cycle records of $S_t$, $AR_t$, $\kappa_t$, $Z_{\text{norm}}$, $\Delta X_{\text{norm}}$, $\omega$, `newly_coagulated`, and runs a bottleneck-diagnosis decomposition.

## 5. Experimental results — per stage

### 5.1 v0.6.0 — Baseline integration

Hybrid backend wiring (FAISS + FCE-M). Symbolic slot_events written per BYON memory type. Deep functional suite established (initially 91 assertions; later extended to 130).

| Metric | Value |
|---|---|
| Deep-suite pass rate | 118 / 130 (90.8 %) |
| Security boundary (E + F) | 27 / 27 |
| Classification | **Level 2** |
| Honest gaps | OmegaRecord did not coagulate; H (cross-thread leak); L (LLM lacked architectural facts) |

### 5.2 v0.6.1 — Thread-scoped semantic recall

`MemoryHandlers.store_*` persists `thread_id` in FAISS row metadata. `_search_by_type` accepts an optional `thread_id` and a `scope ∈ {"thread", "global"}`; default is `"thread"` and rows whose `thread_id` mismatches are filtered post-search. Cache keys include thread to prevent cross-thread bleed.

| Metric | Value |
|---|---|
| Deep-suite pass rate | 123 / 134 (91.8 %) |
| H category | 10 / 10 |
| Cross-thread leak | Eliminated |

### 5.3 v0.6.2 — Fact extraction

[`scripts/lib/fact-extractor.mjs`](../byon-orchestrator/scripts/lib/fact-extractor.mjs) distils user turns into structured facts (`user_preference`, `architecture_rule`, `security_constraint`, `correction`, `project_fact`, `identity`). Architecture / security / identity facts are written with `thread_id = null` and tagged `__system__`; the v0.6.2 search filter treats `thread_id = None` rows as system-scope, visible across all threads. User-scope facts remain thread-scoped.

`fcem_backend._entity_for` now prefers `thread_id` as the FCE entity_id for facts, so morphogenetic centers stay thread-aligned and do not pollute neighbouring threads.

| Metric | Value |
|---|---|
| Deep-suite pass rate | 126 / 139 (90.6 %) |
| L probes "Who approves?" / "Executor air-gap?" | PASS via system-scope facts |

### 5.4 v0.6.3 — Field-signature injection

`assimilate_event` is extended with an optional `embedding` argument. When present, a *companion numerical write* `{vector, entity_id, attr_type}` is issued alongside the symbolic slot_event so FCE-Ω receives an actual field signature for the center. Receipts derive a deterministic 16-dim signature (one-hot status, token counts, latency, hash perturbation).

| Metric | Value |
|---|---|
| Deep-suite pass rate | 132 / 139 (95 %) |
| AR_t (mean / max) | 0.853 / **1.000** |
| κ_t (mean / max) | 0.431 / 0.979 |
| S_t (max observed) | 0.109 |
| OmegaRecord coagulation | **Not reached** |

`AR_t` is no longer the limiter. Coagulation does not occur because $S_t < \theta_s = 0.28$.

### 5.5 v0.6.4a — System knowledge bootstrap

A fixed corpus of 18 architectural / security / identity facts ([`scripts/lib/byon-system-facts.mjs`](../byon-orchestrator/scripts/lib/byon-system-facts.mjs)) is seeded into the memory-service at startup (idempotent), and ALSO injected directly into every LLM system prompt via `renderCanonicalFactsBlock()`. Retrieval-independent grounding.

| Metric | Value |
|---|---|
| Deep-suite pass rate | **139 / 144 (96.5 %)** |
| L category | 13 / 13 |
| Security boundary (E + F) | 27 / 27 |
| Probes "List 3 MACP agents", "Does Worker execute?", "What document does Auditor sign?", "What document does Executor produce?", "Is Executor air-gapped?" | All PASS |

### 5.6 v0.6.4b — Center-coherent coagulation harness

60 paraphrases of `byon::execution_boundary` rule (Auditor exclusive approval authority) driven against the harness. Per-cycle metric capture:

| Metric | min | mean | max |
|---|---|---|---|
| $S_t$ | 0.0147 | 0.0418 | **0.112** |
| $AR_t$ | 0.715 | 0.853 | 1.000 |
| $\kappa_t$ | 0.172 | 0.431 | 0.979 |
| $Z_{\text{norm}}$ | 1.287 | 7.221 | **31.305** |
| $\Delta X_{\text{norm}}$ | 2.002 | 2.002 | 2.002 |

`Z_norm` grows roughly linearly with the number of coherent events. $B_t$ proxy = $1/(1 + 7.22) \approx 0.12$. The harness automatically diagnoses:

> **Bottleneck: B_t (residue stability) — Z accumulates.**

This empirically validates the *a priori* prediction that a conversational field, however coherent, accumulates residue under the present observer dynamics, preventing $S_t$ from sustaining above threshold.

### 5.7 v0.6.4c — Assimilation / residue tuning

Three strategies attempted in `fcem_backend.assimilate_event`, gated on a per-center embedding LRU history and a cosine-similarity threshold:

1. **Suppress symbolic write on coherent repeat** ($\text{sim} > 0.92$). Effect: $Z_{\text{norm}}$ dropped from 31 to ≈ 8.6; **AR collapsed** to 0.44 because AR is built primarily by symbolic slot_events (the v0.6.3 numerical companion is observed by `tf_engine` but does not register in the FCE-Ω perspective field).
2. **Use a stable anchor label** for coherent repeats (preserve symbolic write, share label). Effect: AR remained ≈ 0.85; $Z_{\text{norm}}$ unchanged (slot_event itself contributes residue regardless of label). Max $S_t$ = 0.153 (+37 % over v0.6.4b).
3. **20 unique events on the same center**. Effect: $Z_{\text{norm}}$ reduced to ≈ 5.8; $\kappa_t$ collapsed to 0.31 (insufficient repetition).

No combination produced $S_t \ge 0.28$ for 12 consecutive cycles. The catch-22 is structural: repetition pumps $Z$; uniqueness drops $\kappa$.

## 6. Cross-stage trend

| Stage | Deep-suite pass | Max $S_t$ (harness) | Max $Z$ | Operative bottleneck |
|---|---|---|---|---|
| v0.6.0 | 118/130 (90.8 %) | (n/a) | (n/a) | — |
| v0.6.1 | 123/134 (91.8 %) | (n/a) | (n/a) | thread leakage fixed |
| v0.6.2 | 126/139 (90.6 %) | (n/a) | (n/a) | fact extraction added |
| v0.6.3 | 132/139 (95.0 %) | 0.109 | varied input | AR raised to 1.0 |
| v0.6.4a | **139/144 (96.5 %)** | (n/a) | (n/a) | L architecture knowledge fixed |
| v0.6.4b | (harness) | 0.112 | **31.3** | **B_t (Z accumulation)** |
| v0.6.4c | (harness) | **0.153** | 8.6–31.3 | catch-22 between $Z$ and $\kappa$ |

Net gain in $S_t$ max over v0.6.0 → v0.6.4c: **+55 %** (0.099 → 0.153). Threshold $\theta_s = 0.28$ remains uncrossed.

## 7. Classification

We adopt a four-level scale for native-memory behaviour:

1. **Semantic memory only** — FAISS retrieval, no morphogenetic dynamics.
2. **Morphogenetic advisory memory** — FCE-M produces advisory feedback that grows with coherent / contradictory events; pipeline surfaces it but does not coagulate centers.
3. **Native memory with operational ReferenceFields** — OmegaRecord coagulation observed from the BYON loop, ReferenceField projected, contestation classification active.
4. **Self-applying memory** — orchestrator autonomously consumes FCE advisory to adapt its own pipeline (gate, re-route, throttle) without LLM mediation.

**Current placement: Level 2.**

- Level 1 is satisfied by the FAISS substrate.
- Level 2 is satisfied by FCE-M advisory growing measurably with coherent and contradictory inputs (deep suite C category, harness Z dynamics).
- Level 3 is *not* satisfied: OmegaRecord coagulation has not been reproduced through the BYON loop under default thresholds.
- Level 4 is explicitly **not claimed**: the bridge surfaces FCE advisory in the LLM system prompt; the LLM may react to it conversationally but the *pipeline itself* does not change strategy autonomously.

## 8. Honest negative results

We report negative results without lowering thresholds:

- **OmegaRecord coagulation through BYON loop.** Not reproduced in 7 distinct experimental configurations (v0.6.0–v0.6.4c). Max sustained $S_t$ = 0.153 vs threshold 0.28; longest above-threshold streak = 0 / 12 required.
- **ReferenceField projection through BYON loop.** Dependent on coagulation; therefore not reproduced.
- **Numerical companion write feeding AR through the observer.** v0.6.3 added a numerical companion to the symbolic slot_event. AR increased — but the v0.6.4c suppression experiment shows that when *only* the numerical write fires, AR collapses to 0.44. Inference: AR is built by symbolic events; the numerical write feeds tf_engine bank but is not (currently) observable to the FCE-Ω perspective accumulator.
- **Self-applying advisory.** The orchestrator does not yet act on `fce_priority_recommendations` without LLM mediation.

## 9. Open problems / future work

The following directions remain open, none of which involves lowering $\theta_s$ or $\tau_{\text{coag}}$:

1. **Rolling center summary.** Periodically replace N coherent events on a center with a single distilled "anchor fact" stored back into FCE-M. Aim: reduce effective event rate without losing information, suppressing $Z$ without starving $AR$.
2. **Multi-perspective observer fan-out.** `fce_multiperspectival_enabled` is set but unexplored. The multi-perspective layer may decouple residue accumulation per perspective channel.
3. **Numerical → observer bridge.** Re-routing of `{vector, entity_id, attr_type}` writes through `bridges/fce_translator.py` so the FCE-Ω observer receives a numerical-field signal directly. Requires FCE-Ω internal study.
4. **Conversational coagulation pathway in FCE-Ω.** The theoretical contribution would be a separate coagulation regime tuned for natural-language input fields — not a parameter change, but a different cycle / residue accounting for repetition vs novelty.
5. **Level 4 prototype.** Wire `fce_priority_recommendations` directly into a Worker / Auditor decision policy (e.g. "delay consolidation; incubate" automatically defers a plan), without an LLM in the loop.

## 10. Reproduction

Prerequisites: Node ≥ 18, Python ≥ 3.10, Anthropic API key.

```bash
# Memory-service (FAISS + FCE-M hybrid)
cd byon-orchestrator/memory-service
MEMORY_BACKEND=hybrid FCEM_ENABLED=true \
    FCEM_CONSOLIDATE_EVERY_N=3 \
    FCEM_COHERENT_REPEAT_THRESHOLD=0.92 \
    python -u server.py

# Deep functional suite (12 categories, ~144 assertions, ~5–10 min)
cd byon-orchestrator
node --env-file=../.env scripts/byon-fcem-deep-suite.mjs

# Coagulation harness (single center, 60 events)
node --env-file=../.env scripts/byon-coagulation-harness.mjs \
     --center "byon::execution_boundary" --events 60 --consolidate-every 1
```

Outputs are emitted to `test-results/`. Vitest baseline (`npm test` from `byon-orchestrator/`) currently reports 435 / 435 across the unchanged orchestrator tests.

## 11. References & artefacts

### Software dependencies

- BYON Optimus (this project) — [`github.com/NEURALMORPHIC-FIELDS/byon_optimus`](https://github.com/NEURALMORPHIC-FIELDS/byon_optimus).
- FCE-M v0.6.0 — [`github.com/NEURALMORPHIC-FIELDS/fragmergent-causal-exponentiation-memory`](https://github.com/NEURALMORPHIC-FIELDS/fragmergent-causal-exponentiation-memory) (BSD-3-Clause).
- Claude Sonnet 4.6 (`claude-sonnet-4-6`) — Anthropic API.
- `@whiskeysockets/baileys` — WhatsApp transport (used as the OpenClaw substitute in the conversational surface).
- FAISS `IndexFlatIP`, sentence-transformers `all-MiniLM-L6-v2` (384-dim) — retrieval substrate.

### Empirical artefacts (this cycle)

| Artefact | Stage |
|---|---|
| [`test-results/fcem-integration-report.md`](../test-results/fcem-integration-report.md) | v0.6.0 baseline integration report |
| [`test-results/fcem-deep-functional-report.md`](../test-results/fcem-deep-functional-report.md) | most-recent deep-suite run (currently v0.6.4a) |
| [`test-results/fcem-deep-v0.6.1-report.md`](../test-results/fcem-deep-v0.6.1-report.md) | v0.6.1 deep suite |
| [`test-results/fcem-deep-v0.6.2-report.md`](../test-results/fcem-deep-v0.6.2-report.md) | v0.6.2 deep suite |
| [`test-results/fcem-deep-v0.6.3-report.md`](../test-results/fcem-deep-v0.6.3-report.md) | v0.6.3 deep suite |
| [`test-results/fcem-deep-v0.6.4a-report.md`](../test-results/fcem-deep-v0.6.4a-report.md) | v0.6.4a deep suite |
| [`test-results/fcem-coagulation-harness-v0.6.4b.md`](../test-results/fcem-coagulation-harness-v0.6.4b.md) | v0.6.4b coagulation feasibility harness |
| [`test-results/fcem-coagulation-harness-v0.6.4c.md`](../test-results/fcem-coagulation-harness-v0.6.4c.md) | v0.6.4c assimilation tuning experiments |
| [`test-results/v0.6.4-synthesis.md`](../test-results/v0.6.4-synthesis.md) | cross-stage synthesis report |

### Patents and licences

- Patent **EP25216372.0** — Omni-Qube-Vault (related, separately held) — Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L., Cluj-Napoca, Romania.
- BYON Optimus is licensed proprietary; FCE-M is licensed BSD-3-Clause; vendored FCE-Ω source carries its own proprietary terms.

---

*Status: research-in-progress. The findings reported here reflect the present state of the BYON × FCE-M integration on 2026-05-11 and may evolve with further experimentation. All negative results are reported in full; thresholds are not relaxed to obtain a more flattering classification.*
