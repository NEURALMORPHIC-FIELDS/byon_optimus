/**
 * BYON Style Contract Validator
 *
 * Validates agent outputs against the BYON style contract schema
 * and enforces strict style rules:
 * - No psychology / empathy / therapeutic language
 * - No stories or metaphors
 * - No meta-commentary ("as an AI", "I cannot")
 * - Structured, administrative output only
 */

import Ajv, { ErrorObject, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

export interface ByonValidationResult {
  ok: boolean;
  errors: string[];
  score: number; // 0..100
  violations: string[];
}

/**
 * Forbidden patterns - HARD-CODED, NOT CONFIGURABLE
 * These patterns indicate style violations that must be rejected
 */
const FORBIDDEN_PATTERNS: Array<{ id: string; re: RegExp }> = [
  // No empathy / therapeutic language
  { id: 'empathy_1', re: /\b(îmi pare rău|imi pare rau|te înțeleg|te inteleg|înțeleg că|inteleg ca)\b/i },
  { id: 'empathy_2', re: /\b(simt că|simt ca|empatizez|compassion|sympathize)\b/i },
  { id: 'empathy_3', re: /\b(I understand|I'm sorry|I apologize|my apologies)\b/i },

  // No stories / metaphors
  { id: 'story_1', re: /\b(odată|imaginează-ți|imagineaza-ti|hai să-ți spun)\b/i },
  { id: 'story_2', re: /\b(once upon|let me tell you a story|imagine if)\b/i },
  { id: 'story_3', re: /\b(povestea|poveste|metaforă|metaphor)\b/i },

  // No therapeutic language
  { id: 'therapy_1', re: /\b(traumă|trauma|vindecare|healing|coping)\b/i },
  { id: 'therapy_2', re: /\b(anxietate|anxiety|depresie|depression|stres|stress)\b/i },
  { id: 'therapy_3', re: /\b(terapie|therapy|mindfulness|self-care)\b/i },

  // No meta-commentary / excuses
  { id: 'meta_1', re: /\b(ca model|ca asistent|nu pot|nu sunt capabil)\b/i },
  { id: 'meta_2', re: /\b(as an AI|as a language model|I cannot|I'm not able)\b/i },
  { id: 'meta_3', re: /\b(my limitations|beyond my capabilities)\b/i },

  // No excessive politeness / filler
  { id: 'filler_1', re: /\b(desigur|bineînțeles|cu plăcere|certainly|of course|absolutely)\b/i },
  { id: 'filler_2', re: /\b(great question|that's interesting|happy to help)\b/i },
];

/**
 * Compute style score based on content analysis
 */
function computeStyleScore(content: string): { score: number; violations: string[] } {
  const violations: string[] = [];

  // Check forbidden patterns
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.re.test(content)) {
      violations.push(pattern.id);
    }
  }

  // Penalize excessive length (prolixity)
  const len = content.trim().length;
  if (len > 3500) {
    violations.push('too_long');
  }

  // Penalize lack of structure (minimum 3 non-empty lines)
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 3) {
    violations.push('too_unstructured');
  }

  // Calculate score: start at 100, subtract penalties
  let score = 100;

  // Heavy penalties for empathy/therapy/story violations
  score -= violations.filter((v) => v.startsWith('empathy')).length * 25;
  score -= violations.filter((v) => v.startsWith('story')).length * 25;
  score -= violations.filter((v) => v.startsWith('therapy')).length * 15;
  score -= violations.filter((v) => v.startsWith('meta')).length * 10;
  score -= violations.filter((v) => v.startsWith('filler')).length * 5;

  // Minor penalties for format issues
  if (violations.includes('too_long')) score -= 10;
  if (violations.includes('too_unstructured')) score -= 10;

  // Clamp to 0-100
  if (score < 0) score = 0;
  if (score > 100) score = 100;

  return { score, violations };
}

/**
 * Convert AJV errors to readable strings
 */
function ajvErrorsToStrings(errs: ErrorObject[] | null | undefined): string[] {
  if (!errs?.length) return [];
  return errs.map((e) => {
    const path = e.instancePath || '(root)';
    const msg = e.message || 'schema error';
    return `${path}: ${msg}`;
  });
}

/**
 * BYON Style Contract Validator
 *
 * Validates documents against:
 * 1. JSON Schema structure (required fields, types, constraints)
 * 2. Style rules (no psychology, empathy, stories, meta)
 */
export class ByonValidator {
  private ajv: Ajv;
  private validateFn: ValidateFunction;
  private schemaId = 'byon://schema/style-contract/v1';

  constructor(schema: object) {
    this.ajv = new Ajv({ allErrors: true, strict: true });
    addFormats(this.ajv);

    // Register schema under its $id
    this.ajv.addSchema(schema, this.schemaId);
    const fn = this.ajv.getSchema(this.schemaId);
    if (!fn) {
      throw new Error('BYON schema not registered');
    }
    this.validateFn = fn;
  }

  /**
   * Validate a BYON document
   *
   * @param doc - Document to validate
   * @param minScore - Minimum style score required (default: 85)
   * @returns Validation result
   */
  validate(doc: unknown, minScore = 85): ByonValidationResult {
    // Validate against JSON schema
    const okSchema = this.validateFn(doc);
    const schemaErrors = ajvErrorsToStrings(this.validateFn.errors);

    // Extract content for style scoring
    const content = String((doc as any)?.output?.content ?? '');
    const { score, violations } = computeStyleScore(content);

    // Determine overall pass/fail
    const ok = Boolean(okSchema) && score >= minScore;

    // Collect all errors
    const errors: string[] = [];
    if (!okSchema) {
      errors.push(...schemaErrors);
    }
    if (score < minScore) {
      errors.push(`style_score_below_threshold: ${score} < ${minScore}`);
    }
    for (const v of violations) {
      errors.push(`violation:${v}`);
    }

    return { ok, errors, score, violations };
  }

  /**
   * Get a detailed report of what's wrong with a document
   */
  getDetailedReport(doc: unknown, minScore = 85): string {
    const result = this.validate(doc, minScore);

    const lines: string[] = [
      '=== BYON STYLE VALIDATION REPORT ===',
      '',
      `Status: ${result.ok ? 'PASS' : 'FAIL'}`,
      `Score: ${result.score}/100 (minimum: ${minScore})`,
      '',
    ];

    if (result.violations.length > 0) {
      lines.push('Style Violations:');
      for (const v of result.violations) {
        lines.push(`  - ${v}`);
      }
      lines.push('');
    }

    if (result.errors.length > 0) {
      lines.push('Errors:');
      for (const e of result.errors) {
        lines.push(`  - ${e}`);
      }
    }

    return lines.join('\n');
  }
}

// Re-export for convenience
export { FORBIDDEN_PATTERNS };
