/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * ApprovalRequest Builder
 * =======================
 *
 * Builder pentru ApprovalRequest - request for user approval.
 *
 * Flow:
 * 1. Auditor validates PlanDraft
 * 2. Auditor runs security checks
 * 3. Auditor creates ApprovalRequest
 * 4. User reviews and approves/rejects/modifies
 */

import crypto from "crypto";
import {
    ApprovalRequest,
    PlanDraft,
    SecurityCheck,
    UserOption,
    ActionType,
    RiskLevel
} from "../types/protocol.js";
import { RiskAssessor, createRiskAssessor } from "./risk-assessor.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface ApprovalRequestConfig {
    /** Default expiration time in minutes */
    defaultExpirationMinutes: number;
    /** Auto-approve low risk plans */
    autoApproveLowRisk: boolean;
    /** Include detailed action preview */
    detailedPreview: boolean;
}

const DEFAULT_CONFIG: ApprovalRequestConfig = {
    defaultExpirationMinutes: 60,
    autoApproveLowRisk: false,
    detailedPreview: true
};

// ============================================================================
// BUILDER
// ============================================================================

export class ApprovalRequestBuilder {
    private request: Partial<ApprovalRequest> = {
        document_type: "APPROVAL_REQUEST",
        document_version: "1.0",
        actions_preview: [],
        security_checks: [],
        user_options: []
    };

    private config: ApprovalRequestConfig;

    constructor(config: Partial<ApprovalRequestConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Set request ID
     */
    withId(id: string): this {
        this.request.request_id = id;
        return this;
    }

    /**
     * Generate random request ID
     */
    withRandomId(): this {
        this.request.request_id = crypto.randomUUID();
        return this;
    }

    /**
     * Set the plan this request is for
     */
    basedOnPlan(planId: string): this {
        this.request.based_on_plan = planId;
        return this;
    }

    /**
     * Set summary
     */
    withSummary(summary: string): this {
        this.request.summary = summary;
        return this;
    }

    /**
     * Add action preview
     */
    addActionPreview(preview: {
        action_id: string;
        type: ActionType;
        target: string;
        risk: RiskLevel;
    }): this {
        this.request.actions_preview!.push(preview);
        return this;
    }

    /**
     * Add multiple action previews
     */
    addActionPreviews(previews: Array<{
        action_id: string;
        type: ActionType;
        target: string;
        risk: RiskLevel;
    }>): this {
        this.request.actions_preview!.push(...previews);
        return this;
    }

    /**
     * Add security check result
     */
    addSecurityCheck(check: SecurityCheck): this {
        this.request.security_checks!.push(check);
        return this;
    }

    /**
     * Add multiple security checks
     */
    addSecurityChecks(checks: SecurityCheck[]): this {
        this.request.security_checks!.push(...checks);
        return this;
    }

    /**
     * Set requires approval flag
     */
    requiresApproval(required: boolean): this {
        this.request.requires_approval = required;
        return this;
    }

    /**
     * Set expiration timestamp
     */
    expiresAt(timestamp: string): this {
        this.request.expires_at = timestamp;
        return this;
    }

    /**
     * Set expiration from now (in minutes)
     */
    expiresInMinutes(minutes: number): this {
        const expiration = new Date(
            Date.now() + minutes * 60 * 1000
        ).toISOString();
        this.request.expires_at = expiration;
        return this;
    }

    /**
     * Add user option
     */
    addUserOption(option: UserOption): this {
        this.request.user_options!.push(option);
        return this;
    }

    /**
     * Add standard user options
     */
    withStandardOptions(): this {
        this.request.user_options = [
            {
                option_id: "approve",
                label: "Approve and Execute",
                action: "approve"
            },
            {
                option_id: "reject",
                label: "Reject",
                action: "reject"
            },
            {
                option_id: "modify",
                label: "Request Modifications",
                action: "modify"
            }
        ];
        return this;
    }

    /**
     * Build from PlanDraft
     */
    fromPlan(plan: PlanDraft): this {
        this.withRandomId();
        this.basedOnPlan(plan.plan_id);

        // Generate summary
        const actionTypes = [...new Set(plan.actions.map(a => a.type))];
        this.withSummary(
            `${plan.intent}. Contains ${plan.actions.length} action(s): ${actionTypes.join(", ")}. ` +
            `Risk level: ${plan.risk_level}. Rollback: ${plan.rollback_possible ? "possible" : "not possible"}.`
        );

        // Add action previews
        for (const action of plan.actions) {
            this.addActionPreview({
                action_id: action.action_id,
                type: action.type,
                target: action.target,
                risk: action.estimated_risk
            });
        }

        // Determine if approval required
        const assessor = createRiskAssessor();
        const assessment = assessor.assessPlan(plan);
        this.requiresApproval(assessment.requiresApproval);

        // Set default expiration
        this.expiresInMinutes(this.config.defaultExpirationMinutes);

        // Add standard options
        this.withStandardOptions();

        return this;
    }

    /**
     * Build the ApprovalRequest
     */
    build(): ApprovalRequest {
        // Validate required fields
        if (!this.request.request_id) {
            this.withRandomId();
        }

        if (!this.request.based_on_plan) {
            throw new Error("based_on_plan is required");
        }

        if (!this.request.summary) {
            throw new Error("summary is required");
        }

        // Set default values
        if (this.request.requires_approval === undefined) {
            this.request.requires_approval = true;
        }

        if (!this.request.expires_at) {
            this.expiresInMinutes(this.config.defaultExpirationMinutes);
        }

        if (!this.request.user_options || this.request.user_options.length === 0) {
            this.withStandardOptions();
        }

        // Set timestamp
        this.request.timestamp = new Date().toISOString();

        // Calculate hash
        this.request.hash = this.calculateHash();

        return this.request as ApprovalRequest;
    }

    /**
     * Calculate SHA256 hash
     */
    private calculateHash(): string {
        const content = JSON.stringify({
            request_id: this.request.request_id,
            timestamp: this.request.timestamp,
            based_on_plan: this.request.based_on_plan,
            summary: this.request.summary,
            actions_preview: this.request.actions_preview,
            security_checks: this.request.security_checks,
            requires_approval: this.request.requires_approval,
            expires_at: this.request.expires_at,
            user_options: this.request.user_options
        });

        return crypto.createHash("sha256").update(content).digest("hex");
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create empty ApprovalRequest builder
 */
export function createApprovalRequestBuilder(
    config?: Partial<ApprovalRequestConfig>
): ApprovalRequestBuilder {
    return new ApprovalRequestBuilder(config);
}

/**
 * Create ApprovalRequest builder from PlanDraft
 */
export function createApprovalRequestFromPlan(
    plan: PlanDraft,
    config?: Partial<ApprovalRequestConfig>
): ApprovalRequestBuilder {
    return new ApprovalRequestBuilder(config).fromPlan(plan);
}

/**
 * Check if approval request has expired
 */
export function isApprovalExpired(request: ApprovalRequest): boolean {
    const now = new Date();
    const expires = new Date(request.expires_at);
    return now > expires;
}

/**
 * Check if all security checks passed
 */
export function allSecurityChecksPassed(request: ApprovalRequest): boolean {
    return request.security_checks.every(check => check.passed);
}

/**
 * Get failed security checks
 */
export function getFailedSecurityChecks(request: ApprovalRequest): SecurityCheck[] {
    return request.security_checks.filter(check => !check.passed);
}

/**
 * Validate ApprovalRequest structure
 */
export function validateApprovalRequest(request: ApprovalRequest): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    // Check required fields
    if (!request.request_id) {errors.push("Missing request_id");}
    if (!request.timestamp) {errors.push("Missing timestamp");}
    if (!request.based_on_plan) {errors.push("Missing based_on_plan");}
    if (!request.summary) {errors.push("Missing summary");}
    if (!request.expires_at) {errors.push("Missing expires_at");}
    if (!request.hash) {errors.push("Missing hash");}

    // Validate document type
    if (request.document_type !== "APPROVAL_REQUEST") {
        errors.push("Invalid document_type");
    }

    // Validate arrays
    if (!Array.isArray(request.actions_preview)) {
        errors.push("actions_preview must be array");
    }
    if (!Array.isArray(request.security_checks)) {
        errors.push("security_checks must be array");
    }
    if (!Array.isArray(request.user_options)) {
        errors.push("user_options must be array");
    }

    // Recalculate and verify hash
    const content = JSON.stringify({
        request_id: request.request_id,
        timestamp: request.timestamp,
        based_on_plan: request.based_on_plan,
        summary: request.summary,
        actions_preview: request.actions_preview,
        security_checks: request.security_checks,
        requires_approval: request.requires_approval,
        expires_at: request.expires_at,
        user_options: request.user_options
    });
    const expectedHash = crypto.createHash("sha256").update(content).digest("hex");
    if (request.hash !== expectedHash) {
        errors.push("Hash mismatch - request may have been tampered");
    }

    return {
        valid: errors.length === 0,
        errors
    };
}
