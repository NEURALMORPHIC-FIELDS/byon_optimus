/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Project Manifest Types
 * ======================
 *
 * Structured metadata describing the canonical architecture, component
 * inventory, naming conventions, and current status. Read by OpenClaw
 * before generating audit reports to prevent factual errors.
 *
 * SECURITY: No secrets are exposed — only architecture metadata,
 * file paths, and boolean existence of gitignored files.
 */

export interface ProjectManifest {
    version: "1.0";
    generated_at: string;

    architecture: {
        pipeline: string;
        handoff_mechanism: string;
        executor_isolation: string;
    };

    components: ComponentEntry[];

    naming_conventions: Record<string, NamingConvention>;

    gitignored_present: GitignoredEntry[];

    status: {
        orchestrator_tests: { total: number; passing: number; last_run?: string };
        typescript_errors: number;
        docker_config_valid: boolean;
    };

    ui: {
        canonical_component: string;
        canonical_route: string;
        obsolete_files: string[];
        framework: string;
        build_tool: string;
    };

    security: {
        signing_algorithm: string;
        auth_mechanism: string;
        cors_mode: string;
        rate_limiting: { general: number; approval: number };
        nonce_replay_protection: boolean;
        ttl_by_risk: Record<string, number>;
    };
}

export interface ComponentEntry {
    name: string;
    concept_names: string[];
    actual_paths: string[];
    line_count: number;
    status: "implemented" | "planned" | "deprecated";
    description: string;
}

export interface NamingConvention {
    concept: string;
    search_terms: string[];
    actual_directory: string;
    actual_file_patterns: string[];
}

export interface GitignoredEntry {
    path: string;
    type: "directory" | "file";
    description: string;
    exists: boolean;
}
