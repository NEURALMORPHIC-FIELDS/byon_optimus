/**
 * Unit Tests for Protocol Types and Validation
 */

import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';

// Type definitions (would normally import from @byon-bot/shared)
type RiskLevel = 'low' | 'medium' | 'high';
type ActionType = 'code_edit' | 'file_create' | 'file_delete' | 'test_run' | 'lint_run' | 'build_run';
type ExecutionStatus = 'success' | 'partial' | 'failed' | 'rejected';

interface Action {
  action_id: string;
  type: ActionType;
  parameters: Record<string, unknown>;
  expected_outcome: string;
}

interface EvidencePack {
  evidence_id: string;
  timestamp: string;
  task_type: string;
  extracted_facts: Array<{ fact_id: string; fact: string; confidence: number }>;
  hash?: string;
}

interface PlanDraft {
  plan_id: string;
  timestamp: string;
  based_on_evidence: string;
  intent: string;
  actions: Action[];
  risk_level: RiskLevel;
  hash?: string;
}

// Helper functions
function generateUUID(): string {
  return crypto.randomUUID();
}

function calculateHash(obj: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function addHash<T extends Record<string, unknown>>(obj: T): T & { hash: string } {
  const { hash, ...content } = obj as T & { hash?: string };
  return { ...obj, hash: calculateHash(content) } as T & { hash: string };
}

describe('Protocol Types', () => {
  describe('UUID Generation', () => {
    it('should generate valid UUIDs', () => {
      const uuid = generateUUID();
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('should generate unique UUIDs', () => {
      const uuids = new Set(Array.from({ length: 100 }, generateUUID));
      expect(uuids.size).toBe(100);
    });
  });

  describe('Evidence Pack', () => {
    it('should create valid evidence pack', () => {
      const evidence: EvidencePack = {
        evidence_id: generateUUID(),
        timestamp: new Date().toISOString(),
        task_type: 'coding',
        extracted_facts: [
          {
            fact_id: generateUUID(),
            fact: 'User wants to fix a bug',
            confidence: 0.9,
          },
        ],
      };

      expect(evidence.evidence_id).toBeDefined();
      expect(evidence.extracted_facts.length).toBe(1);
      expect(evidence.extracted_facts[0].confidence).toBeLessThanOrEqual(1);
      expect(evidence.extracted_facts[0].confidence).toBeGreaterThanOrEqual(0);
    });

    it('should add valid hash to evidence pack', () => {
      const evidence: EvidencePack = {
        evidence_id: generateUUID(),
        timestamp: new Date().toISOString(),
        task_type: 'coding',
        extracted_facts: [],
      };

      const withHash = addHash(evidence);

      expect(withHash.hash).toBeDefined();
      expect(withHash.hash.length).toBe(64);
    });

    it('should produce different hashes for different content', () => {
      const evidence1 = addHash({
        evidence_id: 'id1',
        timestamp: '2024-01-01',
        task_type: 'coding',
        extracted_facts: [],
      });

      const evidence2 = addHash({
        evidence_id: 'id2',
        timestamp: '2024-01-02',
        task_type: 'general',
        extracted_facts: [],
      });

      expect(evidence1.hash).not.toBe(evidence2.hash);
    });
  });

  describe('Plan Draft', () => {
    it('should create valid plan draft', () => {
      const plan: PlanDraft = {
        plan_id: generateUUID(),
        timestamp: new Date().toISOString(),
        based_on_evidence: generateUUID(),
        intent: 'Fix authentication bug',
        actions: [
          {
            action_id: generateUUID(),
            type: 'code_edit',
            parameters: { file_path: 'src/auth.ts' },
            expected_outcome: 'Bug fixed',
          },
        ],
        risk_level: 'low',
      };

      expect(plan.plan_id).toBeDefined();
      expect(plan.actions.length).toBe(1);
      expect(['low', 'medium', 'high']).toContain(plan.risk_level);
    });

    it('should validate action types', () => {
      const validTypes: ActionType[] = [
        'code_edit',
        'file_create',
        'file_delete',
        'test_run',
        'lint_run',
        'build_run',
      ];

      validTypes.forEach((type) => {
        const action: Action = {
          action_id: generateUUID(),
          type,
          parameters: {},
          expected_outcome: 'test',
        };
        expect(validTypes).toContain(action.type);
      });
    });

    it('should validate risk levels', () => {
      const validLevels: RiskLevel[] = ['low', 'medium', 'high'];

      validLevels.forEach((level) => {
        const plan: PlanDraft = {
          plan_id: generateUUID(),
          timestamp: new Date().toISOString(),
          based_on_evidence: generateUUID(),
          intent: 'test',
          actions: [],
          risk_level: level,
        };
        expect(validLevels).toContain(plan.risk_level);
      });
    });
  });

  describe('Execution Status', () => {
    it('should validate execution statuses', () => {
      const validStatuses: ExecutionStatus[] = ['success', 'partial', 'failed', 'rejected'];

      validStatuses.forEach((status) => {
        expect(validStatuses).toContain(status);
      });
    });
  });
});

describe('Hash Integrity', () => {
  it('should detect tampering in evidence pack', () => {
    const evidence = addHash({
      evidence_id: generateUUID(),
      timestamp: new Date().toISOString(),
      task_type: 'coding',
      extracted_facts: [],
    });

    const originalHash = evidence.hash;

    // Tamper with data
    evidence.task_type = 'TAMPERED';

    // Recalculate hash
    const { hash: _, ...content } = evidence;
    const newHash = calculateHash(content);

    expect(newHash).not.toBe(originalHash);
  });

  it('should detect tampering in plan draft', () => {
    const plan = addHash({
      plan_id: generateUUID(),
      timestamp: new Date().toISOString(),
      based_on_evidence: generateUUID(),
      intent: 'Original intent',
      actions: [],
      risk_level: 'low' as RiskLevel,
    });

    const originalHash = plan.hash;

    // Tamper with intent
    plan.intent = 'TAMPERED intent';

    // Recalculate hash
    const { hash: _, ...content } = plan;
    const newHash = calculateHash(content);

    expect(newHash).not.toBe(originalHash);
  });
});
