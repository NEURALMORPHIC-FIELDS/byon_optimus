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

    // FCE-M morphogenetic surface (optional — methods return safe defaults when disabled)
    getFceState?(): Promise<FceState | null>;
    getFceAdvisory?(): Promise<FceAdvisoryFeedback[]>;
    getFcePriorityRecommendations?(): Promise<FceAdvisoryFeedback[]>;
    getFceOmegaRegistry?(): Promise<FceOmegaRegistrySnapshot>;
    getFceReferenceFields?(): Promise<FceReferenceFieldsResult>;
    consolidateFce?(): Promise<FceConsolidateResult>;
    getMorphogenesisReport?(query?: string): Promise<MorphogenesisReport | null>;
}

// ============================================================================
// FCE-M MORPHOGENETIC TYPES
// ============================================================================

/**
 * Expression state of a coagulated semantic center (FCE-Omega).
 * Mirrors FCE-M's runtime/reference_field.py terminology.
 */
export type FceExpressionState =
    | "active"
    | "contested"
    | "inexpressed";

/**
 * Morphogenetic event kind against an existing ReferenceField.
 * From `unified_fragmergent_memory.runtime.reference_field`.
 */
export type FceEventKind =
    | "aligned"
    | "expression_reinforcing"
    | "tensioned"
    | "orthogonal"
    | "contested_expression"
    | "residue_amplifying";

/**
 * Advisory feedback produced by FCE-Omega when residue, contested
 * expressions, or relation candidates are detected. Strictly
 * informational — never authorizes or modifies execution.
 */
export interface FceAdvisoryFeedback {
    feedback_id: string;
    center_key: string;
    kind: string;
    priority_delta: number;
    recommended_action: string;
    reason: string;
    source_trace_ids?: string[];
    source_omega_ids?: string[];
}

/** Irreversible record of coagulated semantic center. */
export interface OmegaRecord {
    omega_id: string;
    semantic_center: string;
    coagulated_at_episode?: number;
    S_t_at_coagulation?: number;
    kappa_at_coagulation?: number;
    sine_type?: "integrative" | "operational" | "turbulent";
    source_episodes?: number[];
    source_events?: unknown[];
    expression_state?: FceExpressionState;
}

/** Compact registry snapshot used by Worker/Auditor. */
export interface FceOmegaRegistrySnapshot {
    count: number;
    active: number;
    contested: number;
    inexpressed: number;
    records: OmegaRecord[];
}

/** Projected reference field — the morphogenetic interpretation lens. */
export interface ReferenceField {
    reference_id: string;
    omega_id: string;
    center_key: string;
    field_vector?: number[];
    strength?: number;
    expression_state?: FceExpressionState;
    source_omega_record?: OmegaRecord;
}

/** Event observed against a ReferenceField. */
export interface FceReferenceFieldEvent {
    event_id?: string;
    reference_id?: string;
    center_key?: string;
    kind: FceEventKind;
    at_episode?: number;
    notes?: string;
}

export interface FceReferenceFieldsResult {
    reference_fields: ReferenceField[];
    events: FceReferenceFieldEvent[];
}

/** State snapshot returned by /action=fce_state. */
export interface FceState {
    enabled: boolean;
    init_error?: string;
    omega_registry?: FceOmegaRegistrySnapshot;
    reference_fields_count?: number;
    advisory_count?: number;
    events_since_consolidate?: number;
    error?: string;
}

/** Compact morphogenesis report (metadata-only, safe for EvidencePack). */
export interface MorphogenesisReport {
    enabled: boolean;
    omega_active: number;
    omega_contested: number;
    omega_inexpressed: number;
    omega_total: number;
    reference_fields_count: number;
    /** Hashed center identifiers — no raw labels leak. */
    aligned_reference_fields: string[];
    contested_expressions: string[];
    high_residue_centers: string[];
    advisory_count: number;
    priority_recommendations_count: number;
    relation_candidates_count: number;
    query?: string;
    morphogenesis_summary: string;
}

/** Residue signal extracted for Auditor risk weighting. */
export interface FceResidueSignal {
    center_key: string;
    Z_norm: number;
    severity: "low" | "medium" | "high";
}

/** Result of an explicit consolidate trigger. */
export interface FceConsolidateResult {
    fce_status: "consolidated" | "disabled" | "error" | "skipped";
    report?: unknown;
    error?: string;
}

/**
 * Memory context FCE-M makes available to Worker EvidencePack.
 * Metadata-only by design — Worker is not allowed to embed text
 * content from FCE-M into EvidencePack (Auditor will reject).
 */
export interface FceMemoryContext {
    enabled: boolean;
    morphogenesis: MorphogenesisReport | null;
    /** Top advisories sorted by abs(priority_delta). */
    top_advisory: FceAdvisoryFeedback[];
    /** Centers (hashed) currently considered high-risk. */
    risk_centers: string[];
}
