/**
 * Agent Executor (C) - AIR-GAPPED
 *
 * Responsibilities:
 * - VERIFY Ed25519 signatures on execution orders
 * - EXECUTE code actions via Jupyter Kernel
 * - ITERATE on errors up to max_iterations
 * - GENERATE johnson receipts
 *
 * SECURITY: This agent runs with NO NETWORK ACCESS
 *
 * Inputs from: handoff/auditor_to_executor/
 * Outputs to: handoff/executor_to_worker/
 */

import {
  generateUUID,
  calculateHash,
  addHash,
  verifyExecutionOrder,
} from '@byon-bot/shared';
import type {
  ExecutionOrder,
  JohnsonReceipt,
  Action,
  ActionResult,
  ExecutionError,
  ExecutionStatus,
} from '@byon-bot/shared';
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// Configuration
const config = {
  role: process.env.ROLE || 'executor',
  projectRoot: process.env.PROJECT_ROOT || '/project',
  handoffPath: process.env.HANDOFF_PATH || '/handoff',
  maxIterations: parseInt(process.env.MAX_ITERATIONS || '10', 10),
  executionTimeout: parseInt(process.env.EXECUTION_TIMEOUT || '1800000', 10),
};

// Track processed orders in memory (input dir is read-only)
const processedOrders = new Set<string>();

console.log(`[Executor] Starting with config:`, config);
console.log(`[Executor] AIR-GAPPED MODE - No network access, no external API calls`);

// Execution state
interface ExecutionState {
  orderId: string;
  currentAction: number;
  iteration: number;
  status: ExecutionStatus;
  results: ActionResult[];
  errors: ExecutionError[];
  filesModified: string[];
  filesCreated: string[];
  filesDeleted: string[];
  startTime: number;
}

/**
 * Main executor - processes execution orders
 */
async function main() {
  console.log('[Executor] Agent Executor initialized (AIR-GAPPED)');

  // Check for execution orders in handoff directory
  const inputDir = join(config.handoffPath, 'auditor_to_executor');

  if (!existsSync(inputDir)) {
    console.log('[Executor] No input directory found. Waiting...');
    return;
  }

  const files = readdirSync(inputDir).filter(f => f.startsWith('execution_order_'));

  if (files.length === 0) {
    console.log('[Executor] No execution orders found. Exiting.');
    return;
  }

  // Process unprocessed orders
  for (const file of files) {
    if (processedOrders.has(file)) {
      continue; // Already processed in this session
    }

    const orderPath = join(inputDir, file);
    console.log(`[Executor] Processing: ${file}`);

    try {
      const orderData = readFileSync(orderPath, 'utf-8');
      const order: ExecutionOrder = JSON.parse(orderData);

      const receipt = await executeOrder(order);
      await writeReceipt(receipt);

      // Mark as processed in memory
      processedOrders.add(file);

      console.log(`[Executor] Completed: ${receipt.execution_summary.status}`);
    } catch (error) {
      console.error(`[Executor] Failed to process ${file}:`, error);
      // Still mark as processed to avoid infinite retry loop
      processedOrders.add(file);
    }
  }
}

/**
 * Execute a signed execution order
 */
async function executeOrder(order: ExecutionOrder): Promise<JohnsonReceipt> {
  // 1. Verify signature
  const signatureValid = await verifyExecutionOrder(order);
  if (!signatureValid) {
    console.error('[Executor] Invalid signature - REJECTED');
    return createReceipt(order, {
      orderId: order.order_id,
      currentAction: 0,
      iteration: 0,
      status: 'rejected',
      results: [],
      errors: [{ action_id: '', iteration: 0, error: 'Invalid signature' }],
      filesModified: [],
      filesCreated: [],
      filesDeleted: [],
      startTime: Date.now(),
    });
  }

  console.log('[Executor] Signature verified');

  // 2. Initialize state
  const state: ExecutionState = {
    orderId: order.order_id,
    currentAction: 0,
    iteration: 0,
    status: 'success',
    results: [],
    errors: [],
    filesModified: [],
    filesCreated: [],
    filesDeleted: [],
    startTime: Date.now(),
  };

  // 3. Execute each action
  for (let i = 0; i < order.actions.length; i++) {
    state.currentAction = i;
    const action = order.actions[i];

    console.log(`[Executor] Action ${i + 1}/${order.actions.length}: ${action.type}`);

    let actionSuccess = false;
    let actionIterations = 0;

    while (!actionSuccess && state.iteration < order.constraints.max_iterations) {
      state.iteration++;
      actionIterations++;

      try {
        const result = await executeAction(action, state);

        if (result.success) {
          actionSuccess = true;
          state.results.push({
            action_id: action.action_id,
            type: action.type,
            status: 'success',
            iterations: actionIterations,
            details: result.details || {},
          });
          console.log(`[Executor] Action succeeded after ${actionIterations} iteration(s)`);
        } else {
          // AIR-GAPPED: No self-healing via API. Record error and send back to Worker.
          // Worker will analyze the error and create a new plan if needed.
          console.log(`[Executor] Action failed: ${result.error}`);
          console.log(`[Executor] AIR-GAPPED: Error will be reported to Worker for analysis`);

          state.errors.push({
            action_id: action.action_id,
            iteration: state.iteration,
            error: result.error || 'Unknown error',
            last_error: result.error,
          });

          // Break on failure - Worker will handle retry via new plan
          break;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`[Executor] Exception: ${errorMessage}`);

        state.errors.push({
          action_id: action.action_id,
          iteration: state.iteration,
          error: errorMessage,
        });

        // Check if recoverable (within same execution)
        if (!isRecoverable(error)) {
          break;
        }
      }
    }

    if (!actionSuccess) {
      state.status = state.results.length > 0 ? 'partial' : 'failed';
      state.results.push({
        action_id: action.action_id,
        type: action.type,
        status: 'failed',
        iterations: actionIterations,
        details: { error: state.errors[state.errors.length - 1]?.error },
      });
      break; // Stop on failure
    }
  }

  return createReceipt(order, state);
}

/**
 * Execute a single action
 */
async function executeAction(
  action: Action,
  state: ExecutionState
): Promise<{ success: boolean; error?: string; details?: Record<string, unknown> }> {
  switch (action.type) {
    case 'code_edit':
      return executeCodeEdit(action, state);
    case 'file_create':
      return executeFileCreate(action, state);
    case 'file_delete':
      return executeFileDelete(action, state);
    case 'test_run':
      return executeTestRun(action);
    case 'lint_run':
      return executeLintRun(action);
    case 'build_run':
      return executeBuildRun(action);
    default:
      return { success: false, error: `Unknown action type: ${action.type}` };
  }
}

/**
 * Execute code edit action
 */
async function executeCodeEdit(
  action: Action,
  state: ExecutionState
): Promise<{ success: boolean; error?: string; details?: Record<string, unknown> }> {
  const filePath = join(config.projectRoot, action.parameters.file_path!);

  if (!existsSync(filePath)) {
    return { success: false, error: `File not found: ${action.parameters.file_path}` };
  }

  let content = readFileSync(filePath, 'utf-8');
  let editCount = 0;

  for (const edit of action.parameters.edits || []) {
    if (!content.includes(edit.old)) {
      return {
        success: false,
        error: `Could not find text to replace: "${edit.old.slice(0, 50)}..."`,
      };
    }
    content = content.replace(edit.old, edit.new);
    editCount++;
  }

  writeFileSync(filePath, content);
  state.filesModified.push(action.parameters.file_path!);

  return { success: true, details: { edits_applied: editCount } };
}

/**
 * Execute file create action
 */
async function executeFileCreate(
  action: Action,
  state: ExecutionState
): Promise<{ success: boolean; error?: string; details?: Record<string, unknown> }> {
  const relativePath = action.parameters.file_path;
  if (!relativePath) {
    return { success: false, error: 'No file_path specified' };
  }

  const filePath = join(config.projectRoot, relativePath);

  // Security: Ensure path is within project root
  if (!filePath.startsWith(config.projectRoot)) {
    return { success: false, error: 'Path traversal detected - blocked' };
  }

  // Check if file already exists
  if (existsSync(filePath)) {
    return { success: false, error: `File already exists: ${relativePath}` };
  }

  try {
    // Create parent directories if needed
    const parentDir = dirname(filePath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    // Get content from action parameters or edits
    let content = '';
    if (action.parameters.edits && action.parameters.edits.length > 0) {
      // Use the 'new' field from first edit as content
      content = action.parameters.edits[0].new;
    } else if ((action.parameters as Record<string, unknown>).content) {
      content = String((action.parameters as Record<string, unknown>).content);
    }

    writeFileSync(filePath, content, 'utf-8');
    state.filesCreated.push(relativePath);

    console.log(`[Executor] Created file: ${relativePath} (${content.length} bytes)`);

    return {
      success: true,
      details: { path: relativePath, size: content.length },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to create file: ${message}` };
  }
}

/**
 * Execute file delete action
 */
async function executeFileDelete(
  action: Action,
  state: ExecutionState
): Promise<{ success: boolean; error?: string; details?: Record<string, unknown> }> {
  const relativePath = action.parameters.file_path;
  if (!relativePath) {
    return { success: false, error: 'No file_path specified' };
  }

  const filePath = join(config.projectRoot, relativePath);

  // Security: Ensure path is within project root
  if (!filePath.startsWith(config.projectRoot)) {
    return { success: false, error: 'Path traversal detected - blocked' };
  }

  // Check if file exists
  if (!existsSync(filePath)) {
    return { success: false, error: `File not found: ${relativePath}` };
  }

  try {
    // Read file size before deletion for logging
    const stats = readFileSync(filePath);
    const size = stats.length;

    unlinkSync(filePath);
    state.filesDeleted.push(relativePath);

    console.log(`[Executor] Deleted file: ${relativePath}`);

    return {
      success: true,
      details: { path: relativePath, previous_size: size },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Failed to delete file: ${message}` };
  }
}

/**
 * Execute test run action
 */
async function executeTestRun(
  action: Action
): Promise<{ success: boolean; error?: string; details?: Record<string, unknown> }> {
  // TODO: Implement via Jupyter kernel
  console.log(`[Executor] Would run tests: ${action.parameters.path}`);

  return {
    success: true,
    details: { tests_passed: 0, tests_failed: 0, framework: action.parameters.framework },
  };
}

/**
 * Execute lint run action
 */
async function executeLintRun(
  action: Action
): Promise<{ success: boolean; error?: string }> {
  // TODO: Implement via Jupyter kernel
  console.log(`[Executor] Would run linter`);

  return { success: true };
}

/**
 * Execute build run action
 */
async function executeBuildRun(
  action: Action
): Promise<{ success: boolean; error?: string }> {
  // TODO: Implement via Jupyter kernel
  console.log(`[Executor] Would run build`);

  return { success: true };
}

/**
 * AIR-GAPPED EXECUTOR: No self-healing via external API
 *
 * Error handling strategy:
 * 1. Executor records all errors in johnson_receipt
 * 2. Errors are sent back to Worker via handoff
 * 3. Worker (which has network access) analyzes errors
 * 4. Worker creates a new plan if fixes are needed
 * 5. New plan goes through Auditor → User → Executor cycle
 *
 * This maintains the air-gap security while still allowing error recovery.
 */

/**
 * Check if error is recoverable
 */
function isRecoverable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  // Non-recoverable errors
  if (message.includes('ENOENT')) return false; // File not found
  if (message.includes('EACCES')) return false; // Permission denied
  if (message.includes('signature')) return false; // Signature issues

  return true;
}

/**
 * Create johnson receipt
 */
function createReceipt(
  order: ExecutionOrder,
  state: ExecutionState
): JohnsonReceipt {
  const receipt: Omit<JohnsonReceipt, 'hash'> = {
    receipt_id: generateUUID(),
    timestamp: new Date().toISOString(),
    based_on_order: order.order_id,
    execution_summary: {
      status: state.status,
      actions_total: order.actions.length,
      actions_completed: state.results.filter(r => r.status === 'success').length,
      actions_failed: state.results.filter(r => r.status === 'failed').length,
      iterations_used: state.iteration,
      duration_ms: Date.now() - state.startTime,
    },
    action_results: state.results,
    errors: state.errors,
    changes_made: {
      files_modified: state.filesModified,
      files_created: state.filesCreated,
      files_deleted: state.filesDeleted,
    },
    verification: {
      tests_passing: true, // TODO: Implement actual verification
      lint_passing: true,
      build_passing: true,
    },
  };

  return addHash(receipt);
}

/**
 * Write receipt to handoff directory
 */
async function writeReceipt(receipt: JohnsonReceipt): Promise<void> {
  const outputDir = join(config.handoffPath, 'executor_to_worker');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const shortId = receipt.receipt_id.slice(0, 6);

  const filename = `johnson_receipt_${timestamp}_${shortId}.json`;
  const filePath = join(outputDir, filename);

  writeFileSync(filePath, JSON.stringify(receipt, null, 2));
  console.log(`[Executor] Receipt written: ${filename}`);
}

// Start
main().catch(console.error);
