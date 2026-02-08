/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Memory Bridge
 * =============
 *
 * Bridge între BYON Orchestrator și sistemul de memorie FHRSS+FCPE.
 * Oferă acces unificat la toate tipurile de memorie.
 *
 * Memory Providers:
 * 1. FHRSS+FCPE (Primary) - Infinite memory with 73,000x compression
 * 2. memory-core (Fallback) - OpenClaw's built-in memory
 * 3. lancedb (Optional) - Vector database for embeddings
 *
 * CRITICAL:
 * - BYON MUST NOT START without memory service
 * - Memory search is required for evidence building
 * - All memory operations are logged to audit trail
 */

import {
    MemoryEntry,
    CodeMemory,
    ConversationMemory,
    FactMemory,
    SearchResult,
    SearchOptions,
    MemoryStats
} from "../types/memory.js";

// ============================================================================
// TYPES
// ============================================================================

/** Memory provider types */
export type MemoryProvider = "fhrss-fcpe" | "memory-core" | "lancedb";

/** Memory bridge configuration */
export interface MemoryBridgeConfig {
    primary_provider: MemoryProvider;
    fallback_provider?: MemoryProvider;
    service_url: string;
    fallback_url?: string;
    timeout_ms: number;
    max_retries: number;
    verbose: boolean;
}

/** Memory health status */
export interface MemoryHealth {
    primary: {
        provider: MemoryProvider;
        healthy: boolean;
        latency_ms: number;
        last_check: string;
    };
    fallback?: {
        provider: MemoryProvider;
        healthy: boolean;
        latency_ms: number;
        last_check: string;
    };
    active_provider: MemoryProvider;
}

/** Memory operation result */
export interface MemoryResult<T> {
    success: boolean;
    data?: T;
    provider_used: MemoryProvider;
    latency_ms: number;
    error?: string;
}

// ============================================================================
// MEMORY BRIDGE IMPLEMENTATION
// ============================================================================

/**
 * Memory Bridge
 *
 * Unified interface for all memory operations.
 * Handles failover between providers automatically.
 */
export class MemoryBridge {
    private config: MemoryBridgeConfig;
    private health: MemoryHealth;
    private operationCount = 0;

    constructor(config: Partial<MemoryBridgeConfig> = {}) {
        this.config = {
            primary_provider: config.primary_provider || "fhrss-fcpe",
            fallback_provider: config.fallback_provider || "memory-core",
            service_url: config.service_url || "http://localhost:8000",
            fallback_url: config.fallback_url || "http://localhost:3000/memory",
            timeout_ms: config.timeout_ms || 5000,
            max_retries: config.max_retries || 3,
            verbose: config.verbose || false
        };

        this.health = {
            primary: {
                provider: this.config.primary_provider,
                healthy: false,
                latency_ms: 0,
                last_check: ""
            },
            active_provider: this.config.primary_provider
        };

        if (this.config.fallback_provider) {
            this.health.fallback = {
                provider: this.config.fallback_provider,
                healthy: false,
                latency_ms: 0,
                last_check: ""
            };
        }
    }

    // ========================================================================
    // HEALTH & INITIALIZATION
    // ========================================================================

    /**
     * Initialize memory bridge and check providers
     * Returns false if no provider is available (HARD STOP condition)
     */
    async initialize(): Promise<boolean> {
        this.log("Initializing memory bridge...");

        // Check primary provider
        const primaryHealthy = await this.checkProviderHealth(
            this.config.primary_provider,
            this.config.service_url
        );
        this.health.primary.healthy = primaryHealthy;
        this.health.primary.last_check = new Date().toISOString();

        if (primaryHealthy) {
            this.health.active_provider = this.config.primary_provider;
            this.log(`Primary provider ${this.config.primary_provider} is healthy`);
            return true;
        }

        // Try fallback if primary fails
        if (this.config.fallback_provider && this.config.fallback_url) {
            this.log("Primary provider unhealthy, checking fallback...");

            const fallbackHealthy = await this.checkProviderHealth(
                this.config.fallback_provider,
                this.config.fallback_url
            );

            if (this.health.fallback) {
                this.health.fallback.healthy = fallbackHealthy;
                this.health.fallback.last_check = new Date().toISOString();
            }

            if (fallbackHealthy) {
                this.health.active_provider = this.config.fallback_provider;
                this.log(`Fallback provider ${this.config.fallback_provider} is healthy`);
                return true;
            }
        }

        // No provider available - CRITICAL FAILURE
        this.logError("No memory provider available - BYON cannot start");
        return false;
    }

    /**
     * Check if a specific provider is healthy
     */
    private async checkProviderHealth(provider: MemoryProvider, url: string): Promise<boolean> {
        const start = Date.now();

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "ping" }),
                signal: AbortSignal.timeout(this.config.timeout_ms)
            });

            const latency = Date.now() - start;

            if (provider === this.config.primary_provider) {
                this.health.primary.latency_ms = latency;
            } else if (this.health.fallback) {
                this.health.fallback.latency_ms = latency;
            }

            if (!response.ok) {return false;}

            const data = await response.json() as { success?: boolean };
            return data.success === true;
        } catch {
            return false;
        }
    }

    /**
     * Get current health status
     */
    getHealth(): MemoryHealth {
        return { ...this.health };
    }

    // ========================================================================
    // STORE OPERATIONS
    // ========================================================================

    /**
     * Store code memory
     */
    async storeCode(
        code: string,
        file_path: string,
        line_number: number,
        tags: string[]
    ): Promise<MemoryResult<number>> {
        return this.executeWithFailover(async (url) => {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "store",
                    type: "code",
                    data: { code, file_path, line_number, tags }
                })
            });

            const result = await response.json() as { success: boolean; ctx_id?: number; error?: string };
            if (!result.success) {throw new Error(result.error || "Store failed");}
            return result.ctx_id!;
        });
    }

    /**
     * Store conversation memory
     */
    async storeConversation(
        content: string,
        role: "user" | "assistant" | "system"
    ): Promise<MemoryResult<number>> {
        return this.executeWithFailover(async (url) => {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "store",
                    type: "conversation",
                    data: { content, role }
                })
            });

            const result = await response.json() as { success: boolean; ctx_id?: number; error?: string };
            if (!result.success) {throw new Error(result.error || "Store failed");}
            return result.ctx_id!;
        });
    }

    /**
     * Store fact memory
     */
    async storeFact(
        fact: string,
        source: string,
        tags: string[]
    ): Promise<MemoryResult<number>> {
        return this.executeWithFailover(async (url) => {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "store",
                    type: "fact",
                    data: { fact, source, tags }
                })
            });

            const result = await response.json() as { success: boolean; ctx_id?: number; error?: string };
            if (!result.success) {throw new Error(result.error || "Store failed");}
            return result.ctx_id!;
        });
    }

    // ========================================================================
    // SEARCH OPERATIONS
    // ========================================================================

    /**
     * Search code memory
     */
    async searchCode(
        query: string,
        options: SearchOptions = {}
    ): Promise<MemoryResult<SearchResult[]>> {
        return this.executeWithFailover(async (url) => {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "search",
                    type: "code",
                    query,
                    top_k: options.top_k || 5,
                    threshold: options.threshold || 0.5
                })
            });

            const result = await response.json() as { success: boolean; results?: SearchResult[]; error?: string };
            if (!result.success) {throw new Error(result.error || "Search failed");}
            return result.results || [];
        });
    }

    /**
     * Search conversation memory
     */
    async searchConversation(
        query: string,
        options: SearchOptions = {}
    ): Promise<MemoryResult<SearchResult[]>> {
        return this.executeWithFailover(async (url) => {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "search",
                    type: "conversation",
                    query,
                    top_k: options.top_k || 5,
                    threshold: options.threshold || 0.5
                })
            });

            const result = await response.json() as { success: boolean; results?: SearchResult[]; error?: string };
            if (!result.success) {throw new Error(result.error || "Search failed");}
            return result.results || [];
        });
    }

    /**
     * Search fact memory
     */
    async searchFacts(
        query: string,
        options: SearchOptions = {}
    ): Promise<MemoryResult<SearchResult[]>> {
        return this.executeWithFailover(async (url) => {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "search",
                    type: "fact",
                    query,
                    top_k: options.top_k || 5,
                    threshold: options.threshold || 0.5
                })
            });

            const result = await response.json() as { success: boolean; results?: SearchResult[]; error?: string };
            if (!result.success) {throw new Error(result.error || "Search failed");}
            return result.results || [];
        });
    }

    /**
     * Search all memory types
     */
    async searchAll(
        query: string,
        options: SearchOptions = {}
    ): Promise<MemoryResult<{
        code: SearchResult[];
        conversation: SearchResult[];
        facts: SearchResult[];
    }>> {
        return this.executeWithFailover(async (url) => {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "search_all",
                    query,
                    top_k: options.top_k || 5,
                    threshold: options.threshold || 0.5
                })
            });

            const result = await response.json() as {
                success: boolean;
                code?: SearchResult[];
                conversation?: SearchResult[];
                facts?: SearchResult[];
                error?: string;
            };
            if (!result.success) {throw new Error(result.error || "Search failed");}
            return {
                code: result.code || [],
                conversation: result.conversation || [],
                facts: result.facts || []
            };
        });
    }

    // ========================================================================
    // RECOVERY & STATS
    // ========================================================================

    /**
     * Test FHRSS recovery capability
     */
    async testRecovery(
        ctxId: number,
        lossPercent: number
    ): Promise<MemoryResult<{ recovered: boolean; similarity: number }>> {
        return this.executeWithFailover(async (url) => {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "test_recovery",
                    ctx_id: ctxId,
                    loss_percent: lossPercent
                })
            });

            const result = await response.json() as {
                success: boolean;
                recovered?: boolean;
                similarity?: number;
                error?: string;
            };
            if (!result.success) {throw new Error(result.error || "Recovery test failed");}
            return {
                recovered: result.recovered || false,
                similarity: result.similarity || 0
            };
        });
    }

    /**
     * Get memory statistics
     */
    async getStats(): Promise<MemoryResult<MemoryStats>> {
        return this.executeWithFailover(async (url) => {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "stats" })
            });

            const result = await response.json() as { success: boolean; stats?: MemoryStats; error?: string };
            if (!result.success) {throw new Error(result.error || "Stats failed");}
            return result.stats!;
        });
    }

    // ========================================================================
    // INTERNAL HELPERS
    // ========================================================================

    /**
     * Execute operation with automatic failover
     */
    private async executeWithFailover<T>(
        operation: (url: string) => Promise<T>
    ): Promise<MemoryResult<T>> {
        this.operationCount++;
        const start = Date.now();

        // Try primary provider
        if (this.health.primary.healthy) {
            try {
                const data = await operation(this.config.service_url);
                return {
                    success: true,
                    data,
                    provider_used: this.config.primary_provider,
                    latency_ms: Date.now() - start
                };
            } catch (error) {
                this.logError(`Primary provider failed: ${error}`);
                this.health.primary.healthy = false;
            }
        }

        // Try fallback provider
        if (this.health.fallback?.healthy && this.config.fallback_url) {
            try {
                const data = await operation(this.config.fallback_url);
                return {
                    success: true,
                    data,
                    provider_used: this.config.fallback_provider!,
                    latency_ms: Date.now() - start
                };
            } catch (error) {
                this.logError(`Fallback provider failed: ${error}`);
                if (this.health.fallback) {
                    this.health.fallback.healthy = false;
                }
            }
        }

        // Both providers failed
        return {
            success: false,
            provider_used: this.health.active_provider,
            latency_ms: Date.now() - start,
            error: "All memory providers unavailable"
        };
    }

    // Logging helpers
    private log(message: string): void {
        if (this.config.verbose) {
            console.log(`[Memory-Bridge] ${message}`);
        }
    }

    private logError(message: string): void {
        console.error(`[Memory-Bridge] ERROR: ${message}`);
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create memory bridge instance
 */
export function createMemoryBridge(config?: Partial<MemoryBridgeConfig>): MemoryBridge {
    return new MemoryBridge(config);
}

/**
 * Create and initialize memory bridge (convenience function)
 * Throws if no provider available
 */
export async function initializeMemoryBridge(
    config?: Partial<MemoryBridgeConfig>
): Promise<MemoryBridge> {
    const bridge = new MemoryBridge(config);
    const initialized = await bridge.initialize();

    if (!initialized) {
        throw new Error("FATAL: Memory bridge initialization failed - no provider available");
    }

    return bridge;
}
