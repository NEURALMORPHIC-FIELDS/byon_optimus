# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability within BYON Optimus, please report it responsibly.

### How to Report

**DO NOT** open a public GitHub issue for security vulnerabilities.

Instead, please send an email to:

**Email:** security@byon-optimus.dev

Include the following information:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial Assessment:** Within 7 days
- **Resolution Target:** Within 30 days (depending on severity)

### What to Expect

1. You will receive an acknowledgment of your report
2. We will investigate and validate the issue
3. We will work on a fix and coordinate disclosure
4. You will be credited in the security advisory (unless you prefer anonymity)

## Security Architecture

BYON Optimus implements multiple security layers:

### 1. Air-Gapped Executor

The Executor agent runs with `network_mode: none` in Docker, preventing any network access. This ensures that even if malicious code is executed, it cannot exfiltrate data.

```yaml
executor:
  network_mode: none  # Complete network isolation
```

### 2. Cryptographic Signatures

All execution orders require Ed25519 digital signatures from the Auditor:

```typescript
// Orders must be signed before execution
interface ExecutionOrder {
  signature: string;        // Ed25519 signature
  auditor_public_key: string;
  signed_at: string;
}
```

### 3. Schema Validation

All protocol documents are validated against JSON Schema:

- EvidencePack
- PlanDraft
- ApprovalRequest
- ExecutionOrder
- JohnsonReceipt

### 4. Secrets Management

- API keys stored in `.env` (gitignored)
- Private keys stored in `keys/` (gitignored)
- No secrets in code or Docker images
- Environment variables for runtime configuration

## Known Security Considerations

### Intentional Limitations

1. **User Approval Required:** High-risk actions require explicit user approval via ApprovalRequest
2. **Rate Limiting:** Not currently implemented - recommended for production
3. **Audit Logging:** All actions logged but not tamper-proof - consider external logging

### Third-Party Dependencies

We monitor dependencies for vulnerabilities:
- `@anthropic-ai/sdk` - AI API access
- `@noble/ed25519` - Cryptographic signatures
- `better-sqlite3` - Local database
- `ajv` - JSON Schema validation

Run `npm audit` regularly to check for vulnerabilities.

## Best Practices for Deployment

1. **Never expose the Executor to the network**
2. **Rotate Ed25519 keys periodically**
3. **Use strong, unique API keys**
4. **Enable TLS for all external communications**
5. **Run containers as non-root users**
6. **Implement network segmentation**
7. **Monitor handoff directories for anomalies**

## Scope

The following are **in scope** for security reports:
- Authentication/authorization bypasses
- Cryptographic weaknesses
- Code injection vulnerabilities
- Privilege escalation
- Data exfiltration paths
- Memory system vulnerabilities

The following are **out of scope**:
- Social engineering attacks
- Physical security
- Denial of service (unless critical)
- Third-party service vulnerabilities

## Acknowledgments

We thank the security researchers who help keep BYON Optimus secure.

---

**Patent:** EP25216372.0 - Omni-Qube-Vault - Vasile Lucian Borbeleac
