# Handoff Protocol - Agent Worker

## Output Directory
```
handoff/worker_to_auditor/
```

## Output Files

### 1. evidence_pack.json
Contains extracted facts and relevant context.

```json
{
  "evidence_id": "uuid-v4",
  "timestamp": "ISO-8601",
  "task_type": "coding | general | calendar | message",

  "sources": [
    {
      "event_id": "uuid",
      "source": "whatsapp | telegram | email | calendar | file",
      "timestamp": "ISO-8601",
      "trust_level": "self | trusted | external",
      "payload_ref": "sha256:..."
    }
  ],

  "extracted_facts": [
    {
      "fact_id": "uuid",
      "fact": "User wants to add validation to form",
      "source_event": "uuid",
      "confidence": 0.92
    }
  ],

  "raw_quotes": [
    {
      "quote": "Can you add email validation?",
      "source_event": "uuid"
    }
  ],

  "codebase_context": {
    "files_analyzed": [
      {
        "path": "src/components/Form.tsx",
        "relevant_sections": [
          {
            "lines": [45, 78],
            "content": "const handleSubmit = ...",
            "reason": "form submission logic"
          }
        ]
      }
    ],
    "dependencies": ["zod", "react-hook-form"],
    "language": "typescript",
    "framework": "react"
  },

  "forbidden_data_present": false,
  "hash": "sha256:..."
}
```

### 2. plan_draft.json
Proposed actions for execution.

```json
{
  "plan_id": "uuid-v4",
  "timestamp": "ISO-8601",
  "based_on_evidence": "evidence_id",
  "intent": "add_email_validation",

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
      },
      "expected_outcome": "New validateEmail function added"
    },
    {
      "action_id": "uuid",
      "type": "test_run",
      "parameters": {
        "framework": "vitest",
        "path": "src/utils/__tests__/validation.test.ts"
      },
      "expected_outcome": "All tests pass"
    }
  ],

  "risk_level": "low | medium | high",
  "rollback_possible": true,
  "estimated_iterations": 2,

  "hash": "sha256:..."
}
```

## Naming Convention
```
evidence_pack_<timestamp>_<short_id>.json
plan_draft_<timestamp>_<short_id>.json
```

Example:
```
evidence_pack_2026-01-31T22-30-00_a1b2c3.json
plan_draft_2026-01-31T22-30-00_a1b2c3.json
```

## Hash Calculation
```typescript
import { createHash } from 'crypto';

function calculateHash(obj: object): string {
  const canonical = JSON.stringify(obj, Object.keys(obj).sort());
  return createHash('sha256').update(canonical).digest('hex');
}
```
