/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Vault Policy - Ask-Always Access Control
 * ========================================
 *
 * Implements strict human-in-the-loop access control for sensitive data.
 *
 * POLICY RULES:
 * 1. ALL vault access requires explicit user approval
 * 2. Approval requests expire after 30 seconds
 * 3. Each access is logged permanently
 * 4. No automatic access grants (even for trusted agents)
 * 5. Desktop notifications for all access requests
 */

import { VaultCategory } from './types.js';

/** Policy configuration */
export interface VaultPolicy {
    name: string;
    description: string;
    requireApproval: boolean;
    approvalTimeout: number;
    allowedCategories: VaultCategory[];
    deniedCategories: VaultCategory[];
    auditRequired: boolean;
    notificationRequired: boolean;
    maxAccessesPerHour: number;
}

/** Default ask-always policy */
export const ASK_ALWAYS_POLICY: VaultPolicy = {
    name: 'ask-always',
    description: 'Requires explicit user approval for every vault access',
    requireApproval: true,
    approvalTimeout: 30000, // 30 seconds
    allowedCategories: ['credentials', 'keys', 'financial', 'documents', 'secrets'],
    deniedCategories: [],
    auditRequired: true,
    notificationRequired: true,
    maxAccessesPerHour: 10
};

/** Read-only policy (can list, cannot read values) */
export const READ_ONLY_POLICY: VaultPolicy = {
    name: 'read-only',
    description: 'Can only list entries, cannot read actual values',
    requireApproval: true,
    approvalTimeout: 30000,
    allowedCategories: [],
    deniedCategories: ['credentials', 'keys', 'financial', 'documents', 'secrets'],
    auditRequired: true,
    notificationRequired: true,
    maxAccessesPerHour: 100
};

/** Emergency access policy (for critical operations) */
export const EMERGENCY_POLICY: VaultPolicy = {
    name: 'emergency',
    description: 'Emergency access with extended timeout and dual approval',
    requireApproval: true,
    approvalTimeout: 60000, // 60 seconds
    allowedCategories: ['credentials', 'keys'],
    deniedCategories: [],
    auditRequired: true,
    notificationRequired: true,
    maxAccessesPerHour: 3
};

/** Rate limiting tracker */
const accessCounts = new Map<string, { count: number; resetAt: number }>();

/**
 * Check if access is allowed by policy
 */
export function checkPolicy(
    policy: VaultPolicy,
    category: VaultCategory,
    requestedBy: string
): { allowed: boolean; reason?: string } {
    // Check denied categories
    if (policy.deniedCategories.includes(category)) {
        return {
            allowed: false,
            reason: `Category "${category}" is denied by policy "${policy.name}"`
        };
    }

    // Check allowed categories
    if (policy.allowedCategories.length > 0 && !policy.allowedCategories.includes(category)) {
        return {
            allowed: false,
            reason: `Category "${category}" is not in allowed list for policy "${policy.name}"`
        };
    }

    // Check rate limiting
    const now = Date.now();
    const key = `${requestedBy}:${category}`;
    const tracker = accessCounts.get(key);

    if (tracker) {
        if (now < tracker.resetAt) {
            if (tracker.count >= policy.maxAccessesPerHour) {
                return {
                    allowed: false,
                    reason: `Rate limit exceeded: max ${policy.maxAccessesPerHour} accesses per hour`
                };
            }
            tracker.count++;
        } else {
            // Reset counter
            accessCounts.set(key, { count: 1, resetAt: now + 3600000 });
        }
    } else {
        accessCounts.set(key, { count: 1, resetAt: now + 3600000 });
    }

    return { allowed: true };
}

/**
 * Get policy by name
 */
export function getPolicy(name: string): VaultPolicy | null {
    switch (name) {
        case 'ask-always':
            return ASK_ALWAYS_POLICY;
        case 'read-only':
            return READ_ONLY_POLICY;
        case 'emergency':
            return EMERGENCY_POLICY;
        default:
            return null;
    }
}

/**
 * Validate policy configuration
 */
export function validatePolicy(policy: VaultPolicy): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!policy.name) {
        errors.push('Policy name is required');
    }

    if (policy.approvalTimeout < 5000) {
        errors.push('Approval timeout must be at least 5 seconds');
    }

    if (policy.approvalTimeout > 300000) {
        errors.push('Approval timeout cannot exceed 5 minutes');
    }

    if (policy.maxAccessesPerHour < 1) {
        errors.push('Max accesses per hour must be at least 1');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Create custom policy
 */
export function createPolicy(
    name: string,
    options: Partial<VaultPolicy>
): VaultPolicy {
    return {
        name,
        description: options.description || `Custom policy: ${name}`,
        requireApproval: options.requireApproval ?? true,
        approvalTimeout: options.approvalTimeout ?? 30000,
        allowedCategories: options.allowedCategories ?? ['credentials', 'keys', 'financial', 'documents', 'secrets'],
        deniedCategories: options.deniedCategories ?? [],
        auditRequired: options.auditRequired ?? true,
        notificationRequired: options.notificationRequired ?? true,
        maxAccessesPerHour: options.maxAccessesPerHour ?? 10
    };
}

/**
 * Reset rate limiting for testing
 */
export function resetRateLimits(): void {
    accessCounts.clear();
}
