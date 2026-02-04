/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON Style Module
 * =================
 *
 * Style validation and contract enforcement for BYON executor output.
 *
 * Exports:
 * - BYONStyleValidator: Main style validator
 * - ValidateOrRegenerateController: Validate-or-regenerate pattern
 * - Factory functions for quick validation
 */

// ============================================================================
// VALIDATOR
// ============================================================================

export {
    // Main class
    BYONStyleValidator,

    // Types
    type StyleViolation,
    type ValidationResult,
    type ForbiddenCategory,
    type ForbiddenPhrase,
    type StyleValidatorConfig,

    // Factory functions
    createStyleValidator,
    createStrictStyleValidator,
    createLenientStyleValidator,

    // Quick functions
    checkStyle,
    isStyleValid,

    // Pattern collections
    FORBIDDEN_PHRASES
} from "./byon-validator.js";

// ============================================================================
// VALIDATE OR REGENERATE
// ============================================================================

export {
    // Main class
    ValidateOrRegenerateController,

    // Types
    type RegenerationRequest,
    type ValidateOrRegenerateResult,
    type AttemptRecord,
    type ValidateOrRegenerateConfig,
    type RegenerationCallback,

    // Factory functions
    createValidateOrRegenerate,

    // Quick functions
    validateAndFix,
    quickValidate
} from "./validate-or-regenerate.js";
