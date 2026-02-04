# BYON Optimus Security Model

**Patent: EP25216372.0 - Omni-Qube-Vault - Vasile Lucian Borbeleac**

## Security Principles

1. **Defense in Depth**: Multiple layers of security controls
2. **Least Privilege**: Components have minimum required access
3. **Air-Gap Isolation**: Executor has zero network access
4. **Cryptographic Signing**: All execution orders are Ed25519 signed
5. **Immutable Audit Trail**: Hash-chain based tamper detection

## Cryptographic Security

### Ed25519 Signing

All execution orders must be cryptographically signed by the Auditor before the Executor will process them.

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Auditor   │───▶│  Ed25519    │───▶│  Executor   │
│             │    │  Signature  │    │  (Verify)   │
└─────────────┘    └─────────────┘    └─────────────┘
```

**Key Management**:
- Private key: `keys/auditor.private.pem` (Auditor only)
- Public key: `keys/auditor.public.pem` (Executor reads)
- Algorithm: Ed25519 (elliptic curve)
- Key size: 32 bytes

**Signature Format**:
```typescript
interface SignedOrder {
    order_id: string;
    based_on_plan: string;
    actions: Action[];
    timestamp: string;
    nonce: string;      // Replay prevention
    signature: string;  // Base64 Ed25519 signature
}
```

### Hash Chain Audit Trail

All documents are linked in an immutable hash chain:

```
Genesis → EvidencePack → PlanDraft → ExecutionOrder → Receipt
   ↓           ↓            ↓             ↓            ↓
 hash₀      hash₁        hash₂         hash₃        hash₄
   ↓           ↓            ↓             ↓
 prev=0    prev=h₀      prev=h₁       prev=h₂      prev=h₃
```

Tampering detection:
- Modified data → hash mismatch
- Deleted block → chain breaks
- Inserted block → previous hash invalid

## Air-Gap Isolation

The Executor runs with **zero network access**:

```yaml
# docker-compose.yml
byon-executor:
    build:
        target: executor
    network_mode: none  # TRUE AIR-GAP
    volumes:
        # Read-only input
        - ./handoff/auditor_to_executor:/handoff/in:ro
        # Write-only output
        - ./handoff/executor_to_worker:/handoff/out
        # Project workspace
        - ./project:/workspace
```

**Enforced restrictions**:
- No `fetch()`, `http.request()`, `axios`
- No WebSocket connections
- No DNS resolution
- No external URLs in code

## Policy Enforcement

### Action Whitelist

```typescript
const whitelist = {
    allowed: [
        "file_create",
        "code_edit",
        "test_run",
        "lint_run",
        "build_run"
    ],
    requireApproval: [
        "file_delete"
    ],
    blocked: [
        "shell_exec"  // Always blocked
    ]
};
```

### Forbidden Paths

```typescript
const forbiddenPaths = [
    // System
    "/etc", "/usr", "/bin", "/sbin",
    "C:\\Windows", "C:\\Program Files",

    // Credentials
    ".env", ".env.local", ".env.production",
    "credentials", "secrets", ".aws", ".ssh",

    // Version Control
    ".git", ".svn", ".hg",

    // Dependencies
    "node_modules", "vendor",

    // Lock files
    "package-lock.json", "pnpm-lock.yaml"
];
```

### Forbidden Code Patterns

```typescript
const forbiddenPatterns = {
    network: [
        /fetch\s*\(/,
        /axios/,
        /http\.request/,
        /WebSocket/
    ],
    process: [
        /child_process/,
        /exec\s*\(/,
        /spawn\s*\(/
    ],
    eval: [
        /eval\s*\(/,
        /new\s+Function\s*\(/
    ],
    credentials: [
        /password\s*[:=]\s*['"`]/,
        /api[_-]?key\s*[:=]/,
        /-----BEGIN.*PRIVATE KEY-----/
    ]
};
```

## Risk Assessment

Plans are assessed for risk level:

| Factor | Weight | Impact |
|--------|--------|--------|
| File deletions | 0.20 | High |
| File creates | 0.10 | Low |
| Code edits | 0.15 | Medium |
| Action count | 0.15 | Variable |
| Iterations | 0.10 | Variable |
| Rollback possible | 0.15 | Reducing |
| Path sensitivity | 0.15 | Variable |

**Risk Levels**:
- **Low** (score ≤ 30): Auto-approve possible
- **Medium** (30 < score ≤ 60): User approval recommended
- **High** (score > 60): User approval required

## Resource Limits

Limits vary by risk level:

| Limit | Low Risk | Medium Risk | High Risk |
|-------|----------|-------------|-----------|
| Max iterations | 10 | 5 | 3 |
| Timeout (min) | 30 | 15 | 10 |
| Memory (MB) | 1024 | 512 | 256 |
| Disk (MB) | 100 | 50 | 25 |

## Path Traversal Prevention

Multiple defenses against path traversal:

1. **Pattern detection**: `..`, `..%2f`, `%2e%2e`
2. **URL decoding**: Handles encoded attacks
3. **Path normalization**: Resolves to absolute
4. **Root containment**: Must stay within project

```typescript
function isPathSafe(target: string, projectRoot: string): boolean {
    // Normalize and resolve
    const normalized = path.resolve(projectRoot, target);

    // Check containment
    const relative = path.relative(projectRoot, normalized);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
}
```

## Replay Attack Prevention

Execution orders include nonces:

```typescript
interface ExecutionOrder {
    order_id: string;
    timestamp: string;
    nonce: string;      // Random 16 bytes
    signature: string;
}
```

Prevention:
1. Check timestamp freshness (5 min window)
2. Track used nonces
3. Reject duplicate nonces

## Document State Machine

```
     ┌───────┐
     │ draft │ ─── user can delete
     └───┬───┘
         │ submit
         ▼
     ┌─────────┐
     │ pending │ ─── awaiting approval
     └────┬────┘
          │ approve/reject
          ▼
  ┌───────┴───────┐
  │               │
  ▼               ▼
┌─────────┐   ┌─────────┐
│approved │   │cancelled│ ─── terminal
└────┬────┘   └─────────┘
     │ execute
     ▼
┌──────────┐   ┌────────┐
│ executed │   │ failed │ ─── IMMUTABLE
└──────────┘   └────────┘
```

**Immutability rules**:
- `executed` and `failed` states are immutable
- Can only soft-delete (mark as hidden)
- Full audit trail preserved

## Security Checklist

### Deployment

- [ ] Generate fresh Ed25519 keys
- [ ] Verify executor has `network_mode: none`
- [ ] Set appropriate auto-approve level
- [ ] Configure resource limits
- [ ] Enable audit logging

### Code Review

- [ ] No forbidden patterns in actions
- [ ] No path traversal in targets
- [ ] No hardcoded credentials
- [ ] No network access in executor code

### Runtime

- [ ] Verify signatures before execution
- [ ] Check nonce freshness
- [ ] Enforce resource limits
- [ ] Log all state transitions

## Threat Model

| Threat | Mitigation |
|--------|------------|
| Malicious code execution | Air-gap, signature verification |
| Path traversal | Pattern detection, containment |
| Credential theft | Forbidden paths, pattern detection |
| Replay attacks | Nonces, timestamps |
| Audit tampering | Hash chain, immutable states |
| Network exfiltration | Air-gap isolation |
| Shell injection | shell_exec blocked |

## Incident Response

If security violation detected:

1. Executor rejects unsigned/tampered order
2. JohnsonReceipt generated with `status: rejected`
3. Violation logged to audit trail
4. Alert sent to monitoring system
5. Worker notified for human review
