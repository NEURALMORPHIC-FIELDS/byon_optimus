/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Audit Types - Immutable Audit Trail
 * ====================================
 *
 * Type definitions for BYON audit system:
 * - Audit entries with hash chain
 * - Calendar indexing
 * - Document state tracking
 */

import { DocumentState, ExecutionStatus } from "./protocol.js";

// ============================================================================
// AUDIT ENTRY
// ============================================================================

/** Type of audit event */
export type AuditEventType =
    | "document_created"
    | "document_state_changed"
    | "execution_started"
    | "execution_completed"
    | "approval_requested"
    | "approval_granted"
    | "approval_denied"
    | "signature_verified"
    | "signature_failed"
    | "policy_violation"
    | "gmv_summary_updated";

/** Audit entry in the trail */
export interface AuditEntry {
    /** Unique entry ID */
    entry_id: string;

    /** Timestamp ISO8601 */
    timestamp: string;

    /** Type of event */
    event_type: AuditEventType;

    /** Document ID this relates to */
    document_id: string;

    /** Document type */
    document_type: string;

    /** Previous state (if state change) */
    previous_state?: DocumentState;

    /** New state (if state change) */
    new_state?: DocumentState;

    /** Actor (user, agent, system) */
    actor: string;

    /** Event details */
    details: Record<string, unknown>;

    /** Hash of this entry */
    entry_hash: string;

    /** Hash of previous entry (chain) */
    previous_hash: string;
}

// ============================================================================
// HASH CHAIN
// ============================================================================

/** Hash chain state */
export interface HashChainState {
    /** Current chain length */
    length: number;

    /** Last entry hash */
    last_hash: string;

    /** Genesis hash */
    genesis_hash: string;

    /** Chain is valid */
    valid: boolean;

    /** Last validation timestamp */
    last_validated: string;
}

// ============================================================================
// CALENDAR INDEX
// ============================================================================

/** Calendar index levels */
export type CalendarLevel = "year" | "month" | "week" | "day" | "hour";

/** Calendar index entry */
export interface CalendarIndexEntry {
    /** Level of granularity */
    level: CalendarLevel;

    /** Period identifier (e.g., "2026", "2026-02", "2026-W05", "2026-02-01", "2026-02-01T14") */
    period: string;

    /** Entry IDs in this period */
    entry_ids: string[];

    /** Count by event type */
    event_counts: Record<AuditEventType, number>;

    /** First entry timestamp */
    first_entry: string;

    /** Last entry timestamp */
    last_entry: string;
}

// ============================================================================
// DAILY DIGEST
// ============================================================================

/** Daily digest summary */
export interface DailyDigest {
    /** Date (YYYY-MM-DD) */
    date: string;

    /** Generated timestamp */
    generated_at: string;

    /** Total events */
    total_events: number;

    /** Events by type */
    events_by_type: Record<AuditEventType, number>;

    /** Documents processed */
    documents_processed: {
        evidence_packs: number;
        plan_drafts: number;
        approval_requests: number;
        execution_orders: number;
        receipts: number;
    };

    /** Execution summary */
    executions: {
        total: number;
        successful: number;
        failed: number;
        partial: number;
    };

    /** Policy violations */
    policy_violations: number;

    /** Signature failures */
    signature_failures: number;

    /** GMV state at end of day */
    gmv_state?: {
        coherence: number;
        entropy_level: string;
        active_attractors: number;
    };
}

// ============================================================================
// AUDIT SERVICE API
// ============================================================================

/** Audit service API interface */
export interface AuditServiceAPI {
    // Write operations
    logEvent(
        eventType: AuditEventType,
        documentId: string,
        documentType: string,
        actor: string,
        details: Record<string, unknown>
    ): Promise<AuditEntry>;

    logStateChange(
        documentId: string,
        documentType: string,
        previousState: DocumentState,
        newState: DocumentState,
        actor: string
    ): Promise<AuditEntry>;

    // Read operations
    getEntry(entryId: string): Promise<AuditEntry | null>;
    getEntriesForDocument(documentId: string): Promise<AuditEntry[]>;
    getEntriesByTimeRange(start: string, end: string): Promise<AuditEntry[]>;
    getEntriesByType(eventType: AuditEventType, limit?: number): Promise<AuditEntry[]>;

    // Calendar index
    getCalendarIndex(level: CalendarLevel, period: string): Promise<CalendarIndexEntry | null>;

    // Digest
    getDailyDigest(date: string): Promise<DailyDigest | null>;
    generateDailyDigest(date: string): Promise<DailyDigest>;

    // Verification
    verifyChain(): Promise<HashChainState>;
    verifyEntry(entryId: string): Promise<boolean>;

    // Stats
    getChainState(): Promise<HashChainState>;
}
