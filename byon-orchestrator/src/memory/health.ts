/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Memory Health Monitor
 * =====================
 *
 * Continuous health monitoring for BYON memory service.
 * Provides real-time status and alerts for memory system.
 *
 * Features:
 * - Periodic health checks
 * - Latency tracking
 * - Recovery testing
 * - Alert callbacks
 */

import { MemoryClient } from "./client.js";

// ============================================================================
// TYPES
// ============================================================================

export interface HealthCheckResult {
    /** Is service healthy */
    healthy: boolean;
    /** Check timestamp */
    timestamp: string;
    /** Response latency in ms */
    latency_ms: number;
    /** Error message if unhealthy */
    error?: string;
    /** Service stats if available */
    stats?: {
        total_entries: number;
        storage_mb: number;
    };
}

export interface HealthHistory {
    /** Recent health check results */
    checks: HealthCheckResult[];
    /** Average latency over history */
    avg_latency_ms: number;
    /** Uptime percentage */
    uptime_percent: number;
    /** Last healthy timestamp */
    last_healthy: string | null;
    /** Last unhealthy timestamp */
    last_unhealthy: string | null;
    /** Consecutive failures */
    consecutive_failures: number;
}

export interface HealthConfig {
    /** Check interval in ms */
    interval: number;
    /** History size */
    historySize: number;
    /** Alert after N consecutive failures */
    alertThreshold: number;
    /** Include stats in health check */
    includeStats: boolean;
    /** Verbose logging */
    verbose: boolean;
}

export type HealthAlertCallback = (result: HealthCheckResult, history: HealthHistory) => void;

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: HealthConfig = {
    interval: 30000, // 30 seconds
    historySize: 100,
    alertThreshold: 3,
    includeStats: true,
    verbose: false
};

// ============================================================================
// MEMORY HEALTH
// ============================================================================

/**
 * Memory Health Monitor
 *
 * Monitors the health of the FHRSS+FCPE memory service.
 */
export class MemoryHealth {
    private client: MemoryClient;
    private config: HealthConfig;
    private history: HealthCheckResult[] = [];
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private onAlert: HealthAlertCallback | null = null;
    private consecutiveFailures = 0;
    private lastHealthy: string | null = null;
    private lastUnhealthy: string | null = null;

    constructor(client: MemoryClient, config: Partial<HealthConfig> = {}) {
        this.client = client;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Start health monitoring
     */
    start(): void {
        if (this.intervalId) {
            return; // Already running
        }

        this.log("Starting health monitoring...");

        // Immediate first check
        this.check().catch(err => this.log(`Initial check failed: ${err}`));

        // Schedule periodic checks
        this.intervalId = setInterval(() => {
            this.check().catch(err => this.log(`Health check failed: ${err}`));
        }, this.config.interval);
    }

    /**
     * Stop health monitoring
     */
    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            this.log("Health monitoring stopped");
        }
    }

    /**
     * Set alert callback
     */
    setAlertCallback(callback: HealthAlertCallback): void {
        this.onAlert = callback;
    }

    /**
     * Perform health check
     */
    async check(): Promise<HealthCheckResult> {
        const startTime = Date.now();
        const timestamp = new Date().toISOString();

        let result: HealthCheckResult;

        try {
            const healthy = await this.client.ping();
            const latency = Date.now() - startTime;

            if (healthy) {
                result = {
                    healthy: true,
                    timestamp,
                    latency_ms: latency
                };

                // Get stats if configured
                if (this.config.includeStats) {
                    try {
                        const stats = await this.client.getStats();
                        result.stats = {
                            total_entries: stats.total_entries,
                            storage_mb: stats.storage_mb || 0
                        };
                    } catch {
                        // Stats optional
                    }
                }

                this.consecutiveFailures = 0;
                this.lastHealthy = timestamp;

            } else {
                result = {
                    healthy: false,
                    timestamp,
                    latency_ms: latency,
                    error: "Health check returned false"
                };

                this.consecutiveFailures++;
                this.lastUnhealthy = timestamp;
            }

        } catch (error) {
            const latency = Date.now() - startTime;

            result = {
                healthy: false,
                timestamp,
                latency_ms: latency,
                error: (error as Error).message
            };

            this.consecutiveFailures++;
            this.lastUnhealthy = timestamp;
        }

        // Add to history
        this.history.unshift(result);
        if (this.history.length > this.config.historySize) {
            this.history.pop();
        }

        // Check for alert
        if (
            !result.healthy &&
            this.consecutiveFailures >= this.config.alertThreshold &&
            this.onAlert
        ) {
            this.onAlert(result, this.getHistory());
        }

        // Log if verbose
        if (this.config.verbose) {
            if (result.healthy) {
                this.log(`✓ Healthy (${result.latency_ms}ms)`);
            } else {
                this.log(`✗ Unhealthy: ${result.error}`);
            }
        }

        return result;
    }

    /**
     * Get health history summary
     */
    getHistory(): HealthHistory {
        const healthyChecks = this.history.filter(h => h.healthy);
        const totalChecks = this.history.length;

        const avgLatency = totalChecks > 0
            ? this.history.reduce((sum, h) => sum + h.latency_ms, 0) / totalChecks
            : 0;

        const uptimePercent = totalChecks > 0
            ? (healthyChecks.length / totalChecks) * 100
            : 100;

        return {
            checks: this.history.slice(0, 10), // Last 10 checks
            avg_latency_ms: avgLatency,
            uptime_percent: uptimePercent,
            last_healthy: this.lastHealthy,
            last_unhealthy: this.lastUnhealthy,
            consecutive_failures: this.consecutiveFailures
        };
    }

    /**
     * Get current status
     */
    getStatus(): {
        running: boolean;
        healthy: boolean;
        lastCheck: HealthCheckResult | null;
        consecutiveFailures: number;
    } {
        return {
            running: this.intervalId !== null,
            healthy: this.history.length > 0 ? this.history[0].healthy : false,
            lastCheck: this.history.length > 0 ? this.history[0] : null,
            consecutiveFailures: this.consecutiveFailures
        };
    }

    /**
     * Force immediate check
     */
    async forceCheck(): Promise<HealthCheckResult> {
        return this.check();
    }

    /**
     * Test recovery capability
     */
    async testRecovery(lossPercent: number = 0.3): Promise<{
        tested: boolean;
        recovered: boolean;
        similarity: number;
        error?: string;
    }> {
        try {
            // We need a ctx_id to test - get one from stats
            const stats = await this.client.getStats();

            if (stats.total_entries === 0) {
                return {
                    tested: false,
                    recovered: false,
                    similarity: 0,
                    error: "No entries to test"
                };
            }

            // Test with first available context (ctx_id = 0)
            const result = await this.client.testRecovery(0, lossPercent);

            return {
                tested: true,
                recovered: result.recovered,
                similarity: result.similarity || 0
            };

        } catch (error) {
            return {
                tested: false,
                recovered: false,
                similarity: 0,
                error: (error as Error).message
            };
        }
    }

    private log(message: string): void {
        if (this.config.verbose) {
            console.log(`[MemoryHealth] ${message}`);
        }
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create memory health monitor
 */
export function createMemoryHealth(
    client: MemoryClient,
    config?: Partial<HealthConfig>
): MemoryHealth {
    return new MemoryHealth(client, config);
}
