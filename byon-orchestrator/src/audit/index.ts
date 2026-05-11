/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON Audit Module
 * =================
 *
 * Immutable audit trail with hash chain and calendar indexing.
 *
 * Exports:
 * - AuditService: Central audit service
 * - HashChain: Tamper-evident chain
 * - DocumentStateManager: Lifecycle management
 * - CalendarIndex: Time-based indexing
 * - DailyDigestGenerator: Summary reports
 */

// ============================================================================
// HASH CHAIN
// ============================================================================

export {
    // Main class
    HashChain,

    // Types
    type HashChainEntry,
    type ChainEntryType,
    type ChainVerificationResult,
    type HashChainConfig,

    // Factory
    createHashChain,

    // Utilities
    calculateDocumentHash,
    verifyExportedChain
} from "./hash-chain.js";

// ============================================================================
// DOCUMENT STATES
// ============================================================================

export {
    // Main class
    DocumentStateManager,

    // Types
    type DocumentState,
    type DocumentStateInfo,
    type StateTransition,
    type DocumentWithState,
    type StateTransitionRequest,
    type StateTransitionResult,

    // Factory
    createDocumentStateManager,

    // Utilities
    getStateInfo,
    isTerminalState,
    stateAllowsModification,
    getAllowedTransitions
} from "./document-states.js";

// ============================================================================
// AUDIT SERVICE
// ============================================================================

export {
    // Main class
    AuditService,

    // Types
    type AuditRecord,
    type AuditEventType,
    type AuditQuery,
    type AuditServiceConfig,
    type AuditSnapshot,

    // Factory
    createAuditService
} from "./audit-service.js";

// ============================================================================
// CALENDAR INDEX
// ============================================================================

export {
    // Main class
    CalendarIndex,

    // Types
    type CalendarEntry,
    type IndexLevel,
    type TimeRange,
    type CalendarQuery,
    type CalendarStats,

    // Factory
    createCalendarIndex,
    createCalendarEntry
} from "./calendar-index.js";

// ============================================================================
// DAILY DIGEST
// ============================================================================

export {
    // Main class
    DailyDigestGenerator,

    // Types
    type DailyDigest,
    type DigestSummary,
    type HourlyActivity,
    type DocumentDigest,
    type StateChangeDigest,
    type ErrorDigest,
    type DigestGeneratorConfig,

    // Factory
    createDailyDigestGenerator,
    generateTodayDigest
} from "./daily-digest.js";

// ============================================================================
// INTEGRATED AUDIT SYSTEM
// ============================================================================

import { AuditService, AuditRecord, createAuditService } from "./audit-service.js";
import { CalendarIndex, createCalendarIndex, createCalendarEntry } from "./calendar-index.js";
import { DailyDigestGenerator, createDailyDigestGenerator, DailyDigest } from "./daily-digest.js";

/**
 * Integrated Audit System
 *
 * Combines AuditService, CalendarIndex, and DailyDigestGenerator.
 */
export class IntegratedAuditSystem {
    private auditService: AuditService;
    private calendarIndex: CalendarIndex;
    private digestGenerator: DailyDigestGenerator;

    constructor() {
        this.auditService = createAuditService();
        this.calendarIndex = createCalendarIndex();
        this.digestGenerator = createDailyDigestGenerator();
    }

    /**
     * Get audit service
     */
    getAuditService(): AuditService {
        return this.auditService;
    }

    /**
     * Get calendar index
     */
    getCalendarIndex(): CalendarIndex {
        return this.calendarIndex;
    }

    /**
     * Get digest generator
     */
    getDigestGenerator(): DailyDigestGenerator {
        return this.digestGenerator;
    }

    /**
     * Log document creation and index
     */
    logAndIndexDocumentCreated(
        documentId: string,
        documentType: string,
        document: unknown,
        actor: string
    ): AuditRecord {
        const record = this.auditService.logDocumentCreated(
            documentId,
            documentType,
            document,
            actor
        );

        this.calendarIndex.add(createCalendarEntry(
            record.record_id,
            record.timestamp,
            record.document_id,
            record.document_type,
            record.event_type,
            { actor, state: record.document_state }
        ));

        return record;
    }

    /**
     * Log state change and index
     */
    logAndIndexStateChange(
        documentId: string,
        newState: string,
        actor: string,
        reason: string
    ): AuditRecord {
        const { record } = this.auditService.logStateChange(
            documentId,
            newState as any,
            actor,
            reason
        );

        this.calendarIndex.add(createCalendarEntry(
            record.record_id,
            record.timestamp,
            record.document_id,
            record.document_type,
            record.event_type,
            { actor, state: record.document_state, reason }
        ));

        return record;
    }

    /**
     * Generate today's digest
     */
    getTodayDigest(): DailyDigest {
        return this.digestGenerator.generateFromCalendar(
            new Date(),
            this.calendarIndex
        );
    }

    /**
     * Query by time range
     */
    queryTimeRange(start: Date, end: Date): AuditRecord[] {
        return this.auditService.query({
            start_time: start,
            end_time: end
        });
    }

    /**
     * Get statistics
     */
    getStats(): {
        audit: ReturnType<AuditService["getStats"]>;
        calendar: ReturnType<CalendarIndex["getStats"]>;
    } {
        return {
            audit: this.auditService.getStats(),
            calendar: this.calendarIndex.getStats()
        };
    }

    /**
     * Verify chain integrity
     */
    verify(): ReturnType<AuditService["verify"]> {
        return this.auditService.verify();
    }

    /**
     * Cleanup
     */
    cleanup(): void {
        this.auditService.cleanup();
    }
}

/**
 * Create integrated audit system
 */
export function createIntegratedAuditSystem(): IntegratedAuditSystem {
    return new IntegratedAuditSystem();
}
