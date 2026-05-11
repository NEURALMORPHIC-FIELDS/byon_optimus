/**
 * Calendar Index for Audit Trail
 *
 * Provides time-based indexing and querying for audit documents.
 * Granularity levels: hour, day, week, year
 *
 * Documents are indexed by timestamp ordering (not blockchain-style).
 */
import type { CalendarIndex, AuditDocument, AuditQueryOptions } from '../types/audit.js';
/**
 * Create calendar index from a timestamp
 *
 * @param timestamp - ISO timestamp string or Date object
 * @returns CalendarIndex with hour, day, week, year
 */
export declare function createCalendarIndex(timestamp: string | Date): CalendarIndex;
/**
 * Parse a calendar key into a date range
 *
 * @param key - Calendar key (hour, day, week, or year format)
 * @returns Object with start and end dates
 */
export declare function parseCalendarKey(key: string): {
    start: Date;
    end: Date;
};
/**
 * Check if a document matches the calendar query options
 *
 * @param doc - Document to check
 * @param options - Query options with calendar filters
 * @returns Whether the document matches
 */
export declare function matchesCalendarQuery(doc: AuditDocument, options: AuditQueryOptions): boolean;
/**
 * Sort documents by timestamp
 *
 * @param docs - Documents to sort
 * @param orderBy - Field to sort by
 * @param orderDir - Sort direction
 * @returns Sorted documents
 */
export declare function sortByTimestamp(docs: AuditDocument[], orderBy?: 'created_at' | 'executed_at' | 'modified_at', orderDir?: 'asc' | 'desc'): AuditDocument[];
/**
 * Group documents by calendar granularity
 *
 * @param docs - Documents to group
 * @param granularity - Grouping granularity
 * @returns Map of calendar key to documents
 */
export declare function groupByCalendar(docs: AuditDocument[], granularity: 'hour' | 'day' | 'week' | 'year'): Map<string, AuditDocument[]>;
/**
 * Get all unique calendar keys from documents
 *
 * @param docs - Documents to extract keys from
 * @param granularity - Which calendar key to extract
 * @returns Sorted array of unique keys
 */
export declare function getUniqueCalendarKeys(docs: AuditDocument[], granularity: 'hour' | 'day' | 'week' | 'year'): string[];
/**
 * Generate a date range of calendar keys
 *
 * @param from - Start date
 * @param to - End date
 * @param granularity - Granularity of keys
 * @returns Array of calendar keys
 */
export declare function generateCalendarRange(from: Date, to: Date, granularity: 'hour' | 'day' | 'week' | 'year'): string[];
/**
 * Format calendar key for display
 *
 * @param key - Calendar key
 * @param granularity - Key granularity
 * @returns Human-readable string
 */
export declare function formatCalendarKey(key: string, granularity: 'hour' | 'day' | 'week' | 'year'): string;
