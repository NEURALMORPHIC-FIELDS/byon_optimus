/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * ExecutionOrder Builder
 * ======================
 *
 * Builder pentru ExecutionOrder - signed order for executor.
 * Uses Ed25519 for cryptographic signing.
 *
 * Flow:
 * 1. User approves ApprovalRequest
 * 2. Auditor creates ExecutionOrder
 * 3. Auditor signs with Ed25519
 * 4. Executor verifies signature before execution
 *
 * CRITICAL: Executor is air-gapped and MUST verify signature.
 */

import crypto from "crypto";
import {
    ExecutionOrder,
    PlanDraft,
    Action
} from "../types/protocol.js";
import { Ed25519Signer, createEd25519Signer } from "./crypto/ed25519-signer.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface ExecutionConstraints {
    /** Maximum iterations before abort */
    max_iterations: number;
    /** Timeout in minutes */
    timeout_minutes: number;
    /** Memory limit in MB */
    memory_limit_mb: number;
    /** Disk limit in MB */
    disk_limit_mb: number;
}

export interface RollbackConfig {
    /** Whether rollback is enabled */
    enabled: boolean;
    /** Rollback instructions */
    instructions?: string;
}

const DEFAULT_CONSTRAINTS: ExecutionConstraints = {
    max_iterations: 10,
    timeout_minutes: 30,
    memory_limit_mb: 512,
    disk_limit_mb: 1024
};

// ============================================================================
// BUILDER
// ============================================================================

export class ExecutionOrderBuilder {
    private order: Partial<ExecutionOrder> = {
        document_type: "EXECUTION_ORDER",
        document_version: "1.0",
        actions: [],
        constraints: { ...DEFAULT_CONSTRAINTS },
        rollback: {
            enabled: true
        }
    };

    private signer: Ed25519Signer | null = null;

    /**
     * Set signer for Ed25519 signatures
     */
    withSigner(signer: Ed25519Signer): this {
        this.signer = signer;
        return this;
    }

    /**
     * Set order ID
     */
    withId(id: string): this {
        this.order.order_id = id;
        return this;
    }

    /**
     * Generate random order ID
     */
    withRandomId(): this {
        this.order.order_id = crypto.randomUUID();
        return this;
    }

    /**
     * Set the plan this order executes
     */
    basedOnPlan(planId: string): this {
        this.order.based_on_plan = planId;
        return this;
    }

    /**
     * Set approval information
     */
    approvedBy(userId: string, approvedAt?: string): this {
        this.order.approved_by = userId;
        this.order.approved_at = approvedAt || new Date().toISOString();
        return this;
    }

    /**
     * Set as auto-approved
     */
    autoApproved(): this {
        this.order.approved_by = "auto";
        this.order.approved_at = new Date().toISOString();
        return this;
    }

    /**
     * Add single action
     */
    addAction(action: Action): this {
        this.order.actions!.push(action);
        return this;
    }

    /**
     * Add multiple actions
     */
    addActions(actions: Action[]): this {
        this.order.actions!.push(...actions);
        return this;
    }

    /**
     * Set execution constraints
     */
    withConstraints(constraints: Partial<ExecutionConstraints>): this {
        this.order.constraints = {
            ...DEFAULT_CONSTRAINTS,
            ...constraints
        };
        return this;
    }

    /**
     * Set max iterations
     */
    withMaxIterations(iterations: number): this {
        this.order.constraints!.max_iterations = iterations;
        return this;
    }

    /**
     * Set timeout
     */
    withTimeout(minutes: number): this {
        this.order.constraints!.timeout_minutes = minutes;
        return this;
    }

    /**
     * Set memory limit
     */
    withMemoryLimit(mb: number): this {
        this.order.constraints!.memory_limit_mb = mb;
        return this;
    }

    /**
     * Set disk limit
     */
    withDiskLimit(mb: number): this {
        this.order.constraints!.disk_limit_mb = mb;
        return this;
    }

    /**
     * Set rollback configuration
     */
    withRollback(config: RollbackConfig): this {
        this.order.rollback = config;
        return this;
    }

    /**
     * Enable rollback
     */
    enableRollback(instructions?: string): this {
        this.order.rollback = {
            enabled: true,
            instructions
        };
        return this;
    }

    /**
     * Disable rollback
     */
    disableRollback(): this {
        this.order.rollback = {
            enabled: false
        };
        return this;
    }

    /**
     * Build from PlanDraft
     */
    fromPlan(plan: PlanDraft, approvedBy: string): this {
        this.withRandomId();
        this.basedOnPlan(plan.plan_id);
        this.approvedBy(approvedBy);
        this.addActions(plan.actions);

        // Set rollback based on plan
        if (plan.rollback_possible) {
            this.enableRollback();
        } else {
            this.disableRollback();
        }

        // Set iterations based on plan estimate
        this.withMaxIterations(
            Math.max(plan.estimated_iterations * 2, 5)
        );

        return this;
    }

    /**
     * Build the ExecutionOrder
     */
    build(): ExecutionOrder {
        // Validate required fields
        if (!this.order.order_id) {
            this.withRandomId();
        }

        if (!this.order.based_on_plan) {
            throw new Error("based_on_plan is required");
        }

        if (!this.order.approved_by) {
            throw new Error("approved_by is required");
        }

        if (!this.order.approved_at) {
            this.order.approved_at = new Date().toISOString();
        }

        if (!this.order.actions || this.order.actions.length === 0) {
            throw new Error("At least one action is required");
        }

        if (!this.signer) {
            throw new Error("Signer is required for ExecutionOrder");
        }

        // Set timestamp
        this.order.timestamp = new Date().toISOString();

        // Calculate hash (before signature)
        this.order.hash = this.calculateHash();

        // Sign the order
        this.order.signature = this.signOrder();

        return this.order as ExecutionOrder;
    }

    /**
     * Calculate SHA256 hash (excluding signature)
     */
    private calculateHash(): string {
        const content = JSON.stringify({
            order_id: this.order.order_id,
            timestamp: this.order.timestamp,
            based_on_plan: this.order.based_on_plan,
            approved_by: this.order.approved_by,
            approved_at: this.order.approved_at,
            actions: this.order.actions,
            constraints: this.order.constraints,
            rollback: this.order.rollback
        });

        return crypto.createHash("sha256").update(content).digest("hex");
    }

    /**
     * Sign the order with Ed25519
     */
    private signOrder(): string {
        if (!this.signer) {
            throw new Error("Signer not configured");
        }

        const contentToSign = JSON.stringify({
            order_id: this.order.order_id,
            timestamp: this.order.timestamp,
            based_on_plan: this.order.based_on_plan,
            approved_by: this.order.approved_by,
            approved_at: this.order.approved_at,
            actions: this.order.actions,
            constraints: this.order.constraints,
            rollback: this.order.rollback,
            hash: this.order.hash
        });

        return this.signer.sign(contentToSign).signature;
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create empty ExecutionOrder builder
 */
export function createExecutionOrderBuilder(): ExecutionOrderBuilder {
    return new ExecutionOrderBuilder();
}

/**
 * Create ExecutionOrder builder from PlanDraft with approval
 */
export function createExecutionOrderFromApproval(
    plan: PlanDraft,
    approvedBy: string,
    signer: Ed25519Signer
): ExecutionOrderBuilder {
    return new ExecutionOrderBuilder()
        .withSigner(signer)
        .fromPlan(plan, approvedBy);
}

/**
 * Verify ExecutionOrder signature
 */
export function verifyExecutionOrder(
    order: ExecutionOrder,
    publicKeyPem: string
): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    // Validate document type
    if (order.document_type !== "EXECUTION_ORDER") {
        errors.push("Invalid document_type");
    }

    // Verify hash
    const expectedHash = crypto.createHash("sha256").update(JSON.stringify({
        order_id: order.order_id,
        timestamp: order.timestamp,
        based_on_plan: order.based_on_plan,
        approved_by: order.approved_by,
        approved_at: order.approved_at,
        actions: order.actions,
        constraints: order.constraints,
        rollback: order.rollback
    })).digest("hex");

    if (order.hash !== expectedHash) {
        errors.push("Hash mismatch - order may have been tampered");
    }

    // Verify signature
    const signer = createEd25519Signer(undefined, publicKeyPem);
    const contentToVerify = JSON.stringify({
        order_id: order.order_id,
        timestamp: order.timestamp,
        based_on_plan: order.based_on_plan,
        approved_by: order.approved_by,
        approved_at: order.approved_at,
        actions: order.actions,
        constraints: order.constraints,
        rollback: order.rollback,
        hash: order.hash
    });

    const verification = signer.verify(contentToVerify, order.signature);
    if (!verification.valid) {
        errors.push(`Signature verification failed: ${verification.error}`);
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Check if execution order has expired (based on timestamp + timeout)
 */
export function isExecutionOrderExpired(order: ExecutionOrder): boolean {
    const created = new Date(order.timestamp);
    const timeout = (order.constraints.timeout_minutes || 30) * 60 * 1000;
    const expiresAt = new Date(created.getTime() + timeout);

    return new Date() > expiresAt;
}

/**
 * Get remaining time for execution (in minutes)
 */
export function getRemainingExecutionTime(order: ExecutionOrder): number {
    const created = new Date(order.timestamp);
    const timeout = (order.constraints.timeout_minutes || 30) * 60 * 1000;
    const expiresAt = new Date(created.getTime() + timeout);
    const remaining = expiresAt.getTime() - Date.now();

    return Math.max(0, Math.floor(remaining / 60000));
}
