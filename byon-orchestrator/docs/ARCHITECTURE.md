# BYON Optimus Architecture

**Multi-Agent Orchestration System with Air-Gapped Execution**

## System Overview

BYON Optimus is a secure multi-agent AI orchestration system designed for autonomous task execution with human oversight. The system implements a separation-of-duties model where different agents handle planning, auditing, and execution.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BYON OPTIMUS                                    │
│                     Multi-Agent Orchestration System                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        INPUT LAYER                                   │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │   │
│  │  │ Telegram │ │  Email   │ │ WhatsApp │ │  Signal  │ │  Discord │  │   │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘  │   │
│  │       └────────────┴────────────┴────────────┴────────────┘        │   │
│  │                              │                                      │   │
│  │                              ▼                                      │   │
│  │                    ┌───────────────┐                                │   │
│  │                    │    Inbox      │                                │   │
│  │                    │   Messages    │                                │   │
│  │                    └───────────────┘                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                │                                            │
│  ┌─────────────────────────────┼─────────────────────────────────────────┐ │
│  │                    ORCHESTRATION LAYER                                 │ │
│  │                             │                                          │ │
│  │            ┌────────────────┴────────────────┐                        │ │
│  │            │         Worker Agent (A)         │                        │ │
│  │            │  ┌─────────────────────────────┐ │                        │ │
│  │            │  │ • Message Processing        │ │                        │ │
│  │            │  │ • Evidence Building         │ │                        │ │
│  │            │  │ • Plan Generation           │ │                        │ │
│  │            │  │ • Memory Integration        │ │                        │ │
│  │            │  └─────────────────────────────┘ │                        │ │
│  │            └────────────────┬────────────────┘                        │ │
│  │                             │ EvidencePack + PlanDraft                │ │
│  │                             ▼                                          │ │
│  │            ┌────────────────────────────────┐                         │ │
│  │            │        Auditor Agent (B)        │                         │ │
│  │            │  ┌─────────────────────────────┐│                         │ │
│  │            │  │ • Plan Validation           ││                         │ │
│  │            │  │ • Risk Assessment           ││                         │ │
│  │            │  │ • Ed25519 Signing           ││                         │ │
│  │            │  │ • Approval Management       ││                         │ │
│  │            │  └─────────────────────────────┘│                         │ │
│  │            └────────────────┬────────────────┘                         │ │
│  │                             │                                          │ │
│  │              ┌──────────────┴──────────────┐                          │ │
│  │              │     ApprovalRequest         │                          │ │
│  │              └──────────────┬──────────────┘                          │ │
│  │                             │                                          │ │
│  │              ┌──────────────▼──────────────┐                          │ │
│  │              │      User Approval          │                          │ │
│  │              │    (UI / API / CLI)         │                          │ │
│  │              └──────────────┬──────────────┘                          │ │
│  │                             │                                          │ │
│  │              ┌──────────────▼──────────────┐                          │ │
│  │              │     ExecutionOrder          │                          │ │
│  │              │  (Ed25519 Signed)           │                          │ │
│  │              └──────────────┬──────────────┘                          │ │
│  └─────────────────────────────┼─────────────────────────────────────────┘ │
│                                │                                            │
│  ┌─────────────────────────────┼─────────────────────────────────────────┐ │
│  │                    EXECUTION LAYER (AIR-GAPPED)                        │ │
│  │                             │                                          │ │
│  │  ┌──────────────────────────▼──────────────────────────────────────┐  │ │
│  │  │                    Executor Agent (C)                            │  │ │
│  │  │  ╔═══════════════════════════════════════════════════════════╗  │  │ │
│  │  │  ║                  network_mode: none                        ║  │  │ │
│  │  │  ╚═══════════════════════════════════════════════════════════╝  │  │ │
│  │  │  ┌────────────────────────────────────────────────────────────┐ │  │ │
│  │  │  │ • Signature Verification                                   │ │  │ │
│  │  │  │ • Action Execution (sandboxed)                             │ │  │ │
│  │  │  │ • Receipt Generation                                       │ │  │ │
│  │  │  │ • Audit Logging                                            │ │  │ │
│  │  │  └────────────────────────────────────────────────────────────┘ │  │ │
│  │  └──────────────────────────┬──────────────────────────────────────┘  │ │
│  │                             │ JohnsonReceipt                          │ │
│  │                             ▼                                          │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                         SUPPORT SERVICES                                 ││
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐               ││
│  │  │    Memory     │  │    Redis      │  │   Prometheus  │               ││
│  │  │ FHRSS+FCPE    │  │    Cache      │  │  + Grafana    │               ││
│  │  └───────────────┘  └───────────────┘  └───────────────┘               ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

## Agent Responsibilities

### Worker Agent (A)

**Purpose:** Convert incoming messages into actionable plans.

| Responsibility | Description |
|----------------|-------------|
| Message Processing | Parse and classify incoming tasks |
| Evidence Building | Analyze codebase, extract facts |
| Plan Generation | Create action sequences |
| Memory Integration | Query FHRSS+FCPE for context |

**Technology:**
- TypeScript/Node.js
- FHRSS+FCPE memory client
- File-based inbox watcher

### Auditor Agent (B)

**Purpose:** Validate plans and manage approval workflow.

| Responsibility | Description |
|----------------|-------------|
| Plan Validation | Security and policy checks |
| Risk Assessment | Evaluate action risk levels |
| Approval Management | Handle user approval flow |
| Order Signing | Ed25519 cryptographic signing |

**Technology:**
- TypeScript/Node.js
- Ed25519 key management
- HTTP API for approvals

### Executor Agent (C)

**Purpose:** Execute approved actions in isolation.

| Responsibility | Description |
|----------------|-------------|
| Signature Verification | Verify Ed25519 signatures |
| Action Execution | Run whitelisted actions |
| Change Tracking | Record all modifications |
| Receipt Generation | Produce JohnsonReceipts |

**Technology:**
- TypeScript/Node.js
- Air-gapped (no network)
- Sandboxed file operations

## Data Flow

```
1. Message Arrival
   ┌───────────┐
   │  Channel  │ ──▶ inbox/{message_id}.json
   └───────────┘

2. Worker Processing
   inbox/ ──▶ Worker ──▶ worker_to_auditor/
                         ├── evidence_{ts}.json
                         └── plan_{ts}.json

3. Auditor Review
   worker_to_auditor/ ──▶ Auditor ──▶ auditor_to_user/
                                      └── approval_{ts}.json

4. User Approval
   auditor_to_user/ ──▶ User ──▶ POST /approve

5. Order Signing
   User Approval ──▶ Auditor ──▶ auditor_to_executor/
                                  └── order_{ts}.json (signed)

6. Execution
   auditor_to_executor/ ──▶ Executor ──▶ executor_to_worker/
                                          └── receipt_{id}.json
```

## Memory System (FHRSS+FCPE)

The memory service provides infinite context storage with fault tolerance:

```
┌─────────────────────────────────────────────────────────────┐
│                    FHRSS+FCPE Memory System                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    Encoding Layer                       │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │ │
│  │  │   FCPE       │  │   Semantic   │  │   Metadata   │  │ │
│  │  │  Encoder     │  │  Embeddings  │  │   Indexing   │  │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                             │                                │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    Storage Layer                        │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │ │
│  │  │   FHRSS      │  │    Parity    │  │    Index     │  │ │
│  │  │   Shards     │  │   Shards     │  │    Files     │  │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                             │                                │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    Recovery Layer                       │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │ │
│  │  │   XOR        │  │   Reed-      │  │   Checksum   │  │ │
│  │  │  Recovery    │  │  Solomon     │  │  Validation  │  │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Performance:                                                │
│  • Max Context: 2,000,000+ tokens                           │
│  • Recovery: 100% at 40% data loss                          │
│  • Compression: 73,000x                                     │
│  • Speed: 350+ embeddings/sec                               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Docker Deployment

```yaml
services:
  # Agent Services
  byon-worker:
    image: byon-orchestrator:worker
    depends_on: [byon-memory, byon-redis]
    volumes:
      - ./handoff:/handoff
    healthcheck: ...

  byon-auditor:
    image: byon-orchestrator:auditor
    depends_on: [byon-worker]
    volumes:
      - ./handoff:/handoff
      - ./keys:/keys
    healthcheck: ...

  byon-executor:
    image: byon-orchestrator:executor
    network_mode: none        # AIR-GAPPED
    depends_on: [byon-auditor]
    volumes:
      - ./handoff:/handoff
      - ./keys:/keys:ro
      - ./project:/project
    healthcheck: ...

  # Support Services
  byon-memory:
    image: byon-memory:latest
    ports: ["8000:8000"]

  byon-redis:
    image: redis:alpine
```

## Security Layers

```
┌─────────────────────────────────────────────────────────────┐
│                      SECURITY LAYERS                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Layer 1: Cryptographic                                      │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ • Ed25519 signatures on ExecutionOrders                 │ │
│  │ • SHA256 hashes on all documents                        │ │
│  │ • Tamper-evident audit chain                            │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Layer 2: Network Isolation                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ • Executor: network_mode: none                          │ │
│  │ • File-based handoff only                               │ │
│  │ • No direct agent communication                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Layer 3: Action Control                                     │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ • Whitelisted action types only                         │ │
│  │ • Forbidden path patterns                               │ │
│  │ • Iteration and timeout limits                          │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Layer 4: Human Oversight                                    │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ • Approval required for medium/high risk                │ │
│  │ • Expiring approval requests                            │ │
│  │ • Full audit trail                                      │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Optional: WFP Semantic Guard Integration

For kernel-level network protection on Windows:

```
┌─────────────────────────────────────────────────────────────┐
│                WFP SEMANTIC GUARD INTEGRATION                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                User Mode                                │ │
│  │  ┌────────────┐    ┌────────────┐    ┌──────────────┐  │ │
│  │  │  Auditor   │───▶│  BYON-WFP  │───▶│ EXECUTION_   │  │ │
│  │  │  Agent     │    │   Bridge   │    │   INTENT     │  │ │
│  │  └────────────┘    └────────────┘    └──────┬───────┘  │ │
│  └────────────────────────────────────────────│───────────┘ │
│                                               │ IOCTL       │
│  ┌────────────────────────────────────────────▼───────────┐ │
│  │                Kernel Mode                              │ │
│  │  ┌────────────────────────────────────────────────────┐│ │
│  │  │              WFP Semantic Guard Driver              ││ │
│  │  │  • Behavioral Detection                            ││ │
│  │  │  • Fragmergent Brain (anomaly)                     ││ │
│  │  │  • BYON Intent Rules                               ││ │
│  │  └────────────────────────────────────────────────────┘│ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Monitoring

```
┌─────────────────────────────────────────────────────────────┐
│                     MONITORING STACK                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐   │
│  │  Prometheus   │  │    Grafana    │  │   Alerting    │   │
│  │   Metrics     │  │  Dashboards   │  │   (optional)  │   │
│  └───────┬───────┘  └───────┬───────┘  └───────────────┘   │
│          │                  │                               │
│          └──────────────────┴──────────────────             │
│                        │                                     │
│  Metrics Collected:                                          │
│  • messages_processed_total                                  │
│  • plans_generated_total                                     │
│  • approvals_pending                                         │
│  • executions_completed_total                                │
│  • execution_duration_seconds                                │
│  • memory_contexts_stored                                    │
│  • agent_health_status                                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## References

- [MACP Protocol](MACP_PROTOCOL.md)
- [Security Model](SECURITY.md)
- [Docker Compose](../docker-compose.yml)
