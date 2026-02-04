/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Memory Types - FHRSS+FCPE Integration
 * ======================================
 *
 * Type definitions for BYON memory system:
 * - Memory store/search operations
 * - Context types (code, conversation, fact)
 * - FHRSS+FCPE specific types
 *
 * Patent: FHRSS/OmniVault - Vasile Lucian Borbeleac - EP25216372.0
 */

// ============================================================================
// MEMORY TYPES
// ============================================================================

/** Type of memory entry */
export type MemoryType = "code" | "conversation" | "fact";

/** Memory entry stored in FHRSS+FCPE */
export interface MemoryEntry {
    /** Context ID from FHRSS+FCPE */
    ctx_id: number;

    /** Type of memory */
    type: MemoryType;

    /** Content (will be compressed by FCPE) */
    content: string;

    /** Embedding vector (384-dim for FCPE) */
    embedding?: number[];

    /** Timestamp ISO8601 */
    timestamp: string;

    /** Tags for categorization */
    tags: string[];

    /** Source reference */
    source?: string;

    /** Additional metadata */
    metadata?: Record<string, unknown>;
}

// ============================================================================
// CODE MEMORY
// ============================================================================

/** Code memory entry */
export interface CodeMemory extends MemoryEntry {
    type: "code";

    /** File path */
    file: string;

    /** Line number */
    line?: number;

    /** Function/class name */
    symbol?: string;

    /** Language */
    language?: string;
}

// ============================================================================
// CONVERSATION MEMORY
// ============================================================================

/** Role in conversation */
export type ConversationRole = "user" | "assistant" | "system";

/** Conversation memory entry */
export interface ConversationMemory extends MemoryEntry {
    type: "conversation";

    /** Role of the speaker */
    role: ConversationRole;

    /** Channel source */
    channel?: string;

    /** Thread/conversation ID */
    thread_id?: string;
}

// ============================================================================
// FACT MEMORY
// ============================================================================

/** Fact memory entry */
export interface FactMemory extends MemoryEntry {
    type: "fact";

    /** Confidence score [0,1] */
    confidence: number;

    /** Source of the fact */
    fact_source: string;

    /** Category */
    category?: string;
}

// ============================================================================
// SEARCH TYPES
// ============================================================================

/** Search result from memory */
export interface SearchResult {
    ctx_id: number;
    type: MemoryType;
    content: string;
    similarity: number;
    timestamp?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    /** Allow additional properties */
    [key: string]: unknown;
}

/** Search options */
export interface SearchOptions {
    /** Maximum results to return */
    top_k?: number;

    /** Minimum similarity threshold */
    min_similarity?: number;

    /** Alias for min_similarity (for compatibility) */
    threshold?: number;

    /** Filter by type */
    type?: MemoryType;

    /** Filter by tags */
    tags?: string[];

    /** Time range filter */
    time_range?: {
        start?: string;
        end?: string;
    };
}

// ============================================================================
// FHRSS+FCPE SPECIFIC
// ============================================================================

/** FHRSS configuration */
export interface FHRSSConfig {
    profile: "FULL" | "STANDARD" | "LIGHT";
    subcube_size: number;
    redundancy_level: number;
}

/** FCPE configuration */
export interface FCPEConfig {
    dim: number;
    compression_ratio: number;
    chaos_factor: number;
}

/** Recovery test result */
export interface RecoveryTestResult {
    ctx_id?: number;
    loss_percent?: number;
    recovered: boolean;
    original_hash?: string;
    recovered_hash?: string;
    match?: boolean;
    /** Cosine similarity between original and recovered */
    similarity?: number;
    /** Byte-level accuracy */
    byte_accuracy?: number;
    /** Recovery time in ms */
    recovery_time_ms?: number;
    /** Allow additional properties */
    [key: string]: unknown;
}

/** Memory service stats */
export interface MemoryStats {
    total_entries: number;
    entries_by_type?: Record<MemoryType, number>;
    total_storage_bytes?: number;
    compression_ratio: number;
    last_recovery_test?: RecoveryTestResult;
    /** Storage in MB */
    storage_mb?: number;
    /** Stats by type */
    by_type?: Record<MemoryType, number>;
    /** FCPE embedding dimension */
    fcpe_dim?: number;
    /** FHRSS profile */
    fhrss_profile?: string;
    /** Allow additional properties */
    [key: string]: unknown;
}

/** Memory context for worker operations */
export interface MemoryContext {
    ctx_id?: number;
    type?: MemoryType;
    embedding?: number[];
    metadata?: Record<string, unknown>;
    /** Related conversation context ID */
    conversation_ctx_id?: number;
    /** Related code context ID */
    code_ctx_id?: number;
    /** Related code context IDs */
    relevant_code_ctx_ids?: number[];
    /** Related fact context IDs */
    fact_ctx_ids?: number[];
    /** Related fact context IDs (alias) */
    relevant_fact_ctx_ids?: number[];
    /** Similar past context IDs */
    similar_past_ctx_ids?: number[];
    /** Allow additional properties */
    [key: string]: unknown;
}

// ============================================================================
// MEMORY SERVICE API
// ============================================================================

/** Search all result - can be array or categorized object */
export type SearchAllResult = SearchResult[] | {
    code: SearchResult[];
    conversation: SearchResult[];
    facts: SearchResult[];
};

/** Memory service API interface */
export interface MemoryServiceAPI {
    // Store operations
    storeCode(code: string, file: string, line?: number, tags?: string[]): Promise<number>;
    storeConversation(content: string, role: ConversationRole, tags?: string[]): Promise<number>;
    storeFact(fact: string, source: string, tagsOrConfidence?: string[] | number, tags?: string[]): Promise<number>;

    // Search operations
    searchCode(query: string, options?: SearchOptions): Promise<SearchResult[]>;
    searchConversation(query: string, options?: SearchOptions): Promise<SearchResult[]>;
    searchFacts(query: string, options?: SearchOptions): Promise<SearchResult[]>;
    searchAll(query: string, options?: SearchOptions): Promise<SearchAllResult>;

    // Retrieval (optional)
    getByCtxId?(ctxId: number): Promise<MemoryEntry | null>;
    getByCtxIds?(ctxIds: number[]): Promise<MemoryEntry[]>;

    // Recovery testing
    testRecovery(ctxId: number, lossPercent: number): Promise<RecoveryTestResult>;

    // Stats
    getStats(): Promise<MemoryStats>;

    // Health
    ping(): Promise<boolean>;
}
