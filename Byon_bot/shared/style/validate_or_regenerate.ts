/**
 * BYON Style Contract - Validate or Regenerate
 *
 * Retry loop that validates agent output and requests regeneration
 * until the output passes style validation or max attempts reached.
 */

import { ByonValidator, ByonValidationResult } from './byon_validator.js';
import schema from './byon_contract.schema.json' with { type: 'json' };

/**
 * Context passed to regenerate function
 */
export interface RegenContext {
  /** Current attempt number (1-based) */
  attempt: number;
  /** Errors from last validation */
  lastErrors: string[];
  /** Score from last validation */
  lastScore: number;
  /** Violations from last validation */
  lastViolations: string[];
}

/**
 * Function signature for regeneration callback
 * This should call your LLM to regenerate the document
 */
export type RegenerateFn<TDoc> = (ctx: RegenContext) => Promise<TDoc>;

/**
 * Options for validate_or_regenerate
 */
export interface ValidateOrRegenerateOptions {
  /** Minimum style score required (default: 85) */
  minScore?: number;
  /** Maximum regeneration attempts (default: 4) */
  maxAttempts?: number;
  /** Throw error on failure (default: true) */
  hardFail?: boolean;
}

/**
 * Result of validate_or_regenerate
 */
export interface ValidateOrRegenerateResult<TDoc> {
  /** Whether validation ultimately passed */
  ok: boolean;
  /** Number of regeneration attempts made */
  attempts: number;
  /** Final document */
  doc: TDoc;
  /** Final validation result */
  validation: ByonValidationResult;
  /** History of all validation attempts */
  history: Array<{
    attempt: number;
    score: number;
    errors: string[];
    violations: string[];
  }>;
}

// Singleton validator instance
const validator = new ByonValidator(schema as object);

/**
 * Validate a BYON document, regenerating if necessary
 *
 * @param initialDoc - Initial document to validate
 * @param regenerate - Callback to regenerate document (should call LLM)
 * @param opts - Options
 * @returns Result with final document and validation status
 *
 * @example
 * ```typescript
 * const result = await validate_or_regenerate(byonDoc, async (ctx) => {
 *   // Pass ctx.lastErrors and ctx.lastViolations to LLM for correction
 *   return await llmRegenerateByonDoc(byonDoc, ctx);
 * }, { minScore: 85, maxAttempts: 4, hardFail: true });
 * ```
 */
export async function validate_or_regenerate<TDoc>(
  initialDoc: TDoc,
  regenerate: RegenerateFn<TDoc>,
  opts: ValidateOrRegenerateOptions = {}
): Promise<ValidateOrRegenerateResult<TDoc>> {
  const minScore = opts.minScore ?? 85;
  const maxAttempts = opts.maxAttempts ?? 4;
  const hardFail = opts.hardFail ?? true;

  const history: ValidateOrRegenerateResult<TDoc>['history'] = [];

  let doc = initialDoc;
  let validation = validator.validate(doc, minScore);

  // Record initial attempt (attempt 0)
  history.push({
    attempt: 0,
    score: validation.score,
    errors: validation.errors,
    violations: validation.violations,
  });

  // If initial doc is valid, return immediately
  if (validation.ok) {
    return { ok: true, attempts: 0, doc, validation, history };
  }

  // Regeneration loop
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctx: RegenContext = {
      attempt,
      lastErrors: validation.errors,
      lastScore: validation.score,
      lastViolations: validation.violations,
    };

    // Call regeneration callback
    doc = await regenerate(ctx);
    validation = validator.validate(doc, minScore);

    // Record this attempt
    history.push({
      attempt,
      score: validation.score,
      errors: validation.errors,
      violations: validation.violations,
    });

    // If now valid, return success
    if (validation.ok) {
      return { ok: true, attempts: attempt, doc, validation, history };
    }
  }

  // All attempts exhausted
  const result: ValidateOrRegenerateResult<TDoc> = {
    ok: false,
    attempts: maxAttempts,
    doc,
    validation,
    history,
  };

  if (hardFail) {
    const last = history[history.length - 1];
    const msg =
      `BYON validation failed after ${maxAttempts} attempts.\n` +
      `last_score=${last.score} min_score=${minScore}\n` +
      `violations=${last.violations.join(',')}\n` +
      `errors:\n- ${last.errors.join('\n- ')}`;
    throw new Error(msg);
  }

  return result;
}

/**
 * Simple validation without regeneration
 * Use this when you just want to check if a document is valid
 */
export function validateByonDoc(doc: unknown, minScore = 85): ByonValidationResult {
  return validator.validate(doc, minScore);
}

/**
 * Get detailed report for a document
 */
export function getByonValidationReport(doc: unknown, minScore = 85): string {
  return validator.getDetailedReport(doc, minScore);
}

// Export the validator for advanced usage
export { validator as byonValidator };
