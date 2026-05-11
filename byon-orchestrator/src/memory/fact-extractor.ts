/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Fact Extractor
 * ==============
 *
 * Extracts facts from text content for memory storage.
 * Used by Worker agent to populate EvidencePacks with extracted facts.
 *
 * Patterns:
 * - Explicit facts ("X is Y", "X equals Y")
 * - Definitions ("X: definition")
 * - Code patterns (function names, variables, types)
 * - Temporal facts ("on DATE", "since DATE")
 */

import { ExtractedFact } from "../types/protocol.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface FactExtractorConfig {
    /** Maximum facts to extract per text */
    maxFacts: number;
    /** Minimum fact length */
    minLength: number;
    /** Maximum fact length */
    maxLength: number;
    /** Extract code-related facts */
    extractCode: boolean;
    /** Extract temporal facts */
    extractTemporal: boolean;
}

const DEFAULT_CONFIG: FactExtractorConfig = {
    maxFacts: 20,
    minLength: 10,
    maxLength: 500,
    extractCode: true,
    extractTemporal: true
};

// ============================================================================
// FACT PATTERNS
// ============================================================================

const FACT_PATTERNS = {
    // "X is Y" pattern
    is_pattern: /(?<subject>[A-Z][a-zA-Z0-9_\s]+)\s+is\s+(?<predicate>[^.!?]+)/gi,

    // "X: definition" pattern
    definition: /^(?<term>[A-Z][a-zA-Z0-9_]+):\s*(?<definition>.+)$/gim,

    // "X equals/means/represents Y"
    equals: /(?<subject>\w+)\s+(?:equals|means|represents)\s+(?<value>[^.!?]+)/gi,

    // Function definition
    function_def: /(?:function|def|fn)\s+(?<name>\w+)\s*\([^)]*\)/gi,

    // Class definition
    class_def: /(?:class|interface|type|struct)\s+(?<name>\w+)/gi,

    // Variable assignment
    variable: /(?:const|let|var|val)\s+(?<name>\w+)\s*[:=]/gi,

    // Import statement
    import_stmt: /import\s+(?:(?<default>\w+)|{(?<named>[^}]+)})\s+from\s+["'](?<module>[^"']+)["']/gi,

    // URL references
    url: /(?<description>[^:]+):\s*(?<url>https?:\/\/[^\s]+)/gi,

    // Date facts
    temporal: /(?:on|since|until|before|after)\s+(?<date>\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/gi
};

// ============================================================================
// FACT EXTRACTOR
// ============================================================================

/**
 * Fact Extractor
 *
 * Extracts structured facts from text content.
 */
export class FactExtractor {
    private config: FactExtractorConfig;

    constructor(config: Partial<FactExtractorConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Extract facts from text
     */
    extract(text: string, source: string): ExtractedFact[] {
        const facts: ExtractedFact[] = [];
        const seenFacts = new Set<string>();

        // Extract "is" facts
        this.extractPattern(
            text,
            FACT_PATTERNS.is_pattern,
            (match) => ({
                fact_type: "definition",
                content: `${match.groups?.subject?.trim()} is ${match.groups?.predicate?.trim()}`,
                confidence: 0.8
            }),
            facts,
            seenFacts,
            source
        );

        // Extract definitions
        this.extractPattern(
            text,
            FACT_PATTERNS.definition,
            (match) => ({
                fact_type: "definition",
                content: `${match.groups?.term}: ${match.groups?.definition?.trim()}`,
                confidence: 0.9
            }),
            facts,
            seenFacts,
            source
        );

        // Extract code facts if enabled
        if (this.config.extractCode) {
            // Functions
            this.extractPattern(
                text,
                FACT_PATTERNS.function_def,
                (match) => ({
                    fact_type: "code_entity",
                    content: `Function: ${match.groups?.name}`,
                    confidence: 0.95
                }),
                facts,
                seenFacts,
                source
            );

            // Classes
            this.extractPattern(
                text,
                FACT_PATTERNS.class_def,
                (match) => ({
                    fact_type: "code_entity",
                    content: `Class/Type: ${match.groups?.name}`,
                    confidence: 0.95
                }),
                facts,
                seenFacts,
                source
            );

            // Imports
            this.extractPattern(
                text,
                FACT_PATTERNS.import_stmt,
                (match) => ({
                    fact_type: "dependency",
                    content: `Import from: ${match.groups?.module}`,
                    confidence: 0.9
                }),
                facts,
                seenFacts,
                source
            );
        }

        // Extract temporal facts if enabled
        if (this.config.extractTemporal) {
            this.extractPattern(
                text,
                FACT_PATTERNS.temporal,
                (match) => ({
                    fact_type: "temporal",
                    content: `Date reference: ${match.groups?.date}`,
                    confidence: 0.85
                }),
                facts,
                seenFacts,
                source
            );
        }

        // Extract URL references
        this.extractPattern(
            text,
            FACT_PATTERNS.url,
            (match) => ({
                fact_type: "reference",
                content: `${match.groups?.description?.trim()}: ${match.groups?.url}`,
                confidence: 0.9
            }),
            facts,
            seenFacts,
            source
        );

        // Limit and return
        return facts.slice(0, this.config.maxFacts);
    }

    /**
     * Extract facts using a pattern
     */
    private extractPattern(
        text: string,
        pattern: RegExp,
        builder: (match: RegExpMatchArray) => {
            fact_type: string;
            content: string;
            confidence: number;
        },
        facts: ExtractedFact[],
        seenFacts: Set<string>,
        source: string
    ): void {
        // Reset pattern
        pattern.lastIndex = 0;

        let match;
        while ((match = pattern.exec(text)) !== null) {
            try {
                const { fact_type, content, confidence } = builder(match);

                // Validate length
                if (
                    content.length < this.config.minLength ||
                    content.length > this.config.maxLength
                ) {
                    continue;
                }

                // Deduplicate
                const key = content.toLowerCase().trim();
                if (seenFacts.has(key)) {
                    continue;
                }
                seenFacts.add(key);

                // Add fact
                facts.push({
                    fact_type,
                    content,
                    source_quote: match[0].substring(0, 100),
                    confidence
                });

            } catch {
                // Skip invalid matches
                continue;
            }
        }
    }

    /**
     * Extract facts from code specifically
     */
    extractFromCode(code: string, filePath: string): ExtractedFact[] {
        const facts: ExtractedFact[] = [];
        const seenFacts = new Set<string>();

        // Extract function names
        const funcPattern = /(?:function|def|fn|async\s+function)\s+(\w+)/g;
        let match;
        while ((match = funcPattern.exec(code)) !== null) {
            const key = `func:${match[1]}`;
            if (!seenFacts.has(key)) {
                seenFacts.add(key);
                facts.push({
                    fact_type: "code_entity",
                    content: `Function '${match[1]}' defined in ${filePath}`,
                    source_quote: match[0],
                    confidence: 0.95
                });
            }
        }

        // Extract class/type names
        const classPattern = /(?:class|interface|type|struct)\s+(\w+)/g;
        while ((match = classPattern.exec(code)) !== null) {
            const key = `class:${match[1]}`;
            if (!seenFacts.has(key)) {
                seenFacts.add(key);
                facts.push({
                    fact_type: "code_entity",
                    content: `Type '${match[1]}' defined in ${filePath}`,
                    source_quote: match[0],
                    confidence: 0.95
                });
            }
        }

        // Extract exports
        const exportPattern = /export\s+(?:default\s+)?(?:class|function|const|let|var|type|interface)\s+(\w+)/g;
        while ((match = exportPattern.exec(code)) !== null) {
            const key = `export:${match[1]}`;
            if (!seenFacts.has(key)) {
                seenFacts.add(key);
                facts.push({
                    fact_type: "code_entity",
                    content: `Export '${match[1]}' from ${filePath}`,
                    source_quote: match[0],
                    confidence: 0.9
                });
            }
        }

        return facts.slice(0, this.config.maxFacts);
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create fact extractor
 */
export function createFactExtractor(
    config?: Partial<FactExtractorConfig>
): FactExtractor {
    return new FactExtractor(config);
}
