/**
 * Immutability Engine for Audit Trail
 *
 * HARD-CODED RULES:
 * 1. Agents can NEVER delete documents
 * 2. User can delete ONLY draft/pending/approved documents
 * 3. EXECUTED/FAILED documents are PERMANENT - NO ONE can delete
 * 4. Physical deletion (not soft delete) for allowed cases
 *
 * These rules are intentionally NOT configurable.
 * They are the foundation of the audit trail integrity.
 */
import type { AuditDocument, AuditStatus, Actor, DeleteResult } from '../types/audit.js';
/**
 * Check if an actor can delete a document
 *
 * @param doc - The document to check
 * @param actor - Who is trying to delete ('user' or 'agent')
 * @returns Whether deletion is allowed
 *
 * RULES (HARD-CODED, NOT CONFIGURABLE):
 * - Agents NEVER delete (always returns false for agent)
 * - User can delete draft/pending/approved
 * - No one can delete executed/failed
 * - Already deleted documents cannot be deleted again
 */
export declare function canDelete(doc: AuditDocument, actor: Actor): boolean;
/**
 * Get the reason why deletion is not allowed
 *
 * @param doc - The document to check
 * @param actor - Who is trying to delete
 * @returns Reason string or null if deletion is allowed
 */
export declare function getDeleteBlockReason(doc: AuditDocument, actor: Actor): string | null;
/**
 * Mark a document as executed, triggering immutability
 *
 * Once a document is executed:
 * - is_immutable = true
 * - deletion_allowed = false
 * - executed_at = current timestamp
 * - status = 'executed'
 *
 * This operation is IRREVERSIBLE.
 *
 * @param doc - The document to mark as executed
 * @returns Updated document with immutability applied
 */
export declare function markAsExecuted(doc: AuditDocument): AuditDocument;
/**
 * Mark a document as failed, triggering immutability
 *
 * Failed documents are also PERMANENT for audit purposes.
 * We need to keep a record of what failed and why.
 *
 * @param doc - The document to mark as failed
 * @param reason - Why the document failed
 * @returns Updated document with immutability applied
 */
export declare function markAsFailed(doc: AuditDocument, reason: string): AuditDocument;
/**
 * Attempt to delete a document (physical deletion)
 *
 * This function checks permissions and returns a result.
 * Actual deletion from storage should be performed by the caller
 * only if success is true.
 *
 * @param doc - The document to delete
 * @param actor - Who is trying to delete
 * @param reason - Optional reason for deletion
 * @returns DeleteResult with success status and reason
 */
export declare function attemptDelete(doc: AuditDocument, actor: Actor, reason?: string): DeleteResult;
/**
 * Transition a document to a new status
 *
 * Validates that the transition is allowed.
 *
 * @param doc - Current document
 * @param newStatus - Target status
 * @returns Updated document or throws if transition not allowed
 */
export declare function transitionStatus(doc: AuditDocument, newStatus: AuditStatus): AuditDocument;
/**
 * Check if a document is in a terminal (immutable) state
 */
export declare function isTerminalState(doc: AuditDocument): boolean;
/**
 * Get all deletable statuses (for UI/API documentation)
 */
export declare function getDeletableStatuses(): readonly AuditStatus[];
/**
 * Get all immutable statuses (for UI/API documentation)
 */
export declare function getImmutableStatuses(): readonly AuditStatus[];
