/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Execution Gate - Execution Engine Policy
 * =========================================
 *
 * POLICY: byon-executor is the ONLY execution engine
 *
 * This gate ensures that:
 * - All code execution happens through byon-executor
 * - All file operations happen through byon-executor
 * - All test/lint/build runs happen through byon-executor
 * - No other component can bypass the air-gapped executor
 *
 * Violations result in immediate rejection with POLICY_VIOLATION error.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * The single allowed execution engine identifier
 */
export const EXEC_ENGINE = "byon-executor" as const;

/**
 * Action types that require execution engine enforcement
 */
export const EXEC_ACTIONS = new Set([
    "code_edit",
    "file_create",
    "file_delete",
    "file_write",
    "file_modify",
    "test_run",
    "lint_run",
    "build_run",
    "shell_exec"
] as const);

export type ExecActionType = typeof EXEC_ACTIONS extends Set<infer T> ? T : never;

/**
 * Actions that are explicitly NOT execution (safe for other components)
 */
export const NON_EXEC_ACTIONS = new Set([
    "memory_store",
    "memory_search",
    "evidence_create",
    "plan_create",
    "approval_request",
    "receipt_read",
    "audit_log"
] as const);

// ============================================================================
// POLICY ENFORCEMENT
// ============================================================================

export interface ExecutionRequest {
    engine: string;
    action_type: string;
    action_id?: string;
    target?: string;
}

export interface ExecutionGateResult {
    allowed: boolean;
    engine: string;
    action_type: string;
    requires_execution: boolean;
    violation?: string;
}

/**
 * Check if an action type requires execution engine enforcement
 */
export function requiresExecutionEngine(actionType: string): boolean {
    return EXEC_ACTIONS.has(actionType.toLowerCase() as ExecActionType);
}

/**
 * Enforce that execution happens through byon-executor only
 *
 * @throws Error if engine is not byon-executor for execution actions
 */
export function enforceExecutionEngine(engine: string, actionType: string): void {
    const normalizedAction = actionType.toLowerCase();

    // Only enforce for execution actions
    if (!EXEC_ACTIONS.has(normalizedAction as ExecActionType)) {
        return; // Non-execution action, no enforcement needed
    }

    if (engine.toLowerCase() !== EXEC_ENGINE) {
        throw new Error(
            `POLICY_VIOLATION: Execution must use ${EXEC_ENGINE} only. ` +
            `Action="${actionType}" attempted with engine="${engine}". ` +
            `All file operations and code execution must go through the air-gapped executor.`
        );
    }
}

/**
 * Validate execution request without throwing
 */
export function validateExecutionRequest(request: ExecutionRequest): ExecutionGateResult {
    const normalizedAction = request.action_type.toLowerCase();
    const normalizedEngine = request.engine.toLowerCase();
    const requiresExec = EXEC_ACTIONS.has(normalizedAction as ExecActionType);

    // Non-execution action - always allowed
    if (!requiresExec) {
        return {
            allowed: true,
            engine: request.engine,
            action_type: request.action_type,
            requires_execution: false
        };
    }

    // Execution action - must use byon-executor
    if (normalizedEngine !== EXEC_ENGINE) {
        return {
            allowed: false,
            engine: request.engine,
            action_type: request.action_type,
            requires_execution: true,
            violation: `Action "${request.action_type}" requires ${EXEC_ENGINE}, but "${request.engine}" was specified.`
        };
    }

    return {
        allowed: true,
        engine: request.engine,
        action_type: request.action_type,
        requires_execution: true
    };
}

/**
 * Batch validate multiple execution requests
 */
export function validateExecutionBatch(
    requests: ExecutionRequest[]
): {
    allAllowed: boolean;
    results: ExecutionGateResult[];
    violations: ExecutionGateResult[];
} {
    const results = requests.map(validateExecutionRequest);
    const violations = results.filter(r => !r.allowed);

    return {
        allAllowed: violations.length === 0,
        results,
        violations
    };
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Create a middleware function that enforces execution gate
 * For use in action processing pipelines
 */
export function createExecutionGateMiddleware() {
    return function executionGate<T extends { engine?: string; action_type?: string; type?: string }>(
        action: T
    ): T {
        const engine = action.engine || "unknown";
        const actionType = action.action_type || action.type || "unknown";

        enforceExecutionEngine(engine, actionType);

        return action;
    };
}

/**
 * Wrap an action processor to enforce execution gate
 */
export function withExecutionGate<TIn, TOut>(
    processor: (action: TIn & ExecutionRequest) => TOut
): (action: TIn & ExecutionRequest) => TOut {
    return (action: TIn & ExecutionRequest): TOut => {
        enforceExecutionEngine(action.engine, action.action_type);
        return processor(action);
    };
}

// ============================================================================
// ACTION CLASSIFICATION
// ============================================================================

/**
 * Classify an action type
 */
export function classifyAction(actionType: string): {
    category: "execution" | "memory" | "protocol" | "unknown";
    requires_executor: boolean;
    air_gapped: boolean;
} {
    const normalized = actionType.toLowerCase();

    if (EXEC_ACTIONS.has(normalized as ExecActionType)) {
        return {
            category: "execution",
            requires_executor: true,
            air_gapped: true
        };
    }

    if (NON_EXEC_ACTIONS.has(normalized as any)) {
        return {
            category: normalized.startsWith("memory_") ? "memory" : "protocol",
            requires_executor: false,
            air_gapped: false
        };
    }

    return {
        category: "unknown",
        requires_executor: false,
        air_gapped: false
    };
}

// ============================================================================
// AUDIT HELPERS
// ============================================================================

/**
 * Log execution gate check for audit trail
 */
export function auditExecutionCheck(request: ExecutionRequest): {
    timestamp: string;
    check: "EXECUTION_GATE";
    request: ExecutionRequest;
    result: "PASS" | "FAIL" | "SKIP";
    details: string;
} {
    const classification = classifyAction(request.action_type);

    if (!classification.requires_executor) {
        return {
            timestamp: new Date().toISOString(),
            check: "EXECUTION_GATE",
            request,
            result: "SKIP",
            details: `Action "${request.action_type}" does not require executor (category: ${classification.category})`
        };
    }

    const result = validateExecutionRequest(request);

    return {
        timestamp: new Date().toISOString(),
        check: "EXECUTION_GATE",
        request,
        result: result.allowed ? "PASS" : "FAIL",
        details: result.allowed
            ? `Allowed: ${request.engine} executing ${request.action_type}`
            : result.violation || "Unknown violation"
    };
}

// ============================================================================
// CONSTANTS EXPORT FOR VALIDATORS
// ============================================================================

/**
 * Get all execution action types as array (for schema validation)
 */
export function getExecutionActionTypes(): string[] {
    return Array.from(EXEC_ACTIONS);
}

/**
 * Get the expected engine name (for plan validation)
 */
export function getExpectedEngine(): string {
    return EXEC_ENGINE;
}
