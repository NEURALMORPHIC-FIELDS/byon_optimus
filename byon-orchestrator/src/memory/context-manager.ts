/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Memory Context Manager
 * ======================
 *
 * Manages semantic context for BYON evidence building.
 * Coordinates memory searches and builds MemoryContext for EvidencePacks.
 *
 * Responsibilities:
 * - Search relevant memories for current task
 * - Build MemoryContext with ctx_ids
 * - Rank and prioritize search results
 * - Track context usage for GMV
 */

import { MemoryClient, createMemoryClient } from "./client.js";
import {
    MemoryContext,
    SearchResult,
    SearchOptions
} from "../types/memory.js";
import { TaskType } from "../types/protocol.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface ContextManagerConfig {
    /** Maximum code results per search */
    maxCodeResults: number;
    /** Maximum fact results per search */
    maxFactResults: number;
    /** Maximum conversation results */
    maxConversationResults: number;
    /** Minimum similarity threshold */
    minSimilarity: number;
    /** Weight for code in combined search */
    codeWeight: number;
    /** Weight for facts in combined search */
    factWeight: number;
    /** Weight for conversation in combined search */
    conversationWeight: number;
    /** Enable verbose logging */
    verbose: boolean;
}

const DEFAULT_CONFIG: ContextManagerConfig = {
    maxCodeResults: 5,
    maxFactResults: 5,
    maxConversationResults: 3,
    minSimilarity: 0.5,
    codeWeight: 1.0,
    factWeight: 0.8,
    conversationWeight: 0.6,
    verbose: false
};

// ============================================================================
// CONTEXT RESULT
// ============================================================================

export interface ContextSearchResult {
    /** Built memory context for EvidencePack */
    memoryContext: MemoryContext;
    /** Detailed search results */
    details: {
        code: SearchResult[];
        facts: SearchResult[];
        conversation: SearchResult[];
    };
    /** Search statistics */
    stats: {
        totalResults: number;
        searchTimeMs: number;
        queriesExecuted: number;
    };
}

// ============================================================================
// CONTEXT MANAGER
// ============================================================================

/**
 * Memory Context Manager
 *
 * Builds memory context for evidence packs by searching
 * relevant memories and ranking results.
 */
export class MemoryContextManager {
    private client: MemoryClient;
    private config: ContextManagerConfig;

    constructor(
        client: MemoryClient,
        config: Partial<ContextManagerConfig> = {}
    ) {
        this.client = client;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Build memory context for a task
     *
     * @param query - Main search query (task description)
     * @param taskType - Type of task for search optimization
     * @param currentConversationId - Current conversation ctx_id if available
     */
    async buildContext(
        query: string,
        taskType: TaskType,
        currentConversationId?: number
    ): Promise<ContextSearchResult> {
        const startTime = Date.now();
        let queriesExecuted = 0;

        // Adjust search based on task type
        const searchOptions = this.getSearchOptionsForTask(taskType);

        // Search all memory types
        const [codeResults, factResults, conversationResults] = await Promise.all([
            this.searchCode(query, searchOptions.code),
            this.searchFacts(query, searchOptions.facts),
            this.searchConversation(query, searchOptions.conversation)
        ]);
        queriesExecuted = 3;

        // Extract ctx_ids
        const codeCtxIds = codeResults.map(r => r.ctx_id);
        const factCtxIds = factResults.map(r => r.ctx_id);
        const conversationCtxIds = conversationResults.map(r => r.ctx_id);

        // Find similar past contexts (combined search)
        const similarPastIds = this.findSimilarPast(
            codeResults,
            factResults,
            conversationResults
        );

        // Build MemoryContext
        const memoryContext: MemoryContext = {
            conversation_ctx_id: currentConversationId ?? undefined,
            relevant_code_ctx_ids: codeCtxIds,
            relevant_fact_ctx_ids: factCtxIds,
            similar_past_ctx_ids: similarPastIds
        };

        const searchTimeMs = Date.now() - startTime;

        if (this.config.verbose) {
            console.log(`[ContextManager] Built context in ${searchTimeMs}ms`);
            console.log(`  - Code: ${codeCtxIds.length} results`);
            console.log(`  - Facts: ${factCtxIds.length} results`);
            console.log(`  - Conversation: ${conversationCtxIds.length} results`);
            console.log(`  - Similar past: ${similarPastIds.length} contexts`);
        }

        return {
            memoryContext,
            details: {
                code: codeResults,
                facts: factResults,
                conversation: conversationResults
            },
            stats: {
                totalResults: codeResults.length + factResults.length + conversationResults.length,
                searchTimeMs,
                queriesExecuted
            }
        };
    }

    /**
     * Get search options optimized for task type
     */
    private getSearchOptionsForTask(taskType: TaskType): {
        code: SearchOptions;
        facts: SearchOptions;
        conversation: SearchOptions;
    } {
        switch (taskType) {
            case "coding":
                return {
                    code: {
                        top_k: this.config.maxCodeResults * 2,
                        threshold: this.config.minSimilarity
                    },
                    facts: {
                        top_k: this.config.maxFactResults,
                        threshold: this.config.minSimilarity
                    },
                    conversation: {
                        top_k: this.config.maxConversationResults,
                        threshold: this.config.minSimilarity
                    }
                };

            case "scheduling":
            case "messaging":
                return {
                    code: {
                        top_k: Math.floor(this.config.maxCodeResults / 2),
                        threshold: this.config.minSimilarity + 0.1
                    },
                    facts: {
                        top_k: this.config.maxFactResults * 2,
                        threshold: this.config.minSimilarity
                    },
                    conversation: {
                        top_k: this.config.maxConversationResults * 2,
                        threshold: this.config.minSimilarity
                    }
                };

            default: // "general"
                return {
                    code: {
                        top_k: this.config.maxCodeResults,
                        threshold: this.config.minSimilarity
                    },
                    facts: {
                        top_k: this.config.maxFactResults,
                        threshold: this.config.minSimilarity
                    },
                    conversation: {
                        top_k: this.config.maxConversationResults,
                        threshold: this.config.minSimilarity
                    }
                };
        }
    }

    /**
     * Search code memories
     */
    private async searchCode(
        query: string,
        options: SearchOptions
    ): Promise<SearchResult[]> {
        try {
            return await this.client.searchCode(query, options);
        } catch (error) {
            if (this.config.verbose) {
                console.warn("[ContextManager] Code search failed:", error);
            }
            return [];
        }
    }

    /**
     * Search fact memories
     */
    private async searchFacts(
        query: string,
        options: SearchOptions
    ): Promise<SearchResult[]> {
        try {
            return await this.client.searchFacts(query, options);
        } catch (error) {
            if (this.config.verbose) {
                console.warn("[ContextManager] Fact search failed:", error);
            }
            return [];
        }
    }

    /**
     * Search conversation memories
     */
    private async searchConversation(
        query: string,
        options: SearchOptions
    ): Promise<SearchResult[]> {
        try {
            return await this.client.searchConversation(query, options);
        } catch (error) {
            if (this.config.verbose) {
                console.warn("[ContextManager] Conversation search failed:", error);
            }
            return [];
        }
    }

    /**
     * Find similar past contexts by combining and ranking results
     */
    private findSimilarPast(
        codeResults: SearchResult[],
        factResults: SearchResult[],
        conversationResults: SearchResult[]
    ): number[] {
        // Combine with weights
        const scored: Map<number, number> = new Map();

        for (const r of codeResults) {
            const current = scored.get(r.ctx_id) || 0;
            scored.set(r.ctx_id, current + r.similarity * this.config.codeWeight);
        }

        for (const r of factResults) {
            const current = scored.get(r.ctx_id) || 0;
            scored.set(r.ctx_id, current + r.similarity * this.config.factWeight);
        }

        for (const r of conversationResults) {
            const current = scored.get(r.ctx_id) || 0;
            scored.set(r.ctx_id, current + r.similarity * this.config.conversationWeight);
        }

        // Sort by combined score
        const sorted = Array.from(scored.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([id]) => id);

        return sorted;
    }

    /**
     * Quick context check - just verify we have relevant memories
     */
    async hasRelevantContext(query: string): Promise<boolean> {
        try {
            const results = await this.client.searchAll(query, {
                top_k: 1,
                threshold: this.config.minSimilarity
            });

            return (
                results.code.length > 0 ||
                results.facts.length > 0 ||
                results.conversation.length > 0
            );
        } catch {
            return false;
        }
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create memory context manager
 */
export function createContextManager(
    client?: MemoryClient,
    config?: Partial<ContextManagerConfig>
): MemoryContextManager {
    const memoryClient = client || createMemoryClient();
    return new MemoryContextManager(memoryClient, config);
}
