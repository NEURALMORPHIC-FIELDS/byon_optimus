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
    FceContextMetadata,
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
// FCE-M CONTEXT GATE
// ============================================================================

/**
 * Validate FCE-M context is metadata-only.
 *
 * POLICY (matches misiunea.txt Etapa 6):
 * - FCE-M context can contain ONLY counts and hashed center identifiers.
 * - NO text labels, NO content, NO descriptions.
 * - FCE-M never authorizes execution; it can only inform risk.
 *
 * FORBIDDEN: label, description, content, text, name, title fields.
 * FORBIDDEN: arrays with non-string-id entries (objects with text).
 */
export function validateFceContext(
    ctx: FceContextMetadata | undefined
): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!ctx) {
        return { valid: true, errors, warnings };
    }

    if (typeof ctx.enabled !== "boolean") {
        errors.push("POLICY_VIOLATION: fce_context.enabled must be boolean");
    }

    const forbidden = ["label", "description", "content", "text", "name", "title"];
    for (const f of forbidden) {
        if (f in (ctx as unknown as Record<string, unknown>)) {
            errors.push(`POLICY_VIOLATION: fce_context must not contain '${f}' field`);
        }
    }

    const idArrays: Array<{ key: keyof FceContextMetadata; max: number }> = [
        { key: "aligned_reference_fields", max: 8 },
        { key: "contested_expressions", max: 8 },
        { key: "high_residue_centers", max: 8 },
        { key: "risk_centers", max: 16 }
    ];
    for (const { key, max } of idArrays) {
        const arr = (ctx as unknown as Record<string, unknown>)[key as string];
        if (arr !== undefined) {
            if (!Array.isArray(arr)) {
                errors.push(`POLICY_VIOLATION: fce_context.${String(key)} must be an array`);
                continue;
            }
            if (arr.length > max) {
                warnings.push(
                    `fce_context.${String(key)} has ${arr.length} entries (cap ${max}) — possible leakage`
                );
            }
            for (let i = 0; i < arr.length; i++) {
                const v = arr[i];
                if (typeof v !== "string") {
                    errors.push(
                        `POLICY_VIOLATION: fce_context.${String(key)}[${i}] must be a string id`
                    );
                } else if (v.includes(" ")) {
                    errors.push(
                        `POLICY_VIOLATION: fce_context.${String(key)}[${i}] looks like a label, not a hashed id`
                    );
                }
            }
        }
    }

    const counters: Array<keyof FceContextMetadata> = [
        "omega_active",
        "omega_contested",
        "omega_inexpressed",
        "omega_total",
        "reference_fields_count",
        "advisory_count",
        "priority_recommendations_count",
        "relation_candidates_count"
    ];
    for (const k of counters) {
        const v = (ctx as unknown as Record<string, unknown>)[k as string];
        if (v !== undefined && typeof v !== "number") {
            errors.push(`POLICY_VIOLATION: fce_context.${String(k)} must be a number`);
        }
    }

    if (
        ctx.morphogenesis_summary !== undefined &&
        typeof ctx.morphogenesis_summary === "string" &&
        ctx.morphogenesis_summary.length > 200
    ) {
        warnings.push("fce_context.morphogenesis_summary exceeds 200 chars");
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

    // FCE-M context gate — metadata-only, no labels / content
    const fceValidation = validateFceContext(ep.fce_context);
    errors.push(...fceValidation.errors);
    warnings.push(...fceValidation.warnings);

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

    // FCE-M morphogenetic risk advisory
    const fceWarnings = applyFceRiskAdvisory(evidence, plan);
    warnings.push(...fceWarnings);

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Apply FCE-M morphogenetic signals as risk advisory.
 *
 * Per misiunea.txt Etapa 6:
 * - FCE-M is ADVISORY only — never overrides Auditor verdicts.
 * - high_residue → warning + suggest plan.risk_level escalation.
 * - contested_expressions present → require_review marker.
 * - aligned reference fields → "context stable" note (NO risk reduction).
 *
 * Returns advisory strings appended to warnings. The Auditor consumer
 * may inspect these and decide to require user approval or override risk.
 */
export function applyFceRiskAdvisory(
    evidence: EvidencePack,
    plan: PlanDraft
): string[] {
    const out: string[] = [];
    const fc = evidence.fce_context;
    if (!fc || !fc.enabled) {
        return out;
    }

    if (fc.high_residue_centers && fc.high_residue_centers.length > 0) {
        out.push(
            `FCE_ADVISORY: high_residue on ${fc.high_residue_centers.length} center(s) — consider escalating risk_level`
        );
    }

    if (fc.contested_expressions && fc.contested_expressions.length > 0) {
        if (plan.risk_level === "low") {
            out.push(
                `FCE_ADVISORY: contested_expression detected — risk_level "low" is too lenient, require review`
            );
        } else {
            out.push(
                `FCE_ADVISORY: contested_expression on ${fc.contested_expressions.length} center(s) — require explicit user review`
            );
        }
    }

    if (fc.aligned_reference_fields && fc.aligned_reference_fields.length > 0) {
        out.push(
            `FCE_NOTE: context stable on ${fc.aligned_reference_fields.length} aligned reference field(s) — does NOT bypass approval`
        );
    }

    if (fc.relation_candidates_count && fc.relation_candidates_count > 0) {
        out.push(
            `FCE_ADVISORY: ${fc.relation_candidates_count} relation candidate(s) detected — review for cross-domain side effects`
        );
    }

    return out;
}
