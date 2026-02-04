/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Risk Assessment System
 * ======================
 *
 * Comprehensive risk scoring for BYON plans and actions.
 * Uses weighted factors to calculate overall risk level.
 *
 * Risk Factors:
 * - File operations (deletes = high, creates = low)
 * - Action count and complexity
 * - Target sensitivity
 * - Iteration requirements
 * - Rollback capability
 */

import {
    Action,
    ActionType,
    PlanDraft,
    RiskLevel
} from "../types/protocol.js";

// ============================================================================
// TYPES
// ============================================================================

export interface RiskScore {
    /** Overall risk level */
    level: RiskLevel;
    /** Numerical score (0-100) */
    score: number;
    /** Score breakdown by factor */
    breakdown: RiskFactorScore[];
    /** Summary of risk assessment */
    summary: string;
    /** Whether user approval is required */
    requiresApproval: boolean;
    /** Recommended constraints */
    recommendedConstraints: RecommendedConstraints;
}

export interface RiskFactorScore {
    /** Factor name */
    name: string;
    /** Factor weight (0-1) */
    weight: number;
    /** Raw score before weight (0-100) */
    rawScore: number;
    /** Weighted score */
    weightedScore: number;
    /** Factor description */
    description: string;
}

export interface RecommendedConstraints {
    maxIterations: number;
    timeoutMinutes: number;
    memoryLimitMb: number;
    diskLimitMb: number;
}

export interface RiskAssessmentConfig {
    /** Threshold for low risk (0-100) */
    lowThreshold: number;
    /** Threshold for medium risk (0-100) */
    mediumThreshold: number;
    /** Auto-approve below this level */
    autoApproveLevel: RiskLevel | "none";
    /** Factor weights */
    factorWeights: RiskFactorWeights;
}

export interface RiskFactorWeights {
    fileDeletes: number;
    fileCreates: number;
    codeEdits: number;
    actionCount: number;
    iterations: number;
    rollback: number;
    sensitivity: number;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: RiskAssessmentConfig = {
    lowThreshold: 30,
    mediumThreshold: 60,
    autoApproveLevel: "low",
    factorWeights: {
        fileDeletes: 0.20,
        fileCreates: 0.10,
        codeEdits: 0.15,
        actionCount: 0.15,
        iterations: 0.10,
        rollback: 0.15,
        sensitivity: 0.15
    }
};

// ============================================================================
// RISK SCORES BY ACTION TYPE
// ============================================================================

const ACTION_BASE_SCORES: Record<ActionType, number> = {
    file_delete: 80,
    shell_exec: 90,
    file_write: 40,
    file_modify: 40,
    code_edit: 35,
    file_create: 20,
    build_run: 15,
    lint_run: 10,
    test_run: 10
};

// ============================================================================
// SENSITIVE TARGET PATTERNS
// ============================================================================

const SENSITIVE_PATTERNS = [
    { pattern: /package\.json$/i, score: 50, description: "Package configuration" },
    { pattern: /tsconfig\.json$/i, score: 40, description: "TypeScript configuration" },
    { pattern: /\.config\./i, score: 45, description: "Configuration file" },
    { pattern: /webpack|vite|rollup/i, score: 40, description: "Bundler configuration" },
    { pattern: /dockerfile/i, score: 60, description: "Docker configuration" },
    { pattern: /docker-compose/i, score: 55, description: "Docker Compose" },
    { pattern: /\.github\//i, score: 50, description: "GitHub configuration" },
    { pattern: /\.gitlab/i, score: 50, description: "GitLab configuration" },
    { pattern: /index\.(ts|js|tsx|jsx)$/i, score: 35, description: "Entry point file" },
    { pattern: /main\.(ts|js|tsx|jsx)$/i, score: 35, description: "Main file" },
    { pattern: /app\.(ts|js|tsx|jsx)$/i, score: 35, description: "App file" },
    { pattern: /server\.(ts|js)$/i, score: 45, description: "Server file" },
    { pattern: /database|db\./i, score: 55, description: "Database configuration" },
    { pattern: /auth|authentication/i, score: 50, description: "Authentication code" },
    { pattern: /security|crypto/i, score: 55, description: "Security code" }
];

// ============================================================================
// RISK ASSESSMENT
// ============================================================================

/**
 * Risk Assessment System
 *
 * Calculates comprehensive risk scores for plans and actions.
 */
export class RiskAssessmentSystem {
    private config: RiskAssessmentConfig;

    constructor(config: Partial<RiskAssessmentConfig> = {}) {
        this.config = {
            ...DEFAULT_CONFIG,
            ...config,
            factorWeights: {
                ...DEFAULT_CONFIG.factorWeights,
                ...config.factorWeights
            }
        };
    }

    /**
     * Assess risk for a plan
     */
    assessPlan(plan: PlanDraft): RiskScore {
        const breakdown: RiskFactorScore[] = [];
        const weights = this.config.factorWeights;

        // Factor 1: File Deletes
        const deleteCount = plan.actions.filter(a => a.type === "file_delete").length;
        const deleteScore = Math.min(deleteCount * 25, 100);
        breakdown.push({
            name: "File Deletions",
            weight: weights.fileDeletes,
            rawScore: deleteScore,
            weightedScore: deleteScore * weights.fileDeletes,
            description: `${deleteCount} file deletion(s)`
        });

        // Factor 2: File Creates
        const createCount = plan.actions.filter(a => a.type === "file_create").length;
        const createScore = Math.min(createCount * 5, 50);
        breakdown.push({
            name: "File Creations",
            weight: weights.fileCreates,
            rawScore: createScore,
            weightedScore: createScore * weights.fileCreates,
            description: `${createCount} file creation(s)`
        });

        // Factor 3: Code Edits
        const editCount = plan.actions.filter(
            a => ["code_edit", "file_modify", "file_write"].includes(a.type)
        ).length;
        const editScore = Math.min(editCount * 8, 80);
        breakdown.push({
            name: "Code Edits",
            weight: weights.codeEdits,
            rawScore: editScore,
            weightedScore: editScore * weights.codeEdits,
            description: `${editCount} code modification(s)`
        });

        // Factor 4: Action Count
        const actionCount = plan.actions.length;
        let actionScore: number;
        if (actionCount > 10) {
            actionScore = 80;
        } else if (actionCount > 5) {
            actionScore = 50;
        } else {
            actionScore = actionCount * 8;
        }
        breakdown.push({
            name: "Action Count",
            weight: weights.actionCount,
            rawScore: actionScore,
            weightedScore: actionScore * weights.actionCount,
            description: `${actionCount} total action(s)`
        });

        // Factor 5: Iterations
        const iterations = plan.estimated_iterations;
        let iterationScore: number;
        if (iterations > 5) {
            iterationScore = 70;
        } else if (iterations > 3) {
            iterationScore = 40;
        } else {
            iterationScore = iterations * 10;
        }
        breakdown.push({
            name: "Iterations",
            weight: weights.iterations,
            rawScore: iterationScore,
            weightedScore: iterationScore * weights.iterations,
            description: `${iterations} estimated iteration(s)`
        });

        // Factor 6: Rollback Capability
        const rollbackScore = plan.rollback_possible ? 20 : 80;
        breakdown.push({
            name: "Rollback Capability",
            weight: weights.rollback,
            rawScore: rollbackScore,
            weightedScore: rollbackScore * weights.rollback,
            description: plan.rollback_possible ? "Rollback possible" : "Rollback NOT possible"
        });

        // Factor 7: Target Sensitivity
        const sensitivityScore = this.calculateSensitivityScore(plan.actions);
        breakdown.push({
            name: "Target Sensitivity",
            weight: weights.sensitivity,
            rawScore: sensitivityScore,
            weightedScore: sensitivityScore * weights.sensitivity,
            description: `Sensitivity score based on targets`
        });

        // Calculate total score
        const totalScore = breakdown.reduce((sum, f) => sum + f.weightedScore, 0);
        const level = this.scoreToLevel(totalScore);

        // Determine approval requirement
        const requiresApproval = this.requiresApproval(level);

        // Get recommended constraints
        const recommendedConstraints = this.getRecommendedConstraints(level);

        return {
            level,
            score: Math.round(totalScore),
            breakdown,
            summary: this.generateSummary(plan, level, breakdown),
            requiresApproval,
            recommendedConstraints
        };
    }

    /**
     * Assess risk for a single action
     */
    assessAction(action: Action): {
        level: RiskLevel;
        score: number;
        reason: string;
    } {
        let score = ACTION_BASE_SCORES[action.type] || 50;

        // Adjust for target sensitivity
        const sensitivityBonus = this.getTargetSensitivity(action.target);
        score = Math.min(score + sensitivityBonus, 100);

        // Adjust for rollback
        if (!action.rollback_possible) {
            score = Math.min(score + 20, 100);
        }

        const level = this.scoreToLevel(score);

        return {
            level,
            score,
            reason: `${action.type} on ${action.target} (rollback: ${action.rollback_possible})`
        };
    }

    /**
     * Calculate sensitivity score for action targets
     */
    private calculateSensitivityScore(actions: Action[]): number {
        if (actions.length === 0) return 0;

        let totalSensitivity = 0;
        for (const action of actions) {
            totalSensitivity += this.getTargetSensitivity(action.target);
        }

        return Math.min(totalSensitivity / actions.length, 100);
    }

    /**
     * Get sensitivity score for a target path
     */
    private getTargetSensitivity(target: string): number {
        let maxScore = 0;

        for (const { pattern, score } of SENSITIVE_PATTERNS) {
            if (pattern.test(target)) {
                maxScore = Math.max(maxScore, score);
            }
        }

        return maxScore;
    }

    /**
     * Convert score to risk level
     */
    private scoreToLevel(score: number): RiskLevel {
        if (score <= this.config.lowThreshold) return "low";
        if (score <= this.config.mediumThreshold) return "medium";
        return "high";
    }

    /**
     * Check if approval is required
     */
    private requiresApproval(level: RiskLevel): boolean {
        if (this.config.autoApproveLevel === "none") return true;

        const levelOrder = { low: 0, medium: 1, high: 2 };
        const autoApproveOrder = levelOrder[this.config.autoApproveLevel];
        const currentOrder = levelOrder[level];

        return currentOrder > autoApproveOrder;
    }

    /**
     * Get recommended constraints based on risk level
     */
    private getRecommendedConstraints(level: RiskLevel): RecommendedConstraints {
        const constraintsByLevel: Record<RiskLevel, RecommendedConstraints> = {
            low: {
                maxIterations: 10,
                timeoutMinutes: 30,
                memoryLimitMb: 1024,
                diskLimitMb: 100
            },
            medium: {
                maxIterations: 5,
                timeoutMinutes: 15,
                memoryLimitMb: 512,
                diskLimitMb: 50
            },
            high: {
                maxIterations: 3,
                timeoutMinutes: 10,
                memoryLimitMb: 256,
                diskLimitMb: 25
            }
        };

        return constraintsByLevel[level];
    }

    /**
     * Generate risk summary
     */
    private generateSummary(
        plan: PlanDraft,
        level: RiskLevel,
        breakdown: RiskFactorScore[]
    ): string {
        const highFactors = breakdown
            .filter(f => f.rawScore > 50)
            .map(f => f.name);

        let summary = `Plan with ${plan.actions.length} actions has ${level.toUpperCase()} risk. `;

        if (highFactors.length > 0) {
            summary += `High-risk factors: ${highFactors.join(", ")}. `;
        }

        if (!plan.rollback_possible) {
            summary += "WARNING: Plan cannot be rolled back. ";
        }

        return summary.trim();
    }

    /**
     * Compare two risk scores
     */
    compareRisk(score1: RiskScore, score2: RiskScore): number {
        return score1.score - score2.score;
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create risk assessment system
 */
export function createRiskAssessment(
    config?: Partial<RiskAssessmentConfig>
): RiskAssessmentSystem {
    return new RiskAssessmentSystem(config);
}

/**
 * Quick risk assessment for plan
 */
export function quickRiskAssessment(plan: PlanDraft): RiskLevel {
    const system = new RiskAssessmentSystem();
    return system.assessPlan(plan).level;
}

/**
 * Check if plan requires user approval
 */
export function requiresUserApproval(plan: PlanDraft): boolean {
    const system = new RiskAssessmentSystem();
    return system.assessPlan(plan).requiresApproval;
}

/**
 * Get recommended constraints for plan
 */
export function getRecommendedConstraints(plan: PlanDraft): RecommendedConstraints {
    const system = new RiskAssessmentSystem();
    return system.assessPlan(plan).recommendedConstraints;
}
