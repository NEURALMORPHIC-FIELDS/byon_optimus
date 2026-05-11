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
 * Get ISO week number for a date
 *
 * @param date - Date to get week number for
 * @returns Week number (1-53)
 */
function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Get ISO week year (year the week belongs to)
 *
 * @param date - Date to get week year for
 * @returns Year the ISO week belongs to
 */
function getISOWeekYear(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  return d.getUTCFullYear();
}

/**
 * Create calendar index from a timestamp
 *
 * @param timestamp - ISO timestamp string or Date object
 * @returns CalendarIndex with hour, day, week, year
 */
export function createCalendarIndex(timestamp: string | Date): CalendarIndex {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');

  const weekNum = getISOWeekNumber(date);
  const weekYear = getISOWeekYear(date);

  return {
    hour: `${year}-${month}-${day}-${hour}`,      // 2026-02-01-14
    day: `${year}-${month}-${day}`,               // 2026-02-01
    week: `${weekYear}-W${String(weekNum).padStart(2, '0')}`,  // 2026-W05
    year: String(year),                            // 2026
  };
}

/**
 * Parse a calendar key into a date range
 *
 * @param key - Calendar key (hour, day, week, or year format)
 * @returns Object with start and end dates
 */
export function parseCalendarKey(key: string): { start: Date; end: Date } {
  // Hour format: YYYY-MM-DD-HH
  if (/^\d{4}-\d{2}-\d{2}-\d{2}$/.test(key)) {
    const [year, month, day, hour] = key.split('-').map(Number);
    const start = new Date(year, month - 1, day, hour, 0, 0, 0);
    const end = new Date(year, month - 1, day, hour, 59, 59, 999);
    return { start, end };
  }

  // Day format: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const [year, month, day] = key.split('-').map(Number);
    const start = new Date(year, month - 1, day, 0, 0, 0, 0);
    const end = new Date(year, month - 1, day, 23, 59, 59, 999);
    return { start, end };
  }

  // Week format: YYYY-WXX
  if (/^\d{4}-W\d{2}$/.test(key)) {
    const [yearStr, weekStr] = key.split('-W');
    const year = Number(yearStr);
    const week = Number(weekStr);

    // Find the first day of the ISO week
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const firstMonday = new Date(jan4);
    firstMonday.setDate(jan4.getDate() - dayOfWeek + 1);

    const start = new Date(firstMonday);
    start.setDate(firstMonday.getDate() + (week - 1) * 7);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  // Year format: YYYY
  if (/^\d{4}$/.test(key)) {
    const year = Number(key);
    const start = new Date(year, 0, 1, 0, 0, 0, 0);
    const end = new Date(year, 11, 31, 23, 59, 59, 999);
    return { start, end };
  }

  throw new Error(`Invalid calendar key format: ${key}`);
}

/**
 * Check if a document matches the calendar query options
 *
 * @param doc - Document to check
 * @param options - Query options with calendar filters
 * @returns Whether the document matches
 */
export function matchesCalendarQuery(
  doc: AuditDocument,
  options: AuditQueryOptions
): boolean {
  const { calendar } = doc;

  // Check hour filter
  if (options.hour && calendar.hour !== options.hour) {
    return false;
  }

  // Check day filter
  if (options.day && calendar.day !== options.day) {
    return false;
  }

  // Check week filter
  if (options.week && calendar.week !== options.week) {
    return false;
  }

  // Check year filter
  if (options.year && calendar.year !== options.year) {
    return false;
  }

  // Check date range
  if (options.date_range) {
    const { from, to } = options.date_range;
    const docDate = new Date(doc.created_at);
    const fromDate = new Date(from);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);

    if (docDate < fromDate || docDate > toDate) {
      return false;
    }
  }

  return true;
}

/**
 * Sort documents by timestamp
 *
 * @param docs - Documents to sort
 * @param orderBy - Field to sort by
 * @param orderDir - Sort direction
 * @returns Sorted documents
 */
export function sortByTimestamp(
  docs: AuditDocument[],
  orderBy: 'created_at' | 'executed_at' | 'modified_at' = 'created_at',
  orderDir: 'asc' | 'desc' = 'desc'
): AuditDocument[] {
  return [...docs].sort((a, b) => {
    const aTime = a[orderBy] ? new Date(a[orderBy]!).getTime() : 0;
    const bTime = b[orderBy] ? new Date(b[orderBy]!).getTime() : 0;

    return orderDir === 'asc' ? aTime - bTime : bTime - aTime;
  });
}

/**
 * Group documents by calendar granularity
 *
 * @param docs - Documents to group
 * @param granularity - Grouping granularity
 * @returns Map of calendar key to documents
 */
export function groupByCalendar(
  docs: AuditDocument[],
  granularity: 'hour' | 'day' | 'week' | 'year'
): Map<string, AuditDocument[]> {
  const groups = new Map<string, AuditDocument[]>();

  for (const doc of docs) {
    const key = doc.calendar[granularity];
    const existing = groups.get(key) || [];
    existing.push(doc);
    groups.set(key, existing);
  }

  return groups;
}

/**
 * Get all unique calendar keys from documents
 *
 * @param docs - Documents to extract keys from
 * @param granularity - Which calendar key to extract
 * @returns Sorted array of unique keys
 */
export function getUniqueCalendarKeys(
  docs: AuditDocument[],
  granularity: 'hour' | 'day' | 'week' | 'year'
): string[] {
  const keys = new Set<string>();
  for (const doc of docs) {
    keys.add(doc.calendar[granularity]);
  }
  return Array.from(keys).sort();
}

/**
 * Generate a date range of calendar keys
 *
 * @param from - Start date
 * @param to - End date
 * @param granularity - Granularity of keys
 * @returns Array of calendar keys
 */
export function generateCalendarRange(
  from: Date,
  to: Date,
  granularity: 'hour' | 'day' | 'week' | 'year'
): string[] {
  const keys: string[] = [];
  const current = new Date(from);

  while (current <= to) {
    const index = createCalendarIndex(current);
    const key = index[granularity];

    if (!keys.includes(key)) {
      keys.push(key);
    }

    // Increment based on granularity
    switch (granularity) {
      case 'hour':
        current.setHours(current.getHours() + 1);
        break;
      case 'day':
        current.setDate(current.getDate() + 1);
        break;
      case 'week':
        current.setDate(current.getDate() + 7);
        break;
      case 'year':
        current.setFullYear(current.getFullYear() + 1);
        break;
    }
  }

  return keys;
}

/**
 * Format calendar key for display
 *
 * @param key - Calendar key
 * @param granularity - Key granularity
 * @returns Human-readable string
 */
export function formatCalendarKey(
  key: string,
  granularity: 'hour' | 'day' | 'week' | 'year'
): string {
  switch (granularity) {
    case 'hour': {
      const [year, month, day, hour] = key.split('-');
      return `${day}/${month}/${year} ${hour}:00`;
    }
    case 'day': {
      const [year, month, day] = key.split('-');
      return `${day}/${month}/${year}`;
    }
    case 'week': {
      const [year, weekPart] = key.split('-');
      const week = weekPart.replace('W', '');
      return `Week ${week}, ${year}`;
    }
    case 'year':
      return key;
    default:
      return key;
  }
}
