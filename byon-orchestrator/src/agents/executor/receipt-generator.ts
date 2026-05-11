/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Executor Receipt Generator
 * ==========================
 *
 * Generates JohnsonReceipt documents after execution.
 * Receipts are the ONLY way Executor reports results.
 *
 * AIR-GAPPED:
 * - All errors reported via receipt
 * - No network callbacks
 * - Receipt dropped to outbox for Worker pickup
 */

import * as crypto from "crypto";
import {
    ExecutionOrder,
    JohnsonReceipt,
    ActionResult,
    ExecutionError,
    ExecutionStatus
} from "../../types/protocol.js";

// ============================================================================
// TYPES
// ============================================================================

export interface ReceiptGeneratorConfig {
    /** Include full action details */
    include_details: boolean;
    /** Maximum errors to include */
    max_errors: number;
    /** Include file change list */
    track_changes: boolean;
}

export interface ExecutionContext {
    /** Order being executed */
    order: ExecutionOrder;
    /** Start time */
    started_at: Date;
    /** Action results so far */
    results: ActionResult[];
    /** Errors encountered */
    errors: ExecutionError[];
    /** Iterations used */
    iterations: number;
    /** Changes made */
    changes: {
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
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: ReceiptGeneratorConfig = {
    include_details: true,
    max_errors: 50,
    track_changes: true
};

// ============================================================================
// RECEIPT GENERATOR
// ============================================================================

/**
 * Receipt Generator
 *
 * Creates JohnsonReceipt documents from execution results.
 */
export class ReceiptGenerator {
    private config: ReceiptGeneratorConfig;

    constructor(config: Partial<ReceiptGeneratorConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Generate receipt from execution context
     */
    generate(context: ExecutionContext): JohnsonReceipt {
        const receiptId = `receipt_${crypto.randomUUID().replace(/-/g, "")}`;
        const timestamp = new Date().toISOString();

        // Calculate duration
        const durationMs = Date.now() - context.started_at.getTime();

        // Determine status
        const status = this.determineStatus(context);

        // Build execution summary
        const executionSummary = {
            status,
            actions_total: context.order.actions.length,
            actions_completed: context.results.filter(r => r.status === "success").length,
            actions_failed: context.results.filter(r => r.status === "failed").length,
            iterations_used: context.iterations,
            duration_ms: durationMs
        };

        // Limit errors
        const errors = context.errors.slice(0, this.config.max_errors);

        // Build receipt
        const receipt: Omit<JohnsonReceipt, "hash"> = {
            document_type: "JOHNSON_RECEIPT",
            document_version: "1.0",
            receipt_id: receiptId,
            timestamp,
            based_on_order: context.order.order_id,
            execution_summary: executionSummary,
            action_results: context.results,
            errors,
            changes_made: this.config.track_changes ? context.changes : {
                files_modified: [],
                files_created: [],
                files_deleted: []
            },
            verification: context.verification
        };

        // Calculate hash
        const hash = this.calculateHash(receipt);

        return {
            ...receipt,
            hash
        };
    }

    /**
     * Create execution context for an order
     */
    createContext(order: ExecutionOrder): ExecutionContext {
        return {
            order,
            started_at: new Date(),
            results: [],
            errors: [],
            iterations: 0,
            changes: {
                files_modified: [],
                files_created: [],
                files_deleted: []
            },
            verification: {
                tests_passing: null,
                lint_passing: null,
                build_passing: null
            }
        };
    }

    /**
     * Add action result to context
     */
    addResult(context: ExecutionContext, result: ActionResult): void {
        context.results.push(result);

        // Track errors
        if (result.status === "failed" && result.error) {
            const action = context.order.actions.find(a => a.action_id === result.action_id);
            context.errors.push({
                action_id: result.action_id,
                error_type: "execution_error",
                message: result.error,
                recoverable: action?.rollback_possible ?? false
            });
        }
    }

    /**
     * Track file change
     */
    trackChange(
        context: ExecutionContext,
        changeType: "modified" | "created" | "deleted",
        filePath: string
    ): void {
        if (!this.config.track_changes) {return;}

        switch (changeType) {
            case "modified":
                if (!context.changes.files_modified.includes(filePath)) {
                    context.changes.files_modified.push(filePath);
                }
                break;
            case "created":
                if (!context.changes.files_created.includes(filePath)) {
                    context.changes.files_created.push(filePath);
                }
                break;
            case "deleted":
                if (!context.changes.files_deleted.includes(filePath)) {
                    context.changes.files_deleted.push(filePath);
                }
                break;
        }
    }

    /**
     * Set verification result
     */
    setVerification(
        context: ExecutionContext,
        type: "tests" | "lint" | "build",
        passing: boolean
    ): void {
        switch (type) {
            case "tests":
                context.verification.tests_passing = passing;
                break;
            case "lint":
                context.verification.lint_passing = passing;
                break;
            case "build":
                context.verification.build_passing = passing;
                break;
        }
    }

    /**
     * Increment iteration count
     */
    incrementIterations(context: ExecutionContext): void {
        context.iterations++;
    }

    /**
     * Determine execution status
     */
    private determineStatus(context: ExecutionContext): ExecutionStatus {
        const totalActions = context.order.actions.length;
        const completed = context.results.filter(r => r.status === "success").length;
        const failed = context.results.filter(r => r.status === "failed").length;

        // Check if any results at all
        if (context.results.length === 0) {
            return "rejected";
        }

        // All succeeded
        if (completed === totalActions && failed === 0) {
            return "success";
        }

        // All failed
        if (failed === totalActions) {
            return "failed";
        }

        // Mixed results
        if (completed > 0 && failed > 0) {
            return "partial";
        }

        // Some completed, none failed (some skipped)
        if (completed > 0) {
            return "partial";
        }

        return "failed";
    }

    /**
     * Calculate SHA256 hash
     */
    private calculateHash(content: unknown): string {
        const json = JSON.stringify(content, Object.keys(content as object).sort());
        return crypto.createHash("sha256").update(json).digest("hex");
    }

    /**
     * Generate failure receipt (for signature verification failure, etc.)
     */
    generateFailureReceipt(
        orderId: string,
        reason: string
    ): JohnsonReceipt {
        const receiptId = `receipt_${crypto.randomUUID().replace(/-/g, "")}`;
        const timestamp = new Date().toISOString();

        const receipt: Omit<JohnsonReceipt, "hash"> = {
            document_type: "JOHNSON_RECEIPT",
            document_version: "1.0",
            receipt_id: receiptId,
            timestamp,
            based_on_order: orderId,
            execution_summary: {
                status: "rejected",
                actions_total: 0,
                actions_completed: 0,
                actions_failed: 0,
                iterations_used: 0,
                duration_ms: 0
            },
            action_results: [],
            errors: [{
                action_id: "pre_execution",
                error_type: "rejection",
                message: reason,
                recoverable: false
            }],
            changes_made: {
                files_modified: [],
                files_created: [],
                files_deleted: []
            },
            verification: {
                tests_passing: null,
                lint_passing: null,
                build_passing: null
            }
        };

        const hash = this.calculateHash(receipt);

        return {
            ...receipt,
            hash
        };
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create receipt generator
 */
export function createReceiptGenerator(
    config?: Partial<ReceiptGeneratorConfig>
): ReceiptGenerator {
    return new ReceiptGenerator(config);
}
