/**
 * Integration Tests for Handoff Protocol
 *
 * Tests the complete flow: Worker → Auditor → User → Executor → Worker
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, rm, readdir } from 'fs/promises';
import { join } from 'path';
import * as crypto from 'crypto';

// Test directory
const TEST_HANDOFF_PATH = './test_handoff_temp';

// Directories
const DIRS = {
  workerToAuditor: 'worker_to_auditor',
  auditorToUser: 'auditor_to_user',
  auditorToExecutor: 'auditor_to_executor',
  executorToWorker: 'executor_to_worker',
};

// Helper functions
function generateUUID(): string {
  return crypto.randomUUID();
}

function calculateHash(obj: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

describe('Handoff Protocol Integration', () => {
  beforeEach(async () => {
    // Create test directories
    for (const dir of Object.values(DIRS)) {
      await mkdir(join(TEST_HANDOFF_PATH, dir), { recursive: true });
    }
  });

  afterEach(async () => {
    // Cleanup
    await rm(TEST_HANDOFF_PATH, { recursive: true, force: true });
  });

  describe('Worker → Auditor Flow', () => {
    it('should create evidence pack file', async () => {
      const evidence = {
        evidence_id: generateUUID(),
        timestamp: new Date().toISOString(),
        task_type: 'coding',
        extracted_facts: [
          { fact_id: generateUUID(), fact: 'Test fact', confidence: 0.8 },
        ],
        hash: '',
      };
      evidence.hash = calculateHash(evidence);

      const filename = `evidence_pack_${evidence.evidence_id}.json`;
      const filepath = join(TEST_HANDOFF_PATH, DIRS.workerToAuditor, filename);

      await writeFile(filepath, JSON.stringify(evidence, null, 2));

      const content = await readFile(filepath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.evidence_id).toBe(evidence.evidence_id);
      expect(parsed.extracted_facts.length).toBe(1);
    });

    it('should create plan draft file', async () => {
      const plan = {
        plan_id: generateUUID(),
        timestamp: new Date().toISOString(),
        based_on_evidence: generateUUID(),
        intent: 'Fix bug in authentication',
        actions: [
          {
            action_id: generateUUID(),
            type: 'code_edit',
            parameters: { file_path: 'src/auth.ts' },
            expected_outcome: 'Bug fixed',
          },
        ],
        risk_level: 'low',
        hash: '',
      };
      plan.hash = calculateHash(plan);

      const filename = `plan_draft_${plan.plan_id}.json`;
      const filepath = join(TEST_HANDOFF_PATH, DIRS.workerToAuditor, filename);

      await writeFile(filepath, JSON.stringify(plan, null, 2));

      const content = await readFile(filepath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.plan_id).toBe(plan.plan_id);
      expect(parsed.actions.length).toBe(1);
    });
  });

  describe('Auditor → User Flow', () => {
    it('should create approval request file', async () => {
      const request = {
        request_id: generateUUID(),
        timestamp: new Date().toISOString(),
        based_on_plan: generateUUID(),
        summary: {
          intent: 'Fix authentication bug',
          description: 'Modifies auth.ts to fix token validation',
          affected_files: ['src/auth.ts'],
          risk_level: 'low',
        },
        security_checks: {
          path_traversal: 'PASS',
          command_injection: 'PASS',
          resource_limits: 'PASS',
        },
        requires_approval: true,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        hash: '',
      };
      request.hash = calculateHash(request);

      const filename = `approval_request_${request.request_id}.json`;
      const filepath = join(TEST_HANDOFF_PATH, DIRS.auditorToUser, filename);

      await writeFile(filepath, JSON.stringify(request, null, 2));

      const content = await readFile(filepath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.request_id).toBe(request.request_id);
      expect(parsed.security_checks.path_traversal).toBe('PASS');
    });
  });

  describe('Auditor → Executor Flow', () => {
    it('should create execution order file', async () => {
      const order = {
        order_id: generateUUID(),
        timestamp: new Date().toISOString(),
        based_on_plan: generateUUID(),
        approved_by: 'user',
        approved_at: new Date().toISOString(),
        actions: [
          {
            action_id: generateUUID(),
            type: 'code_edit',
            parameters: { file_path: 'src/auth.ts' },
            expected_outcome: 'Bug fixed',
          },
        ],
        constraints: {
          max_iterations: 10,
          timeout_minutes: 5,
          memory_limit_mb: 512,
          disk_limit_mb: 100,
          network_allowed: false,
        },
        signature: {
          algorithm: 'Ed25519',
          public_key: 'test_public_key',
          signature: 'test_signature',
        },
        hash: '',
      };
      order.hash = calculateHash(order);

      const filename = `execution_order_${order.order_id}.json`;
      const filepath = join(TEST_HANDOFF_PATH, DIRS.auditorToExecutor, filename);

      await writeFile(filepath, JSON.stringify(order, null, 2));

      const content = await readFile(filepath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.order_id).toBe(order.order_id);
      expect(parsed.constraints.network_allowed).toBe(false); // Air-gap
    });
  });

  describe('Executor → Worker Flow', () => {
    it('should create johnson receipt file', async () => {
      const receipt = {
        receipt_id: generateUUID(),
        timestamp: new Date().toISOString(),
        based_on_order: generateUUID(),
        execution_summary: {
          status: 'success',
          actions_total: 1,
          actions_completed: 1,
          actions_failed: 0,
          iterations_used: 2,
          duration_ms: 1500,
        },
        action_results: [
          {
            action_id: generateUUID(),
            type: 'code_edit',
            status: 'success',
            iterations: 2,
            details: { lines_changed: 5 },
          },
        ],
        errors: [],
        changes_made: {
          files_modified: ['src/auth.ts'],
          files_created: [],
          files_deleted: [],
        },
        verification: {
          tests_passing: true,
          lint_passing: true,
          build_passing: true,
        },
        hash: '',
      };
      receipt.hash = calculateHash(receipt);

      const filename = `johnson_receipt_${receipt.receipt_id}.json`;
      const filepath = join(TEST_HANDOFF_PATH, DIRS.executorToWorker, filename);

      await writeFile(filepath, JSON.stringify(receipt, null, 2));

      const content = await readFile(filepath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.receipt_id).toBe(receipt.receipt_id);
      expect(parsed.execution_summary.status).toBe('success');
      expect(parsed.verification.tests_passing).toBe(true);
    });
  });

  describe('Complete Flow', () => {
    it('should process complete Worker → Auditor → User → Executor → Worker cycle', async () => {
      // 1. Worker creates evidence and plan
      const evidenceId = generateUUID();
      const planId = generateUUID();

      const evidence = {
        evidence_id: evidenceId,
        timestamp: new Date().toISOString(),
        task_type: 'coding',
        extracted_facts: [{ fact_id: generateUUID(), fact: 'Fix bug', confidence: 0.9 }],
        hash: '',
      };
      evidence.hash = calculateHash(evidence);

      const plan = {
        plan_id: planId,
        based_on_evidence: evidenceId,
        timestamp: new Date().toISOString(),
        intent: 'Fix bug',
        actions: [{ action_id: generateUUID(), type: 'code_edit', parameters: {}, expected_outcome: 'done' }],
        risk_level: 'low',
        hash: '',
      };
      plan.hash = calculateHash(plan);

      await writeFile(
        join(TEST_HANDOFF_PATH, DIRS.workerToAuditor, `evidence_pack_${evidenceId}.json`),
        JSON.stringify(evidence)
      );
      await writeFile(
        join(TEST_HANDOFF_PATH, DIRS.workerToAuditor, `plan_draft_${planId}.json`),
        JSON.stringify(plan)
      );

      // 2. Auditor creates approval request
      const requestId = generateUUID();
      const request = {
        request_id: requestId,
        based_on_plan: planId,
        timestamp: new Date().toISOString(),
        summary: { intent: 'Fix bug', description: 'test', affected_files: [], risk_level: 'low' },
        security_checks: { path_traversal: 'PASS', command_injection: 'PASS', resource_limits: 'PASS' },
        requires_approval: true,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        hash: '',
      };
      request.hash = calculateHash(request);

      await writeFile(
        join(TEST_HANDOFF_PATH, DIRS.auditorToUser, `approval_request_${requestId}.json`),
        JSON.stringify(request)
      );

      // 3. User approves → Auditor creates execution order
      const orderId = generateUUID();
      const order = {
        order_id: orderId,
        based_on_plan: planId,
        timestamp: new Date().toISOString(),
        approved_by: 'user',
        approved_at: new Date().toISOString(),
        actions: plan.actions,
        constraints: { max_iterations: 10, timeout_minutes: 5, memory_limit_mb: 512, disk_limit_mb: 100, network_allowed: false },
        signature: { algorithm: 'Ed25519', public_key: 'pk', signature: 'sig' },
        hash: '',
      };
      order.hash = calculateHash(order);

      await writeFile(
        join(TEST_HANDOFF_PATH, DIRS.auditorToExecutor, `execution_order_${orderId}.json`),
        JSON.stringify(order)
      );

      // 4. Executor creates receipt
      const receiptId = generateUUID();
      const receipt = {
        receipt_id: receiptId,
        based_on_order: orderId,
        timestamp: new Date().toISOString(),
        execution_summary: { status: 'success', actions_total: 1, actions_completed: 1, actions_failed: 0, iterations_used: 1, duration_ms: 100 },
        action_results: [],
        errors: [],
        changes_made: { files_modified: [], files_created: [], files_deleted: [] },
        verification: { tests_passing: true, lint_passing: true, build_passing: true },
        hash: '',
      };
      receipt.hash = calculateHash(receipt);

      await writeFile(
        join(TEST_HANDOFF_PATH, DIRS.executorToWorker, `johnson_receipt_${receiptId}.json`),
        JSON.stringify(receipt)
      );

      // Verify all files exist
      const workerToAuditorFiles = await readdir(join(TEST_HANDOFF_PATH, DIRS.workerToAuditor));
      const auditorToUserFiles = await readdir(join(TEST_HANDOFF_PATH, DIRS.auditorToUser));
      const auditorToExecutorFiles = await readdir(join(TEST_HANDOFF_PATH, DIRS.auditorToExecutor));
      const executorToWorkerFiles = await readdir(join(TEST_HANDOFF_PATH, DIRS.executorToWorker));

      expect(workerToAuditorFiles.length).toBe(2); // evidence + plan
      expect(auditorToUserFiles.length).toBe(1);   // approval request
      expect(auditorToExecutorFiles.length).toBe(1); // execution order
      expect(executorToWorkerFiles.length).toBe(1);  // receipt
    });
  });
});
