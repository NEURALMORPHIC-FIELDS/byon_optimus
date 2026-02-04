/**
 * Audit Trail Service
 *
 * Main entry point for the Immutable Audit Trail system.
 * Integrates with FHRSS+FCPE for persistent, fault-tolerant storage.
 *
 * Features:
 * - Immutable documents after execution
 * - User-only deletion for drafts (physical)
 * - Calendar indexing (hour, day, week, year)
 * - Semantic search via FHRSS+FCPE
 * - Timestamp ordering
 */
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { canDelete, attemptDelete, markAsExecuted, markAsFailed, transitionStatus, isTerminalState, } from './immutability.js';
import { createCalendarIndex, matchesCalendarQuery, sortByTimestamp, } from './calendar-index.js';
// Re-export types and utilities
export * from '../types/audit.js';
export * from './immutability.js';
export * from './calendar-index.js';
/**
 * In-memory storage for audit documents
 * In production, this should be backed by FHRSS+FCPE
 */
let auditStore = new Map();
/**
 * Compute SHA256 hash of content
 */
function computeHash(content) {
    return createHash('sha256')
        .update(JSON.stringify(content))
        .digest('hex');
}
/**
 * Create a new audit document
 *
 * @param type - Document type
 * @param content - Document content
 * @param createdBy - Who created the document
 * @param options - Additional options
 * @returns New AuditDocument
 */
export function createAuditDocument(type, content, createdBy, options) {
    const now = new Date().toISOString();
    const doc_id = randomUUID();
    const doc = {
        doc_id,
        doc_type: type,
        created_by: createdBy,
        created_at: now,
        calendar: createCalendarIndex(now),
        status: options?.status || 'draft',
        is_immutable: false,
        deletion: {
            deletion_allowed: true,
        },
        content,
        summary: options?.summary,
        tags: options?.tags,
        hash: computeHash(content),
        related_docs: options?.related_docs,
        has_embedding: false,
    };
    return doc;
}
/**
 * Store an audit document
 *
 * @param doc - Document to store
 * @returns Stored document with memory context ID
 */
export async function storeDocument(doc) {
    // Store in memory
    auditStore.set(doc.doc_id, doc);
    // TODO: Store in FHRSS+FCPE
    // const ctxId = await memory.storeAudit(doc);
    // doc.memory_ctx_id = ctxId;
    // doc.has_embedding = true;
    return doc;
}
/**
 * Get a document by ID
 *
 * @param docId - Document ID
 * @returns Document or null if not found
 */
export function getDocument(docId) {
    return auditStore.get(docId) || null;
}
/**
 * Update a document (if not immutable)
 *
 * @param docId - Document ID
 * @param updates - Partial updates
 * @returns Updated document or throws if immutable
 */
export async function updateDocument(docId, updates) {
    const doc = auditStore.get(docId);
    if (!doc) {
        throw new Error(`Document not found: ${docId}`);
    }
    if (doc.is_immutable) {
        throw new Error(`Cannot update immutable document: ${docId}`);
    }
    if (isTerminalState(doc)) {
        throw new Error(`Cannot update document in terminal state: ${doc.status}`);
    }
    const now = new Date().toISOString();
    const updatedDoc = {
        ...doc,
        ...updates,
        modified_at: now,
        hash: updates.content ? computeHash(updates.content) : doc.hash,
    };
    auditStore.set(docId, updatedDoc);
    return updatedDoc;
}
/**
 * Delete a document (physical deletion, user only)
 *
 * @param docId - Document ID
 * @param actor - Who is trying to delete
 * @param reason - Optional reason
 * @returns Delete result
 */
export function deleteDocument(docId, actor, reason) {
    const doc = auditStore.get(docId);
    if (!doc) {
        return {
            success: false,
            doc_id: docId,
            reason: 'Document not found',
        };
    }
    const result = attemptDelete(doc, actor, reason);
    if (result.success) {
        // Physical deletion
        auditStore.delete(docId);
        // TODO: Remove from FHRSS+FCPE storage
    }
    return result;
}
/**
 * Execute a document (marks as immutable)
 *
 * @param docId - Document ID
 * @returns Executed document
 */
export async function executeDocument(docId) {
    const doc = auditStore.get(docId);
    if (!doc) {
        throw new Error(`Document not found: ${docId}`);
    }
    const executedDoc = markAsExecuted(doc);
    auditStore.set(docId, executedDoc);
    return executedDoc;
}
/**
 * Fail a document (marks as immutable)
 *
 * @param docId - Document ID
 * @param reason - Failure reason
 * @returns Failed document
 */
export async function failDocument(docId, reason) {
    const doc = auditStore.get(docId);
    if (!doc) {
        throw new Error(`Document not found: ${docId}`);
    }
    const failedDoc = markAsFailed(doc, reason);
    auditStore.set(docId, failedDoc);
    return failedDoc;
}
/**
 * Transition document status
 *
 * @param docId - Document ID
 * @param newStatus - Target status
 * @returns Updated document
 */
export async function transitionDocumentStatus(docId, newStatus) {
    const doc = auditStore.get(docId);
    if (!doc) {
        throw new Error(`Document not found: ${docId}`);
    }
    const updatedDoc = transitionStatus(doc, newStatus);
    auditStore.set(docId, updatedDoc);
    return updatedDoc;
}
/**
 * Query audit documents
 *
 * @param options - Query options
 * @returns Query result with matching documents
 */
export async function queryDocuments(options) {
    const startTime = Date.now();
    let docs = Array.from(auditStore.values());
    // Filter by doc_type
    if (options.doc_type) {
        const types = Array.isArray(options.doc_type)
            ? options.doc_type
            : [options.doc_type];
        docs = docs.filter((d) => types.includes(d.doc_type));
    }
    // Filter by status
    if (options.status) {
        const statuses = Array.isArray(options.status)
            ? options.status
            : [options.status];
        docs = docs.filter((d) => statuses.includes(d.status));
    }
    // Filter by creator
    if (options.created_by) {
        docs = docs.filter((d) => d.created_by === options.created_by);
    }
    // Filter by tags
    if (options.tags && options.tags.length > 0) {
        docs = docs.filter((d) => d.tags && options.tags.some((t) => d.tags.includes(t)));
    }
    // Filter by calendar
    docs = docs.filter((d) => matchesCalendarQuery(d, options));
    // Sort
    docs = sortByTimestamp(docs, options.order_by || 'created_at', options.order_dir || 'desc');
    const totalCount = docs.length;
    // Apply limit
    if (options.limit) {
        docs = docs.slice(0, options.limit);
    }
    return {
        documents: docs,
        total_count: totalCount,
        query_time_ms: Date.now() - startTime,
    };
}
/**
 * Get documents by day
 *
 * @param day - Day in YYYY-MM-DD format
 * @returns Documents for that day
 */
export async function getDocumentsByDay(day) {
    const result = await queryDocuments({ day });
    return result.documents;
}
/**
 * Get documents by week
 *
 * @param week - Week in YYYY-WXX format
 * @returns Documents for that week
 */
export async function getDocumentsByWeek(week) {
    const result = await queryDocuments({ week });
    return result.documents;
}
/**
 * Get documents by hour
 *
 * @param hour - Hour in YYYY-MM-DD-HH format
 * @returns Documents for that hour
 */
export async function getDocumentsByHour(hour) {
    const result = await queryDocuments({ hour });
    return result.documents;
}
/**
 * Get documents by year
 *
 * @param year - Year in YYYY format
 * @returns Documents for that year
 */
export async function getDocumentsByYear(year) {
    const result = await queryDocuments({ year });
    return result.documents;
}
/**
 * Get executed documents (immutable history)
 *
 * @param options - Additional filter options
 * @returns Executed documents
 */
export async function getExecutedDocuments(options) {
    const result = await queryDocuments({
        ...options,
        status: 'executed',
    });
    return result.documents;
}
/**
 * Get pending documents (awaiting action)
 *
 * @param options - Additional filter options
 * @returns Pending documents
 */
export async function getPendingDocuments(options) {
    const result = await queryDocuments({
        ...options,
        status: 'pending',
    });
    return result.documents;
}
/**
 * Generate daily digest
 *
 * @param date - Date in YYYY-MM-DD format
 * @returns DailyDigest document
 */
export async function generateDailyDigest(date) {
    const docs = await getDocumentsByDay(date);
    const executedDocs = docs.filter((d) => d.status === 'executed');
    const failedDocs = docs.filter((d) => d.status === 'failed');
    // Count action types
    const actionCounts = new Map();
    for (const doc of docs) {
        const count = actionCounts.get(doc.doc_type) || 0;
        actionCounts.set(doc.doc_type, count + 1);
    }
    const topActions = Array.from(actionCounts.entries())
        .map(([action, count]) => ({ action, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
    const digest = createAuditDocument('daily_digest', {
        date,
        sessions_count: 0, // TODO: Count unique sessions
        total_events: docs.length,
        total_executions: executedDocs.length,
        total_failures: failedDocs.length,
        top_actions: topActions,
        summary_text: `${date}: ${docs.length} events, ${executedDocs.length} executed, ${failedDocs.length} failed`,
    }, 'system', {
        status: 'executed', // Digests are immediately immutable
        summary: `Daily digest for ${date}`,
        tags: ['digest', 'daily', date],
    });
    // Store and return
    await storeDocument(digest);
    return digest;
}
/**
 * Get audit trail statistics
 */
export function getAuditStats() {
    const docs = Array.from(auditStore.values());
    const byStatus = {
        draft: 0,
        pending: 0,
        approved: 0,
        executed: 0,
        failed: 0,
    };
    const byType = {};
    let immutableCount = 0;
    let deletableCount = 0;
    for (const doc of docs) {
        byStatus[doc.status]++;
        byType[doc.doc_type] = (byType[doc.doc_type] || 0) + 1;
        if (doc.is_immutable) {
            immutableCount++;
        }
        if (canDelete(doc, 'user')) {
            deletableCount++;
        }
    }
    return {
        total_documents: docs.length,
        by_status: byStatus,
        by_type: byType,
        immutable_count: immutableCount,
        deletable_count: deletableCount,
    };
}
/**
 * Clear all documents (for testing only)
 * @internal
 */
export function _clearStore() {
    auditStore.clear();
}
