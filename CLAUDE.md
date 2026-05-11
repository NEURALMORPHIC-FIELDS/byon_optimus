# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BYON Optimus is a multi-agent orchestration system implementing the **MACP v1.1 (Multi-Agent Control Protocol)**. It uses three agents in a pipeline—Worker, Auditor, Executor—communicating via file-based handoff (no direct inter-agent APIs).

Since **v0.6.0** (research line v0.6.1 → v0.6.4) the memory subsystem is a **hybrid FAISS + FCE-M v0.6.0** backend: FAISS provides semantic retrieval, FCE-M (BSD-3-Clause) provides a morphogenetic advisory layer with OmegaRecord, ReferenceField, residue signaling, and metadata-only `fce_context` exposure to `EvidencePack`. Default LLM is `claude-sonnet-4-6`. Current operational classification: **Level 2 of 4** (Morphogenetic Advisory Memory). For the full scientific narrative see [`docs/RESEARCH_PROGRESS_v0.6.md`](docs/RESEARCH_PROGRESS_v0.6.md).

**Patent: EP25216372.0 — Omni-Qube-Vault** | **License: Proprietary**

## Build & Development Commands

### byon-orchestrator (TypeScript core, in `byon-orchestrator/`)

```bash
npm run build              # TypeScript compilation (tsc) to dist/
npm run dev                # Run with ts-node --esm
npm run lint               # ESLint with typescript-eslint + security plugin
npm run test               # Vitest (all tests)
npm run test:watch         # Vitest watch mode
```

### Byon_bot (pnpm monorepo, in `Byon_bot/`)

```bash
pnpm build                 # Build all packages
pnpm dev                   # Run all packages in dev mode
pnpm test                  # All tests (vitest)
pnpm test:unit             # Unit tests only
pnpm test:integration      # Integration tests only
pnpm test:security         # Security tests only
pnpm test:memory           # Python memory tests (pytest)
pnpm test:coverage         # Coverage report
pnpm lint                  # Lint all packages
pnpm keygen                # Generate Ed25519 key pairs
pnpm handoff:setup         # Initialize handoff directories
pnpm setup:first-run       # First-time installation
```

### Docker

```bash
docker compose up -d                # Start all services
docker compose down                 # Stop all services
docker compose logs -f <service>    # Tail logs (byon-worker, byon-auditor, etc.)
docker compose build --no-cache     # Full rebuild
```

### Running a single test

```bash
# From byon-orchestrator/
npx vitest run tests/unit/some-test.test.ts

# From Byon_bot/
pnpm vitest run tests/unit/some-test.test.ts --config tests/vitest.config.ts
```

## Architecture

### Three-Agent Pipeline

```
OpenClaw Gateway (20+ channels) → handoff/inbox/
    ↓
Worker (Agent A): Reads inbox → builds EvidencePack + PlanDraft → writes to handoff/worker_to_auditor/
    ↓
Auditor (Agent B): Validates plan → enforces policies → requests user approval → signs ExecutionOrder (Ed25519) → writes to handoff/auditor_to_executor/
    ↓
Executor (Agent C): Verifies signature → executes actions → produces JohnsonReceipt → writes to handoff/executor_to_worker/
```

**Critical constraints:**
- **Worker** plans but NEVER executes
- **Auditor** validates and signs but NEVER executes
- **Executor** runs with `network_mode: none` (true air-gap, no API keys, no network)
- All inter-agent communication is via JSON files in `handoff/` subdirectories
- User approval is required for execution (30-second timeout)

### MACP v1.1 Document Flow

Each document has a `document_type` discriminator, UUID, ISO8601 timestamp, and SHA256 hash:

`EvidencePack` → `PlanDraft` → `ApprovalRequest` → `ExecutionOrder` (Ed25519 signed) → `JohnsonReceipt`

### Key Subsystems

- **Memory Service v0.6.4** (`byon-orchestrator/memory-service/`, Python FastAPI): hybrid backend. FAISS `IndexFlatIP` (384-dim `sentence-transformers/all-MiniLM-L6-v2`) provides semantic retrieval; FCE-M v0.6.0 (BSD-3-Clause, vendored at `byon-orchestrator/memory-service/vendor/fce_m/`) provides the morphogenetic advisory layer (OmegaRecord, ReferenceField, residue signaling). Default port 8000 (8001 external on Docker). Thread-scoped recall by default (v0.6.1, `scope: "thread"`), `scope: "global"` is opt-in. New action endpoints: `fce_state`, `fce_advisory`, `fce_priority_recommendations`, `fce_omega_registry`, `fce_reference_fields`, `fce_consolidate`, `fce_morphogenesis_report`, `fce_assimilate_receipt`. **System won't start without memory-service.**
- **Fact extraction** (`byon-orchestrator/scripts/lib/fact-extractor.mjs`, v0.6.2): LLM-driven distillation of user turns into canonical facts. Architecture / security / identity kinds route system-scope (visible across threads); user preferences / project facts route thread-scoped.
- **Canonical system facts** (`byon-orchestrator/scripts/lib/byon-system-facts.mjs`, v0.6.4a): 18-entry corpus of architectural truths (Worker plans, Auditor approves, Executor air-gapped, …) seeded into memory-service at startup AND always injected into LLM system prompts via `renderCanonicalFactsBlock()`.
- **WhatsApp bridge** (`byon-orchestrator/scripts/byon-whatsapp-bridge.mjs`): Baileys-based text-only conversational surface. Replaces OpenClaw locally (OpenClaw runtime is missing from this checkout). Bridge does NOT go through Worker → Auditor → Executor — it is a memory + Claude conversational layer only.
- **OpenClaw Gateway** (`Byon_bot/openclaw-main/`): Unified communication platform when present; serves UI at port 3000, browser relay at 8080. Runtime not bundled in the current checkout.
- **Vault** (`byon-orchestrator/src/vault/`): Encrypted secrets storage (GPG or AES-256-GCM fallback), ask-always access policy with desktop notifications.
- **Audit Trail** (`byon-orchestrator/src/audit/`): Immutable hash-chain logging with calendar indexing.
- **Policy Engine** (`byon-orchestrator/src/policy/`): Forbidden paths, forbidden patterns, whitelists, risk assessment.
- **WFP Sentinel** (`byon-orchestrator/src/integration/sentinel-bridge.ts`): Optional kernel-level network guard. TypeScript bridge maps execution intents to WFP firewall rules via file-based handoff. UI tab in Optimus dashboard.
- **Monitoring**: Prometheus (port 9090) + Grafana (port 3001).

### Module Naming Conventions in byon-orchestrator/src/agents/

Each agent directory follows a pattern:
- `*-watcher.ts` — filesystem monitoring for incoming handoff files
- `*-handler.ts` — business logic processing
- `*-generator.ts` — document creation
- `signer.ts` / `verifier.ts` — Ed25519 cryptographic operations

### Docker Services & Networking

All services share `byon-network` (bridge, 172.28.0.0/16) **except** `byon-executor` which has `network_mode: none`. Services run as non-root user 1001:1001. Redis is used as message queue. Containers depend on memory-service health check before starting.

## Code Style

- **TypeScript**: ES2022 target, NodeNext modules, strict mode. Path aliases: `@/*` → `src/*`, `@shared/*` → `shared/*`
- **Prettier**: 100 char width, 2-space indent, single quotes, trailing commas (es5), arrow parens avoid, LF line endings
- **ESLint**: Flat config (v9.x), typescript-eslint with type checking, eslint-plugin-security. Key rules: no floating promises, no eval, prefer const, strict equality, mandatory curly braces. `no-console` is warn (allows `console.warn`/`console.error`)
- **Tests**: Vitest with globals enabled, 10s timeout, verbose reporter. Coverage thresholds: 70% statements/functions/lines, 60% branches

## Cryptography

- **Ed25519** (`@noble/ed25519`): Auditor signs ExecutionOrders, Executor verifies before running
- Keys live in `keys/` directory (private for auditor, public copied to executor)
- Generate keys: `pnpm keygen` or `bash scripts/setup-keys.sh`

## Key Integration Points

- **Gateway Proxy** (`Byon_bot/openclaw-main/src/gateway/byon-proxy.ts`): Routes all `/api/*` requests to internal services. HMAC auth on approval endpoint. Rate limiting (60 req/min general, 10 req/min approval).
- **Optimus UI** (`Byon_bot/openclaw-main/ui/src/ui/views/byon-dashboard.ts`): Lit web component served at `/optimus`. Tabs: dashboard, inbox, approvals, execution, memory, sentinel.
- **OpenClaw Bridge** (`byon-orchestrator/src/integration/openclaw-bridge.ts`): Connects Auditor approval flow to OpenClaw for WhatsApp/multi-channel notifications.

## Repository Structure

- `docs/` — Architecture, security, API, and compliance documentation
- `docs/planning/` — Historical planning artifacts (moved from root)
- `byon-orchestrator/` — Canonical agent implementations (used by Docker)
- `Byon_bot/openclaw-main/` — Gateway, UI, and channel adapters
- `Byon_bot/shared/` — Reference schemas and shared utilities (may diverge from orchestrator)
- `WFP-Semantic-Guard/` — Windows kernel driver (separate C project)
- `INFINIT_MEMORYCONTEXT/` — FHRSS+FCPE research/reference implementation (Python)

## Security Policies

- **CORS**: Fail-closed — no wildcard. Must configure `BYON_CORS_ORIGINS` explicitly
- **Input validation**: All URL parameters validated against `^[a-zA-Z0-9_-]+$`
- **Credentials**: `openclaw-config/credentials/` is gitignored. Never commit tokens, keys, or sessions
- **NODE_ENV**: Defaults to `production` in byon-proxy.ts
- **Grafana**: `GRAFANA_PASSWORD` is required (no default fallback)
- **WFP Sentinel**: Network-only. Filesystem/process monitoring is `[FUTURE]` — do not overclaim in docs

## Environment

- Required: `ANTHROPIC_API_KEY`, `OPENCLAW_GATEWAY_TOKEN`, `BYON_BRIDGE_SECRET`, `REDIS_PASSWORD`, `GRAFANA_PASSWORD`
- CORS: `BYON_CORS_ORIGINS` (comma-separated allowed origins)
- See `.env.example` for full variable list including channel credentials
- `AGENT_ROLE` env var selects which agent code runs in each container (worker/auditor/executor)

## Test Suites

- `byon-orchestrator/tests/unit/` — Unit tests (protocol, policy, memory, vault)
- `byon-orchestrator/tests/integration/` — Integration tests (handoff, worker-auditor pipeline)
- `byon-orchestrator/tests/security/` — Security tests (hash chain, path traversal, policy enforcement)
- `byon-orchestrator/tests/campaign/` — 100-test usage campaign (10 real-world domains)
- Total: 426 tests, all passing

