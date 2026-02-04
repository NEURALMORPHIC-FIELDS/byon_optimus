/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON Memory Client
 * ==================
 *
 * TypeScript client for FHRSS+FCPE memory service.
 * Provides full AgentMemory API for BYON orchestrator.
 *
 * Features:
 * - Store: code, conversation, fact memories
 * - Search: semantic similarity with top-k results
 * - Recovery: test FHRSS fault tolerance
 * - Stats: system statistics
 *
 * CRITICAL:
 * - Memory service MUST be running for BYON to start
 * - All operations are async with timeout handling
 */

import {
    MemoryEntry,
    CodeMemory,
    ConversationMemory,
    FactMemory,
    SearchResult,
    SearchOptions,
    MemoryStats,
    MemoryServiceAPI,
    RecoveryTestResult
} from "../types/memory.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface MemoryClientConfig {
    serviceUrl: string;
    timeout: number;
    maxRetries: number;
    retryDelay: number;
    verbose: boolean;
    /** Enable LRU cache for search results */
    enableCache: boolean;
    /** Maximum cache entries */
    maxCacheSize: number;
    /** Cache TTL in milliseconds */
    cacheTtlMs: number;
}

const DEFAULT_CONFIG: MemoryClientConfig = {
    serviceUrl: process.env['MEMORY_SERVICE_URL'] || "http://localhost:8000",
    timeout: 5000,
    maxRetries: 3,
    retryDelay: 1000,
    verbose: false,
    enableCache: true,
    maxCacheSize: 100,
    cacheTtlMs: 60000 // 1 minute
};

// ============================================================================
// LRU CACHE
// ============================================================================

interface CacheEntry<T> {
    value: T;
    timestamp: number;
}

/**
 * Simple LRU Cache for search results
 * PERFORMANCE: Reduces redundant network calls
 */
class LRUCache<T> {
    private cache: Map<string, CacheEntry<T>> = new Map();
    private maxSize: number;
    private ttlMs: number;

    constructor(maxSize: number, ttlMs: number) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
    }

    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) {
            return undefined;
        }

        // Check TTL
        if (Date.now() - entry.timestamp > this.ttlMs) {
            this.cache.delete(key);
            return undefined;
        }

        // Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }

    set(key: string, value: T): void {
        // Delete existing to update position
        this.cache.delete(key);

        // Evict oldest if at capacity
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) {
                this.cache.delete(oldestKey);
            }
        }

        this.cache.set(key, { value, timestamp: Date.now() });
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

interface ServiceResponse<T> {
    success: boolean;
    error?: string;
    data?: T;
}

interface StoreResponse {
    success: boolean;
    ctx_id: number;
    type: string;
    timestamp: string;
    error?: string;
}

interface SearchResultItem {
    ctx_id: number;
    similarity: number;
    content: string;
    metadata: Record<string, unknown>;
}

interface SearchResponse {
    success: boolean;
    results: SearchResultItem[];
    query: string;
    search_time_ms: number;
    error?: string;
}

interface SearchAllResponse {
    success: boolean;
    code: SearchResultItem[];
    conversation: SearchResultItem[];
    facts: SearchResultItem[];
    query: string;
    search_time_ms: number;
    error?: string;
}

interface RecoveryResponse {
    success: boolean;
    recovered: boolean;
    similarity: number;
    byte_accuracy: number;
    recovery_time_ms: number;
    loss_percent: number;
    error?: string;
}

interface StatsResponse {
    success: boolean;
    num_contexts: number;
    by_type: {
        code: number;
        conversation: number;
        fact: number;
    };
    fcpe_dim: number;
    fhrss_profile: string;
    total_storage_mb: number;
    uptime_seconds: number;
    error?: string;
}

// ============================================================================
// MEMORY CLIENT
// ============================================================================

/**
 * Memory Client for BYON Orchestrator
 *
 * Communicates with the FHRSS+FCPE memory service via HTTP.
 */
export class MemoryClient implements MemoryServiceAPI {
    private config: MemoryClientConfig;
    private lastHealthCheck: { time: number; healthy: boolean } = { time: 0, healthy: false };
    private searchCache: LRUCache<SearchResult[]>;

    constructor(config: Partial<MemoryClientConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.searchCache = new LRUCache<SearchResult[]>(
            this.config.maxCacheSize,
            this.config.cacheTtlMs
        );
    }

    /**
     * Clear search cache
     */
    clearCache(): void {
        this.searchCache.clear();
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { size: number; maxSize: number; ttlMs: number } {
        return {
            size: this.searchCache.size(),
            maxSize: this.config.maxCacheSize,
            ttlMs: this.config.cacheTtlMs
        };
    }

    // ========================================================================
    // HEALTH CHECK
    // ========================================================================

    /**
     * Check if memory service is available
     */
    async ping(): Promise<boolean> {
        try {
            const response = await this.request<{ success: boolean }>({
                action: "ping"
            });
            return response.success === true;
        } catch {
            return false;
        }
    }

    /**
     * Get cached health status (avoids excessive health checks)
     */
    async isHealthy(maxAge: number = 30000): Promise<boolean> {
        const now = Date.now();
        if (now - this.lastHealthCheck.time < maxAge) {
            return this.lastHealthCheck.healthy;
        }

        const healthy = await this.ping();
        this.lastHealthCheck = { time: now, healthy };
        return healthy;
    }

    // ========================================================================
    // STORE OPERATIONS
    // ========================================================================

    /**
     * Store code memory
     */
    async storeCode(
        code: string,
        file: string,
        line: number,
        tags: string[]
    ): Promise<number> {
        const response = await this.request<StoreResponse>({
            action: "store",
            type: "code",
            data: {
                code,
                file_path: file,
                line_number: line,
                tags
            }
        });

        if (!response.success) {
            throw new Error(response.error || "Failed to store code");
        }

        return response.ctx_id;
    }

    /**
     * Store conversation memory
     */
    async storeConversation(
        content: string,
        role: "user" | "assistant" | "system"
    ): Promise<number> {
        const response = await this.request<StoreResponse>({
            action: "store",
            type: "conversation",
            data: { content, role }
        });

        if (!response.success) {
            throw new Error(response.error || "Failed to store conversation");
        }

        return response.ctx_id;
    }

    /**
     * Store fact memory
     */
    async storeFact(
        fact: string,
        source: string,
        tags: string[]
    ): Promise<number> {
        const response = await this.request<StoreResponse>({
            action: "store",
            type: "fact",
            data: { fact, source, tags }
        });

        if (!response.success) {
            throw new Error(response.error || "Failed to store fact");
        }

        return response.ctx_id;
    }

    // ========================================================================
    // SEARCH OPERATIONS
    // ========================================================================

    /**
     * Search code memories
     */
    async searchCode(
        query: string,
        options: SearchOptions = {}
    ): Promise<SearchResult[]> {
        // PERFORMANCE: Check cache first
        const cacheKey = `code:${query}:${options.top_k || 5}:${options.threshold || 0.5}`;
        if (this.config.enableCache) {
            const cached = this.searchCache.get(cacheKey);
            if (cached) {
                return cached;
            }
        }

        const response = await this.request<SearchResponse>({
            action: "search",
            type: "code",
            query,
            top_k: options.top_k || 5,
            threshold: options.threshold || 0.5
        });

        if (!response.success) {
            throw new Error(response.error || "Search failed");
        }

        const results = this.mapSearchResults(response.results, "code");

        // Cache results
        if (this.config.enableCache) {
            this.searchCache.set(cacheKey, results);
        }

        return results;
    }

    /**
     * Search conversation memories
     */
    async searchConversation(
        query: string,
        options: SearchOptions = {}
    ): Promise<SearchResult[]> {
        // PERFORMANCE: Check cache first
        const cacheKey = `conversation:${query}:${options.top_k || 5}:${options.threshold || 0.5}`;
        if (this.config.enableCache) {
            const cached = this.searchCache.get(cacheKey);
            if (cached) {
                return cached;
            }
        }

        const response = await this.request<SearchResponse>({
            action: "search",
            type: "conversation",
            query,
            top_k: options.top_k || 5,
            threshold: options.threshold || 0.5
        });

        if (!response.success) {
            throw new Error(response.error || "Search failed");
        }

        const results = this.mapSearchResults(response.results, "conversation");

        // Cache results
        if (this.config.enableCache) {
            this.searchCache.set(cacheKey, results);
        }

        return results;
    }

    /**
     * Search fact memories
     */
    async searchFacts(
        query: string,
        options: SearchOptions = {}
    ): Promise<SearchResult[]> {
        // PERFORMANCE: Check cache first
        const cacheKey = `fact:${query}:${options.top_k || 5}:${options.threshold || 0.5}`;
        if (this.config.enableCache) {
            const cached = this.searchCache.get(cacheKey);
            if (cached) {
                return cached;
            }
        }

        const response = await this.request<SearchResponse>({
            action: "search",
            type: "fact",
            query,
            top_k: options.top_k || 5,
            threshold: options.threshold || 0.5
        });

        if (!response.success) {
            throw new Error(response.error || "Search failed");
        }

        const results = this.mapSearchResults(response.results, "fact");

        // Cache results
        if (this.config.enableCache) {
            this.searchCache.set(cacheKey, results);
        }

        return results;
    }

    /**
     * Search all memory types
     */
    async searchAll(
        query: string,
        options: SearchOptions = {}
    ): Promise<{
        code: SearchResult[];
        conversation: SearchResult[];
        facts: SearchResult[];
    }> {
        const response = await this.request<SearchAllResponse>({
            action: "search_all",
            query,
            top_k: options.top_k || 5,
            threshold: options.threshold || 0.5
        });

        if (!response.success) {
            throw new Error(response.error || "Search failed");
        }

        return {
            code: this.mapSearchResults(response.code, "code"),
            conversation: this.mapSearchResults(response.conversation, "conversation"),
            facts: this.mapSearchResults(response.facts, "fact")
        };
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
    ): Promise<RecoveryTestResult> {
        const response = await this.request<RecoveryResponse>({
            action: "test_recovery",
            ctx_id: ctxId,
            loss_percent: lossPercent
        });

        if (!response.success) {
            throw new Error(response.error || "Recovery test failed");
        }

        return {
            recovered: response.recovered,
            similarity: response.similarity,
            byte_accuracy: response.byte_accuracy,
            recovery_time_ms: response.recovery_time_ms
        };
    }

    /**
     * Get memory statistics
     */
    async getStats(): Promise<MemoryStats> {
        const response = await this.request<StatsResponse>({
            action: "stats"
        });

        if (!response.success) {
            throw new Error(response.error || "Failed to get stats");
        }

        return {
            total_entries: response.num_contexts,
            by_type: response.by_type,
            storage_mb: response.total_storage_mb,
            compression_ratio: 100, // FCPE provides ~100x compression
            fcpe_dim: response.fcpe_dim,
            fhrss_profile: response.fhrss_profile
        };
    }

    // ========================================================================
    // INTERNAL HELPERS
    // ========================================================================

    /**
     * Make HTTP request to memory service
     */
    private async request<T>(payload: Record<string, unknown>): Promise<T> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(
                    () => controller.abort(),
                    this.config.timeout
                );

                const response = await fetch(this.config.serviceUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                return await response.json() as T;

            } catch (error) {
                lastError = error as Error;

                if (this.config.verbose) {
                    console.warn(`[MemoryClient] Attempt ${attempt + 1} failed:`, error);
                }

                if (attempt < this.config.maxRetries - 1) {
                    await this.delay(this.config.retryDelay * (attempt + 1));
                }
            }
        }

        throw lastError || new Error("Request failed after retries");
    }

    /**
     * Map raw search results to typed SearchResult
     */
    private mapSearchResults(
        items: SearchResultItem[],
        type: string
    ): SearchResult[] {
        return items.map(item => ({
            ctx_id: item.ctx_id,
            similarity: item.similarity,
            content: item.content,
            type: type as "code" | "conversation" | "fact",
            metadata: item.metadata
        }));
    }

    /**
     * Delay helper
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create memory client instance
 */
export function createMemoryClient(
    config?: Partial<MemoryClientConfig>
): MemoryClient {
    return new MemoryClient(config);
}

/**
 * Create and verify memory client
 * Throws if service is unavailable
 */
export async function initializeMemoryClient(
    config?: Partial<MemoryClientConfig>
): Promise<MemoryClient> {
    const client = new MemoryClient(config);

    const healthy = await client.ping();
    if (!healthy) {
        throw new Error(
            `FATAL: Memory service unavailable at ${config?.serviceUrl || DEFAULT_CONFIG.serviceUrl}`
        );
    }

    return client;
}
