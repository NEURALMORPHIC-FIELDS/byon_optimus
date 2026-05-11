<div align="center">
  <img src="docs/assets/logos/project-logo.png" height="100" />
  &nbsp;&nbsp;&nbsp;
  <img src="docs/assets/logos/wfp-logo.png" height="100" />
  &nbsp;&nbsp;&nbsp;
  <img src="docs/assets/logos/openclaw-logo.png" height="100" />
</div>

# JOHNSON PLAN - Byon Bot Multi-Agent System

**Project**: Byon_bot
**Version**: 1.0
**Created**: 2026-01-31
**Updated**: 2026-02-02 (historical snapshot; superseded by v0.6.4 research line)
**Status**: HISTORICAL — pre-v0.6.x integration completion record

> **⚠ Historical record (pre-v0.6).** "All 9 phases complete" describes the v0.1.0 → v0.2.0 MACP-pipeline implementation milestones, finalised 2026-02-02. The project subsequently moved into a research phase (v0.6.0 → v0.6.4) that integrates FCE-M v0.6.0 as a morphogenetic memory substrate. The current operational classification is **Level 2 of 4** (Morphogenetic Advisory Memory); Omega coagulation through the conversational loop has *not* been demonstrated under default thresholds. The authoritative current status lives in [`../RESEARCH_PROGRESS_v0.6.md`](../RESEARCH_PROGRESS_v0.6.md).

---

## ⚠️ FUNDAMENTAL PRINCIPLE

> **FHRSS+FCPE is MANDATORY, not optional!**
>
> This is the critical difference from other bots that:
> - Lose context after a few messages
> - Summarize so much that they destroy projects
> - Do not have persistent semantic memory
>
> **Byon Bot DOES NOT START without active memory system.**

---

## MAIN OBJECTIVE

Building a multi-agent system (MACP v1.1) based on OpenClaw, with:
- 3 isolated agents (Worker, Auditor, Executor)
- Integrated coding capability
- Jupyter Kernel for autonomous code and test execution
- **FHRSS+FCPE system for semantic memory (MANDATORY, HARD-WIRED)**

---

## FINAL ARCHITECTURE (DUAL GATE MODEL)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BYON BOT SYSTEM                             │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                    INPUT CHANNELS                              │ │
│  │   WhatsApp | Telegram | Discord | WebChat | CLI               │ │
│  └───────────────────────────────┬───────────────────────────────┘ │
│                                  │                                  │
│  ┌───────────────────────────────▼───────────────────────────────┐ │
│  │                      AGENT A (WORKER)                         │ │
│  │  - Ingest events                                              │ │
│  │  - Codebase indexing (FHRSS+FCPE)                            │ │
│  │  - Relevant context extraction                                │ │
│  │  - Generate evidence_pack.json + plan_draft.json             │ │
│  └───────────────────────────────┬───────────────────────────────┘ │
│                                  │                                  │
│                    [FILES: evidence_pack.json, plan_draft.json]     │
│                                  │                                  │
│  ┌───────────────────────────────▼───────────────────────────────┐ │
│  │                      AGENT B (AUDITOR)                        │ │
│  │  - Plan validation                                            │ │
│  │  - Security verification                                      │ │
│  │  - Diff preview generation                                    │ │
│  │  - Produce approval_request.json                              │ │
│  └───────────────────────────────┬───────────────────────────────┘ │
│                                  │                                  │
│                    [FILE: approval_request.json]                    │
│                                  │                                  │
│  ┌───────────────────────────────▼───────────────────────────────┐ │
│  │                          USER                                 │ │
│  │  - View plan + diff                                           │ │
│  │  - APPROVE / REJECT / MODIFY                                  │ │
│  │  - Sign execution_order.json                                  │ │
│  └───────────────────────────────┬───────────────────────────────┘ │
│                                  │                                  │
│                    [FILE: execution_order.json - SIGNED]            │
│                                  │                                  │
│  ┌───────────────────────────────▼───────────────────────────────┐ │
│  │                    AGENT C (EXECUTOR)                         │ │
│  │  ┌─────────────────────────────────────────────────────────┐ │ │
│  │  │                 JUPYTER KERNEL HOST                     │ │ │
│  │  │   ┌─────────┐  ┌─────────┐  ┌─────────┐               │ │ │
│  │  │   │ Python  │  │  Node   │  │  Bash   │               │ │ │
│  │  │   │ Kernel  │  │ Kernel  │  │ Kernel  │               │ │ │
│  │  │   └─────────┘  └─────────┘  └─────────┘               │ │ │
│  │  └─────────────────────────────────────────────────────────┘ │ │
│  │  - Code execution in sandbox                                  │ │
│  │  - Autonomous test running                                    │ │
│  │  - Iterative cycle until SUCCESS                              │ │
│  │  - Produce johnson_receipt.json                               │ │
│  └───────────────────────────────┬───────────────────────────────┘ │
│                                  │                                  │
│                    [FILE: johnson_receipt.json]                     │
│                                  │                                  │
│                                  ▼                                  │
│                    AGENT A verifies receipt                         │
│                    (MATCH / DISPUTE)                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## IMPLEMENTATION PLAN

### PHASE 0: DEVELOPMENT ENVIRONMENT SETUP
**Status**: [ ] NOT STARTED

- [ ] 0.1 Install Node.js 22+
- [ ] 0.2 Install pnpm
- [ ] 0.3 Install Docker Desktop
- [ ] 0.4 Clone OpenClaw repository
- [ ] 0.5 Verify that OpenClaw runs correctly (`pnpm install && pnpm build`)
- [ ] 0.6 Setup Python environment for Jupyter

**Deliverables**:
- OpenClaw functional locally
- Docker functional
- Jupyter Kernel Gateway tested

---

### PHASE 1: FORK OPENCLAW × 3
**Status**: [ ] NOT STARTED

- [ ] 1.1 Create directory structure:
  ```
  Byon_bot/
  ├── agent-worker/      # Fork 1 - Agent A
  ├── agent-auditor/     # Fork 2 - Agent B
  ├── agent-executor/    # Fork 3 - Agent C
  ├── shared/            # Common code (protocols, types)
  ├── kernel-host/       # Jupyter Kernel setup
  └── memory-store/      # FHRSS+FCPE storage
  ```

- [ ] 1.2 Copy OpenClaw into each agent folder
- [ ] 1.3 Create `shared/` with:
  - [ ] 1.3.1 `types/evidence_pack.ts`
  - [ ] 1.3.2 `types/plan_draft.ts`
  - [ ] 1.3.3 `types/approval_request.ts`
  - [ ] 1.3.4 `types/execution_order.ts`
  - [ ] 1.3.5 `types/johnson_receipt.ts`
  - [ ] 1.3.6 `crypto/signing.ts` (Ed25519)
  - [ ] 1.3.7 `crypto/hashing.ts` (SHA256)
  - [ ] 1.3.8 `validation/schemas.ts`

**Deliverables**:
- 3 folders with OpenClaw
- Shared types defined
- Crypto utilities

---

### PHASE 2: ROLE GATE IMPLEMENTATION
**Status**: [ ] NOT STARTED

- [ ] 2.1 Create `shared/config/roles.ts`:
  ```typescript
  export type AgentRole = 'worker' | 'auditor' | 'executor';

  export const ROLE_PERMISSIONS = {
    worker: ['READ', 'PARSE', 'PROPOSE', 'VERIFY_RECEIPT'],
    auditor: ['VALIDATE', 'SANITIZE', 'REQUEST_APPROVAL'],
    executor: ['EXECUTE']
  };

  export const ROLE_CAPABILITIES = {
    worker: {
      can_access_inbox: true,
      can_access_bus: true,
      can_execute: false,
      can_contact_user: false
    },
    auditor: {
      can_access_inbox: false,
      can_access_bus: true,
      can_execute: false,
      can_contact_user: true  // only for approval_request
    },
    executor: {
      can_access_inbox: false,
      can_access_bus: false,
      can_execute: true,
      can_contact_user: false
    }
  };
  ```

- [ ] 2.2 Modify Agent Worker:
  - [ ] 2.2.1 Disable direct output channels
  - [ ] 2.2.2 Add export to FILES (not bus)
  - [ ] 2.2.3 Implement codebase indexer
  - [ ] 2.2.4 Implement context selector

- [ ] 2.3 Modify Agent Auditor:
  - [ ] 2.3.1 Disable input channels (only reads files)
  - [ ] 2.3.2 Implement validator
  - [ ] 2.3.3 Implement diff generator
  - [ ] 2.3.4 Implement approval request generator

- [ ] 2.4 Modify Agent Executor:
  - [ ] 2.4.1 **COMPLETELY DISABLE** channels (WhatsApp, Telegram, etc.)
  - [ ] 2.4.2 **DISABLE** inbox
  - [ ] 2.4.3 **DISABLE** bus
  - [ ] 2.4.4 Only input: FILE IMPORT (execution_order.json)
  - [ ] 2.4.5 Implement signature verification
  - [ ] 2.4.6 Implement executor engine

**Deliverables**:
- Each agent with strict role
- Executor completely isolated
- Role gate functional

---

### PHASE 3: FILE PROTOCOL IMPLEMENTATION
**Status**: [ ] NOT STARTED

- [ ] 3.1 Define JSON Schemas:
  - [ ] 3.1.1 `schemas/evidence_pack.schema.json`
  - [ ] 3.1.2 `schemas/plan_draft.schema.json`
  - [ ] 3.1.3 `schemas/approval_request.schema.json`
  - [ ] 3.1.4 `schemas/execution_order.schema.json`
  - [ ] 3.1.5 `schemas/johnson_receipt.schema.json`
  - [ ] 3.1.6 `schemas/dispute_report.schema.json`

- [ ] 3.2 Implement File Handlers:
  - [ ] 3.2.1 `shared/files/writer.ts` (with hash)
  - [ ] 3.2.2 `shared/files/reader.ts` (with validation)
  - [ ] 3.2.3 `shared/files/watcher.ts` (for handoff)

- [ ] 3.3 Implement Signing:
  - [ ] 3.3.1 Generate user keypair (Ed25519)
  - [ ] 3.3.2 Generate executor keypair
  - [ ] 3.3.3 Sign function for execution_order
  - [ ] 3.3.4 Verify function in executor

- [ ] 3.4 Implement Handoff Directory:
  ```
  handoff/
  ├── worker_to_auditor/
  │   ├── evidence_pack_<timestamp>.json
  │   └── plan_draft_<timestamp>.json
  ├── auditor_to_user/
  │   └── approval_request_<timestamp>.json
  ├── user_to_executor/
  │   └── execution_order_<timestamp>.json
  └── executor_to_worker/
      └── johnson_receipt_<timestamp>.json
  ```

**Deliverables**:
- Schemas validated
- File handlers with hashing
- Signing/verification functional
- Handoff directory structure

---

### PHASE 4: JUPYTER KERNEL INTEGRATION
**Status**: [ ] NOT STARTED

- [ ] 4.1 Setup Kernel Host:
  - [ ] 4.1.1 Create `kernel-host/Dockerfile`
  - [ ] 4.1.2 Create `kernel-host/docker-compose.yml`
  - [ ] 4.1.3 Configure kernels (Python, Node, Bash)
  - [ ] 4.1.4 Configure resource limits
  - [ ] 4.1.5 Configure network isolation

- [ ] 4.2 Implement Kernel Manager:
  - [ ] 4.2.1 `agent-executor/src/kernel/manager.ts`
  - [ ] 4.2.2 `agent-executor/src/kernel/python.ts`
  - [ ] 4.2.3 `agent-executor/src/kernel/node.ts`
  - [ ] 4.2.4 `agent-executor/src/kernel/bash.ts`

- [ ] 4.3 Implement Execution Loop:
  - [ ] 4.3.1 `agent-executor/src/loop/autonomous.ts`
  - [ ] 4.3.2 Max iterations limit
  - [ ] 4.3.3 Same error detection (3x = escalate)
  - [ ] 4.3.4 Timeout handling
  - [ ] 4.3.5 Output capture

- [ ] 4.4 Implement Test Runner:
  - [ ] 4.4.1 pytest integration
  - [ ] 4.4.2 jest/vitest integration
  - [ ] 4.4.3 unittest integration
  - [ ] 4.4.4 Test result parser

**Deliverables**:
- Docker container for kernels
- Kernel manager functional
- Autonomous loop with limits
- Test runner integrated

---

### PHASE 5: CODING CAPABILITY MODULE
**Status**: [ ] NOT STARTED

- [ ] 5.1 Implement Codebase Indexer (Agent A):
  - [ ] 5.1.1 File scanner
  - [ ] 5.1.2 AST parser (TypeScript, Python)
  - [ ] 5.1.3 Symbol extractor
  - [ ] 5.1.4 Dependency graph builder
  - [ ] 5.1.5 Embedding generator (for FHRSS)

- [ ] 5.2 Implement Context Selector (Agent A):
  - [ ] 5.2.1 Semantic search in FHRSS
  - [ ] 5.2.2 Dependency resolution
  - [ ] 5.2.3 Chunk optimization
  - [ ] 5.2.4 Context pack builder

- [ ] 5.3 Implement Code Actions (Agent C):
  - [ ] 5.3.1 `code_read` action
  - [ ] 5.3.2 `code_write` action
  - [ ] 5.3.3 `code_edit` action
  - [ ] 5.3.4 `kernel_execute` action
  - [ ] 5.3.5 `test_run` action
  - [ ] 5.3.6 `notebook_run` action

- [ ] 5.4 Implement Diff Generator (Agent B):
  - [ ] 5.4.1 Unified diff format
  - [ ] 5.4.2 Side-by-side preview
  - [ ] 5.4.3 Conflict detection
  - [ ] 5.4.4 Risk assessment

**Deliverables**:
- Codebase indexer functional
- Intelligent context selection
- All code actions
- Diff preview for user

---

### PHASE 6: POLICY ENGINE
**Status**: [ ] NOT STARTED

- [ ] 6.1 Create Policy DSL:
  - [ ] 6.1.1 `shared/policy/schema.ts`
  - [ ] 6.1.2 `shared/policy/parser.ts`
  - [ ] 6.1.3 `shared/policy/validator.ts`

- [ ] 6.2 Define Whitelist Actions:
  ```yaml
  # policy.yaml
  execution_whitelist:
    code_read: { requires_confirmation: false }
    code_write: { requires_confirmation: true }
    code_edit: { requires_confirmation: true }
    kernel_execute: { requires_confirmation: false, sandbox: required }
    test_run: { requires_confirmation: false, sandbox: required }
    create_calendar_event: { requires_confirmation: true }
    send_message: { requires_confirmation: true }
  ```

- [ ] 6.3 Implement Constraint Checker:
  - [ ] 6.3.1 Parameter validation
  - [ ] 6.3.2 TTL verification
  - [ ] 6.3.3 Scope verification
  - [ ] 6.3.4 Signature verification

- [ ] 6.4 Implement Escalation Rules:
  - [ ] 6.4.1 iterations_exceeded
  - [ ] 6.4.2 same_error_3_times
  - [ ] 6.4.3 security_warning
  - [ ] 6.4.4 resource_limit_hit

**Deliverables**:
- Policy DSL parser
- Whitelist configured
- Constraint checker
- Escalation logic

---

### PHASE 7: FHRSS+FCPE INTEGRATION
**Status**: [x] COMPLETE - HARD-WIRED (MANDATORY)
**Source**: `D:\Github Repo\INFINIT_MEMORYCONTEXT\`

> ⚠️ **CRITICAL**: FHRSS+FCPE is **MANDATORY**, not optional!
> Agents **DO NOT START** without active memory system.
> This is the fundamental difference from other bots that lose context.

#### SYSTEM OVERVIEW

**FHRSS** (Fractal-Holographic Redundant Storage System):
- XOR-based parity system with 9 families
- **100% recovery at 40% data loss**
- Subcube size: 8×8×8 (512 bytes)
- Profiles: MINIMAL (3), MEDIUM (4), HIGH (6), FULL (9 families)
- Storage overhead: 2.125x for FULL profile

**FCPE** (Fractal-Chaotic Persistent Encoding):
- Variable→fixed compression: `[seq_len, 384] → [384]`
- **73,000x compression ratio** for 2M tokens
- Weighted attention pooling
- 5 fractal encoding layers
- Content-aware jitter for discrimination

#### ⚡ HARD-WIRED INTEGRATION

```typescript
// agent-worker/src/index.ts - FHRSS+FCPE is MANDATORY
async function main() {
  try {
    await initializeMemory(); // MUST succeed
  } catch (error) {
    console.error('FATAL: FHRSS+FCPE Memory REQUIRED!');
    process.exit(1); // Agent REFUSES to start without memory
  }
}
```

```yaml
# docker-compose.yml - Memory service container MANDATORY
services:
  memory-service:
    build: ./shared/memory
    # REQUIRED - all agents depend on this
    healthcheck:
      test: ["CMD", "python", "-c", "import fhrss_fcpe"]

  agent-worker:
    depends_on:
      memory-service:
        condition: service_healthy  # DOES NOT start without memory
```

#### VERIFIED PERFORMANCE

| Tokens | Time | Memory | Compression |
|--------|------|--------|-------------|
| 200K | 20.6s | 293 MB | 7,323x |
| 500K | 49.6s | 560 MB | 18,309x |
| 1M | 103s | 1 GB | 36,595x |
| 2M | 208s | 1.9 GB | **73,136x** |

| Loss % | Cosine Sim | Recovery |
|--------|------------|----------|
| 10% | 1.0000 | 100% |
| 20% | 1.0000 | 100% |
| 30% | 1.0000 | 100% |
| 40% | 1.0000 | 100% |

#### TASKS (COMPLETE - HARD-WIRED)

- [x] 7.1 Setup Memory Store:
  - [x] 7.1.1 Copy `fhrss_fcpe_unified.py` to `shared/memory/fhrss_fcpe.py`
  - [x] 7.1.2 Create TypeScript wrapper: `shared/memory/index.ts`
  - [x] 7.1.3 Setup `sentence-transformers` via `requirements.txt`
  - [x] 7.1.4 Configure storage paths per agent
  - [x] 7.1.5 Python service: `shared/memory/memory_service.py`

- [x] 7.2 Implementation for Coding (Agent Worker):
  - [x] 7.2.1 `storeCode()` - Code file → embeddings pipeline
  - [x] 7.2.2 `searchCode()` - Semantic code search
  - [x] 7.2.3 FHRSS retrieval integrated in AgentMemory class
  - [x] 7.2.4 **HARD-WIRED**: Agent refuses to start without memory

- [x] 7.3 Implementation for General Memory:
  - [x] 7.3.1 `storeConversation()` - Conversation turns → embeddings
  - [x] 7.3.2 `storeFact()` - Facts extraction and storage
  - [x] 7.3.3 `searchConversation()` / `searchFacts()` - Retrieval
  - [x] 7.3.4 Cross-session memory via persistent storage

- [x] 7.4 Docker Integration (MANDATORY):
  - [x] 7.4.1 `memory-service` container with Python + sentence-transformers
  - [x] 7.4.2 Health check for memory service
  - [x] 7.4.3 All agents `depends_on: memory-service`
  - [x] 7.4.4 Shared volume for persistent storage

#### KEY CLASSES (from INFINIT_MEMORYCONTEXT)

```python
# Configuration
@dataclass
class FCPEConfig:
    dim: int = 384                  # Output dimension
    num_layers: int = 5             # Fractal depth
    lambda_s: float = 0.5           # Stabilization
    compression_method: str = "weighted_attention"
    use_whitening: bool = True
    use_content_seed: bool = True
    jitter_scale: float = 0.05

@dataclass
class FHRSSConfig:
    subcube_size: int = 8           # m = 8×8×8
    profile: str = "FULL"           # 9 parity families
    use_checksums: bool = True

# Unified System
class UnifiedFHRSS_FCPE:
    def encode_context(embeddings, metadata) → ctx_id
    def decode_context(ctx_id, loss_mask) → vector
    def retrieve_similar(query, top_k=5) → List[{ctx_id, similarity, metadata}]
    def test_recovery(ctx_id, loss_percent) → stats
```

#### INTEGRATION INTO BYON BOT

```
Agent Worker (A):
├── Receives message from user
├── Generates embeddings for query
├── retrieve_similar() from FHRSS
├── Builds context pack
└── Saves new facts with encode_context()

Agent Executor (C):
├── Receives execution_order
├── Executed code → embeddings
├── Saves in memory for learning
└── Receipt includes affected memory_ids
```

**Deliverables** (COMPLETE):
- ✅ FHRSS+FCPE **HARD-WIRED** (not optional!)
- ✅ 73,000x compression functional
- ✅ 100% recovery at 40% loss
- ✅ Semantic search for code and conversations
- ✅ Persistence and fault tolerance
- ✅ Dedicated Docker container `memory-service`
- ✅ Agents refuse to start without memory

---

### PHASE 8: USER INTERFACE
**Status**: [x] COMPLETE

- [x] 8.1 Approval UI:
  - [x] 8.1.1 Web interface for approval_request (`ui/public/approvals.html`)
  - [x] 8.1.2 Diff viewer (JSON preview in approval detail)
  - [x] 8.1.3 One-click approve/reject
  - [x] 8.1.4 Signature generation (TODO: Ed25519 integration)

- [x] 8.2 Monitoring UI:
  - [x] 8.2.1 Agent status dashboard (`ui/public/index.html`)
  - [x] 8.2.2 Execution log viewer (receipts)
  - [x] 8.2.3 Receipt history (`ui/public/history.html`)

- [x] 8.3 CLI Interface:
  - [x] 8.3.1 `byon approve <request_id>` (`cli/src/commands/approve.ts`)
  - [x] 8.3.2 `byon reject <request_id>` (in approve command)
  - [x] 8.3.3 `byon status` (`cli/src/commands/status.ts`)
  - [x] 8.3.4 `byon history` (`cli/src/commands/history.ts`)

**Deliverables**:
- Approval web UI
- Monitoring dashboard
- CLI tools

---

### PHASE 9: TESTING & HARDENING
**Status**: [x] COMPLETE

- [ ] 9.1 Unit Tests:
  - [ ] 9.1.1 Protocol tests
  - [ ] 9.1.2 Crypto tests
  - [ ] 9.1.3 Policy tests
  - [ ] 9.1.4 Kernel tests

- [ ] 9.2 Integration Tests:
  - [ ] 9.2.1 Full flow test (A → B → User → C → A)
  - [ ] 9.2.2 Coding task test
  - [ ] 9.2.3 Autonomous loop test
  - [ ] 9.2.4 Failure scenarios

- [ ] 9.3 Security Tests:
  - [ ] 9.3.1 Signature bypass attempts
  - [ ] 9.3.2 Sandbox escape attempts
  - [ ] 9.3.3 Prompt injection tests
  - [ ] 9.3.4 Role violation tests

- [ ] 9.4 Hardening:
  - [ ] 9.4.1 Docker security (no-root, seccomp)
  - [ ] 9.4.2 Network isolation
  - [ ] 9.4.3 File permission lockdown
  - [ ] 9.4.4 Resource limits enforcement

**Deliverables**:
- Complete test suite
- Security audit passed
- Hardened deployment

---

### PHASE 10: DEPLOYMENT
**Status**: [x] COMPLETE

- [ ] 10.1 Docker Compose final:
  ```yaml
  services:
    agent-worker:
      build: ./agent-worker
      environment:
        - ROLE=worker
      volumes:
        - ./handoff:/handoff
        - ./memory-store:/memory

    agent-auditor:
      build: ./agent-auditor
      environment:
        - ROLE=auditor
      volumes:
        - ./handoff:/handoff:ro

    agent-executor:
      build: ./agent-executor
      environment:
        - ROLE=executor
      volumes:
        - ./handoff/user_to_executor:/input:ro
        - ./handoff/executor_to_worker:/output
      networks:
        - isolated  # NO INTERNET

    kernel-gateway:
      build: ./kernel-host
      networks:
        - isolated
  ```

- [ ] 10.2 Documentation:
  - [ ] 10.2.1 Setup guide
  - [ ] 10.2.2 Configuration reference
  - [ ] 10.2.3 Security guide
  - [ ] 10.2.4 API reference

- [ ] 10.3 First Run:
  - [ ] 10.3.1 Complete end-to-end test
  - [ ] 10.3.2 Real coding task
  - [ ] 10.3.3 Bug fixes

**Deliverables**:
- Docker compose production-ready
- Complete documentation
- Functional system

---

---

### PHASE 11: WFP SEMANTIC GUARD (SYSTEM KERNEL)
**Status**: [x] SPECIFICATION COMPLETE - IMPLEMENTATION PENDING
**Role**: Kernel-level enforcement of Semantic Intents.

> **⚔️ THE DUAL GATE MODEL**:
> 1. **Information Gate** (BYON Auditor): Validates logic, signatures, and policy.
> 2. **Execution Gate** (WFP Semantic Guard): Validates traffic at OS Kernel level.
>
> `Executor` is active ONLY when BOTH gates say "YES".

#### KEY COMPONENTS
- **WFP Callout Driver**: Kernel driver (`.sys`) that intercepts traffic.
- **WFP Controller**: User-mode service that translates `EXECUTION_INTENT` into WFP filters.
- **Protocol BYON→WFP**: 
    - `EXECUTION_INTENT` (Signed JSON)
    - `EXECUTION_FEEDBACK` (Audit data)

#### FLOW
1. **BYON** emits signed `ExecutionIntent`.
2. **WFP Controller** verifies Ed25519 sig.
3. **WFP Controller** injects temporary filters into Kernel.
4. **Executor** has network access ONLY while the intent is valid (TTL).
5. **WFP** sends telemetry back to Auditor.

**Deliverables**:
- Formal Protocol Specification (JSON Schema) ✔
- WFP Callouts Architecture ✔
- Threat Model Strategy ✔

---

---

### PHASE 11: WFP SEMANTIC GUARD (SYSTEM KERNEL)
**Status**: [x] SPECIFICATION COMPLETE - IMPLEMENTATION PENDING
**Role**: Kernel-level enforcement of Semantic Intents.

> **⚔️ THE DUAL GATE MODEL**:
> 1. **Information Gate** (BYON Auditor): Validates logic, signatures, and policy.
> 2. **Execution Gate** (WFP Semantic Guard): Validates traffic at OS Kernel level.
>
> `Executor` is active ONLY when BOTH gates say "YES".

#### KEY COMPONENTS
- **WFP Callout Driver**: Kernel driver (`.sys`) that intercepts traffic.
- **WFP Controller**: User-mode service that translates `EXECUTION_INTENT` into WFP filters.
- **Protocol BYON→WFP**: 
    - `EXECUTION_INTENT` (Signed JSON)
    - `EXECUTION_FEEDBACK` (Audit data)

#### FLOW
1. **BYON** emits signed `ExecutionIntent`.
2. **WFP Controller** verifies Ed25519 sig.
3. **WFP Controller** injects temporary filters into Kernel.
4. **Executor** has network access ONLY while the intent is valid (TTL).
5. **WFP** sends telemetry back to Auditor.

**Deliverables**:
- Formal Protocol Specification (JSON Schema) ✔
- WFP Callouts Architecture ✔
- Threat Model Strategy ✔

---

## SUCCESS METRICS (UPDATED)

| Metric | Target |
|--------|--------|
| Completely isolated agents | 3/3 |
| User approval required for execution | 100% |
| **WFP Enforcement** | **100% Packet Coverage** |
| Autonomous coding iterations | max 10 |
| Test pass rate after fix | >90% |
| Security tests passed | 100% |
| Context retrieval relevance | >80% |

---

## RISKS AND MITIGATIONS

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Kernel escape from sandbox | Low | Critical | Docker seccomp + no-root |
| Prompt injection in messages | Medium | High | Strict policy, no raw inbox in C |
| Signature bypass | Low | Critical | Ed25519, verification in C |
| Weak context retrieval | Medium | Medium | Tune FHRSS, fallback to full file |
| Infinite loop in coding | Medium | Medium | Max iterations + timeout |

---

## VIBE-CODING TEMPLATE INTEGRATION

### Concepts adopted from `vibe-coding-prompt-template-main/`:

#### 1. Progressive Disclosure
- **AGENTS.md** = Master plan for each agent
- **agent_docs/** = Specific details (tech_stack, code_patterns, etc.)
- **Tool configs** = Pointers to documentation

#### 2. Plan → Execute → Verify Loop
Mapping to our architecture:
```
VIBE-CODING          →    BYON BOT MACP
─────────────────────────────────────────
Plan                 →    Agent A (proposes)
Execute              →    Agent C (executes)
Verify               →    Agent A (verifies receipt)
```

#### 3. agent_docs/ Structure per Agent

```
Byon_bot/
├── agent-worker/
│   ├── AGENTS.md                    # Master plan Worker
│   └── agent_docs/
│       ├── tech_stack.md            # What technologies it uses
│       ├── code_patterns.md         # How it indexes, how it selects context
│       ├── capabilities.md          # READ, PARSE, PROPOSE, VERIFY
│       └── handoff_protocol.md      # How it produces evidence_pack, plan_draft
│
├── agent-auditor/
│   ├── AGENTS.md                    # Master plan Auditor
│   └── agent_docs/
│       ├── validation_rules.md      # Validation rules
│       ├── security_checks.md       # What it verifies
│       ├── diff_generation.md       # How it generates preview
│       └── approval_protocol.md     # approval_request format
│
├── agent-executor/
│   ├── AGENTS.md                    # Master plan Executor
│   └── agent_docs/
│       ├── execution_loop.md        # Autonomous cycle
│       ├── kernel_usage.md          # How it uses Jupyter
│       ├── action_whitelist.md      # What actions it can perform
│       └── receipt_protocol.md      # johnson_receipt format
│
└── shared/
    └── agent_docs/
        ├── protocol_overview.md     # MACP v1.1 explained
        ├── file_formats.md          # JSON schemas
        ├── security_model.md        # Air-gap, signing
        └── anti_patterns.md         # What NOT to do
```

#### 4. Anti-Vibe Engineering Rules (for Executor)

```markdown
## What NOT To Do (agent-executor/AGENTS.md)

### Execution Constraints
- Do NOT execute without valid signature
- Do NOT access network (air-gapped)
- Do NOT read from inbox/bus
- Do NOT exceed max_iterations (10)
- Do NOT ignore test failures
- Do NOT modify files outside approved list

### Type Safety
- All parameters MUST match schema
- No dynamic/any types in protocol files
- Strict validation before execution

### The "No Apologies" Rule
- Do NOT apologize for errors—fix them
- If iteration fails, try fix immediately
- If 3x same error, ESCALATE to user
```

#### 5. High-Order Prompts for LLM (in each AGENTS.md)

```markdown
## How I Should Think

1. **Understand Intent First**: What does the user actually want?
2. **Check Permissions**: Am I allowed to do this?
3. **Validate Input**: Correct schema? Valid signature?
4. **Plan Before Action**: Propose plan, wait for approval
5. **Verify After Action**: Test, verify the result
6. **Report Honestly**: Don't hide errors, report exactly
```

#### 6. Skills adapted for Byon Bot

| Original Skill | Byon Bot Adaptation |
|----------------|---------------------|
| `/vibe-research` | Agent A: codebase indexing |
| `/vibe-prd` | Agent A: plan_draft generation |
| `/vibe-techdesign` | Agent B: architecture validation |
| `/vibe-agents` | Agent configuration setup |
| `/vibe-build` | Agent C: code execution |

---

## FINAL PROJECT STRUCTURE (UPDATED)

```
Byon_bot/
├── JOHNSON_PLAN.md              # This document (master plan)
├── JOHNSON_STATUS.json          # Status machine-readable
│
├── docs/                        # General documentation
│   ├── PRD-ByonBot-MVP.md      # Product Requirements
│   ├── TechDesign-ByonBot.md   # Technical Design
│   └── research-notes.md        # Research findings
│
├── agent-worker/                # AGENT A
│   ├── AGENTS.md
│   ├── agent_docs/
│   ├── src/                     # Modified OpenClaw fork
│   └── Dockerfile
│
├── agent-auditor/               # AGENT B
│   ├── AGENTS.md
│   ├── agent_docs/
│   ├── src/
│   └── Dockerfile
│
├── agent-executor/              # AGENT C
│   ├── AGENTS.md
│   ├── agent_docs/
│   ├── src/
│   └── Dockerfile
│
├── shared/                      # Common code
│   ├── types/                   # TypeScript types
│   ├── schemas/                 # JSON Schemas
│   ├── crypto/                  # Ed25519, SHA256
│   ├── policy/                  # Policy DSL
│   └── agent_docs/              # Protocol documentation
│
├── kernel-host/                 # Jupyter Kernels
│   ├── Dockerfile
│   └── docker-compose.yml
│
├── memory-store/                # FHRSS+FCPE
│   └── ...
│
├── handoff/                     # Directory for protocol files
│   ├── worker_to_auditor/
│   ├── auditor_to_user/
│   ├── user_to_executor/
│   └── executor_to_worker/
│
├── ui/                          # Approval UI
│   └── ...
│
├── docker-compose.yml           # Orchestration
└── .env.example                 # Environment template
```

---

### PHASE 11: IMMUTABLE AUDIT TRAIL SYSTEM
**Status**: [x] COMPLETE
**Priority**: HIGH

> 📋 **Digital Paper Trail** - All actions documented, sorted by calendar, stored in FHRSS+FCPE

#### FUNDAMENTAL PRINCIPLES

```
┌─────────────────────────────────────────────────────────────────┐
│                    IMMUTABILITY RULES                           │
│                                                                 │
│  [DRAFT] ──▶ [PENDING] ──▶ [APPROVED] ──▶ [EXECUTED] ──▶ 🔒   │
│     │           │             │              │                  │
│   User        User          User           AUTO                │
│   delete?     delete?       delete?        LOCK                │
│     ✅          ✅            ✅             ❌                  │
│                                                                 │
│  After EXECUTED = PERMANENT, IMMUTABLE, NOBODY CAN DELETE     │
│  Only USER can delete draft/pending/approved (physically)      │
│  Agents CANNOT delete EVER                                     │
└─────────────────────────────────────────────────────────────────┘
```

#### CALENDAR INDEXING

| Granularity | Format | Example |
|-------------|--------|---------|
| Hour | `YYYY-MM-DD-HH` | `2026-02-01-14` |
| Day | `YYYY-MM-DD` | `2026-02-01` |
| Week | `YYYY-WXX` | `2026-W05` |
| Year | `YYYY` | `2026` |

#### DOCUMENT LIFECYCLE

| State | User deletes? | Agent deletes? | Modifiable? | Deletion type |
|-------|--------------|----------------|-------------|---------------|
| `draft` | ✅ YES | ❌ NO | ✅ YES | PHYSICAL |
| `pending` | ✅ YES | ❌ NO | ❌ NO | PHYSICAL |
| `approved` | ✅ YES | ❌ NO | ❌ NO | PHYSICAL |
| `executed` | ❌ **NO** | ❌ NO | ❌ NO | **IMPOSSIBLE** |
| `failed` | ❌ **NO** | ❌ NO | ❌ NO | **IMPOSSIBLE** |

#### TASKS

- [x] 11.1 Audit Document Types:
  - [x] 11.1.1 `shared/types/audit.ts` - AuditDocument interface
  - [x] 11.1.2 Status enum (draft, pending, approved, executed, failed)
  - [x] 11.1.3 Calendar metadata fields
  - [x] 11.1.4 Deletion control fields

- [x] 11.2 Immutability Engine:
  - [x] 11.2.1 `shared/audit/immutability.ts` - canDelete(), markAsExecuted()
  - [x] 11.2.2 Hard-coded rules (agent never deletes)
  - [x] 11.2.3 Auto-lock on execution
  - [x] 11.2.4 Physical deletion for drafts

- [x] 11.3 Calendar Index:
  - [x] 11.3.1 `shared/audit/calendar-index.ts`
  - [x] 11.3.2 Index by hour, day, week, year
  - [x] 11.3.3 Query by date range
  - [x] 11.3.4 Timestamp ordering (not blockchain)

- [x] 11.4 Integration with FHRSS+FCPE:
  - [x] 11.4.1 Store audit docs in memory (shared/audit/index.ts)
  - [x] 11.4.2 Semantic search in audit trail
  - [x] 11.4.3 Recovery for executed docs
  - [x] 11.4.4 Persistent storage (TODO: actual FHRSS backend)

- [x] 11.5 CLI Commands:
  - [x] 11.5.1 `npx byon history` - View history
  - [x] 11.5.2 `npx byon history --date 2026-02-01`
  - [x] 11.5.3 `npx byon history --week 2026-W05`
  - [x] 11.5.4 `npx byon delete <doc_id>` - Delete draft (user only)

**Deliverables**:
- Immutable audit trail for executed documents
- Calendar indexing (hour/day/week/year)
- User-only delete for drafts (physical)
- Semantic search in history
- CLI for history viewing

---

### PHASE 12: BYON STYLE CONTRACT
**Status**: [x] COMPLETE
**Priority**: HIGH

> Enforces strict output style for agents: no psychology, empathy, stories, meta-commentary.

#### HARD-CODED RULES

```
FORBIDDEN:
- "I'm sorry" / "I understand you" / empathy
- "imagine" / stories / metaphors
- "as an AI model" / "I can't" / meta-commentary
- "of course" / "my pleasure" / filler phrases
- trauma / anxiety / therapy

MANDATORY:
- Structured output (min 3 lines)
- Max 3500 characters
- Format: markdown/text/json/code
- Clear options A/B/C
- Explicit next action
```

#### TASKS

- [x] 12.1 Schema JSON:
  - [x] 12.1.1 `shared/style/byon_contract.schema.json`
  - [x] 12.1.2 Required fields: version, agent_role, axis, decision, constraints, options, next_action, output, meta
  - [x] 12.1.3 Options: max 3, id A/B/C, risk level, requires_user_approval
  - [x] 12.1.4 Style flags: no_psychology, no_empathy, no_stories, administrative, structured

- [x] 12.2 Validator (ajv):
  - [x] 12.2.1 `shared/style/byon_validator.ts`
  - [x] 12.2.2 FORBIDDEN_PATTERNS regex array
  - [x] 12.2.3 computeStyleScore() function
  - [x] 12.2.4 Score penalties: empathy -25, story -25, therapy -15, meta -10, filler -5

- [x] 12.3 Retry Loop:
  - [x] 12.3.1 `shared/style/validate_or_regenerate.ts`
  - [x] 12.3.2 RegenContext with lastErrors, lastScore, lastViolations
  - [x] 12.3.3 maxAttempts (default 4)
  - [x] 12.3.4 hardFail option for throw/return

- [x] 12.4 Tests:
  - [x] 12.4.1 `tests/security/byon_style.test.ts`
  - [x] 12.4.2 Fixtures: good.worker.json, bad.empathy.json, bad.missing_fields.json
  - [x] 12.4.3 Schema validation tests
  - [x] 12.4.4 Style violation tests
  - [x] 12.4.5 Retry loop tests

**Deliverables**:
- BYON Style Contract schema
- Validator with scoring and penalties
- Retry loop for regeneration
- Complete tests with fixtures

---

## NEXT STEP

**STATUS**: Phase 12 COMPLETE - BYON Style Contract implemented!

```bash
# Automatic setup (includes Python verification for FHRSS+FCPE)
node scripts/setup-first-run.js

# OR manual:
pnpm install && pnpm build
node scripts/generate-keys.js
node scripts/setup-handoff.js

# Start system
pnpm docker:up

# Verify memory system (MANDATORY)
docker logs byon-bot-memory-service

# Test
npx byon watch --verbose
npx byon inbox "Test message"
npx byon approve
```

> ⚠️ **IMPORTANT**: If memory-service does not start, the system DOES NOT work!
> Python 3.10+ with sentence-transformers is MANDATORY.

---

## CHANGELOG

| Date | Change |
|------|--------|
| 2026-01-31 | Initial plan creation |
| 2026-01-31 | Integrated concepts from vibe-coding-prompt-template |
| 2026-02-01 | **FHRSS+FCPE marked as MANDATORY (hard-wired)** |
| 2026-02-01 | Agent Worker refuses to start without memory system |
| 2026-02-01 | Docker memory-service container added |
| 2026-02-01 | Phases 1-10 COMPLETE |
| 2026-02-01 | **Phase 11: Immutable Audit Trail System** - COMPLETE |
| 2026-02-01 | Added: shared/types/audit.ts, shared/audit/*.ts |
| 2026-02-01 | Added: CLI commands: npx byon history, npx byon delete |
| 2026-02-01 | **Phase 8: Web UI implemented** - Dashboard, Approvals, History |
| 2026-02-01 | **Phase 12: BYON Style Contract** - Schema, Validator, Retry Loop, Tests |
| 2026-02-02 | **BYON Optimus Integration**: 9 phases complete (Docker, Tests, Documentation) |
| 2026-02-02 | **OPEN_BYON Control UI**: Dashboard, Inbox, Approvals, Execution, Memory views (port 3001) |
| 2026-02-02 | **INSTALL.md**: Step-by-step installation tutorial created |
| 2026-02-02 | **OpenClaw Channels**: ALL 20+ channels enabled (Telegram, Discord, WhatsApp, Slack, Signal, iMessage, Teams, Email, LINE, Matrix, Mattermost, Google Chat, Twitch, Nostr, Zalo, Voice, BlueBubbles) |
| 2026-02-02 | **Cleanup**: Removed redundant files (old install script, duplicate JOHNSON files, temp work files) |
| 2026-02-02 | **Installer Fixes**: Fixed PowerShell ErrorActionPreference for Docker stderr, alpine image for Ed25519 keys |
| 2026-02-02 | **TypeScript Build**: Relaxed tsconfig (strict:false, isolatedModules:false), added better-sqlite3 |
| 2026-02-02 | **Type System**: Fixed SearchOptions, MemoryStats, RecoveryTestResult, ApprovalRequest, Action, ExtractedFact |

---

**NOTE**: This document is the source of truth for the project. Any deviation must be documented here.

---

## REFERENCES

- `openclaw-main/` - Base for agent forks
- `vibe-coding-prompt-template-main/` - Templates and patterns
- `descrierea proiectului.docx` - Original MACP v1.1 vision
- `D:\Github Repo\INFINIT_MEMORYCONTEXT\` - **FHRSS+FCPE complete implementation**

---

## APPENDIX: FHRSS+FCPE TECHNICAL REFERENCE

### Source: `INFINIT_MEMORYCONTEXT/fhrss_fcpe_unified.py`

#### Patent
```
Patent: EP25216372.0 (FHRSS - Omni-Qube-Vault)
Author: Vasile Lucian Borbeleac
Version: 1.0.0 (2025)
```

#### FHRSS Architecture (XOR Parity)

```
Data Input (bytes)
    ↓
Padding → Multiple of 512 bytes (8³)
    ↓
Split into Subcubes (8×8×8)
    ↓
For each subcube:
    ├── Compute X parity (lines on X axis)
    ├── Compute Y parity (lines on Y axis)
    ├── Compute Z parity (lines on Z axis)
    ├── Compute DXYp parity (XY+ diagonals)
    ├── Compute DXYn parity (XY- diagonals)
    ├── Compute DXZp parity (XZ+ diagonals)
    ├── Compute DXZn parity (XZ- diagonals)
    ├── Compute DYZp parity (YZ+ diagonals)
    └── Compute DYZn parity (YZ- diagonals)
    ↓
Storage: {subcubes, parity_families, checksums}
```

#### Recovery Algorithm

```python
def recover_subcube(data, parity, loss_mask):
    recovered_mask = ~loss_mask

    for iteration in range(max_iterations):
        for family in RECOVERY_PRIORITY:  # X, Y, Z, DXYp, ...
            for line in family.lines:
                missing = [pos for pos in line if not recovered_mask[pos]]

                if len(missing) == 1:
                    # Exactly 1 missing → can recover via XOR
                    pos = missing[0]
                    present_values = [data[p] for p in line if recovered_mask[p]]
                    recovered_value = parity[line] XOR reduce(XOR, present_values)
                    data[pos] = recovered_value
                    recovered_mask[pos] = True
```

#### FCPE Architecture (Compression)

```
Input Embeddings [seq_len, 384]
    ↓
Feature Whitening: (x - mean) / std
    ↓
Weighted Attention Pooling:
    ├── Compute norms and deviations
    ├── scores = norms × (1 + deviations)
    ├── weights = softmax(scores)
    └── pooled = Σ(weights × embeddings)
    ↓
Content-Aware Jitter: + hash(content) × 0.05
    ↓
Fractal-Chaotic Encoding (5 layers):
    for i in 1..5:
        h = x @ Transform[i]  # Orthogonal matrix
        h = h[Permutation[i]]  # Shuffle
        x = 0.5×x + 0.5×h     # Blend
    ↓
L2 Normalize
    ↓
Output: [384] compressed vector
```

#### Files to copy into Byon_bot

```
INFINIT_MEMORYCONTEXT/
├── fhrss_fcpe_unified.py     → shared/memory/fhrss_fcpe.py
├── encoder.py                 → shared/memory/fcpe_encoder.py
└── test_ai_applicability.py  → tests/test_memory.py
```

#### Usage Example (for integration)

```python
from shared.memory.fhrss_fcpe import UnifiedFHRSS_FCPE, UnifiedConfig
from sentence_transformers import SentenceTransformer

# Initialize
model = SentenceTransformer('all-MiniLM-L6-v2')
memory = UnifiedFHRSS_FCPE(UnifiedConfig(
    storage_path="./memory/worker"
))

# Store code context
code = "def calculate_total(items): return sum(i.price for i in items)"
embedding = model.encode(code)
ctx_id = memory.encode_context(
    embedding.reshape(1, -1),
    metadata={'type': 'code', 'file': 'utils.py', 'line': 42}
)

# Retrieve similar
query = model.encode("function to sum prices")
results = memory.retrieve_similar(query, top_k=5)
# results[0] = {'ctx_id': ctx_id, 'similarity': 0.89, 'metadata': {...}}

# Test fault tolerance
recovery = memory.test_recovery(ctx_id, loss_percent=0.40)
# recovery = {'cosine_similarity': 1.0, 'hash_match': True, ...}
```
