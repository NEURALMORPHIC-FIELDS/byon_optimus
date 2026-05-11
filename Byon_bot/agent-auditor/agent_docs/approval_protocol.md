# Approval Protocol - Agent Auditor

## Output Directory
```
handoff/auditor_to_user/
handoff/auditor_to_executor/
```

## Output Files

### 1. approval_request.json (to User)
```json
{
  "request_id": "uuid-v4",
  "timestamp": "ISO-8601",
  "based_on_plan": "plan_id",

  "summary": {
    "intent": "add_email_validation",
    "description": "Add email validation function to utils",
    "affected_files": ["src/utils/validation.ts"],
    "risk_level": "low"
  },

  "actions_preview": [
    {
      "action_id": "uuid",
      "type": "code_edit",
      "file": "src/utils/validation.ts",
      "description": "Add validateEmail function",
      "diff_preview": "+ export const validateEmail = ..."
    }
  ],

  "security_checks": {
    "path_traversal": "PASS",
    "command_injection": "PASS",
    "resource_limits": "PASS"
  },

  "requires_approval": true,
  "expires_at": "ISO-8601 (+24h)",

  "user_options": {
    "approve": "Sign and send to executor",
    "reject": "Discard plan",
    "modify": "Request changes"
  },

  "hash": "sha256:..."
}
```

### 2. execution_order.json (to Executor, after approval)
```json
{
  "order_id": "uuid-v4",
  "timestamp": "ISO-8601",
  "based_on_plan": "plan_id",
  "approved_by": "user_id",
  "approved_at": "ISO-8601",

  "actions": [
    {
      "action_id": "uuid",
      "type": "code_edit",
      "parameters": {
        "file_path": "src/utils/validation.ts",
        "edits": [
          {
            "old": "// end of validation",
            "new": "export const validateEmail = (email: string) => {\n  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);\n};\n// end of validation"
          }
        ]
      }
    }
  ],

  "constraints": {
    "max_iterations": 10,
    "timeout_minutes": 30,
    "memory_limit_mb": 1024,
    "disk_limit_mb": 100,
    "network_allowed": false
  },

  "rollback": {
    "enabled": true,
    "git_ref": "HEAD"
  },

  "signature": {
    "algorithm": "Ed25519",
    "public_key": "base64...",
    "signature": "base64..."
  },

  "hash": "sha256:..."
}
```

## Signing Process

```typescript
import { sign, getPublicKey } from '@noble/ed25519';

async function signExecutionOrder(
  order: ExecutionOrder,
  privateKey: Uint8Array
): Promise<SignedExecutionOrder> {
  const { signature: _, ...content } = order;
  const message = JSON.stringify(content, Object.keys(content).sort());
  const messageBytes = new TextEncoder().encode(message);

  const sig = await sign(messageBytes, privateKey);
  const pubKey = await getPublicKey(privateKey);

  return {
    ...order,
    signature: {
      algorithm: 'Ed25519',
      public_key: Buffer.from(pubKey).toString('base64'),
      signature: Buffer.from(sig).toString('base64')
    }
  };
}
```

## Approval Flow

```
1. Auditor receives evidence_pack + plan_draft from Worker
   ↓
2. Auditor validates both (structure, hash, security)
   ↓
3. IF valid → Generate approval_request.json
   ↓
4. Send to user via configured channel
   ↓
5. User reviews and responds (approve/reject/modify)
   ↓
6. IF approved:
   - Sign execution_order with Ed25519
   - Write to auditor_to_executor/
   ↓
7. IF rejected:
   - Log rejection reason
   - Notify Worker (optional)
   ↓
8. IF modify:
   - Send modification request to Worker
   - Restart from step 1
```

## Naming Convention
```
approval_request_<timestamp>_<short_id>.json
execution_order_<timestamp>_<short_id>.json
```
