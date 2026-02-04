# Kernel Usage - Agent Executor

## Jupyter Kernel Integration

The Executor uses Jupyter kernels for safe code execution in an isolated environment.

## Architecture

```
┌─────────────────────────────────────────┐
│           Agent Executor                │
│  ┌─────────────────────────────────┐   │
│  │      Kernel Manager              │   │
│  │  ┌───────────┐  ┌───────────┐   │   │
│  │  │  Python   │  │ TypeScript│   │   │
│  │  │  Kernel   │  │  Kernel   │   │   │
│  │  └─────┬─────┘  └─────┬─────┘   │   │
│  │        │              │          │   │
│  │        └──────┬───────┘          │   │
│  │               │                  │   │
│  │        ┌──────▼──────┐          │   │
│  │        │   ZeroMQ    │          │   │
│  │        │   (local)   │          │   │
│  │        └─────────────┘          │   │
│  └─────────────────────────────────┘   │
│                                         │
│  Network: NONE (air-gapped)            │
└─────────────────────────────────────────┘
```

## Kernel Manager

```typescript
import { KernelManager, KernelConnection } from '@jupyterlab/services';

class ExecutorKernelManager {
  private kernels: Map<string, KernelConnection> = new Map();

  async startKernel(language: 'python' | 'typescript'): Promise<string> {
    const kernelName = language === 'python' ? 'python3' : 'tslab';

    const kernel = await KernelManager.startNew({
      name: kernelName,
      serverSettings: {
        baseUrl: 'http://localhost:8888',
        wsUrl: 'ws://localhost:8888'
      }
    });

    this.kernels.set(kernel.id, kernel);
    return kernel.id;
  }

  async executeCode(
    kernelId: string,
    code: string
  ): Promise<ExecutionResult> {
    const kernel = this.kernels.get(kernelId);
    if (!kernel) throw new Error('Kernel not found');

    const future = kernel.requestExecute({ code });

    return new Promise((resolve, reject) => {
      let output = '';
      let error = '';

      future.onIOPub = (msg) => {
        if (msg.header.msg_type === 'stream') {
          output += msg.content.text;
        } else if (msg.header.msg_type === 'error') {
          error = msg.content.traceback.join('\n');
        } else if (msg.header.msg_type === 'execute_result') {
          output += msg.content.data['text/plain'];
        }
      };

      future.done.then(() => {
        resolve({
          success: !error,
          output,
          error: error || undefined
        });
      }).catch(reject);
    });
  }

  async shutdownKernel(kernelId: string): Promise<void> {
    const kernel = this.kernels.get(kernelId);
    if (kernel) {
      await kernel.shutdown();
      this.kernels.delete(kernelId);
    }
  }
}
```

## Code Execution Patterns

### Running Tests (Python)
```typescript
async function runPythonTests(
  kernel: ExecutorKernelManager,
  testPath: string
): Promise<TestResult> {
  const code = `
import subprocess
import json

result = subprocess.run(
    ['python', '-m', 'pytest', '${testPath}', '--json-report', '--json-report-file=/tmp/report.json'],
    capture_output=True,
    text=True,
    timeout=300
)

with open('/tmp/report.json') as f:
    report = json.load(f)

print(json.dumps({
    'passed': report['summary']['passed'],
    'failed': report['summary']['failed'],
    'errors': report['summary'].get('error', 0),
    'output': result.stdout,
    'error_output': result.stderr
}))
`;

  const result = await kernel.executeCode(kernelId, code);
  return JSON.parse(result.output);
}
```

### Running Tests (TypeScript/Vitest)
```typescript
async function runTypeScriptTests(
  kernel: ExecutorKernelManager,
  testPath: string
): Promise<TestResult> {
  const code = `
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const { stdout, stderr } = await execAsync(
  'npx vitest run ${testPath} --reporter=json',
  { timeout: 300000 }
);

console.log(stdout);
`;

  const result = await kernel.executeCode(kernelId, code);
  return parseVitestOutput(result.output);
}
```

### Applying Code Edits
```typescript
async function applyCodeEdit(
  kernel: ExecutorKernelManager,
  edit: CodeEdit
): Promise<void> {
  const code = `
import re

with open('${edit.file_path}', 'r') as f:
    content = f.read()

# Apply edit
old_text = '''${escapeForPython(edit.old)}'''
new_text = '''${escapeForPython(edit.new)}'''

if old_text not in content:
    raise ValueError(f"Could not find text to replace in {edit.file_path}")

content = content.replace(old_text, new_text, 1)

with open('${edit.file_path}', 'w') as f:
    f.write(content)

print(f"Successfully edited {edit.file_path}")
`;

  await kernel.executeCode(kernelId, code);
}
```

## Safety Constraints

```typescript
// Pre-execution checks
function validateCode(code: string): ValidationResult {
  const forbidden = [
    /import\s+requests/,
    /import\s+urllib/,
    /import\s+socket/,
    /import\s+http/,
    /fetch\(/,
    /axios/,
    /subprocess.*curl/,
    /subprocess.*wget/,
    /os\.system.*curl/,
  ];

  for (const pattern of forbidden) {
    if (pattern.test(code)) {
      return {
        valid: false,
        error: `Forbidden pattern detected: ${pattern}`
      };
    }
  }

  return { valid: true };
}
```

## Kernel Lifecycle

```typescript
async function executeWithKernel(
  actions: Action[],
  language: 'python' | 'typescript'
): Promise<ExecutionResult[]> {
  const manager = new ExecutorKernelManager();
  const kernelId = await manager.startKernel(language);

  try {
    const results: ExecutionResult[] = [];

    for (const action of actions) {
      const result = await executeActionInKernel(manager, kernelId, action);
      results.push(result);

      if (!result.success) {
        break; // Stop on first failure
      }
    }

    return results;
  } finally {
    await manager.shutdownKernel(kernelId);
  }
}
```
