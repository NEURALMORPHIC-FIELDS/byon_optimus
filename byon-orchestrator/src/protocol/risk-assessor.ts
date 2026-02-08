/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Risk Assessor
 * =============
 *
 * Assesses risk levels for actions and plans.
 * Provides detailed risk analysis for Auditor validation.
 *
 * Risk Factors:
 * - Action type (delete = high, create = low)
 * - Target sensitivity (config files = high)
 * - Reversibility (rollback possible = lower)
 * - Scope (many files = higher)
 */

import {
    Action,
    ActionType,
    RiskLevel,
    PlanDraft
} from "../types/protocol.js";

// ============================================================================
// TYPES
// ============================================================================

export interface RiskAssessment {
    /** Overall risk level */
    level: RiskLevel;
    /** Risk score 0-100 */
    score: number;
    /** Individual risk factors */
    factors: RiskFactor[];
    /** Risk summary */
    summary: string;
    /** Recommendations */
    recommendations: string[];
    /** Whether human approval is required */
    requiresApproval: boolean;
}

export interface RiskFactor {
    /** Factor name */
    name: string;
    /** Factor weight */
    weight: number;
    /** Factor score */
    score: number;
    /** Factor description */
    description: string;
}

export interface RiskAssessorConfig {
    /** Threshold for low risk (0-100) */
    lowThreshold: number;
    /** Threshold for medium risk (0-100) */
    mediumThreshold: number;
    /** Patterns for sensitive files */
    sensitivePatterns: RegExp[];
    /** Patterns for critical files */
    criticalPatterns: RegExp[];
    /** Auto-approve low risk */
    autoApproveLow: boolean;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: RiskAssessorConfig = {
    lowThreshold: 30,
    mediumThreshold: 60,
    sensitivePatterns: [
        /\.env$/i,
        /config\./i,
        /secret/i,
        /credential/i,
        /password/i,
        /\.key$/i,
        /\.pem$/i,
        /\.crt$/i
    ],
    criticalPatterns: [
        /^package\.json$/,
        /^package-lock\.json$/,
        /^yarn\.lock$/,
        /^pnpm-lock\.yaml$/,
        /^tsconfig\.json$/,
        /^\.github\//,
        /^\.gitlab-ci/,
        /Dockerfile$/i,
        /docker-compose/i
    ],
    autoApproveLow: false
};

// ============================================================================
// RISK WEIGHTS
// ============================================================================

const ACTION_TYPE_RISK: Record<ActionType, number> = {
    file_delete: 80,
    shell_exec: 70,
    file_write: 40,
    file_modify: 40,
    code_edit: 35,
    file_create: 20,
    build_run: 15,
    lint_run: 10,
    test_run: 10
};

const RISK_FACTORS = {
    ACTION_TYPE: { name: "Action Type", weight: 0.3 },
    TARGET_SENSITIVITY: { name: "Target Sensitivity", weight: 0.25 },
    REVERSIBILITY: { name: "Reversibility", weight: 0.2 },
    SCOPE: { name: "Scope", weight: 0.15 },
    COMPLEXITY: { name: "Complexity", weight: 0.1 }
};

// ============================================================================
// RISK ASSESSOR
// ============================================================================

/**
 * Risk Assessor
 *
 * Assesses risk for actions and plans.
 */
export class RiskAssessor {
    private config: RiskAssessorConfig;

    constructor(config: Partial<RiskAssessorConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Assess risk for a single action
     */
    assessAction(action: Action): RiskAssessment {
        const factors: RiskFactor[] = [];

        // Factor 1: Action Type
        const actionTypeScore = ACTION_TYPE_RISK[action.type] || 50;
        factors.push({
            name: RISK_FACTORS.ACTION_TYPE.name,
            weight: RISK_FACTORS.ACTION_TYPE.weight,
            score: actionTypeScore,
            description: `${action.type} has base risk of ${actionTypeScore}`
        });

        // Factor 2: Target Sensitivity
        const sensitivityScore = this.assessTargetSensitivity(action.target);
        factors.push({
            name: RISK_FACTORS.TARGET_SENSITIVITY.name,
            weight: RISK_FACTORS.TARGET_SENSITIVITY.weight,
            score: sensitivityScore,
            description: sensitivityScore > 50
                ? `Target '${action.target}' is sensitive`
                : `Target '${action.target}' is not particularly sensitive`
        });

        // Factor 3: Reversibility
        const reversibilityScore = action.rollback_possible ? 20 : 80;
        factors.push({
            name: RISK_FACTORS.REVERSIBILITY.name,
            weight: RISK_FACTORS.REVERSIBILITY.weight,
            score: reversibilityScore,
            description: action.rollback_possible
                ? "Action can be rolled back"
                : "Action cannot be easily rolled back"
        });

        // Factor 4: Complexity (based on parameters)
        const complexityScore = this.assessComplexity(action);
        factors.push({
            name: RISK_FACTORS.COMPLEXITY.name,
            weight: RISK_FACTORS.COMPLEXITY.weight,
            score: complexityScore,
            description: complexityScore > 50
                ? "Action has complex parameters"
                : "Action is straightforward"
        });

        // Calculate overall score
        const totalScore = factors.reduce(
            (sum, f) => sum + f.score * f.weight,
            0
        );

        const level = this.scoreToLevel(totalScore);
        const requiresApproval = level !== "low" || !this.config.autoApproveLow;

        return {
            level,
            score: Math.round(totalScore),
            factors,
            summary: this.generateSummary(action, level, totalScore),
            recommendations: this.generateRecommendations(action, factors),
            requiresApproval
        };
    }

    /**
     * Assess risk for a plan
     */
    assessPlan(plan: PlanDraft): RiskAssessment {
        if (plan.actions.length === 0) {
            return {
                level: "low",
                score: 0,
                factors: [],
                summary: "Empty plan has no risk",
                recommendations: [],
                requiresApproval: false
            };
        }

        // Assess each action
        const actionAssessments = plan.actions.map(a => this.assessAction(a));

        // Aggregate factors
        const aggregatedFactors: RiskFactor[] = [];

        // Factor 1: Highest action risk
        const maxActionScore = Math.max(...actionAssessments.map(a => a.score));
        aggregatedFactors.push({
            name: "Highest Action Risk",
            weight: 0.4,
            score: maxActionScore,
            description: `Most risky action has score ${maxActionScore}`
        });

        // Factor 2: Average action risk
        const avgActionScore = actionAssessments.reduce((s, a) => s + a.score, 0) / actionAssessments.length;
        aggregatedFactors.push({
            name: "Average Action Risk",
            weight: 0.25,
            score: avgActionScore,
            description: `Average action risk is ${Math.round(avgActionScore)}`
        });

        // Factor 3: Scope (number of actions)
        const scopeScore = Math.min(plan.actions.length * 10, 100);
        aggregatedFactors.push({
            name: RISK_FACTORS.SCOPE.name,
            weight: RISK_FACTORS.SCOPE.weight,
            score: scopeScore,
            description: `Plan has ${plan.actions.length} actions`
        });

        // Factor 4: Overall reversibility
        const nonReversibleCount = plan.actions.filter(a => !a.rollback_possible).length;
        const reversibilityScore = (nonReversibleCount / plan.actions.length) * 100;
        aggregatedFactors.push({
            name: "Non-Reversible Actions",
            weight: 0.2,
            score: reversibilityScore,
            description: `${nonReversibleCount} of ${plan.actions.length} actions cannot be rolled back`
        });

        // Calculate overall score
        const totalScore = aggregatedFactors.reduce(
            (sum, f) => sum + f.score * f.weight,
            0
        );

        const level = this.scoreToLevel(totalScore);
        const requiresApproval = level !== "low" || !this.config.autoApproveLow;

        // Collect all recommendations
        const allRecommendations = new Set<string>();
        for (const assessment of actionAssessments) {
            for (const rec of assessment.recommendations) {
                allRecommendations.add(rec);
            }
        }

        return {
            level,
            score: Math.round(totalScore),
            factors: aggregatedFactors,
            summary: this.generatePlanSummary(plan, level, actionAssessments),
            recommendations: Array.from(allRecommendations),
            requiresApproval
        };
    }

    /**
     * Assess target sensitivity
     */
    private assessTargetSensitivity(target: string): number {
        // Check critical patterns
        for (const pattern of this.config.criticalPatterns) {
            if (pattern.test(target)) {
                return 90;
            }
        }

        // Check sensitive patterns
        for (const pattern of this.config.sensitivePatterns) {
            if (pattern.test(target)) {
                return 70;
            }
        }

        // Check for hidden files
        if (target.includes("/.") || target.startsWith(".")) {
            return 50;
        }

        // Default
        return 20;
    }

    /**
     * Assess action complexity
     */
    private assessComplexity(action: Action): number {
        const params = action.parameters;
        let complexity = 0;

        // Count parameters
        const paramCount = Object.keys(params).length;
        complexity += paramCount * 10;

        // Check for nested objects
        for (const value of Object.values(params)) {
            if (typeof value === "object" && value !== null) {
                complexity += 15;
            }
        }

        // Check for content (large changes)
        if (params.content && typeof params.content === "string") {
            const contentLength = (params.content).length;
            complexity += Math.min(contentLength / 100, 30);
        }

        // Check for shell commands
        if (params.command) {
            complexity += 30;
            const cmd = params.command as string;
            if (cmd.includes("&&") || cmd.includes("|") || cmd.includes(";")) {
                complexity += 20;
            }
        }

        return Math.min(complexity, 100);
    }

    /**
     * Convert score to risk level
     */
    private scoreToLevel(score: number): RiskLevel {
        if (score <= this.config.lowThreshold) {return "low";}
        if (score <= this.config.mediumThreshold) {return "medium";}
        return "high";
    }

    /**
     * Generate action summary
     */
    private generateSummary(
        action: Action,
        level: RiskLevel,
        score: number
    ): string {
        return `${action.type} on '${action.target}' has ${level} risk (score: ${Math.round(score)})`;
    }

    /**
     * Generate plan summary
     */
    private generatePlanSummary(
        plan: PlanDraft,
        level: RiskLevel,
        actionAssessments: RiskAssessment[]
    ): string {
        const highRiskCount = actionAssessments.filter(a => a.level === "high").length;
        const mediumRiskCount = actionAssessments.filter(a => a.level === "medium").length;

        let summary = `Plan with ${plan.actions.length} actions has ${level} overall risk. `;

        if (highRiskCount > 0) {
            summary += `${highRiskCount} high-risk action(s). `;
        }
        if (mediumRiskCount > 0) {
            summary += `${mediumRiskCount} medium-risk action(s). `;
        }

        if (!plan.rollback_possible) {
            summary += "Plan cannot be fully rolled back.";
        }

        return summary.trim();
    }

    /**
     * Generate recommendations
     */
    private generateRecommendations(
        action: Action,
        factors: RiskFactor[]
    ): string[] {
        const recommendations: string[] = [];

        // Action type specific
        if (action.type === "file_delete") {
            recommendations.push("Consider creating a backup before deletion");
        }
        if (action.type === "shell_exec") {
            recommendations.push("Review shell command carefully before execution");
            recommendations.push("Consider running in sandboxed environment");
        }

        // Sensitivity specific
        const sensitivityFactor = factors.find(
            f => f.name === RISK_FACTORS.TARGET_SENSITIVITY.name
        );
        if (sensitivityFactor && sensitivityFactor.score > 50) {
            recommendations.push(`Verify changes to sensitive target: ${action.target}`);
        }

        // Reversibility specific
        if (!action.rollback_possible) {
            recommendations.push("Create checkpoint/backup before non-reversible action");
        }

        return recommendations;
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create risk assessor
 */
export function createRiskAssessor(
    config?: Partial<RiskAssessorConfig>
): RiskAssessor {
    return new RiskAssessor(config);
}

/**
 * Quick risk check for single action
 */
export function quickRiskCheck(action: Action): RiskLevel {
    const assessor = new RiskAssessor();
    return assessor.assessAction(action).level;
}

/**
 * Check if plan is auto-approvable
 */
export function isAutoApprovable(plan: PlanDraft): boolean {
    const assessor = new RiskAssessor({ autoApproveLow: true });
    const assessment = assessor.assessPlan(plan);
    return !assessment.requiresApproval;
}
