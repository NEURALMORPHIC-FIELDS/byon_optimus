# BYON Optimus — Architecture

> **Status:** Level 2 full-organism confirmed. The MACP / FCE-M / hybrid-memory snapshot below started as the v0.6.4 reference and remains accurate; commit 17 added structural references in the production pipeline, PR #3 validated the organism (BYON +34.94 % vs Claude Sonnet 4.6 direct, 7 / 7 gates PASS), PR #4 stabilized the test harness (586 / 586 tests pass).
>
> - Operational level: **Level 2 of 4 — Morphogenetic Advisory Memory**
> - Level 3: **not declared**
> - Natural Omega: **not proven**
> - `θ_s = 0.28`, `τ_coag = 12`: operator-locked
> - Short status: [`LEVEL_STATUS.md`](LEVEL_STATUS.md) — End-to-end record: [`VALIDATION_SUMMARY.md`](VALIDATION_SUMMARY.md) — Research history (v0.6.0 → v0.6.4): [`RESEARCH_PROGRESS_v0.6.md`](RESEARCH_PROGRESS_v0.6.md).

## Active organism — input to telemetry

The Contextual Capability Archive (v0.7 infrastructure, additive) sits between context-state classification and trust-ranked retrieval: it decides *which cognitive capacity is activated* — `software_engineer`, `novelist`, `philosopher`, `domain_analyst`, etc. — without replacing Contextual Pathway Stabilization. See [`CONTEXTUAL_CAPABILITY_ARCHIVE.md`](CONTEXTUAL_CAPABILITY_ARCHIVE.md). Nine manifests ship; most required modules (especially `software_engineer`'s workspace stack) remain `planned`, so coding is **not** declared solved.

```
input
  → contextual routing (Contextual Pathway Stabilization: cold / stabilizing / warm / drift)
  → [v0.7 infra, additive] capability router (Contextual Capability Archive)
  → trust-ranked retrieval (SYSTEM_CANONICAL > VERIFIED_PROJECT_FACT > DOMAIN_VERIFIED
                             > USER_PREFERENCE > EXTRACTED_USER_CLAIM > DISPUTED_OR_UNSAFE)
  → structural references (7 operator-seeded, origin=operator_seeded, thread-scoped)
  → prompt builder (canonical facts + trust-ranked formatter + ACTIVE RESPONSE CONSTRAINTS)
  → Claude Sonnet 4.6
  → compliance guard (detect / auto-fix / regenerate-once)
  → fact extraction (sync / async / skip routing)
  → memory writeback (FAISS + FCE-M)
  → FCE-M receipt assimilation (success → aligned, partial → tensioned,
                                 failure → residue, security_rejected → contested)
  → telemetry (module activation matrix, structural derivative classification)
```

### Modules active in the 211-turn canonical benchmark run

`claude_api_live`, `memory_service_live`, `faiss_live`, `production_embeddings`,
`fce_m_backend`, `fce_morphogenesis_report`, `fce_assimilate_receipt`,
`contextual_pathway_stabilization`, `context_state_planner`, `cold_stabilizing_warm_drift`,
`memory_route_planner`, `trust_ranked_formatter`, `verified_project_facts`,
`domain_verified_facts`, `disputed_or_unsafe_rail`, `fact_extractor`, `compliance_guard`,
`active_response_constraints`, `post_generation_checker`, `regeneration_once`,
`structural_reference_memory`, `structural_seed_persistence`, `thread_scoped_retrieval`,
`experiment_namespace_isolation`, `no_manual_omega`, `no_level3_claim`.

Honestly inactive (documented, not hidden):

- `fce_consolidate` — no consolidate call was issued by the benchmark
- `omega_registry_snapshot` — no endogenous Omega registered (by design)
- `reference_field_snapshot` — no ReferenceField coagulated (by design)
- `relational_field_instrumentation` — runner does not invoke the commit-14/15 lib
- `auditor_authority_boundary` — MACP Auditor is not part of the conversational surface; the boundary is structurally enforced elsewhere

## Main components

| Service | Default port | Role |
|---|---|---|
| **Worker Agent** | 3002 | Reads inbox, consults memory (FAISS + FCE-M), builds `EvidencePack` (with optional `fce_context`) + `PlanDraft`. Plans, never executes. |
| **Auditor Agent** | 3003 | Validates `EvidencePack` (incl. `validateFceContext` metadata-only gate) and `PlanDraft`. Runs `applyFceRiskAdvisory` to fold morphogenetic risk into the approval decision. Signs `ExecutionOrder` with Ed25519. |
| **Executor Agent** | (air-gapped) | `network_mode: none`. Verifies signature, executes only Ed25519-signed orders, produces `JohnsonReceipt`. |
| **Memory Service** | 8001 (host) / 8000 (container) | **Hybrid FAISS + FCE-M v0.6.0** backend. Legacy actions (`ping`, `store`, `search`, `search_all`, `stats`) preserved 1:1; new actions (`fce_*`) expose the morphogenetic surface. |
| **OpenClaw Gateway** | 3000 | Unified communication platform (Telegram / Discord / WhatsApp / 20+ channels). When the OpenClaw runtime is unavailable locally, the WhatsApp channel can be served by the Baileys-based bridge at `byon-orchestrator/scripts/byon-whatsapp-bridge.mjs`. |
| Redis | 6379 | Message queue used by the memory service cache and channel adapters. |
| Prometheus / Grafana | 9090 / 3001 | Metrics. |

## Multi-Agent Control Protocol (MACP v1.1) document flow

```
                +-------------------------+
   user msg --->|  inbox/                 |
                +------------+------------+
                             |
                +------------v------------+
                |  WORKER                 |
                |  - search_all (thread-  |
                |    scoped FAISS, v0.6.1)|
                |  - fce_morphogenesis_   |
                |    report (FCE-M)       |
                |  - extract facts        |
                |    (v0.6.2)             |
                |  - LLM (claude-sonnet-  |
                |    4-6)                 |
                +------------+------------+
                             |
            EvidencePack + PlanDraft (+ fce_context, v0.6.4a)
                             |
                +------------v------------+
                |  AUDITOR                |
                |  - validateFceContext   |
                |    (metadata-only gate) |
                |  - applyFceRiskAdvisory |
                |    (risk factor, not a  |
                |    verdict)             |
                |  - sign Ed25519         |
                +------------+------------+
                             |
                       ExecutionOrder (signed)
                             |
                +------------v------------+
                |  EXECUTOR  (air-gapped) |
                |  network_mode: none     |
                |  - verify signature     |
                |  - run actions          |
                |  - emit JohnsonReceipt  |
                +------------+------------+
                             |
                       JohnsonReceipt
                             |
                +------------v------------+
                |  WORKER post-processing |
                |  fce_assimilate_receipt |
                |  success→1, partial→2,  |
                |  failed→3, rejected→4   |
                +-------------------------+
```

## Memory subsystem (v0.6.4)

**Hybrid backend** with two complementary layers on a single endpoint:

### FAISS layer (semantic retrieval)
- Per-type indices for `code` / `conversation` / `fact`.
- `IndexFlatIP` over 384-dim L2-normalized embeddings (`sentence-transformers/all-MiniLM-L6-v2`).
- Thread-scoped recall by default (v0.6.1, `scope: "thread"`; `scope: "global"` is opt-in).
- Rows persist `thread_id` and `channel` metadata so scope filtering can be enforced post-search.

### FCE-M v0.6.0 layer (morphogenetic advisory, BSD-3-Clause)
- Vendored at `byon-orchestrator/memory-service/vendor/fce_m/`.
- Wrapper: `byon-orchestrator/memory-service/fcem_backend.py`.
- Mirror-write: every BYON store call also produces a symbolic slot_event in FCE-M; since v0.6.3 it produces a companion numerical write `{vector, entity_id, attr_type}` carrying the FAISS embedding as a field signature (raises `AR_t` from ~0.68 to 1.0).
- Per-center coherent-repeat detection (v0.6.4c, configurable `FCEM_COHERENT_REPEAT_THRESHOLD`, default 0.92) routes coherent repeats to a stable anchor label to limit `Z` accumulation without starving `AR`.
- Fact extraction (v0.6.2) distils user turns into canonical facts via Claude; architecture / security / identity kinds are routed system-scope, user preferences / project facts are thread-scoped.
- Canonical BYON architecture facts (18 entries, v0.6.4a) are seeded on startup and *also* injected into every LLM system prompt via `renderCanonicalFactsBlock()` — retrieval-independent grounding.
- Persistence: `faiss_*.bin`, `meta_*.pkl`, `fcem/fcem_snapshot.json` under `memory-service/memory_storage/`.

## Memory service API (selected)

Base URL: `http://localhost:8001` (host-side, mapped from container port 8000).
Single unified `POST /` endpoint dispatching on `action`:

| Action | Stage | Purpose |
|---|---|---|
| `ping` | v0.1+ | Liveness probe |
| `store` | v0.1+ | Insert into FAISS + mirror to FCE-M; accepts `data.thread_id`, `data.channel` |
| `search` / `search_all` | v0.1+ | Semantic recall; accepts `thread_id`, `scope` |
| `stats` | v0.1+ | Index counts, storage size |
| `test_recovery` | v0.1+ | FHRSS-style recovery stub (FAISS backend uses disk persistence instead) |
| `fce_state` | v0.6.0 | FCE-M snapshot (omega registry, refs, advisory, dedup stats) |
| `fce_advisory` | v0.6.0 | All advisory feedback items |
| `fce_priority_recommendations` | v0.6.0 | Advisory items with positive `priority_delta` |
| `fce_omega_registry` | v0.6.0 | Coagulated OmegaRecord snapshot |
| `fce_reference_fields` | v0.6.0 | Projected ReferenceFields + morphogenetic events |
| `fce_consolidate` | v0.6.0 | Explicit consolidation trigger |
| `fce_morphogenesis_report` | v0.6.0 | Compact metadata-only summary for `EvidencePack.fce_context` |
| `fce_assimilate_receipt` | v0.6.0 | Post-execution status assimilation |

## Operational classification

| Level | Definition | BYON v0.6.4 |
|---|---|---|
| 1 | Semantic memory only (FAISS retrieval) | ✓ |
| 2 | Morphogenetic advisory memory (FCE-M produces advisory, surfaced by pipeline) | **✓ — current** |
| 3 | Native memory with operational ReferenceFields (Omega coagulation through BYON loop) | ✗ (max observed `S_t = 0.153` vs `θ_s = 0.28`) |
| 4 | Self-applying memory (orchestrator autonomously consumes FCE advisory without LLM mediation) | ✗ (not claimed) |

Honest bottleneck: `B_t` (residue stability) — `Z` accumulates with coherent events under default thresholds. See [`RESEARCH_PROGRESS_v0.6.md`](RESEARCH_PROGRESS_v0.6.md) §5–§8 and [`../test-results/fcem-coagulation-harness-v0.6.4b.md`](../test-results/fcem-coagulation-harness-v0.6.4b.md).

## Security invariants (unchanged across v0.6.x)

- **Worker** plans, NEVER executes.
- **Auditor** validates and signs, NEVER executes.
- **Executor** runs with `network_mode: none`, accepts only Ed25519-signed orders, produces `JohnsonReceipt`.
- **FCE-M** shapes attention and risk context, NEVER approves, NEVER overrides truth verdicts, NEVER bypasses user approval gates.
- **`fce_context`** is metadata-only, enforced by `validateFceContext`. Hashed center IDs only. No labels, no text content.
- **Bridge surface** (WhatsApp / CLI) is text-only; tool-using flows still require the full MACP pipeline.

## API endpoints (via Gateway)

- `/api/worker/status` — Worker agent status
- `/api/auditor/status` — Auditor agent status
- `/api/memory/stats` — FAISS + FCE-M statistics
- `/api/memory/search?query=...` — Semantic search (FAISS layer; thread-scoped by default)

## Key technologies

| Technology | Description |
|---|---|
| **MACP v1.1** | Multi-Agent Control Protocol — file-based document handoff |
| **FAISS** | Facebook AI Similarity Search — `IndexFlatIP` cosine retrieval |
| **FCE-M v0.6.0** | Fragmergent Causal Exponentiation Memory — morphogenetic advisory layer (BSD-3-Clause) |
| **FCE-Ω** | Self-index `S_t = AR · κ · I_t · B_t`; threshold `θ_s = 0.28`, `τ_coag = 12` cycles |
| **Ed25519** | Cryptographic signing of ExecutionOrders (`@noble/ed25519`) |
| **sentence-transformers** | `all-MiniLM-L6-v2`, 384-dim L2-normalized embeddings |
| **Claude Sonnet 4.6** | Default LLM (`claude-sonnet-4-6`) |
| **Baileys** | WhatsApp Web multi-device client (text-only bridge) |

## Notes

- Executor runs air-gapped (`network_mode: none`).
- Memory service is required at boot; no other agent will start without it.
- All services routed through the OpenClaw gateway as a unified proxy when available.
- Vendored FCE-Ω source (`byon-orchestrator/memory-service/vendor/fce_m/vendor/fce_omega_source/`) carries proprietary terms; the BYON repository ships it under patent-holder authorization (EP25216372.0).

---

**Patent:** EP25216372.0 — Omni-Qube-Vault — Vasile Lucian Borbeleac, FRAGMERGENT TECHNOLOGY S.R.L.
