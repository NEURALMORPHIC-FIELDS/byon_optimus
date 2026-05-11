/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * GMV Store - SQLite Metadata Storage
 * ====================================
 *
 * Storage layer pentru Global Memory Vitalizer.
 * Stochează DOAR metadata (attractors, summary) - NU date din memorie.
 *
 * GMV Constraints:
 * - Scrie doar în propria bază de date
 * - Nu modifică FHRSS+FCPE sau audit trail
 * - Low resource footprint
 */

import Database from "better-sqlite3";
import { Attractor, GlobalMemorySummary, GMVConfig, DEFAULT_GMV_CONFIG, GMVReadOnlyAPI } from "./types.js";

// ============================================================================
// GMV STORE
// ============================================================================

export class GMVStore implements GMVReadOnlyAPI {
    private db: Database.Database;
    private config: GMVConfig;

    constructor(config: Partial<GMVConfig> = {}) {
        this.config = { ...DEFAULT_GMV_CONFIG, ...config };
        this.db = new Database(this.config.db_path);
        this.init();
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    private init(): void {
        this.db.exec(`
            -- Attractors table
            CREATE TABLE IF NOT EXISTS attractors (
                attractor_id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                data TEXT NOT NULL,
                last_activity TEXT NOT NULL,
                score REAL NOT NULL DEFAULT 0
            );

            -- Global summary (singleton)
            CREATE TABLE IF NOT EXISTS summary (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL,
                timestamp TEXT NOT NULL
            );

            -- Indexes for fast queries
            CREATE INDEX IF NOT EXISTS idx_attractors_score ON attractors(score DESC);
            CREATE INDEX IF NOT EXISTS idx_attractors_activity ON attractors(last_activity DESC);
        `);
    }

    // ========================================================================
    // WRITE OPERATIONS (internal use only)
    // ========================================================================

    /**
     * Save or update an attractor
     */
    saveAttractor(attractor: Attractor): void {
        this.db.prepare(`
            INSERT INTO attractors (attractor_id, label, data, last_activity, score)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(attractor_id)
            DO UPDATE SET
                label = excluded.label,
                data = excluded.data,
                last_activity = excluded.last_activity,
                score = excluded.score
        `).run(
            attractor.attractor_id,
            attractor.label,
            JSON.stringify(attractor),
            attractor.last_activity,
            attractor.score
        );
    }

    /**
     * Save attractors in batch (transaction)
     */
    saveAttractors(attractors: Attractor[]): void {
        const insert = this.db.prepare(`
            INSERT INTO attractors (attractor_id, label, data, last_activity, score)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(attractor_id)
            DO UPDATE SET
                label = excluded.label,
                data = excluded.data,
                last_activity = excluded.last_activity,
                score = excluded.score
        `);

        const transaction = this.db.transaction((items: Attractor[]) => {
            for (const a of items) {
                insert.run(a.attractor_id, a.label, JSON.stringify(a), a.last_activity, a.score);
            }
        });

        transaction(attractors);
    }

    /**
     * Save global summary (singleton)
     */
    saveSummary(summary: GlobalMemorySummary): void {
        this.db.prepare(`
            INSERT INTO summary (id, data, timestamp)
            VALUES (1, ?, ?)
            ON CONFLICT(id)
            DO UPDATE SET
                data = excluded.data,
                timestamp = excluded.timestamp
        `).run(JSON.stringify(summary), summary.timestamp);
    }

    /**
     * Delete stale attractors (no activity in N days)
     */
    pruneStaleAttractors(daysThreshold: number): number {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysThreshold);

        const result = this.db.prepare(`
            DELETE FROM attractors
            WHERE last_activity < ?
        `).run(cutoff.toISOString());

        return result.changes;
    }

    // ========================================================================
    // READ-ONLY API (GMVReadOnlyAPI implementation)
    // ========================================================================

    /**
     * Get current global summary
     */
    getGlobalMemorySummary(): GlobalMemorySummary | null {
        const row = this.db.prepare(`
            SELECT data FROM summary WHERE id = 1
        `).get() as { data: string } | undefined;

        return row ? JSON.parse(row.data) : null;
    }

    /**
     * Get top N attractors by score
     */
    getTopAttractors(n: number): Attractor[] {
        const rows = this.db.prepare(`
            SELECT data FROM attractors
            ORDER BY score DESC
            LIMIT ?
        `).all(n) as { data: string }[];

        return rows.map(r => JSON.parse(r.data));
    }

    /**
     * Get attractor by ID
     */
    getAttractor(attractorId: string): Attractor | null {
        const row = this.db.prepare(`
            SELECT data FROM attractors WHERE attractor_id = ?
        `).get(attractorId) as { data: string } | undefined;

        return row ? JSON.parse(row.data) : null;
    }

    /**
     * Get attractors for a specific domain
     */
    getAttractorsByDomain(domain: string): Attractor[] {
        // SQLite JSON search - domains is stored in data as JSON array
        const rows = this.db.prepare(`
            SELECT data FROM attractors
            WHERE json_extract(data, '$.domains') LIKE ?
            ORDER BY score DESC
        `).all(`%"${domain}"%`) as { data: string }[];

        return rows.map(r => JSON.parse(r.data));
    }

    /**
     * Get all attractors
     */
    getAllAttractors(): Attractor[] {
        const rows = this.db.prepare(`
            SELECT data FROM attractors ORDER BY score DESC
        `).all() as { data: string }[];

        return rows.map(r => JSON.parse(r.data));
    }

    /**
     * Get attractor count
     */
    getAttractorCount(): number {
        const row = this.db.prepare(`
            SELECT COUNT(*) as count FROM attractors
        `).get() as { count: number };

        return row.count;
    }

    // ========================================================================
    // STATS
    // ========================================================================

    /**
     * Get GMV stats
     */
    getStats(): {
        attractor_count: number;
        has_summary: boolean;
        last_summary_timestamp: string | null;
        top_domain: string | null;
    } {
        const count = this.getAttractorCount();
        const summary = this.getGlobalMemorySummary();

        return {
            attractor_count: count,
            has_summary: summary !== null,
            last_summary_timestamp: summary?.timestamp || null,
            top_domain: summary?.dominant_domains[0]?.domain || null
        };
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    /**
     * Close database connection
     */
    close(): void {
        this.db.close();
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a GMV store instance
 */
export function createGMVStore(config?: Partial<GMVConfig>): GMVStore {
    return new GMVStore(config);
}

/**
 * Create a read-only API instance (for consumers)
 */
export function createGMVReadOnlyAPI(config?: Partial<GMVConfig>): GMVReadOnlyAPI {
    return new GMVStore(config);
}
