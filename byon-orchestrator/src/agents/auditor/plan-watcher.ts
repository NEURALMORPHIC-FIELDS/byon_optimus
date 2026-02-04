/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Auditor Plan Watcher
 * ====================
 *
 * Monitors worker_to_auditor directory for incoming plans and evidence.
 * Parses files and triggers Auditor processing pipeline.
 *
 * Similar to Worker's InboxWatcher, but for the Auditor.
 */

import * as fs from "fs";
import * as path from "path";
import { EvidencePack, PlanDraft } from "../../types/protocol.js";

// ============================================================================
// TYPES
// ============================================================================

export interface PlanWatcherConfig {
    /** Directory path to watch */
    watch_path: string;
    /** Poll interval in milliseconds */
    poll_interval_ms: number;
    /** Archive processed files */
    archive_processed: boolean;
    /** Archive directory */
    archive_path?: string;
    /** Delete processed files (if not archiving) */
    delete_processed: boolean;
}

export interface PlanEvidence {
    plan: PlanDraft;
    evidence: EvidencePack;
    plan_file: string;
    evidence_file: string;
}

export interface PlanWatcherEvents {
    onPlanReceived: (data: PlanEvidence) => void | Promise<void>;
    onError: (error: Error, filePath?: string) => void;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: PlanWatcherConfig = {
    watch_path: "/handoff/worker_to_auditor",
    poll_interval_ms: 2000,
    archive_processed: true,
    archive_path: "/handoff/worker_to_auditor/archive",
    delete_processed: false
};

// ============================================================================
// PLAN WATCHER
// ============================================================================

/**
 * Plan Watcher for Auditor
 *
 * Polls worker_to_auditor directory for plan + evidence file pairs.
 * Plans are named: plan_<timestamp>.json
 * Evidence is named: evidence_<timestamp>.json
 */
export class PlanWatcher {
    private config: PlanWatcherConfig;
    private events: PlanWatcherEvents;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private processedTimestamps: Set<string> = new Set();
    private processing: Set<string> = new Set();

    constructor(
        config: Partial<PlanWatcherConfig>,
        events: PlanWatcherEvents
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.events = events;
    }

    /**
     * Start watching for plans
     */
    start(): void {
        if (this.pollTimer) {
            return; // Already running
        }

        console.log(`[PlanWatcher] Starting to watch: ${this.config.watch_path}`);

        // Ensure directories exist
        this.ensureDirectories();

        // Start polling
        this.pollTimer = setInterval(
            () => this.poll(),
            this.config.poll_interval_ms
        );

        // Initial poll
        this.poll();
    }

    /**
     * Stop watching
     */
    stop(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /**
     * Check if watching
     */
    isWatching(): boolean {
        return this.pollTimer !== null;
    }

    /**
     * Poll for new plan/evidence pairs
     */
    private async poll(): Promise<void> {
        try {
            const pairs = this.findPlanEvidencePairs();

            for (const pair of pairs) {
                // Skip if already processing or processed
                if (this.processing.has(pair.timestamp) || this.processedTimestamps.has(pair.timestamp)) {
                    continue;
                }

                // Mark as processing
                this.processing.add(pair.timestamp);

                try {
                    await this.processPair(pair);
                    this.processedTimestamps.add(pair.timestamp);
                } catch (error) {
                    this.events.onError(
                        error instanceof Error ? error : new Error(String(error)),
                        pair.planPath
                    );
                } finally {
                    this.processing.delete(pair.timestamp);
                }
            }
        } catch (error) {
            this.events.onError(
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    /**
     * Find matching plan and evidence file pairs
     */
    private findPlanEvidencePairs(): Array<{
        timestamp: string;
        planPath: string;
        evidencePath: string;
    }> {
        if (!fs.existsSync(this.config.watch_path)) {
            return [];
        }

        const files = fs.readdirSync(this.config.watch_path);
        const plans = new Map<string, string>();
        const evidence = new Map<string, string>();

        // Categorize files by timestamp
        for (const file of files) {
            // Skip archive directory
            if (file === "archive") continue;

            const planMatch = file.match(/^plan_(\d+)\.json$/);
            const evidenceMatch = file.match(/^evidence_(\d+)\.json$/);

            if (planMatch) {
                plans.set(planMatch[1], path.join(this.config.watch_path, file));
            } else if (evidenceMatch) {
                evidence.set(evidenceMatch[1], path.join(this.config.watch_path, file));
            }
        }

        // Find matching pairs
        const pairs: Array<{
            timestamp: string;
            planPath: string;
            evidencePath: string;
        }> = [];

        for (const [timestamp, planPath] of plans) {
            const evidencePath = evidence.get(timestamp);
            if (evidencePath) {
                pairs.push({ timestamp, planPath, evidencePath });
            }
        }

        // Sort by timestamp (oldest first)
        pairs.sort((a, b) => parseInt(a.timestamp) - parseInt(b.timestamp));

        return pairs;
    }

    /**
     * Process a plan/evidence pair
     */
    private async processPair(pair: {
        timestamp: string;
        planPath: string;
        evidencePath: string;
    }): Promise<void> {
        console.log(`[PlanWatcher] Processing plan pair: ${pair.timestamp}`);

        // Read files
        const planContent = fs.readFileSync(pair.planPath, "utf-8");
        const evidenceContent = fs.readFileSync(pair.evidencePath, "utf-8");

        // Parse JSON
        const plan = JSON.parse(planContent) as PlanDraft;
        const evidence = JSON.parse(evidenceContent) as EvidencePack;

        // Dispatch to handler
        await this.events.onPlanReceived({
            plan,
            evidence,
            plan_file: pair.planPath,
            evidence_file: pair.evidencePath
        });

        // Handle post-processing
        if (this.config.archive_processed && this.config.archive_path) {
            this.archiveFiles(pair.planPath, pair.evidencePath);
        } else if (this.config.delete_processed) {
            fs.unlinkSync(pair.planPath);
            fs.unlinkSync(pair.evidencePath);
        }
    }

    /**
     * Archive processed files (or just log if read-only)
     */
    private archiveFiles(planPath: string, evidencePath: string): void {
        if (!this.config.archive_path) return;

        try {
            const archivePlan = path.join(
                this.config.archive_path,
                path.basename(planPath)
            );
            const archiveEvidence = path.join(
                this.config.archive_path,
                path.basename(evidencePath)
            );

            fs.renameSync(planPath, archivePlan);
            fs.renameSync(evidencePath, archiveEvidence);

            console.log(`[PlanWatcher] Archived: ${path.basename(planPath)}`);
        } catch (error) {
            // Read-only mount - can't archive, just log
            console.log(`[PlanWatcher] Cannot archive (read-only): ${path.basename(planPath)}`);
        }
    }

    /**
     * Ensure directories exist (graceful handling for read-only mounts)
     */
    private ensureDirectories(): void {
        // Don't try to create the watch path - it's a mounted volume
        if (!fs.existsSync(this.config.watch_path)) {
            console.log(`[PlanWatcher] Watch path does not exist: ${this.config.watch_path}`);
            // Don't throw - let the watcher start anyway (volume might be mounted later)
        }

        if (this.config.archive_processed && this.config.archive_path) {
            try {
                if (!fs.existsSync(this.config.archive_path)) {
                    fs.mkdirSync(this.config.archive_path, { recursive: true });
                }
            } catch (error) {
                // Archive directory creation failed (likely read-only mount)
                // Disable archiving and just mark files as processed
                console.log(`[PlanWatcher] Cannot create archive directory (read-only mount?), disabling archiving`);
                this.config.archive_processed = false;
            }
        }
    }

    /**
     * Get watcher statistics
     */
    getStats(): {
        pending_pairs: number;
        processed_count: number;
        currently_processing: number;
    } {
        const pairs = this.findPlanEvidencePairs();
        const pendingPairs = pairs.filter(
            p => !this.processedTimestamps.has(p.timestamp) && !this.processing.has(p.timestamp)
        ).length;

        return {
            pending_pairs: pendingPairs,
            processed_count: this.processedTimestamps.size,
            currently_processing: this.processing.size
        };
    }

    /**
     * Clear processed tracking (for memory management)
     */
    clearProcessedTracking(): void {
        this.processedTimestamps.clear();
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create plan watcher
 */
export function createPlanWatcher(
    config: Partial<PlanWatcherConfig>,
    events: PlanWatcherEvents
): PlanWatcher {
    return new PlanWatcher(config, events);
}
