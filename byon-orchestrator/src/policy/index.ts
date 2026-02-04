/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON Policy Module
 * ==================
 *
 * Security and policy enforcement for BYON executor.
 *
 * Exports:
 * - ActionWhitelist: Allowed action validation
 * - ForbiddenPathsChecker: Path access control
 * - ForbiddenPatternsChecker: Code pattern detection
 * - RiskAssessmentSystem: Comprehensive risk scoring
 * - ResourceLimitsManager: Resource constraint enforcement
 */

// ============================================================================
// WHITELIST
// ============================================================================

export {
    // Main class
    ActionWhitelist,

    // Types
    type ActionPolicy,
    type WhitelistConfig,
    type WhitelistResult,

    // Factory functions
    createActionWhitelist,
    createStrictWhitelist,
    createPermissiveWhitelist,

    // Quick functions
    isActionAllowed
} from "./whitelist.js";

// ============================================================================
// FORBIDDEN PATHS
// ============================================================================

export {
    // Main class
    ForbiddenPathsChecker,

    // Types
    type PathCheckResult,
    type ForbiddenPathsConfig,

    // Factory functions
    createForbiddenPathsChecker,
    createProjectBoundChecker,

    // Quick functions
    isPathForbidden,

    // Pattern collections
    FORBIDDEN_PATH_PATTERNS
} from "./forbidden-paths.js";

// ============================================================================
// FORBIDDEN PATTERNS
// ============================================================================

export {
    // Main class
    ForbiddenPatternsChecker,

    // Types
    type PatternCheckResult,
    type MatchedPattern,
    type ForbiddenPattern,
    type ForbiddenPatternsConfig,

    // Factory functions
    createForbiddenPatternsChecker,
    createStrictPatternsChecker,

    // Quick functions
    hasForbiddenPatterns,

    // Pattern collections
    FORBIDDEN_PATTERNS
} from "./forbidden-patterns.js";

// ============================================================================
// RISK ASSESSMENT
// ============================================================================

export {
    // Main class
    RiskAssessmentSystem,

    // Types
    type RiskScore,
    type RiskFactorScore,
    type RecommendedConstraints,
    type RiskAssessmentConfig,
    type RiskFactorWeights,

    // Factory functions
    createRiskAssessment,

    // Quick functions
    quickRiskAssessment,
    requiresUserApproval,
    getRecommendedConstraints
} from "./risk-assessment.js";

// ============================================================================
// RESOURCE LIMITS
// ============================================================================

export {
    // Main class
    ResourceLimitsManager,

    // Types
    type ResourceLimits,
    type ResourceUsage,
    type LimitCheckResult,
    type LimitViolation,
    type ResourceUsagePercent,

    // Factory functions
    createResourceLimits,
    getLimitsForRisk,

    // Quick functions
    validatePlanLimits,

    // Constants
    RESOURCE_LIMITS
} from "./resource-limits.js";

// ============================================================================
// COMPOSITE POLICY CHECKER
// ============================================================================

import { Action, PlanDraft, RiskLevel } from "../types/protocol.js";
import { ActionWhitelist, createStrictWhitelist } from "./whitelist.js";
import { ForbiddenPathsChecker, createForbiddenPathsChecker } from "./forbidden-paths.js";
import { ForbiddenPatternsChecker, createStrictPatternsChecker } from "./forbidden-patterns.js";
import { RiskAssessmentSystem, createRiskAssessment, RiskScore } from "./risk-assessment.js";
import { ResourceLimitsManager, createResourceLimits } from "./resource-limits.js";

/**
 * Composite Policy Check Result
 */
export interface CompositePolicyResult {
    /** Overall allowed */
    allowed: boolean;
    /** Whitelist check passed */
    whitelistPassed: boolean;
    /** Path check passed */
    pathCheckPassed: boolean;
    /** Pattern check passed */
    patternCheckPassed: boolean;
    /** Resource limits valid */
    resourceLimitsValid: boolean;
    /** Risk assessment */
    riskAssessment: RiskScore;
    /** Blocked reasons */
    blockedReasons: string[];
}

/**
 * Composite Policy Checker
 *
 * Combines all policy checks into single validation.
 */
export class CompositePolicyChecker {
    private whitelist: ActionWhitelist;
    private pathChecker: ForbiddenPathsChecker;
    private patternChecker: ForbiddenPatternsChecker;
    private riskAssessment: RiskAssessmentSystem;
    private resourceLimits: ResourceLimitsManager;

    constructor(projectRoot?: string, riskLevel: RiskLevel = "medium") {
        this.whitelist = createStrictWhitelist();
        this.pathChecker = createForbiddenPathsChecker({
            projectRoot,
            allowParentAccess: false
        });
        this.patternChecker = createStrictPatternsChecker();
        this.riskAssessment = createRiskAssessment();
        this.resourceLimits = createResourceLimits(riskLevel);
    }

    /**
     * Check plan against all policies
     */
    checkPlan(plan: PlanDraft, codeContent?: Map<string, string>): CompositePolicyResult {
        const blockedReasons: string[] = [];

        // 1. Whitelist check
        const whitelistResult = this.whitelist.checkAll(plan.actions);
        const whitelistPassed = whitelistResult.allAllowed;
        if (!whitelistPassed) {
            for (const action of whitelistResult.blockedActions) {
                blockedReasons.push(`Action blocked: ${action.type} on ${action.target}`);
            }
        }

        // 2. Path check
        const paths = plan.actions.map(a => a.target);
        const pathResult = this.pathChecker.checkAll(paths);
        const pathCheckPassed = pathResult.allAllowed;
        if (!pathCheckPassed) {
            for (const forbidden of pathResult.forbiddenPaths) {
                const result = pathResult.results.get(forbidden);
                blockedReasons.push(`Path forbidden: ${forbidden} (${result?.category})`);
            }
        }

        // 3. Pattern check (if code content provided)
        let patternCheckPassed = true;
        if (codeContent) {
            const snippets = Array.from(codeContent.entries()).map(
                ([path, code]) => ({ code, identifier: path })
            );
            const patternResult = this.patternChecker.checkAll(snippets);
            patternCheckPassed = patternResult.allAllowed;
            if (!patternCheckPassed) {
                blockedReasons.push(
                    `Code contains ${patternResult.totalMatches} forbidden pattern(s)`
                );
            }
        }

        // 4. Risk assessment
        const riskAssessment = this.riskAssessment.assessPlan(plan);

        // 5. Resource limits validation
        const resourceCheck = this.resourceLimits.check();
        const resourceLimitsValid = resourceCheck.withinLimits;
        if (!resourceLimitsValid) {
            for (const violation of resourceCheck.violations) {
                blockedReasons.push(
                    `Resource limit: ${violation.resource} (${violation.current}/${violation.limit})`
                );
            }
        }

        return {
            allowed: whitelistPassed && pathCheckPassed && patternCheckPassed && resourceLimitsValid,
            whitelistPassed,
            pathCheckPassed,
            patternCheckPassed,
            resourceLimitsValid,
            riskAssessment,
            blockedReasons
        };
    }

    /**
     * Check single action
     */
    checkAction(action: Action, codeContent?: string): {
        allowed: boolean;
        reasons: string[];
    } {
        const reasons: string[] = [];

        // Whitelist
        const whitelistResult = this.whitelist.check(action);
        if (!whitelistResult.allowed) {
            reasons.push(whitelistResult.reason);
        }

        // Path
        const pathResult = this.pathChecker.check(action.target);
        if (!pathResult.allowed) {
            reasons.push(pathResult.reason);
        }

        // Pattern (if code provided)
        if (codeContent) {
            const patternResult = this.patternChecker.check(codeContent);
            if (!patternResult.allowed) {
                reasons.push(patternResult.reason);
            }
        }

        return {
            allowed: reasons.length === 0,
            reasons
        };
    }

    /**
     * Get resource limits manager
     */
    getResourceLimits(): ResourceLimitsManager {
        return this.resourceLimits;
    }

    /**
     * Update risk level
     */
    setRiskLevel(level: RiskLevel): void {
        this.resourceLimits.setLimitsFromRisk(level);
    }
}

/**
 * Create composite policy checker
 */
export function createCompositePolicyChecker(
    projectRoot?: string,
    riskLevel: RiskLevel = "medium"
): CompositePolicyChecker {
    return new CompositePolicyChecker(projectRoot, riskLevel);
}
