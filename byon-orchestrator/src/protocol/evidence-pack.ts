/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * EvidencePack Builder
 * ====================
 *
 * Builder pentru EvidencePack cu integrare GMV read-only.
 *
 * Flow:
 * 1. Worker colectează surse și facts
 * 2. Worker atașează memory context (FHRSS+FCPE)
 * 3. Worker atașează GMV hint (metadata-only)
 * 4. Hash și finalizare
 *
 * Enhanced Features:
 * - Auto-extraction of facts and quotes
 * - Memory context integration
 * - Codebase context builder
 */

import crypto from "crypto";
import {
    EvidencePack,
    GlobalMemoryHint,
    Source,
    ExtractedFact,
    RawQuote,
    CodebaseContext,
    MemoryContext,
    TaskType
} from "../types/protocol.js";
import { ProtocolFactExtractor, createProtocolFactExtractor } from "./protocol-fact-extractor.js";
import { QuoteExtractor, createQuoteExtractor } from "./quote-extractor.js";

// ============================================================================
// BUILDER
// ============================================================================

export class EvidencePackBuilder {
    private evidence: Partial<EvidencePack> = {
        document_type: "EVIDENCE_PACK",
        document_version: "1.0",
        sources: [],
        extracted_facts: [],
        raw_quotes: [],
        forbidden_data_present: false
    };

    /**
     * Set evidence ID
     */
    withId(id: string): this {
        this.evidence.evidence_id = id;
        return this;
    }

    /**
     * Generate random evidence ID
     */
    withRandomId(): this {
        this.evidence.evidence_id = crypto.randomUUID();
        return this;
    }

    /**
     * Set task type
     */
    withTaskType(taskType: TaskType): this {
        this.evidence.task_type = taskType;
        return this;
    }

    /**
     * Add source
     */
    addSource(source: Source): this {
        this.evidence.sources!.push(source);
        return this;
    }

    /**
     * Add multiple sources
     */
    addSources(sources: Source[]): this {
        this.evidence.sources!.push(...sources);
        return this;
    }

    /**
     * Add extracted fact
     */
    addFact(fact: ExtractedFact): this {
        this.evidence.extracted_facts!.push(fact);
        return this;
    }

    /**
     * Add raw quote
     */
    addQuote(quote: RawQuote): this {
        this.evidence.raw_quotes!.push(quote);
        return this;
    }

    /**
     * Set codebase context
     */
    withCodebaseContext(context: CodebaseContext): this {
        this.evidence.codebase_context = context;
        return this;
    }

    /**
     * Set memory context (FHRSS+FCPE IDs)
     */
    withMemoryContext(context: MemoryContext): this {
        this.evidence.memory_context = context;
        return this;
    }

    /**
     * Attach GMV hint (metadata-only)
     *
     * IMPORTANT: This is read-only metadata from GMV.
     * The hint contains NO text content, only IDs and state.
     */
    withGlobalMemoryHint(hint: GlobalMemoryHint): this {
        // Validate hint is metadata-only (no text fields)
        if (!this.validateGlobalMemoryHint(hint)) {
            throw new Error("POLICY_VIOLATION: GlobalMemoryHint must be metadata-only");
        }
        this.evidence.global_memory_hint = hint;
        return this;
    }

    /**
     * Mark forbidden data present
     */
    markForbiddenDataPresent(): this {
        this.evidence.forbidden_data_present = true;
        return this;
    }

    /**
     * Auto-extract facts from text content
     */
    extractFactsFrom(
        content: string,
        sourceRefs: string[],
        extractor?: ProtocolFactExtractor
    ): this {
        const factExtractor = extractor || createProtocolFactExtractor();
        const facts = factExtractor.extract(content, sourceRefs);
        this.evidence.extracted_facts!.push(...facts);
        return this;
    }

    /**
     * Auto-extract facts from code
     */
    extractFactsFromCode(
        code: string,
        filePath: string,
        extractor?: ProtocolFactExtractor
    ): this {
        const factExtractor = extractor || createProtocolFactExtractor();
        const facts = factExtractor.extractFromCode(code, filePath);
        this.evidence.extracted_facts!.push(...facts);
        return this;
    }

    /**
     * Auto-extract quotes from text content
     */
    extractQuotesFrom(
        content: string,
        sourceRef: string,
        extractor?: QuoteExtractor
    ): this {
        const quoteExtractor = extractor || createQuoteExtractor();
        const quotes = quoteExtractor.extract(content, sourceRef);
        this.evidence.raw_quotes!.push(...quotes);
        return this;
    }

    /**
     * Extract quotes from conversation
     */
    extractQuotesFromConversation(
        messages: Array<{ role: string; content: string; timestamp?: string }>,
        conversationId: string,
        extractor?: QuoteExtractor
    ): this {
        const quoteExtractor = extractor || createQuoteExtractor();
        const quotes = quoteExtractor.extractFromConversation(messages, conversationId);
        this.evidence.raw_quotes!.push(...quotes);
        return this;
    }

    /**
     * Add file to codebase context
     */
    addAnalyzedFile(filePath: string): this {
        if (!this.evidence.codebase_context) {
            this.evidence.codebase_context = {
                files_analyzed: [],
                functions_referenced: [],
                dependencies_identified: [],
                patterns_detected: []
            };
        }
        if (!this.evidence.codebase_context.files_analyzed.includes(filePath)) {
            this.evidence.codebase_context.files_analyzed.push(filePath);
        }
        return this;
    }

    /**
     * Add function reference to codebase context
     */
    addFunctionReference(
        file: string,
        functionName: string,
        lineStart: number,
        lineEnd: number
    ): this {
        if (!this.evidence.codebase_context) {
            this.evidence.codebase_context = {
                files_analyzed: [],
                functions_referenced: [],
                dependencies_identified: [],
                patterns_detected: []
            };
        }
        this.evidence.codebase_context.functions_referenced.push({
            file,
            function_name: functionName,
            line_start: lineStart,
            line_end: lineEnd
        });
        return this;
    }

    /**
     * Add dependency to codebase context
     */
    addDependency(dependency: string): this {
        if (!this.evidence.codebase_context) {
            this.evidence.codebase_context = {
                files_analyzed: [],
                functions_referenced: [],
                dependencies_identified: [],
                patterns_detected: []
            };
        }
        if (!this.evidence.codebase_context.dependencies_identified.includes(dependency)) {
            this.evidence.codebase_context.dependencies_identified.push(dependency);
        }
        return this;
    }

    /**
     * Add pattern to codebase context
     */
    addPattern(pattern: string): this {
        if (!this.evidence.codebase_context) {
            this.evidence.codebase_context = {
                files_analyzed: [],
                functions_referenced: [],
                dependencies_identified: [],
                patterns_detected: []
            };
        }
        if (!this.evidence.codebase_context.patterns_detected.includes(pattern)) {
            this.evidence.codebase_context.patterns_detected.push(pattern);
        }
        return this;
    }

    /**
     * Set memory context from IDs
     */
    withMemoryContextFromIds(
        conversationCtxId: number | null,
        codeCtxIds: number[],
        factCtxIds: number[],
        similarCtxIds: number[] = []
    ): this {
        this.evidence.memory_context = {
            conversation_ctx_id: conversationCtxId,
            relevant_code_ctx_ids: codeCtxIds,
            relevant_fact_ctx_ids: factCtxIds,
            similar_past_ctx_ids: similarCtxIds
        };
        return this;
    }

    /**
     * Create source from message
     */
    addMessageSource(
        messageId: string,
        timestamp: string,
        contentHash?: string
    ): this {
        this.evidence.sources!.push({
            type: "message",
            identifier: messageId,
            timestamp,
            content_hash: contentHash
        });
        return this;
    }

    /**
     * Create source from file
     */
    addFileSource(
        filePath: string,
        timestamp: string,
        contentHash?: string
    ): this {
        this.evidence.sources!.push({
            type: "file",
            identifier: filePath,
            timestamp,
            content_hash: contentHash
        });
        return this;
    }

    /**
     * Create source from memory
     */
    addMemorySource(
        memoryCtxId: string,
        timestamp: string
    ): this {
        this.evidence.sources!.push({
            type: "memory",
            identifier: memoryCtxId,
            timestamp
        });
        return this;
    }

    /**
     * Check for forbidden data patterns
     */
    checkForbiddenData(content: string): boolean {
        const forbiddenPatterns = [
            /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
            /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, // Phone
            /\b\d{3}[-]?\d{2}[-]?\d{4}\b/, // SSN-like
            /password\s*[:=]\s*["']?[^"'\s]+["']?/i, // Passwords
            /api[_-]?key\s*[:=]\s*["']?[^"'\s]+["']?/i, // API keys
            /secret\s*[:=]\s*["']?[^"'\s]+["']?/i, // Secrets
            /private[_-]?key\s*[:=]/i, // Private keys
            /bearer\s+[A-Za-z0-9\-_.~+/]+=*/i, // Bearer tokens
        ];

        for (const pattern of forbiddenPatterns) {
            if (pattern.test(content)) {
                this.evidence.forbidden_data_present = true;
                return true;
            }
        }
        return false;
    }

    /**
     * Build the EvidencePack
     */
    build(): EvidencePack {
        // Validate required fields
        if (!this.evidence.evidence_id) {
            this.withRandomId();
        }

        if (!this.evidence.task_type) {
            throw new Error("task_type is required");
        }

        if (!this.evidence.codebase_context) {
            this.evidence.codebase_context = {
                files_analyzed: [],
                functions_referenced: [],
                dependencies_identified: [],
                patterns_detected: []
            };
        }

        if (!this.evidence.memory_context) {
            this.evidence.memory_context = {
                conversation_ctx_id: null,
                relevant_code_ctx_ids: [],
                relevant_fact_ctx_ids: [],
                similar_past_ctx_ids: []
            };
        }

        // Set timestamp
        this.evidence.timestamp = new Date().toISOString();

        // Calculate hash
        this.evidence.hash = this.calculateHash();

        return this.evidence as EvidencePack;
    }

    /**
     * Validate GlobalMemoryHint is metadata-only
     */
    private validateGlobalMemoryHint(hint: GlobalMemoryHint): boolean {
        // Check required discriminator
        if (hint.summary_ref !== "GLOBAL_MEMORY_SUMMARY") {
            return false;
        }

        // Ensure no text fields (labels) are present
        // The hint should only have: summary_ref, timestamp, active_attractor_ids, entropy_level, system_coherence
        const allowedKeys = new Set([
            "summary_ref",
            "timestamp",
            "active_attractor_ids",
            "entropy_level",
            "system_coherence"
        ]);

        for (const key of Object.keys(hint)) {
            if (!allowedKeys.has(key)) {
                return false;
            }
        }

        // Ensure active_attractor_ids contains only strings (IDs, not objects with labels)
        if (hint.active_attractor_ids) {
            for (const id of hint.active_attractor_ids) {
                if (typeof id !== "string") {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Calculate SHA256 hash
     */
    private calculateHash(): string {
        const content = JSON.stringify({
            evidence_id: this.evidence.evidence_id,
            timestamp: this.evidence.timestamp,
            task_type: this.evidence.task_type,
            sources: this.evidence.sources,
            extracted_facts: this.evidence.extracted_facts,
            raw_quotes: this.evidence.raw_quotes,
            codebase_context: this.evidence.codebase_context,
            memory_context: this.evidence.memory_context,
            global_memory_hint: this.evidence.global_memory_hint,
            forbidden_data_present: this.evidence.forbidden_data_present
        });

        return crypto.createHash("sha256").update(content).digest("hex");
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create GlobalMemoryHint from GMV summary
 *
 * IMPORTANT: This extracts only metadata, no text content.
 */
export function createGlobalMemoryHint(
    summary: {
        timestamp: string;
        system_coherence: number;
        entropy_level: "stable" | "rising" | "fragmented";
        active_attractors: Array<{ attractor_id: string; score: number }>;
    }
): GlobalMemoryHint {
    return {
        summary_ref: "GLOBAL_MEMORY_SUMMARY",
        timestamp: summary.timestamp,
        active_attractor_ids: summary.active_attractors.map(a => a.attractor_id),
        entropy_level: summary.entropy_level,
        system_coherence: summary.system_coherence
    };
}

/**
 * Create empty EvidencePack builder
 */
export function createEvidencePackBuilder(): EvidencePackBuilder {
    return new EvidencePackBuilder();
}

/**
 * Create EvidencePack builder with task type
 */
export function createEvidencePackForTask(taskType: TaskType): EvidencePackBuilder {
    return new EvidencePackBuilder().withRandomId().withTaskType(taskType);
}

/**
 * Calculate content hash for source verification
 */
export function calculateContentHash(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Validate EvidencePack structure
 */
export function validateEvidencePack(pack: EvidencePack): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    // Check required fields
    if (!pack.evidence_id) errors.push("Missing evidence_id");
    if (!pack.timestamp) errors.push("Missing timestamp");
    if (!pack.task_type) errors.push("Missing task_type");
    if (!pack.hash) errors.push("Missing hash");

    // Validate document type
    if (pack.document_type !== "EVIDENCE_PACK") {
        errors.push("Invalid document_type");
    }

    // Validate arrays exist
    if (!Array.isArray(pack.sources)) errors.push("sources must be array");
    if (!Array.isArray(pack.extracted_facts)) errors.push("extracted_facts must be array");
    if (!Array.isArray(pack.raw_quotes)) errors.push("raw_quotes must be array");

    // Validate GMV hint if present
    if (pack.global_memory_hint) {
        if (pack.global_memory_hint.summary_ref !== "GLOBAL_MEMORY_SUMMARY") {
            errors.push("Invalid GlobalMemoryHint summary_ref");
        }
    }

    // Recalculate and verify hash
    const content = JSON.stringify({
        evidence_id: pack.evidence_id,
        timestamp: pack.timestamp,
        task_type: pack.task_type,
        sources: pack.sources,
        extracted_facts: pack.extracted_facts,
        raw_quotes: pack.raw_quotes,
        codebase_context: pack.codebase_context,
        memory_context: pack.memory_context,
        global_memory_hint: pack.global_memory_hint,
        forbidden_data_present: pack.forbidden_data_present
    });
    const expectedHash = crypto.createHash("sha256").update(content).digest("hex");
    if (pack.hash !== expectedHash) {
        errors.push("Hash mismatch - evidence may have been tampered");
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

// Re-export extractors for convenience
export { ProtocolFactExtractor, createProtocolFactExtractor } from "./protocol-fact-extractor.js";
export { QuoteExtractor, createQuoteExtractor } from "./quote-extractor.js";
