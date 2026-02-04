/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Auditor Approval Manager
 * ========================
 *
 * Manages the approval workflow for PlanDrafts.
 * Creates ApprovalRequests and tracks responses.
 *
 * WORKFLOW:
 * 1. Receive validated PlanDraft
 * 2. Generate ApprovalRequest
 * 3. Wait for user decision (or auto-approve if low risk)
 * 4. Return approval decision
 */

import * as crypto from "crypto";
import {
    PlanDraft,
    ApprovalRequest,
    ExecutionOrder,
    UserOption,
    SecurityCheck,
    RiskLevel
} from "../../types/protocol.js";

// ============================================================================
// TYPES
// ============================================================================

export interface ApprovalManagerConfig {
    /** Auto-approve low risk plans */
    auto_approve_low_risk: boolean;
    /** Approval expiration in minutes */
    approval_expiration_minutes: number;
    /** Require explicit approval for high risk */
    require_explicit_high_risk: boolean;
    /** Maximum pending approvals */
    max_pending_approvals: number;
}

export interface ApprovalDecision {
    request_id: string;
    decision: "approved" | "rejected" | "modified" | "expired";
    decided_by: string;
    decided_at: string;
    modifications?: PlanModification[];
    reason?: string;
}

export interface PlanModification {
    action_id: string;
    modification_type: "remove" | "modify" | "add";
    new_parameters?: Record<string, unknown>;
}

export interface PendingApproval {
    request: ApprovalRequest;
    plan: PlanDraft;
    created_at: string;
    expires_at: string;
    status: "pending" | "approved" | "rejected" | "expired";
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: ApprovalManagerConfig = {
    auto_approve_low_risk: true,
    approval_expiration_minutes: 30,
    require_explicit_high_risk: true,
    max_pending_approvals: 100
};

// ============================================================================
// DEFAULT USER OPTIONS
// ============================================================================

const DEFAULT_USER_OPTIONS: UserOption[] = [
    {
        option_id: "approve",
        label: "Approve",
        action: "approve"
    },
    {
        option_id: "reject",
        label: "Reject",
        action: "reject"
    },
    {
        option_id: "modify",
        label: "Modify Plan",
        action: "modify"
    }
];

// ============================================================================
// APPROVAL MANAGER
// ============================================================================

/**
 * Approval Manager
 *
 * Creates and tracks approval requests for plans.
 */
export class ApprovalManager {
    private config: ApprovalManagerConfig;
    private pendingApprovals: Map<string, PendingApproval> = new Map();
    private approvalHistory: ApprovalDecision[] = [];

    constructor(config: Partial<ApprovalManagerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Create approval request for a plan
     */
    createApprovalRequest(
        plan: PlanDraft,
        securityChecks: SecurityCheck[]
    ): ApprovalRequest {
        const requestId = `req_${crypto.randomUUID().replace(/-/g, "")}`;
        const timestamp = new Date().toISOString();

        // Calculate expiration
        const expiresAt = new Date();
        expiresAt.setMinutes(
            expiresAt.getMinutes() + this.config.approval_expiration_minutes
        );

        // Determine if approval is required
        const requiresApproval = this.determineApprovalRequired(
            plan,
            securityChecks
        );

        // Generate summary
        const summary = this.generateSummary(plan);

        // Generate actions preview
        const actionsPreview = plan.actions.map(a => ({
            action_id: a.action_id,
            type: a.type,
            target: a.target,
            risk: a.estimated_risk
        }));

        // Calculate overall risk level (highest from actions)
        const riskLevels = actionsPreview.map(a => a.risk);
        const overallRisk = riskLevels.includes("high") ? "high" :
                            riskLevels.includes("medium") ? "medium" : "low";

        // Calculate hash
        const content: Omit<ApprovalRequest, "hash"> = {
            document_type: "APPROVAL_REQUEST",
            document_version: "1.0",
            request_id: requestId,
            timestamp,
            based_on_plan: plan.plan_id,
            summary,
            risk_level: overallRisk,
            actions_preview: actionsPreview,
            security_checks: securityChecks,
            requires_approval: requiresApproval,
            expires_at: expiresAt.toISOString(),
            user_options: DEFAULT_USER_OPTIONS
        };

        const hash = this.calculateHash(content);

        const request: ApprovalRequest = {
            ...content,
            hash
        };

        // Store pending approval
        this.pendingApprovals.set(requestId, {
            request,
            plan,
            created_at: timestamp,
            expires_at: expiresAt.toISOString(),
            status: "pending"
        });

        // Cleanup old pending approvals
        this.cleanupExpired();

        return request;
    }

    /**
     * Check if approval is required
     */
    private determineApprovalRequired(
        plan: PlanDraft,
        securityChecks: SecurityCheck[]
    ): boolean {
        // Always require approval for high risk
        if (plan.risk_level === "high" && this.config.require_explicit_high_risk) {
            return true;
        }

        // Check if any security check failed
        const failedChecks = securityChecks.filter(c => !c.passed);
        if (failedChecks.length > 0) {
            return true;
        }

        // Auto-approve low risk if configured
        if (plan.risk_level === "low" && this.config.auto_approve_low_risk) {
            return false;
        }

        // Default: require approval for medium risk
        return true;
    }

    /**
     * Generate human-readable summary
     */
    private generateSummary(plan: PlanDraft): string {
        const actionCounts: Record<string, number> = {};

        for (const action of plan.actions) {
            actionCounts[action.type] = (actionCounts[action.type] || 0) + 1;
        }

        const parts: string[] = [];

        for (const [type, count] of Object.entries(actionCounts)) {
            parts.push(`${count} ${type.replace(/_/g, " ")}${count > 1 ? "s" : ""}`);
        }

        const riskNote = plan.risk_level === "high"
            ? " [HIGH RISK]"
            : plan.risk_level === "medium"
                ? " [MEDIUM RISK]"
                : "";

        return `Plan includes: ${parts.join(", ")}${riskNote}`;
    }

    /**
     * Process approval decision
     */
    processDecision(
        requestId: string,
        decision: "approved" | "rejected" | "modified",
        decidedBy: string,
        modifications?: PlanModification[],
        reason?: string
    ): ApprovalDecision {
        const pending = this.pendingApprovals.get(requestId);

        if (!pending) {
            throw new Error(`Approval request not found: ${requestId}`);
        }

        if (pending.status !== "pending") {
            throw new Error(`Approval already processed: ${pending.status}`);
        }

        // Check if expired
        if (new Date(pending.expires_at) < new Date()) {
            pending.status = "expired";
            throw new Error("Approval request has expired");
        }

        // Update status
        pending.status = decision === "approved" || decision === "modified"
            ? "approved"
            : "rejected";

        // Create decision record
        const approvalDecision: ApprovalDecision = {
            request_id: requestId,
            decision,
            decided_by: decidedBy,
            decided_at: new Date().toISOString(),
            modifications,
            reason
        };

        // Store in history
        this.approvalHistory.push(approvalDecision);

        return approvalDecision;
    }

    /**
     * Get pending approval by request ID
     */
    getPending(requestId: string): PendingApproval | undefined {
        return this.pendingApprovals.get(requestId);
    }

    /**
     * Get plan from pending approval
     */
    getPlanForApproval(requestId: string): PlanDraft | undefined {
        return this.pendingApprovals.get(requestId)?.plan;
    }

    /**
     * Auto-approve a request (for low risk)
     */
    autoApprove(requestId: string): ApprovalDecision {
        return this.processDecision(requestId, "approved", "auto", undefined, "Auto-approved (low risk)");
    }

    /**
     * Check if request should be auto-approved
     */
    shouldAutoApprove(requestId: string): boolean {
        const pending = this.pendingApprovals.get(requestId);
        if (!pending) return false;

        return !pending.request.requires_approval;
    }

    /**
     * Apply modifications to plan
     */
    applyModifications(
        plan: PlanDraft,
        modifications: PlanModification[]
    ): PlanDraft {
        const modifiedActions = [...plan.actions];

        for (const mod of modifications) {
            const index = modifiedActions.findIndex(a => a.action_id === mod.action_id);

            switch (mod.modification_type) {
                case "remove":
                    if (index !== -1) {
                        modifiedActions.splice(index, 1);
                    }
                    break;

                case "modify":
                    if (index !== -1 && mod.new_parameters) {
                        modifiedActions[index] = {
                            ...modifiedActions[index],
                            parameters: {
                                ...modifiedActions[index].parameters,
                                ...mod.new_parameters
                            }
                        };
                    }
                    break;

                case "add":
                    // Add is handled separately
                    break;
            }
        }

        // Recalculate hash for modified plan
        const modifiedPlan: Omit<PlanDraft, "hash"> = {
            ...plan,
            actions: modifiedActions,
            timestamp: new Date().toISOString()
        };

        const hash = this.calculateHash(modifiedPlan);

        return {
            ...modifiedPlan,
            hash
        };
    }

    /**
     * Get all pending approvals
     */
    getAllPending(): PendingApproval[] {
        return Array.from(this.pendingApprovals.values())
            .filter(p => p.status === "pending");
    }

    /**
     * Get approval history
     */
    getHistory(limit?: number): ApprovalDecision[] {
        const history = [...this.approvalHistory].reverse();
        return limit ? history.slice(0, limit) : history;
    }

    /**
     * Get statistics
     */
    getStats(): {
        pending_count: number;
        approved_count: number;
        rejected_count: number;
        expired_count: number;
        auto_approve_enabled: boolean;
    } {
        let approved = 0, rejected = 0, expired = 0;

        for (const pending of this.pendingApprovals.values()) {
            switch (pending.status) {
                case "approved":
                    approved++;
                    break;
                case "rejected":
                    rejected++;
                    break;
                case "expired":
                    expired++;
                    break;
            }
        }

        return {
            pending_count: this.getAllPending().length,
            approved_count: approved,
            rejected_count: rejected,
            expired_count: expired,
            auto_approve_enabled: this.config.auto_approve_low_risk
        };
    }

    /**
     * Cleanup expired approvals
     */
    private cleanupExpired(): void {
        const now = new Date();

        for (const [id, pending] of this.pendingApprovals) {
            if (pending.status === "pending" && new Date(pending.expires_at) < now) {
                pending.status = "expired";
            }
        }

        // Remove old entries if too many
        if (this.pendingApprovals.size > this.config.max_pending_approvals * 2) {
            const toRemove: string[] = [];

            for (const [id, pending] of this.pendingApprovals) {
                if (pending.status !== "pending") {
                    toRemove.push(id);
                }
            }

            // Remove oldest non-pending entries
            toRemove
                .sort((a, b) => {
                    const aTime = new Date(this.pendingApprovals.get(a)!.created_at).getTime();
                    const bTime = new Date(this.pendingApprovals.get(b)!.created_at).getTime();
                    return aTime - bTime;
                })
                .slice(0, toRemove.length - this.config.max_pending_approvals)
                .forEach(id => this.pendingApprovals.delete(id));
        }
    }

    /**
     * Calculate SHA256 hash
     */
    private calculateHash(content: unknown): string {
        const json = JSON.stringify(content, Object.keys(content as object).sort());
        return crypto.createHash("sha256").update(json).digest("hex");
    }

    /**
     * Clear all pending (for testing)
     */
    clear(): void {
        this.pendingApprovals.clear();
        this.approvalHistory = [];
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create approval manager
 */
export function createApprovalManager(
    config?: Partial<ApprovalManagerConfig>
): ApprovalManager {
    return new ApprovalManager(config);
}

/**
 * Create security checks from validation results
 */
export function createSecurityChecks(
    validationErrors: string[],
    validationWarnings: string[]
): SecurityCheck[] {
    const checks: SecurityCheck[] = [];

    // Add error checks (failed)
    for (const error of validationErrors) {
        checks.push({
            check_type: "policy_validation",
            passed: false,
            details: error
        });
    }

    // Add warning checks (passed with notes)
    for (const warning of validationWarnings) {
        checks.push({
            check_type: "policy_warning",
            passed: true,
            details: warning
        });
    }

    // Add default check if no errors
    if (validationErrors.length === 0) {
        checks.push({
            check_type: "policy_validation",
            passed: true,
            details: "All policy checks passed"
        });
    }

    return checks;
}
