/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Daily Digest Generator
 * ======================
 *
 * Generates daily summary reports from audit trail data.
 * Provides activity metrics, state changes, and highlights.
 */

import { AuditRecord, AuditEventType } from "./audit-service.js";
import { CalendarIndex, CalendarEntry } from "./calendar-index.js";
import { DocumentState } from "./document-states.js";

// ============================================================================
// TYPES
// ============================================================================

export interface DailyDigest {
    /** Digest ID */
    digest_id: string;
    /** Date of digest (YYYY-MM-DD) */
    date: string;
    /** Generation timestamp */
    generated_at: string;
    /** Summary metrics */
    summary: DigestSummary;
    /** Activity breakdown by hour */
    hourly_activity: HourlyActivity[];
    /** Documents processed */
    documents: DocumentDigest[];
    /** State changes */
    state_changes: StateChangeDigest[];
    /** Errors and failures */
    errors: ErrorDigest[];
    /** Highlights */
    highlights: string[];
}

export interface DigestSummary {
    /** Total events */
    total_events: number;
    /** Events by type */
    events_by_type: Record<AuditEventType, number>;
    /** Documents created */
    documents_created: number;
    /** Documents executed */
    documents_executed: number;
    /** Documents failed */
    documents_failed: number;
    /** Approval rate (approved / (approved + denied)) */
    approval_rate: number;
    /** Success rate (executed / (executed + failed)) */
    success_rate: number;
    /** Unique actors */
    unique_actors: number;
    /** Peak activity hour */
    peak_hour: number;
    /** Peak activity count */
    peak_count: number;
}

export interface HourlyActivity {
    /** Hour (0-23) */
    hour: number;
    /** Event count */
    count: number;
    /** Events by type */
    by_type: Record<string, number>;
}

export interface DocumentDigest {
    /** Document ID */
    document_id: string;
    /** Document type */
    document_type: string;
    /** Final state */
    final_state: DocumentState;
    /** State transitions count */
    transitions: number;
    /** Events count */
    events: number;
    /** Actors involved */
    actors: string[];
}

export interface StateChangeDigest {
    /** Document ID */
    document_id: string;
    /** From state */
    from_state: DocumentState;
    /** To state */
    to_state: DocumentState;
    /** Timestamp */
    timestamp: string;
    /** Actor */
    actor: string;
    /** Reason */
    reason?: string;
}

export interface ErrorDigest {
    /** Document ID */
    document_id: string;
    /** Error type */
    error_type: string;
    /** Error message */
    error_message: string;
    /** Timestamp */
    timestamp: string;
    /** Actor */
    actor: string;
}

export interface DigestGeneratorConfig {
    /** Include detailed hourly breakdown */
    includeHourlyBreakdown: boolean;
    /** Include document details */
    includeDocumentDetails: boolean;
    /** Maximum documents to include */
    maxDocuments: number;
    /** Maximum errors to include */
    maxErrors: number;
    /** Generate highlights */
    generateHighlights: boolean;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: DigestGeneratorConfig = {
    includeHourlyBreakdown: true,
    includeDocumentDetails: true,
    maxDocuments: 50,
    maxErrors: 20,
    generateHighlights: true
};

// ============================================================================
// DAILY DIGEST GENERATOR
// ============================================================================

/**
 * Daily Digest Generator
 *
 * Creates daily summary reports from audit data.
 */
export class DailyDigestGenerator {
    private config: DigestGeneratorConfig;

    constructor(config: Partial<DigestGeneratorConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Generate digest from audit records
     */
    generate(
        date: Date,
        records: AuditRecord[]
    ): DailyDigest {
        const dateStr = this.formatDate(date);
        const digestId = `digest_${dateStr}_${Date.now()}`;

        // Filter records for the specific date
        const dayRecords = this.filterRecordsForDate(records, date);

        // Generate summary
        const summary = this.generateSummary(dayRecords);

        // Generate hourly activity
        const hourlyActivity = this.config.includeHourlyBreakdown
            ? this.generateHourlyActivity(dayRecords)
            : [];

        // Generate document digests
        const documents = this.config.includeDocumentDetails
            ? this.generateDocumentDigests(dayRecords)
            : [];

        // Generate state changes
        const stateChanges = this.extractStateChanges(dayRecords);

        // Generate errors
        const errors = this.extractErrors(dayRecords);

        // Generate highlights
        const highlights = this.config.generateHighlights
            ? this.generateHighlights(summary, documents, errors)
            : [];

        return {
            digest_id: digestId,
            date: dateStr,
            generated_at: new Date().toISOString(),
            summary,
            hourly_activity: hourlyActivity,
            documents,
            state_changes: stateChanges,
            errors,
            highlights
        };
    }

    /**
     * Generate digest from calendar index
     */
    generateFromCalendar(
        date: Date,
        calendarIndex: CalendarIndex
    ): DailyDigest {
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();

        const entries = calendarIndex.query({ year, month, day });

        // Convert calendar entries to pseudo-records for processing
        const records: AuditRecord[] = entries.map(e => ({
            record_id: e.entry_id,
            timestamp: e.timestamp,
            event_type: e.event_type as AuditEventType,
            document_id: e.document_id,
            document_type: e.document_type,
            actor: (e.metadata?.actor as string) || "unknown",
            details: e.metadata || {},
            chain_hash: "",
            document_state: (e.metadata?.state as DocumentState) || "draft"
        }));

        return this.generate(date, records);
    }

    /**
     * Filter records for specific date
     */
    private filterRecordsForDate(records: AuditRecord[], date: Date): AuditRecord[] {
        const dateStr = this.formatDate(date);
        return records.filter(r => {
            const recordDate = this.formatDate(new Date(r.timestamp));
            return recordDate === dateStr;
        });
    }

    /**
     * Generate summary metrics
     */
    private generateSummary(records: AuditRecord[]): DigestSummary {
        const eventsByType: Record<AuditEventType, number> = {
            document_created: 0,
            document_updated: 0,
            document_deleted: 0,
            state_changed: 0,
            approval_requested: 0,
            approval_granted: 0,
            approval_denied: 0,
            execution_started: 0,
            execution_completed: 0,
            execution_failed: 0,
            error_occurred: 0,
            system_event: 0
        };

        const actors = new Set<string>();
        const hourCounts: Record<number, number> = {};

        for (const record of records) {
            eventsByType[record.event_type]++;
            actors.add(record.actor);

            const hour = new Date(record.timestamp).getHours();
            hourCounts[hour] = (hourCounts[hour] || 0) + 1;
        }

        // Find peak hour
        let peakHour = 0;
        let peakCount = 0;
        for (const [hour, count] of Object.entries(hourCounts)) {
            if (count > peakCount) {
                peakHour = parseInt(hour);
                peakCount = count;
            }
        }

        // Calculate rates
        const approved = eventsByType.approval_granted;
        const denied = eventsByType.approval_denied;
        const approvalRate = (approved + denied) > 0
            ? approved / (approved + denied)
            : 0;

        const executed = eventsByType.execution_completed;
        const failed = eventsByType.execution_failed;
        const successRate = (executed + failed) > 0
            ? executed / (executed + failed)
            : 0;

        return {
            total_events: records.length,
            events_by_type: eventsByType,
            documents_created: eventsByType.document_created,
            documents_executed: eventsByType.execution_completed,
            documents_failed: eventsByType.execution_failed,
            approval_rate: Math.round(approvalRate * 100) / 100,
            success_rate: Math.round(successRate * 100) / 100,
            unique_actors: actors.size,
            peak_hour: peakHour,
            peak_count: peakCount
        };
    }

    /**
     * Generate hourly activity breakdown
     */
    private generateHourlyActivity(records: AuditRecord[]): HourlyActivity[] {
        const hourlyData: Map<number, { count: number; byType: Record<string, number> }> = new Map();

        // Initialize all hours
        for (let h = 0; h < 24; h++) {
            hourlyData.set(h, { count: 0, byType: {} });
        }

        for (const record of records) {
            const hour = new Date(record.timestamp).getHours();
            const data = hourlyData.get(hour)!;
            data.count++;
            data.byType[record.event_type] = (data.byType[record.event_type] || 0) + 1;
        }

        return Array.from(hourlyData.entries())
            .map(([hour, data]) => ({
                hour,
                count: data.count,
                by_type: data.byType
            }))
            .sort((a, b) => a.hour - b.hour);
    }

    /**
     * Generate document digests
     */
    private generateDocumentDigests(records: AuditRecord[]): DocumentDigest[] {
        const docMap = new Map<string, {
            document_type: string;
            states: DocumentState[];
            events: number;
            actors: Set<string>;
        }>();

        for (const record of records) {
            if (!docMap.has(record.document_id)) {
                docMap.set(record.document_id, {
                    document_type: record.document_type,
                    states: [],
                    events: 0,
                    actors: new Set()
                });
            }

            const doc = docMap.get(record.document_id)!;
            doc.events++;
            doc.actors.add(record.actor);

            if (record.event_type === "state_changed") {
                doc.states.push(record.document_state);
            }
        }

        const digests: DocumentDigest[] = [];
        for (const [docId, data] of docMap) {
            digests.push({
                document_id: docId,
                document_type: data.document_type,
                final_state: data.states[data.states.length - 1] || "draft",
                transitions: data.states.length,
                events: data.events,
                actors: Array.from(data.actors)
            });
        }

        return digests
            .sort((a, b) => b.events - a.events)
            .slice(0, this.config.maxDocuments);
    }

    /**
     * Extract state changes
     */
    private extractStateChanges(records: AuditRecord[]): StateChangeDigest[] {
        return records
            .filter(r => r.event_type === "state_changed")
            .map(r => ({
                document_id: r.document_id,
                from_state: (r.details.from as DocumentState) || "draft",
                to_state: (r.details.to as DocumentState) || r.document_state,
                timestamp: r.timestamp,
                actor: r.actor,
                reason: r.details.reason as string | undefined
            }))
            .sort((a, b) =>
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            );
    }

    /**
     * Extract errors
     */
    private extractErrors(records: AuditRecord[]): ErrorDigest[] {
        return records
            .filter(r =>
                r.event_type === "error_occurred" ||
                r.event_type === "execution_failed"
            )
            .map(r => ({
                document_id: r.document_id,
                error_type: r.event_type,
                error_message: (r.details.error as string) || "Unknown error",
                timestamp: r.timestamp,
                actor: r.actor
            }))
            .sort((a, b) =>
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            )
            .slice(0, this.config.maxErrors);
    }

    /**
     * Generate highlights
     */
    private generateHighlights(
        summary: DigestSummary,
        documents: DocumentDigest[],
        errors: ErrorDigest[]
    ): string[] {
        const highlights: string[] = [];

        // Activity highlights
        if (summary.total_events > 0) {
            highlights.push(`${summary.total_events} total events recorded`);
        }

        if (summary.documents_created > 0) {
            highlights.push(`${summary.documents_created} documents created`);
        }

        if (summary.documents_executed > 0) {
            highlights.push(`${summary.documents_executed} documents executed successfully`);
        }

        // Success/failure highlights
        if (summary.success_rate >= 0.95) {
            highlights.push(`Excellent success rate: ${Math.round(summary.success_rate * 100)}%`);
        } else if (summary.success_rate < 0.5 && summary.documents_failed > 0) {
            highlights.push(`Warning: Low success rate (${Math.round(summary.success_rate * 100)}%)`);
        }

        // Approval highlights
        if (summary.approval_rate >= 0.9) {
            highlights.push(`High approval rate: ${Math.round(summary.approval_rate * 100)}%`);
        } else if (summary.approval_rate < 0.5 && summary.events_by_type.approval_denied > 0) {
            highlights.push(`Notice: Many approvals denied (${Math.round(summary.approval_rate * 100)}% approval rate)`);
        }

        // Peak activity
        if (summary.peak_count > 10) {
            highlights.push(`Peak activity at ${summary.peak_hour}:00 with ${summary.peak_count} events`);
        }

        // Error highlights
        if (errors.length > 5) {
            highlights.push(`${errors.length} errors occurred - review recommended`);
        }

        // Actor highlights
        if (summary.unique_actors > 1) {
            highlights.push(`${summary.unique_actors} unique actors participated`);
        }

        return highlights;
    }

    /**
     * Format date as YYYY-MM-DD
     */
    private formatDate(date: Date): string {
        return date.toISOString().split("T")[0];
    }

    /**
     * Generate weekly digest
     */
    generateWeekly(
        startDate: Date,
        records: AuditRecord[]
    ): DailyDigest[] {
        const digests: DailyDigest[] = [];
        const current = new Date(startDate);

        for (let i = 0; i < 7; i++) {
            digests.push(this.generate(current, records));
            current.setDate(current.getDate() + 1);
        }

        return digests;
    }

    /**
     * Compare two digests
     */
    compare(digest1: DailyDigest, digest2: DailyDigest): {
        events_change: number;
        success_rate_change: number;
        approval_rate_change: number;
        errors_change: number;
    } {
        return {
            events_change: digest2.summary.total_events - digest1.summary.total_events,
            success_rate_change: digest2.summary.success_rate - digest1.summary.success_rate,
            approval_rate_change: digest2.summary.approval_rate - digest1.summary.approval_rate,
            errors_change: digest2.errors.length - digest1.errors.length
        };
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create daily digest generator
 */
export function createDailyDigestGenerator(
    config?: Partial<DigestGeneratorConfig>
): DailyDigestGenerator {
    return new DailyDigestGenerator(config);
}

/**
 * Generate quick digest for today
 */
export function generateTodayDigest(records: AuditRecord[]): DailyDigest {
    const generator = new DailyDigestGenerator();
    return generator.generate(new Date(), records);
}
