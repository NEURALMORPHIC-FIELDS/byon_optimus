/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Executor Order Watcher
 * ======================
 *
 * Monitors auditor_to_executor directory for signed ExecutionOrders.
 * Parses files and triggers Executor processing pipeline.
 *
 * Similar to Auditor's PlanWatcher but for ExecutionOrders.
 */

import * as fs from "fs";
import * as path from "path";
import { ExecutionOrder } from "../../types/protocol.js";

// ============================================================================
// TYPES
// ============================================================================

export interface OrderWatcherConfig {
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

export interface OrderWatcherEvents {
    onOrderReceived: (order: ExecutionOrder, filePath: string) => void | Promise<void>;
    onError: (error: Error, filePath?: string) => void;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: OrderWatcherConfig = {
    watch_path: "/handoff/auditor_to_executor",
    poll_interval_ms: 2000,
    archive_processed: true,
    archive_path: "/handoff/auditor_to_executor/archive",
    delete_processed: false
};

// ============================================================================
// ORDER WATCHER
// ============================================================================

/**
 * Order Watcher for Executor
 *
 * Polls auditor_to_executor directory for ExecutionOrder files.
 * Orders are named: order_<timestamp>.json
 */
export class OrderWatcher {
    private config: OrderWatcherConfig;
    private events: OrderWatcherEvents;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private processedFiles: Set<string> = new Set();
    private processing: Set<string> = new Set();

    constructor(
        config: Partial<OrderWatcherConfig>,
        events: OrderWatcherEvents
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.events = events;
    }

    /**
     * Start watching for orders
     */
    start(): void {
        if (this.pollTimer) {
            return; // Already running
        }

        console.log(`[OrderWatcher] Starting to watch: ${this.config.watch_path}`);

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
     * Poll for new orders
     */
    private async poll(): Promise<void> {
        try {
            const orderFiles = this.findOrderFiles();

            for (const filePath of orderFiles) {
                // Skip if already processing or processed
                if (this.processing.has(filePath) || this.processedFiles.has(filePath)) {
                    continue;
                }

                // Mark as processing
                this.processing.add(filePath);

                try {
                    await this.processOrder(filePath);
                    this.processedFiles.add(filePath);
                } catch (error) {
                    this.events.onError(
                        error instanceof Error ? error : new Error(String(error)),
                        filePath
                    );
                } finally {
                    this.processing.delete(filePath);
                }
            }
        } catch (error) {
            this.events.onError(
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    /**
     * Find order files in watch directory
     */
    private findOrderFiles(): string[] {
        if (!fs.existsSync(this.config.watch_path)) {
            return [];
        }

        const files = fs.readdirSync(this.config.watch_path);

        return files
            .filter(file => file.startsWith("order_") && file.endsWith(".json"))
            .map(file => path.join(this.config.watch_path, file))
            .filter(filePath => {
                try {
                    const stat = fs.statSync(filePath);
                    return stat.isFile();
                } catch {
                    return false;
                }
            })
            .sort((a, b) => {
                // Sort by filename (timestamp) - oldest first
                return a.localeCompare(b);
            });
    }

    /**
     * Process an order file
     */
    private async processOrder(filePath: string): Promise<void> {
        console.log(`[OrderWatcher] Processing order: ${path.basename(filePath)}`);

        // Read file
        const content = fs.readFileSync(filePath, "utf-8");

        // Parse JSON
        const order = JSON.parse(content) as ExecutionOrder;

        // Validate basic structure
        if (!order.order_id || !order.actions || order.document_type !== "EXECUTION_ORDER") {
            throw new Error(`Invalid ExecutionOrder format in ${filePath}`);
        }

        // Dispatch to handler
        await this.events.onOrderReceived(order, filePath);

        // Handle post-processing
        if (this.config.archive_processed && this.config.archive_path) {
            this.archiveFile(filePath);
        } else if (this.config.delete_processed) {
            fs.unlinkSync(filePath);
        }
    }

    /**
     * Archive processed file
     */
    private archiveFile(filePath: string): void {
        if (!this.config.archive_path) {return;}

        try {
            const archivePath = path.join(
                this.config.archive_path,
                path.basename(filePath)
            );

            fs.renameSync(filePath, archivePath);
            console.log(`[OrderWatcher] Archived: ${path.basename(filePath)}`);
        } catch (error) {
            console.log(`[OrderWatcher] Cannot archive (read-only?): ${path.basename(filePath)}`);
        }
    }

    /**
     * Ensure directories exist
     */
    private ensureDirectories(): void {
        if (!fs.existsSync(this.config.watch_path)) {
            console.log(`[OrderWatcher] Watch path does not exist: ${this.config.watch_path}`);
        }

        if (this.config.archive_processed && this.config.archive_path) {
            try {
                if (!fs.existsSync(this.config.archive_path)) {
                    fs.mkdirSync(this.config.archive_path, { recursive: true });
                }
            } catch (error) {
                console.log(`[OrderWatcher] Cannot create archive directory, disabling archiving`);
                this.config.archive_processed = false;
            }
        }
    }

    /**
     * Get watcher statistics
     */
    getStats(): {
        pending_orders: number;
        processed_count: number;
        currently_processing: number;
    } {
        const orderFiles = this.findOrderFiles();
        const pendingOrders = orderFiles.filter(
            f => !this.processedFiles.has(f) && !this.processing.has(f)
        ).length;

        return {
            pending_orders: pendingOrders,
            processed_count: this.processedFiles.size,
            currently_processing: this.processing.size
        };
    }

    /**
     * Clear processed tracking
     */
    clearProcessedTracking(): void {
        this.processedFiles.clear();
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create order watcher
 */
export function createOrderWatcher(
    config: Partial<OrderWatcherConfig>,
    events: OrderWatcherEvents
): OrderWatcher {
    return new OrderWatcher(config, events);
}
