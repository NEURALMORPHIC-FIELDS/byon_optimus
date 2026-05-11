# BYON Orchestrator

**Multi-Agent Control Protocol (MACP) v1.1 Implementation**

A secure, air-gapped multi-agent orchestration system for AI task execution with cryptographic verification.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BYON Optimus System                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────┐     ┌─────────────┐     ┌───────────┐                 │
│  │  Inbox  │ ──▶ │   Worker    │ ──▶ │  Auditor  │                 │
│  │ Message │     │   Agent A   │     │  Agent B  │                 │
│  └─────────┘     └─────────────┘     └─────┬─────┘                 │
│                                            │                        │
│                        ┌───────────────────┼───────────────────┐   │
│                        │                   ▼                   │   │
│                        │          ┌───────────────┐            │   │
│                        │          │   Approval    │            │   │
│                        │          │   Request     │            │   │
│                        │          └───────┬───────┘            │   │
│                        │                  │ User Approval      │   │
│                        │                  ▼                    │   │
│                        │          ┌───────────────┐            │   │
│                        │          │  Execution    │            │   │
│                        │          │    Order      │            │   │
│                        │          │  (Ed25519)    │            │   │
│                        │          └───────┬───────┘            │   │
│                        │                  │                    │   │
│                        │                  ▼                    │   │
│                        │  ┌────────────────────────────────┐   │   │
│                        │  │         Executor Agent C       │   │   │
│                        │  │       (AIR-GAPPED / ISOLATED)  │   │   │
│                        │  │         network_mode: none     │   │   │
│                        │  └────────────────┬───────────────┘   │   │
│                        │                   │                   │   │
│                        └───────────────────┼───────────────────┘   │
│                                            │                        │
│                                            ▼                        │
│                                   ┌───────────────┐                 │
│                                   │   Johnson     │                 │
│                                   │   Receipt     │                 │
│                                   └───────────────┘                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Components

### Worker Agent (A)
- Monitors inbox for incoming messages
- Builds Evidence Packs (codebase analysis, task classification)
- Generates Plan Drafts with actionable steps
- Hands off to Auditor via file-based handoff

### Auditor Agent (B)
- Validates plans against security policies
- Creates Approval Requests for user review
- Signs Execution Orders with Ed25519 private key
- Maintains cryptographic chain of custody

### Executor Agent (C)
- **AIR-GAPPED** - No network access (`network_mode: none`)
- Verifies Ed25519 signatures before execution
- Executes whitelisted actions only
- Generates Johnson Receipts with execution results

## Document Flow (MACP v1.1)

```
InboxMessage → Worker → EvidencePack + PlanDraft
                              ↓
                        Auditor validates
                              ↓
                        ApprovalRequest → User
                              ↓
                        User approves
                              ↓
                        ExecutionOrder (signed)
                              ↓
                        Executor verifies & executes
                              ↓
                        JohnsonReceipt
```

## Security Features

- **Ed25519 Signatures**: All Execution Orders are cryptographically signed
- **Air-Gapped Execution**: Executor has no network access
- **Audit Trail**: Tamper-evident hash chain for all operations
- **File-Based Handoff**: No direct agent communication
- **Whitelisted Actions**: Only approved action types can execute

## Directory Structure

```
byon-orchestrator/
├── src/
│   ├── agents/
│   │   ├── worker/           # Worker Agent A
│   │   │   ├── index.ts
│   │   │   ├── evidence-builder.ts
│   │   │   └── plan-generator.ts
│   │   ├── auditor/          # Auditor Agent B
│   │   │   ├── index.ts
│   │   │   ├── plan-watcher.ts
│   │   │   └── approval-generator.ts
│   │   └── executor/         # Executor Agent C
│   │       ├── index.ts
│   │       ├── order-watcher.ts
│   │       ├── signature-verifier.ts
│   │       ├── action-handlers.ts
│   │       └── receipt-generator.ts
│   ├── audit/                # Audit trail system
│   │   ├── audit-service.ts
│   │   ├── hash-chain.ts
│   │   └── document-states.ts
│   ├── types/
│   │   └── protocol.ts       # MACP type definitions
│   └── services/
│       └── signature-service.ts
├── memory-service/           # FHRSS+FCPE Memory (Python)
│   ├── memory_service.py
│   └── fhrss_fcpe_unified.py
└── dist/                     # Compiled output
```

## Handoff Directories

```
handoff/
├── inbox/                    # Incoming messages
├── worker_to_auditor/        # Plans + Evidence
├── auditor_to_user/          # Approval Requests
├── auditor_to_executor/      # Signed Execution Orders
└── executor_to_worker/       # Johnson Receipts
```

## Installation

```bash
# Install dependencies
npm install

# Build
npm run build

# Run individual agents
npm run worker    # Start Worker Agent
npm run auditor   # Start Auditor Agent
npm run executor  # Start Executor Agent (air-gapped)
```

## Docker Deployment

```bash
# Build all images
docker-compose build

# Start all services
docker-compose up -d

# Check status
docker-compose ps
```

## Environment Variables

### Worker Agent
- `INBOX_PATH` - Path to inbox directory
- `HANDOFF_PATH` - Path to handoff directory
- `MEMORY_SERVICE_URL` - URL for FHRSS+FCPE memory service

### Auditor Agent
- `HANDOFF_PATH` - Path to handoff directory
- `AUTO_APPROVE_LOW_RISK` - Auto-approve low-risk plans (default: false)
- `KEYS_PATH` - Path to key storage

### Executor Agent
- `PROJECT_ROOT` - Root directory for file operations
- `HANDOFF_PATH` - Path to handoff directory
- `KEYS_PATH` - Path containing auditor's public key
- `DRY_RUN` - Execute in dry-run mode (default: false)
- `MAX_ITERATIONS` - Maximum iterations per order (default: 10)

## API Endpoints

### Auditor HTTP API (Port 3003)

```
GET  /status         - Agent status
GET  /pending        - Pending approval requests
POST /approve        - Approve/reject a plan
     Body: { request_id, approved, decided_by, reason }
```

### Worker HTTP API (Port 3002)

```
GET  /status         - Agent status
GET  /stats          - Processing statistics
```

### Executor HTTP API (Internal only)

```
GET  /health         - Health check
GET  /status         - Execution status
```

## FHRSS+FCPE Memory System

The memory service provides infinite context memory with fault tolerance:

- **Max Context**: 2,000,000+ tokens
- **Recovery**: 100% at 40% data loss
- **Compression**: 73,000x ratio
- **Storage**: Persistent SSD-backed

### Memory API (Port 8000)

```
POST /store          - Store context embedding
POST /retrieve       - Retrieve similar contexts
POST /search         - Semantic search
GET  /stats          - Memory statistics
```

## Action Types

| Type | Risk | Rollback | Description |
|------|------|----------|-------------|
| `file_create` | Low | Yes | Create new file |
| `file_write` | Medium | Yes | Write to file |
| `file_modify` | Medium | Yes | Modify existing file |
| `file_delete` | High | No | Delete file |
| `code_edit` | Medium | Yes | Edit source code |
| `test_run` | Low | N/A | Run tests |
| `lint_run` | Low | N/A | Run linter |
| `build_run` | Low | N/A | Run build |
| `shell_exec` | High | No | Execute shell command |

## License

Patent Pending: EP25216372.0
FHRSS/Omni-Qube-Vault - Vasile Lucian Borbeleac

## References

- [MACP Protocol Specification](docs/MACP_PROTOCOL.md)
- [Architecture Overview](docs/ARCHITECTURE.md)
- [Security Model](docs/SECURITY.md)
