# Validation Rules - Agent Auditor

## Evidence Pack Validation

### 1. Structural Validation
```typescript
interface EvidenceValidation {
  hasValidId: boolean;
  hasTimestamp: boolean;
  hasTaskType: boolean;
  sourcesNotEmpty: boolean;
  factsHaveConfidence: boolean;
}

function validateEvidenceStructure(evidence: EvidencePack): ValidationResult {
  const errors: string[] = [];

  if (!isUUID(evidence.evidence_id)) {
    errors.push('Invalid evidence_id format');
  }

  if (!isISO8601(evidence.timestamp)) {
    errors.push('Invalid timestamp format');
  }

  if (!evidence.sources || evidence.sources.length === 0) {
    errors.push('No sources provided');
  }

  return { valid: errors.length === 0, errors };
}
```

### 2. Hash Verification
```typescript
function verifyEvidenceHash(evidence: EvidencePack): boolean {
  const { hash, ...content } = evidence;
  const calculatedHash = calculateHash(content);
  return hash === calculatedHash;
}
```

### 3. Source Trust Validation
```typescript
function validateSourceTrust(sources: Source[]): ValidationResult {
  const errors: string[] = [];

  for (const source of sources) {
    if (source.trust_level === 'external') {
      errors.push(`External source ${source.event_id} requires manual review`);
    }

    if (source.trust_level === 'unknown') {
      errors.push(`Unknown source ${source.event_id} - BLOCKED`);
    }
  }

  return { valid: errors.length === 0, errors };
}
```

## Plan Draft Validation

### 1. Action Whitelist Check
```typescript
const ALLOWED_ACTIONS = [
  'code_edit',
  'file_create',
  'file_delete',
  'test_run',
  'lint_run',
  'build_run'
] as const;

function validateActions(plan: PlanDraft): ValidationResult {
  const errors: string[] = [];

  for (const action of plan.actions) {
    if (!ALLOWED_ACTIONS.includes(action.type)) {
      errors.push(`Forbidden action type: ${action.type}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
```

### 2. Path Validation
```typescript
function validatePaths(plan: PlanDraft, projectRoot: string): ValidationResult {
  const errors: string[] = [];

  for (const action of plan.actions) {
    if (action.parameters.file_path) {
      const resolved = path.resolve(projectRoot, action.parameters.file_path);

      if (!resolved.startsWith(projectRoot)) {
        errors.push(`Path traversal detected: ${action.parameters.file_path}`);
      }

      if (isSensitivePath(resolved)) {
        errors.push(`Sensitive path: ${action.parameters.file_path}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
```

### 3. Risk Assessment
```typescript
function assessRisk(plan: PlanDraft): RiskLevel {
  let riskScore = 0;

  for (const action of plan.actions) {
    if (action.type === 'file_delete') riskScore += 3;
    if (action.type === 'file_create') riskScore += 1;
    if (action.type === 'code_edit') riskScore += 2;
  }

  if (plan.actions.length > 10) riskScore += 2;
  if (plan.estimated_iterations > 5) riskScore += 2;

  if (riskScore <= 3) return 'low';
  if (riskScore <= 7) return 'medium';
  return 'high';
}
```

## Cross-Reference Validation

```typescript
function validateCrossReferences(
  evidence: EvidencePack,
  plan: PlanDraft
): ValidationResult {
  const errors: string[] = [];

  // Plan must reference evidence
  if (plan.based_on_evidence !== evidence.evidence_id) {
    errors.push('Plan does not reference correct evidence');
  }

  // All planned files should be in evidence
  const analyzedPaths = new Set(
    evidence.codebase_context.files_analyzed.map(f => f.path)
  );

  for (const action of plan.actions) {
    if (action.parameters.file_path) {
      if (!analyzedPaths.has(action.parameters.file_path)) {
        errors.push(`File ${action.parameters.file_path} not in evidence`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
```
