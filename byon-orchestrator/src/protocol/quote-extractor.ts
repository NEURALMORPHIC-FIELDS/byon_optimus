/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Quote Extractor
 * ===============
 *
 * Extracts raw quotes from text content for EvidencePack.
 * Preserves original text with source references and offsets.
 *
 * Patterns:
 * - Explicit quotes (text in quotation marks)
 * - Code blocks (```code```)
 * - User mentions (@user said: ...)
 * - Inline code (`code`)
 */

import crypto from "crypto";
import { RawQuote } from "../types/protocol.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface QuoteExtractorConfig {
    /** Maximum quotes to extract per text */
    maxQuotes: number;
    /** Minimum quote length */
    minLength: number;
    /** Maximum quote length */
    maxLength: number;
    /** Extract code blocks */
    extractCodeBlocks: boolean;
    /** Extract inline code */
    extractInlineCode: boolean;
    /** Extract user mentions */
    extractMentions: boolean;
}

const DEFAULT_CONFIG: QuoteExtractorConfig = {
    maxQuotes: 30,
    minLength: 5,
    maxLength: 1000,
    extractCodeBlocks: true,
    extractInlineCode: true,
    extractMentions: true
};

// ============================================================================
// QUOTE PATTERNS
// ============================================================================

const QUOTE_PATTERNS = {
    // Double quoted text: "..."
    double_quoted: /"([^"]+)"/g,

    // Single quoted text: '...'
    single_quoted: /'([^']+)'/g,

    // Code blocks: ```...```
    code_block: /```(?:\w+)?\n?([\s\S]*?)```/g,

    // Inline code: `...`
    inline_code: /`([^`]+)`/g,

    // User mentions: @user said: ...
    user_mention: /@(\w+)\s+(?:said|wrote|asked|replied):\s*(.+?)(?:\n|$)/gi,

    // Block quotes: > ...
    block_quote: /^>\s*(.+)$/gm,

    // Said pattern: X said: "..."
    said_pattern: /(\w+)\s+(?:said|wrote|mentioned|stated):\s*["']?([^"'\n]+)["']?/gi
};

// ============================================================================
// QUOTE EXTRACTOR
// ============================================================================

/**
 * Quote Extractor
 *
 * Extracts raw quotes from text content for EvidencePack.
 */
export class QuoteExtractor {
    private config: QuoteExtractorConfig;

    constructor(config: Partial<QuoteExtractorConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Extract quotes from text
     */
    extract(text: string, sourceRef: string): RawQuote[] {
        const quotes: RawQuote[] = [];
        const seenQuotes = new Set<string>();

        // Extract double quoted text
        this.extractPattern(
            text,
            QUOTE_PATTERNS.double_quoted,
            (match, index) => ({
                text: match[1],
                start_offset: index,
                end_offset: index + match[0].length
            }),
            quotes,
            seenQuotes,
            sourceRef
        );

        // Extract single quoted text (only if longer to avoid contractions)
        this.extractPattern(
            text,
            QUOTE_PATTERNS.single_quoted,
            (match, index) => ({
                text: match[1],
                start_offset: index,
                end_offset: index + match[0].length
            }),
            quotes,
            seenQuotes,
            sourceRef,
            10 // Minimum 10 chars for single quotes
        );

        // Extract code blocks if enabled
        if (this.config.extractCodeBlocks) {
            this.extractPattern(
                text,
                QUOTE_PATTERNS.code_block,
                (match, index) => ({
                    text: match[1].trim(),
                    start_offset: index,
                    end_offset: index + match[0].length
                }),
                quotes,
                seenQuotes,
                sourceRef
            );
        }

        // Extract inline code if enabled
        if (this.config.extractInlineCode) {
            this.extractPattern(
                text,
                QUOTE_PATTERNS.inline_code,
                (match, index) => ({
                    text: match[1],
                    start_offset: index,
                    end_offset: index + match[0].length
                }),
                quotes,
                seenQuotes,
                sourceRef
            );
        }

        // Extract user mentions if enabled
        if (this.config.extractMentions) {
            this.extractPattern(
                text,
                QUOTE_PATTERNS.user_mention,
                (match, index) => ({
                    text: `@${match[1]}: ${match[2].trim()}`,
                    start_offset: index,
                    end_offset: index + match[0].length
                }),
                quotes,
                seenQuotes,
                sourceRef
            );
        }

        // Extract block quotes
        this.extractPattern(
            text,
            QUOTE_PATTERNS.block_quote,
            (match, index) => ({
                text: match[1].trim(),
                start_offset: index,
                end_offset: index + match[0].length
            }),
            quotes,
            seenQuotes,
            sourceRef
        );

        // Extract "said" patterns
        this.extractPattern(
            text,
            QUOTE_PATTERNS.said_pattern,
            (match, index) => ({
                text: `${match[1]} said: ${match[2].trim()}`,
                start_offset: index,
                end_offset: index + match[0].length
            }),
            quotes,
            seenQuotes,
            sourceRef
        );

        // Limit and return
        return quotes.slice(0, this.config.maxQuotes);
    }

    /**
     * Extract quotes using a pattern
     */
    private extractPattern(
        text: string,
        pattern: RegExp,
        builder: (match: RegExpMatchArray, index: number) => {
            text: string;
            start_offset: number;
            end_offset: number;
        },
        quotes: RawQuote[],
        seenQuotes: Set<string>,
        sourceRef: string,
        customMinLength?: number
    ): void {
        // Reset pattern
        pattern.lastIndex = 0;

        let match;
        while ((match = pattern.exec(text)) !== null) {
            try {
                const { text: quoteText, start_offset, end_offset } = builder(match, match.index);
                const minLen = customMinLength ?? this.config.minLength;

                // Validate length
                if (
                    quoteText.length < minLen ||
                    quoteText.length > this.config.maxLength
                ) {
                    continue;
                }

                // Deduplicate
                const key = quoteText.toLowerCase().trim();
                if (seenQuotes.has(key)) {
                    continue;
                }
                seenQuotes.add(key);

                // Add quote
                quotes.push({
                    quote_id: this.generateQuoteId(),
                    text: quoteText,
                    source_ref: sourceRef,
                    start_offset,
                    end_offset
                });

            } catch {
                // Skip invalid matches
                continue;
            }
        }
    }

    /**
     * Extract explicit quote markers
     */
    extractExplicitQuotes(
        text: string,
        sourceRef: string,
        markers: { start: string; end: string }[]
    ): RawQuote[] {
        const quotes: RawQuote[] = [];

        for (const { start, end } of markers) {
            const escapedStart = this.escapeRegex(start);
            const escapedEnd = this.escapeRegex(end);
            const pattern = new RegExp(`${escapedStart}([\\s\\S]*?)${escapedEnd}`, "g");

            let match;
            while ((match = pattern.exec(text)) !== null) {
                const quoteText = match[1].trim();
                if (
                    quoteText.length >= this.config.minLength &&
                    quoteText.length <= this.config.maxLength
                ) {
                    quotes.push({
                        quote_id: this.generateQuoteId(),
                        text: quoteText,
                        source_ref: sourceRef,
                        start_offset: match.index,
                        end_offset: match.index + match[0].length
                    });
                }
            }
        }

        return quotes.slice(0, this.config.maxQuotes);
    }

    /**
     * Extract quotes from conversation messages
     */
    extractFromConversation(
        messages: Array<{ role: string; content: string; timestamp?: string }>,
        conversationId: string
    ): RawQuote[] {
        const quotes: RawQuote[] = [];

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            const sourceRef = `${conversationId}:msg_${i}`;

            // Extract quotes from message content
            const messageQuotes = this.extract(msg.content, sourceRef);
            quotes.push(...messageQuotes);

            // Also add the message itself as a potential quote if it's significant
            if (
                msg.content.length >= 20 &&
                msg.content.length <= 200 &&
                (msg.role === "user" || msg.role === "assistant")
            ) {
                quotes.push({
                    quote_id: this.generateQuoteId(),
                    text: `[${msg.role}]: ${msg.content.substring(0, 200)}`,
                    source_ref: sourceRef
                });
            }
        }

        return quotes.slice(0, this.config.maxQuotes);
    }

    /**
     * Generate unique quote ID
     */
    private generateQuoteId(): string {
        return `quote_${crypto.randomUUID().substring(0, 8)}`;
    }

    /**
     * Escape regex special characters
     */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create quote extractor
 */
export function createQuoteExtractor(
    config?: Partial<QuoteExtractorConfig>
): QuoteExtractor {
    return new QuoteExtractor(config);
}
