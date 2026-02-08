/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * PlanDraft Builder
 * =================
 *
 * Builder pentru PlanDraft - proposed plan of actions.
 *
 * Flow:
 * 1. Worker creates PlanDraft based on EvidencePack
 * 2. Worker adds actions with risk assessment
 * 3. Worker attaches memory context
 * 4. Auditor validates before approval
 */

import crypto from "crypto";
import {
    PlanDraft,
    Action,
    RiskLevel,
    MemoryContext,
    EvidencePack
} from "../types/protocol.js";

// ============================================================================
// BUILDER
// ============================================================================

export class PlanDraftBuilder {
    private plan: Partial<PlanDraft> = {
        document_type: "PLAN_DRAFT",
        document_version: "1.0",
        actions: [],
        rollback_possible: true,
        estimated_iterations: 1
    };

    /**
     * Set plan ID
     */
    withId(id: string): this {
        this.plan.plan_id = id;
        return this;
    }

    /**
     * Generate random plan ID
     */
    withRandomId(): this {
        this.plan.plan_id = crypto.randomUUID();
        return this;
    }

    /**
     * Set the evidence this plan is based on
     */
    basedOnEvidence(evidenceId: string): this {
        this.plan.based_on_evidence = evidenceId;
        return this;
    }

    /**
     * Set intent description
     */
    withIntent(intent: string): this {
        this.plan.intent = intent;
        return this;
    }

    /**
     * Add single action
     */
    addAction(action: Action): this {
        this.plan.actions!.push(action);
        this.updateRiskLevel();
        this.updateRollbackPossible();
        return this;
    }

    /**
     * Add multiple actions
     */
    addActions(actions: Action[]): this {
        this.plan.actions!.push(...actions);
        this.updateRiskLevel();
        this.updateRollbackPossible();
        return this;
    }

    /**
     * Set risk level manually
     */
    withRiskLevel(level: RiskLevel): this {
        this.plan.risk_level = level;
        return this;
    }

    /**
     * Set rollback possible flag
     */
    withRollbackPossible(possible: boolean): this {
        this.plan.rollback_possible = possible;
        return this;
    }

    /**
     * Set estimated iterations
     */
    withEstimatedIterations(iterations: number): this {
        this.plan.estimated_iterations = iterations;
        return this;
    }

    /**
     * Set memory context
     */
    withMemoryContext(context: MemoryContext): this {
        this.plan.memory_context = context;
        return this;
    }

    /**
     * Set memory context from IDs
     */
    withMemoryContextFromIds(
        conversationCtxId: number | null,
        codeCtxIds: number[],
        factCtxIds: number[],
        similarCtxIds: number[] = []
    ): this {
        this.plan.memory_context = {
            conversation_ctx_id: conversationCtxId,
            relevant_code_ctx_ids: codeCtxIds,
            relevant_fact_ctx_ids: factCtxIds,
            similar_past_ctx_ids: similarCtxIds
        };
        return this;
    }

    /**
     * Build the PlanDraft
     */
    build(): PlanDraft {
        // Validate required fields
        if (!this.plan.plan_id) {
            this.withRandomId();
        }

        if (!this.plan.based_on_evidence) {
            throw new Error("based_on_evidence is required");
        }

        if (!this.plan.intent) {
            throw new Error("intent is required");
        }

        if (!this.plan.actions || this.plan.actions.length === 0) {
            throw new Error("At least one action is required");
        }

        // Set default memory context if not provided
        if (!this.plan.memory_context) {
            this.plan.memory_context = {
                conversation_ctx_id: null,
                relevant_code_ctx_ids: [],
                relevant_fact_ctx_ids: [],
                similar_past_ctx_ids: []
            };
        }

        // Update risk level if not set
        if (!this.plan.risk_level) {
            this.updateRiskLevel();
        }

        // Set timestamp
        this.plan.timestamp = new Date().toISOString();

        // Calculate hash
        this.plan.hash = this.calculateHash();

        return this.plan as PlanDraft;
    }

    /**
     * Update risk level based on actions
     */
    private updateRiskLevel(): void {
        if (!this.plan.actions || this.plan.actions.length === 0) {
            this.plan.risk_level = "low";
            return;
        }

        // Highest risk wins
        const riskPriority: Record<RiskLevel, number> = {
            low: 0,
            medium: 1,
            high: 2
        };

        let maxRisk: RiskLevel = "low";
        for (const action of this.plan.actions) {
            if (riskPriority[action.estimated_risk] > riskPriority[maxRisk]) {
                maxRisk = action.estimated_risk;
            }
        }

        this.plan.risk_level = maxRisk;
    }

    /**
     * Update rollback possible based on actions
     */
    private updateRollbackPossible(): void {
        if (!this.plan.actions || this.plan.actions.length === 0) {
            this.plan.rollback_possible = true;
            return;
        }

        // If any action cannot be rolled back, plan cannot be rolled back
        this.plan.rollback_possible = this.plan.actions.every(
            action => action.rollback_possible
        );
    }

    /**
     * Calculate SHA256 hash
     */
    private calculateHash(): string {
        const content = JSON.stringify({
            plan_id: this.plan.plan_id,
            timestamp: this.plan.timestamp,
            based_on_evidence: this.plan.based_on_evidence,
            intent: this.plan.intent,
            actions: this.plan.actions,
            risk_level: this.plan.risk_level,
            rollback_possible: this.plan.rollback_possible,
            estimated_iterations: this.plan.estimated_iterations,
            memory_context: this.plan.memory_context
        });

        return crypto.createHash("sha256").update(content).digest("hex");
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create empty PlanDraft builder
 */
export function createPlanDraftBuilder(): PlanDraftBuilder {
    return new PlanDraftBuilder();
}

/**
 * Create PlanDraft builder from EvidencePack
 */
export function createPlanDraftFromEvidence(evidence: EvidencePack): PlanDraftBuilder {
    return new PlanDraftBuilder()
        .withRandomId()
        .basedOnEvidence(evidence.evidence_id)
        .withMemoryContext(evidence.memory_context);
}

/**
 * Create action helper
 */
export function createAction(
    type: Action["type"],
    target: string,
    parameters: Record<string, unknown> = {},
    options: {
        risk?: RiskLevel;
        rollbackPossible?: boolean;
    } = {}
): Action {
    return {
        action_id: `action_${crypto.randomUUID().substring(0, 8)}`,
        type,
        target,
        parameters,
        estimated_risk: options.risk || "low",
        rollback_possible: options.rollbackPossible ?? true
    };
}

/**
 * Validate PlanDraft structure
 */
export function validatePlanDraft(plan: PlanDraft): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    // Check required fields
    if (!plan.plan_id) {errors.push("Missing plan_id");}
    if (!plan.timestamp) {errors.push("Missing timestamp");}
    if (!plan.based_on_evidence) {errors.push("Missing based_on_evidence");}
    if (!plan.intent) {errors.push("Missing intent");}
    if (!plan.hash) {errors.push("Missing hash");}

    // Validate document type
    if (plan.document_type !== "PLAN_DRAFT") {
        errors.push("Invalid document_type");
    }

    // Validate actions
    if (!Array.isArray(plan.actions) || plan.actions.length === 0) {
        errors.push("actions must be non-empty array");
    }

    // Validate each action
    if (plan.actions) {
        for (let i = 0; i < plan.actions.length; i++) {
            const action = plan.actions[i];
            if (!action.action_id) {errors.push(`Action ${i}: missing action_id`);}
            if (!action.type) {errors.push(`Action ${i}: missing type`);}
            if (!action.target) {errors.push(`Action ${i}: missing target`);}
        }
    }

    // Recalculate and verify hash
    const content = JSON.stringify({
        plan_id: plan.plan_id,
        timestamp: plan.timestamp,
        based_on_evidence: plan.based_on_evidence,
        intent: plan.intent,
        actions: plan.actions,
        risk_level: plan.risk_level,
        rollback_possible: plan.rollback_possible,
        estimated_iterations: plan.estimated_iterations,
        memory_context: plan.memory_context
    });
    const expectedHash = crypto.createHash("sha256").update(content).digest("hex");
    if (plan.hash !== expectedHash) {
        errors.push("Hash mismatch - plan may have been tampered");
    }

    return {
        valid: errors.length === 0,
        errors
    };
}
