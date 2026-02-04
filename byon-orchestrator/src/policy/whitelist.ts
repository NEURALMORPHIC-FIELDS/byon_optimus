/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Action Whitelist
 * ================
 *
 * Whitelist of allowed actions for BYON executor.
 * All actions must be explicitly whitelisted to be executed.
 *
 * SECURITY: Actions not in whitelist are REJECTED by default.
 */

import { ActionType, Action, RiskLevel } from "../types/protocol.js";

// ============================================================================
// TYPES
// ============================================================================

export interface ActionPolicy {
    /** Action type */
    type: ActionType;
    /** Whether action is allowed */
    allowed: boolean;
    /** Base risk level */
    baseRisk: RiskLevel;
    /** Whether rollback is possible */
    rollbackPossible: boolean;
    /** Required approval level */
    approvalRequired: "none" | "auto" | "user";
    /** Maximum allowed per plan */
    maxPerPlan: number;
    /** Description */
    description: string;
}

export interface WhitelistConfig {
    /** Allow shell execution */
    allowShellExec: boolean;
    /** Allow file deletion */
    allowFileDelete: boolean;
    /** Strict mode - reject unknown actions */
    strictMode: boolean;
    /** Custom action policies */
    customPolicies: Partial<Record<ActionType, Partial<ActionPolicy>>>;
}

export interface WhitelistResult {
    /** Whether action is allowed */
    allowed: boolean;
    /** Reason for decision */
    reason: string;
    /** Policy that applies */
    policy?: ActionPolicy;
}

// ============================================================================
// DEFAULT POLICIES
// ============================================================================

const DEFAULT_POLICIES: Record<ActionType, ActionPolicy> = {
    code_edit: {
        type: "code_edit",
        allowed: true,
        baseRisk: "medium",
        rollbackPossible: true,
        approvalRequired: "auto",
        maxPerPlan: 50,
        description: "Edit existing code files"
    },
    file_create: {
        type: "file_create",
        allowed: true,
        baseRisk: "low",
        rollbackPossible: true,
        approvalRequired: "auto",
        maxPerPlan: 20,
        description: "Create new files"
    },
    file_delete: {
        type: "file_delete",
        allowed: false, // Disabled by default
        baseRisk: "high",
        rollbackPossible: false,
        approvalRequired: "user",
        maxPerPlan: 5,
        description: "Delete files (requires explicit enable)"
    },
    file_write: {
        type: "file_write",
        allowed: true,
        baseRisk: "medium",
        rollbackPossible: true,
        approvalRequired: "auto",
        maxPerPlan: 30,
        description: "Write content to files"
    },
    file_modify: {
        type: "file_modify",
        allowed: true,
        baseRisk: "medium",
        rollbackPossible: true,
        approvalRequired: "auto",
        maxPerPlan: 50,
        description: "Modify file content"
    },
    test_run: {
        type: "test_run",
        allowed: true,
        baseRisk: "low",
        rollbackPossible: true,
        approvalRequired: "none",
        maxPerPlan: 10,
        description: "Run test suites"
    },
    lint_run: {
        type: "lint_run",
        allowed: true,
        baseRisk: "low",
        rollbackPossible: true,
        approvalRequired: "none",
        maxPerPlan: 10,
        description: "Run linting tools"
    },
    build_run: {
        type: "build_run",
        allowed: true,
        baseRisk: "low",
        rollbackPossible: true,
        approvalRequired: "none",
        maxPerPlan: 5,
        description: "Run build process"
    },
    shell_exec: {
        type: "shell_exec",
        allowed: false, // Disabled by default - DANGEROUS
        baseRisk: "high",
        rollbackPossible: false,
        approvalRequired: "user",
        maxPerPlan: 3,
        description: "Execute shell commands (requires explicit enable)"
    }
};

const DEFAULT_CONFIG: WhitelistConfig = {
    allowShellExec: false,
    allowFileDelete: false,
    strictMode: true,
    customPolicies: {}
};

// ============================================================================
// ACTION WHITELIST
// ============================================================================

/**
 * Action Whitelist
 *
 * Validates actions against whitelist policies.
 */
export class ActionWhitelist {
    private config: WhitelistConfig;
    private policies: Map<ActionType, ActionPolicy>;

    constructor(config: Partial<WhitelistConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.policies = new Map();

        // Initialize policies
        this.initializePolicies();
    }

    /**
     * Initialize policies with config overrides
     */
    private initializePolicies(): void {
        // Start with defaults
        for (const [type, policy] of Object.entries(DEFAULT_POLICIES)) {
            this.policies.set(type as ActionType, { ...policy });
        }

        // Apply config overrides
        if (this.config.allowShellExec) {
            const shellPolicy = this.policies.get("shell_exec")!;
            shellPolicy.allowed = true;
        }

        if (this.config.allowFileDelete) {
            const deletePolicy = this.policies.get("file_delete")!;
            deletePolicy.allowed = true;
        }

        // Apply custom policies
        for (const [type, customPolicy] of Object.entries(this.config.customPolicies)) {
            const existingPolicy = this.policies.get(type as ActionType);
            if (existingPolicy) {
                this.policies.set(type as ActionType, {
                    ...existingPolicy,
                    ...customPolicy
                });
            }
        }
    }

    /**
     * Check if action is allowed
     */
    check(action: Action): WhitelistResult {
        const policy = this.policies.get(action.type);

        // Unknown action type
        if (!policy) {
            if (this.config.strictMode) {
                return {
                    allowed: false,
                    reason: `Unknown action type: ${action.type}`
                };
            }
            return {
                allowed: false,
                reason: `Action type ${action.type} not in whitelist`
            };
        }

        // Check if action is allowed
        if (!policy.allowed) {
            return {
                allowed: false,
                reason: `Action type ${action.type} is not allowed by policy`,
                policy
            };
        }

        return {
            allowed: true,
            reason: `Action type ${action.type} is allowed`,
            policy
        };
    }

    /**
     * Check multiple actions
     */
    checkAll(actions: Action[]): {
        allAllowed: boolean;
        results: Map<string, WhitelistResult>;
        blockedActions: Action[];
    } {
        const results = new Map<string, WhitelistResult>();
        const blockedActions: Action[] = [];

        // Check action count limits
        const typeCounts = new Map<ActionType, number>();

        for (const action of actions) {
            // Check individual action
            const result = this.check(action);
            results.set(action.action_id, result);

            if (!result.allowed) {
                blockedActions.push(action);
                continue;
            }

            // Check count limits
            const currentCount = typeCounts.get(action.type) || 0;
            typeCounts.set(action.type, currentCount + 1);

            const policy = this.policies.get(action.type);
            if (policy && currentCount + 1 > policy.maxPerPlan) {
                results.set(action.action_id, {
                    allowed: false,
                    reason: `Exceeded maximum ${action.type} actions per plan (${policy.maxPerPlan})`,
                    policy
                });
                blockedActions.push(action);
            }
        }

        return {
            allAllowed: blockedActions.length === 0,
            results,
            blockedActions
        };
    }

    /**
     * Get policy for action type
     */
    getPolicy(type: ActionType): ActionPolicy | undefined {
        return this.policies.get(type);
    }

    /**
     * Get all policies
     */
    getAllPolicies(): ActionPolicy[] {
        return Array.from(this.policies.values());
    }

    /**
     * Get allowed action types
     */
    getAllowedTypes(): ActionType[] {
        return Array.from(this.policies.entries())
            .filter(([_, policy]) => policy.allowed)
            .map(([type, _]) => type);
    }

    /**
     * Check if type requires user approval
     */
    requiresUserApproval(type: ActionType): boolean {
        const policy = this.policies.get(type);
        return policy?.approvalRequired === "user";
    }

    /**
     * Update policy dynamically
     */
    updatePolicy(type: ActionType, updates: Partial<ActionPolicy>): void {
        const existing = this.policies.get(type);
        if (existing) {
            this.policies.set(type, { ...existing, ...updates });
        }
    }

    /**
     * Enable action type
     */
    enable(type: ActionType): void {
        this.updatePolicy(type, { allowed: true });
    }

    /**
     * Disable action type
     */
    disable(type: ActionType): void {
        this.updatePolicy(type, { allowed: false });
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create action whitelist
 */
export function createActionWhitelist(
    config?: Partial<WhitelistConfig>
): ActionWhitelist {
    return new ActionWhitelist(config);
}

/**
 * Create strict whitelist (no shell, no delete)
 */
export function createStrictWhitelist(): ActionWhitelist {
    return new ActionWhitelist({
        allowShellExec: false,
        allowFileDelete: false,
        strictMode: true
    });
}

/**
 * Create permissive whitelist (for testing only)
 */
export function createPermissiveWhitelist(): ActionWhitelist {
    return new ActionWhitelist({
        allowShellExec: true,
        allowFileDelete: true,
        strictMode: false
    });
}

/**
 * Quick check if action is allowed
 */
export function isActionAllowed(action: Action): boolean {
    const whitelist = createStrictWhitelist();
    return whitelist.check(action).allowed;
}
