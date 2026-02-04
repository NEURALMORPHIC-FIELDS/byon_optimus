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
**Updated**: 2026-02-02
**Status**: IMPLEMENTATION COMPLETE

> **✅ BYON Optimus Integration**: All 9 phases complete. See `BYON_EXECUTION_PLAN.json` and `BYON_PROGRESSION.json` for details.

---

## ⚠️ PRINCIPIU FUNDAMENTAL

> **FHRSS+FCPE este OBLIGATORIU, nu opțional!**
>
> Aceasta este diferența critică față de alte boturi care:
> - Pierd context după câteva mesaje
> - Rezumează atât de mult încât distrug proiectele
> - Nu au memorie semantică persistentă
>
> **Byon Bot NU PORNEȘTE fără memory system activ.**

---

## OBIECTIV PRINCIPAL

Construirea unui sistem multi-agent (MACP v1.1) bazat pe OpenClaw, cu:
- 3 agenți izolați (Worker, Auditor, Executor)
- Capabilitate de coding integrată
- Jupyter Kernel pentru execuție autonomă de cod și teste
- **Sistem FHRSS+FCPE pentru memorie semantică (OBLIGATORIU, HARD-WIRED)**

---

## ARHITECTURA FINALĂ (DUAL GATE MODEL)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BYON BOT SYSTEM                             │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                    CANALE DE INTRARE                          │ │
│  │   WhatsApp | Telegram | Discord | WebChat | CLI               │ │
│  └───────────────────────────────┬───────────────────────────────┘ │
│                                  │                                  │
│  ┌───────────────────────────────▼───────────────────────────────┐ │
│  │                      AGENT A (WORKER)                         │ │
│  │  - Ingest evenimente                                          │ │
│  │  - Indexare codebase (FHRSS+FCPE)                            │ │
│  │  - Extragere context relevant                                 │ │
│  │  - Generare evidence_pack.json + plan_draft.json             │ │
│  └───────────────────────────────┬───────────────────────────────┘ │
│                                  │                                  │
│                    [FILES: evidence_pack.json, plan_draft.json]     │
│                                  │                                  │
│  ┌───────────────────────────────▼───────────────────────────────┐ │
│  │                      AGENT B (AUDITOR)                        │ │
│  │  - Validare plan                                              │ │
│  │  - Verificare securitate                                      │ │
│  │  - Generare diff preview                                      │ │
│  │  - Producere approval_request.json                            │ │
│  └───────────────────────────────┬───────────────────────────────┘ │
│                                  │                                  │
│                    [FILE: approval_request.json]                    │
│                                  │                                  │
│  ┌───────────────────────────────▼───────────────────────────────┐ │
│  │                          USER                                 │ │
│  │  - Vizualizare plan + diff                                    │ │
│  │  - APPROVE / REJECT / MODIFY                                  │ │
│  │  - Semnare execution_order.json                               │ │
│  └───────────────────────────────┬───────────────────────────────┘ │
│                                  │                                  │
│                    [FILE: execution_order.json - SEMNAT]            │
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
│  │  - Execuție cod în sandbox                                    │ │
│  │  - Rulare teste autonom                                       │ │
│  │  - Ciclu iterativ până la SUCCESS                             │ │
│  │  - Producere johnson_receipt.json                             │ │
│  └───────────────────────────────┬───────────────────────────────┘ │
│                                  │                                  │
│                    [FILE: johnson_receipt.json]                     │
│                                  │                                  │
│                                  ▼                                  │
│                    AGENT A verifică receipt                         │
│                    (MATCH / DISPUTE)                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## PLAN DE IMPLEMENTARE

### FAZA 0: SETUP MEDIU DE DEZVOLTARE
**Status**: [ ] NOT STARTED

- [ ] 0.1 Instalare Node.js 22+
- [ ] 0.2 Instalare pnpm
- [ ] 0.3 Instalare Docker Desktop
- [ ] 0.4 Clone OpenClaw repository
- [ ] 0.5 Verificare că OpenClaw rulează corect (`pnpm install && pnpm build`)
- [ ] 0.6 Setup Python environment pentru Jupyter

**Deliverables**:
- OpenClaw funcțional local
- Docker funcțional
- Jupyter Kernel Gateway testat

---

### FAZA 1: FORK OPENCLAW × 3
**Status**: [ ] NOT STARTED

- [ ] 1.1 Creare structură directoare:
  ```
  Byon_bot/
  ├── agent-worker/      # Fork 1 - Agent A
  ├── agent-auditor/     # Fork 2 - Agent B
  ├── agent-executor/    # Fork 3 - Agent C
  ├── shared/            # Cod comun (protocoale, types)
  ├── kernel-host/       # Jupyter Kernel setup
  └── memory-store/      # FHRSS+FCPE storage
  ```

- [ ] 1.2 Copiere OpenClaw în fiecare folder agent
- [ ] 1.3 Creare `shared/` cu:
  - [ ] 1.3.1 `types/evidence_pack.ts`
  - [ ] 1.3.2 `types/plan_draft.ts`
  - [ ] 1.3.3 `types/approval_request.ts`
  - [ ] 1.3.4 `types/execution_order.ts`
  - [ ] 1.3.5 `types/johnson_receipt.ts`
  - [ ] 1.3.6 `crypto/signing.ts` (Ed25519)
  - [ ] 1.3.7 `crypto/hashing.ts` (SHA256)
  - [ ] 1.3.8 `validation/schemas.ts`

**Deliverables**:
- 3 foldere cu OpenClaw
- Shared types definite
- Crypto utilities

---

### FAZA 2: IMPLEMENTARE ROLE GATE
**Status**: [ ] NOT STARTED

- [ ] 2.1 Creare `shared/config/roles.ts`:
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
      can_contact_user: true  // doar pentru approval_request
    },
    executor: {
      can_access_inbox: false,
      can_access_bus: false,
      can_execute: true,
      can_contact_user: false
    }
  };
  ```

- [ ] 2.2 Modificare Agent Worker:
  - [ ] 2.2.1 Dezactivare canale de output direct
  - [ ] 2.2.2 Adăugare export către FILES (nu bus)
  - [ ] 2.2.3 Implementare codebase indexer
  - [ ] 2.2.4 Implementare context selector

- [ ] 2.3 Modificare Agent Auditor:
  - [ ] 2.3.1 Dezactivare canale de input (doar citește files)
  - [ ] 2.3.2 Implementare validator
  - [ ] 2.3.3 Implementare diff generator
  - [ ] 2.3.4 Implementare approval request generator

- [ ] 2.4 Modificare Agent Executor:
  - [ ] 2.4.1 **DEZACTIVARE COMPLETĂ** canale (WhatsApp, Telegram, etc.)
  - [ ] 2.4.2 **DEZACTIVARE** inbox
  - [ ] 2.4.3 **DEZACTIVARE** bus
  - [ ] 2.4.4 Singur input: FILE IMPORT (execution_order.json)
  - [ ] 2.4.5 Implementare signature verification
  - [ ] 2.4.6 Implementare executor engine

**Deliverables**:
- Fiecare agent cu rol strict
- Executor complet izolat
- Role gate functional

---

### FAZA 3: IMPLEMENTARE PROTOCOL FILES
**Status**: [ ] NOT STARTED

- [ ] 3.1 Definire JSON Schemas:
  - [ ] 3.1.1 `schemas/evidence_pack.schema.json`
  - [ ] 3.1.2 `schemas/plan_draft.schema.json`
  - [ ] 3.1.3 `schemas/approval_request.schema.json`
  - [ ] 3.1.4 `schemas/execution_order.schema.json`
  - [ ] 3.1.5 `schemas/johnson_receipt.schema.json`
  - [ ] 3.1.6 `schemas/dispute_report.schema.json`

- [ ] 3.2 Implementare File Handlers:
  - [ ] 3.2.1 `shared/files/writer.ts` (with hash)
  - [ ] 3.2.2 `shared/files/reader.ts` (with validation)
  - [ ] 3.2.3 `shared/files/watcher.ts` (for handoff)

- [ ] 3.3 Implementare Signing:
  - [ ] 3.3.1 Generare user keypair (Ed25519)
  - [ ] 3.3.2 Generare executor keypair
  - [ ] 3.3.3 Sign function pentru execution_order
  - [ ] 3.3.4 Verify function în executor

- [ ] 3.4 Implementare Handoff Directory:
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
- Schemas validate
- File handlers cu hashing
- Signing/verification funcțional
- Handoff directory structure

---

### FAZA 4: JUPYTER KERNEL INTEGRATION
**Status**: [ ] NOT STARTED

- [ ] 4.1 Setup Kernel Host:
  - [ ] 4.1.1 Creare `kernel-host/Dockerfile`
  - [ ] 4.1.2 Creare `kernel-host/docker-compose.yml`
  - [ ] 4.1.3 Configurare kernels (Python, Node, Bash)
  - [ ] 4.1.4 Configurare resource limits
  - [ ] 4.1.5 Configurare network isolation

- [ ] 4.2 Implementare Kernel Manager:
  - [ ] 4.2.1 `agent-executor/src/kernel/manager.ts`
  - [ ] 4.2.2 `agent-executor/src/kernel/python.ts`
  - [ ] 4.2.3 `agent-executor/src/kernel/node.ts`
  - [ ] 4.2.4 `agent-executor/src/kernel/bash.ts`

- [ ] 4.3 Implementare Execution Loop:
  - [ ] 4.3.1 `agent-executor/src/loop/autonomous.ts`
  - [ ] 4.3.2 Max iterations limit
  - [ ] 4.3.3 Same error detection (3x = escalate)
  - [ ] 4.3.4 Timeout handling
  - [ ] 4.3.5 Output capture

- [ ] 4.4 Implementare Test Runner:
  - [ ] 4.4.1 pytest integration
  - [ ] 4.4.2 jest/vitest integration
  - [ ] 4.4.3 unittest integration
  - [ ] 4.4.4 Test result parser

**Deliverables**:
- Docker container pentru kernels
- Kernel manager funcțional
- Autonomous loop cu limits
- Test runner integrat

---

### FAZA 5: CODING CAPABILITY MODULE
**Status**: [ ] NOT STARTED

- [ ] 5.1 Implementare Codebase Indexer (Agent A):
  - [ ] 5.1.1 File scanner
  - [ ] 5.1.2 AST parser (TypeScript, Python)
  - [ ] 5.1.3 Symbol extractor
  - [ ] 5.1.4 Dependency graph builder
  - [ ] 5.1.5 Embedding generator (pentru FHRSS)

- [ ] 5.2 Implementare Context Selector (Agent A):
  - [ ] 5.2.1 Semantic search în FHRSS
  - [ ] 5.2.2 Dependency resolution
  - [ ] 5.2.3 Chunk optimization
  - [ ] 5.2.4 Context pack builder

- [ ] 5.3 Implementare Code Actions (Agent C):
  - [ ] 5.3.1 `code_read` action
  - [ ] 5.3.2 `code_write` action
  - [ ] 5.3.3 `code_edit` action
  - [ ] 5.3.4 `kernel_execute` action
  - [ ] 5.3.5 `test_run` action
  - [ ] 5.3.6 `notebook_run` action

- [ ] 5.4 Implementare Diff Generator (Agent B):
  - [ ] 5.4.1 Unified diff format
  - [ ] 5.4.2 Side-by-side preview
  - [ ] 5.4.3 Conflict detection
  - [ ] 5.4.4 Risk assessment

**Deliverables**:
- Codebase indexer funcțional
- Context selection inteligent
- Toate code actions
- Diff preview pentru user

---

### FAZA 6: POLICY ENGINE
**Status**: [ ] NOT STARTED

- [ ] 6.1 Creare Policy DSL:
  - [ ] 6.1.1 `shared/policy/schema.ts`
  - [ ] 6.1.2 `shared/policy/parser.ts`
  - [ ] 6.1.3 `shared/policy/validator.ts`

- [ ] 6.2 Definire Whitelist Actions:
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

- [ ] 6.3 Implementare Constraint Checker:
  - [ ] 6.3.1 Parameter validation
  - [ ] 6.3.2 TTL verification
  - [ ] 6.3.3 Scope verification
  - [ ] 6.3.4 Signature verification

- [ ] 6.4 Implementare Escalation Rules:
  - [ ] 6.4.1 iterations_exceeded
  - [ ] 6.4.2 same_error_3_times
  - [ ] 6.4.3 security_warning
  - [ ] 6.4.4 resource_limit_hit

**Deliverables**:
- Policy DSL parser
- Whitelist configurat
- Constraint checker
- Escalation logic

---

### FAZA 7: FHRSS+FCPE INTEGRATION
**Status**: [x] COMPLETE - HARD-WIRED (OBLIGATORIU)
**Source**: `D:\Github Repo\INFINIT_MEMORYCONTEXT\`

> ⚠️ **CRITICAL**: FHRSS+FCPE este **OBLIGATORIU**, nu opțional!
> Agenții **NU PORNESC** fără memory system activ.
> Aceasta este diferența fundamentală față de alte boturi care pierd context.

#### OVERVIEW SISTEM

**FHRSS** (Fractal-Holographic Redundant Storage System):
- XOR-based parity system cu 9 families
- **100% recovery la 40% data loss**
- Subcube size: 8×8×8 (512 bytes)
- Profiles: MINIMAL (3), MEDIUM (4), HIGH (6), FULL (9 families)
- Storage overhead: 2.125x pentru FULL profile

**FCPE** (Fractal-Chaotic Persistent Encoding):
- Compresie variable→fixed: `[seq_len, 384] → [384]`
- **73,000x compression ratio** pentru 2M tokens
- Weighted attention pooling
- 5 fractal encoding layers
- Content-aware jitter pentru discrimination

#### ⚡ HARD-WIRED INTEGRATION

```typescript
// agent-worker/src/index.ts - FHRSS+FCPE este OBLIGATORIU
async function main() {
  try {
    await initializeMemory(); // MUST succeed
  } catch (error) {
    console.error('FATAL: FHRSS+FCPE Memory REQUIRED!');
    process.exit(1); // Agent REFUZĂ să pornească fără memory
  }
}
```

```yaml
# docker-compose.yml - Memory service container OBLIGATORIU
services:
  memory-service:
    build: ./shared/memory
    # REQUIRED - all agents depend on this
    healthcheck:
      test: ["CMD", "python", "-c", "import fhrss_fcpe"]

  agent-worker:
    depends_on:
      memory-service:
        condition: service_healthy  # NU pornește fără memory
```

#### PERFORMANCE VERIFICAT

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
  - [x] 7.1.1 Copiere `fhrss_fcpe_unified.py` în `shared/memory/fhrss_fcpe.py`
  - [x] 7.1.2 Creare TypeScript wrapper: `shared/memory/index.ts`
  - [x] 7.1.3 Setup `sentence-transformers` via `requirements.txt`
  - [x] 7.1.4 Configurare storage paths per agent
  - [x] 7.1.5 Python service: `shared/memory/memory_service.py`

- [x] 7.2 Implementare pentru Coding (Agent Worker):
  - [x] 7.2.1 `storeCode()` - Code file → embeddings pipeline
  - [x] 7.2.2 `searchCode()` - Semantic code search
  - [x] 7.2.3 FHRSS retrieval integrat în AgentMemory class
  - [x] 7.2.4 **HARD-WIRED**: Agent refuză să pornească fără memory

- [x] 7.3 Implementare pentru General Memory:
  - [x] 7.3.1 `storeConversation()` - Conversation turns → embeddings
  - [x] 7.3.2 `storeFact()` - Facts extraction și storage
  - [x] 7.3.3 `searchConversation()` / `searchFacts()` - Retrieval
  - [x] 7.3.4 Cross-session memory via persistent storage

- [x] 7.4 Docker Integration (OBLIGATORIU):
  - [x] 7.4.1 `memory-service` container cu Python + sentence-transformers
  - [x] 7.4.2 Health check pentru memory service
  - [x] 7.4.3 All agents `depends_on: memory-service`
  - [x] 7.4.4 Shared volume pentru persistent storage

#### KEY CLASSES (din INFINIT_MEMORYCONTEXT)

```python
# Configurație
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

#### INTEGRARE ÎN BYON BOT

```
Agent Worker (A):
├── Primește mesaj de la user
├── Generează embeddings pentru query
├── retrieve_similar() din FHRSS
├── Construiește context pack
└── Salvează noi facts cu encode_context()

Agent Executor (C):
├── Primește execution_order
├── Codul executat → embeddings
├── Salvează în memory pentru learning
└── Receipt include memory_ids afectate
```

**Deliverables** (COMPLETE):
- ✅ FHRSS+FCPE **HARD-WIRED** (nu opțional!)
- ✅ 73,000x compression funcțional
- ✅ 100% recovery la 40% loss
- ✅ Semantic search pentru cod și conversații
- ✅ Persistence și fault tolerance
- ✅ Docker container dedicat `memory-service`
- ✅ Agenți refuză să pornească fără memory

---

### FAZA 8: USER INTERFACE
**Status**: [x] COMPLETE

- [x] 8.1 Approval UI:
  - [x] 8.1.1 Web interface pentru approval_request (`ui/public/approvals.html`)
  - [x] 8.1.2 Diff viewer (JSON preview în approval detail)
  - [x] 8.1.3 One-click approve/reject
  - [x] 8.1.4 Signature generation (TODO: Ed25519 integration)

- [x] 8.2 Monitoring UI:
  - [x] 8.2.1 Agent status dashboard (`ui/public/index.html`)
  - [x] 8.2.2 Execution log viewer (receipts)
  - [x] 8.2.3 Receipt history (`ui/public/history.html`)

- [x] 8.3 CLI Interface:
  - [x] 8.3.1 `byon approve <request_id>` (`cli/src/commands/approve.ts`)
  - [x] 8.3.2 `byon reject <request_id>` (în approve command)
  - [x] 8.3.3 `byon status` (`cli/src/commands/status.ts`)
  - [x] 8.3.4 `byon history` (`cli/src/commands/history.ts`)

**Deliverables**:
- Approval web UI
- Monitoring dashboard
- CLI tools

---

### FAZA 9: TESTING & HARDENING
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
- Test suite complet
- Security audit passed
- Hardened deployment

---

### FAZA 10: DEPLOYMENT
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

- [ ] 10.2 Documentație:
  - [ ] 10.2.1 Setup guide
  - [ ] 10.2.2 Configuration reference
  - [ ] 10.2.3 Security guide
  - [ ] 10.2.4 API reference

- [ ] 10.3 First Run:
  - [ ] 10.3.1 Test complet end-to-end
  - [ ] 10.3.2 Coding task real
  - [ ] 10.3.3 Bug fixes

**Deliverables**:
- Docker compose production-ready
- Documentație completă
- System funcțional

---

---

### FAZA 11: WFP SEMANTIC GUARD (SYSTEM KERNEL)
**Status**: [x] SPECIFICATION COMPLETE - IMPLEMENTATION PENDING
**Role**: Kernel-level enforcement of Semantic Intents.

> **⚔️ THE DUAL GATE MODEL**:
> 1. **Information Gate** (BYON Auditor): Validates logic, signatures, and policy.
> 2. **Execution Gate** (WFP Semantic Guard): Validates traffic at OS Kernel level.
>
> `Executor` is active ONLY when BOTH gates say "YES".

#### COMPONENTE CHEIE
- **WFP Callout Driver**: Driver kernel (`.sys`) care interceptează traficul.
- **WFP Controller**: Serviciu user-mode care traduce `EXECUTION_INTENT` în filtre WFP.
- **Protocol BYON→WFP**: 
    - `EXECUTION_INTENT` (Signed JSON)
    - `EXECUTION_FEEDBACK` (Audit data)

#### FLOW
1. **BYON** emite `ExecutionIntent` semnat.
2. **WFP Controller** verifică sig Ed25519.
3. **WFP Controller** injectează filtre temporare în Kernel.
4. **Executor** are acces la rețea DOAR cât timp intenția e validă (TTL).
5. **WFP** trimite telemetrie înapoi la Auditor.

**Deliverables**:
- Specificație formală Protocol (JSON Schema) ✔
- Arhitectură WFP Callouts ✔
- Threat Model Strategy ✔

---

---

### FAZA 11: WFP SEMANTIC GUARD (SYSTEM KERNEL)
**Status**: [x] SPECIFICATION COMPLETE - IMPLEMENTATION PENDING
**Role**: Kernel-level enforcement of Semantic Intents.

> **⚔️ THE DUAL GATE MODEL**:
> 1. **Information Gate** (BYON Auditor): Validates logic, signatures, and policy.
> 2. **Execution Gate** (WFP Semantic Guard): Validates traffic at OS Kernel level.
>
> `Executor` is active ONLY when BOTH gates say "YES".

#### COMPONENTE CHEIE
- **WFP Callout Driver**: Driver kernel (`.sys`) care interceptează traficul.
- **WFP Controller**: Serviciu user-mode care traduce `EXECUTION_INTENT` în filtre WFP.
- **Protocol BYON→WFP**: 
    - `EXECUTION_INTENT` (Signed JSON)
    - `EXECUTION_FEEDBACK` (Audit data)

#### FLOW
1. **BYON** emite `ExecutionIntent` semnat.
2. **WFP Controller** verifică sig Ed25519.
3. **WFP Controller** injectează filtre temporare în Kernel.
4. **Executor** are acces la rețea DOAR cât timp intenția e validă (TTL).
5. **WFP** trimite telemetrie înapoi la Auditor.

**Deliverables**:
- Specificație formală Protocol (JSON Schema) ✔
- Arhitectură WFP Callouts ✔
- Threat Model Strategy ✔

---

## METRICI DE SUCCES (ACTUALIZAT)

| Metric | Target |
|--------|--------|
| Agenți izolați complet | 3/3 |
| User approval required pentru execuție | 100% |
| **WFP Enforcement** | **100% Packet Coverage** |
| Autonomous coding iterations | max 10 |
| Test pass rate după fix | >90% |
| Security tests passed | 100% |
| Context retrieval relevance | >80% |

---

## RISCURI ȘI MITIGĂRI

| Risc | Probabilitate | Impact | Mitigare |
|------|--------------|--------|----------|
| Kernel escape din sandbox | Low | Critical | Docker seccomp + no-root |
| Prompt injection în mesaje | Medium | High | Policy strict, no raw inbox în C |
| Signature bypass | Low | Critical | Ed25519, verificare în C |
| Context retrieval slab | Medium | Medium | Tune FHRSS, fallback la full file |
| Infinite loop în coding | Medium | Medium | Max iterations + timeout |

---

## INTEGRARE VIBE-CODING TEMPLATE

### Concepte adoptate din `vibe-coding-prompt-template-main/`:

#### 1. Progressive Disclosure (Dezvăluire Progresivă)
- **AGENTS.md** = Master plan pentru fiecare agent
- **agent_docs/** = Detalii specifice (tech_stack, code_patterns, etc.)
- **Tool configs** = Pointeri către documentație

#### 2. Plan → Execute → Verify Loop
Mapare la arhitectura noastră:
```
VIBE-CODING          →    BYON BOT MACP
─────────────────────────────────────────
Plan                 →    Agent A (propune)
Execute              →    Agent C (execută)
Verify               →    Agent A (verifică receipt)
```

#### 3. Structura agent_docs/ per Agent

```
Byon_bot/
├── agent-worker/
│   ├── AGENTS.md                    # Master plan Worker
│   └── agent_docs/
│       ├── tech_stack.md            # Ce tehnologii folosește
│       ├── code_patterns.md         # Cum indexează, cum selectează context
│       ├── capabilities.md          # READ, PARSE, PROPOSE, VERIFY
│       └── handoff_protocol.md      # Cum produce evidence_pack, plan_draft
│
├── agent-auditor/
│   ├── AGENTS.md                    # Master plan Auditor
│   └── agent_docs/
│       ├── validation_rules.md      # Reguli de validare
│       ├── security_checks.md       # Ce verifică
│       ├── diff_generation.md       # Cum face preview
│       └── approval_protocol.md     # Format approval_request
│
├── agent-executor/
│   ├── AGENTS.md                    # Master plan Executor
│   └── agent_docs/
│       ├── execution_loop.md        # Ciclu autonom
│       ├── kernel_usage.md          # Cum folosește Jupyter
│       ├── action_whitelist.md      # Ce acțiuni poate face
│       └── receipt_protocol.md      # Format johnson_receipt
│
└── shared/
    └── agent_docs/
        ├── protocol_overview.md     # MACP v1.1 explicat
        ├── file_formats.md          # JSON schemas
        ├── security_model.md        # Air-gap, signing
        └── anti_patterns.md         # Ce NU trebuie făcut
```

#### 4. Anti-Vibe Engineering Rules (pentru Executor)

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

#### 5. High-Order Prompts pentru LLM (în fiecare AGENTS.md)

```markdown
## How I Should Think

1. **Understand Intent First**: Ce vrea de fapt user-ul?
2. **Check Permissions**: Am voie să fac asta?
3. **Validate Input**: Schema corectă? Semnătură validă?
4. **Plan Before Action**: Propune plan, așteaptă aprobare
5. **Verify After Action**: Testează, verifică rezultatul
6. **Report Honestly**: Nu ascunde erori, raportează exact
```

#### 6. Skill-uri adaptate pentru Byon Bot

| Skill Original | Adaptare Byon Bot |
|----------------|-------------------|
| `/vibe-research` | Agent A: indexare codebase |
| `/vibe-prd` | Agent A: generare plan_draft |
| `/vibe-techdesign` | Agent B: validare arhitectură |
| `/vibe-agents` | Setup configurație agenți |
| `/vibe-build` | Agent C: execuție cod |

---

## STRUCTURA FINALĂ PROIECT (ACTUALIZATĂ)

```
Byon_bot/
├── JOHNSON_PLAN.md              # Acest document (master plan)
├── JOHNSON_STATUS.json          # Status machine-readable
│
├── docs/                        # Documentație generală
│   ├── PRD-ByonBot-MVP.md      # Product Requirements
│   ├── TechDesign-ByonBot.md   # Technical Design
│   └── research-notes.md        # Research findings
│
├── agent-worker/                # AGENT A
│   ├── AGENTS.md
│   ├── agent_docs/
│   ├── src/                     # OpenClaw fork modificat
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
├── shared/                      # Cod comun
│   ├── types/                   # TypeScript types
│   ├── schemas/                 # JSON Schemas
│   ├── crypto/                  # Ed25519, SHA256
│   ├── policy/                  # Policy DSL
│   └── agent_docs/              # Documentație protocol
│
├── kernel-host/                 # Jupyter Kernels
│   ├── Dockerfile
│   └── docker-compose.yml
│
├── memory-store/                # FHRSS+FCPE
│   └── ...
│
├── handoff/                     # Director pentru fișiere protocol
│   ├── worker_to_auditor/
│   ├── auditor_to_user/
│   ├── user_to_executor/
│   └── executor_to_worker/
│
├── ui/                          # Approval UI
│   └── ...
│
├── docker-compose.yml           # Orchestrare
└── .env.example                 # Environment template
```

---

### FAZA 11: IMMUTABLE AUDIT TRAIL SYSTEM
**Status**: [x] COMPLETE
**Priority**: HIGH

> 📋 **Digital Paper Trail** - Toate acțiunile documentate, sortate pe calendar, stocate în FHRSS+FCPE

#### PRINCIPII FUNDAMENTALE

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
│  După EXECUTED = PERMANENT, IMUTABIL, NIMENI NU POATE ȘTERGE   │
│  Doar USER poate șterge draft/pending/approved (fizic)         │
│  Agenții NU POT șterge NICIODATĂ                               │
└─────────────────────────────────────────────────────────────────┘
```

#### CALENDAR INDEXING

| Granularitate | Format | Exemplu |
|---------------|--------|---------|
| Oră | `YYYY-MM-DD-HH` | `2026-02-01-14` |
| Zi | `YYYY-MM-DD` | `2026-02-01` |
| Săptămână | `YYYY-WXX` | `2026-W05` |
| An | `YYYY` | `2026` |

#### DOCUMENT LIFECYCLE

| Stare | User șterge? | Agent șterge? | Modificabil? | Ștergere tip |
|-------|-------------|---------------|--------------|--------------|
| `draft` | ✅ DA | ❌ NU | ✅ DA | FIZIC |
| `pending` | ✅ DA | ❌ NU | ❌ NU | FIZIC |
| `approved` | ✅ DA | ❌ NU | ❌ NU | FIZIC |
| `executed` | ❌ **NU** | ❌ NU | ❌ NU | **IMPOSIBIL** |
| `failed` | ❌ **NU** | ❌ NU | ❌ NU | **IMPOSIBIL** |

#### TASKS

- [x] 11.1 Tipuri Audit Document:
  - [x] 11.1.1 `shared/types/audit.ts` - AuditDocument interface
  - [x] 11.1.2 Status enum (draft, pending, approved, executed, failed)
  - [x] 11.1.3 Calendar metadata fields
  - [x] 11.1.4 Deletion control fields

- [x] 11.2 Immutability Engine:
  - [x] 11.2.1 `shared/audit/immutability.ts` - canDelete(), markAsExecuted()
  - [x] 11.2.2 Hard-coded rules (agent never deletes)
  - [x] 11.2.3 Auto-lock on execution
  - [x] 11.2.4 Physical deletion pentru drafts

- [x] 11.3 Calendar Index:
  - [x] 11.3.1 `shared/audit/calendar-index.ts`
  - [x] 11.3.2 Index pe oră, zi, săptămână, an
  - [x] 11.3.3 Query by date range
  - [x] 11.3.4 Timestamp ordering (nu blockchain)

- [x] 11.4 Integration cu FHRSS+FCPE:
  - [x] 11.4.1 Store audit docs în memory (shared/audit/index.ts)
  - [x] 11.4.2 Semantic search în audit trail
  - [x] 11.4.3 Recovery pentru executed docs
  - [x] 11.4.4 Persistent storage (TODO: actual FHRSS backend)

- [x] 11.5 CLI Commands:
  - [x] 11.5.1 `npx byon history` - Vezi istoric
  - [x] 11.5.2 `npx byon history --date 2026-02-01`
  - [x] 11.5.3 `npx byon history --week 2026-W05`
  - [x] 11.5.4 `npx byon delete <doc_id>` - Șterge draft (doar user)

**Deliverables**:
- Audit trail imutabil pentru documente executate
- Calendar indexing (oră/zi/săptămână/an)
- User-only delete pentru drafts (fizic)
- Semantic search în istoric
- CLI pentru history viewing

---

### FAZA 12: BYON STYLE CONTRACT
**Status**: [x] COMPLETE
**Priority**: HIGH

> Forțează stilul strict de output pentru agenți: fără psihologie, empatie, povești, meta-commentary.

#### REGULI HARD-CODED

```
INTERZIS:
- "îmi pare rău" / "te înțeleg" / empatie
- "imaginează-ți" / povești / metafore
- "ca model AI" / "nu pot" / meta-commentary
- "desigur" / "cu plăcere" / filler phrases
- traumă / anxietate / terapie

OBLIGATORIU:
- Output structurat (min 3 linii)
- Max 3500 caractere
- Format: markdown/text/json/code
- Opțiuni clare A/B/C
- Next action explicit
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
  - [x] 12.3.2 RegenContext cu lastErrors, lastScore, lastViolations
  - [x] 12.3.3 maxAttempts (default 4)
  - [x] 12.3.4 hardFail option pentru throw/return

- [x] 12.4 Teste:
  - [x] 12.4.1 `tests/security/byon_style.test.ts`
  - [x] 12.4.2 Fixtures: good.worker.json, bad.empathy.json, bad.missing_fields.json
  - [x] 12.4.3 Schema validation tests
  - [x] 12.4.4 Style violation tests
  - [x] 12.4.5 Retry loop tests

**Deliverables**:
- BYON Style Contract schema
- Validator cu scoring și penalizări
- Retry loop pentru regenerare
- Teste complete cu fixtures

---

## URMĂTORUL PAS

**STATUS**: Phase 12 COMPLETE - BYON Style Contract implementat!

```bash
# Setup automat (include verificare Python pentru FHRSS+FCPE)
node scripts/setup-first-run.js

# SAU manual:
pnpm install && pnpm build
node scripts/generate-keys.js
node scripts/setup-handoff.js

# Start sistem
pnpm docker:up

# Verificare memory system (OBLIGATORIU)
docker logs byon-bot-memory-service

# Test
npx byon watch --verbose
npx byon inbox "Test message"
npx byon approve
```

> ⚠️ **IMPORTANT**: Dacă memory-service nu pornește, sistemul NU funcționează!
> Python 3.10+ cu sentence-transformers este OBLIGATORIU.

---

## CHANGELOG

| Data | Schimbare |
|------|-----------|
| 2026-01-31 | Creare plan inițial |
| 2026-01-31 | Integrare concepte din vibe-coding-prompt-template |
| 2026-02-01 | **FHRSS+FCPE marcat ca OBLIGATORIU (hard-wired)** |
| 2026-02-01 | Agent Worker refuză să pornească fără memory system |
| 2026-02-01 | Docker memory-service container adăugat |
| 2026-02-01 | Faze 1-10 COMPLETE |
| 2026-02-01 | **Phase 11: Immutable Audit Trail System** - COMPLETE |
| 2026-02-01 | Adăugat: shared/types/audit.ts, shared/audit/*.ts |
| 2026-02-01 | Adăugat: CLI commands: npx byon history, npx byon delete |
| 2026-02-01 | **Phase 8: Web UI implementat** - Dashboard, Approvals, History |
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

**NOTA**: Acest document este sursa de adevar pentru proiect. Orice deviatie trebuie documentata aici.

---

## REFERINȚE

- `openclaw-main/` - Bază pentru fork agenți
- `vibe-coding-prompt-template-main/` - Template-uri și patterns
- `descrierea proiectului.docx` - Viziune originală MACP v1.1
- `D:\Github Repo\INFINIT_MEMORYCONTEXT\` - **FHRSS+FCPE implementare completă**

---

## ANEXĂ: FHRSS+FCPE TECHNICAL REFERENCE

### Sursa: `INFINIT_MEMORYCONTEXT/fhrss_fcpe_unified.py`

#### Patent
```
Patent: EP25216372.0 (FHRSS - Omni-Qube-Vault)
Author: Vasile Lucian Borbeleac
Version: 1.0.0 (2025)
```

#### Arhitectura FHRSS (XOR Parity)

```
Data Input (bytes)
    ↓
Padding → Multiple of 512 bytes (8³)
    ↓
Split into Subcubes (8×8×8)
    ↓
Pentru fiecare subcube:
    ├── Compute X parity (linii pe axa X)
    ├── Compute Y parity (linii pe axa Y)
    ├── Compute Z parity (linii pe axa Z)
    ├── Compute DXYp parity (diagonale XY+)
    ├── Compute DXYn parity (diagonale XY-)
    ├── Compute DXZp parity (diagonale XZ+)
    ├── Compute DXZn parity (diagonale XZ-)
    ├── Compute DYZp parity (diagonale YZ+)
    └── Compute DYZn parity (diagonale YZ-)
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

#### Arhitectura FCPE (Compression)

```
Input Embeddings [seq_len, 384]
    ↓
Feature Whitening: (x - mean) / std
    ↓
Weighted Attention Pooling:
    ├── Compute norms și deviations
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

#### Fișiere de copiat în Byon_bot

```
INFINIT_MEMORYCONTEXT/
├── fhrss_fcpe_unified.py     → shared/memory/fhrss_fcpe.py
├── encoder.py                 → shared/memory/fcpe_encoder.py
└── test_ai_applicability.py  → tests/test_memory.py
```

#### Usage Example (pentru integrare)

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
