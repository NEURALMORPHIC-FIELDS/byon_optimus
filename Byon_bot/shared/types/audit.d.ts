/**
 * Immutable Audit Trail Types
 *
 * Digital Paper Trail system for Byon Bot.
 * All agent actions are documented, timestamped, and stored in FHRSS+FCPE.
 *
 * IMMUTABILITY RULES:
 * - Agents can NEVER delete documents
 * - User can delete ONLY draft/pending/approved (physical deletion)
 * - EXECUTED/FAILED documents are PERMANENT and IMMUTABLE
 * - Calendar indexing: hour, day, week, year
 */
/**
 * Document lifecycle status
 */
export type AuditStatus = 'draft' | 'pending' | 'approved' | 'executed' | 'failed';
/**
 * Document types in the audit trail
 */
export type AuditDocumentType = 'evidence_pack' | 'plan_draft' | 'approval_request' | 'execution_order' | 'johnson_receipt' | 'session_report' | 'daily_digest' | 'error_log';
/**
 * Calendar index entry for time-based queries
 */
export interface CalendarIndex {
    /** Hour: YYYY-MM-DD-HH (e.g., 2026-02-01-14) */
    hour: string;
    /** Day: YYYY-MM-DD (e.g., 2026-02-01) */
    day: string;
    /** Week: YYYY-WXX (e.g., 2026-W05) */
    week: string;
    /** Year: YYYY (e.g., 2026) */
    year: string;
}
/**
 * Deletion control - enforces immutability rules
 */
export interface DeletionControl {
    /** Whether deletion is allowed (false after execution) */
    deletion_allowed: boolean;
    /** Who deleted (only 'user' possible, never 'agent') */
    deleted_by?: 'user';
    /** When deleted (ISO timestamp) */
    deleted_at?: string;
    /** Reason for deletion (optional) */
    deletion_reason?: string;
}
/**
 * Core Audit Document structure
 *
 * Every action in the system generates an AuditDocument
 * that is stored in FHRSS+FCPE memory.
 */
export interface AuditDocument {
    /** Unique document ID (UUID) */
    doc_id: string;
    /** Type of document */
    doc_type: AuditDocumentType;
    /** Agent that created this document */
    created_by: 'worker' | 'auditor' | 'executor' | 'user' | 'system';
    /** When document was created (ISO timestamp) */
    created_at: string;
    /** When document was last modified (ISO timestamp) */
    modified_at?: string;
    /** When document was executed (ISO timestamp) - triggers immutability */
    executed_at?: string;
    /** Calendar index for time-based queries */
    calendar: CalendarIndex;
    /** Current status */
    status: AuditStatus;
    /** Whether document is immutable (true after execution) */
    is_immutable: boolean;
    /** Deletion control */
    deletion: DeletionControl;
    /** Document content (varies by type) */
    content: Record<string, unknown>;
    /** Human-readable summary */
    summary?: string;
    /** Tags for categorization */
    tags?: string[];
    /** SHA256 hash of content */
    hash: string;
    /** Reference to related documents */
    related_docs?: string[];
    /** FHRSS+FCPE context ID (for retrieval) */
    memory_ctx_id?: number;
    /** Embedding vector stored */
    has_embedding: boolean;
}
/**
 * Query options for searching audit trail
 */
export interface AuditQueryOptions {
    /** Filter by document type */
    doc_type?: AuditDocumentType | AuditDocumentType[];
    /** Filter by status */
    status?: AuditStatus | AuditStatus[];
    /** Filter by creator */
    created_by?: AuditDocument['created_by'];
    /** Filter by date range */
    date_range?: {
        from: string;
        to: string;
    };
    /** Filter by specific hour */
    hour?: string;
    /** Filter by specific day */
    day?: string;
    /** Filter by specific week */
    week?: string;
    /** Filter by specific year */
    year?: string;
    /** Filter by tags */
    tags?: string[];
    /** Semantic search query */
    semantic_query?: string;
    /** Maximum results */
    limit?: number;
    /** Order by */
    order_by?: 'created_at' | 'executed_at' | 'modified_at';
    /** Order direction */
    order_dir?: 'asc' | 'desc';
}
/**
 * Result of an audit query
 */
export interface AuditQueryResult {
    /** Matching documents */
    documents: AuditDocument[];
    /** Total count (before limit) */
    total_count: number;
    /** Query execution time (ms) */
    query_time_ms: number;
}
/**
 * Session report - generated per session
 */
export interface SessionReport extends AuditDocument {
    doc_type: 'session_report';
    content: {
        session_id: string;
        start_time: string;
        end_time?: string;
        events_count: number;
        actions_executed: number;
        actions_failed: number;
        documents_created: string[];
    };
}
/**
 * Daily digest - generated daily
 */
export interface DailyDigest extends AuditDocument {
    doc_type: 'daily_digest';
    content: {
        date: string;
        sessions_count: number;
        total_events: number;
        total_executions: number;
        total_failures: number;
        top_actions: Array<{
            action: string;
            count: number;
        }>;
        summary_text: string;
    };
}
/**
 * Actor type for permission checks
 */
export type Actor = 'user' | 'agent';
/**
 * Delete request result
 */
export interface DeleteResult {
    success: boolean;
    doc_id: string;
    reason?: string;
}
