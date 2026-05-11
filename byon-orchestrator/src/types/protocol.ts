/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * MACP Protocol Types - Multi-Agent Control Protocol v1.1
 * ========================================================
 *
 * Type definitions pentru documentele de protocol BYON:
 * - EvidencePack
 * - PlanDraft
 * - ApprovalRequest
 * - ExecutionOrder
 * - JohnsonReceipt
 *
 * Fiecare document are:
 * - document_type discriminator
 * - UUID identifier
 * - ISO8601 timestamp
 * - SHA256 hash pentru integritate
 */

// ============================================================================
// COMMON TYPES
// ============================================================================

/** Task type classification */
export type TaskType = "coding" | "scheduling" | "messaging" | "general";

/** Risk level classification */
export type RiskLevel = "low" | "medium" | "high";

/** Execution status */
export type ExecutionStatus = "success" | "partial" | "failed" | "rejected";

/** Document state in audit trail */
export type DocumentState = "draft" | "pending" | "approved" | "executed" | "failed";

// ============================================================================
// SOURCE TYPES
// ============================================================================

/** Source of information for evidence */
export interface Source {
    type: "message" | "file" | "memory" | "user_input" | "system";
    identifier: string;
    timestamp: string;
    content_hash?: string;
}

/** Extracted fact from sources */
export interface ExtractedFact {
    fact_id?: string;
    content: string;
    confidence: number;
    source_refs?: string[];
    tags?: string[];
    /** Type of fact */
    fact_type?: "preference" | "entity" | "relationship" | "procedure" | "general" | "code_entity" | string;
    /** Source quote for reference */
    source_quote?: string;
    /** Allow additional properties */
    [key: string]: unknown;
}

/** Raw quote from sources */
export interface RawQuote {
    quote_id: string;
    text: string;
    source_ref: string;
    start_offset?: number;
    end_offset?: number;
}

// ============================================================================
// CODEBASE CONTEXT
// ============================================================================

/** Codebase context for evidence */
export interface CodebaseContext {
    files_analyzed: string[];
    functions_referenced: Array<{
        file: string;
        function_name: string;
        line_start: number;
        line_end: number;
    }>;
    dependencies_identified: string[];
    patterns_detected: string[];
}

// ============================================================================
// MEMORY CONTEXT
// ============================================================================

/** Memory context IDs from FHRSS+FCPE */
export interface MemoryContext {
    conversation_ctx_id: number | null;
    relevant_code_ctx_ids: number[];
    relevant_fact_ctx_ids: number[];
    similar_past_ctx_ids: number[];
}

// ============================================================================
// GMV HINT (Global Memory Vitalizer)
// ============================================================================

/**
 * GlobalMemoryHint - metadata-only reference from GMV
 *
 * CONSTRAINTS:
 * - NO text content (only IDs and discriminators)
 * - NO labels or descriptions
 * - Auditor MUST validate this is metadata-only
 */
export interface GlobalMemoryHint {
    /** Document type discriminator */
    summary_ref: "GLOBAL_MEMORY_SUMMARY";

    /** Timestamp of the summary */
    timestamp: string;

    /** Active attractor IDs only (no labels) */
    active_attractor_ids: string[];

    /** System entropy level */
    entropy_level: "stable" | "rising" | "fragmented";

    /** System coherence score [0,1] */
    system_coherence?: number;
}

// ============================================================================
// EVIDENCE PACK
// ============================================================================

/**
 * EvidencePack - gathered evidence for decision making
 *
 * Created by: Worker
 * Consumed by: Auditor, PlanDraft generator
 */
export interface EvidencePack {
    document_type: "EVIDENCE_PACK";
    document_version: "1.0";

    /** Unique identifier */
    evidence_id: string;

    /** Creation timestamp ISO8601 */
    timestamp: string;

    /** Type of task this evidence supports */
    task_type: TaskType;

    /** Sources used to gather evidence */
    sources: Source[];

    /** Extracted facts */
    extracted_facts: ExtractedFact[];

    /** Raw quotes preserved */
    raw_quotes: RawQuote[];

    /** Codebase analysis context */
    codebase_context: CodebaseContext;

    /** Memory context IDs from FHRSS+FCPE */
    memory_context: MemoryContext;

    /** GMV hint - metadata only (optional) */
    global_memory_hint?: GlobalMemoryHint;

    /**
     * FCE-M morphogenetic context (optional).
     *
     * CONSTRAINTS:
     * - Metadata-only — Auditor rejects raw text from this field.
     * - Advisory by design: NEVER overrides Auditor truth/security verdicts.
     * - Absent when FCE-M backend is disabled or unavailable.
     */
    fce_context?: FceContextMetadata;

    /** Flag if forbidden data was detected */
    forbidden_data_present: boolean;

    /** SHA256 hash of content */
    hash: string;
}

/**
 * Metadata-only FCE-M context bundled into EvidencePack.
 *
 * IMPORTANT (matches misiunea.txt Etapa 5):
 * - Worker attaches this when FCE-M backend is enabled and responds in time.
 * - Auditor uses it as a RISK FACTOR only — never as a verdict.
 * - All center identifiers are hashed (no labels / no raw content).
 */
export interface FceContextMetadata {
    /** Whether the underlying FCE-M backend reports as enabled. */
    enabled: boolean;

    /** Optional query string the report was built against. */
    query?: string;

    /** Coagulated centers — counts only. */
    omega_active: number;
    omega_contested: number;
    omega_inexpressed: number;
    omega_total: number;

    /** Reference field count. */
    reference_fields_count: number;

    /** Hashed center identifiers, capped to small arrays for safety. */
    aligned_reference_fields: string[];
    contested_expressions: string[];
    high_residue_centers: string[];

    /** Summary statistics. */
    advisory_count: number;
    priority_recommendations_count: number;
    relation_candidates_count: number;

    /** Hashed center identifiers currently considered risk-amplifying. */
    risk_centers: string[];

    /** Compact human-readable summary (debug/log only — no semantic content). */
    morphogenesis_summary: string;
}

// ============================================================================
// ACTION TYPES
// ============================================================================

/** Action type for execution */
export type ActionType =
    | "code_edit"
    | "file_create"
    | "file_delete"
    | "file_write"
    | "file_modify"
    | "test_run"
    | "lint_run"
    | "build_run"
    | "shell_exec";

/** Single action to execute */
export interface Action {
    action_id: string;
    type: ActionType;
    target: string;
    parameters: Record<string, unknown>;
    estimated_risk: RiskLevel;
    rollback_possible: boolean;
    /** Human-readable description */
    description?: string;
}

// ============================================================================
// PLAN DRAFT
// ============================================================================

/**
 * PlanDraft - proposed plan of actions
 *
 * Created by: Worker
 * Validated by: Auditor
 */
export interface PlanDraft {
    document_type: "PLAN_DRAFT";
    document_version: "1.0";

    /** Unique identifier */
    plan_id: string;

    /** Creation timestamp ISO8601 */
    timestamp: string;

    /** Evidence this plan is based on */
    based_on_evidence: string;

    /** Intent description */
    intent: string;

    /** Actions to execute */
    actions: Action[];

    /** Overall risk level */
    risk_level: RiskLevel;

    /** Whether rollback is possible */
    rollback_possible: boolean;

    /** Estimated iterations needed */
    estimated_iterations: number;

    /** Memory context */
    memory_context: MemoryContext;

    /** SHA256 hash of content */
    hash: string;
}

// ============================================================================
// APPROVAL REQUEST
// ============================================================================

/** Security check result */
export interface SecurityCheck {
    check_type: string;
    passed: boolean;
    details?: string;
    /** Additional check properties */
    path_traversal_safe?: boolean;
    no_forbidden_patterns?: boolean;
    risk_acceptable?: boolean;
    /** Allow additional properties */
    [key: string]: unknown;
}

/** User option for approval - can be object or string */
export type UserOption = {
    option_id: string;
    label: string;
    action: "approve" | "reject" | "modify";
} | string;

/**
 * ApprovalRequest - request for user approval
 *
 * Created by: Auditor
 * Consumed by: User (via UI or CLI)
 */
export interface ApprovalRequest {
    document_type?: "APPROVAL_REQUEST";
    document_version?: "1.0";

    /** Unique identifier */
    request_id: string;

    /** Creation timestamp ISO8601 */
    timestamp: string;

    /** Plan this request is for */
    based_on_plan?: string;

    /** Human-readable summary */
    summary: string;

    /** Overall risk level of the request */
    risk_level?: RiskLevel;

    /** Preview of actions - can be detailed objects or simple strings */
    actions_preview: Array<{
        action_id: string;
        type: ActionType;
        target: string;
        risk: RiskLevel;
    } | string>;

    /** Security check results */
    security_checks: SecurityCheck[];

    /** Whether approval is required (auto-approve for low risk?) */
    requires_approval: boolean;

    /** Expiration timestamp */
    expires_at: string;

    /** Available user options */
    user_options: UserOption[];

    /** SHA256 hash of content */
    hash: string;
}

// ============================================================================
// EXECUTION ORDER
// ============================================================================

/**
 * ExecutionOrder - signed order for executor
 *
 * Created by: Auditor (after approval)
 * Consumed by: Executor (air-gapped)
 * Signed with: Ed25519
 */
export interface ExecutionOrder {
    document_type?: "EXECUTION_ORDER";
    document_version?: "1.0";

    /** Unique identifier */
    order_id: string;

    /** Creation timestamp ISO8601 */
    timestamp: string;

    /** Plan this order executes */
    based_on_plan: string;

    /** Who approved (user ID or "auto") */
    approved_by: string;

    /** Approval timestamp */
    approved_at: string;

    /** Actions to execute (copied from plan) */
    actions: Action[];

    /** Execution constraints */
    constraints: {
        max_iterations: number;
        timeout_minutes?: number;
        timeout_seconds?: number;
        memory_limit_mb?: number;
        disk_limit_mb?: number;
        allowed_paths?: string[];
        forbidden_operations?: string[];
        [key: string]: unknown;
    };

    /** Rollback instructions */
    rollback: {
        enabled: boolean;
        instructions?: string;
        checkpoint_id?: string;
    };

    /** Ed25519 signature (base64) */
    signature: string;

    /** SHA256 hash of content (excluding signature) */
    hash: string;
}

// ============================================================================
// JOHNSON RECEIPT
// ============================================================================

/** Result of a single action */
export interface ActionResult {
    action_id: string;
    status?: "success" | "failed" | "skipped";
    /** Action type (for compatibility) */
    action_type?: ActionType;
    /** Success flag (alias for status === "success") */
    success?: boolean;
    output?: string;
    error?: string;
    duration_ms?: number;
    /** Allow additional properties */
    [key: string]: unknown;
}

/** Execution error details */
export interface ExecutionError {
    action_id: string;
    error_type: string;
    message: string;
    stack?: string;
    recoverable: boolean;
}

/**
 * JohnsonReceipt - execution result receipt
 *
 * Created by: Executor (air-gapped)
 * Consumed by: Worker, Audit trail
 */
export interface JohnsonReceipt {
    document_type?: "JOHNSON_RECEIPT";
    document_version?: "1.0";

    /** Unique identifier */
    receipt_id: string;

    /** Creation timestamp ISO8601 */
    timestamp: string;

    /** Order this receipt is for */
    based_on_order: string;

    /** Execution summary */
    execution_summary: {
        status: ExecutionStatus;
        actions_total: number;
        actions_completed: number;
        actions_failed: number;
        iterations_used: number;
        duration_ms: number;
    };

    /** Individual action results */
    action_results: ActionResult[];

    /** Errors encountered */
    errors: ExecutionError[];

    /** Changes made to filesystem */
    changes_made: {
        files_modified: string[];
        files_created: string[];
        files_deleted: string[];
    };

    /** Verification results */
    verification: {
        tests_passing: boolean | null;
        lint_passing: boolean | null;
        build_passing: boolean | null;
    };

    /** SHA256 hash of content */
    hash: string;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isEvidencePack(doc: unknown): doc is EvidencePack {
    return (
        typeof doc === "object" &&
        doc !== null &&
        (doc as EvidencePack).document_type === "EVIDENCE_PACK"
    );
}

export function isPlanDraft(doc: unknown): doc is PlanDraft {
    return (
        typeof doc === "object" &&
        doc !== null &&
        (doc as PlanDraft).document_type === "PLAN_DRAFT"
    );
}

export function isApprovalRequest(doc: unknown): doc is ApprovalRequest {
    return (
        typeof doc === "object" &&
        doc !== null &&
        (doc as ApprovalRequest).document_type === "APPROVAL_REQUEST"
    );
}

export function isExecutionOrder(doc: unknown): doc is ExecutionOrder {
    return (
        typeof doc === "object" &&
        doc !== null &&
        (doc as ExecutionOrder).document_type === "EXECUTION_ORDER"
    );
}

export function isJohnsonReceipt(doc: unknown): doc is JohnsonReceipt {
    return (
        typeof doc === "object" &&
        doc !== null &&
        (doc as JohnsonReceipt).document_type === "JOHNSON_RECEIPT"
    );
}
