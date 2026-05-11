# Changelog

All notable changes to BYON Optimus will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.4] — 2026-05-11 (research line, Level 2 confirmed)

Research stage closing the v0.6 integration cycle.
Full narrative: [`docs/RESEARCH_PROGRESS_v0.6.md`](docs/RESEARCH_PROGRESS_v0.6.md) ·
synthesis: [`test-results/v0.6.4-synthesis.md`](test-results/v0.6.4-synthesis.md).

### v0.6.4a — System knowledge bootstrap
- `scripts/lib/byon-system-facts.mjs`: canonical corpus of 18 architecture / security / identity facts (Worker plans, Auditor approves, Executor air-gapped, MACP roles, FCE-M boundaries).
- `seedSystemFacts(mem)` invoked at deep-suite and WhatsApp-bridge startup; facts stored with `thread_id=null` so the v0.6.2 system-scope routing surfaces them across all threads.
- `renderCanonicalFactsBlock()` injects the corpus directly into every LLM system prompt — retrieval-independent grounding for architectural questions.
- Deep functional suite extended with 5 new probes targeting MACP role knowledge.
- **Result:** 139/144 deep-suite assertions pass; L (conversation-quality) category 13/13 pass.

### v0.6.4b — Center-coherent coagulation harness
- `scripts/byon-coagulation-harness.mjs`: drives 60 semantically-coherent paraphrases on a single morphogenetic center (`byon::execution_boundary` or `fce-m::truth_attention_boundary`); captures per-cycle S_t, AR_t, κ_t, Z_norm, ΔX_norm; auto-diagnoses the limiting factor in `S_t = AR · κ · I_t · B_t`.
- **Bottleneck identified:** B_t (residue stability) collapses to ≈0.12 because Z_norm grows linearly with coherent events (1.3 → 31.3 over 60 events).
- Empirically confirmed the prediction that BYON's natural conversational pipeline produces a field that is too residual for Omega coagulation under default thresholds. Max S_t observed: 0.112 in this stage.

### v0.6.4c — Assimilation/residue tuning
- Coherent-repeat detection in `fcem_backend.py`: per-center LRU history of recent embeddings; cosine-similarity threshold (`FCEM_COHERENT_REPEAT_THRESHOLD=0.92`).
- Three strategies probed (full symbolic suppression; stable-label anchor slot; reduced unique-event count). None reaches the coagulation criterion `S_t ≥ θ_s = 0.28 for τ_coag = 12 consecutive cycles`.
- Key architectural insight: AR_t is built primarily by *symbolic* slot_event writes; the v0.6.3 *numerical* companion writes feed `tf_engine` but do not appear to register in the FCE-Ω observer's perspective field. Max S_t reached: 0.153 (+55% over v0.6.0 baseline).

### Decision
- **Operational acceptance at Level 2 (Morphogenetic Advisory Memory).**
- **Level 3 (native memory with ReferenceFields operational) deferred** pending further FCE-Ω research (rolling center summary, multi-perspective fan-out, or numerical→observer bridging). Neither `θ_s` nor `τ_coag` is reduced.

## [0.6.3] — 2026-05-11 (field-signature injection)

- `fcem_backend.assimilate_event` now accepts an embedding and emits a *companion numerical write* `{vector, entity_id, attr_type}` alongside the symbolic slot_event, providing FCE-Ω with a 384-dim field signature.
- `assimilate_receipt` emits a deterministic 16-dim signature derived from status one-hot, token counts, latency, and hash perturbation.
- `server.py` propagates the FAISS embedding to FCE-M for every store.
- **Measured effect:** AR_t jumps from ≈0.68 (label-only) to 1.000 (max). κ_t rises marginally; S_t mean rises ≈10–20%. Omega still does not coagulate.
- Deep-suite result: 132/139 pass (95%), Level 2; security boundary E+F 27/27.

## [0.6.2] — 2026-05-11 (fact extraction)

- `scripts/lib/fact-extractor.mjs`: LLM-driven fact distillation per user turn.
- Extracted-fact kinds: `user_preference`, `architecture_rule`, `security_constraint`, `correction`, `project_fact`, `identity`.
- System-scope routing in `handlers._search_by_type`: rows with `thread_id=None` and tag `__system__` are visible across all threads — architecture / security / identity facts stay globally available; user preferences and project facts remain thread-scoped.
- `fcem_backend._entity_for` now prefers `thread_id` over `source` for facts so morphogenetic centers stay thread-aligned; system-scope facts coagulate on a shared `byon::system` center.
- Auditor `applyFceRiskAdvisory` and `validateFceContext` already protect against label/text leakage from extracted facts.
- Deep-suite result: 126/139 pass; L probes 3 & 4 (architecture/security questions) succeed across threads via system-scope facts.

## [0.6.1] — 2026-05-11 (thread-scoped semantic recall)

- `MemoryHandlers.store_*` now persist `thread_id` and `channel` in FAISS row metadata.
- `MemoryHandlers._search_by_type` accepts `thread_id` and `scope ∈ {"thread", "global"}`; default is `scope="thread"`, returning only rows whose `thread_id` matches the requesting thread.
- `scope="global"` remains available as an explicit opt-in for debugging / cross-thread tooling.
- `server.py` propagates `thread_id` / `scope` from both store and search requests; cache keys include thread to prevent cross-thread bleed.
- WhatsApp bridge and deep functional suite updated to always issue thread-scoped recall.
- Resolved the cross-thread leakage observed in the v0.6.0 baseline (deep-suite H category: thread A no longer recalls thread B's data and vice versa).
- Deep-suite result: 123/134 pass; H category 10/10 pass.

## [0.6.0] — 2026-05-11 (FCE-M v0.6.0 integration baseline)

- Vendored [FCE-M v0.6.0](https://github.com/NEURALMORPHIC-FIELDS/fragmergent-causal-exponentiation-memory) under `byon-orchestrator/memory-service/vendor/fce_m/`.
- Source `__init__.py` patches for graceful degradation when source projects (`D_CORTEX_ULTIMATE`, `fragmergent-memory-engine`, `fragmergent-tf-engine`) are missing; env-var path overrides (`FCEM_DCORTEX_ROOT`, `FCEM_MEMORY_ENGINE_ROOT`, `FCEM_TF_ENGINE_ROOT`).
- New `byon-orchestrator/memory-service/fcem_backend.py` — adapter over `UnifiedMemoryStore` providing:
  - `assimilate_event(mem_type, ctx_id, content, metadata)` — symbolic slot_event write per BYON memory type.
  - `assimilate_receipt(order_id, status, …)` — status→label mapping (success→1, partial→2, failed→3, rejected→4).
  - `state`, `advisory`, `priority_recommendations`, `omega_registry`, `reference_fields`, `consolidate`, `morphogenesis_report` snapshots.
  - JSON snapshot persistence at `memory_storage/fcem/fcem_snapshot.json`.
- New `/` action endpoints in `server.py`: `fce_state`, `fce_advisory`, `fce_priority_recommendations`, `fce_omega_registry`, `fce_reference_fields`, `fce_consolidate`, `fce_morphogenesis_report`, `fce_assimilate_receipt`.
- TypeScript types: `FceAdvisoryFeedback`, `OmegaRecord`, `ReferenceField`, `MorphogenesisReport`, `FceMemoryContext`, `FceContextMetadata` (metadata-only by construction).
- TypeScript `MemoryClient` extended with `getFceState`, `getFceAdvisory`, `getFceOmegaRegistry`, `getFceReferenceFields`, `consolidateFce`, `getMorphogenesisReport`, `getFceMemoryContext`, `assimilateReceipt`.
- `EvidencePack.fce_context?: FceContextMetadata` (optional, metadata-only).
- `validateFceContext` enforces metadata-only policy (no label / description / content / text / name / title fields; hashed center IDs only; capped array sizes).
- `applyFceRiskAdvisory` consumes `fce_context.high_residue_centers`, `contested_expressions`, `aligned_reference_fields`, `relation_candidates_count` and emits Auditor warnings — never substitutes for approval, never reduces risk.
- Default LLM model: `claude-sonnet-4-6`.
- Hybrid memory backend default (`MEMORY_BACKEND=hybrid`): FAISS for retrieval, FCE-M for morphogenetic accounting; backward-compatible with all pre-v0.6 store/search/stats/ping/recovery actions.
- Bug fix: `threading.Lock` → `threading.RLock` in `FcemBackend` (consolidate-during-persist deadlock).
- WhatsApp bridge (`scripts/byon-whatsapp-bridge.mjs`) over `@whiskeysockets/baileys` as text-only conversational surface; explicitly bypasses Worker → Auditor → Executor.
- Deep functional suite (`scripts/byon-fcem-deep-suite.mjs`) — 12 categories, 91 initial assertions; classification framework Level 1–4.
- **Deep-suite baseline:** 118/130 assertions pass (90.8%); Level 2 classification; security boundary E+F 27/27.

## [Unreleased]

## [0.2.0] - 2026-02-13

### Added
- **Reed-Solomon GF(256) Dual Parity** in FHRSS encoder
  - GF(256) arithmetic engine (log/exp tables, `gf_mul`, `gf_div`, `gf_pow`)
  - `FHRSSConfig.parity_strength = 2` (dual parity P1 + P2)
  - 2-erasure solver per line (was 1-erasure XOR only)
  - 100% deterministic recovery at 50% data loss (verified 120 seeds)
  - Overhead: 3.25x (FULL profile, r=2)
- **Scientific Validation Suite** (`tests/scientific_validation.py`)
  - 52 test assertions across 10 categories
  - 50/52 passed (96.2%)
  - Comprehensive 3-perspective report (`docs/SCIENTIFIC_VALIDATION_RS.md`)
- `damage_parity` flag on `inject_loss_realistic()` and `test_recovery()`

### Changed
- FHRSS encoder uses RS GF(256) by default (backward compatible with r=1)
- Recovery model defaults to parity-intact (matches reference repo)
- Updated all documentation to reflect RS capabilities
- Synced `byon-orchestrator/memory-service/fhrss_fcpe_unified.py`
- Updated `byon-system-knowledge.json` recovery/overhead claims

### Improved
- Repository structure: removed 12 root-level duplicate files
- `.gitignore`: added patterns for test outputs, benchmarks, runtime storage
- Added `pyproject.toml` and `__init__.py` for INFINIT_MEMORYCONTEXT package

### Added
- **🔐 Secure Vault** - Encrypted storage for sensitive data
  - GPG encryption (with AES-256-GCM fallback)
  - Human-in-the-loop approval (ask-always policy)
  - 30-second approval timeout
  - Desktop notifications for access requests
  - Complete audit trail
  - Rate limiting (10 accesses/hour per category)
  - Categories: credentials, keys, financial, documents, secrets
- AI-powered task processing in Worker agent
- Claude API integration (claude-3-haiku-20240307)
- TradingAPIClient for CoinGecko cryptocurrency data
- Comprehensive capability testing suite
- CAPABILITY_REPORT.md generation
- Copyright headers on all 84 TypeScript source files

### Changed
- Plan generator now supports async AI processing
- Enhanced task type detection (coding, analysis, planning, trading, general)
- Patent name updated to "Omni-Qube-Vault"

## [0.1.0] - 2026-02-04

### Added
- **Multi-Agent Control Protocol (MACP) v1.1**
  - Worker Agent (evidence gathering, plan generation)
  - Auditor Agent (validation, Ed25519 signing)
  - Executor Agent (air-gapped execution)

- **FHRSS+FCPE Memory System**
  - 73,000:1 compression ratio
  - Perpetual retention via holographic encoding
  - Semantic search capabilities
  - Global Memory Vitalizer (GMV) daemon

- **Protocol Documents**
  - EvidencePack (task analysis)
  - PlanDraft (proposed actions)
  - ApprovalRequest (user approval flow)
  - ExecutionOrder (signed commands)
  - JohnsonReceipt (execution results)

- **Security Features**
  - Ed25519 cryptographic signatures
  - Air-gapped Executor (network_mode: none)
  - JSON Schema validation for all documents
  - Secrets management via .env files

- **Docker Infrastructure**
  - Multi-stage Dockerfile with agent targets
  - docker-compose.yml with 7 services
  - Volume mounts for handoff and memory
  - Redis for message queuing

- **OpenClaw Gateway Integration**
  - Unified UI at localhost:3000
  - Optimus Dashboard tab
  - 20+ channel support (Telegram, Discord, WhatsApp, etc.)
  - BYON Proxy for API routing

- **Documentation**
  - README.md with quick start guide
  - INSTALL.md with detailed instructions
  - JOHNSON_PLAN.md protocol specification
  - GDPR_COMPLIANCE.md
  - PRIVACY_POLICY.md

### Security
- Executor runs in isolated network mode
- All execution orders require cryptographic signatures
- No secrets stored in code or images
- Proper .gitignore for sensitive files

### Known Issues
- API key limited to claude-3-haiku-20240307 model
- Trading data requires manual TradingAPIClient invocation
- Memory context not auto-populated in task processing

---

## Version History

| Version | Date       | Status      |
|---------|------------|-------------|
| 0.2.0   | 2026-02-13 | Current     |
| 0.1.0   | 2026-02-04 | Stable      |

---

**Patent:** EP25216372.0 - Omni-Qube-Vault - Vasile Lucian Borbeleac
