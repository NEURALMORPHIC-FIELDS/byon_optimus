/**
 * Approve Command - Review and approve execution orders
 *
 * This is the USER's critical checkpoint in the MACP protocol.
 * No code executes without explicit user approval.
 */

import { readdir, readFile, writeFile, rename } from 'fs/promises';
import { join } from 'path';
import { watch } from 'chokidar';
import chalk from 'chalk';
import inquirer from 'inquirer';
import Table from 'cli-table3';
import ora from 'ora';
import type {
  ApprovalRequest,
  ExecutionOrder,
  Action,
} from '@byon-bot/shared';

interface ApproveOptions {
  auto?: boolean;
  watch?: boolean;
  path: string;
}

const APPROVAL_DIR = 'auditor_to_user';
const APPROVED_DIR = 'auditor_to_executor';

/**
 * Main approve command
 */
export async function approveCommand(options: ApproveOptions): Promise<void> {
  const handoffPath = options.path;
  const approvalPath = join(handoffPath, APPROVAL_DIR);
  const approvedPath = join(handoffPath, APPROVED_DIR);

  console.log(chalk.blue('\n📋 Approval Interface'));
  console.log(chalk.gray(`   Watching: ${approvalPath}`));
  console.log(chalk.gray(`   Output: ${approvedPath}\n`));

  if (options.watch) {
    await watchForApprovals(approvalPath, approvedPath, options.auto);
  } else {
    await processExistingApprovals(approvalPath, approvedPath, options.auto);
  }
}

/**
 * Process existing approval requests
 */
async function processExistingApprovals(
  approvalPath: string,
  approvedPath: string,
  autoApprove?: boolean
): Promise<void> {
  const spinner = ora('Scanning for approval requests...').start();

  try {
    const files = await readdir(approvalPath);
    const approvalFiles = files.filter(
      (f) => f.startsWith('approval_request_') && f.endsWith('.json')
    );

    spinner.stop();

    if (approvalFiles.length === 0) {
      console.log(chalk.yellow('No pending approval requests.\n'));
      return;
    }

    console.log(chalk.green(`Found ${approvalFiles.length} pending request(s).\n`));

    for (const file of approvalFiles) {
      await processApprovalFile(join(approvalPath, file), approvedPath, autoApprove);
    }
  } catch (error) {
    spinner.fail('Failed to scan approval directory');
    console.error(chalk.red(`Error: ${error}`));
  }
}

/**
 * Watch for new approval requests
 */
async function watchForApprovals(
  approvalPath: string,
  approvedPath: string,
  autoApprove?: boolean
): Promise<void> {
  console.log(chalk.cyan('👀 Watching for approval requests... (Ctrl+C to exit)\n'));

  // Process existing first
  await processExistingApprovals(approvalPath, approvedPath, autoApprove);

  // Watch for new files
  const watcher = watch(join(approvalPath, 'approval_request_*.json'), {
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on('add', async (filepath) => {
    console.log(chalk.cyan(`\n🔔 New approval request: ${filepath}`));
    await processApprovalFile(filepath, approvedPath, autoApprove);
  });

  // Keep alive
  await new Promise(() => {});
}

/**
 * Process a single approval file
 */
async function processApprovalFile(
  filepath: string,
  approvedPath: string,
  autoApprove?: boolean
): Promise<void> {
  try {
    const content = await readFile(filepath, 'utf-8');
    const request: ApprovalRequest = JSON.parse(content);

    // Display the request
    displayApprovalRequest(request);

    // Check for auto-approve
    if (autoApprove && request.summary.risk_level === 'low') {
      console.log(chalk.green('✅ Auto-approved (low risk)\n'));
      await approveRequest(request, filepath, approvedPath, 'auto-approved');
      return;
    }

    // Get user decision
    const decision = await getUserDecision(request);

    if (decision.approved) {
      await approveRequest(request, filepath, approvedPath, decision.notes);
      console.log(chalk.green('✅ Request approved\n'));
    } else {
      await rejectRequest(request, filepath, decision.notes);
      console.log(chalk.red('❌ Request rejected\n'));
    }
  } catch (error) {
    console.error(chalk.red(`Error processing ${filepath}: ${error}`));
  }
}

/**
 * Display approval request details
 */
function displayApprovalRequest(request: ApprovalRequest): void {
  console.log(chalk.bold('\n═══════════════════════════════════════════════════════'));
  console.log(chalk.bold.white(`📄 Approval Request: ${request.request_id}`));
  console.log(chalk.bold('═══════════════════════════════════════════════════════\n'));

  // Summary
  console.log(chalk.yellow('📝 Intent:'));
  console.log(`   ${request.summary.intent}\n`);
  console.log(chalk.yellow('📋 Description:'));
  console.log(`   ${request.summary.description}\n`);

  // Plan Reference
  console.log(chalk.yellow('📎 References:'));
  console.log(`   Plan ID: ${request.based_on_plan}`);
  console.log(`   Affected Files: ${request.summary.affected_files.join(', ') || 'None'}\n`);

  // Risk Level
  const riskColor =
    request.summary.risk_level === 'low'
      ? chalk.green
      : request.summary.risk_level === 'medium'
      ? chalk.yellow
      : chalk.red;

  console.log(chalk.yellow('⚠️  Risk Assessment:'));
  console.log(`   Level: ${riskColor(request.summary.risk_level.toUpperCase())}`);

  // Security Checks
  console.log(chalk.yellow('\n🔒 Security Checks:'));
  console.log(`   Path Traversal:    ${request.security_checks.path_traversal === 'PASS' ? chalk.green('PASS') : chalk.red('FAIL')}`);
  console.log(`   Command Injection: ${request.security_checks.command_injection === 'PASS' ? chalk.green('PASS') : chalk.red('FAIL')}`);
  console.log(`   Resource Limits:   ${request.security_checks.resource_limits === 'PASS' ? chalk.green('PASS') : chalk.red('FAIL')}`);

  // Actions Table
  if (request.actions_preview && request.actions_preview.length > 0) {
    console.log(chalk.yellow('\n🔧 Proposed Actions:'));

    const table = new Table({
      head: [
        chalk.white('#'),
        chalk.white('Type'),
        chalk.white('File'),
        chalk.white('Description'),
      ],
      colWidths: [5, 15, 25, 45],
      wordWrap: true,
    });

    request.actions_preview.forEach((action, index) => {
      table.push([
        (index + 1).toString(),
        action.type,
        action.file || '-',
        action.description,
      ]);
    });

    console.log(table.toString());
  }

  // Expiration
  console.log(chalk.gray(`\nTimestamp: ${request.timestamp}`));
  console.log(chalk.gray(`Expires:   ${request.expires_at}`));
  console.log(chalk.bold('═══════════════════════════════════════════════════════\n'));
}

/**
 * Get user's approval decision
 */
async function getUserDecision(
  request: ApprovalRequest
): Promise<{ approved: boolean; notes: string }> {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'decision',
      message: 'What would you like to do?',
      choices: [
        { name: `✅ ${request.user_options.approve}`, value: 'approve' },
        { name: `❌ ${request.user_options.reject}`, value: 'reject' },
        { name: '📋 View Details - Show full JSON', value: 'details' },
      ],
    },
  ]);

  if (answers.decision === 'details') {
    console.log(chalk.cyan('\n📋 Full Request JSON:'));
    console.log(JSON.stringify(request, null, 2));
    return getUserDecision(request);
  }

  const notesAnswer = await inquirer.prompt([
    {
      type: 'input',
      name: 'notes',
      message: 'Add notes (optional):',
      default: '',
    },
  ]);

  return {
    approved: answers.decision === 'approve',
    notes: notesAnswer.notes,
  };
}

/**
 * Approve and forward the request - creates ExecutionOrder
 */
async function approveRequest(
  request: ApprovalRequest,
  filepath: string,
  approvedPath: string,
  notes: string
): Promise<void> {
  // Convert action previews to full actions
  const actions: Action[] = request.actions_preview.map((preview, idx) => ({
    action_id: preview.action_id,
    type: preview.type,
    parameters: {
      file_path: preview.file,
    },
    expected_outcome: preview.description,
  }));

  // Create execution order matching the protocol type
  const executionOrder: ExecutionOrder = {
    order_id: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    based_on_plan: request.based_on_plan,
    approved_by: 'user',
    approved_at: new Date().toISOString(),
    actions: actions,
    constraints: {
      max_iterations: 10,
      timeout_minutes: 5,
      memory_limit_mb: 512,
      disk_limit_mb: 100,
      network_allowed: false, // Air-gap enforced
    },
    rollback: {
      enabled: true,
      git_ref: 'HEAD',
    },
    signature: {
      algorithm: 'Ed25519',
      public_key: '', // Will be filled by auditor
      signature: '',  // Will be filled by auditor
    },
    hash: '', // Will be computed
  };

  // Write execution order
  const outputFile = join(
    approvedPath,
    `execution_order_${executionOrder.order_id}.json`
  );
  await writeFile(outputFile, JSON.stringify(executionOrder, null, 2));

  // Mark original as processed
  await rename(filepath, filepath.replace('.json', '.approved.json'));

  console.log(chalk.gray(`   → Created: ${outputFile}`));
}

/**
 * Reject the request
 */
async function rejectRequest(
  request: ApprovalRequest,
  filepath: string,
  notes: string
): Promise<void> {
  // Create rejection record
  const rejection = {
    request_id: request.request_id,
    rejected_at: new Date().toISOString(),
    rejected_by: 'user',
    notes,
  };

  // Mark as rejected
  await rename(filepath, filepath.replace('.json', '.rejected.json'));

  // Write rejection notes
  const rejectionFile = filepath.replace('.json', '.rejection.json');
  await writeFile(rejectionFile, JSON.stringify(rejection, null, 2));

  console.log(chalk.gray(`   → Rejection saved`));
}
