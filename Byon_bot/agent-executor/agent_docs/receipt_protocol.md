# Receipt Protocol - Agent Executor

## Output Directory
```
handoff/executor_to_worker/
```

## Johnson Receipt Format

The "Johnson Receipt" is the feedback mechanism from Executor back to Worker, named after the verification system described in the protocol.

### johnson_receipt.json
```json
{
  "receipt_id": "uuid-v4",
  "timestamp": "ISO-8601",
  "based_on_order": "order_id",

  "execution_summary": {
    "status": "success | partial | failed | rejected",
    "actions_total": 3,
    "actions_completed": 3,
    "actions_failed": 0,
    "iterations_used": 2,
    "duration_ms": 45000
  },

  "action_results": [
    {
      "action_id": "uuid",
      "type": "code_edit",
      "status": "success",
      "iterations": 1,
      "details": {
        "file_path": "src/utils/validation.ts",
        "lines_changed": 5
      }
    },
    {
      "action_id": "uuid",
      "type": "test_run",
      "status": "success",
      "iterations": 1,
      "details": {
        "tests_passed": 15,
        "tests_failed": 0,
        "coverage": "87%"
      }
    }
  ],

  "errors": [],

  "changes_made": {
    "files_modified": ["src/utils/validation.ts"],
    "files_created": [],
    "files_deleted": [],
    "git_diff_ref": "abc123..def456"
  },

  "verification": {
    "tests_passing": true,
    "lint_passing": true,
    "build_passing": true
  },

  "hash": "sha256:..."
}
```

## Receipt Status Types

### SUCCESS
All actions completed, tests pass.
```json
{
  "status": "success",
  "actions_completed": 3,
  "actions_failed": 0
}
```

### PARTIAL
Some actions completed, stopped due to error.
```json
{
  "status": "partial",
  "actions_completed": 2,
  "actions_failed": 1,
  "errors": [
    {
      "action_id": "uuid",
      "iteration": 10,
      "error": "Max iterations reached",
      "last_error": "TypeError: cannot read property..."
    }
  ]
}
```

### FAILED
Could not complete any meaningful work.
```json
{
  "status": "failed",
  "actions_completed": 0,
  "actions_failed": 1,
  "errors": [
    {
      "action_id": "uuid",
      "iteration": 1,
      "error": "File not found: src/missing.ts"
    }
  ]
}
```

### REJECTED
Order rejected before execution (invalid signature, expired, etc.)
```json
{
  "status": "rejected",
  "reason": "Invalid Ed25519 signature",
  "actions_completed": 0,
  "actions_failed": 0
}
```

## Receipt Generation

```typescript
function createReceipt(
  order: SignedExecutionOrder,
  state: ExecutionState
): JohnsonReceipt {
  const receipt: JohnsonReceipt = {
    receipt_id: generateUUID(),
    timestamp: new Date().toISOString(),
    based_on_order: order.order_id,

    execution_summary: {
      status: state.status,
      actions_total: order.actions.length,
      actions_completed: state.results.filter(r => r.success).length,
      actions_failed: state.results.filter(r => !r.success).length,
      iterations_used: state.iteration,
      duration_ms: Date.now() - state.startTime
    },

    action_results: state.results.map(r => ({
      action_id: r.actionId,
      type: r.type,
      status: r.success ? 'success' : 'failed',
      iterations: r.iterations,
      details: r.details
    })),

    errors: state.errors,

    changes_made: {
      files_modified: state.filesModified,
      files_created: state.filesCreated,
      files_deleted: state.filesDeleted,
      git_diff_ref: state.gitDiffRef
    },

    verification: {
      tests_passing: state.testsPassing,
      lint_passing: state.lintPassing,
      build_passing: state.buildPassing
    }
  };

  receipt.hash = calculateHash(receipt);
  return receipt;
}
```

## Worker Verification

The Worker uses the receipt to verify execution:

```typescript
async function verifyReceipt(
  receipt: JohnsonReceipt,
  originalPlan: PlanDraft
): Promise<VerificationResult> {
  const issues: string[] = [];

  // 1. Check hash
  const { hash, ...content } = receipt;
  if (hash !== calculateHash(content)) {
    issues.push('Receipt hash mismatch');
  }

  // 2. Compare actions
  if (receipt.execution_summary.actions_total !== originalPlan.actions.length) {
    issues.push('Action count mismatch');
  }

  // 3. Check success rate
  const successRate = receipt.execution_summary.actions_completed /
                      receipt.execution_summary.actions_total;

  if (successRate < 1 && receipt.execution_summary.status === 'success') {
    issues.push('Status marked success but not all actions completed');
  }

  // 4. Verify changes match plan
  for (const action of originalPlan.actions) {
    if (action.type === 'code_edit') {
      const modified = receipt.changes_made.files_modified.includes(
        action.parameters.file_path
      );
      if (!modified && receipt.execution_summary.status === 'success') {
        issues.push(`Expected file ${action.parameters.file_path} to be modified`);
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    receipt
  };
}
```

## Naming Convention
```
johnson_receipt_<timestamp>_<short_id>.json
```

Example:
```
johnson_receipt_2026-01-31T22-45-00_x1y2z3.json
```
