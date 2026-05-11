/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Security Checker
 * ================
 *
 * Performs security checks on PlanDraft before approval.
 * Validates actions against security policies.
 *
 * Checks:
 * - Forbidden patterns (secrets, credentials)
 * - Dangerous commands (rm -rf, sudo)
 * - Path traversal attempts
 * - Injection vulnerabilities
 * - Resource limits
 */

import {
    PlanDraft,
    Action,
    SecurityCheck
} from "../types/protocol.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface SecurityCheckConfig {
    /** Enable forbidden pattern check */
    checkForbiddenPatterns: boolean;
    /** Enable dangerous command check */
    checkDangerousCommands: boolean;
    /** Enable path traversal check */
    checkPathTraversal: boolean;
    /** Enable injection check */
    checkInjection: boolean;
    /** Enable resource limit check */
    checkResourceLimits: boolean;
    /** Custom forbidden patterns */
    customForbiddenPatterns: RegExp[];
    /** Custom allowed paths */
    allowedPaths: string[];
    /** Maximum content size (bytes) */
    maxContentSize: number;
}

const DEFAULT_CONFIG: SecurityCheckConfig = {
    checkForbiddenPatterns: true,
    checkDangerousCommands: true,
    checkPathTraversal: true,
    checkInjection: true,
    checkResourceLimits: true,
    customForbiddenPatterns: [],
    allowedPaths: [],
    maxContentSize: 1024 * 1024 // 1MB
};

// ============================================================================
// SECURITY PATTERNS
// ============================================================================

const FORBIDDEN_PATTERNS = [
    // Secrets and credentials
    { pattern: /password\s*[:=]\s*["'][^"']+["']/gi, name: "hardcoded_password" },
    { pattern: /api[_-]?key\s*[:=]\s*["'][^"']+["']/gi, name: "api_key" },
    { pattern: /secret\s*[:=]\s*["'][^"']+["']/gi, name: "secret" },
    { pattern: /private[_-]?key/gi, name: "private_key" },
    { pattern: /-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH)\s+PRIVATE\s+KEY-----/i, name: "pem_key" },
    { pattern: /bearer\s+[A-Za-z0-9\-_.~+/]+=*/i, name: "bearer_token" },

    // AWS credentials
    { pattern: /AKIA[0-9A-Z]{16}/g, name: "aws_access_key" },
    { pattern: /aws_secret_access_key/gi, name: "aws_secret" },

    // Database credentials
    { pattern: /mongodb(\+srv)?:\/\/[^@\s]+:[^@\s]+@/gi, name: "mongodb_uri" },
    { pattern: /postgres(ql)?:\/\/[^@\s]+:[^@\s]+@/gi, name: "postgres_uri" },
    { pattern: /mysql:\/\/[^@\s]+:[^@\s]+@/gi, name: "mysql_uri" },

    // GitHub tokens
    { pattern: /ghp_[A-Za-z0-9_]{36}/g, name: "github_pat" },
    { pattern: /gho_[A-Za-z0-9_]{36}/g, name: "github_oauth" },

    // Social security / personal info
    { pattern: /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g, name: "ssn_like" }
];

const DANGEROUS_COMMANDS = [
    // Destructive commands
    { pattern: /rm\s+-rf?\s+[\/~]/gi, name: "rm_recursive" },
    { pattern: /rmdir\s+[\/~]/gi, name: "rmdir_root" },
    { pattern: /del\s+\/[sq]/gi, name: "del_quiet" },
    { pattern: /format\s+[a-z]:/gi, name: "format_drive" },

    // Privilege escalation
    { pattern: /sudo\s+/gi, name: "sudo" },
    { pattern: /chmod\s+777/gi, name: "chmod_777" },
    { pattern: /chown\s+root/gi, name: "chown_root" },

    // Network commands
    { pattern: /curl\s+.*\|\s*(?:ba)?sh/gi, name: "curl_pipe_shell" },
    { pattern: /wget\s+.*\|\s*(?:ba)?sh/gi, name: "wget_pipe_shell" },

    // System commands
    { pattern: /shutdown/gi, name: "shutdown" },
    { pattern: /reboot/gi, name: "reboot" },
    { pattern: /init\s+[06]/gi, name: "init_shutdown" },

    // Dangerous npm/node
    { pattern: /npm\s+.*--unsafe-perm/gi, name: "npm_unsafe" },
    { pattern: /node\s+.*--no-sandbox/gi, name: "node_no_sandbox" }
];

const PATH_TRAVERSAL_PATTERNS = [
    { pattern: /\.\.\//g, name: "dot_dot_slash" },
    { pattern: /\.\.\\+/g, name: "dot_dot_backslash" },
    { pattern: /%2e%2e[\\/]/gi, name: "encoded_traversal" },
    { pattern: /\/etc\/(?:passwd|shadow|hosts)/gi, name: "system_files" },
    { pattern: /[cC]:\\[wW]indows/g, name: "windows_system" }
];

const INJECTION_PATTERNS = [
    // Command injection
    { pattern: /;\s*(?:rm|del|wget|curl|bash|sh|cmd)/gi, name: "command_injection" },
    { pattern: /\$\([^)]+\)/g, name: "command_substitution" },
    { pattern: /`[^`]+`/g, name: "backtick_execution" },

    // SQL injection (in case of dynamic queries)
    { pattern: /['"];\s*(?:DROP|DELETE|UPDATE|INSERT)/gi, name: "sql_injection" },
    { pattern: /UNION\s+SELECT/gi, name: "sql_union" },

    // Template injection
    { pattern: /\{\{.*\}\}/g, name: "template_injection" },
    { pattern: /<%.*%>/g, name: "ejs_injection" }
];

// ============================================================================
// SECURITY CHECKER
// ============================================================================

/**
 * Security Checker
 *
 * Performs security validation on plans and actions.
 */
export class SecurityChecker {
    private config: SecurityCheckConfig;

    constructor(config: Partial<SecurityCheckConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Run all security checks on a plan
     */
    checkPlan(plan: PlanDraft): SecurityCheck[] {
        const checks: SecurityCheck[] = [];

        // Check each action
        for (const action of plan.actions) {
            checks.push(...this.checkAction(action));
        }

        // Check overall plan properties
        checks.push(this.checkPlanScope(plan));

        return checks;
    }

    /**
     * Run security checks on a single action
     */
    checkAction(action: Action): SecurityCheck[] {
        const checks: SecurityCheck[] = [];

        // Get content to check
        const contentToCheck = this.getActionContent(action);

        // Run enabled checks
        if (this.config.checkForbiddenPatterns) {
            checks.push(this.checkForbiddenPatterns(contentToCheck, action.action_id));
        }

        if (this.config.checkDangerousCommands && action.type === "shell_exec") {
            checks.push(this.checkDangerousCommands(contentToCheck, action.action_id));
        }

        if (this.config.checkPathTraversal) {
            checks.push(this.checkPathTraversal(action.target, action.action_id));
        }

        if (this.config.checkInjection) {
            checks.push(this.checkInjection(contentToCheck, action.action_id));
        }

        if (this.config.checkResourceLimits) {
            checks.push(this.checkResourceLimits(contentToCheck, action.action_id));
        }

        return checks;
    }

    /**
     * Check for forbidden patterns
     */
    checkForbiddenPatterns(content: string, actionId: string): SecurityCheck {
        const allPatterns = [
            ...FORBIDDEN_PATTERNS,
            ...this.config.customForbiddenPatterns.map((p, i) => ({
                pattern: p,
                name: `custom_${i}`
            }))
        ];

        const violations: string[] = [];

        for (const { pattern, name } of allPatterns) {
            pattern.lastIndex = 0;
            if (pattern.test(content)) {
                violations.push(name);
            }
        }

        return {
            check_type: "forbidden_patterns",
            passed: violations.length === 0,
            details: violations.length > 0
                ? `Action ${actionId}: Found forbidden patterns: ${violations.join(", ")}`
                : `Action ${actionId}: No forbidden patterns found`
        };
    }

    /**
     * Check for dangerous commands
     */
    checkDangerousCommands(content: string, actionId: string): SecurityCheck {
        const violations: string[] = [];

        for (const { pattern, name } of DANGEROUS_COMMANDS) {
            pattern.lastIndex = 0;
            if (pattern.test(content)) {
                violations.push(name);
            }
        }

        return {
            check_type: "dangerous_commands",
            passed: violations.length === 0,
            details: violations.length > 0
                ? `Action ${actionId}: Dangerous commands detected: ${violations.join(", ")}`
                : `Action ${actionId}: No dangerous commands found`
        };
    }

    /**
     * Check for path traversal
     */
    checkPathTraversal(path: string, actionId: string): SecurityCheck {
        const violations: string[] = [];

        for (const { pattern, name } of PATH_TRAVERSAL_PATTERNS) {
            pattern.lastIndex = 0;
            if (pattern.test(path)) {
                violations.push(name);
            }
        }

        // Check allowed paths if configured
        if (this.config.allowedPaths.length > 0) {
            const isAllowed = this.config.allowedPaths.some(
                allowed => path.startsWith(allowed)
            );
            if (!isAllowed) {
                violations.push("path_not_allowed");
            }
        }

        return {
            check_type: "path_traversal",
            passed: violations.length === 0,
            details: violations.length > 0
                ? `Action ${actionId}: Path security issues: ${violations.join(", ")}`
                : `Action ${actionId}: Path is safe`
        };
    }

    /**
     * Check for injection vulnerabilities
     */
    checkInjection(content: string, actionId: string): SecurityCheck {
        const violations: string[] = [];

        for (const { pattern, name } of INJECTION_PATTERNS) {
            pattern.lastIndex = 0;
            if (pattern.test(content)) {
                violations.push(name);
            }
        }

        return {
            check_type: "injection",
            passed: violations.length === 0,
            details: violations.length > 0
                ? `Action ${actionId}: Potential injection: ${violations.join(", ")}`
                : `Action ${actionId}: No injection patterns found`
        };
    }

    /**
     * Check resource limits
     */
    checkResourceLimits(content: string, actionId: string): SecurityCheck {
        const contentSize = Buffer.byteLength(content, "utf8");
        const passed = contentSize <= this.config.maxContentSize;

        return {
            check_type: "resource_limits",
            passed,
            details: passed
                ? `Action ${actionId}: Content size (${contentSize} bytes) within limits`
                : `Action ${actionId}: Content size (${contentSize} bytes) exceeds limit (${this.config.maxContentSize})`
        };
    }

    /**
     * Check plan scope
     */
    checkPlanScope(plan: PlanDraft): SecurityCheck {
        const issues: string[] = [];

        // Check number of actions
        if (plan.actions.length > 50) {
            issues.push(`Too many actions: ${plan.actions.length}`);
        }

        // Check for mixed high-risk actions
        const highRiskActions = plan.actions.filter(a => a.estimated_risk === "high");
        if (highRiskActions.length > 5) {
            issues.push(`Too many high-risk actions: ${highRiskActions.length}`);
        }

        // Check for non-reversible deletions
        const nonReversibleDeletes = plan.actions.filter(
            a => a.type === "file_delete" && !a.rollback_possible
        );
        if (nonReversibleDeletes.length > 0) {
            issues.push(`Non-reversible deletions: ${nonReversibleDeletes.length}`);
        }

        return {
            check_type: "plan_scope",
            passed: issues.length === 0,
            details: issues.length > 0
                ? `Plan scope issues: ${issues.join("; ")}`
                : "Plan scope is acceptable"
        };
    }

    /**
     * Get content from action for checking
     */
    private getActionContent(action: Action): string {
        const parts: string[] = [action.target];

        // Add parameter values
        for (const [key, value] of Object.entries(action.parameters)) {
            if (typeof value === "string") {
                parts.push(value);
            } else if (value !== null && value !== undefined) {
                parts.push(JSON.stringify(value));
            }
        }

        return parts.join("\n");
    }

    /**
     * Quick security check (returns boolean)
     */
    quickCheck(plan: PlanDraft): boolean {
        const checks = this.checkPlan(plan);
        return checks.every(c => c.passed);
    }

    /**
     * Get security summary
     */
    getSummary(checks: SecurityCheck[]): {
        passed: number;
        failed: number;
        total: number;
        allPassed: boolean;
        failedChecks: SecurityCheck[];
    } {
        const passed = checks.filter(c => c.passed).length;
        const failed = checks.filter(c => !c.passed).length;

        return {
            passed,
            failed,
            total: checks.length,
            allPassed: failed === 0,
            failedChecks: checks.filter(c => !c.passed)
        };
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create security checker
 */
export function createSecurityChecker(
    config?: Partial<SecurityCheckConfig>
): SecurityChecker {
    return new SecurityChecker(config);
}

/**
 * Quick security validation
 */
export function validatePlanSecurity(plan: PlanDraft): boolean {
    const checker = new SecurityChecker();
    return checker.quickCheck(plan);
}

/**
 * Get security report for plan
 */
export function getSecurityReport(plan: PlanDraft): {
    checks: SecurityCheck[];
    summary: {
        passed: number;
        failed: number;
        allPassed: boolean;
    };
} {
    const checker = new SecurityChecker();
    const checks = checker.checkPlan(plan);
    const summary = checker.getSummary(checks);

    return {
        checks,
        summary: {
            passed: summary.passed,
            failed: summary.failed,
            allPassed: summary.allPassed
        }
    };
}
