/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Forbidden Paths
 * ===============
 *
 * Defines paths that BYON executor cannot access.
 * Protects system files, credentials, and sensitive data.
 *
 * SECURITY: Access to forbidden paths is BLOCKED.
 */

import * as path from "path";

// ============================================================================
// TYPES
// ============================================================================

export interface PathCheckResult {
    /** Whether path is allowed */
    allowed: boolean;
    /** Reason for decision */
    reason: string;
    /** Pattern that matched (if forbidden) */
    matchedPattern?: string;
    /** Category of forbidden path */
    category?: string;
}

export interface ForbiddenPathsConfig {
    /** Custom forbidden patterns */
    customPatterns: string[];
    /** Custom allowed patterns (overrides forbidden) */
    allowedPatterns: string[];
    /** Project root (paths outside are forbidden) */
    projectRoot?: string;
    /** Allow accessing parent directories */
    allowParentAccess: boolean;
}

// ============================================================================
// FORBIDDEN PATTERNS
// ============================================================================

/**
 * System paths - OS level protection
 */
const SYSTEM_PATHS = [
    // Unix/Linux
    "/etc",
    "/etc/**",
    "/usr",
    "/usr/**",
    "/var",
    "/var/**",
    "/bin",
    "/bin/**",
    "/sbin",
    "/sbin/**",
    "/boot",
    "/boot/**",
    "/root",
    "/root/**",
    "/proc",
    "/proc/**",
    "/sys",
    "/sys/**",

    // Windows
    "C:\\Windows",
    "C:\\Windows\\**",
    "C:\\Program Files",
    "C:\\Program Files\\**",
    "C:\\Program Files (x86)",
    "C:\\Program Files (x86)\\**",
    "C:\\ProgramData",
    "C:\\ProgramData\\**",

    // macOS
    "/System",
    "/System/**",
    "/Library",
    "/Library/**",
    "/private",
    "/private/**"
];

/**
 * Credential/secret paths
 */
const CREDENTIAL_PATHS = [
    // Environment files
    ".env",
    ".env.*",
    "**/.env",
    "**/.env.*",

    // Credential files
    "**/credentials*",
    "**/secrets*",
    "**/*.pem",
    "**/*.key",
    "**/*.crt",
    "**/*.pfx",
    "**/*.p12",

    // Cloud credentials
    "**/.aws/**",
    "**/.gcloud/**",
    "**/.azure/**",

    // SSH
    "**/.ssh/**",
    "**/id_rsa*",
    "**/id_ed25519*",
    "**/id_dsa*",

    // GPG
    "**/.gnupg/**",

    // Docker credentials
    "**/.docker/config.json"
];

/**
 * Version control paths
 */
const VCS_PATHS = [
    ".git",
    ".git/**",
    "**/.git/**",
    ".svn",
    ".svn/**",
    "**/.svn/**",
    ".hg",
    ".hg/**",
    "**/.hg/**"
];

/**
 * Package manager paths
 */
const PACKAGE_PATHS = [
    "node_modules",
    "**/node_modules/**",
    "vendor",
    "**/vendor/**",
    "__pycache__",
    "**/__pycache__/**",
    ".venv",
    "**/.venv/**",
    "venv",
    "**/venv/**"
];

/**
 * Lock files (should not be modified directly)
 */
const LOCK_FILES = [
    "package-lock.json",
    "**/package-lock.json",
    "pnpm-lock.yaml",
    "**/pnpm-lock.yaml",
    "yarn.lock",
    "**/yarn.lock",
    "Gemfile.lock",
    "**/Gemfile.lock",
    "poetry.lock",
    "**/poetry.lock",
    "Cargo.lock",
    "**/Cargo.lock",
    "composer.lock",
    "**/composer.lock"
];

/**
 * Build/output directories
 */
const BUILD_PATHS = [
    "dist",
    "**/dist/**",
    "build",
    "**/build/**",
    "out",
    "**/out/**",
    ".next",
    "**/.next/**",
    ".nuxt",
    "**/.nuxt/**"
];

// ============================================================================
// FORBIDDEN PATHS CHECKER
// ============================================================================

const DEFAULT_CONFIG: ForbiddenPathsConfig = {
    customPatterns: [],
    allowedPatterns: [],
    projectRoot: undefined,
    allowParentAccess: false
};

/**
 * Forbidden Paths Checker
 *
 * Validates paths against forbidden patterns.
 */
export class ForbiddenPathsChecker {
    private config: ForbiddenPathsConfig;
    private patterns: Map<string, { pattern: RegExp; category: string }>;

    constructor(config: Partial<ForbiddenPathsConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.patterns = new Map();

        this.initializePatterns();
    }

    /**
     * Initialize patterns
     */
    private initializePatterns(): void {
        // Add system paths
        for (const pattern of SYSTEM_PATHS) {
            this.addPattern(pattern, "system");
        }

        // Add credential paths
        for (const pattern of CREDENTIAL_PATHS) {
            this.addPattern(pattern, "credential");
        }

        // Add VCS paths
        for (const pattern of VCS_PATHS) {
            this.addPattern(pattern, "vcs");
        }

        // Add package paths
        for (const pattern of PACKAGE_PATHS) {
            this.addPattern(pattern, "package");
        }

        // Add lock files
        for (const pattern of LOCK_FILES) {
            this.addPattern(pattern, "lock_file");
        }

        // Add build paths
        for (const pattern of BUILD_PATHS) {
            this.addPattern(pattern, "build");
        }

        // Add custom patterns
        for (const pattern of this.config.customPatterns) {
            this.addPattern(pattern, "custom");
        }
    }

    /**
     * Add pattern to checker
     */
    private addPattern(pattern: string, category: string): void {
        const regex = this.globToRegex(pattern);
        this.patterns.set(pattern, { pattern: regex, category });
    }

    /**
     * Convert glob pattern to regex
     */
    private globToRegex(glob: string): RegExp {
        let regex = glob
            // Escape special regex chars (except * and ?)
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            // Convert ** to match any path
            .replace(/\*\*/g, ".*")
            // Convert * to match anything except path separator
            .replace(/\*/g, "[^/\\\\]*")
            // Convert ? to match single char
            .replace(/\?/g, ".");

        // Handle both forward and back slashes
        regex = regex.replace(/\//g, "[/\\\\]");

        return new RegExp(`^${regex}$`, "i");
    }

    /**
     * Check if path is forbidden
     */
    check(targetPath: string): PathCheckResult {
        // Normalize path
        const normalizedPath = this.normalizePath(targetPath);

        // Check allowed patterns first (they override forbidden)
        for (const allowedPattern of this.config.allowedPatterns) {
            const regex = this.globToRegex(allowedPattern);
            if (regex.test(normalizedPath)) {
                return {
                    allowed: true,
                    reason: `Path matches allowed pattern: ${allowedPattern}`
                };
            }
        }

        // Check for path traversal
        if (!this.config.allowParentAccess && this.hasPathTraversal(normalizedPath)) {
            return {
                allowed: false,
                reason: "Path traversal detected (../)",
                matchedPattern: "../",
                category: "traversal"
            };
        }

        // Check project root constraint
        if (this.config.projectRoot) {
            const absolutePath = path.resolve(normalizedPath);
            const projectRoot = path.resolve(this.config.projectRoot);

            if (!absolutePath.startsWith(projectRoot)) {
                return {
                    allowed: false,
                    reason: `Path is outside project root: ${this.config.projectRoot}`,
                    category: "outside_project"
                };
            }
        }

        // Check against forbidden patterns
        for (const [patternStr, { pattern, category }] of this.patterns) {
            if (pattern.test(normalizedPath)) {
                return {
                    allowed: false,
                    reason: `Path matches forbidden pattern: ${patternStr}`,
                    matchedPattern: patternStr,
                    category
                };
            }
        }

        // Path is allowed
        return {
            allowed: true,
            reason: "Path is not in forbidden list"
        };
    }

    /**
     * Check multiple paths
     */
    checkAll(paths: string[]): {
        allAllowed: boolean;
        results: Map<string, PathCheckResult>;
        forbiddenPaths: string[];
    } {
        const results = new Map<string, PathCheckResult>();
        const forbiddenPaths: string[] = [];

        for (const targetPath of paths) {
            const result = this.check(targetPath);
            results.set(targetPath, result);

            if (!result.allowed) {
                forbiddenPaths.push(targetPath);
            }
        }

        return {
            allAllowed: forbiddenPaths.length === 0,
            results,
            forbiddenPaths
        };
    }

    /**
     * Normalize path for comparison
     */
    private normalizePath(targetPath: string): string {
        // Convert to forward slashes for consistency
        return targetPath.replace(/\\/g, "/");
    }

    /**
     * Check for path traversal attempts
     */
    private hasPathTraversal(targetPath: string): boolean {
        return targetPath.includes("../") ||
            targetPath.includes("..\\") ||
            targetPath.includes("%2e%2e") ||
            targetPath.includes("%2E%2E");
    }

    /**
     * Add custom forbidden pattern
     */
    addForbiddenPattern(pattern: string, category: string = "custom"): void {
        this.addPattern(pattern, category);
    }

    /**
     * Add allowed pattern (overrides forbidden)
     */
    addAllowedPattern(pattern: string): void {
        this.config.allowedPatterns.push(pattern);
    }

    /**
     * Get all forbidden patterns by category
     */
    getPatternsByCategory(category: string): string[] {
        const patterns: string[] = [];
        for (const [patternStr, { category: cat }] of this.patterns) {
            if (cat === category) {
                patterns.push(patternStr);
            }
        }
        return patterns;
    }

    /**
     * Get all categories
     */
    getCategories(): string[] {
        const categories = new Set<string>();
        for (const { category } of this.patterns.values()) {
            categories.add(category);
        }
        return Array.from(categories);
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create forbidden paths checker
 */
export function createForbiddenPathsChecker(
    config?: Partial<ForbiddenPathsConfig>
): ForbiddenPathsChecker {
    return new ForbiddenPathsChecker(config);
}

/**
 * Create checker with project root constraint
 */
export function createProjectBoundChecker(projectRoot: string): ForbiddenPathsChecker {
    return new ForbiddenPathsChecker({
        projectRoot,
        allowParentAccess: false
    });
}

/**
 * Quick check if path is forbidden
 */
export function isPathForbidden(targetPath: string): boolean {
    const checker = createForbiddenPathsChecker();
    return !checker.check(targetPath).allowed;
}

/**
 * Get all forbidden path patterns
 */
export const FORBIDDEN_PATH_PATTERNS = {
    SYSTEM: SYSTEM_PATHS,
    CREDENTIALS: CREDENTIAL_PATHS,
    VCS: VCS_PATHS,
    PACKAGES: PACKAGE_PATHS,
    LOCK_FILES: LOCK_FILES,
    BUILD: BUILD_PATHS
};
