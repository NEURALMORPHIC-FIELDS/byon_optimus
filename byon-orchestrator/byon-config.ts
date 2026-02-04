/**
 * BYON Orchestrator Configuration
 * ================================
 *
 * Local configuration wrapper for CLI commands.
 * Re-exports main config with CLI-friendly interface.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ByonCliConfig {
    byon: {
        handoff_base_path: string;
        memory_service_url: string;
        memory_provider: string;
        auto_approve_risk_level: "low" | "medium" | "none";
    };
    security: {
        keys_path: string;
        approval_timeout_seconds: number;
    };
    audit: {
        db_path: string;
        base_path: string;
        enabled: boolean;
    };
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const BASE_DIR = process.env['BYON_BASE_DIR'] || process.cwd();

const DEFAULT_CLI_CONFIG: ByonCliConfig = {
    byon: {
        handoff_base_path: process.env['BYON_HANDOFF_PATH'] || `${BASE_DIR}/handoff`,
        memory_service_url: process.env['MEMORY_SERVICE_URL'] || "http://localhost:8000",
        memory_provider: process.env['MEMORY_PROVIDER'] || "fhrss-fcpe",
        auto_approve_risk_level: "none"
    },
    security: {
        keys_path: process.env['BYON_KEYS_PATH'] || `${BASE_DIR}/keys`,
        approval_timeout_seconds: 300
    },
    audit: {
        db_path: process.env['BYON_AUDIT_DB'] || `${BASE_DIR}/memory/audit.db`,
        base_path: process.env['BYON_AUDIT_PATH'] || `${BASE_DIR}/audit`,
        enabled: true
    }
};

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Get default configuration for CLI commands
 */
export function getDefaultConfig(): ByonCliConfig {
    return DEFAULT_CLI_CONFIG;
}

/**
 * Get configuration with overrides
 */
export function getConfig(overrides?: Partial<ByonCliConfig>): ByonCliConfig {
    if (!overrides) return DEFAULT_CLI_CONFIG;

    return {
        byon: { ...DEFAULT_CLI_CONFIG.byon, ...overrides.byon },
        security: { ...DEFAULT_CLI_CONFIG.security, ...overrides.security },
        audit: { ...DEFAULT_CLI_CONFIG.audit, ...overrides.audit }
    };
}

export default DEFAULT_CLI_CONFIG;
