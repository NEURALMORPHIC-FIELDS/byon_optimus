/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Memory Initializer
 * ==================
 *
 * Handles memory system initialization for BYON orchestrator.
 *
 * CRITICAL:
 * - BYON orchestrator MUST NOT START without memory service
 * - This module enforces the hard stop requirement
 * - Provides graceful retry logic before failing
 */

import { MemoryClient, createMemoryClient, MemoryClientConfig } from "./client.js";
import { MemoryContextManager, createContextManager } from "./context-manager.js";
import { FactExtractor, createFactExtractor } from "./fact-extractor.js";
import { SimilaritySearch, createSimilaritySearch } from "./similarity-search.js";
import { MemoryHealth, createMemoryHealth, HealthCheckResult } from "./health.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface MemoryInitConfig {
    /** Memory service URL */
    serviceUrl: string;
    /** Maximum retries before hard stop */
    maxRetries: number;
    /** Delay between retries (ms) */
    retryDelay: number;
    /** Initial connection timeout (ms) */
    connectionTimeout: number;
    /** Verbose logging */
    verbose: boolean;
}

const DEFAULT_CONFIG: MemoryInitConfig = {
    serviceUrl: process.env['MEMORY_SERVICE_URL'] || "http://localhost:8000",
    maxRetries: 5,
    retryDelay: 2000,
    connectionTimeout: 10000,
    verbose: true
};

// ============================================================================
// MEMORY SYSTEM
// ============================================================================

/**
 * Initialized memory system components
 */
export interface MemorySystem {
    /** Memory client for service communication */
    client: MemoryClient;
    /** Context manager for evidence building */
    contextManager: MemoryContextManager;
    /** Fact extractor for text analysis */
    factExtractor: FactExtractor;
    /** Similarity search for intelligent queries */
    similaritySearch: SimilaritySearch;
    /** Health monitor */
    health: MemoryHealth;
    /** Shutdown function */
    shutdown: () => void;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize memory system
 *
 * CRITICAL: This function will HARD STOP the process if memory service
 * is not available after all retries.
 *
 * Exit codes:
 * - 10: Memory service unavailable (hard stop)
 */
export async function initializeMemory(
    config: Partial<MemoryInitConfig> = {}
): Promise<MemorySystem> {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    log(cfg, "\n🧠 Initializing BYON Memory System...");
    log(cfg, `   Service URL: ${cfg.serviceUrl}`);
    log(cfg, `   Max retries: ${cfg.maxRetries}`);

    // Create client
    const clientConfig: Partial<MemoryClientConfig> = {
        serviceUrl: cfg.serviceUrl,
        timeout: cfg.connectionTimeout,
        maxRetries: 1, // We handle retries here
        verbose: cfg.verbose
    };

    const client = createMemoryClient(clientConfig);

    // Try to connect with retries
    let connected = false;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
        log(cfg, `   [${attempt}/${cfg.maxRetries}] Connecting to memory service...`);

        try {
            const healthy = await client.ping();

            if (healthy) {
                connected = true;
                log(cfg, `   ✅ Connected to memory service`);
                break;
            } else {
                lastError = new Error("Health check returned false");
            }
        } catch (error) {
            lastError = error as Error;
            log(cfg, `   ⚠️  Attempt ${attempt} failed: ${lastError.message}`);
        }

        if (attempt < cfg.maxRetries) {
            log(cfg, `   ⏳ Retrying in ${cfg.retryDelay}ms...`);
            await delay(cfg.retryDelay);
        }
    }

    // HARD STOP if not connected
    if (!connected) {
        console.error("\n" + "═".repeat(60));
        console.error("❌ FATAL: Memory service unavailable");
        console.error("═".repeat(60));
        console.error(`   Service URL: ${cfg.serviceUrl}`);
        console.error(`   Last error: ${lastError?.message || "Unknown"}`);
        console.error("");
        console.error("   BYON orchestrator CANNOT start without memory service.");
        console.error("   Please ensure the FHRSS+FCPE memory service is running:");
        console.error("");
        console.error("   1. cd byon-orchestrator/memory-service");
        console.error("   2. pip install -r requirements.txt");
        console.error("   3. python server.py");
        console.error("");
        console.error("═".repeat(60) + "\n");

        process.exit(10);
    }

    // Get initial stats
    try {
        const stats = await client.getStats();
        log(cfg, `   📊 Memory stats: ${stats.total_entries} entries, ${(stats.storage_mb || 0).toFixed(2)} MB`);
        log(cfg, `   📊 By type: code=${stats.by_type?.code || 0}, conversation=${stats.by_type?.conversation || 0}, fact=${stats.by_type?.fact || 0}`);
    } catch (error) {
        log(cfg, `   ⚠️  Could not fetch stats: ${(error as Error).message}`);
    }

    // Create components
    const contextManager = createContextManager(client, { verbose: cfg.verbose });
    const factExtractor = createFactExtractor();
    const similaritySearch = createSimilaritySearch(client);
    const health = createMemoryHealth(client, { interval: 30000, verbose: cfg.verbose });

    // Start health monitoring
    health.start();

    log(cfg, "   ✅ Memory system initialized\n");

    return {
        client,
        contextManager,
        factExtractor,
        similaritySearch,
        health,
        shutdown: () => {
            health.stop();
            log(cfg, "   Memory system shutdown");
        }
    };
}

/**
 * Quick check if memory service is available
 * Does not throw or exit - just returns boolean
 */
export async function isMemoryAvailable(
    serviceUrl?: string,
    timeout: number = 5000
): Promise<boolean> {
    const client = createMemoryClient({
        serviceUrl: serviceUrl || DEFAULT_CONFIG.serviceUrl,
        timeout,
        maxRetries: 1
    });

    return client.ping();
}

/**
 * Wait for memory service to become available
 * Returns true when available, false if timeout
 */
export async function waitForMemory(
    serviceUrl?: string,
    maxWait: number = 60000,
    checkInterval: number = 2000
): Promise<boolean> {
    const url = serviceUrl || DEFAULT_CONFIG.serviceUrl;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
        const available = await isMemoryAvailable(url);
        if (available) {
            return true;
        }

        await delay(checkInterval);
    }

    return false;
}

// ============================================================================
// HELPERS
// ============================================================================

function log(config: MemoryInitConfig, message: string): void {
    if (config.verbose) {
        console.log(message);
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
