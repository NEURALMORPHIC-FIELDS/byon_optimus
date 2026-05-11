<div align="center">
  <img src="WFP%20logo.png" alt="BYON Optimus" width="400" />

  # BYON Optimus — Multi-Agent Orchestration with Morphogenetic Memory

  *Research-in-progress integration platform for FCE-M (Fragmergent Causal Exponentiation Memory) over a MACP v1.1 multi-agent pipeline.*

  [![CI](https://github.com/NEURALMORPHIC-FIELDS/byon_optimus/actions/workflows/ci.yml/badge.svg)](https://github.com/NEURALMORPHIC-FIELDS/byon_optimus/actions/workflows/ci.yml)
  [![Status](https://img.shields.io/badge/status-research--in--progress-orange.svg)](docs/RESEARCH_PROGRESS_v0.6.md)
  [![Level](https://img.shields.io/badge/FCE--M%20level-2%20of%204-yellow.svg)](docs/RESEARCH_PROGRESS_v0.6.md#classification)
  [![License](https://img.shields.io/badge/license-Proprietary-red.svg)](LICENSE)
  [![Patent](https://img.shields.io/badge/Patent-EP25216372.0-blue.svg)](LICENSE)
  [![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

  **Patent EP25216372.0 — Omni-Qube-Vault — Vasile Lucian Borbeleac, FRAGMERGENT TECHNOLOGY S.R.L.**
</div>

---

## Abstract

BYON Optimus is a research-grade multi-agent orchestration platform implementing the **Multi-Agent Control Protocol (MACP) v1.1** — a three-agent pipeline (Worker → Auditor → Executor) connected through file-based handoff documents (EvidencePack, PlanDraft, ApprovalRequest, ExecutionOrder, JohnsonReceipt). Beginning with version **v0.6.0**, BYON Optimus integrates **FCE-M v0.6.0** ([Fragmergent Causal Exponentiation Memory](https://github.com/NEURALMORPHIC-FIELDS/fragmergent-causal-exponentiation-memory)) as a native morphogenetic memory substrate layered over a FAISS semantic-retrieval engine.

This README documents the current state of integration: **a hybrid memory architecture in which FAISS provides semantic recall and FCE-M provides morphogenetic advisory** (OmegaRecord, ReferenceField, residue signaling, contested-expression detection). The integration is the subject of an ongoing experimental research line (v0.6.1 → v0.6.4) whose findings are documented in [`docs/RESEARCH_PROGRESS_v0.6.md`](docs/RESEARCH_PROGRESS_v0.6.md).

## Research questions

- **RQ1 — Compatibility:** Can FCE-M's morphogenetic dynamics be embedded into a production multi-agent pipeline without compromising the existing Worker/Auditor/Executor security boundaries?
- **RQ2 — Operational classification:** What level of native-memory behaviour does the integrated system achieve?
  1. Semantic memory only (FAISS retrieval).
  2. Morphogenetic advisory memory (FCE-M produces advisory but does not coagulate).
  3. Native memory with operational ReferenceFields (Omega coagulation through the conversational loop).
  4. Self-applying memory (orchestrator autonomously adapts to FCE advisory without LLM mediation).
- **RQ3 — Sufficient conditions for coagulation:** Under what input regimes can OmegaRecord coagulation be reached *through the BYON conversational loop*, given fixed coagulation thresholds (`θ_s=0.28`, `τ_coag=12`)?

## Current findings (v0.6.4)

| Aspect | Status |
|---|---|
| Hybrid backend (FAISS + FCE-M) — backwards-compatible API | **Confirmed** |
| Thread-scoped semantic recall (v0.6.1) | **Confirmed** |
| Canonical fact extraction (user-scope + system-scope routing, v0.6.2) | **Confirmed** |
| Field-signature injection raises AR_t to 1.0 (v0.6.3) | **Confirmed** |
| LLM grounded in BYON architectural facts (v0.6.4a) | **Confirmed**, 139/144 deep-suite assertions pass |
| Auditor `fce_context` gate — metadata-only enforcement | **Confirmed**, 27/27 security boundary tests pass |
| Receipt assimilation status mapping (success→aligned, failed→residue, etc.) | **Confirmed** |
| **OmegaRecord coagulation from the conversational loop** | **Not reached.** Max S_t observed = 0.153 vs threshold θ_s = 0.28. Bottleneck: B_t (residue stability) under coherent-repeat regimes. |
| **ReferenceField projection from the conversational loop** | **Not reached** (dependent on the above). |
| Pipeline self-applying advisory (Level 4) | **Not claimed.** The bridge surfaces FCE advisory in the LLM system prompt but does not autonomously gate orchestration. |

**Operational classification: Level 2 of 4.** See [`docs/RESEARCH_PROGRESS_v0.6.md`](docs/RESEARCH_PROGRESS_v0.6.md) for the full methodology, metrics, and bottleneck analysis. Empirical artefacts are stored under [`test-results/`](test-results/).

## Status

> **This is an active research project.** The architectural boundaries (Worker plans, Auditor approves, Executor air-gapped) are production-stable; the morphogenetic layer (FCE-M v0.6.0) is **integrated and observable** but **does not yet coagulate Omega centers from natural conversational input** under default thresholds. We do **not** lower `θ_s` or `τ_coag` to manufacture coagulation; we report exactly which factor (AR, κ, I_t, B_t) blocks it and why.

---

## Documentation

| Document | Purpose |
|----------|---------|
| [INSTALL.md](INSTALL.md) | Practical installation guide |
| [CHANGELOG.md](CHANGELOG.md) | Versioned change history (incl. v0.6.x research line) |
| [docs/RESEARCH_PROGRESS_v0.6.md](docs/RESEARCH_PROGRESS_v0.6.md) | **Scientific narrative** of the FCE-M integration (v0.6.0 → v0.6.4) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Current v0.6.4 architecture (component table, MACP flow, endpoints) |
| [test-results/v0.6.4-synthesis.md](test-results/v0.6.4-synthesis.md) | Cross-stage synthesis report with metrics |
| [test-results/fcem-deep-v0.6.4a-report.md](test-results/fcem-deep-v0.6.4a-report.md) | Latest deep-functional run |
| [test-results/fcem-coagulation-harness-v0.6.4b.md](test-results/fcem-coagulation-harness-v0.6.4b.md) | Single-center coagulation feasibility experiment |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines |
| [SECURITY.md](SECURITY.md) | Security policy and disclosure |

---

## Quick Start

### Local hybrid setup (no Docker required)

The minimal v0.6.4 stack is **memory-service (Python) + WhatsApp bridge (Node.js, Baileys)**. The orchestrator's MACP agents (Worker/Auditor/Executor) are exercised by the vitest suite; the bridge is a text-only conversational surface that uses the same memory + LLM core.

```bash
# 1) Install dependencies
cd byon-orchestrator
npm install --ignore-scripts
pip install -r memory-service/requirements.txt

# 2) Configure secrets — copy template and fill ANTHROPIC_API_KEY
cp .env.example ../.env     # at repository root
# edit ../.env: ANTHROPIC_API_KEY=sk-ant-...

# 3) Start memory-service (FAISS + FCE-M hybrid)
cd memory-service
MEMORY_BACKEND=hybrid FCEM_ENABLED=true \
    FCEM_CONSOLIDATE_EVERY_N=3 \
    python -u server.py
#   → http://localhost:8000/health → 200 OK

# 4) Start WhatsApp bridge (in a second terminal)
cd byon-orchestrator
node --env-file=../.env scripts/byon-whatsapp-bridge.mjs
# First run prints a QR code in the terminal. Scan with WhatsApp:
# Settings → Linked Devices → Link a Device.
# Session is persisted under byon-orchestrator/whatsapp-session/ (gitignored).
```

Once linked, send `/byon <your message>` to your own WhatsApp number (or have anyone DM you) — the bridge runs the full memory + FCE morphogenesis + Claude Sonnet 4.6 pipeline and replies.

### Docker (full stack, when OpenClaw runtime is available)

```bash
# Fill .env from .env.example, then:
docker compose up -d
```

The Docker stack is the multi-channel deployment surface (when the OpenClaw gateway runtime is present). Configuration lives in `docker-compose.yml`.

### Validate the integration

```bash
cd byon-orchestrator
npm test                                                     # vitest unit + integration (orchestrator)
node --env-file=../.env scripts/byon-fcem-deep-suite.mjs     # 12-category deep functional suite
node --env-file=../.env scripts/byon-coagulation-harness.mjs # single-center coagulation feasibility
```

Outputs land in `test-results/` as paired Markdown / JSON.

---

## Architecture overview (v0.6.4)

```
                       ┌──────────────────────────────────────┐
                       │   Conversational surface             │
                       │   (WhatsApp via Baileys / CLI)       │
                       │   Text-only; bypasses MACP for       │
                       │   chat-style queries.                │
                       └─────────────────┬────────────────────┘
                                         │
                       ┌─────────────────▼────────────────────┐
                       │   memory-service (port 8000)         │
                       │   ┌─────────────┐  ┌────────────────┐│
                       │   │ FAISS       │  │ FCE-M v0.6.0   ││
                       │   │ IndexFlatIP │◄►│ UnifiedMemory  ││
                       │   │ (semantic   │  │ Store +        ││
                       │   │  recall,    │  │ FCE-Ω observer ││
                       │   │  thread-    │  │ (advisory,     ││
                       │   │  scoped)    │  │  Omega, RF)    ││
                       │   └─────────────┘  └────────────────┘│
                       └─────────────────┬────────────────────┘
                                         │
                                Recall + FCE morphogenesis report
                                         │
        MACP v1.1 pipeline (production-stable, exercised by vitest):
                                         │
   ┌─────────────────┐  EvidencePack    ┌─────────────────┐
   │  Worker         │  + fce_context   │  Auditor        │
   │  - plans only   ├─────────────────►│  - validates    │
   │  - never        │  (metadata-only) │    fce_context  │
   │    executes     │                  │  - applies risk │
   └─────────────────┘                  │    advisory     │
                                        │  - Ed25519      │
                                        │    signs        │
                                        └────────┬────────┘
                                                 │
                                          Signed ExecutionOrder
                                                 │
                                        ┌────────▼────────┐
                                        │  Executor       │
                                        │  network_mode:  │
                                        │  none           │
                                        │  - verifies     │
                                        │    signature    │
                                        │  - runs actions │
                                        │  - emits        │
                                        │    Johnson      │
                                        │    Receipt      │
                                        └────────┬────────┘
                                                 │
                                          fce_assimilate_receipt
                                          (success→aligned,
                                           failed→residue, ...)
```

**Invariants:**

- **Worker** plans, never executes.
- **Auditor** validates `EvidencePack` (including `validateFceContext` metadata-only gate), runs `applyFceRiskAdvisory`, and Ed25519-signs the `ExecutionOrder`. Never executes.
- **Executor** runs `network_mode: none` (true air-gap). Accepts only signed orders. Emits `JohnsonReceipt`.
- **FCE-M** is advisory: shapes attention and risk context. **Never** approves an action, **never** overrides truth verdicts, **never** bypasses user approval. Aligned ReferenceFields do *not* reduce required review level.
- **`EvidencePack.fce_context`** is metadata-only — counts and hashed center identifiers, never labels or text content.
- **Default LLM:** `claude-sonnet-4-6`.

For the full component table, MACP document schemas, FCE-M action surface (`fce_state`, `fce_advisory`, `fce_priority_recommendations`, `fce_omega_registry`, `fce_reference_fields`, `fce_consolidate`, `fce_morphogenesis_report`, `fce_assimilate_receipt`) and operational classification rationale, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/RESEARCH_PROGRESS_v0.6.md`](docs/RESEARCH_PROGRESS_v0.6.md).

---

## Project structure

```
byon_optimus/
├── README.md                                  # This file
├── CHANGELOG.md                               # Versioned history (v0.6.0 → v0.6.4)
├── INSTALL.md                                 # Practical installation guide
├── docs/
│   ├── RESEARCH_PROGRESS_v0.6.md              # Scientific narrative
│   ├── ARCHITECTURE.md                        # v0.6.4 architecture reference
│   └── …                                      # Other reference documents
├── byon-orchestrator/                         # TypeScript orchestrator
│   ├── src/
│   │   ├── agents/
│   │   │   ├── worker/                        # Worker — plans, never executes
│   │   │   ├── auditor/                       # Auditor — validates + Ed25519 signs
│   │   │   └── executor/                      # Executor — air-gapped runtime
│   │   ├── protocol/                          # MACP v1.1 document types
│   │   ├── memory/                            # MemoryClient + FCE types
│   │   └── …
│   ├── memory-service/                        # Python hybrid backend
│   │   ├── server.py                          # FastAPI dispatcher
│   │   ├── handlers.py                        # FAISS thread-scoped store/search
│   │   ├── fcem_backend.py                    # FCE-M v0.6.0 adapter
│   │   └── vendor/fce_m/                      # Vendored FCE-M (BSD-3-Clause)
│   └── scripts/
│       ├── byon-whatsapp-bridge.mjs           # Baileys text-only bridge
│       ├── byon-fcem-deep-suite.mjs           # 12-category live test suite
│       ├── byon-coagulation-harness.mjs       # Single-center coagulation experiment
│       └── lib/
│           ├── byon-system-facts.mjs          # 18 canonical architectural facts
│           └── fact-extractor.mjs             # LLM-driven fact distillation
├── test-results/                              # Empirical artefacts (.md + .json)
└── docker-compose.yml                         # Optional Docker stack
```

---

## History note

The legacy `main` branch (pre-v0.6 era — FHRSS+FCPE-only memory, OpenClaw as the primary WhatsApp surface, Claude 3 Haiku as the default LLM) is preserved on the backup branch [`backup/legacy-remote-main`](https://github.com/NEURALMORPHIC-FIELDS/byon_optimus/tree/backup/legacy-remote-main). The current `main` documents the v0.6.4 FAISS + FCE-M hybrid architecture; references to the older memory backend remain only on that backup branch.

---

## License & patent

- **License:** Proprietary. See [LICENSE](LICENSE).
- **Patent:** EP25216372.0 — Omni-Qube-Vault — Vasile Lucian Borbeleac, FRAGMERGENT TECHNOLOGY S.R.L. (Cluj-Napoca, Romania).
- **Vendored sources:** FCE-M v0.6.0 is BSD-3-Clause (`byon-orchestrator/memory-service/vendor/fce_m/`). The FCE-Ω core under `byon-orchestrator/memory-service/vendor/fce_m/vendor/fce_omega_source/` carries proprietary terms; it is included in this repository under patent-holder authorization.

## Contact / disclosure

- Security disclosure → [SECURITY.md](SECURITY.md)
- Contributions → [CONTRIBUTING.md](CONTRIBUTING.md)
- Owner: **Vasile Lucian Borbeleac**, FRAGMERGENT TECHNOLOGY S.R.L.
