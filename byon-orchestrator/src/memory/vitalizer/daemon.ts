/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * GMV Daemon - Global Memory Vitalizer
 * =====================================
 *
 * Proces continuu, low-CPU, care menține starea globală emergentă a memoriei.
 *
 * CE FACE:
 * - Citește read-only din FHRSS+FCPE și audit trail
 * - Produce metadata (Attractors + GlobalMemorySummary)
 * - Menține store-ul SQLite local
 *
 * CE NU FACE:
 * - NU comunică cu userul
 * - NU execută acțiuni
 * - NU generează text conversațional
 * - NU decide nimic
 * - NU are acces la executor sau canale
 *
 * CONSTRAINTS:
 * - Zero network access
 * - Zero executor access
 * - Zero channel access
 * - Low CPU / Low RAM
 */

import { GMVStore, createGMVStore } from "./store.js";
import { buildAttractors, decayAttractors, filterWeakAttractors } from "./attractor-engine.js";
import { computeSummary, detectChanges, checkSystemHealth } from "./coherence-calculator.js";
import { MemoryEvent, AuditEvent, GMVConfig, DEFAULT_GMV_CONFIG, GlobalMemorySummary } from "./types.js";

// ============================================================================
// TYPES
// ============================================================================

export interface GMVDaemonState {
    running: boolean;
    last_cycle: string | null;
    cycles_completed: number;
    errors: string[];
}

export interface GMVDaemonOptions extends Partial<GMVConfig> {
    /** Memory event reader function */
    readMemoryEvents?: () => MemoryEvent[] | Promise<MemoryEvent[]>;

    /** Audit event reader function */
    readAuditEvents?: () => AuditEvent[] | Promise<AuditEvent[]>;

    /** Callback on summary update */
    onSummaryUpdate?: (summary: GlobalMemorySummary) => void;

    /** Enable verbose logging */
    verbose?: boolean;
}

// ============================================================================
// DEFAULT READERS (stubs - replace with actual FHRSS+FCPE integration)
// ============================================================================

/**
 * Default memory event reader (stub)
 * Replace with actual FHRSS+FCPE client
 */
function defaultReadMemoryEvents(): MemoryEvent[] {
    // TODO: Integrate with FHRSS+FCPE memory service
    // This should read recent events from the memory store
    return [];
}

/**
 * Default audit event reader (stub)
 * Replace with actual audit trail client
 */
function defaultReadAuditEvents(): AuditEvent[] {
    // TODO: Integrate with audit trail service
    // This should read recent audit events
    return [];
}

// ============================================================================
// GMV DAEMON CLASS
// ============================================================================

export class GMVDaemon {
    private store: GMVStore;
    private config: GMVConfig;
    private options: GMVDaemonOptions;
    private state: GMVDaemonState;
    private intervalId: ReturnType<typeof setInterval> | null = null;

    constructor(options: GMVDaemonOptions = {}) {
        this.config = { ...DEFAULT_GMV_CONFIG, ...options };
        this.options = options;
        this.store = createGMVStore(this.config);
        this.state = {
            running: false,
            last_cycle: null,
            cycles_completed: 0,
            errors: []
        };
    }

    // ========================================================================
    // LIFECYCLE
    // ========================================================================

    /**
     * Start the GMV daemon
     */
    start(): void {
        if (this.state.running) {
            this.log("GMV daemon already running");
            return;
        }

        this.log("Starting GMV daemon...");
        this.state.running = true;

        // Run first cycle immediately
        this.runCycle().catch(this.handleError.bind(this));

        // Schedule periodic cycles
        this.intervalId = setInterval(
            () => this.runCycle().catch(this.handleError.bind(this)),
            this.config.interval_ms
        );

        this.log(`GMV daemon started (interval: ${this.config.interval_ms}ms)`);
    }

    /**
     * Stop the GMV daemon
     */
    stop(): void {
        if (!this.state.running) {
            return;
        }

        this.log("Stopping GMV daemon...");

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.state.running = false;
        this.log("GMV daemon stopped");
    }

    /**
     * Get current state
     */
    getState(): GMVDaemonState {
        return { ...this.state };
    }

    // ========================================================================
    // MAIN CYCLE
    // ========================================================================

    /**
     * Run a single GMV cycle
     */
    async runCycle(): Promise<void> {
        const cycleStart = new Date();
        this.log(`Starting cycle ${this.state.cycles_completed + 1}...`);

        try {
            // 1. Read memory events
            const readMemory = this.options.readMemoryEvents || defaultReadMemoryEvents;
            const memoryEvents = await readMemory();

            // 2. Read audit events (optional)
            const readAudit = this.options.readAuditEvents || defaultReadAuditEvents;
            const auditEvents = await readAudit();

            // 3. Convert audit events to memory events (for attractor building)
            const auditAsMemory = this.convertAuditToMemoryEvents(auditEvents);
            const allEvents = [...memoryEvents, ...auditAsMemory];

            if (allEvents.length === 0) {
                this.log("No events to process");
                this.state.cycles_completed++;
                this.state.last_cycle = cycleStart.toISOString();
                return;
            }

            // 4. Get existing attractors
            const existingAttractors = this.store.getAllAttractors();

            // 5. Build new attractors
            const attractors = buildAttractors(allEvents, existingAttractors, {
                minSupport: this.config.min_support,
                recencyDecay: this.config.recency_decay,
                now: cycleStart
            });

            // 6. Decay and filter
            const decayed = decayAttractors(attractors, this.config.recency_decay, cycleStart);
            const filtered = filterWeakAttractors(decayed, 0.01);

            // 7. Save attractors
            this.store.saveAttractors(filtered);

            // 8. Prune stale attractors
            const pruned = this.store.pruneStaleAttractors(this.config.stagnant_threshold_days * 2);
            if (pruned > 0) {
                this.log(`Pruned ${pruned} stale attractors`);
            }

            // 9. Compute new summary
            const previousSummary = this.store.getGlobalMemorySummary();
            const newSummary = computeSummary(filtered, {
                maxActiveAttractors: this.config.max_active_attractors,
                stagnantThresholdDays: this.config.stagnant_threshold_days,
                now: cycleStart
            });

            // 10. Save summary
            this.store.saveSummary(newSummary);

            // 11. Detect and log changes
            const changes = detectChanges(previousSummary, newSummary);
            if (changes.entropy_changed) {
                this.log(`Entropy level changed to: ${newSummary.entropy_level}`);
            }
            if (changes.new_attractors.length > 0) {
                this.log(`New attractors: ${changes.new_attractors.length}`);
            }

            // 12. Health check
            const health = checkSystemHealth(newSummary);
            if (!health.healthy) {
                for (const warning of health.warnings) {
                    this.log(`[WARN] ${warning}`);
                }
            }

            // 13. Callback
            if (this.options.onSummaryUpdate) {
                this.options.onSummaryUpdate(newSummary);
            }

            // Update state
            this.state.cycles_completed++;
            this.state.last_cycle = cycleStart.toISOString();

            const duration = Date.now() - cycleStart.getTime();
            this.log(`Cycle completed in ${duration}ms (attractors: ${filtered.length}, coherence: ${newSummary.system_coherence})`);

        } catch (error) {
            this.handleError(error);
        }
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    /**
     * Convert audit events to memory events for processing
     */
    private convertAuditToMemoryEvents(auditEvents: AuditEvent[]): MemoryEvent[] {
        return auditEvents.map((ae, index) => ({
            ctx_id: -1 - index, // Negative IDs for audit events
            embedding: [], // No embedding for audit events
            timestamp: ae.timestamp,
            domains: ae.domains,
            memory_type: "fact" as const
        }));
    }

    /**
     * Handle errors
     */
    private handleError(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.log(`[ERROR] ${message}`);

        this.state.errors.push(message);

        // Keep only last 10 errors
        if (this.state.errors.length > 10) {
            this.state.errors = this.state.errors.slice(-10);
        }
    }

    /**
     * Log message (if verbose)
     */
    private log(message: string): void {
        if (this.options.verbose) {
            console.log(`[GMV] ${new Date().toISOString()} ${message}`);
        }
    }

    // ========================================================================
    // API ACCESS
    // ========================================================================

    /**
     * Get read-only API
     */
    getAPI(): GMVStore {
        return this.store;
    }

    /**
     * Get current summary
     */
    getSummary(): GlobalMemorySummary | null {
        return this.store.getGlobalMemorySummary();
    }

    /**
     * Get stats
     */
    getStats(): ReturnType<GMVStore["getStats"]> & { daemon: GMVDaemonState } {
        return {
            ...this.store.getStats(),
            daemon: this.getState()
        };
    }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create and start GMV daemon
 */
export function startGMVDaemon(options: GMVDaemonOptions = {}): GMVDaemon {
    const daemon = new GMVDaemon(options);
    daemon.start();
    return daemon;
}

/**
 * Create GMV daemon without starting
 */
export function createGMVDaemon(options: GMVDaemonOptions = {}): GMVDaemon {
    return new GMVDaemon(options);
}

// ============================================================================
// CLI
// ============================================================================

export function main(): void {
    const args = process.argv.slice(2);
    const verbose = args.includes("--verbose") || args.includes("-v");
    const intervalMs = parseInt(
        args.find(a => a.startsWith("--interval="))?.split("=")[1] || "60000",
        10
    );

    console.log("Starting GMV Daemon...");
    console.log(`  Interval: ${intervalMs}ms`);
    console.log(`  Verbose: ${verbose}`);

    const daemon = startGMVDaemon({
        interval_ms: intervalMs,
        verbose,
        onSummaryUpdate: (summary) => {
            console.log(`[GMV] Summary updated: coherence=${summary.system_coherence}, entropy=${summary.entropy_level}`);
        }
    });

    // Handle shutdown
    process.on("SIGINT", () => {
        console.log("\nShutting down...");
        daemon.stop();
        process.exit(0);
    });

    process.on("SIGTERM", () => {
        daemon.stop();
        process.exit(0);
    });
}

if (require.main === module) {
    main();
}
