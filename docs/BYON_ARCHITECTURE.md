# BYON Optimus Architecture

**Patent: EP25216372.0 — Omni-Qube-Vault — Vasile Lucian Borbeleac**

> **v0.6.4 banner.** The memory backend described in legacy paragraphs below as "FHRSS+FCPE" is, as of v0.6.0+, a **hybrid FAISS + FCE-M v0.6.0** stack: FAISS provides semantic retrieval (thread-scoped by default per v0.6.1), FCE-M provides the morphogenetic advisory layer (OmegaRecord, ReferenceField, residue, advisory feedback). The OpenClaw runtime is not bundled in the current local checkout; the WhatsApp surface is a Baileys-based bridge (text-only, bypasses Worker → Auditor → Executor). Auditor consumes FCE advisory via `validateFceContext` + `applyFceRiskAdvisory` — strictly as a risk factor, never as a verdict. Current operational classification: **Level 2 of 4** (Morphogenetic Advisory Memory). Full scientific narrative: [`RESEARCH_PROGRESS_v0.6.md`](RESEARCH_PROGRESS_v0.6.md).

## Overview

BYON Optimus integrates the **hybrid FAISS + FCE-M v0.6.0** memory backend (formerly FHRSS+FCPE; see banner) into a MACP v1.1 multi-agent pipeline. The architecture follows a strict layered design with clear separation of concerns: Worker plans, Auditor validates and Ed25519-signs ExecutionOrders, Executor runs in an air-gapped container.

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenClaw Platform                         │
│              (SINGLE Communication Gateway)                  │
│    [Telegram] [Discord] [Web] [CLI] [Custom Channels]       │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                   BYON Orchestrator                          │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐                 │
│  │  Worker  │──▶│ Auditor  │──▶│ Executor │                 │
│  │  Agent   │   │  Agent   │   │  (AIR-   │                 │
│  │          │   │ (Ed25519)│   │  GAPPED) │                 │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘                 │
│       │              │              │                        │
│       ▼              ▼              ▼                        │
│  ┌──────────────────────────────────────────┐               │
│  │         File-Based Handoff System        │               │
│  │  inbox/ → w2a/ → a2u/ → a2e/ → e2w/     │               │
│  └──────────────────────────────────────────┘               │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                   Memory Layer                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              FHRSS+FCPE Memory System                 │   │
│  │   • 73,000x compression via FCPE                      │   │
│  │   • 100% recovery at 50% data loss via FHRSS          │   │
│  │   • Semantic search with embeddings                   │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           Global Memory Vitalizer (GMV)               │   │
│  │   • Read-only daemon                                  │   │
│  │   • Attractor clustering                              │   │
│  │   • Coherence metrics                                 │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Layer Architecture

### Layer 1: OpenClaw Platform Layer

**Role**: SINGLE communication gateway for all inbound/outbound messages.

- All messages flow through OpenClaw channels
- BYON does NOT implement direct channel I/O
- Enforced by `platform-gate.ts`

**Components**:
- Gateway (port 3000)
- Channel adapters (Telegram, Discord, Web, CLI)
- UI components for approvals

### Layer 2: BYON Orchestration Layer

**Role**: Decision making - process input, consult memory, generate plans.

**Components**:
- Worker Agent
- Evidence Builder
- Plan Generator
- Memory Context Manager

### Layer 3: Security & Validation Layer

**Role**: Validate plans, enforce policies, sign execution orders.

**Components**:
- Auditor Agent
- Ed25519 Signer
- Policy Enforcer
- Approval Manager

### Layer 4: Execution Layer

**Role**: SINGLE execution engine (air-gapped).

- Executor has NO network access (`network_mode: none`)
- All commands must be Ed25519 signed
- Enforced by `execution-gate.ts`

**Components**:
- Executor Agent
- Signature Verifier
- Action Handlers
- Receipt Generator

### Layer 5: Memory & Persistence Layer

**Role**: Infinite memory, audit trail, calendar indexing.

**Components**:
- FHRSS+FCPE Memory Service
- Audit Service
- Calendar Index
- Global Memory Vitalizer (GMV)

## MACP Protocol v1.1

The Multi-Agent Control Protocol defines the document flow:

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│ EvidencePack │────▶│  PlanDraft  │────▶│ ApprovalReq  │
│   (Worker)   │     │  (Worker)   │     │  (Auditor)   │
└─────────────┘     └─────────────┘     └──────┬───────┘
                                               │
                                               ▼
┌─────────────┐                        ┌──────────────┐
│ JohnsonRcpt │◀───────────────────────│ExecutionOrder│
│  (Executor) │                        │ (Auditor)    │
└─────────────┘                        └──────────────┘
```

### Document Types

1. **EvidencePack**: Facts, quotes, codebase context from user request
2. **PlanDraft**: Proposed actions with risk assessment
3. **ApprovalRequest**: User-facing approval form (medium/high risk)
4. **ExecutionOrder**: Signed, immutable action instructions
5. **JohnsonReceipt**: Execution results and verification status

## Security Architecture

### Ed25519 Signing

All execution orders are cryptographically signed:

```typescript
interface ExecutionOrder {
    order_id: string;
    based_on_plan: string;
    actions: Action[];
    signature: string;  // Ed25519 signature
    hash: string;       // SHA-256 hash
}
```

### Air-Gap Isolation

The Executor container runs with `network_mode: none`:

```yaml
byon-executor:
    network_mode: none  # TRUE AIR-GAP
    volumes:
        - ./handoff/auditor_to_executor:/handoff/in:ro
        - ./handoff/executor_to_worker:/handoff/out
        - ./project:/workspace
```

### Policy Enforcement

Multiple layers of policy checks:

1. **Action Whitelist**: Allowed action types
2. **Forbidden Paths**: System/credential/VCS directories
3. **Forbidden Patterns**: Network/process/eval code
4. **Risk Assessment**: Weighted factor scoring

## File-Based Handoff

Agents communicate via file-based message passing:

```
handoff/
├── inbox/                  # External messages
├── worker_to_auditor/      # Evidence + Plan
├── auditor_to_user/        # Approval requests
├── auditor_to_executor/    # Signed orders
└── executor_to_worker/     # Receipts
```

Benefits:
- Decoupled agents
- Easy debugging (inspect files)
- Docker volume compatible
- Audit trail preserved

## Memory Architecture

### FHRSS+FCPE

- **FCPE**: Fractal Chaos Pattern Encoding (73,000x compression)
- **FHRSS**: Fault-Harmonic Recovery Structural System (100% recovery at 50% loss)

### Memory Types

```typescript
type MemoryType = "code" | "conversation" | "fact";

interface MemoryContext {
    ctx_id: number;
    content: string;
    memory_type: MemoryType;
    embedding: number[];
    timestamp: string;
}
```

### Global Memory Vitalizer (GMV)

Non-decision daemon that maintains emergent memory state:

- **Read-only** on FHRSS+FCPE data
- **Write-only** metadata outputs
- Computes Attractors (semantic clusters)
- Calculates system coherence

## Docker Architecture

```yaml
services:
  memory-service:       # Python FHRSS+FCPE wrapper
  byon-worker:          # TypeScript worker agent
  byon-auditor:         # TypeScript auditor + signer
  byon-executor:        # AIR-GAPPED executor
  openclaw-gateway:     # OpenClaw platform
  redis:                # Session/cache storage
  watcher:              # File watcher service
```

## Directory Structure

```
byon_optimus/
├── byon-orchestrator/
│   ├── src/
│   │   ├── agents/
│   │   │   ├── worker/
│   │   │   ├── auditor/
│   │   │   └── executor/
│   │   ├── protocol/
│   │   ├── memory/
│   │   ├── policy/
│   │   ├── audit/
│   │   ├── handoff/
│   │   └── cli/
│   ├── memory-service/
│   │   ├── server.py
│   │   └── handlers.py
│   └── tests/
├── Byon_bot/openclaw-main/
├── INFINIT_MEMORYCONTEXT/
├── handoff/
├── keys/
└── docker-compose.yml
```

## Key Constraints

1. **Platform Constraint**: OpenClaw is the SINGLE communication platform
2. **Execution Constraint**: byon-executor is the SINGLE execution engine
3. **Memory Constraint**: BYON MUST NOT START without memory service
4. **Signing Constraint**: All execution orders MUST be Ed25519 signed
5. **Air-Gap Constraint**: Executor has ZERO network access
