/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Memory Module Exports
 * =====================
 *
 * Central export for BYON memory system.
 */

// Client
export {
    MemoryClient,
    createMemoryClient,
    initializeMemoryClient,
    type MemoryClientConfig
} from "./client.js";

// Context Manager
export {
    MemoryContextManager,
    createContextManager,
    type ContextManagerConfig,
    type ContextSearchResult
} from "./context-manager.js";

// Fact Extractor
export {
    FactExtractor,
    createFactExtractor,
    type FactExtractorConfig
} from "./fact-extractor.js";

// Similarity Search
export {
    SimilaritySearch,
    createSimilaritySearch,
    type SearchStrategy,
    type SimilaritySearchConfig,
    type RankedResult
} from "./similarity-search.js";

// Initializer
export {
    initializeMemory,
    isMemoryAvailable,
    waitForMemory,
    type MemoryInitConfig,
    type MemorySystem
} from "./initializer.js";

// Health
export {
    MemoryHealth,
    createMemoryHealth,
    type HealthCheckResult,
    type HealthHistory,
    type HealthConfig,
    type HealthAlertCallback
} from "./health.js";

// Re-export GMV vitalizer
export * from "./vitalizer/index.js";
