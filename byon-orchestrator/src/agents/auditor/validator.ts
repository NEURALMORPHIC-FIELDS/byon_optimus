/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Auditor Validator
 * =================
 *
 * Validation logic for the Auditor agent.
 * Validates EvidencePacks, PlanDrafts, and enforces policies.
 *
 * CRITICAL: GMV Gate
 * - GlobalMemoryHint MUST be metadata-only
 * - NO text content (labels) allowed
 * - Reject any EvidencePack with invalid GMV hint
 */

import {
    EvidencePack,
    PlanDraft,
    GlobalMemoryHint,
    Action,
    RiskLevel
} from "../../types/protocol.js";

// ============================================================================
// VALIDATION RESULT
// ============================================================================

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

// ============================================================================
// GMV GATE - CRITICAL POLICY
// ============================================================================

/**
 * Validate GlobalMemoryHint is metadata-only
 *
 * POLICY: GMV hint must contain ONLY:
 * - summary_ref (discriminator)
 * - timestamp
 * - active_attractor_ids (string array of IDs only)
 * - entropy_level
 * - system_coherence (optional)
 *
 * FORBIDDEN:
 * - label fields
 * - description fields
 * - any text content
 * - nested objects with text
 */
export function validateGlobalMemoryHint(hint: GlobalMemoryHint | undefined): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!hint) {
        return { valid: true, errors: [], warnings: [] };
    }

    // Check discriminator
    if (hint.summary_ref !== "GLOBAL_MEMORY_SUMMARY") {
        errors.push("POLICY_VIOLATION: GMV hint must have summary_ref = 'GLOBAL_MEMORY_SUMMARY'");
    }

    // Check for forbidden fields (text content)
    const forbiddenFields = ["label", "description", "content", "text", "name", "title"];
    for (const field of forbiddenFields) {
        if (field in hint) {
            errors.push(`POLICY_VIOLATION: GMV hint must not contain '${field}' field`);
        }
    }

    // Validate active_attractor_ids is string array (IDs only, no objects)
    if (hint.active_attractor_ids) {
        if (!Array.isArray(hint.active_attractor_ids)) {
            errors.push("POLICY_VIOLATION: active_attractor_ids must be an array");
        } else {
            for (let i = 0; i < hint.active_attractor_ids.length; i++) {
                const id = hint.active_attractor_ids[i];
                if (typeof id !== "string") {
                    errors.push(`POLICY_VIOLATION: active_attractor_ids[${i}] must be a string ID, not ${typeof id}`);
                }
                // Check if it looks like a label instead of an ID
                if (typeof id === "string" && id.includes(" ")) {
                    errors.push(`POLICY_VIOLATION: active_attractor_ids[${i}] appears to be a label, not an ID`);
                }
            }
        }
    }

    // Validate entropy_level
    const validEntropyLevels = ["stable", "rising", "fragmented"];
    if (hint.entropy_level && !validEntropyLevels.includes(hint.entropy_level)) {
        errors.push(`POLICY_VIOLATION: Invalid entropy_level '${hint.entropy_level}'`);
    }

    // Validate system_coherence range
    if (hint.system_coherence !== undefined) {
        if (typeof hint.system_coherence !== "number") {
            errors.push("POLICY_VIOLATION: system_coherence must be a number");
        } else if (hint.system_coherence < 0 || hint.system_coherence > 1) {
            errors.push("POLICY_VIOLATION: system_coherence must be between 0 and 1");
        }
    }

    // Warn if too many attractors (might indicate data leakage)
    if (hint.active_attractor_ids && hint.active_attractor_ids.length > 50) {
        warnings.push(`GMV hint has ${hint.active_attractor_ids.length} attractor IDs - consider limiting`);
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

// ============================================================================
// EVIDENCE PACK VALIDATION
// ============================================================================

/**
 * Validate an EvidencePack
 */
export function validateEvidencePack(ep: EvidencePack): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic structure validation
    if (!ep.evidence_id) {
        errors.push("Missing evidence_id");
    }

    if (!ep.timestamp) {
        errors.push("Missing timestamp");
    }

    if (!ep.task_type) {
        errors.push("Missing task_type");
    }

    if (!ep.hash) {
        errors.push("Missing hash");
    }

    // Validate document type
    if (ep.document_type !== "EVIDENCE_PACK") {
        errors.push(`Invalid document_type: expected 'EVIDENCE_PACK', got '${ep.document_type}'`);
    }

    // GMV GATE - Critical policy check
    const gmvValidation = validateGlobalMemoryHint(ep.global_memory_hint);
    errors.push(...gmvValidation.errors);
    warnings.push(...gmvValidation.warnings);

    // Check for forbidden data
    if (ep.forbidden_data_present) {
        errors.push("POLICY_VIOLATION: Evidence contains forbidden data");
    }

    // Validate sources
    if (!ep.sources || ep.sources.length === 0) {
        warnings.push("EvidencePack has no sources");
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

// ============================================================================
// PLAN DRAFT VALIDATION
// ============================================================================

/**
 * Validate a PlanDraft
 */
export function validatePlanDraft(plan: PlanDraft): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic structure validation
    if (!plan.plan_id) {
        errors.push("Missing plan_id");
    }

    if (!plan.timestamp) {
        errors.push("Missing timestamp");
    }

    if (!plan.based_on_evidence) {
        errors.push("Missing based_on_evidence");
    }

    if (!plan.hash) {
        errors.push("Missing hash");
    }

    // Validate document type
    if (plan.document_type !== "PLAN_DRAFT") {
        errors.push(`Invalid document_type: expected 'PLAN_DRAFT', got '${plan.document_type}'`);
    }

    // Validate actions
    if (!plan.actions || plan.actions.length === 0) {
        errors.push("PlanDraft has no actions");
    } else {
        for (let i = 0; i < plan.actions.length; i++) {
            const actionErrors = validateAction(plan.actions[i], i);
            errors.push(...actionErrors);
        }
    }

    // Risk level validation
    const validRiskLevels: RiskLevel[] = ["low", "medium", "high"];
    if (!validRiskLevels.includes(plan.risk_level)) {
        errors.push(`Invalid risk_level: ${plan.risk_level}`);
    }

    // Warn on high risk
    if (plan.risk_level === "high") {
        warnings.push("Plan has HIGH risk level - requires explicit user approval");
    }

    // Warn on many actions
    if (plan.actions && plan.actions.length > 10) {
        warnings.push(`Plan has ${plan.actions.length} actions - consider breaking into smaller plans`);
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

// ============================================================================
// ACTION VALIDATION
// ============================================================================

/** Allowed action types (from execution-gate.ts) */
const ALLOWED_ACTION_TYPES = new Set([
    "code_edit",
    "file_create",
    "file_delete",
    "file_write",
    "file_modify",
    "test_run",
    "lint_run",
    "build_run",
    "shell_exec"
]);

/** Forbidden paths */
const FORBIDDEN_PATHS = [
    "/etc",
    "/usr",
    "C:\\Windows",
    ".env",
    "credentials",
    "secrets",
    ".git",
    "node_modules",
    ".ssh",
    "package-lock.json",
    "pnpm-lock.yaml"
];

/** Forbidden code patterns */
const FORBIDDEN_PATTERNS = [
    "fetch(",
    "http.request",
    "axios",
    "exec(",
    "spawn(",
    "child_process",
    "../",
    "eval(",
    "new Function("
];

/**
 * Validate a single action
 */
function validateAction(action: Action, index: number): string[] {
    const errors: string[] = [];
    const prefix = `actions[${index}]`;

    // Validate action type
    if (!ALLOWED_ACTION_TYPES.has(action.type)) {
        errors.push(`${prefix}: Invalid action type '${action.type}'`);
    }

    // Validate target path
    if (action.target) {
        for (const forbidden of FORBIDDEN_PATHS) {
            if (action.target.includes(forbidden)) {
                errors.push(`${prefix}: POLICY_VIOLATION: Target contains forbidden path '${forbidden}'`);
            }
        }
    }

    // Check parameters for forbidden patterns
    const paramsStr = JSON.stringify(action.parameters || {});
    for (const pattern of FORBIDDEN_PATTERNS) {
        if (paramsStr.includes(pattern)) {
            errors.push(`${prefix}: POLICY_VIOLATION: Parameters contain forbidden pattern '${pattern}'`);
        }
    }

    return errors;
}

// ============================================================================
// AGGREGATE VALIDATION
// ============================================================================

/**
 * Full validation of EvidencePack and PlanDraft together
 */
export function validateEvidenceAndPlan(
    evidence: EvidencePack,
    plan: PlanDraft
): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate individual documents
    const epResult = validateEvidencePack(evidence);
    const planResult = validatePlanDraft(plan);

    errors.push(...epResult.errors);
    errors.push(...planResult.errors);
    warnings.push(...epResult.warnings);
    warnings.push(...planResult.warnings);

    // Cross-document validation
    if (plan.based_on_evidence !== evidence.evidence_id) {
        errors.push(`Plan references evidence '${plan.based_on_evidence}' but evidence ID is '${evidence.evidence_id}'`);
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}
