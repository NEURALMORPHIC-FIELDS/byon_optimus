# Production Security Remediation Guide

**Document Version:** 1.0  
**Date:** 2026-02-02  
**Status:** REQUIRED FOR PRODUCTION DEPLOYMENT

## Executive Summary

This document provides step-by-step remediation instructions for all critical security findings identified in the Enterprise System Audit. **All items marked as CRITICAL must be completed before production deployment.**

---

## 🔴 CRITICAL: C1. OPENCLAW_GATEWAY_TOKEN - EXPOSED

### Current Status
Token is hardcoded in multiple locations:
- `.env` (Line 24)
- `Byon_bot/openclaw-main/data/openclaw.json` (Line 8)
- `install-byon-v2.ps1` (Lines 570, 600)
- `README.md` (Line 29)

### Impact
- Gateway authentication bypass
- Unauthorized access to all BYON Optimus functionality
- API abuse potential

### Remediation Steps

#### Step 1: Generate New Token
```bash
# Generate a new secure token (64 characters)
openssl rand -hex 32
```

#### Step 2: Update .env File Only
```bash
# Edit .env file
OPENCLAW_GATEWAY_TOKEN=<YOUR_NEW_TOKEN_HERE>
```

#### Step 3: Remove Token from All Config Files
```bash
# Remove from openclaw.json
# Replace actual token with placeholder: "OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN}"

# Remove from install-byon-v2.ps1
# Replace with: Read-Host -Prompt "Enter OpenClaw Gateway Token" -AsSecureString

# Update README.md
# Replace actual token with: "See .env.example for configuration"
```

#### Step 4: Add to .gitignore
```bash
# Ensure .env is in .gitignore
echo ".env" >> .gitignore
echo "*.key" >> .gitignore
echo "keys/private*" >> .gitignore
```

#### Step 5: Revoke Old Token
- If the old token was committed to Git history, consider it permanently compromised
- Rotate all related credentials
- Audit access logs for unauthorized usage

### Validation
```bash
# Verify token is only in .env
grep -r "YOUR_OLD_TOKEN" . --exclude-dir=node_modules --exclude-dir=.git
# Should return NO results

# Verify .env is gitignored
git check-ignore -v .env
# Should show .env is ignored
```

---

## 🔴 CRITICAL: Anthropic API Key - EXPOSED

### Current Status
API key is hardcoded in `.env` file:
```
sk-ant-api03-REDACTED-KEY-REVOKED-SEE-ANTHROPIC-CONSOLE
```

### Impact
- API abuse
- Cost escalation (usage on your account)
- Potential data exfiltration if attacker uses your key

### Remediation Steps

#### Step 1: Revoke Compromised Key IMMEDIATELY
1. Log in to https://console.anthropic.com
2. Navigate to API Keys section
3. Find the compromised key (now revoked)
4. Click "Revoke" or "Delete"
5. Confirm revocation

#### Step 2: Generate New API Key
1. In Anthropic Console, click "Create API Key"
2. Name it: `BYON-Optimus-Production-<DATE>`
3. Copy the key immediately (you won't see it again)

#### Step 3: Update .env Securely
```bash
# Edit .env
ANTHROPIC_API_KEY=<YOUR_NEW_KEY_HERE>

# Verify .env is gitignored
git check-ignore -v .env
```

#### Step 4: Set Usage Limits
1. In Anthropic Console, set monthly spending limit
2. Enable usage alerts at 50%, 80%, 90%
3. Set up email notifications

#### Step 5: Audit Git History
```bash
# Check if key was committed to Git
git log -p | grep "sk-ant-api"

# If found, the repository must be considered compromised
# Options:
# 1. Use git filter-branch to remove from history (complex)
# 2. Archive old repo and create new one
# 3. Use BFG Repo Cleaner
```

### Validation
```bash
# Test new key
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":10,"messages":[{"role":"user","content":"test"}]}'

# Should return valid response (not 401)
```

---

## 🟡 HIGH PRIORITY: Ed25519 Keys - PLACEHOLDER IMPLEMENTATION

### Current Status
File: `Byon_bot/scripts/generate-keys.js` uses `crypto.randomBytes()` instead of proper Ed25519 key derivation.

**Lines 35-36:**
```javascript
const privateKey = randomBytes(32);
const publicKey = randomBytes(32); // Placeholder - should derive from private key
```

### Impact
- Invalid cryptographic signatures
- Public key does NOT correspond to private key
- Signature verification will fail in production
- Security vulnerability: attacker could forge signatures

### Remediation Steps

#### Step 1: Install Proper Ed25519 Library
```bash
cd Byon_bot
npm install @noble/ed25519
```

#### Step 2: Update generate-keys.js
Replace the current implementation with proper Ed25519:

```javascript
#!/usr/bin/env node

/**
 * Generate Ed25519 key pair for signing execution orders
 * Run with: node scripts/generate-keys.js
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import * as ed25519 from '@noble/ed25519';

async function main() {
  const keysDir = join(process.cwd(), 'keys');

  // Create keys directory
  if (!existsSync(keysDir)) {
    mkdirSync(keysDir, { recursive: true });
    console.log('Created keys/ directory');
  }

  // Check if keys already exist
  const privateKeyPath = join(keysDir, 'private.key');
  const publicKeyPath = join(keysDir, 'public.key');

  if (existsSync(privateKeyPath)) {
    console.error('Error: Keys already exist. Delete them first if you want to regenerate.');
    process.exit(1);
  }

  // Generate proper Ed25519 key pair
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = await ed25519.getPublicKey(privateKey);

  // Save keys
  const keyPair = {
    privateKey: Buffer.from(privateKey).toString('base64'),
    publicKey: Buffer.from(publicKey).toString('base64'),
    algorithm: 'Ed25519',
    createdAt: new Date().toISOString(),
  };

  writeFileSync(privateKeyPath, JSON.stringify(keyPair, null, 2));
  console.log(`Private key saved to: ${privateKeyPath}`);

  // Save public key separately (for Executor to verify)
  const publicKeyData = {
    publicKey: Buffer.from(publicKey).toString('base64'),
    algorithm: 'Ed25519',
  };

  const publicDir = join(keysDir, 'public');
  if (!existsSync(publicDir)) {
    mkdirSync(publicDir, { recursive: true });
  }

  writeFileSync(join(publicDir, 'auditor.pub'), JSON.stringify(publicKeyData, null, 2));
  console.log(`Public key saved to: ${join(publicDir, 'auditor.pub')}`);

  console.log('\n⚠️  IMPORTANT: Keep private.key secret and never commit it to git!');
  console.log('The public/ directory can be shared with the Executor container.');
}

main().catch(console.error);
```

#### Step 3: Regenerate Keys
```bash
# Backup old keys (if they exist)
mv keys/private.key keys/private.key.old 2>/dev/null || true
mv keys/public/auditor.pub keys/public/auditor.pub.old 2>/dev/null || true

# Generate new proper Ed25519 keys
node Byon_bot/scripts/generate-keys.js
```

#### Step 4: Update Signer Implementation
Verify that `byon-orchestrator/src/agents/auditor/signer.ts` uses proper Ed25519 signing:

```typescript
import * as ed25519 from '@noble/ed25519';

// In signing function:
const privateKeyBytes = Buffer.from(privateKeyBase64, 'base64');
const messageBytes = Buffer.from(message, 'utf-8');
const signatureBytes = await ed25519.sign(messageBytes, privateKeyBytes);
const signature = Buffer.from(signatureBytes).toString('base64');
```

#### Step 5: Update Verifier Implementation
Verify that `byon-orchestrator/src/agents/executor/signature-verifier.ts` uses proper Ed25519 verification:

```typescript
import * as ed25519 from '@noble/ed25519';

// In verification function:
const publicKeyBytes = Buffer.from(publicKeyBase64, 'base64');
const messageBytes = Buffer.from(message, 'utf-8');
const signatureBytes = Buffer.from(signatureBase64, 'base64');
const isValid = await ed25519.verify(signatureBytes, messageBytes, publicKeyBytes);
```

### Validation
```bash
# Test key generation
node Byon_bot/scripts/generate-keys.js

# Verify key format
cat keys/private.key | jq -r '.algorithm'
# Should output: Ed25519

# Test signing and verification (unit test)
npm test -- --grep "Ed25519"
```

---

## ✅ Other Security Items (Already Compliant)

### BYON_BRIDGE_SECRET
- ✅ Properly uses environment variable
- File: `byon-orchestrator/src/integration/openclaw-bridge.ts` (Line 155)
- No action required

### REDIS_PASSWORD
- ✅ Optional environment variable, no hardcoding
- File: `docker-compose.yml` (Lines 320-321)
- Recommended: Set strong password in production

### Signature Validation
- ✅ Implemented
- File: `byon-orchestrator/src/integration/openclaw-bridge.ts` (Line 250)
- No action required (after Ed25519 fix)

### Executor network_mode: none
- ✅ Verified air-gap isolation
- File: `docker-compose.yml` (Line 186)
- No action required

### User Approval Workflow
- ✅ Implemented
- File: `byon-orchestrator/src/agents/auditor/approval-manager.ts`
- No action required

### Forbidden Paths
- ✅ Comprehensive protection
- File: `byon-orchestrator/src/policy/forbidden-paths.ts`
- No action required

---

## Production Deployment Checklist

Before deploying to production, complete this checklist:

### Secrets Management
- [ ] Rotate OPENCLAW_GATEWAY_TOKEN (see C1 above)
- [ ] Revoke and regenerate ANTHROPIC_API_KEY (see above)
- [ ] Implement proper Ed25519 key generation (see above)
- [ ] Verify .env is in .gitignore
- [ ] Verify keys/private* is in .gitignore
- [ ] Set strong REDIS_PASSWORD in production .env
- [ ] Set BYON_BRIDGE_SECRET (generate with: `openssl rand -hex 32`)

### Key Management
- [ ] Generate new Ed25519 keys with proper library
- [ ] Backup private keys to secure location (KMS, vault, encrypted storage)
- [ ] Document key rotation procedure
- [ ] Set up key expiration policy (e.g., rotate every 90 days)

### Access Control
- [ ] Remove all hardcoded tokens from config files
- [ ] Audit git history for leaked secrets
- [ ] Set up Anthropic API usage limits and alerts
- [ ] Configure firewall rules for production servers
- [ ] Restrict Docker socket access

### Monitoring
- [ ] Enable audit logging
- [ ] Set up alerting for signature verification failures
- [ ] Monitor API usage and costs
- [ ] Set up intrusion detection

### Documentation
- [ ] Update README.md to remove any sensitive examples
- [ ] Create incident response plan
- [ ] Document key rotation procedures
- [ ] Create disaster recovery plan

---

## Incident Response Plan

### If Secrets Are Compromised

1. **Immediate Actions (within 1 hour)**
   - Revoke compromised keys/tokens immediately
   - Generate new credentials
   - Update production environment
   - Notify security team

2. **Investigation (within 24 hours)**
   - Review access logs for unauthorized usage
   - Identify scope of compromise
   - Document timeline of events
   - Calculate potential impact (data access, costs)

3. **Remediation (within 72 hours)**
   - Implement additional security controls
   - Audit all related systems
   - Update security documentation
   - Conduct post-mortem analysis

4. **Prevention**
   - Implement automated secret scanning
   - Add pre-commit hooks to prevent secret commits
   - Set up rotation schedules
   - Conduct regular security audits

### Contact Information
- Security Lead: [TO BE FILLED]
- On-Call Engineer: [TO BE FILLED]
- Anthropic Support: support@anthropic.com

---

## Automation Recommendations

### Pre-commit Hook for Secret Detection
```bash
#!/bin/bash
# .git/hooks/pre-commit

# Check for API keys
if git diff --cached | grep -E "sk-ant-api03-|ANTHROPIC_API_KEY.*sk-"; then
    echo "❌ ERROR: Anthropic API key detected in commit"
    exit 1
fi

# Check for gateway tokens
if git diff --cached | grep -E "OPENCLAW_GATEWAY_TOKEN.*[a-f0-9]{64}"; then
    echo "❌ ERROR: Gateway token detected in commit"
    exit 1
fi

echo "✅ Secret scan passed"
exit 0
```

### Automated Key Rotation Script
Create `scripts/rotate-keys.sh`:
```bash
#!/bin/bash
set -e

echo "🔄 BYON Optimus Key Rotation"
echo "=============================="

# Backup old keys
BACKUP_DIR="keys/backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r keys/*.key "$BACKUP_DIR/" 2>/dev/null || true

# Generate new Ed25519 keys
node Byon_bot/scripts/generate-keys.js

# Update docker secrets
docker secret rm byon_private_key 2>/dev/null || true
docker secret create byon_private_key keys/private.key

echo "✅ Key rotation complete"
echo "📁 Backup location: $BACKUP_DIR"
```

---

## Compliance Notes

### GDPR Compliance
- API keys and tokens are considered personal data if they can identify users
- Implement data retention policies for audit logs
- Ensure audit logs can be exported/deleted per GDPR Article 17

### SOC 2 Compliance
- Document all key rotation events
- Maintain audit trail of secret access
- Implement least-privilege access control

---

## References

- [BYON Security Architecture](./BYON_SECURITY.md)
- [GDPR Compliance Guide](../GDPR_COMPLIANCE.md)
- [Anthropic API Security Best Practices](https://docs.anthropic.com/en/api/security)
- [Ed25519 Signature Scheme](https://ed25519.cr.yp.to/)
- [@noble/ed25519 Documentation](https://github.com/paulmillr/noble-ed25519)

---

**Document Status:** APPROVED FOR IMPLEMENTATION  
**Next Review Date:** 2026-03-02 (30 days)  
**Owner:** Security Team
