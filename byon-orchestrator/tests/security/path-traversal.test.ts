/**
 * Path Traversal Security Tests
 * ==============================
 *
 * Tests path traversal attack prevention:
 * - Directory escape attempts
 * - Forbidden path access
 * - Symbolic link attacks
 * - Unicode/encoding bypasses
 *
 * Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as path from "node:path";

// ============================================
// Path Security Checker
// ============================================

interface PathCheckResult {
    allowed: boolean;
    reason?: string;
    normalizedPath?: string;
}

class PathSecurityChecker {
    private projectRoot: string;
    private forbiddenPaths: string[];
    private forbiddenExtensions: string[];

    constructor(projectRoot: string) {
        this.projectRoot = path.resolve(projectRoot);
        this.forbiddenPaths = [
            // System paths
            "/etc",
            "/usr",
            "/bin",
            "/sbin",
            "/var",
            "/root",
            "/home",
            "C:\\Windows",
            "C:\\Program Files",
            "C:\\Users",

            // Sensitive files
            ".env",
            ".env.local",
            ".env.production",
            ".env.development",
            "credentials",
            "secrets",
            ".aws",
            ".ssh",
            ".gnupg",

            // VCS
            ".git",
            ".svn",
            ".hg",

            // Dependencies
            "node_modules",
            "vendor",

            // Lock files
            "package-lock.json",
            "pnpm-lock.yaml",
            "yarn.lock",
            "composer.lock"
        ];

        this.forbiddenExtensions = [
            ".pem",
            ".key",
            ".cert",
            ".crt",
            ".p12",
            ".pfx"
        ];
    }

    checkPath(targetPath: string): PathCheckResult {
        // Normalize the path
        let normalized: string;
        try {
            normalized = this.normalizePath(targetPath);
        } catch (err) {
            return {
                allowed: false,
                reason: `Invalid path: ${err instanceof Error ? err.message : "Unknown error"}`
            };
        }

        // Check for directory traversal
        if (this.hasTraversal(targetPath)) {
            return {
                allowed: false,
                reason: "Path traversal detected",
                normalizedPath: normalized
            };
        }

        // Check if path escapes project root
        if (!this.isWithinRoot(normalized)) {
            return {
                allowed: false,
                reason: "Path escapes project root",
                normalizedPath: normalized
            };
        }

        // Check against forbidden paths
        const forbiddenMatch = this.matchesForbiddenPath(normalized);
        if (forbiddenMatch) {
            return {
                allowed: false,
                reason: `Forbidden path: ${forbiddenMatch}`,
                normalizedPath: normalized
            };
        }

        // Check extension
        const ext = path.extname(normalized).toLowerCase();
        if (this.forbiddenExtensions.includes(ext)) {
            return {
                allowed: false,
                reason: `Forbidden extension: ${ext}`,
                normalizedPath: normalized
            };
        }

        return {
            allowed: true,
            normalizedPath: normalized
        };
    }

    private normalizePath(targetPath: string): string {
        // Decode URL encoding
        let decoded = decodeURIComponent(targetPath);

        // Remove null bytes (poison byte attack)
        decoded = decoded.replace(/\x00/g, "");

        // Normalize unicode
        decoded = decoded.normalize("NFC");

        // Resolve to absolute path within project
        if (path.isAbsolute(decoded)) {
            return path.normalize(decoded);
        }

        return path.resolve(this.projectRoot, decoded);
    }

    private hasTraversal(targetPath: string): boolean {
        const traversalPatterns = [
            "..",
            "..\\",
            "../",
            "..%2f",
            "..%5c",
            "%2e%2e",
            "%2e%2e%2f",
            "%2e%2e/",
            "..%252f",
            "%252e%252e",
            "....//",
            "....//"
        ];

        const lower = targetPath.toLowerCase();
        return traversalPatterns.some(pattern => lower.includes(pattern.toLowerCase()));
    }

    private isWithinRoot(normalizedPath: string): boolean {
        const relativePath = path.relative(this.projectRoot, normalizedPath);
        return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
    }

    private matchesForbiddenPath(normalizedPath: string): string | null {
        const lowerPath = normalizedPath.toLowerCase();
        const relativePath = path.relative(this.projectRoot, normalizedPath).toLowerCase();

        for (const forbidden of this.forbiddenPaths) {
            const forbiddenLower = forbidden.toLowerCase();

            // Check if path contains forbidden segment
            if (lowerPath.includes(forbiddenLower) || relativePath.includes(forbiddenLower)) {
                return forbidden;
            }

            // Check if path starts with forbidden path
            if (relativePath.startsWith(forbiddenLower)) {
                return forbidden;
            }
        }

        return null;
    }
}

// ============================================
// Security Tests
// ============================================

describe("Path Traversal Security", () => {
    let checker: PathSecurityChecker;
    const PROJECT_ROOT = "/project";

    beforeEach(() => {
        checker = new PathSecurityChecker(PROJECT_ROOT);
    });

    describe("Basic Traversal Attacks", () => {
        const traversalPaths = [
            "../etc/passwd",
            "../../etc/shadow",
            "../../../root/.ssh/id_rsa",
            "..\\..\\windows\\system32",
            "foo/../../../etc/passwd",
            "./foo/../../etc/passwd",
            "src/../../../etc/passwd"
        ];

        for (const attackPath of traversalPaths) {
            it(`should block: ${attackPath}`, () => {
                const result = checker.checkPath(attackPath);
                expect(result.allowed).toBe(false);
                expect(result.reason).toContain("traversal");
            });
        }
    });

    describe("URL Encoded Traversal", () => {
        const encodedPaths = [
            "..%2fetc%2fpasswd",
            "..%5c..%5cwindows",
            "%2e%2e%2f%2e%2e%2fetc%2fpasswd",
            "..%252f..%252fetc",
            "..%c0%af..%c0%afetc"
        ];

        for (const attackPath of encodedPaths) {
            it(`should block URL encoded: ${attackPath}`, () => {
                const result = checker.checkPath(attackPath);
                expect(result.allowed).toBe(false);
            });
        }
    });

    describe("Double Encoding Attacks", () => {
        const doubleEncodedPaths = [
            "..%252f..%252fetc%252fpasswd",
            "%252e%252e%252f",
            "..%25252f"
        ];

        for (const attackPath of doubleEncodedPaths) {
            it(`should block double encoded: ${attackPath}`, () => {
                const result = checker.checkPath(attackPath);
                expect(result.allowed).toBe(false);
            });
        }
    });

    describe("Null Byte Attacks", () => {
        it("should block null byte injection", () => {
            const result = checker.checkPath("valid.txt\x00.jpg");
            // Should sanitize and check the path
            expect(result.normalizedPath).not.toContain("\x00");
        });
    });

    describe("Forbidden Path Access", () => {
        const forbiddenTargets = [
            ".env",
            ".env.production",
            "config/.env",
            ".git/config",
            ".git/objects/pack",
            "node_modules/express/package.json",
            ".ssh/id_rsa",
            "credentials.json",
            "secrets/api-key.txt",
            ".aws/credentials"
        ];

        for (const target of forbiddenTargets) {
            it(`should block forbidden: ${target}`, () => {
                const result = checker.checkPath(target);
                expect(result.allowed).toBe(false);
                expect(result.reason).toContain("Forbidden");
            });
        }
    });

    describe("Forbidden Extensions", () => {
        const sensitiveFiles = [
            "private.pem",
            "server.key",
            "certificate.cert",
            "ca.crt",
            "keystore.p12",
            "identity.pfx"
        ];

        for (const file of sensitiveFiles) {
            it(`should block sensitive extension: ${file}`, () => {
                const result = checker.checkPath(`certs/${file}`);
                expect(result.allowed).toBe(false);
                expect(result.reason).toContain("extension");
            });
        }
    });

    describe("Absolute Path Escape", () => {
        it("should block absolute paths outside project", () => {
            const result = checker.checkPath("/etc/passwd");
            expect(result.allowed).toBe(false);
        });

        it("should block Windows absolute paths", () => {
            const winChecker = new PathSecurityChecker("C:\\project");
            const result = winChecker.checkPath("C:\\Windows\\System32\\config");
            expect(result.allowed).toBe(false);
        });
    });

    describe("Valid Paths", () => {
        const validPaths = [
            "src/index.ts",
            "src/utils/helper.ts",
            "tests/unit/test.spec.ts",
            "package.json",
            "tsconfig.json",
            "README.md",
            "docs/api.md",
            "src/components/Button/index.tsx"
        ];

        for (const validPath of validPaths) {
            it(`should allow: ${validPath}`, () => {
                const result = checker.checkPath(validPath);
                expect(result.allowed).toBe(true);
            });
        }
    });

    describe("Edge Cases", () => {
        it("should handle empty path", () => {
            const result = checker.checkPath("");
            // Empty path resolves to project root, which should be allowed
            expect(result.allowed).toBe(true);
        });

        it("should handle current directory", () => {
            const result = checker.checkPath(".");
            expect(result.allowed).toBe(true);
        });

        it("should handle deeply nested valid paths", () => {
            const result = checker.checkPath("src/a/b/c/d/e/f/g/file.ts");
            expect(result.allowed).toBe(true);
        });

        it("should handle paths with spaces", () => {
            const result = checker.checkPath("src/my file.ts");
            expect(result.allowed).toBe(true);
        });

        it("should handle unicode filenames", () => {
            const result = checker.checkPath("src/こんにちは.ts");
            expect(result.allowed).toBe(true);
        });

        it("should handle mixed slashes", () => {
            const result = checker.checkPath("src\\utils/helper.ts");
            // Should normalize and allow if within project
            expect(result.normalizedPath).toBeTruthy();
        });
    });

    describe("Case Sensitivity Bypass", () => {
        it("should block case variations of forbidden paths", () => {
            const caseVariations = [
                ".ENV",
                ".Env",
                ".GIT/config",
                "NODE_MODULES/package",
                ".SSH/id_rsa"
            ];

            for (const variation of caseVariations) {
                const result = checker.checkPath(variation);
                expect(result.allowed).toBe(false);
            }
        });
    });

    describe("Symlink-like Attacks", () => {
        it("should handle paths that look like symlink traversal", () => {
            const symlinkLikePaths = [
                "link -> ../../../etc/passwd",
                "src/../../../target"
            ];

            for (const attackPath of symlinkLikePaths) {
                const result = checker.checkPath(attackPath);
                expect(result.allowed).toBe(false);
            }
        });
    });
});

describe("Action Target Validation", () => {
    let checker: PathSecurityChecker;

    beforeEach(() => {
        checker = new PathSecurityChecker("/workspace/project");
    });

    describe("File Operations", () => {
        it("should allow file creation in src/", () => {
            const targets = [
                "src/newFile.ts",
                "src/components/Button.tsx",
                "src/utils/helper.ts"
            ];

            for (const target of targets) {
                expect(checker.checkPath(target).allowed).toBe(true);
            }
        });

        it("should allow file creation in tests/", () => {
            const targets = [
                "tests/unit/test.ts",
                "tests/integration/flow.test.ts"
            ];

            for (const target of targets) {
                expect(checker.checkPath(target).allowed).toBe(true);
            }
        });

        it("should block modifications to lock files", () => {
            const lockFiles = [
                "package-lock.json",
                "pnpm-lock.yaml",
                "yarn.lock"
            ];

            for (const lockFile of lockFiles) {
                expect(checker.checkPath(lockFile).allowed).toBe(false);
            }
        });
    });

    describe("Batch Operations", () => {
        it("should validate multiple targets", () => {
            const targets = [
                "src/a.ts",
                "src/b.ts",
                "../outside.ts", // This should fail
                "src/c.ts"
            ];

            const results = targets.map(t => checker.checkPath(t));
            const blocked = results.filter(r => !r.allowed);

            expect(blocked.length).toBe(1);
            expect(blocked[0].reason).toContain("traversal");
        });
    });
});
