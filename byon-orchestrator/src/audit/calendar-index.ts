/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Calendar Index
 * ==============
 *
 * Hierarchical calendar-based indexing for fast audit queries.
 * Indexes entries by year, month, week, day, and hour.
 *
 * Enables efficient time-range queries without scanning all entries.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface CalendarEntry {
    /** Entry ID */
    entry_id: string;
    /** Timestamp */
    timestamp: string;
    /** Document ID */
    document_id: string;
    /** Document type */
    document_type: string;
    /** Event type */
    event_type: string;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
}

export type IndexLevel = "year" | "month" | "week" | "day" | "hour";

export interface TimeRange {
    start: Date;
    end: Date;
}

export interface CalendarQuery {
    /** Specific year */
    year?: number;
    /** Specific month (1-12) */
    month?: number;
    /** Specific week of year (1-53) */
    week?: number;
    /** Specific day of month (1-31) */
    day?: number;
    /** Specific hour (0-23) */
    hour?: number;
    /** Document type filter */
    document_type?: string;
    /** Event type filter */
    event_type?: string;
    /** Limit results */
    limit?: number;
}

export interface CalendarStats {
    /** Total entries */
    total_entries: number;
    /** Entries per level */
    by_level: Record<IndexLevel, number>;
    /** Date range */
    date_range: {
        earliest: string;
        latest: string;
    };
    /** Entries by document type */
    by_document_type: Record<string, number>;
    /** Entries by event type */
    by_event_type: Record<string, number>;
}

// ============================================================================
// INDEX STRUCTURES
// ============================================================================

interface YearIndex {
    year: number;
    entries: Map<string, CalendarEntry>;
    months: Map<number, MonthIndex>;
    count: number;
}

interface MonthIndex {
    month: number;
    entries: Map<string, CalendarEntry>;
    weeks: Map<number, WeekIndex>;
    days: Map<number, DayIndex>;
    count: number;
}

interface WeekIndex {
    week: number;
    entries: Map<string, CalendarEntry>;
    count: number;
}

interface DayIndex {
    day: number;
    entries: Map<string, CalendarEntry>;
    hours: Map<number, HourIndex>;
    count: number;
}

interface HourIndex {
    hour: number;
    entries: Map<string, CalendarEntry>;
    count: number;
}

// ============================================================================
// CALENDAR INDEX
// ============================================================================

/**
 * Calendar Index
 *
 * Hierarchical time-based index for audit entries.
 */
export class CalendarIndex {
    private years: Map<number, YearIndex>;
    private allEntries: Map<string, CalendarEntry>;
    private earliest: Date | null;
    private latest: Date | null;

    constructor() {
        this.years = new Map();
        this.allEntries = new Map();
        this.earliest = null;
        this.latest = null;
    }

    /**
     * Add entry to index
     */
    add(entry: CalendarEntry): void {
        const date = new Date(entry.timestamp);

        // Update date range
        if (!this.earliest || date < this.earliest) {
            this.earliest = date;
        }
        if (!this.latest || date > this.latest) {
            this.latest = date;
        }

        // Store in all entries
        this.allEntries.set(entry.entry_id, entry);

        // Extract time components
        const year = date.getFullYear();
        const month = date.getMonth() + 1; // 1-12
        const week = this.getWeekOfYear(date);
        const day = date.getDate();
        const hour = date.getHours();

        // Get or create year index
        let yearIndex = this.years.get(year);
        if (!yearIndex) {
            yearIndex = {
                year,
                entries: new Map(),
                months: new Map(),
                count: 0
            };
            this.years.set(year, yearIndex);
        }
        yearIndex.entries.set(entry.entry_id, entry);
        yearIndex.count++;

        // Get or create month index
        let monthIndex = yearIndex.months.get(month);
        if (!monthIndex) {
            monthIndex = {
                month,
                entries: new Map(),
                weeks: new Map(),
                days: new Map(),
                count: 0
            };
            yearIndex.months.set(month, monthIndex);
        }
        monthIndex.entries.set(entry.entry_id, entry);
        monthIndex.count++;

        // Get or create week index
        let weekIndex = monthIndex.weeks.get(week);
        if (!weekIndex) {
            weekIndex = {
                week,
                entries: new Map(),
                count: 0
            };
            monthIndex.weeks.set(week, weekIndex);
        }
        weekIndex.entries.set(entry.entry_id, entry);
        weekIndex.count++;

        // Get or create day index
        let dayIndex = monthIndex.days.get(day);
        if (!dayIndex) {
            dayIndex = {
                day,
                entries: new Map(),
                hours: new Map(),
                count: 0
            };
            monthIndex.days.set(day, dayIndex);
        }
        dayIndex.entries.set(entry.entry_id, entry);
        dayIndex.count++;

        // Get or create hour index
        let hourIndex = dayIndex.hours.get(hour);
        if (!hourIndex) {
            hourIndex = {
                hour,
                entries: new Map(),
                count: 0
            };
            dayIndex.hours.set(hour, hourIndex);
        }
        hourIndex.entries.set(entry.entry_id, entry);
        hourIndex.count++;
    }

    /**
     * Remove entry from index
     */
    remove(entryId: string): boolean {
        const entry = this.allEntries.get(entryId);
        if (!entry) {return false;}

        const date = new Date(entry.timestamp);
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const week = this.getWeekOfYear(date);
        const day = date.getDate();
        const hour = date.getHours();

        // Remove from all indices
        this.allEntries.delete(entryId);

        const yearIndex = this.years.get(year);
        if (yearIndex) {
            yearIndex.entries.delete(entryId);
            yearIndex.count--;

            const monthIndex = yearIndex.months.get(month);
            if (monthIndex) {
                monthIndex.entries.delete(entryId);
                monthIndex.count--;

                const weekIndex = monthIndex.weeks.get(week);
                if (weekIndex) {
                    weekIndex.entries.delete(entryId);
                    weekIndex.count--;
                }

                const dayIndex = monthIndex.days.get(day);
                if (dayIndex) {
                    dayIndex.entries.delete(entryId);
                    dayIndex.count--;

                    const hourIndex = dayIndex.hours.get(hour);
                    if (hourIndex) {
                        hourIndex.entries.delete(entryId);
                        hourIndex.count--;
                    }
                }
            }
        }

        return true;
    }

    /**
     * Query entries
     */
    query(query: CalendarQuery): CalendarEntry[] {
        let entries: CalendarEntry[] = [];

        // Start with most specific level
        if (query.year !== undefined) {
            const yearIndex = this.years.get(query.year);
            if (!yearIndex) {return [];}

            if (query.month !== undefined) {
                const monthIndex = yearIndex.months.get(query.month);
                if (!monthIndex) {return [];}

                if (query.day !== undefined) {
                    const dayIndex = monthIndex.days.get(query.day);
                    if (!dayIndex) {return [];}

                    if (query.hour !== undefined) {
                        const hourIndex = dayIndex.hours.get(query.hour);
                        if (!hourIndex) {return [];}
                        entries = Array.from(hourIndex.entries.values());
                    } else {
                        entries = Array.from(dayIndex.entries.values());
                    }
                } else if (query.week !== undefined) {
                    const weekIndex = monthIndex.weeks.get(query.week);
                    if (!weekIndex) {return [];}
                    entries = Array.from(weekIndex.entries.values());
                } else {
                    entries = Array.from(monthIndex.entries.values());
                }
            } else {
                entries = Array.from(yearIndex.entries.values());
            }
        } else {
            entries = Array.from(this.allEntries.values());
        }

        // Apply filters
        if (query.document_type) {
            entries = entries.filter(e => e.document_type === query.document_type);
        }
        if (query.event_type) {
            entries = entries.filter(e => e.event_type === query.event_type);
        }

        // Sort by timestamp descending
        entries.sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        // Apply limit
        if (query.limit) {
            entries = entries.slice(0, query.limit);
        }

        return entries;
    }

    /**
     * Query entries in time range
     */
    queryRange(range: TimeRange): CalendarEntry[] {
        return Array.from(this.allEntries.values())
            .filter(e => {
                const date = new Date(e.timestamp);
                return date >= range.start && date <= range.end;
            })
            .sort((a, b) =>
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            );
    }

    /**
     * Get entries for today
     */
    getToday(): CalendarEntry[] {
        const now = new Date();
        return this.query({
            year: now.getFullYear(),
            month: now.getMonth() + 1,
            day: now.getDate()
        });
    }

    /**
     * Get entries for this week
     */
    getThisWeek(): CalendarEntry[] {
        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 7);

        return this.queryRange({ start: startOfWeek, end: endOfWeek });
    }

    /**
     * Get entries for this month
     */
    getThisMonth(): CalendarEntry[] {
        const now = new Date();
        return this.query({
            year: now.getFullYear(),
            month: now.getMonth() + 1
        });
    }

    /**
     * Get count at level
     */
    getCount(level: IndexLevel, ...components: number[]): number {
        switch (level) {
            case "year":
                if (components[0] !== undefined) {
                    return this.years.get(components[0])?.count || 0;
                }
                return this.allEntries.size;

            case "month":
                if (components[0] !== undefined && components[1] !== undefined) {
                    return this.years.get(components[0])?.months.get(components[1])?.count || 0;
                }
                return 0;

            case "week":
                if (components[0] !== undefined && components[1] !== undefined && components[2] !== undefined) {
                    return this.years.get(components[0])?.months.get(components[1])?.weeks.get(components[2])?.count || 0;
                }
                return 0;

            case "day":
                if (components[0] !== undefined && components[1] !== undefined && components[2] !== undefined) {
                    return this.years.get(components[0])?.months.get(components[1])?.days.get(components[2])?.count || 0;
                }
                return 0;

            case "hour":
                if (components.length >= 4) {
                    return this.years.get(components[0])?.months.get(components[1])
                        ?.days.get(components[2])?.hours.get(components[3])?.count || 0;
                }
                return 0;
        }
    }

    /**
     * Get available years
     */
    getYears(): number[] {
        return Array.from(this.years.keys()).sort((a, b) => b - a);
    }

    /**
     * Get available months for year
     */
    getMonths(year: number): number[] {
        const yearIndex = this.years.get(year);
        if (!yearIndex) {return [];}
        return Array.from(yearIndex.months.keys()).sort((a, b) => b - a);
    }

    /**
     * Get available days for month
     */
    getDays(year: number, month: number): number[] {
        const monthIndex = this.years.get(year)?.months.get(month);
        if (!monthIndex) {return [];}
        return Array.from(monthIndex.days.keys()).sort((a, b) => b - a);
    }

    /**
     * Get statistics
     */
    getStats(): CalendarStats {
        const byDocType: Record<string, number> = {};
        const byEventType: Record<string, number> = {};

        for (const entry of this.allEntries.values()) {
            byDocType[entry.document_type] = (byDocType[entry.document_type] || 0) + 1;
            byEventType[entry.event_type] = (byEventType[entry.event_type] || 0) + 1;
        }

        // Count at each level
        let months = 0, weeks = 0, days = 0, hours = 0;
        for (const yearIndex of this.years.values()) {
            months += yearIndex.months.size;
            for (const monthIndex of yearIndex.months.values()) {
                weeks += monthIndex.weeks.size;
                days += monthIndex.days.size;
                for (const dayIndex of monthIndex.days.values()) {
                    hours += dayIndex.hours.size;
                }
            }
        }

        return {
            total_entries: this.allEntries.size,
            by_level: {
                year: this.years.size,
                month: months,
                week: weeks,
                day: days,
                hour: hours
            },
            date_range: {
                earliest: this.earliest?.toISOString() || "",
                latest: this.latest?.toISOString() || ""
            },
            by_document_type: byDocType,
            by_event_type: byEventType
        };
    }

    /**
     * Get week of year (ISO week number)
     */
    private getWeekOfYear(date: Date): number {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    }

    /**
     * Export index
     */
    export(): CalendarEntry[] {
        return Array.from(this.allEntries.values());
    }

    /**
     * Import entries
     */
    import(entries: CalendarEntry[]): void {
        for (const entry of entries) {
            this.add(entry);
        }
    }

    /**
     * Clear index
     */
    clear(): void {
        this.years.clear();
        this.allEntries.clear();
        this.earliest = null;
        this.latest = null;
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create calendar index
 */
export function createCalendarIndex(): CalendarIndex {
    return new CalendarIndex();
}

/**
 * Create calendar entry from audit data
 */
export function createCalendarEntry(
    entryId: string,
    timestamp: string,
    documentId: string,
    documentType: string,
    eventType: string,
    metadata?: Record<string, unknown>
): CalendarEntry {
    return {
        entry_id: entryId,
        timestamp,
        document_id: documentId,
        document_type: documentType,
        event_type: eventType,
        metadata
    };
}
