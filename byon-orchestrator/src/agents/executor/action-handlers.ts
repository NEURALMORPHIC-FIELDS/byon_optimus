/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Executor Action Handlers
 * ========================
 *
 * Handlers for each action type.
 * AIR-GAPPED: No network operations allowed.
 *
 * SECURITY:
 * - NO fetch, http, or network calls
 * - NO child_process.exec with user input
 * - All file operations sandboxed to project root
 * - Path traversal prevention
 */

import * as fs from "fs";
import * as path from "path";
import { Action, ActionType, ActionResult } from "../../types/protocol.js";

// ============================================================================
// TYPES
// ============================================================================

export interface ActionContext {
    /** Project root directory */
    project_root: string;
    /** Dry run mode */
    dry_run: boolean;
    /** Backup files before modification */
    backup_enabled: boolean;
    /** Backup directory */
    backup_dir: string;
}

export interface ActionHandler {
    type: ActionType;
    execute: (action: Action, context: ActionContext) => Promise<ActionResult>;
}

export interface HandlerRegistry {
    handlers: Map<ActionType, ActionHandler>;
    register: (handler: ActionHandler) => void;
    execute: (action: Action, context: ActionContext) => Promise<ActionResult>;
}

// ============================================================================
// PATH SECURITY
// ============================================================================

/**
 * Validate and resolve path within project root
 * Prevents path traversal attacks
 */
function resolveSafePath(target: string, projectRoot: string): string {
    // Normalize the path
    const normalized = path.normalize(target);

    // Check for path traversal
    if (normalized.includes("..")) {
        throw new Error(`Path traversal detected: ${target}`);
    }

    // Resolve to absolute path
    const resolved = path.isAbsolute(normalized)
        ? normalized
        : path.join(projectRoot, normalized);

    // Ensure it's within project root
    const relative = path.relative(projectRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Path outside project root: ${target}`);
    }

    return resolved;
}

/**
 * Check if path is forbidden
 */
function isForbiddenPath(target: string): boolean {
    const forbidden = [
        ".env",
        ".git",
        "node_modules",
        ".ssh",
        "credentials",
        "secrets",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock"
    ];

    const normalized = target.toLowerCase().replace(/\\/g, "/");
    return forbidden.some(f => normalized.includes(f.toLowerCase()));
}

// ============================================================================
// BACKUP UTILITIES
// ============================================================================

/**
 * Create backup of file before modification
 */
function backupFile(filePath: string, backupDir: string): string | null {
    if (!fs.existsSync(filePath)) {
        return null;
    }

    // Ensure backup directory exists
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    // Generate backup filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = path.basename(filePath);
    const backupPath = path.join(backupDir, `${timestamp}_${fileName}`);

    // Copy file
    fs.copyFileSync(filePath, backupPath);

    return backupPath;
}

// ============================================================================
// ACTION HANDLERS
// ============================================================================

/**
 * Code Edit Handler
 */
const codeEditHandler: ActionHandler = {
    type: "code_edit",
    async execute(action: Action, context: ActionContext): Promise<ActionResult> {
        const startTime = Date.now();

        try {
            const filePath = resolveSafePath(action.target, context.project_root);

            if (isForbiddenPath(action.target)) {
                return {
                    action_id: action.action_id,
                    status: "failed",
                    error: `Forbidden path: ${action.target}`,
                    duration_ms: Date.now() - startTime
                };
            }

            // Check file exists
            if (!fs.existsSync(filePath)) {
                return {
                    action_id: action.action_id,
                    status: "failed",
                    error: `File not found: ${action.target}`,
                    duration_ms: Date.now() - startTime
                };
            }

            if (context.dry_run) {
                return {
                    action_id: action.action_id,
                    status: "success",
                    output: `[DRY RUN] Would edit: ${action.target}`,
                    duration_ms: Date.now() - startTime
                };
            }

            // Backup
            if (context.backup_enabled) {
                backupFile(filePath, context.backup_dir);
            }

            // Apply edit
            const { search, replace, content } = action.parameters as {
                search?: string;
                replace?: string;
                content?: string;
            };

            if (content !== undefined) {
                // Full file replacement
                fs.writeFileSync(filePath, content, "utf-8");
            } else if (search !== undefined && replace !== undefined) {
                // Search and replace - SECURITY: Use safe string operations
                // instead of RegExp to prevent ReDoS attacks
                const original = fs.readFileSync(filePath, "utf-8");
                const modified = original.split(search).join(replace);
                fs.writeFileSync(filePath, modified, "utf-8");
            } else {
                return {
                    action_id: action.action_id,
                    status: "failed",
                    error: "Missing parameters: need 'content' or 'search'+'replace'",
                    duration_ms: Date.now() - startTime
                };
            }

            return {
                action_id: action.action_id,
                status: "success",
                output: `Edited: ${action.target}`,
                duration_ms: Date.now() - startTime
            };

        } catch (error) {
            return {
                action_id: action.action_id,
                status: "failed",
                error: error instanceof Error ? error.message : String(error),
                duration_ms: Date.now() - startTime
            };
        }
    }
};

/**
 * File Create Handler
 */
const fileCreateHandler: ActionHandler = {
    type: "file_create",
    async execute(action: Action, context: ActionContext): Promise<ActionResult> {
        const startTime = Date.now();

        try {
            const filePath = resolveSafePath(action.target, context.project_root);

            if (isForbiddenPath(action.target)) {
                return {
                    action_id: action.action_id,
                    status: "failed",
                    error: `Forbidden path: ${action.target}`,
                    duration_ms: Date.now() - startTime
                };
            }

            // Check file doesn't exist
            if (fs.existsSync(filePath)) {
                return {
                    action_id: action.action_id,
                    status: "failed",
                    error: `File already exists: ${action.target}`,
                    duration_ms: Date.now() - startTime
                };
            }

            if (context.dry_run) {
                return {
                    action_id: action.action_id,
                    status: "success",
                    output: `[DRY RUN] Would create: ${action.target}`,
                    duration_ms: Date.now() - startTime
                };
            }

            // Ensure directory exists
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Create file
            const content = (action.parameters.content as string) || "";
            fs.writeFileSync(filePath, content, "utf-8");

            return {
                action_id: action.action_id,
                status: "success",
                output: `Created: ${action.target}`,
                duration_ms: Date.now() - startTime
            };

        } catch (error) {
            return {
                action_id: action.action_id,
                status: "failed",
                error: error instanceof Error ? error.message : String(error),
                duration_ms: Date.now() - startTime
            };
        }
    }
};

/**
 * File Delete Handler
 */
const fileDeleteHandler: ActionHandler = {
    type: "file_delete",
    async execute(action: Action, context: ActionContext): Promise<ActionResult> {
        const startTime = Date.now();

        try {
            const filePath = resolveSafePath(action.target, context.project_root);

            if (isForbiddenPath(action.target)) {
                return {
                    action_id: action.action_id,
                    status: "failed",
                    error: `Forbidden path: ${action.target}`,
                    duration_ms: Date.now() - startTime
                };
            }

            // Check file exists
            if (!fs.existsSync(filePath)) {
                return {
                    action_id: action.action_id,
                    status: "failed",
                    error: `File not found: ${action.target}`,
                    duration_ms: Date.now() - startTime
                };
            }

            if (context.dry_run) {
                return {
                    action_id: action.action_id,
                    status: "success",
                    output: `[DRY RUN] Would delete: ${action.target}`,
                    duration_ms: Date.now() - startTime
                };
            }

            // Backup before delete
            if (context.backup_enabled) {
                backupFile(filePath, context.backup_dir);
            }

            // Delete file
            fs.unlinkSync(filePath);

            return {
                action_id: action.action_id,
                status: "success",
                output: `Deleted: ${action.target}`,
                duration_ms: Date.now() - startTime
            };

        } catch (error) {
            return {
                action_id: action.action_id,
                status: "failed",
                error: error instanceof Error ? error.message : String(error),
                duration_ms: Date.now() - startTime
            };
        }
    }
};

/**
 * File Write Handler (overwrite)
 */
const fileWriteHandler: ActionHandler = {
    type: "file_write",
    async execute(action: Action, context: ActionContext): Promise<ActionResult> {
        const startTime = Date.now();

        try {
            const filePath = resolveSafePath(action.target, context.project_root);

            if (isForbiddenPath(action.target)) {
                return {
                    action_id: action.action_id,
                    status: "failed",
                    error: `Forbidden path: ${action.target}`,
                    duration_ms: Date.now() - startTime
                };
            }

            if (context.dry_run) {
                return {
                    action_id: action.action_id,
                    status: "success",
                    output: `[DRY RUN] Would write: ${action.target}`,
                    duration_ms: Date.now() - startTime
                };
            }

            // Backup if exists
            if (context.backup_enabled && fs.existsSync(filePath)) {
                backupFile(filePath, context.backup_dir);
            }

            // Ensure directory exists
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Write file
            const content = (action.parameters.content as string) || "";
            fs.writeFileSync(filePath, content, "utf-8");

            return {
                action_id: action.action_id,
                status: "success",
                output: `Wrote: ${action.target}`,
                duration_ms: Date.now() - startTime
            };

        } catch (error) {
            return {
                action_id: action.action_id,
                status: "failed",
                error: error instanceof Error ? error.message : String(error),
                duration_ms: Date.now() - startTime
            };
        }
    }
};

/**
 * File Modify Handler (partial update)
 */
const fileModifyHandler: ActionHandler = {
    type: "file_modify",
    async execute(action: Action, context: ActionContext): Promise<ActionResult> {
        // Same as code_edit for now
        return codeEditHandler.execute(action, context);
    }
};

/**
 * Test Run Handler
 * Note: Limited command execution, no arbitrary shell
 */
const testRunHandler: ActionHandler = {
    type: "test_run",
    async execute(action: Action, context: ActionContext): Promise<ActionResult> {
        const startTime = Date.now();

        if (context.dry_run) {
            return {
                action_id: action.action_id,
                status: "success",
                output: "[DRY RUN] Would run tests",
                duration_ms: Date.now() - startTime
            };
        }

        // In air-gapped mode, we simulate test execution
        // Real implementation would use a sandboxed test runner
        return {
            action_id: action.action_id,
            status: "success",
            output: "Tests simulated (air-gapped mode)",
            duration_ms: Date.now() - startTime
        };
    }
};

/**
 * Lint Run Handler
 */
const lintRunHandler: ActionHandler = {
    type: "lint_run",
    async execute(action: Action, context: ActionContext): Promise<ActionResult> {
        const startTime = Date.now();

        if (context.dry_run) {
            return {
                action_id: action.action_id,
                status: "success",
                output: "[DRY RUN] Would run linter",
                duration_ms: Date.now() - startTime
            };
        }

        // In air-gapped mode, we simulate lint execution
        return {
            action_id: action.action_id,
            status: "success",
            output: "Lint simulated (air-gapped mode)",
            duration_ms: Date.now() - startTime
        };
    }
};

/**
 * Build Run Handler
 */
const buildRunHandler: ActionHandler = {
    type: "build_run",
    async execute(action: Action, context: ActionContext): Promise<ActionResult> {
        const startTime = Date.now();

        if (context.dry_run) {
            return {
                action_id: action.action_id,
                status: "success",
                output: "[DRY RUN] Would run build",
                duration_ms: Date.now() - startTime
            };
        }

        // In air-gapped mode, we simulate build execution
        return {
            action_id: action.action_id,
            status: "success",
            output: "Build simulated (air-gapped mode)",
            duration_ms: Date.now() - startTime
        };
    }
};

/**
 * Shell Exec Handler
 * DISABLED in air-gapped mode for security
 */
const shellExecHandler: ActionHandler = {
    type: "shell_exec",
    async execute(action: Action, context: ActionContext): Promise<ActionResult> {
        const startTime = Date.now();

        // Shell execution is DISABLED in air-gapped mode
        return {
            action_id: action.action_id,
            status: "failed",
            error: "shell_exec is disabled in air-gapped mode",
            duration_ms: Date.now() - startTime
        };
    }
};

// ============================================================================
// HANDLER REGISTRY
// ============================================================================

/**
 * Create handler registry with all default handlers
 */
export function createHandlerRegistry(): HandlerRegistry {
    const handlers = new Map<ActionType, ActionHandler>();

    const registry: HandlerRegistry = {
        handlers,

        register(handler: ActionHandler): void {
            handlers.set(handler.type, handler);
        },

        async execute(action: Action, context: ActionContext): Promise<ActionResult> {
            const handler = handlers.get(action.type);

            if (!handler) {
                return {
                    action_id: action.action_id,
                    status: "failed",
                    error: `No handler for action type: ${action.type}`,
                    duration_ms: 0
                };
            }

            return handler.execute(action, context);
        }
    };

    // Register default handlers
    registry.register(codeEditHandler);
    registry.register(fileCreateHandler);
    registry.register(fileDeleteHandler);
    registry.register(fileWriteHandler);
    registry.register(fileModifyHandler);
    registry.register(testRunHandler);
    registry.register(lintRunHandler);
    registry.register(buildRunHandler);
    registry.register(shellExecHandler);

    return registry;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
    resolveSafePath,
    isForbiddenPath,
    backupFile
};
