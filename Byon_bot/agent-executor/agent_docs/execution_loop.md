# Execution Loop - Agent Executor

## Loop Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    EXECUTION LOOP                            │
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │  VERIFY  │───▶│ EXECUTE  │───▶│   TEST   │              │
│  │  ORDER   │    │  ACTION  │    │  RESULT  │              │
│  └──────────┘    └──────────┘    └────┬─────┘              │
│                                       │                     │
│                        ┌──────────────┴──────────────┐     │
│                        ▼                             ▼     │
│                   ┌─────────┐                  ┌─────────┐ │
│                   │  PASS   │                  │  FAIL   │ │
│                   └────┬────┘                  └────┬────┘ │
│                        │                            │      │
│                        ▼                            ▼      │
│                 ┌────────────┐              ┌────────────┐ │
│                 │  RECEIPT   │              │  ANALYZE   │ │
│                 │  SUCCESS   │              │   ERROR    │ │
│                 └────────────┘              └─────┬──────┘ │
│                                                   │        │
│                                      ┌────────────┴───┐    │
│                                      │ iteration < max│    │
│                                      └────────┬───────┘    │
│                                               │            │
│                               ┌───────────────┴──────────┐ │
│                               ▼                          ▼ │
│                         ┌──────────┐              ┌───────┐│
│                         │GENERATE  │              │RECEIPT││
│                         │   FIX    │──loop──▶     │ FAIL  ││
│                         └──────────┘              └───────┘│
└─────────────────────────────────────────────────────────────┘
```

## Implementation

```typescript
interface ExecutionState {
  orderId: string;
  currentAction: number;
  iteration: number;
  status: 'running' | 'success' | 'failed' | 'timeout';
  results: ActionResult[];
  errors: ExecutionError[];
}

async function executeLoop(
  order: SignedExecutionOrder
): Promise<JohnsonReceipt> {
  // 1. Verify signature
  if (!await verifySignature(order)) {
    return createReceipt(order, 'rejected', 'Invalid signature');
  }

  const state: ExecutionState = {
    orderId: order.order_id,
    currentAction: 0,
    iteration: 0,
    status: 'running',
    results: [],
    errors: []
  };

  // 2. Execute each action
  for (const action of order.actions) {
    state.currentAction++;

    while (state.iteration < order.constraints.max_iterations) {
      state.iteration++;

      try {
        const result = await executeAction(action);

        if (result.success) {
          state.results.push(result);
          break; // Move to next action
        }

        // Test failed - analyze and fix
        const analysis = await analyzeError(result.error);
        const fix = await generateFix(analysis, action);

        if (!fix) {
          state.status = 'failed';
          state.errors.push({
            action: action.action_id,
            iteration: state.iteration,
            error: 'Could not generate fix'
          });
          break;
        }

        // Apply fix and retry
        await applyFix(fix);

      } catch (error) {
        state.errors.push({
          action: action.action_id,
          iteration: state.iteration,
          error: error.message
        });

        if (!isRecoverable(error)) {
          state.status = 'failed';
          break;
        }
      }
    }

    if (state.iteration >= order.constraints.max_iterations) {
      state.status = 'failed';
      state.errors.push({
        action: action.action_id,
        iteration: state.iteration,
        error: 'Max iterations reached'
      });
      break;
    }
  }

  // 3. Final status
  if (state.status === 'running') {
    state.status = 'success';
  }

  return createReceipt(order, state);
}
```

## Action Execution

```typescript
async function executeAction(action: Action): Promise<ActionResult> {
  switch (action.type) {
    case 'code_edit':
      return executeCodeEdit(action.parameters);

    case 'file_create':
      return executeFileCreate(action.parameters);

    case 'file_delete':
      return executeFileDelete(action.parameters);

    case 'test_run':
      return executeTestRun(action.parameters);

    case 'lint_run':
      return executeLintRun(action.parameters);

    case 'build_run':
      return executeBuildRun(action.parameters);

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}
```

## Error Analysis (with Claude)

```typescript
async function analyzeError(error: string): Promise<ErrorAnalysis> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: `You are a code error analyzer. Analyze the error and suggest a fix.
             Be specific and provide exact code changes needed.
             Do not suggest network operations or external dependencies.`,
    messages: [{
      role: 'user',
      content: `Error:\n${error}\n\nAnalyze this error and suggest a fix.`
    }]
  });

  return parseAnalysis(response.content);
}
```

## Timeout Handling

```typescript
async function executeWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Execution timeout')), timeoutMs)
    )
  ]);
}
```
