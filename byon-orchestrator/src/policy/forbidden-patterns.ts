/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Forbidden Code Patterns
 * =======================
 *
 * Defines code patterns that BYON executor cannot generate.
 * Prevents network access, code injection, and dangerous operations.
 *
 * SECURITY: Code containing forbidden patterns is REJECTED.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface PatternCheckResult {
    /** Whether code is allowed */
    allowed: boolean;
    /** Reason for decision */
    reason: string;
    /** Patterns that matched */
    matchedPatterns: MatchedPattern[];
    /** Risk level of matched patterns */
    riskLevel: "low" | "medium" | "high" | "critical";
}

export interface MatchedPattern {
    /** Pattern name */
    name: string;
    /** Category */
    category: string;
    /** Risk level */
    risk: "low" | "medium" | "high" | "critical";
    /** Match location (line, column) */
    location?: { line: number; column: number };
    /** Matched text */
    matchedText: string;
}

export interface ForbiddenPattern {
    /** Pattern name */
    name: string;
    /** Regular expression */
    pattern: RegExp;
    /** Category */
    category: string;
    /** Risk level */
    risk: "low" | "medium" | "high" | "critical";
    /** Description */
    description: string;
}

export interface ForbiddenPatternsConfig {
    /** Check network patterns */
    checkNetwork: boolean;
    /** Check process patterns */
    checkProcess: boolean;
    /** Check eval patterns */
    checkEval: boolean;
    /** Check file system patterns */
    checkFileSystem: boolean;
    /** Custom patterns */
    customPatterns: ForbiddenPattern[];
    /** Patterns to ignore */
    ignorePatterns: string[];
}

// ============================================================================
// FORBIDDEN PATTERNS
// ============================================================================

/**
 * Network access patterns
 */
const NETWORK_PATTERNS: ForbiddenPattern[] = [
    {
        name: "fetch_api",
        pattern: /\bfetch\s*\(/gi,
        category: "network",
        risk: "critical",
        description: "Fetch API for HTTP requests"
    },
    {
        name: "xmlhttprequest",
        pattern: /\bXMLHttpRequest\b/gi,
        category: "network",
        risk: "critical",
        description: "XMLHttpRequest for HTTP requests"
    },
    {
        name: "axios",
        pattern: /\baxios\s*[.(]/gi,
        category: "network",
        risk: "critical",
        description: "Axios HTTP client"
    },
    {
        name: "http_request",
        pattern: /\bhttp\.request\s*\(/gi,
        category: "network",
        risk: "critical",
        description: "Node.js http.request"
    },
    {
        name: "https_request",
        pattern: /\bhttps\.request\s*\(/gi,
        category: "network",
        risk: "critical",
        description: "Node.js https.request"
    },
    {
        name: "http_get",
        pattern: /\bhttps?\.get\s*\(/gi,
        category: "network",
        risk: "critical",
        description: "Node.js http/https.get"
    },
    {
        name: "socket",
        pattern: /\bnew\s+(?:Web)?Socket\s*\(/gi,
        category: "network",
        risk: "critical",
        description: "WebSocket or Socket connection"
    },
    {
        name: "net_connect",
        pattern: /\bnet\.(?:connect|createConnection)\s*\(/gi,
        category: "network",
        risk: "critical",
        description: "Node.js net module connection"
    },
    {
        name: "request_library",
        pattern: /\brequire\s*\(\s*['"]request['"]\s*\)/gi,
        category: "network",
        risk: "critical",
        description: "Request library import"
    },
    {
        name: "got_library",
        pattern: /\brequire\s*\(\s*['"]got['"]\s*\)/gi,
        category: "network",
        risk: "critical",
        description: "Got library import"
    },
    {
        name: "node_fetch",
        pattern: /\brequire\s*\(\s*['"]node-fetch['"]\s*\)/gi,
        category: "network",
        risk: "critical",
        description: "Node-fetch import"
    }
];

/**
 * Process execution patterns
 */
const PROCESS_PATTERNS: ForbiddenPattern[] = [
    {
        name: "exec",
        pattern: /\bexec\s*\(/gi,
        category: "process",
        risk: "critical",
        description: "Execute shell command"
    },
    {
        name: "execSync",
        pattern: /\bexecSync\s*\(/gi,
        category: "process",
        risk: "critical",
        description: "Execute shell command synchronously"
    },
    {
        name: "spawn",
        pattern: /\bspawn\s*\(/gi,
        category: "process",
        risk: "high",
        description: "Spawn child process"
    },
    {
        name: "spawnSync",
        pattern: /\bspawnSync\s*\(/gi,
        category: "process",
        risk: "high",
        description: "Spawn child process synchronously"
    },
    {
        name: "fork",
        pattern: /\bfork\s*\(/gi,
        category: "process",
        risk: "high",
        description: "Fork child process"
    },
    {
        name: "execFile",
        pattern: /\bexecFile(?:Sync)?\s*\(/gi,
        category: "process",
        risk: "critical",
        description: "Execute file"
    },
    {
        name: "child_process_require",
        pattern: /\brequire\s*\(\s*['"]child_process['"]\s*\)/gi,
        category: "process",
        risk: "critical",
        description: "Child process module import"
    },
    {
        name: "child_process_import",
        pattern: /\bimport\s+.*\s+from\s+['"]child_process['"]/gi,
        category: "process",
        risk: "critical",
        description: "Child process ES module import"
    },
    {
        name: "shelljs",
        pattern: /\brequire\s*\(\s*['"]shelljs['"]\s*\)/gi,
        category: "process",
        risk: "critical",
        description: "ShellJS import"
    }
];

/**
 * Code evaluation patterns
 */
const EVAL_PATTERNS: ForbiddenPattern[] = [
    {
        name: "eval",
        pattern: /\beval\s*\(/gi,
        category: "eval",
        risk: "critical",
        description: "Eval function"
    },
    {
        name: "function_constructor",
        pattern: /\bnew\s+Function\s*\(/gi,
        category: "eval",
        risk: "critical",
        description: "Function constructor"
    },
    {
        name: "setTimeout_string",
        pattern: /\bsetTimeout\s*\(\s*['"`]/gi,
        category: "eval",
        risk: "high",
        description: "setTimeout with string (eval-like)"
    },
    {
        name: "setInterval_string",
        pattern: /\bsetInterval\s*\(\s*['"`]/gi,
        category: "eval",
        risk: "high",
        description: "setInterval with string (eval-like)"
    },
    {
        name: "vm_runInContext",
        pattern: /\bvm\.run(?:InContext|InNewContext|InThisContext)\s*\(/gi,
        category: "eval",
        risk: "critical",
        description: "VM module code execution"
    },
    {
        name: "vm_require",
        pattern: /\brequire\s*\(\s*['"]vm['"]\s*\)/gi,
        category: "eval",
        risk: "high",
        description: "VM module import"
    }
];

/**
 * Path traversal patterns
 */
const TRAVERSAL_PATTERNS: ForbiddenPattern[] = [
    {
        name: "dot_dot_slash",
        pattern: /\.\.\//g,
        category: "traversal",
        risk: "high",
        description: "Path traversal with ../"
    },
    {
        name: "dot_dot_backslash",
        pattern: /\.\.\\/g,
        category: "traversal",
        risk: "high",
        description: "Path traversal with ..\\"
    },
    {
        name: "encoded_traversal",
        pattern: /%2e%2e[/\\]/gi,
        category: "traversal",
        risk: "high",
        description: "URL-encoded path traversal"
    }
];

/**
 * Dangerous file operations
 */
const FILE_SYSTEM_PATTERNS: ForbiddenPattern[] = [
    {
        name: "unlink_sync",
        pattern: /\bunlinkSync\s*\(/gi,
        category: "filesystem",
        risk: "high",
        description: "Synchronous file deletion"
    },
    {
        name: "rmdir_sync",
        pattern: /\brmdirSync\s*\(/gi,
        category: "filesystem",
        risk: "high",
        description: "Synchronous directory deletion"
    },
    {
        name: "rm_rf",
        pattern: /\brm\s*\(\s*.*,\s*\{\s*(?:recursive|force)/gi,
        category: "filesystem",
        risk: "critical",
        description: "Recursive file deletion"
    },
    {
        name: "chmod",
        pattern: /\bchmod(?:Sync)?\s*\(/gi,
        category: "filesystem",
        risk: "medium",
        description: "Change file permissions"
    },
    {
        name: "chown",
        pattern: /\bchown(?:Sync)?\s*\(/gi,
        category: "filesystem",
        risk: "medium",
        description: "Change file ownership"
    }
];

// ============================================================================
// FORBIDDEN PATTERNS CHECKER
// ============================================================================

const DEFAULT_CONFIG: ForbiddenPatternsConfig = {
    checkNetwork: true,
    checkProcess: true,
    checkEval: true,
    checkFileSystem: true,
    customPatterns: [],
    ignorePatterns: []
};

/**
 * Forbidden Patterns Checker
 *
 * Validates code against forbidden patterns.
 */
export class ForbiddenPatternsChecker {
    private config: ForbiddenPatternsConfig;
    private patterns: ForbiddenPattern[];

    constructor(config: Partial<ForbiddenPatternsConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.patterns = [];

        this.initializePatterns();
    }

    /**
     * Initialize patterns
     */
    private initializePatterns(): void {
        if (this.config.checkNetwork) {
            this.patterns.push(...NETWORK_PATTERNS);
        }

        if (this.config.checkProcess) {
            this.patterns.push(...PROCESS_PATTERNS);
        }

        if (this.config.checkEval) {
            this.patterns.push(...EVAL_PATTERNS);
        }

        if (this.config.checkFileSystem) {
            this.patterns.push(...FILE_SYSTEM_PATTERNS);
        }

        // Always check traversal
        this.patterns.push(...TRAVERSAL_PATTERNS);

        // Add custom patterns
        this.patterns.push(...this.config.customPatterns);

        // Remove ignored patterns
        if (this.config.ignorePatterns.length > 0) {
            this.patterns = this.patterns.filter(
                p => !this.config.ignorePatterns.includes(p.name)
            );
        }
    }

    /**
     * Check code for forbidden patterns
     */
    check(code: string): PatternCheckResult {
        const matchedPatterns: MatchedPattern[] = [];
        let highestRisk: "low" | "medium" | "high" | "critical" = "low";

        const riskOrder = { low: 0, medium: 1, high: 2, critical: 3 };

        for (const forbiddenPattern of this.patterns) {
            // Reset regex
            forbiddenPattern.pattern.lastIndex = 0;

            let match;
            while ((match = forbiddenPattern.pattern.exec(code)) !== null) {
                // Calculate line and column
                const beforeMatch = code.substring(0, match.index);
                const lines = beforeMatch.split("\n");
                const line = lines.length;
                const column = lines[lines.length - 1].length + 1;

                matchedPatterns.push({
                    name: forbiddenPattern.name,
                    category: forbiddenPattern.category,
                    risk: forbiddenPattern.risk,
                    location: { line, column },
                    matchedText: match[0]
                });

                if (riskOrder[forbiddenPattern.risk] > riskOrder[highestRisk]) {
                    highestRisk = forbiddenPattern.risk;
                }
            }
        }

        const allowed = matchedPatterns.length === 0;

        return {
            allowed,
            reason: allowed
                ? "No forbidden patterns found"
                : `Found ${matchedPatterns.length} forbidden pattern(s)`,
            matchedPatterns,
            riskLevel: allowed ? "low" : highestRisk
        };
    }

    /**
     * Check multiple code snippets
     */
    checkAll(codeSnippets: Array<{ code: string; identifier: string }>): {
        allAllowed: boolean;
        results: Map<string, PatternCheckResult>;
        totalMatches: number;
        highestRisk: "low" | "medium" | "high" | "critical";
    } {
        const results = new Map<string, PatternCheckResult>();
        let totalMatches = 0;
        let highestRisk: "low" | "medium" | "high" | "critical" = "low";

        const riskOrder = { low: 0, medium: 1, high: 2, critical: 3 };

        for (const { code, identifier } of codeSnippets) {
            const result = this.check(code);
            results.set(identifier, result);
            totalMatches += result.matchedPatterns.length;

            if (riskOrder[result.riskLevel] > riskOrder[highestRisk]) {
                highestRisk = result.riskLevel;
            }
        }

        return {
            allAllowed: totalMatches === 0,
            results,
            totalMatches,
            highestRisk
        };
    }

    /**
     * Add custom pattern
     */
    addPattern(pattern: ForbiddenPattern): void {
        this.patterns.push(pattern);
    }

    /**
     * Get patterns by category
     */
    getPatternsByCategory(category: string): ForbiddenPattern[] {
        return this.patterns.filter(p => p.category === category);
    }

    /**
     * Get patterns by risk level
     */
    getPatternsByRisk(risk: "low" | "medium" | "high" | "critical"): ForbiddenPattern[] {
        return this.patterns.filter(p => p.risk === risk);
    }

    /**
     * Get all categories
     */
    getCategories(): string[] {
        return [...new Set(this.patterns.map(p => p.category))];
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create forbidden patterns checker
 */
export function createForbiddenPatternsChecker(
    config?: Partial<ForbiddenPatternsConfig>
): ForbiddenPatternsChecker {
    return new ForbiddenPatternsChecker(config);
}

/**
 * Create strict checker (all patterns enabled)
 */
export function createStrictPatternsChecker(): ForbiddenPatternsChecker {
    return new ForbiddenPatternsChecker({
        checkNetwork: true,
        checkProcess: true,
        checkEval: true,
        checkFileSystem: true
    });
}

/**
 * Quick check if code contains forbidden patterns
 */
export function hasForbiddenPatterns(code: string): boolean {
    const checker = createStrictPatternsChecker();
    return !checker.check(code).allowed;
}

/**
 * Get all forbidden patterns
 */
export const FORBIDDEN_PATTERNS = {
    NETWORK: NETWORK_PATTERNS,
    PROCESS: PROCESS_PATTERNS,
    EVAL: EVAL_PATTERNS,
    TRAVERSAL: TRAVERSAL_PATTERNS,
    FILE_SYSTEM: FILE_SYSTEM_PATTERNS
};
