/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Action Generator
 * ================
 *
 * Generates actions from intent and evidence.
 * Maps user requests to executable actions.
 *
 * Action Types:
 * - code_edit: Edit existing code
 * - file_create: Create new file
 * - file_delete: Delete file
 * - file_write: Write content to file
 * - file_modify: Modify file content
 * - test_run: Run tests
 * - lint_run: Run linter
 * - build_run: Run build
 * - shell_exec: Execute shell command
 */

import crypto from "crypto";
import {
    Action,
    ActionType,
    RiskLevel,
    EvidencePack,
    TaskType
} from "../types/protocol.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface ActionGeneratorConfig {
    /** Default risk for unknown actions */
    defaultRisk: RiskLevel;
    /** Allow shell execution */
    allowShellExec: boolean;
    /** Allow file deletion */
    allowFileDelete: boolean;
    /** Maximum actions per generation */
    maxActions: number;
}

const DEFAULT_CONFIG: ActionGeneratorConfig = {
    defaultRisk: "medium",
    allowShellExec: false,
    allowFileDelete: false,
    maxActions: 20
};

// ============================================================================
// ACTION PATTERNS
// ============================================================================

interface ActionPattern {
    pattern: RegExp;
    type: ActionType;
    risk: RiskLevel;
    rollbackPossible: boolean;
    parameterExtractor: (match: RegExpMatchArray) => Record<string, unknown>;
}

const ACTION_PATTERNS: ActionPattern[] = [
    // Create file patterns
    {
        pattern: /create\s+(?:a\s+)?(?:new\s+)?file\s+(?:called\s+|named\s+)?["']?([^"'\s]+)["']?/gi,
        type: "file_create",
        risk: "low",
        rollbackPossible: true,
        parameterExtractor: (match) => ({ filename: match[1] })
    },

    // Edit file patterns
    {
        pattern: /edit\s+(?:the\s+)?file\s+["']?([^"'\s]+)["']?/gi,
        type: "code_edit",
        risk: "medium",
        rollbackPossible: true,
        parameterExtractor: (match) => ({ filename: match[1] })
    },

    // Modify function patterns
    {
        pattern: /(?:modify|update|change)\s+(?:the\s+)?function\s+["']?(\w+)["']?/gi,
        type: "code_edit",
        risk: "medium",
        rollbackPossible: true,
        parameterExtractor: (match) => ({ function_name: match[1] })
    },

    // Delete file patterns
    {
        pattern: /delete\s+(?:the\s+)?file\s+["']?([^"'\s]+)["']?/gi,
        type: "file_delete",
        risk: "high",
        rollbackPossible: false,
        parameterExtractor: (match) => ({ filename: match[1] })
    },

    // Run tests patterns
    {
        pattern: /run\s+(?:the\s+)?tests?/gi,
        type: "test_run",
        risk: "low",
        rollbackPossible: true,
        parameterExtractor: () => ({})
    },

    // Run lint patterns
    {
        pattern: /run\s+(?:the\s+)?lint(?:er)?/gi,
        type: "lint_run",
        risk: "low",
        rollbackPossible: true,
        parameterExtractor: () => ({})
    },

    // Run build patterns
    {
        pattern: /(?:run\s+)?(?:the\s+)?build/gi,
        type: "build_run",
        risk: "low",
        rollbackPossible: true,
        parameterExtractor: () => ({})
    },

    // Shell command patterns
    {
        pattern: /(?:run|execute)\s+(?:command\s+)?["']?(.+?)["']?$/gi,
        type: "shell_exec",
        risk: "high",
        rollbackPossible: false,
        parameterExtractor: (match) => ({ command: match[1] })
    },

    // Add code patterns
    {
        pattern: /add\s+(?:a\s+)?(?:new\s+)?(?:function|class|method)\s+["']?(\w+)["']?\s+to\s+["']?([^"'\s]+)["']?/gi,
        type: "code_edit",
        risk: "medium",
        rollbackPossible: true,
        parameterExtractor: (match) => ({
            entity_name: match[1],
            filename: match[2]
        })
    },

    // Write content patterns
    {
        pattern: /write\s+(?:to\s+)?(?:the\s+)?file\s+["']?([^"'\s]+)["']?/gi,
        type: "file_write",
        risk: "medium",
        rollbackPossible: true,
        parameterExtractor: (match) => ({ filename: match[1] })
    }
];

// ============================================================================
// ACTION GENERATOR
// ============================================================================

/**
 * Action Generator
 *
 * Generates executable actions from intent and evidence.
 */
export class ActionGenerator {
    private config: ActionGeneratorConfig;

    constructor(config: Partial<ActionGeneratorConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Generate actions from intent text
     */
    generateFromIntent(intent: string, context?: {
        taskType?: TaskType;
        codebaseFiles?: string[];
    }): Action[] {
        const actions: Action[] = [];
        const seenActions = new Set<string>();

        for (const pattern of ACTION_PATTERNS) {
            // Skip disallowed actions
            if (pattern.type === "shell_exec" && !this.config.allowShellExec) {
                continue;
            }
            if (pattern.type === "file_delete" && !this.config.allowFileDelete) {
                continue;
            }

            // Reset pattern
            pattern.pattern.lastIndex = 0;

            let match;
            while ((match = pattern.pattern.exec(intent)) !== null) {
                const parameters = pattern.parameterExtractor(match);
                const target = this.determineTarget(pattern.type, parameters, context);

                // Deduplicate
                const key = `${pattern.type}:${target}`;
                if (seenActions.has(key)) {
                    continue;
                }
                seenActions.add(key);

                actions.push({
                    action_id: this.generateActionId(),
                    type: pattern.type,
                    target,
                    parameters,
                    estimated_risk: pattern.risk,
                    rollback_possible: pattern.rollbackPossible
                });
            }
        }

        return actions.slice(0, this.config.maxActions);
    }

    /**
     * Generate actions from evidence pack
     */
    generateFromEvidence(
        evidence: EvidencePack,
        intent: string
    ): Action[] {
        const context = {
            taskType: evidence.task_type,
            codebaseFiles: evidence.codebase_context?.files_analyzed || []
        };

        const actions = this.generateFromIntent(intent, context);

        // Enhance with evidence context
        for (const action of actions) {
            // Add file context if available
            if (
                ["code_edit", "file_modify", "file_write"].includes(action.type) &&
                evidence.codebase_context?.files_analyzed
            ) {
                // Match action target to analyzed files
                const matchingFile = evidence.codebase_context.files_analyzed.find(
                    f => f.includes(action.target as string) ||
                        (action.parameters.filename as string)?.includes(f)
                );
                if (matchingFile) {
                    action.parameters.matched_file = matchingFile;
                }
            }

            // Add function context if available
            if (
                action.type === "code_edit" &&
                action.parameters.function_name &&
                evidence.codebase_context?.functions_referenced
            ) {
                const matchingFunc = evidence.codebase_context.functions_referenced.find(
                    f => f.function_name === action.parameters.function_name
                );
                if (matchingFunc) {
                    action.parameters.function_context = matchingFunc;
                }
            }
        }

        return actions;
    }

    /**
     * Create action programmatically
     */
    createAction(
        type: ActionType,
        target: string,
        parameters: Record<string, unknown> = {},
        options: {
            risk?: RiskLevel;
            rollbackPossible?: boolean;
        } = {}
    ): Action {
        // Validate type is allowed
        if (type === "shell_exec" && !this.config.allowShellExec) {
            throw new Error("shell_exec actions are not allowed");
        }
        if (type === "file_delete" && !this.config.allowFileDelete) {
            throw new Error("file_delete actions are not allowed");
        }

        return {
            action_id: this.generateActionId(),
            type,
            target,
            parameters,
            estimated_risk: options.risk || this.getRiskForType(type),
            rollback_possible: options.rollbackPossible ?? this.isRollbackPossible(type)
        };
    }

    /**
     * Create code edit action
     */
    createCodeEditAction(
        filePath: string,
        changes: {
            lineStart?: number;
            lineEnd?: number;
            newContent?: string;
            functionName?: string;
        }
    ): Action {
        return this.createAction("code_edit", filePath, changes, {
            risk: "medium",
            rollbackPossible: true
        });
    }

    /**
     * Create file create action
     */
    createFileCreateAction(
        filePath: string,
        content?: string,
        template?: string
    ): Action {
        return this.createAction("file_create", filePath, {
            content,
            template
        }, {
            risk: "low",
            rollbackPossible: true
        });
    }

    /**
     * Create test run action
     */
    createTestRunAction(
        testPath?: string,
        options?: {
            pattern?: string;
            watch?: boolean;
            coverage?: boolean;
        }
    ): Action {
        return this.createAction("test_run", testPath || ".", options || {}, {
            risk: "low",
            rollbackPossible: true
        });
    }

    /**
     * Create build action
     */
    createBuildAction(
        target?: string,
        options?: {
            mode?: "development" | "production";
            watch?: boolean;
        }
    ): Action {
        return this.createAction("build_run", target || ".", options || {}, {
            risk: "low",
            rollbackPossible: true
        });
    }

    /**
     * Get default risk for action type
     */
    private getRiskForType(type: ActionType): RiskLevel {
        const riskMap: Record<ActionType, RiskLevel> = {
            code_edit: "medium",
            file_create: "low",
            file_delete: "high",
            file_write: "medium",
            file_modify: "medium",
            test_run: "low",
            lint_run: "low",
            build_run: "low",
            shell_exec: "high"
        };
        return riskMap[type] || this.config.defaultRisk;
    }

    /**
     * Check if action type can be rolled back
     */
    private isRollbackPossible(type: ActionType): boolean {
        const noRollback: ActionType[] = ["file_delete", "shell_exec"];
        return !noRollback.includes(type);
    }

    /**
     * Determine action target
     */
    private determineTarget(
        type: ActionType,
        parameters: Record<string, unknown>,
        context?: { codebaseFiles?: string[] }
    ): string {
        if (parameters.filename) {
            return parameters.filename as string;
        }

        if (parameters.function_name && context?.codebaseFiles) {
            // Try to find file containing the function
            // In a real implementation, this would search the codebase
            return context.codebaseFiles[0] || "unknown";
        }

        // Default targets by type
        const defaultTargets: Partial<Record<ActionType, string>> = {
            test_run: ".",
            lint_run: ".",
            build_run: ".",
            shell_exec: "shell"
        };

        return defaultTargets[type] || "unknown";
    }

    /**
     * Generate unique action ID
     */
    private generateActionId(): string {
        return `action_${crypto.randomUUID().substring(0, 8)}`;
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create action generator
 */
export function createActionGenerator(
    config?: Partial<ActionGeneratorConfig>
): ActionGenerator {
    return new ActionGenerator(config);
}
