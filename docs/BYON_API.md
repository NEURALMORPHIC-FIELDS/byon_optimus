# BYON Optimus API Reference

**Patent: EP25216372.0 - Omni-Qube-Vault - Vasile Lucian Borbeleac**

## Memory Service API

Base URL: `http://localhost:8000`

### Health Check

```http
GET /health
```

Response:
```json
{
    "status": "healthy",
    "latency_ms": 2,
    "memory_contexts": 1523,
    "storage_bytes": 2048576
}
```

### Store Code

```http
POST /store/code
Content-Type: application/json

{
    "code": "function add(a, b) { return a + b; }",
    "file": "src/math.ts",
    "line": 10,
    "tags": ["utility", "math"]
}
```

Response:
```json
{
    "ctx_id": 42,
    "memory_type": "code",
    "timestamp": "2026-02-02T12:00:00Z"
}
```

### Store Conversation

```http
POST /store/conversation
Content-Type: application/json

{
    "content": "How do I implement authentication?",
    "role": "user"
}
```

### Store Fact

```http
POST /store/fact
Content-Type: application/json

{
    "fact": "The API uses JWT tokens for authentication",
    "source": "architecture-doc.md",
    "tags": ["auth", "api", "security"]
}
```

### Search

```http
GET /search?query=authentication&type=code&top_k=5
```

Parameters:
- `query` (required): Search query string
- `type` (optional): `code`, `conversation`, `fact`, or omit for all
- `top_k` (optional): Number of results (default: 5)

Response:
```json
{
    "results": [
        {
            "ctx_id": 15,
            "content": "function authenticate(token) { ... }",
            "similarity": 0.89,
            "memory_type": "code",
            "metadata": {
                "file": "src/auth.ts",
                "line": 25
            }
        }
    ],
    "query": "authentication",
    "count": 1
}
```

### Test Recovery

```http
POST /test_recovery
Content-Type: application/json

{
    "ctx_id": 42,
    "loss_percent": 40
}
```

Response:
```json
{
    "ctx_id": 42,
    "original_length": 1024,
    "recovery_success": true,
    "similarity_score": 1.0,
    "loss_percent": 40
}
```

### Get Statistics

```http
GET /stats
```

Response:
```json
{
    "total_contexts": 1523,
    "by_type": {
        "code": 856,
        "conversation": 412,
        "fact": 255
    },
    "storage_bytes": 2048576,
    "compression_ratio": 73000
}
```

## Protocol Types

### EvidencePack

```typescript
interface EvidencePack {
    evidence_id: string;          // UUID format: EV-{timestamp}
    timestamp: string;            // ISO8601
    task_type: "coding" | "scheduling" | "messaging" | "general";
    sources: Source[];
    extracted_facts: ExtractedFact[];
    raw_quotes: RawQuote[];
    codebase_context: CodebaseContext;
    memory_context: MemoryContext;
    global_memory_hint?: GlobalMemoryHint;
    forbidden_data_present: boolean;
    hash: string;                 // SHA-256
}

interface Source {
    source_id: string;
    type: "user_message" | "file" | "api" | "memory";
    content: string;
    timestamp: string;
}

interface ExtractedFact {
    fact_id: string;
    fact: string;
    confidence: number;  // 0.0 - 1.0
    source_refs: string[];
    tags: string[];
}

interface MemoryContext {
    conversation_ctx_id?: number;
    relevant_code_ctx_ids: number[];
    relevant_fact_ctx_ids: number[];
    similar_past_ctx_ids: number[];
}
```

### PlanDraft

```typescript
interface PlanDraft {
    plan_id: string;              // UUID format: PLAN-{timestamp}
    timestamp: string;
    based_on_evidence: string;    // Reference to EvidencePack
    intent: string;
    actions: Action[];
    risk_level: "low" | "medium" | "high";
    rollback_possible: boolean;
    estimated_iterations: number;
    memory_context: MemoryContext;
    hash: string;
}

interface Action {
    action_id: string;
    type: ActionType;
    target: string;               // File path or identifier
    params: Record<string, unknown>;
    description?: string;
}

type ActionType =
    | "file_create"
    | "file_delete"
    | "code_edit"
    | "test_run"
    | "lint_run"
    | "build_run";
```

### ApprovalRequest

```typescript
interface ApprovalRequest {
    request_id: string;           // UUID format: REQ-{timestamp}
    timestamp: string;
    based_on_plan: string;
    summary: string;
    actions_preview: ActionPreview[];
    security_checks: SecurityCheck[];
    risk_level: "low" | "medium" | "high";
    requires_approval: boolean;
    expires_at: string;           // ISO8601
    user_options: UserOption[];
    hash: string;
}

interface SecurityCheck {
    check_type: string;
    passed: boolean;
    details?: string;
}

interface UserOption {
    option_id: string;
    label: string;
    action: "approve" | "reject" | "modify";
}
```

### ExecutionOrder

```typescript
interface ExecutionOrder {
    order_id: string;             // UUID format: ORD-{timestamp}
    timestamp: string;
    based_on_plan: string;
    approved_by: string;          // User or "auto"
    approved_at: string;
    actions: Action[];
    constraints: ExecutionConstraints;
    rollback: RollbackConfig;
    signature: string;            // Ed25519 base64
    nonce: string;                // Replay prevention
    hash: string;
}

interface ExecutionConstraints {
    max_iterations: number;
    timeout_ms: number;
    memory_limit_mb: number;
    disk_limit_mb: number;
}
```

### JohnsonReceipt

```typescript
interface JohnsonReceipt {
    receipt_id: string;           // UUID format: RCPT-{timestamp}
    timestamp: string;
    based_on_order: string;
    execution_summary: ExecutionSummary;
    action_results: ActionResult[];
    errors: ExecutionError[];
    changes_made: ChangesMade;
    verification: Verification;
    hash: string;
}

interface ExecutionSummary {
    status: "success" | "partial" | "failed" | "rejected";
    actions_total: number;
    actions_completed: number;
    actions_failed: number;
    iterations_used: number;
    duration_ms: number;
}

interface ActionResult {
    action_id: string;
    status: "success" | "failed" | "skipped";
    output?: string;
    error?: string;
    duration_ms: number;
}

interface ChangesMade {
    files_modified: string[];
    files_created: string[];
    files_deleted: string[];
}

interface Verification {
    tests_passing: boolean | null;
    lint_passing: boolean | null;
    build_passing: boolean | null;
}
```

## CLI Commands

### byon approve

```bash
# List pending approvals
byon approve list [--json]

# Approve a plan
byon approve <plan-id>

# Reject a plan
byon approve <plan-id> --reject [--reason "explanation"]

# Enable auto-approve for session
byon approve --auto [--risk low|medium]
```

### byon watch

```bash
# Watch real-time activity
byon watch

# Watch specific channel
byon watch --channel inbox

# Watch with JSON output
byon watch --json
```

### byon status

```bash
# Show system status
byon status

# Show memory status
byon status --memory

# Show agent status
byon status --agents

# JSON output
byon status --json
```

### byon history

```bash
# Show today's history
byon history --today

# Show last N entries
byon history --limit 20

# Show specific date range
byon history --from 2026-02-01 --to 2026-02-02

# Filter by event type
byon history --type execution

# JSON output
byon history --json
```

### byon inbox

```bash
# List inbox messages
byon inbox list

# Show message details
byon inbox show <message-id>

# Clear processed messages
byon inbox clear
```

## Handoff File Formats

### Inbox Message

```json
{
    "message_id": "MSG-1706889600000-abc123",
    "timestamp": "2026-02-02T12:00:00Z",
    "source": "openclaw-gateway",
    "destination": "worker",
    "payload": {
        "channel_id": "web-main",
        "channel_type": "web",
        "content": "Create a new utility function",
        "user_id": "user-123"
    },
    "hash": "a1b2c3d4e5f6..."
}
```

### Worker to Auditor

```json
{
    "message_id": "MSG-1706889601000-def456",
    "timestamp": "2026-02-02T12:00:01Z",
    "source": "worker",
    "destination": "auditor",
    "payload": {
        "evidence": { /* EvidencePack */ },
        "plan": { /* PlanDraft */ }
    },
    "hash": "b2c3d4e5f6a7..."
}
```

### Auditor to Executor

```json
{
    "message_id": "MSG-1706889602000-ghi789",
    "timestamp": "2026-02-02T12:00:02Z",
    "source": "auditor",
    "destination": "executor",
    "payload": { /* ExecutionOrder with signature */ },
    "hash": "c3d4e5f6a7b8..."
}
```

### Executor to Worker

```json
{
    "message_id": "MSG-1706889603000-jkl012",
    "timestamp": "2026-02-02T12:00:03Z",
    "source": "executor",
    "destination": "worker",
    "payload": { /* JohnsonReceipt */ },
    "hash": "d4e5f6a7b8c9..."
}
```

## Error Codes

| Code | Description |
|------|-------------|
| `MEMORY_UNAVAILABLE` | Memory service not responding |
| `SIGNATURE_INVALID` | Ed25519 verification failed |
| `NONCE_EXPIRED` | Order timestamp too old |
| `NONCE_REUSED` | Replay attack detected |
| `PATH_TRAVERSAL` | Path escape attempt blocked |
| `FORBIDDEN_PATH` | Access to restricted path |
| `FORBIDDEN_PATTERN` | Dangerous code pattern |
| `ACTION_BLOCKED` | Action type not allowed |
| `RISK_EXCEEDED` | Risk level requires approval |
| `RESOURCE_LIMIT` | Resource limit exceeded |
