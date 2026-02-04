/**
 * BYON Style Contract Tests
 *
 * These tests verify that the BYON style validation:
 * 1. Accepts valid, structured output
 * 2. Rejects empathy/meta/story/therapy patterns
 * 3. Rejects schema violations
 * 4. Properly handles regeneration loop
 */

import { describe, it, expect } from 'vitest';
import { validate_or_regenerate, validateByonDoc } from '../../shared/style/validate_or_regenerate';

// Import fixtures
import good from '../fixtures/byon/good.worker.json';
import badEmpathy from '../fixtures/byon/bad.empathy.json';
import badMissingFields from '../fixtures/byon/bad.missing_fields.json';

describe('BYON Style Contract', () => {
  describe('Schema Validation', () => {
    it('accepts a valid BYON document', () => {
      const result = validateByonDoc(good, 85);

      expect(result.ok).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(85);
      expect(result.violations.length).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    it('rejects document with empty options array', () => {
      const result = validateByonDoc(badMissingFields, 85);

      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes('options'))).toBe(true);
    });

    it('rejects document missing required fields', () => {
      const incomplete = {
        version: '1.0',
        agent_role: 'worker',
        // missing: axis, decision, constraints, options, next_action, output, meta
      };

      const result = validateByonDoc(incomplete, 85);

      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects document with invalid agent_role', () => {
      const invalid = {
        ...good,
        agent_role: 'invalid_role',
      };

      const result = validateByonDoc(invalid, 85);

      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes('agent_role'))).toBe(true);
    });

    it('rejects document with invalid option id', () => {
      const invalid = {
        ...good,
        options: [
          {
            id: 'Z', // Must be A, B, or C
            title: 'Test',
            steps: ['Step'],
            risk: 'low',
            requires_user_approval: true,
          },
        ],
      };

      const result = validateByonDoc(invalid, 85);

      expect(result.ok).toBe(false);
    });
  });

  describe('Style Violations', () => {
    it('rejects empathy patterns', () => {
      const result = validateByonDoc(badEmpathy, 85);

      expect(result.ok).toBe(false);
      expect(result.violations).toContain('empathy_1');
      expect(result.score).toBeLessThan(85);
    });

    it('rejects meta patterns ("as an AI")', () => {
      const doc = {
        ...good,
        output: {
          format: 'text',
          content:
            'As an AI language model, I cannot perform this action. My limitations prevent me from doing so.',
        },
      };

      const result = validateByonDoc(doc, 85);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.startsWith('meta'))).toBe(true);
    });

    it('rejects story patterns', () => {
      const doc = {
        ...good,
        output: {
          format: 'text',
          content: 'Imaginează-ți că ești într-o pădure. Hai să-ți spun o poveste despre cum funcționează.',
        },
      };

      const result = validateByonDoc(doc, 85);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.startsWith('story'))).toBe(true);
    });

    it('rejects therapy patterns', () => {
      const doc = {
        ...good,
        output: {
          format: 'text',
          content: 'Acest lucru poate cauza anxietate și stres. Trebuie să te gândești la vindecare și coping.',
        },
      };

      const result = validateByonDoc(doc, 85);

      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.startsWith('therapy'))).toBe(true);
    });

    it('penalizes too long output', () => {
      const longContent = 'A'.repeat(4000);
      const doc = {
        ...good,
        output: {
          format: 'text',
          content: longContent,
        },
      };

      const result = validateByonDoc(doc, 85);

      expect(result.violations).toContain('too_long');
    });

    it('penalizes unstructured output', () => {
      const doc = {
        ...good,
        output: {
          format: 'text',
          content: 'Just one line of text without any structure.',
        },
      };

      const result = validateByonDoc(doc, 85);

      expect(result.violations).toContain('too_unstructured');
    });
  });

  describe('validate_or_regenerate', () => {
    it('returns immediately if initial doc is valid', async () => {
      const result = await validate_or_regenerate(
        good,
        async () => good,
        { minScore: 85, maxAttempts: 1, hardFail: false }
      );

      expect(result.ok).toBe(true);
      expect(result.attempts).toBe(0);
      expect(result.validation.score).toBeGreaterThanOrEqual(85);
    });

    it('throws on invalid doc when hardFail is true', async () => {
      await expect(async () => {
        await validate_or_regenerate(
          badEmpathy,
          async () => badEmpathy, // Always returns bad doc
          { minScore: 85, maxAttempts: 1, hardFail: true }
        );
      }).rejects.toThrow(/BYON validation failed/i);
    });

    it('returns failure result when hardFail is false', async () => {
      const result = await validate_or_regenerate(
        badEmpathy,
        async () => badEmpathy,
        { minScore: 85, maxAttempts: 1, hardFail: false }
      );

      expect(result.ok).toBe(false);
      expect(result.attempts).toBe(1);
      expect(result.history.length).toBe(2); // Initial + 1 attempt
    });

    it('regenerates until passing (retry loop)', async () => {
      let callCount = 0;

      const result = await validate_or_regenerate(
        badEmpathy,
        async (ctx) => {
          callCount++;
          // First regeneration still fails, second succeeds
          if (callCount < 2) {
            return badEmpathy as any;
          }
          return good as any;
        },
        { minScore: 85, maxAttempts: 4, hardFail: true }
      );

      expect(result.ok).toBe(true);
      expect(result.attempts).toBeGreaterThanOrEqual(1);
      expect(result.validation.score).toBeGreaterThanOrEqual(85);
      expect(callCount).toBe(2);
    });

    it('provides correct context to regenerate function', async () => {
      let receivedContext: any = null;

      await validate_or_regenerate(
        badEmpathy,
        async (ctx) => {
          receivedContext = ctx;
          return good as any; // Return valid on first regeneration
        },
        { minScore: 85, maxAttempts: 4, hardFail: true }
      );

      expect(receivedContext).not.toBeNull();
      expect(receivedContext.attempt).toBe(1);
      expect(receivedContext.lastScore).toBeLessThan(85);
      expect(receivedContext.lastViolations).toContain('empathy_1');
      expect(receivedContext.lastErrors.length).toBeGreaterThan(0);
    });

    it('records history of all attempts', async () => {
      let callCount = 0;

      const result = await validate_or_regenerate(
        badEmpathy,
        async () => {
          callCount++;
          if (callCount < 3) return badEmpathy as any;
          return good as any;
        },
        { minScore: 85, maxAttempts: 5, hardFail: false }
      );

      expect(result.history.length).toBe(4); // Initial + 3 attempts
      expect(result.history[0].attempt).toBe(0);
      expect(result.history[1].attempt).toBe(1);
      expect(result.history[2].attempt).toBe(2);
      expect(result.history[3].attempt).toBe(3);
    });
  });

  describe('Score Thresholds', () => {
    it('uses default minScore of 85', async () => {
      // Score 80 should fail with default threshold
      const doc = {
        ...good,
        output: {
          format: 'markdown',
          content: 'Desigur, cu plăcere!\n\nLine 2\nLine 3',
        },
      };

      const result = validateByonDoc(doc); // Uses default 85

      // Should have filler violations reducing score
      expect(result.violations.some((v) => v.startsWith('filler'))).toBe(true);
    });

    it('respects custom minScore', async () => {
      // Same doc might pass with lower threshold
      const doc = {
        ...good,
        output: {
          format: 'markdown',
          content: 'Desigur!\n\nLine 2\nLine 3',
        },
      };

      const strictResult = validateByonDoc(doc, 99);
      const lenientResult = validateByonDoc(doc, 50);

      expect(strictResult.ok).toBe(false);
      expect(lenientResult.ok).toBe(true);
    });
  });
});
