/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Validate or Regenerate
 * ======================
 *
 * Validates BYON output and triggers regeneration if needed.
 * Implements the validate-or-regenerate pattern for style compliance.
 *
 * Flow:
 * 1. Validate output against style contract
 * 2. If valid -> return output
 * 3. If invalid -> attempt to fix or request regeneration
 * 4. Track regeneration attempts to prevent infinite loops
 */

import {
    BYONStyleValidator,
    ValidationResult,
    StyleViolation,
    createStyleValidator,
    ForbiddenCategory
} from "./byon-validator.js";

// ============================================================================
// TYPES
// ============================================================================

export interface RegenerationRequest {
    /** Original output that failed */
    originalOutput: string;
    /** Validation result */
    validationResult: ValidationResult;
    /** Regeneration attempt number */
    attemptNumber: number;
    /** Instructions for regeneration */
    instructions: string;
    /** Specific violations to fix */
    violationsToFix: StyleViolation[];
}

export interface ValidateOrRegenerateResult {
    /** Final output (validated or regenerated) */
    output: string;
    /** Whether output is valid */
    valid: boolean;
    /** Whether regeneration was needed */
    regenerated: boolean;
    /** Number of regeneration attempts */
    attempts: number;
    /** Final validation result */
    validation: ValidationResult;
    /** History of attempts */
    history: AttemptRecord[];
}

export interface AttemptRecord {
    /** Attempt number */
    attempt: number;
    /** Output for this attempt */
    output: string;
    /** Validation result */
    validation: ValidationResult;
    /** Whether this attempt passed */
    passed: boolean;
}

export interface ValidateOrRegenerateConfig {
    /** Maximum regeneration attempts */
    maxAttempts: number;
    /** Minimum score to accept */
    minScore: number;
    /** Allow auto-fix for simple violations */
    autoFix: boolean;
    /** Style validator config */
    validatorConfig?: Parameters<typeof createStyleValidator>[0];
}

export type RegenerationCallback = (
    request: RegenerationRequest
) => Promise<string>;

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: ValidateOrRegenerateConfig = {
    maxAttempts: 3,
    minScore: 80,
    autoFix: true
};

// ============================================================================
// AUTO-FIX RULES
// ============================================================================

interface AutoFixRule {
    /** Pattern to match */
    pattern: RegExp;
    /** Replacement */
    replacement: string;
    /** Category this fixes */
    category: ForbiddenCategory;
}

const AUTO_FIX_RULES: AutoFixRule[] = [
    // Apologetic phrases
    {
        pattern: /\bI('m| am) sorry,?\s*/gi,
        replacement: "",
        category: "apologetic"
    },
    {
        pattern: /\bapologies,?\s*/gi,
        replacement: "",
        category: "apologetic"
    },
    {
        pattern: /\bI apologize,?\s*/gi,
        replacement: "",
        category: "apologetic"
    },

    // Empathy phrases
    {
        pattern: /\bI understand\s+(that\s+)?/gi,
        replacement: "",
        category: "empathy"
    },
    {
        pattern: /\bwith pleasure,?\s*/gi,
        replacement: "",
        category: "empathy"
    },

    // Meta phrases
    {
        pattern: /\bAs an AI,?\s*/gi,
        replacement: "",
        category: "meta"
    },
    {
        pattern: /\bI'm just an AI,?\s*/gi,
        replacement: "",
        category: "meta"
    },

    // Filler words (careful removal)
    {
        pattern: /\bbasically,?\s*/gi,
        replacement: "",
        category: "filler"
    },
    {
        pattern: /\bactually,?\s*/gi,
        replacement: "",
        category: "filler"
    },

    // Hedging
    {
        pattern: /\bI think\s+(that\s+)?/gi,
        replacement: "",
        category: "hedging"
    },
    {
        pattern: /\bI believe\s+(that\s+)?/gi,
        replacement: "",
        category: "hedging"
    }
];

// ============================================================================
// VALIDATE OR REGENERATE
// ============================================================================

/**
 * Validate or Regenerate Controller
 *
 * Manages validation and regeneration cycle.
 */
export class ValidateOrRegenerateController {
    private config: ValidateOrRegenerateConfig;
    private validator: BYONStyleValidator;
    private regenerateCallback?: RegenerationCallback;

    constructor(
        config: Partial<ValidateOrRegenerateConfig> = {},
        regenerateCallback?: RegenerationCallback
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.validator = createStyleValidator(this.config.validatorConfig);
        this.regenerateCallback = regenerateCallback;
    }

    /**
     * Validate output and regenerate if needed
     */
    async validateOrRegenerate(
        output: string
    ): Promise<ValidateOrRegenerateResult> {
        const history: AttemptRecord[] = [];
        let currentOutput = output;
        let attempts = 0;

        while (attempts < this.config.maxAttempts) {
            attempts++;

            // Validate current output
            const validation = this.validator.validate(currentOutput);

            // Record attempt
            history.push({
                attempt: attempts,
                output: currentOutput,
                validation,
                passed: validation.valid && validation.score >= this.config.minScore
            });

            // Check if valid
            if (validation.valid && validation.score >= this.config.minScore) {
                return {
                    output: currentOutput,
                    valid: true,
                    regenerated: attempts > 1,
                    attempts,
                    validation,
                    history
                };
            }

            // Try auto-fix first
            if (this.config.autoFix) {
                const fixed = this.tryAutoFix(currentOutput, validation);
                if (fixed !== currentOutput) {
                    currentOutput = fixed;
                    continue; // Re-validate with fixed output
                }
            }

            // Request regeneration if callback available
            if (this.regenerateCallback && attempts < this.config.maxAttempts) {
                const request = this.createRegenerationRequest(
                    currentOutput,
                    validation,
                    attempts
                );
                currentOutput = await this.regenerateCallback(request);
            } else {
                // No more options, return with current state
                break;
            }
        }

        // Return final result (may not be valid)
        const finalValidation = this.validator.validate(currentOutput);
        return {
            output: currentOutput,
            valid: finalValidation.valid && finalValidation.score >= this.config.minScore,
            regenerated: attempts > 1,
            attempts,
            validation: finalValidation,
            history
        };
    }

    /**
     * Validate only (no regeneration)
     */
    validateOnly(output: string): ValidationResult {
        return this.validator.validate(output);
    }

    /**
     * Try auto-fix for simple violations
     */
    private tryAutoFix(output: string, validation: ValidationResult): string {
        let fixed = output;

        // Get categories that need fixing
        const violatedCategories = new Set(
            validation.violations.map(v => v.category)
        );

        // Apply relevant fix rules
        for (const rule of AUTO_FIX_RULES) {
            if (violatedCategories.has(rule.category)) {
                fixed = fixed.replace(rule.pattern, rule.replacement);
            }
        }

        // Clean up double spaces and leading/trailing whitespace
        fixed = fixed
            .replace(/\s{2,}/g, " ")
            .replace(/^\s+/gm, "")
            .trim();

        // Fix sentence starts after removal
        fixed = this.fixSentenceStarts(fixed);

        return fixed;
    }

    /**
     * Fix sentence capitalization after word removal
     */
    private fixSentenceStarts(text: string): string {
        // Capitalize first letter after period, question mark, exclamation
        return text.replace(
            /([.!?]\s+)([a-z])/g,
            (_, punctuation, letter) => punctuation + letter.toUpperCase()
        );
    }

    /**
     * Create regeneration request
     */
    private createRegenerationRequest(
        output: string,
        validation: ValidationResult,
        attemptNumber: number
    ): RegenerationRequest {
        const errorViolations = validation.violations.filter(
            v => v.severity === "error"
        );

        const instructions = this.generateInstructions(validation);

        return {
            originalOutput: output,
            validationResult: validation,
            attemptNumber,
            instructions,
            violationsToFix: errorViolations
        };
    }

    /**
     * Generate regeneration instructions
     */
    private generateInstructions(validation: ValidationResult): string {
        const parts: string[] = [
            "Output failed BYON style validation.",
            `Score: ${validation.score}/100 (minimum: ${this.config.minScore})`
        ];

        // Group violations by category
        const byCategory = new Map<ForbiddenCategory, StyleViolation[]>();
        for (const violation of validation.violations) {
            if (!byCategory.has(violation.category)) {
                byCategory.set(violation.category, []);
            }
            byCategory.get(violation.category)!.push(violation);
        }

        // Add specific instructions per category
        for (const [category, violations] of byCategory) {
            const examples = violations
                .slice(0, 3)
                .map(v => `"${v.matchedText}"`)
                .join(", ");

            switch (category) {
                case "psychology":
                    parts.push(`Remove psychology terms (${examples})`);
                    break;
                case "empathy":
                    parts.push(`Remove empathy phrases (${examples})`);
                    break;
                case "stories":
                    parts.push(`Remove narrative language (${examples})`);
                    break;
                case "meta":
                    parts.push(`Remove AI self-references (${examples})`);
                    break;
                case "apologetic":
                    parts.push(`Remove apologies (${examples})`);
                    break;
                case "filler":
                    parts.push(`Remove filler words (${examples})`);
                    break;
                case "hedging":
                    parts.push(`Remove hedging language (${examples})`);
                    break;
            }
        }

        parts.push("Regenerate with factual, technical language only.");

        return parts.join("\n");
    }

    /**
     * Set regeneration callback
     */
    setRegenerationCallback(callback: RegenerationCallback): void {
        this.regenerateCallback = callback;
    }

    /**
     * Get validator
     */
    getValidator(): BYONStyleValidator {
        return this.validator;
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create validate-or-regenerate controller
 */
export function createValidateOrRegenerate(
    config?: Partial<ValidateOrRegenerateConfig>,
    regenerateCallback?: RegenerationCallback
): ValidateOrRegenerateController {
    return new ValidateOrRegenerateController(config, regenerateCallback);
}

/**
 * Simple validate-or-fix (auto-fix only, no regeneration)
 */
export function validateAndFix(output: string): {
    output: string;
    valid: boolean;
    fixed: boolean;
    validation: ValidationResult;
} {
    const controller = new ValidateOrRegenerateController({
        maxAttempts: 1,
        autoFix: true
    });

    const originalValidation = controller.validateOnly(output);

    if (originalValidation.valid) {
        return {
            output,
            valid: true,
            fixed: false,
            validation: originalValidation
        };
    }

    // Try auto-fix
    const validator = controller.getValidator();
    let fixed = output;

    for (const rule of AUTO_FIX_RULES) {
        fixed = fixed.replace(rule.pattern, rule.replacement);
    }

    fixed = fixed
        .replace(/\s{2,}/g, " ")
        .replace(/^\s+/gm, "")
        .trim();

    const fixedValidation = validator.validate(fixed);

    return {
        output: fixed,
        valid: fixedValidation.valid,
        fixed: fixed !== output,
        validation: fixedValidation
    };
}

/**
 * Quick validate without regeneration
 */
export function quickValidate(output: string): ValidationResult {
    const validator = createStyleValidator();
    return validator.validate(output);
}
