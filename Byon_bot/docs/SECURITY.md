# Security Model

## Overview

Byon Bot implements a defense-in-depth security model with multiple layers of protection:

1. **Air-Gap Isolation** - Executor has no network access
2. **Cryptographic Signing** - All orders are Ed25519 signed
3. **User Approval** - Every action requires human consent
4. **Action Whitelist** - Only approved actions can execute
5. **Resource Limits** - Strict caps on execution resources

## Air-Gap Enforcement

### Docker Network Isolation

The Executor container runs with `network_mode: none`:

```yaml
executor:
  build: ./agent-executor
  network_mode: none  # NO NETWORK ACCESS
```

This ensures:
- No outbound HTTP/HTTPS requests
- No DNS lookups
- No socket connections
- No external API calls

### Verification

```bash
# Inside executor container - these should all fail:
curl https://google.com          # Connection refused
ping 8.8.8.8                     # Network unreachable
wget https://malicious.com       # No route to host
```

## Cryptographic Signing

### Ed25519 Algorithm

All execution orders are signed using Ed25519:

```typescript
interface Ed25519Signature {
  algorithm: 'Ed25519';
  public_key: string;  // Base64 encoded
  signature: string;   // Base64 encoded
}
```

### Key Management

```
keys/
├── auditor.private.pem   # Private key (Auditor only)
└── auditor.public.pem    # Public key (shared with Executor)
```

### Signing Flow

1. Auditor creates execution order
2. Auditor signs order with private key
3. Executor receives signed order
4. Executor verifies signature with public key
5. Only valid signatures are executed

### Verification

```typescript
// Executor verification
const isValid = crypto.verify(
  null,
  Buffer.from(orderData),
  publicKey,
  signature
);

if (!isValid) {
  throw new Error('SECURITY VIOLATION: Invalid signature');
}
```

## User Approval

### Approval Flow

```
Plan Draft → Security Check → User Review → Execution
                                    │
                                    ├── APPROVE → Execute
                                    └── REJECT  → Archive
```

### Approval Interface

```
═══════════════════════════════════════════════════════
📄 Approval Request: req_abc123
═══════════════════════════════════════════════════════

📝 Intent: Fix authentication bug

⚠️  Risk Assessment:
   Level: LOW

🔒 Security Checks:
   Path Traversal:    PASS
   Command Injection: PASS
   Resource Limits:   PASS

🔧 Proposed Actions:
┌───┬─────────────┬─────────────────┬─────────────────┐
│ # │ Type        │ File            │ Description     │
├───┼─────────────┼─────────────────┼─────────────────┤
│ 1 │ code_edit   │ src/auth.ts     │ Fix validation  │
└───┴─────────────┴─────────────────┴─────────────────┘

? What would you like to do?
  ✅ Approve - Execute this plan
  ❌ Reject - Do not execute
  📋 View Details - Show full JSON
```

## Action Whitelist

### Allowed Actions

```typescript
const ALLOWED_ACTIONS = [
  'code_edit',    // Modify existing code files
  'file_create',  // Create new files
  'file_delete',  // Delete files
  'test_run',     // Run test suites
  'lint_run',     // Run linters
  'build_run',    // Run builds
];
```

### Forbidden Actions

```typescript
const FORBIDDEN_ACTIONS = [
  'network_request',  // HTTP calls
  'http_call',        // API requests
  'socket_open',      // Raw sockets
  'dns_lookup',       // DNS queries
  'external_api',     // Third-party APIs
  'shell_exec',       // Arbitrary shell
  'process_spawn',    // New processes
];
```

## Input Validation

### Path Traversal Prevention

```typescript
function validatePath(path: string): boolean {
  if (path.includes('..')) return false;
  if (path.includes('~')) return false;
  if (path.startsWith('/')) return false;
  if (path.includes('\\')) return false;
  if (path.includes('$')) return false;
  return true;
}
```

Blocked patterns:
- `../../../etc/passwd`
- `~/.ssh/id_rsa`
- `/root/secret`
- `$HOME/.bashrc`

### Command Injection Prevention

```typescript
const DANGEROUS_CHARS = [
  ';', '|', '&', '`',
  '$(', '${', '>', '<',
  '\n', '\r', '\x00'
];
```

Blocked patterns:
- `test; rm -rf /`
- `test && malicious`
- `$(whoami)`
- `` `id` ``

### Code Injection Detection

```typescript
const SUSPICIOUS_PATTERNS = [
  /eval\s*\(/,
  /Function\s*\(/,
  /require\s*\(\s*['"`]child_process/,
  /exec\s*\(/,
  /spawn\s*\(/,
];
```

## Resource Limits

### Default Constraints

```typescript
const DEFAULT_LIMITS = {
  max_iterations: 10,      // Max retry attempts
  timeout_minutes: 5,      // Execution timeout
  memory_limit_mb: 512,    // Memory limit
  disk_limit_mb: 100,      // Disk limit
  network_allowed: false,  // ALWAYS false
};
```

### Docker Resource Limits

```yaml
executor:
  deploy:
    resources:
      limits:
        cpus: '2'
        memory: 512M
```

## Hash Integrity

### Protocol Hashing

All protocol files include SHA-256 hashes:

```typescript
interface ProtocolFile {
  // ... content fields
  hash: string;  // SHA-256 of content (excluding hash field)
}
```

### Tamper Detection

```typescript
function validateHash(obj: Record<string, unknown>): boolean {
  const { hash, ...content } = obj;
  const computed = crypto
    .createHash('sha256')
    .update(JSON.stringify(content))
    .digest('hex');
  return computed === hash;
}
```

## Trust Levels

### Source Classification

```typescript
type TrustLevel = 'self' | 'trusted' | 'external' | 'unknown';

const TRUST_MAPPING = {
  self: ['internal', 'system', 'cli'],
  trusted: ['whatsapp', 'telegram', 'discord'],
  external: ['email', 'webhook'],
  unknown: [],
};
```

### Trust-Based Actions

- **self**: Full capabilities
- **trusted**: Standard capabilities
- **external**: Restricted, require extra validation
- **unknown**: Rejected

## Security Checklist

Before deployment:

- [ ] Generate new Ed25519 keypairs
- [ ] Verify Docker network isolation
- [ ] Test signature verification
- [ ] Review action whitelist
- [ ] Configure resource limits
- [ ] Test path traversal prevention
- [ ] Test command injection prevention
- [ ] Run security test suite: `pnpm test:security`

## Incident Response

### If signature verification fails:
1. Stop all agents
2. Check key integrity
3. Regenerate keys if compromised
4. Review audit logs

### If unauthorized action attempted:
1. Automatic rejection by whitelist
2. Log incident details
3. Review source of action
4. Update policies if needed

### If resource limits exceeded:
1. Automatic termination
2. Log resource usage
3. Review execution patterns
4. Adjust limits if legitimate
