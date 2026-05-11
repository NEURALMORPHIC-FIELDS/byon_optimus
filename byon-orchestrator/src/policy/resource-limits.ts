/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Resource Limits
 * ===============
 *
 * Defines resource constraints for BYON execution based on risk level.
 * Higher risk = tighter constraints.
 *
 * Resources:
 * - CPU/Iterations
 * - Memory
 * - Disk
 * - Time
 */

import { RiskLevel, PlanDraft } from "../types/protocol.js";

// ============================================================================
// TYPES
// ============================================================================

export interface ResourceLimits {
    /** Maximum iterations allowed */
    maxIterations: number;
    /** Timeout in minutes */
    timeoutMinutes: number;
    /** Memory limit in MB */
    memoryLimitMb: number;
    /** Disk write limit in MB */
    diskLimitMb: number;
    /** Maximum concurrent operations */
    maxConcurrent: number;
    /** Maximum files to create */
    maxFileCreates: number;
    /** Maximum files to modify */
    maxFileModifies: number;
    /** Maximum files to delete */
    maxFileDeletes: number;
}

export interface ResourceUsage {
    /** Iterations used */
    iterationsUsed: number;
    /** Time elapsed in ms */
    timeElapsedMs: number;
    /** Memory used in MB */
    memoryUsedMb: number;
    /** Disk written in MB */
    diskWrittenMb: number;
    /** Files created */
    filesCreated: number;
    /** Files modified */
    filesModified: number;
    /** Files deleted */
    filesDeleted: number;
}

export interface LimitCheckResult {
    /** Whether within limits */
    withinLimits: boolean;
    /** Violations found */
    violations: LimitViolation[];
    /** Usage percentage */
    usagePercent: ResourceUsagePercent;
}

export interface LimitViolation {
    /** Resource type */
    resource: string;
    /** Current value */
    current: number;
    /** Limit value */
    limit: number;
    /** Severity */
    severity: "warning" | "error";
}

export interface ResourceUsagePercent {
    iterations: number;
    time: number;
    memory: number;
    disk: number;
}

// ============================================================================
// DEFAULT LIMITS BY RISK
// ============================================================================

const LIMITS_BY_RISK: Record<RiskLevel, ResourceLimits> = {
    low: {
        maxIterations: 10,
        timeoutMinutes: 30,
        memoryLimitMb: 1024,
        diskLimitMb: 100,
        maxConcurrent: 5,
        maxFileCreates: 20,
        maxFileModifies: 50,
        maxFileDeletes: 5
    },
    medium: {
        maxIterations: 5,
        timeoutMinutes: 15,
        memoryLimitMb: 512,
        diskLimitMb: 50,
        maxConcurrent: 3,
        maxFileCreates: 10,
        maxFileModifies: 30,
        maxFileDeletes: 3
    },
    high: {
        maxIterations: 3,
        timeoutMinutes: 10,
        memoryLimitMb: 256,
        diskLimitMb: 25,
        maxConcurrent: 2,
        maxFileCreates: 5,
        maxFileModifies: 15,
        maxFileDeletes: 2
    }
};

// ============================================================================
// RESOURCE LIMITS MANAGER
// ============================================================================

/**
 * Resource Limits Manager
 *
 * Manages and enforces resource constraints.
 */
export class ResourceLimitsManager {
    private limits: ResourceLimits;
    private currentUsage: ResourceUsage;
    private startTime: number;

    constructor(riskLevel: RiskLevel = "medium") {
        this.limits = { ...LIMITS_BY_RISK[riskLevel] };
        this.currentUsage = this.createEmptyUsage();
        this.startTime = Date.now();
    }

    /**
     * Create empty usage record
     */
    private createEmptyUsage(): ResourceUsage {
        return {
            iterationsUsed: 0,
            timeElapsedMs: 0,
            memoryUsedMb: 0,
            diskWrittenMb: 0,
            filesCreated: 0,
            filesModified: 0,
            filesDeleted: 0
        };
    }

    /**
     * Set limits from risk level
     */
    setLimitsFromRisk(riskLevel: RiskLevel): void {
        this.limits = { ...LIMITS_BY_RISK[riskLevel] };
    }

    /**
     * Set custom limits
     */
    setCustomLimits(limits: Partial<ResourceLimits>): void {
        this.limits = { ...this.limits, ...limits };
    }

    /**
     * Get current limits
     */
    getLimits(): ResourceLimits {
        return { ...this.limits };
    }

    /**
     * Record iteration
     */
    recordIteration(): void {
        this.currentUsage.iterationsUsed++;
    }

    /**
     * Record memory usage
     */
    recordMemoryUsage(mb: number): void {
        this.currentUsage.memoryUsedMb = Math.max(this.currentUsage.memoryUsedMb, mb);
    }

    /**
     * Record disk write
     */
    recordDiskWrite(mb: number): void {
        this.currentUsage.diskWrittenMb += mb;
    }

    /**
     * Record file creation
     */
    recordFileCreate(): void {
        this.currentUsage.filesCreated++;
    }

    /**
     * Record file modification
     */
    recordFileModify(): void {
        this.currentUsage.filesModified++;
    }

    /**
     * Record file deletion
     */
    recordFileDelete(): void {
        this.currentUsage.filesDeleted++;
    }

    /**
     * Get current usage
     */
    getUsage(): ResourceUsage {
        return {
            ...this.currentUsage,
            timeElapsedMs: Date.now() - this.startTime
        };
    }

    /**
     * Check if within limits
     */
    check(): LimitCheckResult {
        const usage = this.getUsage();
        const violations: LimitViolation[] = [];

        // Check iterations
        if (usage.iterationsUsed > this.limits.maxIterations) {
            violations.push({
                resource: "iterations",
                current: usage.iterationsUsed,
                limit: this.limits.maxIterations,
                severity: "error"
            });
        } else if (usage.iterationsUsed > this.limits.maxIterations * 0.8) {
            violations.push({
                resource: "iterations",
                current: usage.iterationsUsed,
                limit: this.limits.maxIterations,
                severity: "warning"
            });
        }

        // Check time
        const timeMinutes = usage.timeElapsedMs / (1000 * 60);
        if (timeMinutes > this.limits.timeoutMinutes) {
            violations.push({
                resource: "time",
                current: Math.round(timeMinutes * 10) / 10,
                limit: this.limits.timeoutMinutes,
                severity: "error"
            });
        } else if (timeMinutes > this.limits.timeoutMinutes * 0.8) {
            violations.push({
                resource: "time",
                current: Math.round(timeMinutes * 10) / 10,
                limit: this.limits.timeoutMinutes,
                severity: "warning"
            });
        }

        // Check memory
        if (usage.memoryUsedMb > this.limits.memoryLimitMb) {
            violations.push({
                resource: "memory",
                current: usage.memoryUsedMb,
                limit: this.limits.memoryLimitMb,
                severity: "error"
            });
        }

        // Check disk
        if (usage.diskWrittenMb > this.limits.diskLimitMb) {
            violations.push({
                resource: "disk",
                current: usage.diskWrittenMb,
                limit: this.limits.diskLimitMb,
                severity: "error"
            });
        }

        // Check file operations
        if (usage.filesCreated > this.limits.maxFileCreates) {
            violations.push({
                resource: "file_creates",
                current: usage.filesCreated,
                limit: this.limits.maxFileCreates,
                severity: "error"
            });
        }

        if (usage.filesModified > this.limits.maxFileModifies) {
            violations.push({
                resource: "file_modifies",
                current: usage.filesModified,
                limit: this.limits.maxFileModifies,
                severity: "error"
            });
        }

        if (usage.filesDeleted > this.limits.maxFileDeletes) {
            violations.push({
                resource: "file_deletes",
                current: usage.filesDeleted,
                limit: this.limits.maxFileDeletes,
                severity: "error"
            });
        }

        // Calculate usage percentages
        const usagePercent: ResourceUsagePercent = {
            iterations: (usage.iterationsUsed / this.limits.maxIterations) * 100,
            time: (timeMinutes / this.limits.timeoutMinutes) * 100,
            memory: (usage.memoryUsedMb / this.limits.memoryLimitMb) * 100,
            disk: (usage.diskWrittenMb / this.limits.diskLimitMb) * 100
        };

        const hasErrors = violations.some(v => v.severity === "error");

        return {
            withinLimits: !hasErrors,
            violations,
            usagePercent
        };
    }

    /**
     * Check if can continue
     */
    canContinue(): boolean {
        return this.check().withinLimits;
    }

    /**
     * Get remaining resources
     */
    getRemaining(): {
        iterations: number;
        timeMinutes: number;
        memoryMb: number;
        diskMb: number;
    } {
        const usage = this.getUsage();
        const timeMinutes = usage.timeElapsedMs / (1000 * 60);

        return {
            iterations: Math.max(0, this.limits.maxIterations - usage.iterationsUsed),
            timeMinutes: Math.max(0, this.limits.timeoutMinutes - timeMinutes),
            memoryMb: Math.max(0, this.limits.memoryLimitMb - usage.memoryUsedMb),
            diskMb: Math.max(0, this.limits.diskLimitMb - usage.diskWrittenMb)
        };
    }

    /**
     * Reset usage tracking
     */
    reset(): void {
        this.currentUsage = this.createEmptyUsage();
        this.startTime = Date.now();
    }

    /**
     * Get summary string
     */
    getSummary(): string {
        const usage = this.getUsage();
        const timeMinutes = Math.round(usage.timeElapsedMs / (1000 * 60) * 10) / 10;

        return [
            `Iterations: ${usage.iterationsUsed}/${this.limits.maxIterations}`,
            `Time: ${timeMinutes}/${this.limits.timeoutMinutes} min`,
            `Memory: ${usage.memoryUsedMb}/${this.limits.memoryLimitMb} MB`,
            `Disk: ${usage.diskWrittenMb}/${this.limits.diskLimitMb} MB`,
            `Files: +${usage.filesCreated} ~${usage.filesModified} -${usage.filesDeleted}`
        ].join(" | ");
    }
}

// ============================================================================
// PLAN LIMIT VALIDATION
// ============================================================================

/**
 * Validate plan against resource limits
 */
export function validatePlanLimits(
    plan: PlanDraft,
    riskLevel: RiskLevel
): {
    valid: boolean;
    violations: string[];
    limits: ResourceLimits;
} {
    const limits = LIMITS_BY_RISK[riskLevel];
    const violations: string[] = [];

    // Count actions by type
    const createCount = plan.actions.filter(a => a.type === "file_create").length;
    const modifyCount = plan.actions.filter(
        a => ["code_edit", "file_modify", "file_write"].includes(a.type)
    ).length;
    const deleteCount = plan.actions.filter(a => a.type === "file_delete").length;

    // Check against limits
    if (createCount > limits.maxFileCreates) {
        violations.push(
            `Too many file creations: ${createCount} > ${limits.maxFileCreates}`
        );
    }

    if (modifyCount > limits.maxFileModifies) {
        violations.push(
            `Too many file modifications: ${modifyCount} > ${limits.maxFileModifies}`
        );
    }

    if (deleteCount > limits.maxFileDeletes) {
        violations.push(
            `Too many file deletions: ${deleteCount} > ${limits.maxFileDeletes}`
        );
    }

    if (plan.estimated_iterations > limits.maxIterations) {
        violations.push(
            `Too many iterations: ${plan.estimated_iterations} > ${limits.maxIterations}`
        );
    }

    return {
        valid: violations.length === 0,
        violations,
        limits
    };
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create resource limits manager
 */
export function createResourceLimits(
    riskLevel: RiskLevel = "medium"
): ResourceLimitsManager {
    return new ResourceLimitsManager(riskLevel);
}

/**
 * Get limits for risk level
 */
export function getLimitsForRisk(riskLevel: RiskLevel): ResourceLimits {
    return { ...LIMITS_BY_RISK[riskLevel] };
}

/**
 * Export limits by risk level
 */
export const RESOURCE_LIMITS = LIMITS_BY_RISK;
