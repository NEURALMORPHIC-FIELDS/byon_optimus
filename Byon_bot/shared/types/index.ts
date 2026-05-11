/**
 * Shared Types Index
 * Re-exports all protocol types and adapters for easy importing
 */

export * from './protocol.js';

// Re-export adapter functions explicitly for clarity
export {
  isSimplifiedAction,
  isCanonicalAction,
  toCanonicalAction,
  toCanonicalActions,
} from './protocol.js';
