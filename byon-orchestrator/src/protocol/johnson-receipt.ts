/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * JohnsonReceipt Builder
 * ======================
 *
 * Builder pentru JohnsonReceipt - execution result receipt.
 * Created by the air-gapped Executor after completing actions.
 *
 * Flow:
 * 1. Executor receives ExecutionOrder
 * 2. Executor verifies signature
 * 3. Executor executes actions
 * 4. Executor creates JohnsonReceipt
 * 5. Receipt is sent back to Worker
 *
 * NOTE: JohnsonReceipt contains execution results and errors.
 * It does NOT contain network responses (executor is air-gapped).
 */

import crypto from "crypto";
import {
    JohnsonReceipt,
    ExecutionOrder,
    ActionResult,
    ExecutionError,
    ExecutionStatus
} from "../types/protocol.js";

// ============================================================================
// BUILDER
// ============================================================================

export class JohnsonReceiptBuilder {
    private receipt: Partial<JohnsonReceipt> = {
        document_type: "JOHNSON_RECEIPT",
        document_version: "1.0",
        action_results: [],
        errors: [],
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

    private startTime: number = Date.now();

    /**
     * Set receipt ID
     */
    withId(id: string): this {
        this.receipt.receipt_id = id;
        return this;
    }

    /**
     * Generate random receipt ID
     */
    withRandomId(): this {
        this.receipt.receipt_id = crypto.randomUUID();
        return this;
    }

    /**
     * Set the order this receipt is for
     */
    basedOnOrder(orderId: string): this {
        this.receipt.based_on_order = orderId;
        return this;
    }

    /**
     * Add action result
     */
    addActionResult(result: ActionResult): this {
        this.receipt.action_results!.push(result);
        return this;
    }

    /**
     * Add successful action result
     */
    addSuccessfulAction(
        actionId: string,
        durationMs: number,
        output?: string
    ): this {
        this.receipt.action_results!.push({
            action_id: actionId,
            status: "success",
            output,
            duration_ms: durationMs
        });
        return this;
    }

    /**
     * Add failed action result
     */
    addFailedAction(
        actionId: string,
        durationMs: number,
        error: string
    ): this {
        this.receipt.action_results!.push({
            action_id: actionId,
            status: "failed",
            error,
            duration_ms: durationMs
        });
        return this;
    }

    /**
     * Add skipped action result
     */
    addSkippedAction(actionId: string, reason?: string): this {
        this.receipt.action_results!.push({
            action_id: actionId,
            status: "skipped",
            output: reason || "Skipped due to previous failure",
            duration_ms: 0
        });
        return this;
    }

    /**
     * Add execution error
     */
    addError(error: ExecutionError): this {
        this.receipt.errors!.push(error);
        return this;
    }

    /**
     * Add error from exception
     */
    addErrorFromException(
        actionId: string,
        error: Error,
        recoverable: boolean = false
    ): this {
        this.receipt.errors!.push({
            action_id: actionId,
            error_type: error.name || "Error",
            message: error.message,
            stack: error.stack,
            recoverable
        });
        return this;
    }

    /**
     * Add modified file
     */
    addModifiedFile(filePath: string): this {
        if (!this.receipt.changes_made!.files_modified.includes(filePath)) {
            this.receipt.changes_made!.files_modified.push(filePath);
        }
        return this;
    }

    /**
     * Add created file
     */
    addCreatedFile(filePath: string): this {
        if (!this.receipt.changes_made!.files_created.includes(filePath)) {
            this.receipt.changes_made!.files_created.push(filePath);
        }
        return this;
    }

    /**
     * Add deleted file
     */
    addDeletedFile(filePath: string): this {
        if (!this.receipt.changes_made!.files_deleted.includes(filePath)) {
            this.receipt.changes_made!.files_deleted.push(filePath);
        }
        return this;
    }

    /**
     * Set verification results
     */
    withVerification(verification: {
        tests_passing?: boolean | null;
        lint_passing?: boolean | null;
        build_passing?: boolean | null;
    }): this {
        this.receipt.verification = {
            tests_passing: verification.tests_passing ?? null,
            lint_passing: verification.lint_passing ?? null,
            build_passing: verification.build_passing ?? null
        };
        return this;
    }

    /**
     * Set tests passing
     */
    testsPass(passing: boolean): this {
        this.receipt.verification!.tests_passing = passing;
        return this;
    }

    /**
     * Set lint passing
     */
    lintPass(passing: boolean): this {
        this.receipt.verification!.lint_passing = passing;
        return this;
    }

    /**
     * Set build passing
     */
    buildPass(passing: boolean): this {
        this.receipt.verification!.build_passing = passing;
        return this;
    }

    /**
     * Build from ExecutionOrder (prepares receipt)
     */
    fromOrder(order: ExecutionOrder): this {
        this.withRandomId();
        this.basedOnOrder(order.order_id);
        this.startTime = Date.now();
        return this;
    }

    /**
     * Build the JohnsonReceipt
     */
    build(iterationsUsed: number = 1): JohnsonReceipt {
        // Validate required fields
        if (!this.receipt.receipt_id) {
            this.withRandomId();
        }

        if (!this.receipt.based_on_order) {
            throw new Error("based_on_order is required");
        }

        // Calculate execution summary
        const actionResults = this.receipt.action_results!;
        const actionsCompleted = actionResults.filter(r => r.status === "success").length;
        const actionsFailed = actionResults.filter(r => r.status === "failed").length;

        let status: ExecutionStatus;
        if (actionsFailed === 0 && actionsCompleted === actionResults.length) {
            status = "success";
        } else if (actionsCompleted > 0) {
            status = "partial";
        } else if (actionsFailed > 0) {
            status = "failed";
        } else {
            status = "rejected";
        }

        const durationMs = Date.now() - this.startTime;

        this.receipt.execution_summary = {
            status,
            actions_total: actionResults.length,
            actions_completed: actionsCompleted,
            actions_failed: actionsFailed,
            iterations_used: iterationsUsed,
            duration_ms: durationMs
        };

        // Set timestamp
        this.receipt.timestamp = new Date().toISOString();

        // Calculate hash
        this.receipt.hash = this.calculateHash();

        return this.receipt as JohnsonReceipt;
    }

    /**
     * Calculate SHA256 hash
     */
    private calculateHash(): string {
        const content = JSON.stringify({
            receipt_id: this.receipt.receipt_id,
            timestamp: this.receipt.timestamp,
            based_on_order: this.receipt.based_on_order,
            execution_summary: this.receipt.execution_summary,
            action_results: this.receipt.action_results,
            errors: this.receipt.errors,
            changes_made: this.receipt.changes_made,
            verification: this.receipt.verification
        });

        return crypto.createHash("sha256").update(content).digest("hex");
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create empty JohnsonReceipt builder
 */
export function createJohnsonReceiptBuilder(): JohnsonReceiptBuilder {
    return new JohnsonReceiptBuilder();
}

/**
 * Create JohnsonReceipt builder from ExecutionOrder
 */
export function createJohnsonReceiptFromExecution(
    order: ExecutionOrder
): JohnsonReceiptBuilder {
    return new JohnsonReceiptBuilder().fromOrder(order);
}

/**
 * Create quick success receipt
 */
export function createSuccessReceipt(
    orderId: string,
    actionResults: ActionResult[],
    changes: {
        modified?: string[];
        created?: string[];
        deleted?: string[];
    } = {}
): JohnsonReceipt {
    const builder = new JohnsonReceiptBuilder()
        .withRandomId()
        .basedOnOrder(orderId);

    for (const result of actionResults) {
        builder.addActionResult(result);
    }

    for (const file of changes.modified || []) {
        builder.addModifiedFile(file);
    }
    for (const file of changes.created || []) {
        builder.addCreatedFile(file);
    }
    for (const file of changes.deleted || []) {
        builder.addDeletedFile(file);
    }

    return builder.build();
}

/**
 * Create quick failure receipt
 */
export function createFailureReceipt(
    orderId: string,
    error: Error,
    actionId?: string
): JohnsonReceipt {
    const builder = new JohnsonReceiptBuilder()
        .withRandomId()
        .basedOnOrder(orderId);

    if (actionId) {
        builder.addFailedAction(actionId, 0, error.message);
        builder.addErrorFromException(actionId, error);
    } else {
        builder.addError({
            action_id: "unknown",
            error_type: error.name || "Error",
            message: error.message,
            stack: error.stack,
            recoverable: false
        });
    }

    return builder.build();
}

/**
 * Validate JohnsonReceipt structure
 */
export function validateJohnsonReceipt(receipt: JohnsonReceipt): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    // Check required fields
    if (!receipt.receipt_id) errors.push("Missing receipt_id");
    if (!receipt.timestamp) errors.push("Missing timestamp");
    if (!receipt.based_on_order) errors.push("Missing based_on_order");
    if (!receipt.hash) errors.push("Missing hash");

    // Validate document type
    if (receipt.document_type !== "JOHNSON_RECEIPT") {
        errors.push("Invalid document_type");
    }

    // Validate execution summary
    if (!receipt.execution_summary) {
        errors.push("Missing execution_summary");
    } else {
        if (!receipt.execution_summary.status) {
            errors.push("Missing execution_summary.status");
        }
    }

    // Recalculate and verify hash
    const content = JSON.stringify({
        receipt_id: receipt.receipt_id,
        timestamp: receipt.timestamp,
        based_on_order: receipt.based_on_order,
        execution_summary: receipt.execution_summary,
        action_results: receipt.action_results,
        errors: receipt.errors,
        changes_made: receipt.changes_made,
        verification: receipt.verification
    });
    const expectedHash = crypto.createHash("sha256").update(content).digest("hex");
    if (receipt.hash !== expectedHash) {
        errors.push("Hash mismatch - receipt may have been tampered");
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Get receipt summary
 */
export function getReceiptSummary(receipt: JohnsonReceipt): string {
    const { execution_summary, changes_made, verification } = receipt;

    let summary = `Execution ${execution_summary.status}: ` +
        `${execution_summary.actions_completed}/${execution_summary.actions_total} actions completed ` +
        `in ${execution_summary.duration_ms}ms (${execution_summary.iterations_used} iterations). `;

    const totalChanges =
        changes_made.files_modified.length +
        changes_made.files_created.length +
        changes_made.files_deleted.length;

    if (totalChanges > 0) {
        summary += `Changes: ${changes_made.files_modified.length} modified, ` +
            `${changes_made.files_created.length} created, ` +
            `${changes_made.files_deleted.length} deleted. `;
    }

    if (verification.tests_passing !== null) {
        summary += `Tests: ${verification.tests_passing ? "PASS" : "FAIL"}. `;
    }
    if (verification.build_passing !== null) {
        summary += `Build: ${verification.build_passing ? "PASS" : "FAIL"}. `;
    }

    return summary.trim();
}

/**
 * Check if receipt indicates full success
 */
export function isReceiptSuccessful(receipt: JohnsonReceipt): boolean {
    return (
        receipt.execution_summary.status === "success" &&
        receipt.errors.length === 0 &&
        (receipt.verification.tests_passing === null || receipt.verification.tests_passing) &&
        (receipt.verification.build_passing === null || receipt.verification.build_passing)
    );
}
