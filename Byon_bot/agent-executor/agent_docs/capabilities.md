# Capabilities - Agent Executor

## Permissions Matrix

| Capability | Allowed | Notes |
|------------|---------|-------|
| READ handoff/auditor_to_executor/ | YES | Signed execution orders |
| READ project files | YES | Within project root |
| WRITE project files | YES | Within project root |
| WRITE handoff/executor_to_worker/ | YES | Johnson receipts |
| EXECUTE code | YES | Via Jupyter Kernel only |
| ACCESS network | **NO** | AIR-GAPPED |
| ACCESS system | NO | Sandboxed |

## AIR-GAP Enforcement

```typescript
// Docker network mode
const NETWORK_MODE = 'none';

// Forbidden operations
const FORBIDDEN = [
  'fetch', 'axios', 'http', 'https',
  'net.connect', 'socket',
  'child_process.exec', 'child_process.spawn',
  'fs.writeFile outside project'
];
```

## Detailed Capabilities

### 1. VERIFY_SIGNATURE - Order Authentication
```typescript
interface VerifyCapabilities {
  verify_ed25519_signature: true;
  check_order_expiry: true;
  validate_constraints: true;
}
```

### 2. EXECUTE - Code Actions
```typescript
interface ExecuteCapabilities {
  code_edit: true;
  file_create: true;
  file_delete: true;
  run_tests: true;
  run_linter: true;
  run_build: true;
}
```

### 3. KERNEL - Jupyter Operations
```typescript
interface KernelCapabilities {
  execute_cell: true;
  get_output: true;
  interrupt_kernel: true;
  restart_kernel: true;
  install_packages: false; // No network
}
```

### 4. ITERATE - Autonomous Loop
```typescript
interface IterateCapabilities {
  analyze_errors: true;
  generate_fix: true;
  re_execute: true;
  max_iterations: 10;
}
```

## Constraints (from execution_order)

```typescript
interface ExecutionConstraints {
  max_iterations: number;      // Default: 10
  timeout_minutes: number;     // Default: 30
  memory_limit_mb: number;     // Default: 1024
  disk_limit_mb: number;       // Default: 100
  network_allowed: false;      // Always false
}
```

## Anti-Vibe Rules

1. **No assumptions** - Only execute what's in the order
2. **No improvisation** - Don't add "helpful" features
3. **No shortcuts** - Follow exact edit instructions
4. **No network** - Even if it seems helpful
5. **Stop on confusion** - Report in receipt, don't guess
