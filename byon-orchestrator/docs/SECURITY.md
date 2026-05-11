# BYON Optimus Security Model

**Security Architecture and Threat Mitigation**

> **v0.6.4 banner.** The FCE-M advisory layer introduced in v0.6.0+ produces *risk context only*: contested expressions or high-residue advisories may *raise* required review level via `applyFceRiskAdvisory`, but they cannot approve actions, cannot override truth verdicts, and cannot bypass user approval gates. Aligned ReferenceFields explicitly do **not** bypass approval (`FCE_NOTE: does NOT bypass approval`). The Auditor enforces `validateFceContext` to ensure `fce_context` carries only counts and hashed center IDs — no text content leaks through. Deep-suite security categories (E + F) report 27/27 PASS as of v0.6.4. Executor air-gap and Ed25519 signing requirements are unchanged. See [`../../docs/RESEARCH_PROGRESS_v0.6.md`](../../docs/RESEARCH_PROGRESS_v0.6.md).

## Overview

BYON Optimus implements defense-in-depth with multiple security layers to ensure that AI task execution remains secure, auditable, and under human control.

## Security Principles

| Principle | Implementation |
|-----------|----------------|
| **Least Privilege** | Executor runs with no network, minimal permissions |
| **Separation of Duties** | Worker plans, Auditor approves, Executor acts |
| **Defense in Depth** | Multiple layers of verification |
| **Human in the Loop** | Approval required for risky operations |
| **Audit Everything** | Tamper-evident logging of all actions |

## Threat Model

### Threats Addressed

| Threat | Mitigation |
|--------|------------|
| Malicious plan injection | Ed25519 signature verification |
| Unauthorized execution | Cryptographic chain of custody |
| Data exfiltration | Air-gapped Executor (no network) |
| Privilege escalation | Whitelisted actions only |
| Tampering with audit logs | Hash chain verification |
| Replay attacks | Unique order IDs, expiring approvals |

### Out of Scope

- Physical security of host machine
- Compromise of signing keys at rest
- Denial of service attacks
- Side-channel attacks

## Cryptographic Security

### Ed25519 Key Management

```
┌─────────────────────────────────────────────────────────────┐
│                    KEY MANAGEMENT                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Auditor Agent                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Private Key: /keys/auditor.private.pem                  │ │
│  │ • Generated on first startup                            │ │
│  │ • Never leaves Auditor container                        │ │
│  │ • Used to sign ExecutionOrders                          │ │
│  └────────────────────────────────────────────────────────┘ │
│                         │                                    │
│                         │ Export public key                  │
│                         ▼                                    │
│  Executor Agent                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Public Key: /keys/auditor_public.pem (read-only)        │ │
│  │ • Mounted from shared volume                            │ │
│  │ • Used to verify signatures                             │ │
│  │ • Cannot sign new orders                                │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Signature Flow

```typescript
// 1. Auditor creates order
const order: ExecutionOrder = {
  order_id: "order_xxx",
  based_on_plan: "plan_xxx",
  actions: [...],
  // ... other fields
};

// 2. Calculate hash (excluding signature field)
const contentToSign = JSON.stringify(order, Object.keys(order).sort());
order.hash = crypto.createHash("sha256").update(contentToSign).digest("hex");

// 3. Sign with Ed25519
const signature = ed25519.sign(contentToSign, privateKey);
order.signature = Buffer.from(signature).toString("base64");

// 4. Executor verifies
const isValid = ed25519.verify(
  contentToSign,
  Buffer.from(order.signature, "base64"),
  publicKey
);

if (!isValid) {
  // REJECT - signature mismatch
}
```

### Hash Chain Integrity

All documents are recorded in a tamper-evident hash chain:

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ Entry 0 │───▶│ Entry 1 │───▶│ Entry 2 │───▶│ Entry 3 │
│ Genesis │    │         │    │         │    │         │
├─────────┤    ├─────────┤    ├─────────┤    ├─────────┤
│ hash: 0 │    │prev:h(0)│    │prev:h(1)│    │prev:h(2)│
│ data: {}│    │data:... │    │data:... │    │data:... │
└─────────┘    └─────────┘    └─────────┘    └─────────┘
```

Verification detects any modification to historical entries.

## Network Isolation

### Air-Gapped Executor

```yaml
# docker-compose.yml
byon-executor:
  network_mode: none          # NO NETWORK ACCESS
  read_only: true             # Read-only filesystem
  security_opt:
    - no-new-privileges:true  # Prevent privilege escalation
  cap_drop:
    - ALL                     # Drop all capabilities
  cap_add:
    - CHOWN                   # Minimal required
    - DAC_OVERRIDE
```

### Communication Paths

```
┌──────────────────────────────────────────────────────────────┐
│                    ALLOWED COMMUNICATION                      │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│   Worker ◄───┐                                                │
│              │ File system only                               │
│   Auditor ◄──┤ (no direct network)                           │
│              │                                                │
│   Executor ◄─┘                                                │
│                                                               │
│   Memory Service ◄──── HTTP (Worker only)                     │
│                                                               │
│   Redis ◄──── TCP (Worker/Auditor only)                       │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

## Action Control

### Whitelisted Actions

| Action | Allowed | Notes |
|--------|---------|-------|
| `file_create` | Yes | New files only |
| `file_write` | Yes | Existing files |
| `file_modify` | Yes | With backup |
| `code_edit` | Yes | Source files |
| `file_delete` | Restricted | High risk, logged |
| `test_run` | Yes | Sandboxed |
| `lint_run` | Yes | Sandboxed |
| `build_run` | Yes | Sandboxed |
| `shell_exec` | Restricted | Whitelisted commands only |

### Forbidden Paths

```typescript
const FORBIDDEN_PATTERNS = [
  /^\/etc\//,           // System config
  /^\/root\//,          // Root home
  /^\/proc\//,          // Proc filesystem
  /^\/sys\//,           // Sys filesystem
  /\.env$/,             // Environment files
  /\.ssh\//,            // SSH keys
  /\.aws\//,            // AWS credentials
  /\.gcloud\//,         // GCloud credentials
  /node_modules\//,     // Dependencies
  /\.git\//,            // Git internals
];
```

### Execution Constraints

```typescript
interface ExecutionConstraints {
  max_iterations: number;      // Default: 10
  timeout_minutes: number;     // Default: 15
  memory_limit_mb?: number;    // Default: 512
  disk_limit_mb?: number;      // Default: 256
}
```

## Approval Workflow

### Risk-Based Approval

| Risk Level | Auto-Approve | User Approval |
|------------|--------------|---------------|
| Low | Optional (configurable) | Optional |
| Medium | No | Required |
| High | No | Required + Confirmation |

### Approval Request Lifecycle

```
Created ──▶ Pending ──┬──▶ Approved ──▶ Order Signed
                      │
                      └──▶ Rejected ──▶ Archived
                      │
                      └──▶ Expired ──▶ Archived
```

### Expiration

- Default: 30 minutes
- Configurable per request
- Expired requests cannot be approved

## Audit Trail

### Logged Events

| Event | Logged Data |
|-------|-------------|
| `document_created` | Document ID, type, hash, actor |
| `document_updated` | Changes made, actor |
| `state_changed` | From/to state, reason |
| `approval_requested` | Plan ID, risk level |
| `approval_granted` | Approver, comments |
| `approval_denied` | Reason |
| `execution_started` | Order ID, actions count |
| `execution_completed` | Receipt ID, results |
| `execution_failed` | Error details |
| `error_occurred` | Error type, stack trace |

### Audit Storage

```
audit_logs/
├── executor/
│   └── audit_log.json     # Tamper-evident chain
├── auditor/
│   └── audit_log.json
└── worker/
    └── audit_log.json
```

### Log Rotation

- Max size: 10MB (configurable)
- Rotated logs kept: 5 (configurable)
- Old logs archived with timestamp

## WFP Integration (Optional)

When using WFP Semantic Guard, additional kernel-level protection:

### EXECUTION_INTENT Authorization

```typescript
interface ExecutionIntent {
  intent_id: string;
  process_id: number;
  process_path: string;
  rule_type: "EXACT_IP" | "IP_RANGE" | "PORT_ONLY";
  remote_ip: string;
  remote_port: number;
  protocol: "TCP" | "UDP";
  direction: "outbound" | "inbound";
  expires_at: string;
  max_connections: number;
  signature: string;  // Ed25519
}
```

### Defense Layers with WFP

| Layer | Protection |
|-------|------------|
| Application | BYON Auditor approval |
| User-Mode | Bridge signature verification |
| Kernel | WFP intent rule matching |
| Behavioral | Fragmergent anomaly detection |

## Incident Response

### Detection

1. Hash chain verification (automatic, periodic)
2. Signature verification (every order)
3. Anomaly detection (Fragmergent Brain)

### Response

1. **Signature Invalid**: Immediate rejection, alert
2. **Hash Mismatch**: Stop processing, full audit
3. **Anomaly Detected**: Block traffic, notify user
4. **Unauthorized Path**: Reject action, log attempt

### Recovery

1. Restore from backup (if available)
2. Revoke compromised keys
3. Review audit logs
4. Generate incident report

## Best Practices

### Key Management

- [ ] Generate keys on secure machine
- [ ] Store private keys encrypted at rest
- [ ] Rotate keys periodically
- [ ] Use separate keys for dev/prod

### Deployment

- [ ] Run Executor with `network_mode: none`
- [ ] Use read-only volumes where possible
- [ ] Enable audit logging
- [ ] Configure backup for handoff directories

### Monitoring

- [ ] Monitor audit log integrity
- [ ] Alert on signature failures
- [ ] Track approval response times
- [ ] Review rejected executions

## Compliance Checklist

| Requirement | Status |
|-------------|--------|
| Cryptographic signing | Ed25519 |
| Audit trail | Hash chain |
| Access control | Role-based agents |
| Network isolation | Air-gapped Executor |
| Human oversight | Approval workflow |
| Data integrity | SHA256 hashes |

## References

- [MACP Protocol](MACP_PROTOCOL.md)
- [Architecture](ARCHITECTURE.md)
- [Ed25519 Specification](https://ed25519.cr.yp.to/)
