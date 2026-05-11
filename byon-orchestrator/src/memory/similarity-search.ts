/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Similarity Search
 * =================
 *
 * High-level similarity search interface for BYON.
 * Combines multiple search strategies for optimal results.
 *
 * Strategies:
 * - Semantic: Uses FCPE vector similarity
 * - Keyword: Fallback for exact matches
 * - Hybrid: Combines both approaches
 */

import { MemoryClient } from "./client.js";
import { SearchResult, SearchOptions } from "../types/memory.js";

// ============================================================================
// TYPES
// ============================================================================

export type SearchStrategy = "semantic" | "keyword" | "hybrid";

export interface SimilaritySearchConfig {
    /** Default search strategy */
    strategy: SearchStrategy;
    /** Default result limit */
    defaultTopK: number;
    /** Default similarity threshold */
    defaultThreshold: number;
    /** Boost for exact keyword matches */
    keywordBoost: number;
    /** Weight for semantic results in hybrid */
    semanticWeight: number;
}

export interface RankedResult extends SearchResult {
    /** Final ranking score */
    rank_score: number;
    /** Whether keyword matched */
    keyword_match: boolean;
    /** Search strategy that found this */
    found_by: SearchStrategy;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: SimilaritySearchConfig = {
    strategy: "semantic",
    defaultTopK: 5,
    defaultThreshold: 0.5,
    keywordBoost: 0.2,
    semanticWeight: 0.7
};

// ============================================================================
// SIMILARITY SEARCH
// ============================================================================

/**
 * Similarity Search
 *
 * Provides intelligent search across memory types.
 */
export class SimilaritySearch {
    private client: MemoryClient;
    private config: SimilaritySearchConfig;

    constructor(
        client: MemoryClient,
        config: Partial<SimilaritySearchConfig> = {}
    ) {
        this.client = client;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Search with automatic strategy selection
     */
    async search(
        query: string,
        types: ("code" | "conversation" | "fact")[] = ["code", "conversation", "fact"],
        options: SearchOptions = {}
    ): Promise<RankedResult[]> {
        const topK = options.top_k || this.config.defaultTopK;
        const threshold = options.threshold || this.config.defaultThreshold;

        switch (this.config.strategy) {
            case "semantic":
                return this.semanticSearch(query, types, topK, threshold);

            case "keyword":
                return this.keywordSearch(query, types, topK, threshold);

            case "hybrid":
                return this.hybridSearch(query, types, topK, threshold);

            default:
                return this.semanticSearch(query, types, topK, threshold);
        }
    }

    /**
     * Semantic search using FCPE vectors
     */
    async semanticSearch(
        query: string,
        types: ("code" | "conversation" | "fact")[],
        topK: number,
        threshold: number
    ): Promise<RankedResult[]> {
        const allResults: RankedResult[] = [];

        // Search each type
        const searchPromises = types.map(async (type) => {
            let results: SearchResult[];

            switch (type) {
                case "code":
                    results = await this.client.searchCode(query, { top_k: topK, threshold });
                    break;
                case "conversation":
                    results = await this.client.searchConversation(query, { top_k: topK, threshold });
                    break;
                case "fact":
                    results = await this.client.searchFacts(query, { top_k: topK, threshold });
                    break;
            }

            return results.map(r => ({
                ...r,
                rank_score: r.similarity,
                keyword_match: false,
                found_by: "semantic" as SearchStrategy
            }));
        });

        const resultArrays = await Promise.all(searchPromises);
        for (const arr of resultArrays) {
            allResults.push(...arr);
        }

        // Sort by rank score
        allResults.sort((a, b) => b.rank_score - a.rank_score);

        return allResults.slice(0, topK);
    }

    /**
     * Keyword search (checks content for exact matches)
     */
    async keywordSearch(
        query: string,
        types: ("code" | "conversation" | "fact")[],
        topK: number,
        threshold: number
    ): Promise<RankedResult[]> {
        // First do semantic search to get candidates
        const semanticResults = await this.semanticSearch(
            query,
            types,
            topK * 2, // Get more candidates
            threshold * 0.5 // Lower threshold
        );

        // Extract keywords from query
        const keywords = this.extractKeywords(query);

        // Score based on keyword matches
        const scored = semanticResults.map(result => {
            const keywordScore = this.scoreKeywordMatch(
                result.content,
                keywords
            );

            return {
                ...result,
                rank_score: keywordScore,
                keyword_match: keywordScore > 0,
                found_by: "keyword" as SearchStrategy
            };
        });

        // Filter and sort
        return scored
            .filter(r => r.keyword_match)
            .sort((a, b) => b.rank_score - a.rank_score)
            .slice(0, topK);
    }

    /**
     * Hybrid search (combines semantic and keyword)
     */
    async hybridSearch(
        query: string,
        types: ("code" | "conversation" | "fact")[],
        topK: number,
        threshold: number
    ): Promise<RankedResult[]> {
        // Get semantic results
        const semanticResults = await this.semanticSearch(
            query,
            types,
            topK * 2,
            threshold * 0.5
        );

        // Extract keywords
        const keywords = this.extractKeywords(query);

        // Combine scores
        const hybridResults = semanticResults.map(result => {
            const semanticScore = result.similarity;
            const keywordScore = this.scoreKeywordMatch(result.content, keywords);

            const combinedScore =
                this.config.semanticWeight * semanticScore +
                (1 - this.config.semanticWeight) * keywordScore +
                (keywordScore > 0 ? this.config.keywordBoost : 0);

            return {
                ...result,
                rank_score: combinedScore,
                keyword_match: keywordScore > 0,
                found_by: "hybrid" as SearchStrategy
            };
        });

        // Sort by combined score
        hybridResults.sort((a, b) => b.rank_score - a.rank_score);

        return hybridResults.slice(0, topK);
    }

    /**
     * Extract keywords from query
     */
    private extractKeywords(query: string): string[] {
        // Remove common words
        const stopWords = new Set([
            "the", "a", "an", "is", "are", "was", "were", "be", "been",
            "being", "have", "has", "had", "do", "does", "did", "will",
            "would", "could", "should", "may", "might", "must", "can",
            "this", "that", "these", "those", "i", "you", "he", "she",
            "it", "we", "they", "what", "which", "who", "whom", "where",
            "when", "why", "how", "all", "each", "every", "both", "few",
            "more", "most", "other", "some", "such", "no", "not", "only",
            "same", "so", "than", "too", "very", "just", "also", "now",
            "and", "or", "but", "if", "then", "else", "for", "to", "from",
            "in", "on", "at", "by", "with", "about", "of"
        ]);

        return query
            .toLowerCase()
            .split(/\W+/)
            .filter(word => word.length >= 2 && !stopWords.has(word));
    }

    /**
     * Score keyword matches in content
     */
    private scoreKeywordMatch(content: string, keywords: string[]): number {
        if (keywords.length === 0) {return 0;}

        const contentLower = content.toLowerCase();
        let matches = 0;

        for (const keyword of keywords) {
            if (contentLower.includes(keyword)) {
                matches++;
            }
        }

        return matches / keywords.length;
    }

    /**
     * Find similar to a specific context
     */
    async findSimilar(
        ctxId: number,
        types: ("code" | "conversation" | "fact")[],
        topK: number = 5
    ): Promise<RankedResult[]> {
        // Get the content of the reference context
        // (This would require fetching from memory service)
        // For now, we'll use the search functionality

        // This is a placeholder - in production, we'd fetch the
        // actual embedding from the memory service
        return [];
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create similarity search instance
 */
export function createSimilaritySearch(
    client: MemoryClient,
    config?: Partial<SimilaritySearchConfig>
): SimilaritySearch {
    return new SimilaritySearch(client, config);
}
