/**
 * BYON Style Contract Module
 *
 * Enforces strict style rules for agent outputs:
 * - No psychology / empathy / therapeutic language
 * - No stories or metaphors
 * - No meta-commentary
 * - Structured, administrative output only
 *
 * @example
 * ```typescript
 * import { validate_or_regenerate, validateByonDoc } from '@byon-bot/shared/style';
 *
 * // Simple validation
 * const result = validateByonDoc(agentOutput);
 * if (!result.ok) {
 *   console.error('Style violations:', result.violations);
 * }
 *
 * // With regeneration loop
 * const validated = await validate_or_regenerate(agentOutput, async (ctx) => {
 *   return await llm.regenerate(agentOutput, ctx.lastErrors);
 * });
 * ```
 */

export * from './byon_validator.js';
export * from './validate_or_regenerate.js';

// Re-export schema for direct access
export { default as byonContractSchema } from './byon_contract.schema.json' with { type: 'json' };
