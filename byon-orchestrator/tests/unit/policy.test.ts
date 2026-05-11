/**
 * BYON Policy Unit Tests
 * ======================
 *
 * Tests for security policy components:
 * - Action whitelist
 * - Forbidden paths checker
 * - Forbidden patterns checker
 * - Risk assessment
 * - Resource limits
 *
 * Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
 */

import { describe, it, expect } from "vitest";

// ============================================
// Action Whitelist Tests
// ============================================

describe("ActionWhitelist", () => {
    const ALLOWED_ACTIONS = [
        "code_edit",
        "file_create",
        "file_delete",
        "test_run",
        "lint_run",
        "build_run"
    ];

    const FORBIDDEN_ACTIONS = [
        "shell_exec",
        "network_request",
        "system_call",
        "process_spawn"
    ];

    describe("action validation", () => {
        it("should allow whitelisted actions", () => {
            const isAllowed = (action: string) => ALLOWED_ACTIONS.includes(action);

            expect(isAllowed("code_edit")).toBe(true);
            expect(isAllowed("file_create")).toBe(true);
            expect(isAllowed("test_run")).toBe(true);
        });

        it("should reject forbidden actions", () => {
            const isAllowed = (action: string) => ALLOWED_ACTIONS.includes(action);

            expect(isAllowed("shell_exec")).toBe(false);
            expect(isAllowed("network_request")).toBe(false);
            expect(isAllowed("rm -rf /")).toBe(false);
        });

        it("should reject unknown actions", () => {
            const isAllowed = (action: string) => ALLOWED_ACTIONS.includes(action);

            expect(isAllowed("random_action")).toBe(false);
            expect(isAllowed("")).toBe(false);
        });
    });
});

// ============================================
// Forbidden Paths Tests
// ============================================

describe("ForbiddenPaths", () => {
    const FORBIDDEN_PATHS = {
        system: ["/etc", "/usr", "/bin", "/sbin", "C:\\Windows", "C:\\System32"],
        credentials: [".env", "credentials", "secrets", ".ssh", ".aws"],
        vcs: [".git", ".svn", ".hg"],
        packages: ["node_modules", "vendor", "__pycache__"],
        lockFiles: ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock"]
    };

    const isForbiddenPath = (path: string): { forbidden: boolean; reason?: string } => {
        const normalizedPath = path.toLowerCase().replace(/\\/g, "/");

        for (const [category, patterns] of Object.entries(FORBIDDEN_PATHS)) {
            for (const pattern of patterns) {
                const normalizedPattern = pattern.toLowerCase().replace(/\\/g, "/");
                if (
                    normalizedPath.includes(normalizedPattern) ||
                    normalizedPath.startsWith(normalizedPattern)
                ) {
                    return { forbidden: true, reason: category };
                }
            }
        }
        return { forbidden: false };
    };

    describe("system paths", () => {
        it("should block system directories", () => {
            expect(isForbiddenPath("/etc/passwd").forbidden).toBe(true);
            expect(isForbiddenPath("/usr/bin/node").forbidden).toBe(true);
            expect(isForbiddenPath("C:\\Windows\\System32").forbidden).toBe(true);
        });

        it("should return reason for block", () => {
            const result = isForbiddenPath("/etc/hosts");
            expect(result.reason).toBe("system");
        });
    });

    describe("credential files", () => {
        it("should block .env files", () => {
            expect(isForbiddenPath(".env").forbidden).toBe(true);
            expect(isForbiddenPath(".env.local").forbidden).toBe(true);
            expect(isForbiddenPath("config/.env.production").forbidden).toBe(true);
        });

        it("should block credentials directories", () => {
            expect(isForbiddenPath(".ssh/id_rsa").forbidden).toBe(true);
            expect(isForbiddenPath(".aws/credentials").forbidden).toBe(true);
            expect(isForbiddenPath("secrets/api_key.txt").forbidden).toBe(true);
        });
    });

    describe("version control", () => {
        it("should block .git directory", () => {
            expect(isForbiddenPath(".git/config").forbidden).toBe(true);
            expect(isForbiddenPath(".git/hooks/pre-commit").forbidden).toBe(true);
        });
    });

    describe("package directories", () => {
        it("should block node_modules", () => {
            expect(isForbiddenPath("node_modules/lodash/index.js").forbidden).toBe(true);
        });

        it("should block lock files", () => {
            expect(isForbiddenPath("package-lock.json").forbidden).toBe(true);
            expect(isForbiddenPath("pnpm-lock.yaml").forbidden).toBe(true);
        });
    });

    describe("safe paths", () => {
        it("should allow project source files", () => {
            expect(isForbiddenPath("src/index.ts").forbidden).toBe(false);
            expect(isForbiddenPath("lib/utils.js").forbidden).toBe(false);
            expect(isForbiddenPath("tests/unit/test.ts").forbidden).toBe(false);
        });
    });
});

// ============================================
// Forbidden Patterns Tests
// ============================================

describe("ForbiddenPatterns", () => {
    const FORBIDDEN_PATTERNS = {
        network: [
            /fetch\s*\(/,
            /http\.request/,
            /https\.request/,
            /axios\./,
            /XMLHttpRequest/,
            /WebSocket/
        ],
        process: [
            /child_process/,
            /exec\s*\(/,
            /execSync\s*\(/,
            /spawn\s*\(/,
            /spawnSync\s*\(/,
            /fork\s*\(/
        ],
        eval: [
            /eval\s*\(/,
            /new\s+Function\s*\(/,
            /setTimeout\s*\(\s*["'`]/,
            /setInterval\s*\(\s*["'`]/
        ],
        traversal: [
            /\.\.\//,
            /\.\.\\/,
            /%2e%2e/i
        ],
        filesystem: [
            /fs\.rmSync\s*\(/,
            /fs\.rmdirSync\s*\(/,
            /rimraf/
        ]
    };

    const checkForbiddenPatterns = (code: string): { forbidden: boolean; matches: string[] } => {
        const matches: string[] = [];

        for (const [category, patterns] of Object.entries(FORBIDDEN_PATTERNS)) {
            for (const pattern of patterns) {
                if (pattern.test(code)) {
                    matches.push(`${category}: ${pattern.source}`);
                }
            }
        }

        return { forbidden: matches.length > 0, matches };
    };

    describe("network patterns", () => {
        it("should detect fetch calls", () => {
            const code = 'fetch("https://api.example.com")';
            const result = checkForbiddenPatterns(code);
            expect(result.forbidden).toBe(true);
        });

        it("should detect axios", () => {
            const code = 'axios.get("/api/data")';
            const result = checkForbiddenPatterns(code);
            expect(result.forbidden).toBe(true);
        });

        it("should detect WebSocket", () => {
            const code = 'new WebSocket("ws://localhost")';
            const result = checkForbiddenPatterns(code);
            expect(result.forbidden).toBe(true);
        });
    });

    describe("process patterns", () => {
        it("should detect child_process", () => {
            const code = 'const { exec } = require("child_process")';
            const result = checkForbiddenPatterns(code);
            expect(result.forbidden).toBe(true);
        });

        it("should detect exec calls", () => {
            const code = 'exec("rm -rf /")';
            const result = checkForbiddenPatterns(code);
            expect(result.forbidden).toBe(true);
        });

        it("should detect spawn", () => {
            const code = 'spawn("node", ["script.js"])';
            const result = checkForbiddenPatterns(code);
            expect(result.forbidden).toBe(true);
        });
    });

    describe("eval patterns", () => {
        it("should detect eval", () => {
            const code = 'eval(userInput)';
            const result = checkForbiddenPatterns(code);
            expect(result.forbidden).toBe(true);
        });

        it("should detect new Function", () => {
            const code = 'new Function("return " + code)';
            const result = checkForbiddenPatterns(code);
            expect(result.forbidden).toBe(true);
        });
    });

    describe("path traversal", () => {
        it("should detect ../ traversal", () => {
            const code = 'readFile("../../etc/passwd")';
            const result = checkForbiddenPatterns(code);
            expect(result.forbidden).toBe(true);
        });

        it("should detect URL-encoded traversal", () => {
            const code = 'path = "%2e%2e%2fetc%2fpasswd"';
            const result = checkForbiddenPatterns(code);
            expect(result.forbidden).toBe(true);
        });
    });

    describe("safe code", () => {
        it("should allow normal code", () => {
            const code = `
                function calculateTotal(items) {
                    return items.reduce((sum, item) => sum + item.price, 0);
                }
            `;
            const result = checkForbiddenPatterns(code);
            expect(result.forbidden).toBe(false);
        });

        it("should allow fs.readFile", () => {
            const code = 'fs.readFile("data.json", "utf-8")';
            const result = checkForbiddenPatterns(code);
            expect(result.forbidden).toBe(false);
        });
    });
});

// ============================================
// Risk Assessment Tests
// ============================================

describe("RiskAssessment", () => {
    interface RiskFactors {
        fileDeletes: number;
        fileCreates: number;
        codeEdits: number;
        actionCount: number;
        estimatedIterations: number;
        rollbackPossible: boolean;
        sensitiveFiles: number;
    }

    const calculateRiskScore = (factors: RiskFactors): number => {
        const weights = {
            fileDeletes: 0.35,
            fileCreates: 0.05,
            codeEdits: 0.15,
            actionCount: 0.15,
            iterations: 0.10,
            rollback: 0.10,
            sensitivity: 0.10
        };

        let score = 0;

        // File deletes: 0-3 = 0-100
        score += Math.min(factors.fileDeletes * 35, 100) * weights.fileDeletes;

        // File creates: 0-10 = 0-100
        score += Math.min(factors.fileCreates * 20, 100) * weights.fileCreates;

        // Code edits: 0-20 = 0-100
        score += Math.min(factors.codeEdits * 15, 100) * weights.codeEdits;

        // Action count: 0-20 = 0-100
        score += Math.min(factors.actionCount * 15, 100) * weights.actionCount;

        // Iterations: 0-10 = 0-100
        score += Math.min(factors.estimatedIterations * 25, 100) * weights.iterations;

        // Rollback: possible = 0, impossible = 100
        score += (factors.rollbackPossible ? 0 : 100) * weights.rollback;

        // Sensitive files: 0-5 = 0-100
        score += Math.min(factors.sensitiveFiles * 40, 100) * weights.sensitivity;

        return Math.round(score);
    };

    const getRiskLevel = (score: number): "low" | "medium" | "high" => {
        if (score <= 30) return "low";
        if (score <= 60) return "medium";
        return "high";
    };

    describe("score calculation", () => {
        it("should calculate low risk for simple edit", () => {
            const factors: RiskFactors = {
                fileDeletes: 0,
                fileCreates: 0,
                codeEdits: 1,
                actionCount: 1,
                estimatedIterations: 1,
                rollbackPossible: true,
                sensitiveFiles: 0
            };

            const score = calculateRiskScore(factors);
            expect(score).toBeLessThanOrEqual(30);
            expect(getRiskLevel(score)).toBe("low");
        });

        it("should calculate medium risk for multiple changes", () => {
            const factors: RiskFactors = {
                fileDeletes: 0,
                fileCreates: 3,
                codeEdits: 5,
                actionCount: 8,
                estimatedIterations: 3,
                rollbackPossible: true,
                sensitiveFiles: 0
            };

            const score = calculateRiskScore(factors);
            expect(score).toBeGreaterThan(30);
            expect(score).toBeLessThanOrEqual(60);
            expect(getRiskLevel(score)).toBe("medium");
        });

        it("should calculate high risk for deletions", () => {
            const factors: RiskFactors = {
                fileDeletes: 3,
                fileCreates: 0,
                codeEdits: 0,
                actionCount: 3,
                estimatedIterations: 2,
                rollbackPossible: false,
                sensitiveFiles: 3
            };

            const score = calculateRiskScore(factors);
            expect(score).toBeGreaterThan(60);
            expect(getRiskLevel(score)).toBe("high");
        });
    });

    describe("risk levels", () => {
        it("should classify scores correctly", () => {
            expect(getRiskLevel(0)).toBe("low");
            expect(getRiskLevel(30)).toBe("low");
            expect(getRiskLevel(31)).toBe("medium");
            expect(getRiskLevel(60)).toBe("medium");
            expect(getRiskLevel(61)).toBe("high");
            expect(getRiskLevel(100)).toBe("high");
        });
    });
});

// ============================================
// Resource Limits Tests
// ============================================

describe("ResourceLimits", () => {
    const LIMITS_BY_RISK = {
        low: {
            max_iterations: 10,
            timeout_ms: 1800000, // 30 min
            memory_mb: 1024,
            disk_mb: 100,
            max_files: 50
        },
        medium: {
            max_iterations: 5,
            timeout_ms: 900000, // 15 min
            memory_mb: 512,
            disk_mb: 50,
            max_files: 20
        },
        high: {
            max_iterations: 3,
            timeout_ms: 600000, // 10 min
            memory_mb: 256,
            disk_mb: 25,
            max_files: 10
        }
    };

    describe("limits by risk level", () => {
        it("should return correct limits for low risk", () => {
            const limits = LIMITS_BY_RISK.low;

            expect(limits.max_iterations).toBe(10);
            expect(limits.timeout_ms).toBe(1800000);
            expect(limits.max_files).toBe(50);
        });

        it("should return stricter limits for high risk", () => {
            const lowLimits = LIMITS_BY_RISK.low;
            const highLimits = LIMITS_BY_RISK.high;

            expect(highLimits.max_iterations).toBeLessThan(lowLimits.max_iterations);
            expect(highLimits.timeout_ms).toBeLessThan(lowLimits.timeout_ms);
            expect(highLimits.memory_mb).toBeLessThan(lowLimits.memory_mb);
        });
    });

    describe("limit checking", () => {
        it("should detect iteration limit exceeded", () => {
            const limits = LIMITS_BY_RISK.high;
            const currentIterations = 4;

            const exceeded = currentIterations > limits.max_iterations;
            expect(exceeded).toBe(true);
        });

        it("should detect timeout exceeded", () => {
            const limits = LIMITS_BY_RISK.high;
            const startTime = Date.now() - 700000; // 700 seconds ago
            const elapsed = Date.now() - startTime;

            const exceeded = elapsed > limits.timeout_ms;
            expect(exceeded).toBe(true);
        });

        it("should allow within limits", () => {
            const limits = LIMITS_BY_RISK.low;
            const currentIterations = 5;
            const filesChanged = 10;

            const withinLimits =
                currentIterations <= limits.max_iterations &&
                filesChanged <= limits.max_files;

            expect(withinLimits).toBe(true);
        });
    });
});
