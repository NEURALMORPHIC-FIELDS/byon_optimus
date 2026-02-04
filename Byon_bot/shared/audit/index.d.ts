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
import type { AuditDocument, AuditDocumentType, AuditStatus, AuditQueryOptions, AuditQueryResult, Actor, DeleteResult, DailyDigest } from '../types/audit.js';
export * from '../types/audit.js';
export * from './immutability.js';
export * from './calendar-index.js';
/**
 * Create a new audit document
 *
 * @param type - Document type
 * @param content - Document content
 * @param createdBy - Who created the document
 * @param options - Additional options
 * @returns New AuditDocument
 */
export declare function createAuditDocument(type: AuditDocumentType, content: Record<string, unknown>, createdBy: AuditDocument['created_by'], options?: {
    status?: AuditStatus;
    summary?: string;
    tags?: string[];
    related_docs?: string[];
}): AuditDocument;
/**
 * Store an audit document
 *
 * @param doc - Document to store
 * @returns Stored document with memory context ID
 */
export declare function storeDocument(doc: AuditDocument): Promise<AuditDocument>;
/**
 * Get a document by ID
 *
 * @param docId - Document ID
 * @returns Document or null if not found
 */
export declare function getDocument(docId: string): AuditDocument | null;
/**
 * Update a document (if not immutable)
 *
 * @param docId - Document ID
 * @param updates - Partial updates
 * @returns Updated document or throws if immutable
 */
export declare function updateDocument(docId: string, updates: Partial<Pick<AuditDocument, 'content' | 'summary' | 'tags'>>): Promise<AuditDocument>;
/**
 * Delete a document (physical deletion, user only)
 *
 * @param docId - Document ID
 * @param actor - Who is trying to delete
 * @param reason - Optional reason
 * @returns Delete result
 */
export declare function deleteDocument(docId: string, actor: Actor, reason?: string): DeleteResult;
/**
 * Execute a document (marks as immutable)
 *
 * @param docId - Document ID
 * @returns Executed document
 */
export declare function executeDocument(docId: string): Promise<AuditDocument>;
/**
 * Fail a document (marks as immutable)
 *
 * @param docId - Document ID
 * @param reason - Failure reason
 * @returns Failed document
 */
export declare function failDocument(docId: string, reason: string): Promise<AuditDocument>;
/**
 * Transition document status
 *
 * @param docId - Document ID
 * @param newStatus - Target status
 * @returns Updated document
 */
export declare function transitionDocumentStatus(docId: string, newStatus: AuditStatus): Promise<AuditDocument>;
/**
 * Query audit documents
 *
 * @param options - Query options
 * @returns Query result with matching documents
 */
export declare function queryDocuments(options: AuditQueryOptions): Promise<AuditQueryResult>;
/**
 * Get documents by day
 *
 * @param day - Day in YYYY-MM-DD format
 * @returns Documents for that day
 */
export declare function getDocumentsByDay(day: string): Promise<AuditDocument[]>;
/**
 * Get documents by week
 *
 * @param week - Week in YYYY-WXX format
 * @returns Documents for that week
 */
export declare function getDocumentsByWeek(week: string): Promise<AuditDocument[]>;
/**
 * Get documents by hour
 *
 * @param hour - Hour in YYYY-MM-DD-HH format
 * @returns Documents for that hour
 */
export declare function getDocumentsByHour(hour: string): Promise<AuditDocument[]>;
/**
 * Get documents by year
 *
 * @param year - Year in YYYY format
 * @returns Documents for that year
 */
export declare function getDocumentsByYear(year: string): Promise<AuditDocument[]>;
/**
 * Get executed documents (immutable history)
 *
 * @param options - Additional filter options
 * @returns Executed documents
 */
export declare function getExecutedDocuments(options?: Omit<AuditQueryOptions, 'status'>): Promise<AuditDocument[]>;
/**
 * Get pending documents (awaiting action)
 *
 * @param options - Additional filter options
 * @returns Pending documents
 */
export declare function getPendingDocuments(options?: Omit<AuditQueryOptions, 'status'>): Promise<AuditDocument[]>;
/**
 * Generate daily digest
 *
 * @param date - Date in YYYY-MM-DD format
 * @returns DailyDigest document
 */
export declare function generateDailyDigest(date: string): Promise<DailyDigest>;
/**
 * Get audit trail statistics
 */
export declare function getAuditStats(): {
    total_documents: number;
    by_status: Record<AuditStatus, number>;
    by_type: Record<string, number>;
    immutable_count: number;
    deletable_count: number;
};
/**
 * Clear all documents (for testing only)
 * @internal
 */
export declare function _clearStore(): void;
