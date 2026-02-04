# Byon Bot Architecture

## Overview

Byon Bot is a secure multi-agent system implementing MACP v1.1 (Multi-Agent Control Protocol) with air-gapped code execution.

## System Architecture

```
                              ┌─────────────────────┐
                              │       USER          │
                              │  (Approval Point)   │
                              └──────────┬──────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
                    ▼                    ▼                    ▼
            ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
            │   WORKER     │    │   AUDITOR    │    │   EXECUTOR   │
            │   Agent A    │───▶│   Agent B    │───▶│   Agent C    │
            │              │    │              │    │  (AIR-GAP)   │
            └──────────────┘    └──────────────┘    └──────────────┘
                    │                                       │
                    └───────────────────────────────────────┘
                              johnson_receipt
```

## Agents

### Agent A: Worker
- **Role**: Inbox Reader & Plan Creator
- **Capabilities**:
  - Read messages from channels (WhatsApp, Telegram, Discord, etc.)
  - Extract facts and context
  - Generate evidence packs
  - Create plan drafts
  - Verify execution receipts
- **Outputs**: `evidence_pack.json`, `plan_draft.json`
- **Memory**: FHRSS+FCPE for semantic code search

### Agent B: Auditor
- **Role**: Security Validator & Signer
- **Capabilities**:
  - Validate plans against policies
  - Run security checks
  - Generate approval requests
  - Sign execution orders (Ed25519)
- **Outputs**: `approval_request.json`, `execution_order.json`

### Agent C: Executor
- **Role**: Code Executor (AIR-GAPPED)
- **Capabilities**:
  - Execute code changes
  - Run tests
  - Verify builds
  - Generate receipts
- **Outputs**: `johnson_receipt.json`
- **Restrictions**: NO NETWORK ACCESS

## Protocol Flow

```
1. User Message → Worker
   └─→ Worker extracts facts, creates evidence_pack + plan_draft

2. Worker → Auditor
   └─→ Auditor validates, creates approval_request

3. Auditor → User (APPROVAL CHECKPOINT)
   └─→ User reviews and approves/rejects

4. User Approval → Auditor → Executor
   └─→ Auditor signs execution_order
   └─→ Executor receives signed order

5. Executor → Worker
   └─→ Executor creates johnson_receipt
   └─→ Worker verifies and archives
```

## Directory Structure

```
byon-bot/
├── agent-worker/           # Agent A
│   ├── AGENTS.md          # Master instructions
│   ├── agent_docs/        # Detailed docs
│   └── src/               # Source code
├── agent-auditor/          # Agent B
│   ├── AGENTS.md
│   ├── agent_docs/
│   └── src/
├── agent-executor/         # Agent C (AIR-GAPPED)
│   ├── AGENTS.md
│   ├── agent_docs/
│   └── src/
├── shared/                 # Shared modules
│   ├── types/             # TypeScript types
│   ├── crypto/            # Ed25519 signing
│   ├── policy/            # Whitelist & rules
│   ├── schemas/           # JSON schemas
│   └── memory/            # FHRSS+FCPE system
├── cli/                    # User CLI
├── tests/                  # Test suites
├── handoff/                # Inter-agent communication (runtime)
└── docker-compose.yml      # Container orchestration
```

## Security Model

### Air-Gap Enforcement
- Executor runs with `network_mode: none`
- No outbound network connections possible
- Only file-based communication via handoff directories

### Cryptographic Signing
- All execution orders signed with Ed25519
- Public keys pre-shared during setup
- Executor verifies signatures before execution

### User Approval
- Every plan requires explicit user approval
- No automatic execution without consent
- Full visibility into proposed changes

### Action Whitelist
```typescript
type AllowedActions =
  | 'code_edit'    // Modify existing files
  | 'file_create'  // Create new files
  | 'file_delete'  // Delete files
  | 'test_run'     // Run test suites
  | 'lint_run'     // Run linters
  | 'build_run';   // Run builds
```

### Resource Limits
```typescript
interface ExecutionConstraints {
  max_iterations: 10;        // Max retry attempts
  timeout_minutes: 5;        // Execution timeout
  memory_limit_mb: 512;      // Memory cap
  disk_limit_mb: 100;        // Disk cap
  network_allowed: false;    // ALWAYS false
}
```

## Memory System (FHRSS+FCPE)

### FCPE - Fractal-Chaotic Persistent Encoding
- Compresses variable-length sequences to fixed vectors
- 73,000x compression ratio for 2M tokens
- Preserves semantic similarity

### FHRSS - Fractal-Holographic Redundant Storage
- XOR-based parity system
- 100% recovery at 40% data loss
- 9 parity families for fault tolerance

### Integration in Agent Worker

The memory system is **hard-wired** into the Worker agent and used in every request:

```typescript
// 1. Store incoming conversation
const conversationCtxId = await storeInMemory(
  event.content, 'conversation',
  { role: 'user', source: event.source }
);

// 2. Search for relevant context
const relevantCode = await searchContext(event.content, 'code');
const relevantConversations = await searchContext(event.content, 'conversation');
const relevantFacts = await searchContext(event.content, 'fact');

// 3. Extract and store facts from content
const extractedFacts = extractFactsFromContent(event.content, eventId);
for (const fact of extractedFacts) {
  await storeInMemory(fact.fact, 'fact', { source: event.source });
}

// 4. Include memory context in protocol documents
const evidencePack: EvidencePack = {
  // ... other fields
  memory_context: {
    conversation_ctx_id: conversationCtxId,
    relevant_code_ctx_ids: relevantCode.map(r => r.ctx_id),
    relevant_fact_ctx_ids: relevantFacts.map(r => r.ctx_id),
  }
};
```

### MemoryContext Type

Protocol documents include memory context IDs for cross-session retrieval:

```typescript
interface MemoryContext {
  conversation_ctx_id?: number;     // Current conversation
  relevant_code_ctx_ids?: number[]; // Related code snippets
  relevant_fact_ctx_ids?: number[]; // Related facts
  similar_past_ctx_ids?: number[];  // Similar past interactions
}
```

### Usage
```typescript
import { AgentMemory } from '@byon-bot/memory';

const memory = new AgentMemory('worker');
await memory.initialize();

// Store code
await memory.storeCode(code, 'src/auth.ts', 42);

// Search
const results = await memory.searchCode('authentication bug');
```

## Inter-Agent Communication

Communication happens via JSON files in handoff directories:

| Directory | Direction | Contents |
|-----------|-----------|----------|
| `worker_to_auditor/` | A → B | evidence_pack, plan_draft |
| `auditor_to_user/` | B → User | approval_request |
| `auditor_to_executor/` | B → C | execution_order (signed) |
| `executor_to_worker/` | C → A | johnson_receipt |

## Docker Configuration

```yaml
services:
  worker:
    build: ./agent-worker
    volumes:
      - ./handoff:/handoff
      - ./memory/worker:/memory
    environment:
      - ROLE=worker

  auditor:
    build: ./agent-auditor
    volumes:
      - ./handoff:/handoff
    environment:
      - ROLE=auditor

  executor:
    build: ./agent-executor
    network_mode: none  # AIR-GAP
    volumes:
      - ./handoff:/handoff
      - ./workspace:/workspace
    environment:
      - ROLE=executor
```

## CLI Commands

```bash
# Approve execution orders
byon approve              # Process pending
byon approve --watch      # Watch mode
byon approve --auto       # Auto-approve low-risk

# Monitor activity
byon watch               # Real-time logs
byon watch --verbose     # With details

# System status
byon status              # Show stats

# Send messages
byon inbox "Fix the bug" # Send to system
```

## Immutable Audit Trail

All protocol documents are stored in an immutable, hash-chained audit trail.

### Features
- **Calendar Indexing**: Documents indexed by hour/day/week/year
- **Hash Chaining**: Each document references previous hash
- **Integrity Verification**: Verify entire chain hasn't been tampered
- **Soft Deletes**: Documents can be marked deleted but never removed

### Storage Structure
```
audit/
├── index/
│   ├── by_hour/      # YYYY-MM-DD-HH.json
│   ├── by_day/       # YYYY-MM-DD.json
│   ├── by_week/      # YYYY-Www.json
│   └── by_year/      # YYYY.json
├── documents/        # Full document storage
└── chain.json        # Hash chain metadata
```

### Usage
```typescript
import { AuditService } from '@byon-bot/audit';

const audit = new AuditService();
await audit.store(evidencePack);
const docs = await audit.queryByDate('2026-02-01');
const valid = await audit.verifyChain();
```

## BYON Style Contract

Enforces strict output formatting for agent responses.

### Forbidden Patterns
- **Empathy**: "I understand", "with pleasure", "of course"
- **Meta**: "as an AI", "my limitations", "I cannot"
- **Story**: "imagine", "let me tell you a story"
- **Therapy**: "anxiety", "stress", "cope", "healing"

### Validation Loop
```typescript
import { validate_or_regenerate } from '@byon-bot/style';

const result = await validate_or_regenerate(
  doc,
  async (ctx) => regenerateWithLLM(ctx),
  { minScore: 85, maxAttempts: 3, hardFail: true }
);
```

## Web UI

Real-time web interface for monitoring and approvals.

### Components
- **Dashboard** (`/`): Agent status, pending approvals, receipts
- **Approvals** (`/approvals.html`): Review and approve/reject queue
- **History** (`/history.html`): Browse audit trail with filters

### WebSocket Events
```typescript
// Server broadcasts
ws.send(JSON.stringify({ type: 'agent_status', data: {...} }));
ws.send(JSON.stringify({ type: 'new_approval', data: {...} }));
ws.send(JSON.stringify({ type: 'new_receipt', data: {...} }));
```

## Testing

```bash
pnpm test               # All tests
pnpm test:unit          # Unit tests
pnpm test:integration   # Integration tests
pnpm test:security      # Security tests (includes BYON style)
pnpm test:memory        # Python memory tests
```
