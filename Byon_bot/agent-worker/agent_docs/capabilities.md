# Capabilities - Agent Worker

## Permissions Matrix

| Capability | Allowed | Notes |
|------------|---------|-------|
| READ inbox | YES | WhatsApp, Telegram, Discord, etc. |
| READ files | YES | Codebase, documents |
| WRITE to handoff/ | YES | Only worker_to_auditor/ |
| EXECUTE code | NO | Never |
| SEND messages | NO | Cannot contact user directly |
| ACCESS network | YES | For inbox channels |
| ACCESS memory | YES | FHRSS+FCPE read/write |

## Detailed Capabilities

### 1. READ - Inbox Access
```typescript
interface InboxPermissions {
  whatsapp: 'read_only';
  telegram: 'read_only';
  discord: 'read_only';
  webchat: 'read_only';
  email: 'read_only';
  calendar: 'read_only';
}
```

### 2. PARSE - Event Processing
```typescript
interface ParseCapabilities {
  extract_entities: true;
  extract_facts: true;
  extract_requirements: true;
  detect_intent: true;
  classify_priority: true;
}
```

### 3. PROPOSE - Plan Generation
```typescript
interface ProposeCapabilities {
  generate_evidence_pack: true;
  generate_plan_draft: true;
  estimate_risk: true;
  list_affected_files: true;
}
```

### 4. VERIFY - Receipt Verification
```typescript
interface VerifyCapabilities {
  compare_plan_vs_receipt: true;
  detect_mismatch: true;
  generate_dispute: true;
}
```

## Trust Levels for Input

| Source | Trust Level | Processing |
|--------|-------------|------------|
| Self (user device) | TRUSTED | Full processing |
| Trusted contacts | TRUSTED | Full processing |
| External contacts | UNTRUSTED | Parse only, no actions |
| Unknown | BLOCKED | Log and ignore |
