/**
 * Agent Auditor (B)
 *
 * Responsibilities:
 * - VALIDATE evidence packs and plan drafts from Worker
 * - SANITIZE plans for security issues
 * - REQUEST user approval
 * - SIGN execution orders with Ed25519
 *
 * Inputs from: handoff/worker_to_auditor/
 * Outputs to: handoff/auditor_to_user/, handoff/auditor_to_executor/
 */

import {
  generateUUID,
  calculateHash,
  addHash,
  verifyHash,
  signExecutionOrder,
  importKeyPair,
} from '@byon-bot/shared';
import {
  isActionAllowed,
  isForbiddenPath,
  containsForbiddenCode,
  assessRisk,
  LIMITS_BY_RISK,
} from '@byon-bot/shared';
import type {
  EvidencePack,
  PlanDraft,
  ApprovalRequest,
  ExecutionOrder,
  Action,
} from '@byon-bot/shared';
import { readFileSync, writeFileSync, existsSync, readdirSync, watch, mkdirSync } from 'fs';
import { join } from 'path';

// Configuration
const config = {
  role: process.env.ROLE || 'auditor',
  handoffPath: process.env.HANDOFF_PATH || '/handoff',
  keysPath: process.env.KEYS_PATH || '/keys',
  userWebhookUrl: process.env.USER_WEBHOOK_URL || '',
};

console.log(`[Auditor] Starting with config:`, {
  ...config,
  userWebhookUrl: config.userWebhookUrl ? '***' : 'not set',
});

// Track processed files to avoid reprocessing
const processedFiles = new Set<string>();

/**
 * Main auditor loop
 */
async function main() {
  console.log('[Auditor] Agent Auditor initialized');

  const inputDir = join(config.handoffPath, 'worker_to_auditor');
  const outputUserDir = join(config.handoffPath, 'auditor_to_user');
  const outputExecutorDir = join(config.handoffPath, 'auditor_to_executor');

  // Ensure output directories exist
  ensureDir(outputUserDir);
  ensureDir(outputExecutorDir);

  // Process existing files first
  console.log('[Auditor] Scanning for existing evidence packs...');
  await scanAndProcessFiles(inputDir);

  // Watch for new files
  console.log(`[Auditor] Watching directory: ${inputDir}`);

  if (existsSync(inputDir)) {
    watch(inputDir, { persistent: true }, async (eventType, filename) => {
      if (eventType === 'rename' && filename && filename.startsWith('evidence_pack_')) {
        console.log(`[Auditor] New file detected: ${filename}`);
        // Small delay to ensure file is fully written
        setTimeout(() => scanAndProcessFiles(inputDir), 100);
      }
    });
  } else {
    console.log(`[Auditor] Creating input directory: ${inputDir}`);
    ensureDir(inputDir);
    watch(inputDir, { persistent: true }, async (eventType, filename) => {
      if (eventType === 'rename' && filename && filename.startsWith('evidence_pack_')) {
        setTimeout(() => scanAndProcessFiles(inputDir), 100);
      }
    });
  }

  // Also watch for user approvals
  await watchForApprovals();

  // Heartbeat
  setInterval(() => {
    console.log(`[Auditor] Heartbeat - processed ${processedFiles.size} files`);
  }, 30000);
}

// Export for CLI/UI integration
export { handleApproval, processWorkerHandoff };

/**
 * Ensure directory exists
 */
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Scan directory and process any new evidence/plan pairs
 */
async function scanAndProcessFiles(inputDir: string): Promise<void> {
  if (!existsSync(inputDir)) return;

  const files = readdirSync(inputDir);
  const evidenceFiles = files.filter(f => f.startsWith('evidence_pack_') && f.endsWith('.json'));

  for (const evidenceFile of evidenceFiles) {
    // Skip if already processed
    if (processedFiles.has(evidenceFile)) continue;

    // Find matching plan file
    const timestamp = evidenceFile.replace('evidence_pack_', '').replace('.json', '');
    const planFile = `plan_draft_${timestamp}.json`;

    if (!files.includes(planFile)) {
      console.log(`[Auditor] Waiting for plan file: ${planFile}`);
      continue;
    }

    try {
      const evidencePath = join(inputDir, evidenceFile);
      const planPath = join(inputDir, planFile);

      const evidence: EvidencePack = JSON.parse(readFileSync(evidencePath, 'utf-8'));
      const plan: PlanDraft = JSON.parse(readFileSync(planPath, 'utf-8'));

      console.log(`[Auditor] Processing: ${evidenceFile}`);
      await processWorkerHandoff(evidence, plan);

      // Mark as processed
      processedFiles.add(evidenceFile);
      processedFiles.add(planFile);

      console.log(`[Auditor] Completed processing: ${plan.plan_id}`);
    } catch (error) {
      console.error(`[Auditor] Error processing ${evidenceFile}:`, error);
    }
  }
}

/**
 * Process evidence pack and plan draft from Worker
 */
async function processWorkerHandoff(
  evidence: EvidencePack,
  plan: PlanDraft
): Promise<void> {
  console.log(`[Auditor] Processing plan ${plan.plan_id}`);

  // 1. Validate evidence
  const evidenceValidation = validateEvidence(evidence);
  if (!evidenceValidation.valid) {
    console.error('[Auditor] Evidence validation failed:', evidenceValidation.errors);
    return;
  }

  // 2. Validate plan
  const planValidation = validatePlan(plan, evidence);
  if (!planValidation.valid) {
    console.error('[Auditor] Plan validation failed:', planValidation.errors);
    return;
  }

  // 3. Security check
  const securityCheck = performSecurityCheck(plan);
  if (!securityCheck.passed) {
    console.error('[Auditor] Security check failed:', securityCheck.issues);
    return;
  }

  // 4. Generate approval request
  const approvalRequest = createApprovalRequest(evidence, plan, securityCheck);

  // 5. Send to user for approval
  await requestUserApproval(approvalRequest, plan);
}

/**
 * Validate evidence pack
 */
function validateEvidence(evidence: EvidencePack): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Verify hash
  if (!verifyHash(evidence)) {
    errors.push('Evidence hash mismatch');
  }

  // Check required fields
  if (!evidence.evidence_id) errors.push('Missing evidence_id');
  if (!evidence.timestamp) errors.push('Missing timestamp');
  if (!evidence.sources?.length) errors.push('No sources provided');

  // Check source trust levels
  for (const source of evidence.sources || []) {
    if (source.trust_level === 'unknown') {
      errors.push(`Unknown source blocked: ${source.event_id}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate plan draft
 */
function validatePlan(
  plan: PlanDraft,
  evidence: EvidencePack
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Verify hash
  if (!verifyHash(plan)) {
    errors.push('Plan hash mismatch');
  }

  // Check evidence reference
  if (plan.based_on_evidence !== evidence.evidence_id) {
    errors.push('Plan does not reference correct evidence');
  }

  // Validate actions
  for (const action of plan.actions) {
    if (!isActionAllowed(action.type)) {
      errors.push(`Forbidden action type: ${action.type}`);
    }

    // Check paths
    if (action.parameters.file_path && isForbiddenPath(action.parameters.file_path)) {
      errors.push(`Forbidden path: ${action.parameters.file_path}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Perform security checks on plan
 */
function performSecurityCheck(plan: PlanDraft): {
  passed: boolean;
  issues: string[];
  checks: Record<string, 'PASS' | 'FAIL'>;
} {
  const issues: string[] = [];
  const checks: Record<string, 'PASS' | 'FAIL'> = {
    path_traversal: 'PASS',
    command_injection: 'PASS',
    resource_limits: 'PASS',
  };

  for (const action of plan.actions) {
    // Check for path traversal
    if (action.parameters.file_path?.includes('..')) {
      issues.push(`Path traversal in action ${action.action_id}`);
      checks.path_traversal = 'FAIL';
    }

    // Check code edits for forbidden patterns
    if (action.parameters.edits) {
      for (const edit of action.parameters.edits) {
        const codeCheck = containsForbiddenCode(edit.new);
        if (codeCheck.forbidden) {
          issues.push(`Forbidden code patterns: ${codeCheck.matches.join(', ')}`);
          checks.command_injection = 'FAIL';
        }
      }
    }
  }

  // Check resource limits based on risk
  const risk = assessRisk({
    fileDeletes: plan.actions.filter(a => a.type === 'file_delete').length,
    fileCreates: plan.actions.filter(a => a.type === 'file_create').length,
    codeEdits: plan.actions.filter(a => a.type === 'code_edit').length,
    actionCount: plan.actions.length,
    estimatedIterations: plan.estimated_iterations,
  });

  if (risk !== plan.risk_level) {
    console.warn(`[Auditor] Risk level mismatch: plan says ${plan.risk_level}, calculated ${risk}`);
  }

  return {
    passed: issues.length === 0,
    issues,
    checks: checks as Record<string, 'PASS' | 'FAIL'>,
  };
}

/**
 * Create approval request for user
 */
function createApprovalRequest(
  evidence: EvidencePack,
  plan: PlanDraft,
  securityCheck: { checks: Record<string, 'PASS' | 'FAIL'> }
): ApprovalRequest {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  const request: Omit<ApprovalRequest, 'hash'> = {
    request_id: generateUUID(),
    timestamp: new Date().toISOString(),
    based_on_plan: plan.plan_id,
    summary: {
      intent: plan.intent,
      description: `Execute ${plan.actions.length} actions`,
      affected_files: plan.actions
        .map(a => a.parameters.file_path)
        .filter((p): p is string => !!p),
      risk_level: plan.risk_level,
    },
    actions_preview: plan.actions.map(a => ({
      action_id: a.action_id,
      type: a.type,
      file: a.parameters.file_path,
      description: a.expected_outcome,
      diff_preview: a.parameters.edits?.[0]?.new?.slice(0, 100),
    })),
    security_checks: {
      path_traversal: securityCheck.checks.path_traversal,
      command_injection: securityCheck.checks.command_injection,
      resource_limits: securityCheck.checks.resource_limits,
    },
    requires_approval: true,
    expires_at: expiresAt.toISOString(),
    user_options: {
      approve: 'Sign and send to executor',
      reject: 'Discard plan',
      modify: 'Request changes',
    },
  };

  return addHash(request);
}

/**
 * Request user approval
 */
async function requestUserApproval(request: ApprovalRequest, plan: PlanDraft): Promise<void> {
  console.log(`[Auditor] Requesting approval for ${request.request_id}`);
  console.log(`[Auditor] Summary: ${request.summary.description}`);
  console.log(`[Auditor] Risk level: ${request.summary.risk_level}`);

  // Write approval_request.json to auditor_to_user/
  const outputDir = join(config.handoffPath, 'auditor_to_user');
  ensureDir(outputDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const shortId = request.request_id.slice(0, 6);
  const filename = `approval_request_${timestamp}_${shortId}.json`;
  const filePath = join(outputDir, filename);

  // Include plan reference for later signing
  const requestWithPlan = {
    ...request,
    _plan_ref: plan.plan_id,
    _plan: plan, // Include full plan for signing after approval
  };

  writeFileSync(filePath, JSON.stringify(requestWithPlan, null, 2));
  console.log(`[Auditor] Written: ${filename}`);

  // Notify via webhook if configured
  if (config.userWebhookUrl) {
    try {
      // Note: In production, use proper HTTP client
      console.log(`[Auditor] Would notify webhook: ${config.userWebhookUrl}`);
    } catch (error) {
      console.error('[Auditor] Webhook notification failed:', error);
    }
  }
}

/**
 * Handle user approval response
 * Called when user approves via CLI or Web UI
 */
async function handleApproval(
  request: ApprovalRequest,
  plan: PlanDraft,
  userId: string
): Promise<void> {
  console.log(`[Auditor] User ${userId} approved plan ${plan.plan_id}`);

  // Load signing key
  const keyPath = join(config.keysPath, 'auditor.private.pem');
  const altKeyPath = join(config.keysPath, 'private.key');

  let keyFilePath = keyPath;
  if (!existsSync(keyPath)) {
    if (!existsSync(altKeyPath)) {
      throw new Error('Signing key not found');
    }
    keyFilePath = altKeyPath;
  }

  const keyData = JSON.parse(readFileSync(keyFilePath, 'utf-8'));
  const keyPair = importKeyPair(keyData);

  // Create execution order
  const limits = LIMITS_BY_RISK[plan.risk_level];

  const order: Omit<ExecutionOrder, 'signature' | 'hash'> = {
    order_id: generateUUID(),
    timestamp: new Date().toISOString(),
    based_on_plan: plan.plan_id,
    approved_by: userId,
    approved_at: new Date().toISOString(),
    actions: plan.actions,
    constraints: {
      max_iterations: limits.maxIterations,
      timeout_minutes: limits.timeoutMinutes,
      memory_limit_mb: limits.memoryLimitMb,
      disk_limit_mb: limits.diskLimitMb,
      network_allowed: false,
    },
    rollback: {
      enabled: plan.rollback_possible,
      git_ref: 'HEAD',
    },
  };

  // Sign the order
  const signedOrder = await signExecutionOrder(
    addHash(order) as Omit<ExecutionOrder, 'signature'>,
    keyPair.privateKey
  );

  console.log(`[Auditor] Signed execution order ${signedOrder.order_id}`);

  // Write to auditor_to_executor/
  const outputDir = join(config.handoffPath, 'auditor_to_executor');
  ensureDir(outputDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const shortId = signedOrder.order_id.slice(0, 6);
  const filename = `execution_order_${timestamp}_${shortId}.json`;
  const filePath = join(outputDir, filename);

  writeFileSync(filePath, JSON.stringify(signedOrder, null, 2));
  console.log(`[Auditor] Written: ${filename}`);

  // Mark approval request as processed
  const processedDir = join(config.handoffPath, 'auditor_to_user', 'processed');
  ensureDir(processedDir);
}

// Track processed approvals
const processedApprovals = new Set<string>();

/**
 * Watch for user approvals (from CLI or Web UI)
 * Approvals are written to auditor_to_user/approved/
 */
async function watchForApprovals(): Promise<void> {
  const approvedDir = join(config.handoffPath, 'auditor_to_user', 'approved');
  ensureDir(approvedDir);

  console.log(`[Auditor] Watching for approvals in: ${approvedDir}`);

  // Scan existing approvals first
  await scanExistingApprovals(approvedDir);

  watch(approvedDir, { persistent: true }, async (eventType, filename) => {
    if (eventType === 'rename' && filename && filename.endsWith('.json')) {
      setTimeout(() => scanExistingApprovals(approvedDir), 100);
    }
  });
}

/**
 * Scan and process existing approval files
 */
async function scanExistingApprovals(approvedDir: string): Promise<void> {
  if (!existsSync(approvedDir)) return;

  const files = readdirSync(approvedDir).filter(f => f.endsWith('.json'));

  for (const filename of files) {
    if (processedApprovals.has(filename)) continue;

    const filePath = join(approvedDir, filename);
    if (!existsSync(filePath)) continue;

    try {
      const approval = JSON.parse(readFileSync(filePath, 'utf-8'));
      const { request_id, user_id, plan } = approval;

      console.log(`[Auditor] Processing approval: ${request_id}`);

      // Find the original approval request
      const userDir = join(config.handoffPath, 'auditor_to_user');
      const requestFiles = readdirSync(userDir).filter(f =>
        f.endsWith('.json') && f.includes(request_id.slice(0, 6))
      );

      if (requestFiles.length > 0) {
        const requestPath = join(userDir, requestFiles[0]);
        const request: ApprovalRequest & { _plan: PlanDraft } = JSON.parse(
          readFileSync(requestPath, 'utf-8')
        );

        await handleApproval(request, request._plan || plan, user_id);
        processedApprovals.add(filename);
        console.log(`[Auditor] ✓ Approval processed: ${request_id}`);
      } else {
        console.log(`[Auditor] No matching request for approval: ${request_id}`);
      }
    } catch (error) {
      console.error(`[Auditor] Error processing approval ${filename}:`, error);
      processedApprovals.add(filename); // Mark as processed to avoid retries
    }
  }
}

// Start
main().catch(console.error);
