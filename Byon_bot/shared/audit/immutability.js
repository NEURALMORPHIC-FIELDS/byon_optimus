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
/**
 * Statuses that are PERMANENTLY IMMUTABLE
 * Documents in these statuses can NEVER be deleted by anyone
 */
const IMMUTABLE_STATUSES = ['executed', 'failed'];
/**
 * Statuses that allow deletion (by user only)
 */
const DELETABLE_STATUSES = ['draft', 'pending', 'approved'];
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
export function canDelete(doc, actor) {
    // RULE 1: Agents can NEVER delete documents
    // This is HARD-CODED and intentionally not configurable
    if (actor === 'agent') {
        return false;
    }
    // RULE 2: Already deleted documents cannot be deleted again
    if (doc.deletion.deleted_at) {
        return false;
    }
    // RULE 3: Immutable documents cannot be deleted by ANYONE
    if (doc.is_immutable) {
        return false;
    }
    // RULE 4: Executed/Failed status = PERMANENT
    if (IMMUTABLE_STATUSES.includes(doc.status)) {
        return false;
    }
    // RULE 5: Deletion control flag check
    if (!doc.deletion.deletion_allowed) {
        return false;
    }
    // RULE 6: Only deletable statuses can be deleted
    if (!DELETABLE_STATUSES.includes(doc.status)) {
        return false;
    }
    // Only user can delete, and only for draft/pending/approved
    return actor === 'user';
}
/**
 * Get the reason why deletion is not allowed
 *
 * @param doc - The document to check
 * @param actor - Who is trying to delete
 * @returns Reason string or null if deletion is allowed
 */
export function getDeleteBlockReason(doc, actor) {
    if (actor === 'agent') {
        return 'SECURITY: Agents are NEVER allowed to delete documents';
    }
    if (doc.deletion.deleted_at) {
        return 'Document has already been deleted';
    }
    if (doc.is_immutable) {
        return 'Document is marked as immutable';
    }
    if (IMMUTABLE_STATUSES.includes(doc.status)) {
        return `PERMANENT: Documents with status '${doc.status}' can NEVER be deleted`;
    }
    if (!doc.deletion.deletion_allowed) {
        return 'Document deletion has been explicitly disabled';
    }
    if (!DELETABLE_STATUSES.includes(doc.status)) {
        return `Status '${doc.status}' does not allow deletion`;
    }
    return null; // Deletion is allowed
}
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
export function markAsExecuted(doc) {
    const now = new Date().toISOString();
    return {
        ...doc,
        status: 'executed',
        executed_at: now,
        modified_at: now,
        is_immutable: true,
        deletion: {
            ...doc.deletion,
            deletion_allowed: false,
            // Clear any deletion fields since this is now permanent
            deleted_by: undefined,
            deleted_at: undefined,
            deletion_reason: undefined,
        },
    };
}
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
export function markAsFailed(doc, reason) {
    const now = new Date().toISOString();
    return {
        ...doc,
        status: 'failed',
        modified_at: now,
        is_immutable: true,
        deletion: {
            ...doc.deletion,
            deletion_allowed: false,
        },
        content: {
            ...doc.content,
            failure_reason: reason,
            failed_at: now,
        },
    };
}
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
export function attemptDelete(doc, actor, reason) {
    const blockReason = getDeleteBlockReason(doc, actor);
    if (blockReason) {
        return {
            success: false,
            doc_id: doc.doc_id,
            reason: blockReason,
        };
    }
    // Deletion is allowed - return success
    // Caller should perform physical deletion from storage
    return {
        success: true,
        doc_id: doc.doc_id,
        reason: reason || 'User requested deletion',
    };
}
/**
 * Transition a document to a new status
 *
 * Validates that the transition is allowed.
 *
 * @param doc - Current document
 * @param newStatus - Target status
 * @returns Updated document or throws if transition not allowed
 */
export function transitionStatus(doc, newStatus) {
    // Cannot transition immutable documents
    if (doc.is_immutable) {
        throw new Error(`Cannot transition immutable document ${doc.doc_id}`);
    }
    // Validate transition
    const validTransitions = {
        draft: ['pending', 'approved'],
        pending: ['approved', 'draft'], // Can go back to draft
        approved: ['executed', 'failed', 'pending'], // Can reject back
        executed: [], // Terminal state
        failed: [], // Terminal state
    };
    const allowed = validTransitions[doc.status];
    if (!allowed.includes(newStatus)) {
        throw new Error(`Invalid transition: ${doc.status} -> ${newStatus} for document ${doc.doc_id}`);
    }
    const now = new Date().toISOString();
    // Handle special cases
    if (newStatus === 'executed') {
        return markAsExecuted(doc);
    }
    if (newStatus === 'failed') {
        return markAsFailed(doc, 'Status transition to failed');
    }
    // Normal transition
    return {
        ...doc,
        status: newStatus,
        modified_at: now,
    };
}
/**
 * Check if a document is in a terminal (immutable) state
 */
export function isTerminalState(doc) {
    return doc.is_immutable || IMMUTABLE_STATUSES.includes(doc.status);
}
/**
 * Get all deletable statuses (for UI/API documentation)
 */
export function getDeletableStatuses() {
    return DELETABLE_STATUSES;
}
/**
 * Get all immutable statuses (for UI/API documentation)
 */
export function getImmutableStatuses() {
    return IMMUTABLE_STATUSES;
}
