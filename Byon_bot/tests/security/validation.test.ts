/**
 * Security Validation Tests
 *
 * Tests for input validation and security boundaries
 */

import { describe, it, expect } from 'vitest';

describe('Input Validation', () => {
  describe('JSON Schema Validation', () => {
    const validateEvidencePack = (data: unknown): { valid: boolean; errors: string[] } => {
      const errors: string[] = [];

      if (typeof data !== 'object' || data === null) {
        return { valid: false, errors: ['Must be an object'] };
      }

      const obj = data as Record<string, unknown>;

      if (typeof obj.evidence_id !== 'string') {
        errors.push('evidence_id must be a string');
      }

      if (typeof obj.timestamp !== 'string') {
        errors.push('timestamp must be a string');
      }

      if (!['coding', 'general', 'calendar', 'message'].includes(obj.task_type as string)) {
        errors.push('task_type must be one of: coding, general, calendar, message');
      }

      if (!Array.isArray(obj.extracted_facts)) {
        errors.push('extracted_facts must be an array');
      }

      if (typeof obj.hash !== 'string') {
        errors.push('hash must be a string');
      }

      return { valid: errors.length === 0, errors };
    };

    it('should validate correct evidence pack', () => {
      const valid = {
        evidence_id: 'test-id',
        timestamp: '2024-01-01T00:00:00Z',
        task_type: 'coding',
        extracted_facts: [],
        hash: 'abc123',
      };

      const result = validateEvidencePack(valid);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should reject invalid evidence pack', () => {
      const invalid = {
        evidence_id: 123, // should be string
        timestamp: '2024-01-01',
        task_type: 'invalid_type', // invalid enum
        extracted_facts: 'not an array',
        // missing hash
      };

      const result = validateEvidencePack(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject null input', () => {
      const result = validateEvidencePack(null);
      expect(result.valid).toBe(false);
    });

    it('should reject non-object input', () => {
      const result = validateEvidencePack('string');
      expect(result.valid).toBe(false);
    });
  });

  describe('Code Edit Validation', () => {
    interface CodeEdit {
      file_path: string;
      edits: Array<{ old: string; new: string }>;
    }

    const validateCodeEdit = (edit: CodeEdit): { valid: boolean; errors: string[] } => {
      const errors: string[] = [];

      // Validate file path
      if (!edit.file_path) {
        errors.push('file_path is required');
      }

      if (edit.file_path?.includes('..')) {
        errors.push('Path traversal detected in file_path');
      }

      // Validate edits
      if (!Array.isArray(edit.edits)) {
        errors.push('edits must be an array');
      }

      edit.edits?.forEach((e, i) => {
        if (typeof e.old !== 'string') {
          errors.push(`edit[${i}].old must be a string`);
        }
        if (typeof e.new !== 'string') {
          errors.push(`edit[${i}].new must be a string`);
        }

        // Check for suspicious patterns in new code
        const suspiciousPatterns = [
          /eval\s*\(/,
          /Function\s*\(/,
          /require\s*\(\s*['"`]child_process/,
          /exec\s*\(/,
          /spawn\s*\(/,
        ];

        suspiciousPatterns.forEach((pattern) => {
          if (pattern.test(e.new || '')) {
            errors.push(`Suspicious code pattern detected in edit[${i}]`);
          }
        });
      });

      return { valid: errors.length === 0, errors };
    };

    it('should validate safe code edit', () => {
      const edit: CodeEdit = {
        file_path: 'src/utils.ts',
        edits: [
          { old: 'const x = 1', new: 'const x = 2' },
        ],
      };

      const result = validateCodeEdit(edit);
      expect(result.valid).toBe(true);
    });

    it('should reject path traversal in file_path', () => {
      const edit: CodeEdit = {
        file_path: '../../../etc/passwd',
        edits: [],
      };

      const result = validateCodeEdit(edit);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Path traversal detected in file_path');
    });

    it('should detect eval injection', () => {
      const edit: CodeEdit = {
        file_path: 'src/utils.ts',
        edits: [
          { old: 'safe code', new: 'eval(userInput)' },
        ],
      };

      const result = validateCodeEdit(edit);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Suspicious code pattern'))).toBe(true);
    });

    it('should detect child_process import', () => {
      const edit: CodeEdit = {
        file_path: 'src/utils.ts',
        edits: [
          { old: 'safe code', new: "require('child_process').exec('rm -rf /')" },
        ],
      };

      const result = validateCodeEdit(edit);
      expect(result.valid).toBe(false);
    });
  });

  describe('Trust Level Validation', () => {
    type TrustLevel = 'self' | 'trusted' | 'external' | 'unknown';

    const ALLOWED_SOURCES_BY_TRUST: Record<TrustLevel, string[]> = {
      self: ['internal', 'system', 'cli'],
      trusted: ['whatsapp', 'telegram', 'discord'],
      external: ['email', 'webhook'],
      unknown: [],
    };

    const validateTrustLevel = (source: string, trustLevel: TrustLevel): boolean => {
      const allowed = ALLOWED_SOURCES_BY_TRUST[trustLevel] || [];
      return allowed.includes(source);
    };

    it('should validate self trust level', () => {
      expect(validateTrustLevel('cli', 'self')).toBe(true);
      expect(validateTrustLevel('whatsapp', 'self')).toBe(false);
    });

    it('should validate trusted sources', () => {
      expect(validateTrustLevel('whatsapp', 'trusted')).toBe(true);
      expect(validateTrustLevel('telegram', 'trusted')).toBe(true);
      expect(validateTrustLevel('email', 'trusted')).toBe(false);
    });

    it('should validate external sources', () => {
      expect(validateTrustLevel('email', 'external')).toBe(true);
      expect(validateTrustLevel('webhook', 'external')).toBe(true);
    });

    it('should reject unknown sources', () => {
      expect(validateTrustLevel('malicious', 'unknown')).toBe(false);
      expect(validateTrustLevel('anything', 'unknown')).toBe(false);
    });
  });
});

describe('Hash Integrity Validation', () => {
  const crypto = await import('crypto');

  const computeHash = (obj: Record<string, unknown>): string => {
    const { hash: _, ...content } = obj;
    return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
  };

  const validateHash = (obj: Record<string, unknown>): boolean => {
    if (!obj.hash) return false;
    const computed = computeHash(obj);
    return computed === obj.hash;
  };

  it('should validate correct hash', () => {
    const obj = {
      id: 'test',
      data: 'some data',
      hash: '',
    };
    obj.hash = computeHash(obj);

    expect(validateHash(obj)).toBe(true);
  });

  it('should reject incorrect hash', () => {
    const obj = {
      id: 'test',
      data: 'some data',
      hash: 'invalid_hash',
    };

    expect(validateHash(obj)).toBe(false);
  });

  it('should reject missing hash', () => {
    const obj = {
      id: 'test',
      data: 'some data',
    };

    expect(validateHash(obj)).toBe(false);
  });

  it('should detect tampering', () => {
    const obj = {
      id: 'test',
      data: 'original data',
      hash: '',
    };
    obj.hash = computeHash(obj);

    // Verify original
    expect(validateHash(obj)).toBe(true);

    // Tamper with data
    obj.data = 'tampered data';

    // Should fail validation
    expect(validateHash(obj)).toBe(false);
  });
});
