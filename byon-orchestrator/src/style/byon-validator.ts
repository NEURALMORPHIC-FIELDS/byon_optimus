/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON Style Validator
 * ====================
 *
 * Validates BYON executor output against style contract.
 * Ensures outputs are factual, technical, and free of forbidden patterns.
 *
 * Forbidden Categories:
 * - Psychology: No anxiety, stress, coping language
 * - Empathy: No "I understand", "with pleasure" phrases
 * - Stories: No "imagine", "picture this" narratives
 * - Meta: No "as an AI", "my limitations" self-references
 *
 * BYON outputs must be:
 * - Factual and technical
 * - Action-oriented
 * - Free of emotional language
 * - Professional and precise
 */

// ============================================================================
// TYPES
// ============================================================================

export interface StyleViolation {
    /** Category of violation */
    category: ForbiddenCategory;
    /** The matched pattern */
    pattern: string;
    /** Matched text */
    matchedText: string;
    /** Location in text */
    location: { line: number; column: number; offset: number };
    /** Severity */
    severity: "warning" | "error";
    /** Suggested replacement (if available) */
    suggestion?: string;
}

export interface ValidationResult {
    /** Whether output passes validation */
    valid: boolean;
    /** Violations found */
    violations: StyleViolation[];
    /** Violation count by category */
    violationsByCategory: Record<ForbiddenCategory, number>;
    /** Overall score (0-100, 100 = perfect) */
    score: number;
    /** Summary message */
    summary: string;
}

export type ForbiddenCategory =
    | "psychology"
    | "empathy"
    | "stories"
    | "meta"
    | "filler"
    | "hedging"
    | "apologetic";

export interface ForbiddenPhrase {
    /** Pattern to match */
    pattern: RegExp;
    /** Category */
    category: ForbiddenCategory;
    /** Severity */
    severity: "warning" | "error";
    /** Description */
    description: string;
    /** Suggested replacement */
    suggestion?: string;
}

export interface StyleValidatorConfig {
    /** Categories to check */
    enabledCategories: ForbiddenCategory[];
    /** Fail on warnings */
    failOnWarnings: boolean;
    /** Custom forbidden phrases */
    customPhrases: ForbiddenPhrase[];
    /** Maximum allowed warnings */
    maxWarnings: number;
}

// ============================================================================
// FORBIDDEN PHRASES
// ============================================================================

/**
 * Psychology-related forbidden phrases
 */
const PSYCHOLOGY_PHRASES: ForbiddenPhrase[] = [
    {
        pattern: /\b(anxiety|anxious)\b/gi,
        category: "psychology",
        severity: "error",
        description: "Psychology term: anxiety",
        suggestion: "Use technical language instead"
    },
    {
        pattern: /\b(stress|stressed|stressful)\b/gi,
        category: "psychology",
        severity: "error",
        description: "Psychology term: stress"
    },
    {
        pattern: /\b(cope|coping)\b/gi,
        category: "psychology",
        severity: "error",
        description: "Psychology term: coping"
    },
    {
        pattern: /\b(therapy|therapeutic)\b/gi,
        category: "psychology",
        severity: "error",
        description: "Psychology term: therapy"
    },
    {
        pattern: /\b(emotion|emotional|emotionally)\b/gi,
        category: "psychology",
        severity: "warning",
        description: "Emotional language"
    },
    {
        pattern: /\b(overwhelm|overwhelming|overwhelmed)\b/gi,
        category: "psychology",
        severity: "error",
        description: "Psychology term: overwhelm"
    },
    {
        pattern: /\b(trauma|traumatic)\b/gi,
        category: "psychology",
        severity: "error",
        description: "Psychology term: trauma"
    }
];

/**
 * Empathy-related forbidden phrases
 */
const EMPATHY_PHRASES: ForbiddenPhrase[] = [
    {
        pattern: /\bI understand\b/gi,
        category: "empathy",
        severity: "error",
        description: "Empathy phrase: I understand",
        suggestion: "Remove or rephrase factually"
    },
    {
        pattern: /\bwith pleasure\b/gi,
        category: "empathy",
        severity: "error",
        description: "Empathy phrase: with pleasure"
    },
    {
        pattern: /\bI feel\b/gi,
        category: "empathy",
        severity: "error",
        description: "Empathy phrase: I feel"
    },
    {
        pattern: /\bI appreciate\b/gi,
        category: "empathy",
        severity: "warning",
        description: "Empathy phrase: I appreciate"
    },
    {
        pattern: /\bI'm here (for you|to help)\b/gi,
        category: "empathy",
        severity: "error",
        description: "Empathy phrase: I'm here for you"
    },
    {
        pattern: /\bthat must be\b/gi,
        category: "empathy",
        severity: "error",
        description: "Empathy assumption"
    },
    {
        pattern: /\bI can imagine\b/gi,
        category: "empathy",
        severity: "error",
        description: "Empathy phrase: I can imagine"
    }
];

/**
 * Story/narrative forbidden phrases
 */
const STORY_PHRASES: ForbiddenPhrase[] = [
    {
        pattern: /\bimagine\b/gi,
        category: "stories",
        severity: "error",
        description: "Narrative language: imagine",
        suggestion: "Use factual description"
    },
    {
        pattern: /\blet me tell you\b/gi,
        category: "stories",
        severity: "error",
        description: "Narrative phrase: let me tell you"
    },
    {
        pattern: /\bpicture this\b/gi,
        category: "stories",
        severity: "error",
        description: "Narrative phrase: picture this"
    },
    {
        pattern: /\bonce upon a time\b/gi,
        category: "stories",
        severity: "error",
        description: "Story opening"
    },
    {
        pattern: /\bstory\s+(time|begins)\b/gi,
        category: "stories",
        severity: "error",
        description: "Story narrative"
    },
    {
        pattern: /\bthink of it (like|as)\b/gi,
        category: "stories",
        severity: "warning",
        description: "Analogy language"
    }
];

/**
 * Meta/self-reference forbidden phrases
 */
const META_PHRASES: ForbiddenPhrase[] = [
    {
        pattern: /\bas an AI\b/gi,
        category: "meta",
        severity: "error",
        description: "Meta reference: as an AI",
        suggestion: "Remove self-reference"
    },
    {
        pattern: /\bmy limitations\b/gi,
        category: "meta",
        severity: "error",
        description: "Meta reference: my limitations"
    },
    {
        pattern: /\bI cannot\b/gi,
        category: "meta",
        severity: "warning",
        description: "Meta phrase: I cannot"
    },
    {
        pattern: /\bI'm (just )?a(n)?\s+(language model|AI|assistant)\b/gi,
        category: "meta",
        severity: "error",
        description: "Meta self-identification"
    },
    {
        pattern: /\bmy training\b/gi,
        category: "meta",
        severity: "error",
        description: "Meta reference: training"
    },
    {
        pattern: /\bmy knowledge cutoff\b/gi,
        category: "meta",
        severity: "error",
        description: "Meta reference: knowledge cutoff"
    },
    {
        pattern: /\bI was programmed\b/gi,
        category: "meta",
        severity: "error",
        description: "Meta reference: programming"
    }
];

/**
 * Filler words and phrases
 */
const FILLER_PHRASES: ForbiddenPhrase[] = [
    {
        pattern: /\bbasically\b/gi,
        category: "filler",
        severity: "warning",
        description: "Filler word: basically"
    },
    {
        pattern: /\bactually\b/gi,
        category: "filler",
        severity: "warning",
        description: "Filler word: actually"
    },
    {
        pattern: /\bjust\b/gi,
        category: "filler",
        severity: "warning",
        description: "Filler word: just"
    },
    {
        pattern: /\breally\b/gi,
        category: "filler",
        severity: "warning",
        description: "Filler word: really"
    },
    {
        pattern: /\bvery\b/gi,
        category: "filler",
        severity: "warning",
        description: "Filler word: very"
    }
];

/**
 * Hedging phrases
 */
const HEDGING_PHRASES: ForbiddenPhrase[] = [
    {
        pattern: /\bI think\b/gi,
        category: "hedging",
        severity: "warning",
        description: "Hedging phrase: I think"
    },
    {
        pattern: /\bI believe\b/gi,
        category: "hedging",
        severity: "warning",
        description: "Hedging phrase: I believe"
    },
    {
        pattern: /\bperhaps\b/gi,
        category: "hedging",
        severity: "warning",
        description: "Hedging word: perhaps"
    },
    {
        pattern: /\bmaybe\b/gi,
        category: "hedging",
        severity: "warning",
        description: "Hedging word: maybe"
    },
    {
        pattern: /\bprobably\b/gi,
        category: "hedging",
        severity: "warning",
        description: "Hedging word: probably"
    },
    {
        pattern: /\bmight\b/gi,
        category: "hedging",
        severity: "warning",
        description: "Hedging word: might"
    }
];

/**
 * Apologetic phrases
 */
const APOLOGETIC_PHRASES: ForbiddenPhrase[] = [
    {
        pattern: /\bI('m| am) sorry\b/gi,
        category: "apologetic",
        severity: "error",
        description: "Apologetic phrase"
    },
    {
        pattern: /\bapologies\b/gi,
        category: "apologetic",
        severity: "error",
        description: "Apologetic phrase"
    },
    {
        pattern: /\bI apologize\b/gi,
        category: "apologetic",
        severity: "error",
        description: "Apologetic phrase"
    },
    {
        pattern: /\bunfortunately\b/gi,
        category: "apologetic",
        severity: "warning",
        description: "Negative framing"
    }
];

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: StyleValidatorConfig = {
    enabledCategories: [
        "psychology",
        "empathy",
        "stories",
        "meta",
        "apologetic"
    ],
    failOnWarnings: false,
    customPhrases: [],
    maxWarnings: 5
};

// ============================================================================
// BYON STYLE VALIDATOR
// ============================================================================

/**
 * BYON Style Validator
 *
 * Validates executor output against style contract.
 */
export class BYONStyleValidator {
    private config: StyleValidatorConfig;
    private phrases: ForbiddenPhrase[];

    constructor(config: Partial<StyleValidatorConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.phrases = [];

        this.initializePhrases();
    }

    /**
     * Initialize phrase patterns
     */
    private initializePhrases(): void {
        const categoryPhrases: Record<ForbiddenCategory, ForbiddenPhrase[]> = {
            psychology: PSYCHOLOGY_PHRASES,
            empathy: EMPATHY_PHRASES,
            stories: STORY_PHRASES,
            meta: META_PHRASES,
            filler: FILLER_PHRASES,
            hedging: HEDGING_PHRASES,
            apologetic: APOLOGETIC_PHRASES
        };

        for (const category of this.config.enabledCategories) {
            const phrases = categoryPhrases[category];
            if (phrases) {
                this.phrases.push(...phrases);
            }
        }

        // Add custom phrases
        this.phrases.push(...this.config.customPhrases);
    }

    /**
     * Validate text against style contract
     */
    validate(text: string): ValidationResult {
        const violations: StyleViolation[] = [];
        const violationsByCategory: Record<ForbiddenCategory, number> = {
            psychology: 0,
            empathy: 0,
            stories: 0,
            meta: 0,
            filler: 0,
            hedging: 0,
            apologetic: 0
        };

        for (const phrase of this.phrases) {
            // Reset regex
            phrase.pattern.lastIndex = 0;

            let match;
            while ((match = phrase.pattern.exec(text)) !== null) {
                // Calculate location
                const beforeMatch = text.substring(0, match.index);
                const lines = beforeMatch.split("\n");
                const line = lines.length;
                const column = lines[lines.length - 1].length + 1;

                violations.push({
                    category: phrase.category,
                    pattern: phrase.pattern.source,
                    matchedText: match[0],
                    location: {
                        line,
                        column,
                        offset: match.index
                    },
                    severity: phrase.severity,
                    suggestion: phrase.suggestion
                });

                violationsByCategory[phrase.category]++;
            }
        }

        // Calculate score
        const errorCount = violations.filter(v => v.severity === "error").length;
        const warningCount = violations.filter(v => v.severity === "warning").length;

        // Score calculation: start at 100, -10 per error, -2 per warning
        const score = Math.max(0, 100 - (errorCount * 10) - (warningCount * 2));

        // Determine validity
        let valid = errorCount === 0;
        if (this.config.failOnWarnings && warningCount > this.config.maxWarnings) {
            valid = false;
        }

        // Generate summary
        const summary = this.generateSummary(violations, score, valid);

        return {
            valid,
            violations,
            violationsByCategory,
            score,
            summary
        };
    }

    /**
     * Quick check for validity
     */
    isValid(text: string): boolean {
        return this.validate(text).valid;
    }

    /**
     * Get violations only
     */
    getViolations(text: string): StyleViolation[] {
        return this.validate(text).violations;
    }

    /**
     * Check specific category
     */
    checkCategory(text: string, category: ForbiddenCategory): StyleViolation[] {
        const phrases = this.phrases.filter(p => p.category === category);
        const violations: StyleViolation[] = [];

        for (const phrase of phrases) {
            phrase.pattern.lastIndex = 0;

            let match;
            while ((match = phrase.pattern.exec(text)) !== null) {
                const beforeMatch = text.substring(0, match.index);
                const lines = beforeMatch.split("\n");

                violations.push({
                    category: phrase.category,
                    pattern: phrase.pattern.source,
                    matchedText: match[0],
                    location: {
                        line: lines.length,
                        column: lines[lines.length - 1].length + 1,
                        offset: match.index
                    },
                    severity: phrase.severity,
                    suggestion: phrase.suggestion
                });
            }
        }

        return violations;
    }

    /**
     * Generate summary message
     */
    private generateSummary(
        violations: StyleViolation[],
        score: number,
        valid: boolean
    ): string {
        if (violations.length === 0) {
            return "Output passes BYON style validation. Score: 100/100";
        }

        const errorCount = violations.filter(v => v.severity === "error").length;
        const warningCount = violations.filter(v => v.severity === "warning").length;

        const parts: string[] = [];

        if (valid) {
            parts.push("Output passes with warnings.");
        } else {
            parts.push("Output FAILS style validation.");
        }

        parts.push(`Score: ${score}/100`);
        parts.push(`Errors: ${errorCount}`);
        parts.push(`Warnings: ${warningCount}`);

        // List top violation categories
        const categories = new Set(violations.map(v => v.category));
        if (categories.size > 0) {
            parts.push(`Categories: ${Array.from(categories).join(", ")}`);
        }

        return parts.join(" | ");
    }

    /**
     * Add custom phrase
     */
    addPhrase(phrase: ForbiddenPhrase): void {
        this.phrases.push(phrase);
    }

    /**
     * Enable category
     */
    enableCategory(category: ForbiddenCategory): void {
        if (!this.config.enabledCategories.includes(category)) {
            this.config.enabledCategories.push(category);
            // Reinitialize to add new phrases
            this.phrases = [];
            this.initializePhrases();
        }
    }

    /**
     * Disable category
     */
    disableCategory(category: ForbiddenCategory): void {
        this.config.enabledCategories = this.config.enabledCategories.filter(
            c => c !== category
        );
        // Remove phrases from disabled category
        this.phrases = this.phrases.filter(p => p.category !== category);
    }

    /**
     * Get all enabled categories
     */
    getEnabledCategories(): ForbiddenCategory[] {
        return [...this.config.enabledCategories];
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create BYON style validator
 */
export function createStyleValidator(
    config?: Partial<StyleValidatorConfig>
): BYONStyleValidator {
    return new BYONStyleValidator(config);
}

/**
 * Create strict validator (all categories, fail on warnings)
 */
export function createStrictStyleValidator(): BYONStyleValidator {
    return new BYONStyleValidator({
        enabledCategories: [
            "psychology",
            "empathy",
            "stories",
            "meta",
            "filler",
            "hedging",
            "apologetic"
        ],
        failOnWarnings: true,
        maxWarnings: 0
    });
}

/**
 * Create lenient validator (core categories only)
 */
export function createLenientStyleValidator(): BYONStyleValidator {
    return new BYONStyleValidator({
        enabledCategories: [
            "psychology",
            "empathy",
            "stories",
            "meta"
        ],
        failOnWarnings: false,
        maxWarnings: 10
    });
}

/**
 * Quick style check
 */
export function checkStyle(text: string): ValidationResult {
    const validator = createStyleValidator();
    return validator.validate(text);
}

/**
 * Quick validity check
 */
export function isStyleValid(text: string): boolean {
    const validator = createStyleValidator();
    return validator.isValid(text);
}

/**
 * Export phrase collections
 */
export const FORBIDDEN_PHRASES = {
    PSYCHOLOGY: PSYCHOLOGY_PHRASES,
    EMPATHY: EMPATHY_PHRASES,
    STORIES: STORY_PHRASES,
    META: META_PHRASES,
    FILLER: FILLER_PHRASES,
    HEDGING: HEDGING_PHRASES,
    APOLOGETIC: APOLOGETIC_PHRASES
};
