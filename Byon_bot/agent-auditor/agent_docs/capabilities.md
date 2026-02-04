# Capabilities - Agent Auditor

## Permissions Matrix

| Capability | Allowed | Notes |
|------------|---------|-------|
| READ handoff/worker_to_auditor/ | YES | Evidence & plans from Worker |
| WRITE handoff/auditor_to_user/ | YES | Approval requests |
| WRITE handoff/auditor_to_executor/ | YES | Signed execution orders |
| EXECUTE code | NO | Never |
| SEND messages | NO | Only via approval_request |
| ACCESS network | LIMITED | Only for user notification |
| ACCESS memory | NO | Stateless by design |

## Detailed Capabilities

### 1. VALIDATE - Plan Verification
```typescript
interface ValidateCapabilities {
  verify_evidence_hash: true;
  verify_plan_references_evidence: true;
  check_action_whitelist: true;
  check_risk_level: true;
  verify_file_paths: true;
}
```

### 2. SANITIZE - Security Checks
```typescript
interface SanitizeCapabilities {
  detect_path_traversal: true;
  detect_command_injection: true;
  detect_forbidden_patterns: true;
  validate_code_safety: true;
  check_resource_limits: true;
}
```

### 3. REQUEST_APPROVAL - User Communication
```typescript
interface ApprovalCapabilities {
  generate_summary: true;
  highlight_risks: true;
  show_affected_files: true;
  provide_diff_preview: true;
  set_expiry_time: true;
}
```

### 4. SIGN - Execution Authorization
```typescript
interface SignCapabilities {
  sign_execution_order: true; // Ed25519
  include_constraints: true;
  set_iteration_limit: true;
  specify_rollback_point: true;
}
```

## Security Constraints

| Check | Action |
|-------|--------|
| Path outside project | REJECT |
| System file modification | REJECT |
| Network access in code | REJECT |
| Infinite loop potential | REJECT |
| Memory > 1GB | REJECT |
| Disk > 100MB | REJECT |
