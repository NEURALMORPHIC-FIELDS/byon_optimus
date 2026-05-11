/**
 * BYON Unified Configuration
 * ==========================
 *
 * Unified configuration for the BYON+OpenClaw system.
 * This file is the single source of truth for all configuration.
 *
 * Location: Root of byon_optimus project
 *
 * Configuration priority:
 * 1. Environment variables (highest)
 * 2. This config file
 * 3. Default values (lowest)
 *
 * IMPORTANT CONSTRAINTS:
 * - OpenClaw is the SINGLE communication platform
 * - byon-executor is the SINGLE execution engine
 * - BYON orchestrator MUST NOT START without memory service
 */

// ============================================================================
// SYSTEM CONFIGURATION
// ============================================================================

export interface SystemConfig {
    /** System name */
    name: string;
    /** Version string */
    version: string;
    /** Runtime mode */
    mode: "development" | "production" | "test";
    /** Enable verbose logging */
    verbose: boolean;
    /** Base directory for all BYON files */
    base_dir: string;
}

// ============================================================================
// OPENCLAW CONFIGURATION
// ============================================================================

export interface OpenClawConfig {
    /** Enable OpenClaw integration */
    enabled: boolean;
    /** OpenClaw gateway port */
    gateway_port: number;
    /** OpenClaw gateway URL */
    gateway_url: string;
    /** Channels configuration */
    channels: {
        telegram: { enabled: boolean; token?: string };
        discord: { enabled: boolean; token?: string };
        web: { enabled: boolean; port: number };
        cli: { enabled: boolean };
    };
    /** Memory integration path in OpenClaw */
    memory_integration_path: string;
}

// ============================================================================
// BYON ORCHESTRATOR CONFIGURATION
// ============================================================================

export interface ByonConfig {
    /** Enable BYON orchestrator */
    enabled: boolean;
    /** Orchestrator mode */
    orchestrator_mode: "full" | "light";
    /** Primary memory provider */
    memory_provider: "fhrss-fcpe" | "memory-core" | "lancedb";
    /** Fallback memory provider */
    memory_fallback: "memory-core" | "none";
    /** Auto-approve risk levels */
    auto_approve_risk_level: "low" | "medium" | "none";
    /** Memory service configuration */
    memory_service: {
        url: string;
        timeout_ms: number;
        max_retries: number;
    };
    /** GMV (Global Memory Vitalizer) configuration */
    gmv: {
        enabled: boolean;
        interval_ms: number;
        max_attractors: number;
        min_support: number;
    };
    /** Handoff directories */
    handoff: {
        inbox: string;
        worker_to_auditor: string;
        auditor_to_user: string;
        auditor_to_executor: string;
        executor_to_worker: string;
    };
}

// ============================================================================
// SECURITY CONFIGURATION
// ============================================================================

export interface SecurityConfig {
    /** Enable Ed25519 signing for execution orders */
    ed25519_enabled: boolean;
    /** Path to keys directory */
    keys_path: string;
    /** Require user approval for plans */
    user_approval_required: boolean;
    /** Approval timeout in seconds */
    approval_timeout_seconds: number;
    /** Auto-reject after timeout */
    auto_reject_on_timeout: boolean;
    /** Forbidden paths (will reject any action targeting these) */
    forbidden_paths: string[];
    /** Forbidden code patterns */
    forbidden_patterns: string[];
    /** Resource limits by risk level */
    resource_limits: {
        low: ResourceLimits;
        medium: ResourceLimits;
        high: ResourceLimits;
    };
}

export interface ResourceLimits {
    max_iterations: number;
    timeout_minutes: number;
    memory_limit_mb: number;
    disk_limit_mb: number;
}

// ============================================================================
// AUDIT CONFIGURATION
// ============================================================================

export interface AuditConfig {
    /** Enable audit trail */
    enabled: boolean;
    /** Audit database path */
    db_path: string;
    /** Enable calendar indexing */
    calendar_index: boolean;
    /** Generate daily digests */
    daily_digest: boolean;
    /** Retention days (0 = infinite) */
    retention_days: number;
}

// ============================================================================
// EXECUTOR CONFIGURATION
// ============================================================================

export interface ExecutorConfig {
    /** Executor is always air-gapped (no network) */
    air_gapped: true;
    /** Working directory for executor */
    working_dir: string;
    /** Allowed action types */
    allowed_actions: string[];
    /** Max concurrent actions */
    max_concurrent: number;
    /** Action timeout in seconds */
    action_timeout_seconds: number;
}

// ============================================================================
// FULL CONFIGURATION TYPE
// ============================================================================

export interface ByonSystemConfig {
    system: SystemConfig;
    openclaw: OpenClawConfig;
    byon: ByonConfig;
    security: SecurityConfig;
    audit: AuditConfig;
    executor: ExecutorConfig;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const BASE_DIR = process.env.BYON_BASE_DIR || ".";

export const DEFAULT_CONFIG: ByonSystemConfig = {
    system: {
        name: "BYON Optimus",
        version: "1.0.0",
        mode: (process.env.NODE_ENV as SystemConfig["mode"]) || "development",
        verbose: process.env.BYON_VERBOSE === "true",
        base_dir: BASE_DIR
    },

    openclaw: {
        enabled: true,
        gateway_port: parseInt(process.env.OPENCLAW_PORT || "3000", 10),
        gateway_url: process.env.OPENCLAW_URL || "http://localhost:3000",
        channels: {
            telegram: {
                enabled: !!process.env.TELEGRAM_BOT_TOKEN,
                token: process.env.TELEGRAM_BOT_TOKEN
            },
            discord: {
                enabled: !!process.env.DISCORD_BOT_TOKEN,
                token: process.env.DISCORD_BOT_TOKEN
            },
            web: {
                enabled: true,
                port: parseInt(process.env.WEB_UI_PORT || "8080", 10)
            },
            cli: {
                enabled: true
            }
        },
        memory_integration_path: "src/memory/manager.ts"
    },

    byon: {
        enabled: true,
        orchestrator_mode: "full",
        memory_provider: "fhrss-fcpe",
        memory_fallback: "memory-core",
        auto_approve_risk_level: "none",
        memory_service: {
            url: process.env.MEMORY_SERVICE_URL || "http://localhost:8000",
            timeout_ms: 5000,
            max_retries: 3
        },
        gmv: {
            enabled: true,
            interval_ms: 30000,
            max_attractors: 100,
            min_support: 5
        },
        handoff: {
            inbox: `${BASE_DIR}/handoff/inbox`,
            worker_to_auditor: `${BASE_DIR}/handoff/worker_to_auditor`,
            auditor_to_user: `${BASE_DIR}/handoff/auditor_to_user`,
            auditor_to_executor: `${BASE_DIR}/handoff/auditor_to_executor`,
            executor_to_worker: `${BASE_DIR}/handoff/executor_to_worker`
        }
    },

    security: {
        ed25519_enabled: true,
        keys_path: `${BASE_DIR}/keys`,
        user_approval_required: true,
        approval_timeout_seconds: 300,
        auto_reject_on_timeout: false,
        forbidden_paths: [
            "/etc",
            "/usr",
            "C:\\Windows",
            ".env",
            ".env.local",
            ".env.production",
            "credentials",
            "secrets",
            ".git",
            "node_modules",
            ".ssh",
            "package-lock.json",
            "pnpm-lock.yaml",
            "yarn.lock"
        ],
        forbidden_patterns: [
            "fetch(",
            "http.request",
            "axios",
            "exec(",
            "spawn(",
            "child_process",
            "../",
            "eval(",
            "new Function(",
            "process.env",
            "require('fs')",
            "import('fs')"
        ],
        resource_limits: {
            low: {
                max_iterations: 10,
                timeout_minutes: 30,
                memory_limit_mb: 1024,
                disk_limit_mb: 100
            },
            medium: {
                max_iterations: 5,
                timeout_minutes: 15,
                memory_limit_mb: 512,
                disk_limit_mb: 50
            },
            high: {
                max_iterations: 3,
                timeout_minutes: 10,
                memory_limit_mb: 256,
                disk_limit_mb: 25
            }
        }
    },

    audit: {
        enabled: true,
        db_path: `${BASE_DIR}/memory/audit.db`,
        calendar_index: true,
        daily_digest: true,
        retention_days: 0 // infinite
    },

    executor: {
        air_gapped: true,
        working_dir: `${BASE_DIR}/workspace`,
        allowed_actions: [
            "code_edit",
            "file_create",
            "file_delete",
            "file_write",
            "file_modify",
            "test_run",
            "lint_run",
            "build_run",
            "shell_exec"
        ],
        max_concurrent: 1,
        action_timeout_seconds: 300
    }
};

// ============================================================================
// CONFIGURATION LOADING
// ============================================================================

let currentConfig: ByonSystemConfig | null = null;

/**
 * Load configuration
 * Merges defaults with environment variables and optional overrides
 */
export function loadConfig(overrides?: Partial<ByonSystemConfig>): ByonSystemConfig {
    const config = deepMerge(DEFAULT_CONFIG, overrides || {});
    currentConfig = config;
    return config;
}

/**
 * Get current configuration
 * Loads default config if not already loaded
 */
export function getConfig(): ByonSystemConfig {
    if (!currentConfig) {
        currentConfig = loadConfig();
    }
    return currentConfig;
}

/**
 * Validate configuration
 * Returns list of validation errors
 */
export function validateConfig(config: ByonSystemConfig): string[] {
    const errors: string[] = [];

    // System validation
    if (!config.system.name) {
        errors.push("system.name is required");
    }

    // BYON validation
    if (config.byon.enabled) {
        if (!config.byon.memory_service.url) {
            errors.push("byon.memory_service.url is required when BYON is enabled");
        }
    }

    // Security validation
    if (config.security.ed25519_enabled && !config.security.keys_path) {
        errors.push("security.keys_path is required when Ed25519 is enabled");
    }

    // Executor validation - must be air-gapped
    if (!config.executor.air_gapped) {
        errors.push("executor.air_gapped must be true (security requirement)");
    }

    return errors;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Deep merge two objects
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
    const result = { ...target };

    for (const key of Object.keys(source) as (keyof T)[]) {
        const sourceValue = source[key];
        const targetValue = target[key];

        if (
            sourceValue !== undefined &&
            typeof sourceValue === "object" &&
            sourceValue !== null &&
            !Array.isArray(sourceValue) &&
            typeof targetValue === "object" &&
            targetValue !== null &&
            !Array.isArray(targetValue)
        ) {
            result[key] = deepMerge(
                targetValue as Record<string, unknown>,
                sourceValue as Record<string, unknown>
            ) as T[keyof T];
        } else if (sourceValue !== undefined) {
            result[key] = sourceValue as T[keyof T];
        }
    }

    return result;
}

/**
 * Print configuration summary (for debugging)
 */
export function printConfigSummary(config: ByonSystemConfig): void {
    console.log("\n📋 BYON System Configuration");
    console.log("─".repeat(50));
    console.log(`System: ${config.system.name} v${config.system.version} (${config.system.mode})`);
    console.log(`OpenClaw: ${config.openclaw.enabled ? "enabled" : "disabled"} @ ${config.openclaw.gateway_url}`);
    console.log(`BYON: ${config.byon.enabled ? "enabled" : "disabled"} (${config.byon.orchestrator_mode})`);
    console.log(`Memory: ${config.byon.memory_provider} -> ${config.byon.memory_fallback}`);
    console.log(`GMV: ${config.byon.gmv.enabled ? "enabled" : "disabled"} (${config.byon.gmv.interval_ms}ms)`);
    console.log(`Security: Ed25519=${config.security.ed25519_enabled}, Approval=${config.security.user_approval_required}`);
    console.log(`Audit: ${config.audit.enabled ? "enabled" : "disabled"}`);
    console.log(`Executor: air-gapped=${config.executor.air_gapped}`);
    console.log("─".repeat(50) + "\n");
}
