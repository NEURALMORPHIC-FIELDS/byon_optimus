/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Protocol Fact Extractor
 * =======================
 *
 * Extracts facts from text content for EvidencePack.
 * Uses the protocol-defined ExtractedFact type with proper structure.
 *
 * Fact Types:
 * - Definitions ("X is Y", "X: definition")
 * - Requirements ("must", "should", "shall")
 * - Constraints ("cannot", "must not", "limited to")
 * - Assertions ("confirmed", "verified", "established")
 * - Code entities (functions, classes, types)
 */

import crypto from "crypto";
import { ExtractedFact } from "../types/protocol.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface ProtocolFactExtractorConfig {
    /** Maximum facts to extract per text */
    maxFacts: number;
    /** Minimum fact content length */
    minLength: number;
    /** Maximum fact content length */
    maxLength: number;
    /** Minimum confidence threshold */
    minConfidence: number;
    /** Extract requirement patterns */
    extractRequirements: boolean;
    /** Extract constraint patterns */
    extractConstraints: boolean;
    /** Extract code patterns */
    extractCode: boolean;
}

const DEFAULT_CONFIG: ProtocolFactExtractorConfig = {
    maxFacts: 25,
    minLength: 10,
    maxLength: 500,
    minConfidence: 0.5,
    extractRequirements: true,
    extractConstraints: true,
    extractCode: true
};

// ============================================================================
// FACT PATTERNS
// ============================================================================

interface FactPattern {
    pattern: RegExp;
    factType: string;
    confidence: number;
    tags: string[];
    builder: (match: RegExpMatchArray) => string | null;
}

const FACT_PATTERNS: FactPattern[] = [
    // Definition patterns: "X is Y"
    {
        pattern: /(?<subject>[A-Z][a-zA-Z0-9_\s]+)\s+is\s+(?<predicate>[^.!?]+)/gi,
        factType: "definition",
        confidence: 0.8,
        tags: ["definition", "is-a"],
        builder: (match) => {
            const subject = match.groups?.subject?.trim();
            const predicate = match.groups?.predicate?.trim();
            if (!subject || !predicate) {return null;}
            return `${subject} is ${predicate}`;
        }
    },

    // Definition patterns: "X: definition"
    {
        pattern: /^(?<term>[A-Z][a-zA-Z0-9_]+):\s*(?<definition>.+)$/gim,
        factType: "definition",
        confidence: 0.9,
        tags: ["definition", "term"],
        builder: (match) => {
            const term = match.groups?.term?.trim();
            const definition = match.groups?.definition?.trim();
            if (!term || !definition) {return null;}
            return `${term}: ${definition}`;
        }
    },

    // Requirement patterns: "must/should/shall"
    {
        pattern: /(?<subject>\w+(?:\s+\w+)?)\s+(?<modal>must|should|shall)\s+(?<requirement>[^.!?]+)/gi,
        factType: "requirement",
        confidence: 0.85,
        tags: ["requirement", "modal"],
        builder: (match) => {
            const subject = match.groups?.subject?.trim();
            const modal = match.groups?.modal?.toLowerCase();
            const requirement = match.groups?.requirement?.trim();
            if (!subject || !modal || !requirement) {return null;}
            return `${subject} ${modal} ${requirement}`;
        }
    },

    // Constraint patterns: "cannot/must not"
    {
        pattern: /(?<subject>\w+(?:\s+\w+)?)\s+(?<constraint>cannot|must not|shall not|may not)\s+(?<action>[^.!?]+)/gi,
        factType: "constraint",
        confidence: 0.9,
        tags: ["constraint", "restriction"],
        builder: (match) => {
            const subject = match.groups?.subject?.trim();
            const constraint = match.groups?.constraint?.toLowerCase();
            const action = match.groups?.action?.trim();
            if (!subject || !constraint || !action) {return null;}
            return `${subject} ${constraint} ${action}`;
        }
    },

    // Assertion patterns: "confirmed/verified"
    {
        pattern: /(?:confirmed|verified|established|determined|concluded)\s+that\s+(?<assertion>[^.!?]+)/gi,
        factType: "assertion",
        confidence: 0.85,
        tags: ["assertion", "verified"],
        builder: (match) => {
            const assertion = match.groups?.assertion?.trim();
            if (!assertion) {return null;}
            return `Confirmed: ${assertion}`;
        }
    },

    // Equals patterns: "X equals/means Y"
    {
        pattern: /(?<subject>\w+)\s+(?:equals|means|represents|implies)\s+(?<value>[^.!?]+)/gi,
        factType: "equivalence",
        confidence: 0.8,
        tags: ["equivalence", "mapping"],
        builder: (match) => {
            const subject = match.groups?.subject?.trim();
            const value = match.groups?.value?.trim();
            if (!subject || !value) {return null;}
            return `${subject} equals ${value}`;
        }
    },

    // Function definition
    {
        pattern: /(?:function|def|fn|async\s+function)\s+(?<name>\w+)\s*\([^)]*\)/gi,
        factType: "code_function",
        confidence: 0.95,
        tags: ["code", "function"],
        builder: (match) => {
            const name = match.groups?.name;
            if (!name) {return null;}
            return `Function defined: ${name}`;
        }
    },

    // Class/Interface definition
    {
        pattern: /(?:class|interface|type|struct)\s+(?<name>\w+)(?:\s+extends\s+(?<extends>\w+))?/gi,
        factType: "code_type",
        confidence: 0.95,
        tags: ["code", "type"],
        builder: (match) => {
            const name = match.groups?.name;
            const ext = match.groups?.extends;
            if (!name) {return null;}
            return ext ? `Type defined: ${name} extends ${ext}` : `Type defined: ${name}`;
        }
    },

    // Export patterns
    {
        pattern: /export\s+(?:default\s+)?(?:class|function|const|let|var|type|interface)\s+(?<name>\w+)/gi,
        factType: "code_export",
        confidence: 0.9,
        tags: ["code", "export"],
        builder: (match) => {
            const name = match.groups?.name;
            if (!name) {return null;}
            return `Export: ${name}`;
        }
    },

    // Import patterns
    {
        pattern: /import\s+(?:{[^}]+}|\w+)\s+from\s+["'](?<module>[^"']+)["']/gi,
        factType: "code_import",
        confidence: 0.9,
        tags: ["code", "dependency"],
        builder: (match) => {
            const module = match.groups?.module;
            if (!module) {return null;}
            return `Import from: ${module}`;
        }
    },

    // API endpoint patterns
    {
        pattern: /(?:GET|POST|PUT|DELETE|PATCH)\s+(?<endpoint>\/[^\s]+)/gi,
        factType: "api_endpoint",
        confidence: 0.9,
        tags: ["api", "endpoint"],
        builder: (match) => {
            const endpoint = match.groups?.endpoint;
            if (!endpoint) {return null;}
            return `API endpoint: ${match[0].trim()}`;
        }
    },

    // Error patterns
    {
        pattern: /(?:Error|Exception|Failure):\s*(?<message>[^.!?\n]+)/gi,
        factType: "error",
        confidence: 0.85,
        tags: ["error", "issue"],
        builder: (match) => {
            const message = match.groups?.message?.trim();
            if (!message) {return null;}
            return `Error: ${message}`;
        }
    }
];

// ============================================================================
// PROTOCOL FACT EXTRACTOR
// ============================================================================

/**
 * Protocol Fact Extractor
 *
 * Extracts structured facts from text content for EvidencePack.
 */
export class ProtocolFactExtractor {
    private config: ProtocolFactExtractorConfig;

    constructor(config: Partial<ProtocolFactExtractorConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Extract facts from text
     */
    extract(text: string, sourceRefs: string[]): ExtractedFact[] {
        const facts: ExtractedFact[] = [];
        const seenFacts = new Set<string>();

        for (const factPattern of FACT_PATTERNS) {
            // Skip disabled patterns
            if (factPattern.factType.startsWith("code_") && !this.config.extractCode) {
                continue;
            }
            if (factPattern.factType === "requirement" && !this.config.extractRequirements) {
                continue;
            }
            if (factPattern.factType === "constraint" && !this.config.extractConstraints) {
                continue;
            }

            // Reset pattern
            factPattern.pattern.lastIndex = 0;

            let match;
            while ((match = factPattern.pattern.exec(text)) !== null) {
                try {
                    const content = factPattern.builder(match);

                    if (!content) {continue;}

                    // Validate length
                    if (
                        content.length < this.config.minLength ||
                        content.length > this.config.maxLength
                    ) {
                        continue;
                    }

                    // Check confidence threshold
                    if (factPattern.confidence < this.config.minConfidence) {
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
                        fact_id: this.generateFactId(),
                        content,
                        confidence: factPattern.confidence,
                        source_refs: sourceRefs,
                        tags: [...factPattern.tags, factPattern.factType]
                    });

                } catch {
                    // Skip invalid matches
                    continue;
                }
            }
        }

        // Sort by confidence (highest first)
        facts.sort((a, b) => b.confidence - a.confidence);

        // Limit and return
        return facts.slice(0, this.config.maxFacts);
    }

    /**
     * Extract facts from multiple sources
     */
    extractFromSources(
        sources: Array<{ content: string; identifier: string }>
    ): ExtractedFact[] {
        const allFacts: ExtractedFact[] = [];
        const seenFacts = new Set<string>();

        for (const source of sources) {
            const sourceFacts = this.extract(source.content, [source.identifier]);

            for (const fact of sourceFacts) {
                const key = fact.content.toLowerCase().trim();
                if (!seenFacts.has(key)) {
                    seenFacts.add(key);
                    allFacts.push(fact);
                }
            }
        }

        // Sort by confidence
        allFacts.sort((a, b) => b.confidence - a.confidence);

        return allFacts.slice(0, this.config.maxFacts);
    }

    /**
     * Extract code-specific facts
     */
    extractFromCode(code: string, filePath: string): ExtractedFact[] {
        const facts: ExtractedFact[] = [];
        const seenFacts = new Set<string>();

        // Extract function declarations
        const funcPattern = /(?:function|def|fn|async\s+function)\s+(\w+)\s*\(([^)]*)\)/g;
        let match;
        while ((match = funcPattern.exec(code)) !== null) {
            const name = match[1];
            const params = match[2];
            const key = `func:${name}`;
            if (!seenFacts.has(key)) {
                seenFacts.add(key);
                facts.push({
                    fact_id: this.generateFactId(),
                    content: `Function '${name}(${params})' in ${filePath}`,
                    confidence: 0.95,
                    source_refs: [filePath],
                    tags: ["code", "function", "definition"]
                });
            }
        }

        // Extract class/interface declarations
        const classPattern = /(?:class|interface|type|struct)\s+(\w+)(?:\s+(?:extends|implements)\s+(\w+))?/g;
        while ((match = classPattern.exec(code)) !== null) {
            const name = match[1];
            const parent = match[2];
            const key = `type:${name}`;
            if (!seenFacts.has(key)) {
                seenFacts.add(key);
                const content = parent
                    ? `Type '${name}' extends '${parent}' in ${filePath}`
                    : `Type '${name}' in ${filePath}`;
                facts.push({
                    fact_id: this.generateFactId(),
                    content,
                    confidence: 0.95,
                    source_refs: [filePath],
                    tags: ["code", "type", "definition"]
                });
            }
        }

        // Extract exports
        const exportPattern = /export\s+(?:default\s+)?(?:class|function|const|let|var|type|interface)\s+(\w+)/g;
        while ((match = exportPattern.exec(code)) !== null) {
            const name = match[1];
            const key = `export:${name}`;
            if (!seenFacts.has(key)) {
                seenFacts.add(key);
                facts.push({
                    fact_id: this.generateFactId(),
                    content: `Export '${name}' from ${filePath}`,
                    confidence: 0.9,
                    source_refs: [filePath],
                    tags: ["code", "export"]
                });
            }
        }

        // Extract imports
        const importPattern = /import\s+(?:{([^}]+)}|(\w+))\s+from\s+["']([^"']+)["']/g;
        while ((match = importPattern.exec(code)) !== null) {
            const named = match[1];
            const defaultImport = match[2];
            const module = match[3];
            const key = `import:${module}`;
            if (!seenFacts.has(key)) {
                seenFacts.add(key);
                const imports = named || defaultImport || "default";
                facts.push({
                    fact_id: this.generateFactId(),
                    content: `Import '${imports}' from '${module}'`,
                    confidence: 0.9,
                    source_refs: [filePath],
                    tags: ["code", "import", "dependency"]
                });
            }
        }

        return facts.slice(0, this.config.maxFacts);
    }

    /**
     * Merge facts from multiple extractors
     */
    mergeFacts(factSets: ExtractedFact[][]): ExtractedFact[] {
        const merged: ExtractedFact[] = [];
        const seenFacts = new Set<string>();

        for (const factSet of factSets) {
            for (const fact of factSet) {
                const key = fact.content.toLowerCase().trim();
                if (!seenFacts.has(key)) {
                    seenFacts.add(key);
                    merged.push(fact);
                }
            }
        }

        // Sort by confidence
        merged.sort((a, b) => b.confidence - a.confidence);

        return merged.slice(0, this.config.maxFacts);
    }

    /**
     * Generate unique fact ID
     */
    private generateFactId(): string {
        return `fact_${crypto.randomUUID().substring(0, 8)}`;
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create protocol fact extractor
 */
export function createProtocolFactExtractor(
    config?: Partial<ProtocolFactExtractorConfig>
): ProtocolFactExtractor {
    return new ProtocolFactExtractor(config);
}
