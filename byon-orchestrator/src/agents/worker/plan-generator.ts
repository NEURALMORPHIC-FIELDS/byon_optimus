/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Worker Plan Generator
 * =====================
 *
 * Generates PlanDraft documents from EvidencePacks.
 * Creates actionable plans based on gathered evidence.
 *
 * IMPORTANT:
 * - Plans are DRAFTS - Auditor validates before execution
 * - Risk assessment is preliminary - Auditor re-evaluates
 * - Actions must be specific and reversible when possible
 */

import * as crypto from "crypto";
import {
    EvidencePack,
    PlanDraft,
    Action,
    ActionType,
    RiskLevel,
    MemoryContext,
    TaskType
} from "../../types/protocol.js";
import { getAIProcessor, getTradingClient, type AIResponse } from "./ai-processor.js";

// ============================================================================
// TYPES
// ============================================================================

export interface PlanGeneratorConfig {
    /** Maximum actions per plan */
    max_actions: number;
    /** Default risk level for unknown actions */
    default_risk: RiskLevel;
    /** Enable action bundling (group related actions) */
    bundle_actions: boolean;
    /** Maximum estimated iterations */
    max_iterations: number;
}

export interface GeneratePlanOptions {
    /** Intent description */
    intent: string;
    /** Requested actions */
    actions: RequestedAction[];
    /** Override risk level */
    risk_override?: RiskLevel;
    /** Additional constraints */
    constraints?: {
        max_iterations?: number;
        timeout_minutes?: number;
    };
}

export interface RequestedAction {
    type: ActionType;
    target: string;
    parameters?: Record<string, unknown>;
    description?: string;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: PlanGeneratorConfig = {
    max_actions: 20,
    default_risk: "medium",
    bundle_actions: true,
    max_iterations: 5
};

// ============================================================================
// RISK ASSESSMENT
// ============================================================================

const ACTION_RISK_MAP: Record<ActionType, RiskLevel> = {
    "code_edit": "medium",
    "file_create": "low",
    "file_delete": "high",
    "file_write": "medium",
    "file_modify": "medium",
    "test_run": "low",
    "lint_run": "low",
    "build_run": "low",
    "shell_exec": "high"
};

const RISK_WEIGHTS: Record<RiskLevel, number> = {
    "low": 1,
    "medium": 2,
    "high": 3
};

// ============================================================================
// PLAN GENERATOR
// ============================================================================

/**
 * Plan Generator
 *
 * Creates PlanDraft documents from EvidencePacks.
 */
export class PlanGenerator {
    private config: PlanGeneratorConfig;

    constructor(config: Partial<PlanGeneratorConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Generate a PlanDraft from EvidencePack
     */
    generate(evidence: EvidencePack, options: GeneratePlanOptions): PlanDraft {
        // Validate action count
        if (options.actions.length > this.config.max_actions) {
            throw new Error(
                `Too many actions: ${options.actions.length} > ${this.config.max_actions}`
            );
        }

        // Convert requested actions to full Action objects
        const actions = this.buildActions(options.actions);

        // Calculate overall risk
        const riskLevel = options.risk_override || this.calculateRisk(actions);

        // Calculate rollback possibility
        const rollbackPossible = this.canRollback(actions);

        // Estimate iterations
        const estimatedIterations = this.estimateIterations(
            actions,
            options.constraints?.max_iterations
        );

        // Build plan
        const planId = `plan_${crypto.randomUUID().replace(/-/g, "")}`;
        const timestamp = new Date().toISOString();

        const plan: Omit<PlanDraft, "hash"> = {
            document_type: "PLAN_DRAFT",
            document_version: "1.0",
            plan_id: planId,
            timestamp,
            based_on_evidence: evidence.evidence_id,
            intent: options.intent,
            actions,
            risk_level: riskLevel,
            rollback_possible: rollbackPossible,
            estimated_iterations: estimatedIterations,
            memory_context: evidence.memory_context
        };

        // Calculate hash
        const hash = this.calculateHash(plan);

        return {
            ...plan,
            hash
        };
    }

    /**
     * Generate plan for common task patterns
     */
    generateForTaskType(
        evidence: EvidencePack,
        taskType: TaskType,
        intent: string
    ): PlanDraft | null {
        switch (taskType) {
            case "coding":
                return this.generateCodingPlan(evidence, intent);
            case "general":
                return this.generateGeneralPlan(evidence, intent);
            default:
                return null;
        }
    }

    /**
     * Generate coding task plan - NOW WITH AI!
     */
    private generateCodingPlan(evidence: EvidencePack, intent: string): PlanDraft {
        const actions: RequestedAction[] = [];

        // Check if AI is available - if so, we'll create a file_write action
        // with AI-generated content (processed async later)
        const aiProcessor = getAIProcessor();
        if (aiProcessor.isAvailable()) {
            // Create action to write AI-generated code
            actions.push({
                type: "file_write",
                target: "output/ai_generated_code.txt",
                parameters: {
                    ai_task: true,
                    task_type: "coding",
                    original_intent: intent,
                    content: `[AI Processing Required]\nIntent: ${intent}\nThis content will be replaced with AI-generated code during execution.`
                },
                description: "Write AI-generated code"
            });
        }

        // Analyze codebase context for file modifications
        if (evidence.codebase_context.files_analyzed.length > 0) {
            for (const file of evidence.codebase_context.files_analyzed) {
                actions.push({
                    type: "code_edit",
                    target: file,
                    description: `Edit ${file} based on intent`
                });
            }
        }

        // Add test run if tests detected
        if (evidence.codebase_context.patterns_detected.includes("test_files")) {
            actions.push({
                type: "test_run",
                target: ".",
                description: "Run tests after changes"
            });
        }

        // Add lint if linter detected
        if (evidence.codebase_context.patterns_detected.includes("linter_config")) {
            actions.push({
                type: "lint_run",
                target: ".",
                description: "Run linter after changes"
            });
        }

        // Fallback if no actions
        if (actions.length === 0) {
            actions.push({
                type: "file_write",
                target: "output/task_output.txt",
                parameters: {
                    content: `Coding task: ${intent}\n\n[Processing required]`
                },
                description: "Task output placeholder"
            });
        }

        return this.generate(evidence, {
            intent,
            actions
        });
    }

    /**
     * Generate AI-powered plan with actual content
     */
    async generateWithAI(evidence: EvidencePack, taskContent: string): Promise<PlanDraft> {
        const aiProcessor = getAIProcessor();
        const taskType = aiProcessor.detectTaskType(taskContent);

        console.log(`[PlanGenerator] AI processing task type: ${taskType}`);

        // Process with AI
        const aiResponse = await aiProcessor.processTask({
            taskId: evidence.evidence_id,
            taskType,
            content: taskContent,
            priority: "high",
            memoryContext: {
                relevantFacts: evidence.extracted_facts.map(f => f.content),
                previousTasks: []
            }
        });

        const actions: RequestedAction[] = [];

        if (aiResponse.success) {
            // Determine output filename based on task type
            let filename = "output/ai_result.txt";
            let content = aiResponse.result.content;

            if (taskType === "coding" && aiResponse.result.code) {
                filename = "output/generated_code.py";
                content = aiResponse.result.code;
            } else if (taskType === "analysis") {
                filename = "output/analysis_report.json";
                content = aiResponse.result.analysis
                    ? JSON.stringify(aiResponse.result.analysis, null, 2)
                    : aiResponse.result.content;
            } else if (taskType === "planning") {
                filename = "output/implementation_plan.md";
            } else if (taskType === "trading") {
                filename = "output/trading_analysis.json";
            }

            actions.push({
                type: "file_write",
                target: filename,
                parameters: {
                    content,
                    ai_generated: true,
                    task_type: taskType,
                    tokens_used: aiResponse.tokens.input + aiResponse.tokens.output
                },
                description: `AI-generated ${taskType} output`
            });
        } else {
            // Fallback if AI fails
            actions.push({
                type: "file_write",
                target: "output/error.txt",
                parameters: {
                    content: `AI processing failed: ${aiResponse.error}\n\nOriginal task: ${taskContent}`
                },
                description: "Error output"
            });
        }

        return this.generate(evidence, {
            intent: `[AI ${taskType}] ${taskContent.substring(0, 100)}...`,
            actions
        });
    }

    /**
     * Generate trading data analysis plan
     */
    async generateTradingPlan(evidence: EvidencePack, coins: string[]): Promise<PlanDraft> {
        const tradingClient = getTradingClient();
        const actions: RequestedAction[] = [];

        try {
            // Fetch real market data
            const marketData = await tradingClient.getMarketData(coins);

            if (marketData.length > 0) {
                actions.push({
                    type: "file_write",
                    target: "output/market_data.json",
                    parameters: {
                        content: JSON.stringify(marketData, null, 2),
                        source: "coingecko",
                        coins,
                        timestamp: new Date().toISOString()
                    },
                    description: "Write live market data"
                });

                // If AI is available, add analysis
                const aiProcessor = getAIProcessor();
                if (aiProcessor.isAvailable()) {
                    const analysis = await aiProcessor.processTask({
                        taskId: `trading_${Date.now()}`,
                        taskType: "trading",
                        content: `Analyze this cryptocurrency market data and provide insights:\n${JSON.stringify(marketData, null, 2)}`,
                        priority: "high"
                    });

                    if (analysis.success) {
                        actions.push({
                            type: "file_write",
                            target: "output/trading_analysis.md",
                            parameters: {
                                content: analysis.result.content,
                                ai_generated: true
                            },
                            description: "AI trading analysis"
                        });
                    }
                }
            }
        } catch (error) {
            console.error(`[PlanGenerator] Trading data fetch failed: ${error}`);
            actions.push({
                type: "file_write",
                target: "output/trading_error.txt",
                parameters: {
                    content: `Failed to fetch trading data: ${error}`
                },
                description: "Trading error log"
            });
        }

        return this.generate(evidence, {
            intent: `Trading analysis for: ${coins.join(", ")}`,
            actions
        });
    }

    /**
     * Generate general task plan
     */
    private generateGeneralPlan(evidence: EvidencePack, intent: string): PlanDraft {
        // For general tasks, create minimal plan
        const actions: RequestedAction[] = [];

        // If facts suggest file creation
        for (const fact of evidence.extracted_facts) {
            if (fact.tags?.includes("create_file")) {
                actions.push({
                    type: "file_create",
                    target: fact.content,
                    description: "Create file as requested"
                });
            }
        }

        return this.generate(evidence, {
            intent,
            actions: actions.length > 0 ? actions : [{
                type: "file_create",
                target: "output.txt",
                description: "General output"
            }]
        });
    }

    /**
     * Build full Action objects from RequestedActions
     */
    private buildActions(requested: RequestedAction[]): Action[] {
        return requested.map((req, index) => ({
            action_id: `action_${index + 1}`,
            type: req.type,
            target: req.target,
            parameters: req.parameters || {},
            estimated_risk: this.getActionRisk(req),
            rollback_possible: this.isRollbackable(req.type)
        }));
    }

    /**
     * Get risk level for action
     */
    private getActionRisk(action: RequestedAction): RiskLevel {
        const baseRisk = ACTION_RISK_MAP[action.type] || this.config.default_risk;

        // Increase risk for certain targets
        if (this.isHighRiskTarget(action.target)) {
            return "high";
        }

        return baseRisk;
    }

    /**
     * Check if target is high risk
     */
    private isHighRiskTarget(target: string): boolean {
        const highRiskPatterns = [
            /\.env/i,
            /secret/i,
            /credential/i,
            /password/i,
            /config\.(prod|production)/i,
            /package-lock\.json/i,
            /pnpm-lock\.yaml/i,
            /yarn\.lock/i
        ];

        return highRiskPatterns.some(p => p.test(target));
    }

    /**
     * Check if action type is rollbackable
     */
    private isRollbackable(type: ActionType): boolean {
        const rollbackable: ActionType[] = [
            "code_edit",
            "file_create",
            "file_write",
            "file_modify"
        ];

        return rollbackable.includes(type);
    }

    /**
     * Calculate overall risk level for plan
     */
    private calculateRisk(actions: Action[]): RiskLevel {
        if (actions.length === 0) return "low";

        // Calculate weighted average risk
        let totalWeight = 0;
        let weightedSum = 0;

        for (const action of actions) {
            const weight = RISK_WEIGHTS[action.estimated_risk];
            weightedSum += weight;
            totalWeight++;
        }

        const avgRisk = weightedSum / totalWeight;

        // Any high-risk action makes the whole plan high risk
        if (actions.some(a => a.estimated_risk === "high")) {
            return "high";
        }

        if (avgRisk > 1.5) return "medium";
        return "low";
    }

    /**
     * Check if plan can be rolled back
     */
    private canRollback(actions: Action[]): boolean {
        // All actions must be rollbackable for full rollback
        return actions.every(a => a.rollback_possible);
    }

    /**
     * Estimate iterations needed
     */
    private estimateIterations(
        actions: Action[],
        maxOverride?: number
    ): number {
        const max = maxOverride || this.config.max_iterations;

        // Base: 1 iteration per action
        let estimate = Math.ceil(actions.length / 3);

        // Add iterations for testing/building
        const hasTests = actions.some(a => a.type === "test_run");
        const hasBuild = actions.some(a => a.type === "build_run");

        if (hasTests) estimate += 1;
        if (hasBuild) estimate += 1;

        // Cap at max
        return Math.min(estimate, max);
    }

    /**
     * Calculate SHA256 hash of plan
     */
    private calculateHash(plan: Omit<PlanDraft, "hash">): string {
        const content = JSON.stringify(plan, Object.keys(plan).sort());
        return crypto.createHash("sha256").update(content).digest("hex");
    }

    /**
     * Validate plan draft
     */
    validate(plan: PlanDraft): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!plan.plan_id) {
            errors.push("Missing plan_id");
        }

        if (!plan.based_on_evidence) {
            errors.push("Missing based_on_evidence reference");
        }

        if (!plan.actions || plan.actions.length === 0) {
            errors.push("Plan has no actions");
        }

        if (plan.actions.length > this.config.max_actions) {
            errors.push(`Too many actions: ${plan.actions.length}`);
        }

        // Verify hash
        const { hash, ...rest } = plan;
        const expectedHash = this.calculateHash(rest);
        if (hash !== expectedHash) {
            errors.push("Hash mismatch - plan may have been modified");
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Merge multiple plans into one
     */
    merge(
        plans: PlanDraft[],
        newIntent: string,
        baseEvidence: EvidencePack
    ): PlanDraft {
        // Collect all actions
        const allActions: RequestedAction[] = [];

        for (const plan of plans) {
            for (const action of plan.actions) {
                allActions.push({
                    type: action.type,
                    target: action.target,
                    parameters: action.parameters
                });
            }
        }

        return this.generate(baseEvidence, {
            intent: newIntent,
            actions: allActions
        });
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create plan generator
 */
export function createPlanGenerator(
    config?: Partial<PlanGeneratorConfig>
): PlanGenerator {
    return new PlanGenerator(config);
}

/**
 * Quick plan generation helper
 */
export function generateQuickPlan(
    evidence: EvidencePack,
    intent: string,
    actions: RequestedAction[]
): PlanDraft {
    const generator = new PlanGenerator();
    return generator.generate(evidence, { intent, actions });
}
