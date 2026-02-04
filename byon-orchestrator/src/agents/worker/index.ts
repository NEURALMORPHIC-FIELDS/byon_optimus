/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON Worker Agent
 * =================
 *
 * Main Worker agent for MACP v1.1 (Multi-Agent Control Protocol).
 *
 * Responsibilities:
 * - Monitor inbox for messages (via OpenClaw)
 * - Parse events and extract facts
 * - Search memory for context (FHRSS+FCPE)
 * - Generate evidence packs
 * - Create plan drafts
 * - Hand off to Auditor for validation
 *
 * ARCHITECTURE:
 * - OpenClaw = SINGLE communication platform
 * - BYON = Orchestrator (Worker + Auditor + Executor)
 * - Worker does NOT execute - only plans
 *
 * Patent: FHRSS/OmniVault - Vasile Lucian Borbeleac - EP25216372.0
 */

import * as crypto from "crypto";
import * as path from "path";
import { AuditService, createAuditService } from "../../audit/audit-service.js";

import {
    EvidencePack,
    PlanDraft,
    Source,
    ExtractedFact,
    TaskType,
    MemoryContext,
    CodebaseContext
} from "../../types/protocol.js";

// Worker components
import {
    InboxWatcher,
    InboxMessage,
    createInboxWatcher,
    InboxWatcherConfig
} from "./inbox-watcher.js";
import {
    PlanGenerator,
    createPlanGenerator,
    RequestedAction
} from "./plan-generator.js";
import { getAIProcessor } from "./ai-processor.js";
import {
    MemoryHandler,
    createMemoryHandler,
    createEmptyMemoryContext
} from "./memory-handler.js";
import {
    buildEvidence,
    initializeGMVStore,
    attachGlobalMemoryHint,
    getContextBias,
    checkPotentialRedundancy
} from "./evidence-builder.js";

// ============================================================================
// TYPES
// ============================================================================

export interface WorkerConfig {
    /** Worker ID */
    worker_id: string;
    /** Inbox configuration */
    inbox: Partial<InboxWatcherConfig>;
    /** Enable GMV integration */
    enable_gmv: boolean;
    /** GMV database path */
    gmv_db_path?: string;
    /** Auto-start inbox watcher */
    auto_start: boolean;
    /** Audit log path */
    audit_path?: string;
}

export interface WorkerState {
    status: "idle" | "processing" | "waiting" | "error";
    current_message_id: string | null;
    last_evidence_id: string | null;
    last_plan_id: string | null;
    processed_count: number;
    error_count: number;
}

export interface ProcessingResult {
    success: boolean;
    message_id: string;
    evidence?: EvidencePack;
    plan?: PlanDraft;
    error?: string;
}

export interface WorkerEvents {
    onMessageReceived?: (message: InboxMessage) => void;
    onEvidenceBuilt?: (evidence: EvidencePack) => void;
    onPlanGenerated?: (plan: PlanDraft, evidence: EvidencePack) => void;
    onError?: (error: Error, messageId?: string) => void;
    onHandoff?: (plan: PlanDraft, evidence: EvidencePack) => void | Promise<void>;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: WorkerConfig = {
    worker_id: "worker_main",
    inbox: {},
    enable_gmv: true,
    auto_start: false,
    audit_path: "./audit_logs/worker"
};

// ============================================================================
// WORKER AGENT
// ============================================================================

/**
 * BYON Worker Agent
 *
 * Orchestrates message processing, evidence building, and plan generation.
 * 
 * ENTERPRISE FEATURES:
 * - Comprehensive Audit Logging
 * - Integrity Checks
 */
export class WorkerAgent {
    private config: WorkerConfig;
    private events: WorkerEvents;
    private inboxWatcher: InboxWatcher;
    private planGenerator: PlanGenerator;
    private memoryHandler: MemoryHandler;
    private auditService: AuditService;
    private state: WorkerState;

    constructor(
        config: Partial<WorkerConfig> = {},
        events: WorkerEvents = {}
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.events = events;

        // Initialize state
        this.state = {
            status: "idle",
            current_message_id: null,
            last_evidence_id: null,
            last_plan_id: null,
            processed_count: 0,
            error_count: 0
        };

        // Initialize components
        this.planGenerator = createPlanGenerator();
        this.memoryHandler = createMemoryHandler();
        
        // Initialize Audit Service
        const auditDir = this.config.audit_path ? path.resolve(this.config.audit_path) : path.resolve("./audit_logs/worker");
        this.auditService = createAuditService({
            persistencePath: auditDir,
            syncOnWrite: true
        });

        // Initialize inbox watcher
        this.inboxWatcher = createInboxWatcher(
            this.config.inbox,
            {
                onMessage: (msg) => this.handleMessage(msg),
                onError: (err, path) => this.handleInboxError(err, path)
            }
        );

        // Initialize GMV if enabled
        if (this.config.enable_gmv) {
            initializeGMVStore(this.config.gmv_db_path);
        }

        // Auto-start if configured
        if (this.config.auto_start) {
            this.start();
        }
        
        this.auditService.logSystemEvent("worker_started", {
            worker_id: this.config.worker_id,
            config: { ...this.config, inbox: "REDACTED" }
        });
    }

    /**
     * Start Worker agent
     */
    start(): void {
        this.inboxWatcher.start();
        this.state.status = "waiting";
        this.auditService.logSystemEvent("worker_listening", { status: "waiting" });
    }

    /**
     * Stop Worker agent
     */
    stop(): void {
        this.inboxWatcher.stop();
        this.state.status = "idle";
        this.auditService.logSystemEvent("worker_stopped", { status: "idle" });
    }

    /**
     * Get current state
     */
    getState(): WorkerState {
        return { ...this.state };
    }

    /**
     * Process a message directly (bypassing inbox)
     */
    async processMessage(
        content: string,
        source: string = "direct",
        taskType: TaskType = "general"
    ): Promise<ProcessingResult> {
        const message: InboxMessage = {
            message_id: `direct_${Date.now()}`,
            received_at: new Date().toISOString(),
            source,
            type: "user_request",
            content,
            payload: { content }
        };

        return this.handleMessage(message, taskType);
    }

    /**
     * Handle incoming message
     */
    private async handleMessage(
        message: InboxMessage,
        taskTypeOverride?: TaskType
    ): Promise<ProcessingResult> {
        this.state.status = "processing";
        this.state.current_message_id = message.message_id;
        
        // AUDIT: Message Received
        this.auditService.logSystemEvent("message_processing_started", {
            message_id: message.message_id,
            source: message.source,
            timestamp: new Date().toISOString()
        });

        try {
            // Notify event handler
            this.events.onMessageReceived?.(message);

            // Step 1: Detect task type
            const taskType = taskTypeOverride || this.detectTaskType(message);

            // Step 2: Check for redundancy (GMV hint)
            const redundancy = checkPotentialRedundancy(message.content);
            if (redundancy.possibly_redundant) {
                // Log but continue - let Auditor decide
                console.log(`Potential redundancy detected: ${redundancy.reason}`);
                this.auditService.logSystemEvent("redundancy_detected", {
                    message_id: message.message_id,
                    reason: redundancy.reason
                });
            }

            // Step 3: Extract facts from message
            const facts = this.extractFacts(message);

            // Step 4: Build sources
            const sources = this.buildSources(message);

            // Step 5: Get memory context
            const memoryContext = await this.getMemoryContext(message, taskType);

            // Step 6: Build codebase context (if coding task)
            const codebaseContext = taskType === "coding"
                ? this.buildCodebaseContext(message)
                : this.emptyCodebaseContext();

            // Step 7: Build EvidencePack
            const evidence = buildEvidence({
                taskType,
                sources,
                facts,
                memoryContext,
                codebaseContext,
                includeGMVHint: this.config.enable_gmv
            });
            
            // AUDIT: Evidence Created
            this.auditService.logDocumentCreated(
                evidence.evidence_id,
                "EVIDENCE_PACK",
                { hash: evidence.hash, task_type: evidence.task_type },
                this.config.worker_id
            );

            this.state.last_evidence_id = evidence.evidence_id;
            this.events.onEvidenceBuilt?.(evidence);

            // Step 8: Generate PlanDraft (with AI if available)
            const intent = this.extractIntent(message);
            const aiProcessor = getAIProcessor();

            let plan: PlanDraft;

            // Use AI processing if available and task is suitable
            if (aiProcessor.isAvailable() && (taskType === "coding" || taskType === "general")) {
                console.log(`[Worker] Using AI processor for ${taskType} task`);
                try {
                    plan = await this.planGenerator.generateWithAI(evidence, message.content);
                } catch (aiError) {
                    console.warn(`[Worker] AI processing failed, falling back to standard: ${aiError}`);
                    const actions = this.inferActions(message, taskType, facts);
                    plan = this.planGenerator.generate(evidence, { intent, actions });
                }
            } else {
                // Standard plan generation
                const actions = this.inferActions(message, taskType, facts);
                plan = this.planGenerator.generate(evidence, { intent, actions });
            }
            
            // AUDIT: Plan Created
            this.auditService.logDocumentCreated(
                plan.plan_id,
                "PLAN_DRAFT",
                { hash: plan.hash, intent_summary: intent.substring(0, 50) },
                this.config.worker_id
            );

            this.state.last_plan_id = plan.plan_id;
            this.events.onPlanGenerated?.(plan, evidence);

            // Step 9: Store in memory for future reference
            await this.storeInMemory(message, evidence, plan);

            // Step 10: Hand off to Auditor
            if (this.events.onHandoff) {
                await this.events.onHandoff(plan, evidence);
                
                // AUDIT: Handoff
                this.auditService.logSystemEvent("handoff_completed", {
                    plan_id: plan.plan_id,
                    evidence_id: evidence.evidence_id,
                    target: "auditor"
                });
            }

            // Update state
            this.state.processed_count++;
            this.state.status = "waiting";
            this.state.current_message_id = null;

            return {
                success: true,
                message_id: message.message_id,
                evidence,
                plan
            };

        } catch (error) {
            this.state.error_count++;
            this.state.status = "error";

            const err = error instanceof Error ? error : new Error(String(error));
            this.events.onError?.(err, message.message_id);
            
            // AUDIT: Error
            this.auditService.logError("worker", this.config.worker_id, err.message, {
                message_id: message.message_id,
                phase: "processing"
            });

            return {
                success: false,
                message_id: message.message_id,
                error: err.message
            };
        }
    }

    /**
     * Handle inbox error
     */
    private handleInboxError(error: Error, filePath?: string): void {
        this.state.error_count++;
        this.events.onError?.(error, filePath);
        this.auditService.logError("worker", "inbox_watcher", error.message, { file: filePath });
    }

    /**
     * Detect task type from message
     */
    private detectTaskType(message: InboxMessage): TaskType {
        const content = message.content.toLowerCase();

        // Coding indicators
        const codingPatterns = [
            /\b(code|fix|bug|implement|function|class|method|refactor)\b/,
            /\b(edit|modify|create|delete)\s+file\b/,
            /\b(typescript|javascript|python|rust|go)\b/,
            /\.(ts|js|py|rs|go|java|cpp|c)\b/
        ];

        if (codingPatterns.some(p => p.test(content))) {
            return "coding";
        }

        // Scheduling indicators
        const schedulingPatterns = [
            /\b(schedule|remind|calendar|meeting|appointment)\b/,
            /\b(at|on)\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/i
        ];

        if (schedulingPatterns.some(p => p.test(content))) {
            return "scheduling";
        }

        // Messaging indicators
        const messagingPatterns = [
            /\b(send|email|message|notify|slack|discord)\b/,
            /\b(to|cc|bcc)\s+\w+@\w+\.\w+\b/
        ];

        if (messagingPatterns.some(p => p.test(content))) {
            return "messaging";
        }

        return "general";
    }

    /**
     * Extract facts from message
     */
    private extractFacts(message: InboxMessage): ExtractedFact[] {
        const facts: ExtractedFact[] = [];
        const content = message.content;

        // Extract file paths
        const filePathPattern = /(?:^|\s)([\w./-]+\.(ts|js|py|json|md|yaml|yml))\b/g;
        let match;
        while ((match = filePathPattern.exec(content)) !== null) {
            facts.push({
                fact_id: `fact_file_${facts.length + 1}`,
                content: match[1],
                confidence: 0.9,
                source_refs: [message.message_id],
                tags: ["file_path", "identified"]
            });
        }

        // Extract function/class names
        const identifierPattern = /\b(function|class|method|variable)\s+(\w+)\b/gi;
        while ((match = identifierPattern.exec(content)) !== null) {
            facts.push({
                fact_id: `fact_ident_${facts.length + 1}`,
                content: match[2],
                confidence: 0.85,
                source_refs: [message.message_id],
                tags: [match[1].toLowerCase(), "identified"]
            });
        }

        // Extract quoted strings as important content
        const quotedPattern = /"([^"]+)"|'([^']+)'|`([^`]+)`/g;
        while ((match = quotedPattern.exec(content)) !== null) {
            const quoted = match[1] || match[2] || match[3];
            if (quoted.length > 3) {
                facts.push({
                    fact_id: `fact_quoted_${facts.length + 1}`,
                    content: quoted,
                    confidence: 0.8,
                    source_refs: [message.message_id],
                    tags: ["quoted", "user_specified"]
                });
            }
        }

        return facts;
    }

    /**
     * Build sources from message
     */
    private buildSources(message: InboxMessage): Source[] {
        const sources: Source[] = [];

        // Main message source
        sources.push({
            type: message.type === "user_request" ? "user_input" : "message",
            identifier: message.message_id,
            timestamp: message.received_at,
            content_hash: this.hashContent(message.content)
        });

        // Add file source if from file
        if (message.file_path) {
            sources.push({
                type: "file",
                identifier: message.file_path,
                timestamp: message.received_at
            });
        }

        return sources;
    }

    /**
     * Get memory context for message
     */
    private async getMemoryContext(
        message: InboxMessage,
        taskType: TaskType
    ): Promise<MemoryContext> {
        // Get context bias from GMV if available
        const bias = getContextBias();

        // Build search queries based on message content
        const conversationQuery = message.content;
        const codeQuery = taskType === "coding"
            ? message.content
            : "";
        const factQuery = message.content.split(" ").slice(0, 5).join(" ");

        // Search memory
        const context = this.memoryHandler.buildContext(
            conversationQuery,
            codeQuery,
            factQuery
        );

        return context;
    }

    /**
     * Build codebase context
     */
    private buildCodebaseContext(message: InboxMessage): CodebaseContext {
        // In real implementation, this would analyze the codebase
        // For now, extract hints from message
        const filesAnalyzed: string[] = [];
        const content = message.content;

        // Extract file paths mentioned
        const filePattern = /(?:^|\s)([\w./-]+\.(ts|js|py|json|md))\b/g;
        let match;
        while ((match = filePattern.exec(content)) !== null) {
            filesAnalyzed.push(match[1]);
        }

        return {
            files_analyzed: filesAnalyzed,
            functions_referenced: [],
            dependencies_identified: [],
            patterns_detected: []
        };
    }

    /**
     * Empty codebase context
     */
    private emptyCodebaseContext(): CodebaseContext {
        return {
            files_analyzed: [],
            functions_referenced: [],
            dependencies_identified: [],
            patterns_detected: []
        };
    }

    /**
     * Extract intent from message
     */
    private extractIntent(message: InboxMessage): string {
        // Use first sentence or first 100 chars as intent
        const content = message.content;
        const firstSentence = content.split(/[.!?]/)[0];

        if (firstSentence.length <= 100) {
            return firstSentence.trim();
        }

        return content.substring(0, 100).trim() + "...";
    }

    /**
     * Infer actions from message and facts
     *
     * IMPORTANT: Always returns at least one action for Auditor validation.
     * Actions determine what the Executor will do.
     */
    private inferActions(
        message: InboxMessage,
        taskType: TaskType,
        facts: ExtractedFact[]
    ): RequestedAction[] {
        const actions: RequestedAction[] = [];
        const content = message.content.toLowerCase();

        // Get file paths from facts
        const filePaths = facts
            .filter(f => f.tags?.includes("file_path"))
            .map(f => f.content);

        // Pattern matching for common intents
        const patterns = {
            create: /\b(create|add|new|make|generate|write)\b/i,
            edit: /\b(edit|modify|change|update|fix|refactor|improve)\b/i,
            delete: /\b(delete|remove|drop)\b/i,
            test: /\b(test|verify|check|validate)\b/i,
            build: /\b(build|compile|bundle)\b/i,
            run: /\b(run|execute|start|launch)\b/i,
            search: /\b(find|search|look|locate|where)\b/i,
            explain: /\b(explain|describe|what|how|why)\b/i
        };

        // Infer based on task type and patterns
        switch (taskType) {
            case "coding":
                // Add code edit for each mentioned file
                for (const filePath of filePaths) {
                    if (patterns.delete.test(content)) {
                        actions.push({
                            type: "file_delete",
                            target: filePath,
                            description: `Delete ${filePath}`
                        });
                    } else if (patterns.create.test(content)) {
                        actions.push({
                            type: "file_create",
                            target: filePath,
                            description: `Create ${filePath}`
                        });
                    } else {
                        actions.push({
                            type: "code_edit",
                            target: filePath,
                            description: `Edit ${filePath}`
                        });
                    }
                }

                // Add test action if mentioned
                if (patterns.test.test(content)) {
                    actions.push({
                        type: "test_run",
                        target: ".",
                        description: "Run tests"
                    });
                }

                // Add build action if mentioned
                if (patterns.build.test(content)) {
                    actions.push({
                        type: "build_run",
                        target: ".",
                        description: "Build project"
                    });
                }

                // If no files mentioned, create based on intent
                if (filePaths.length === 0) {
                    if (patterns.create.test(content)) {
                        actions.push({
                            type: "file_create",
                            target: "new_file.ts",
                            description: "Create new file",
                            parameters: { intent: this.extractIntent(message) }
                        });
                    } else {
                        actions.push({
                            type: "code_edit",
                            target: "src/",
                            description: "Implement code changes",
                            parameters: { intent: this.extractIntent(message) }
                        });
                    }
                }
                break;

            case "scheduling":
                // Scheduling tasks - write to calendar/schedule file
                actions.push({
                    type: "file_write",
                    target: "schedule/event.json",
                    description: "Create scheduled event",
                    parameters: {
                        type: "schedule",
                        content: message.content
                    }
                });
                break;

            case "messaging":
                // Messaging tasks - prepare message output
                actions.push({
                    type: "file_write",
                    target: "outbox/message.json",
                    description: "Prepare message for sending",
                    parameters: {
                        type: "message",
                        content: message.content
                    }
                });
                break;

            case "general":
            default:
                // For general tasks
                if (filePaths.length > 0) {
                    for (const filePath of filePaths) {
                        if (patterns.create.test(content)) {
                            actions.push({
                                type: "file_create",
                                target: filePath,
                                description: `Create ${filePath}`
                            });
                        } else if (patterns.delete.test(content)) {
                            actions.push({
                                type: "file_delete",
                                target: filePath,
                                description: `Delete ${filePath}`
                            });
                        } else {
                            actions.push({
                                type: "file_modify",
                                target: filePath,
                                description: `Modify ${filePath}`
                            });
                        }
                    }
                } else if (patterns.search.test(content) || patterns.explain.test(content)) {
                    // Research/explanation tasks - write response
                    actions.push({
                        type: "file_write",
                        target: "response/answer.md",
                        description: "Generate response",
                        parameters: {
                            type: "response",
                            query: message.content
                        }
                    });
                } else if (patterns.run.test(content)) {
                    // Run/execute tasks
                    actions.push({
                        type: "shell_exec",
                        target: ".",
                        description: "Execute command",
                        parameters: { command: message.content }
                    });
                } else {
                    // Default: general task execution
                    actions.push({
                        type: "file_write",
                        target: "tasks/task_output.json",
                        description: "Process general task",
                        parameters: {
                            type: "task",
                            content: message.content
                        }
                    });
                }
                break;
        }

        // SAFETY: Ensure at least one action exists
        if (actions.length === 0) {
            actions.push({
                type: "file_write",
                target: "output/result.json",
                description: "Process request and write result",
                parameters: {
                    fallback: true,
                    content: message.content
                }
            });
        }

        return actions;
    }

    /**
     * Store processing in memory
     */
    private async storeInMemory(
        message: InboxMessage,
        evidence: EvidencePack,
        plan: PlanDraft
    ): Promise<void> {
        // Store conversation
        await this.memoryHandler.storeConversation(message.content, {
            source: message.source,
            evidence_id: evidence.evidence_id,
            plan_id: plan.plan_id
        });

        // Store extracted facts
        for (const fact of evidence.extracted_facts) {
            await this.memoryHandler.storeFact(
                fact.content,
                fact.tags || [],
                { evidence_id: evidence.evidence_id }
            );
        }
    }

    /**
     * Hash content for integrity
     */
    private hashContent(content: string): string {
        return crypto.createHash("sha256").update(content).digest("hex");
    }

    /**
     * Get statistics
     */
    getStats(): {
        worker_id: string;
        state: WorkerState;
        inbox: ReturnType<InboxWatcher["getStats"]>;
        memory: ReturnType<MemoryHandler["getStats"]>;
        gmv_enabled: boolean;
    } {
        return {
            worker_id: this.config.worker_id,
            state: this.getState(),
            inbox: this.inboxWatcher.getStats(),
            memory: this.memoryHandler.getStats(),
            gmv_enabled: this.config.enable_gmv
        };
    }

    /**
     * Get memory handler (for testing)
     */
    getMemoryHandler(): MemoryHandler {
        return this.memoryHandler;
    }

    /**
     * Get plan generator (for testing)
     */
    getPlanGenerator(): PlanGenerator {
        return this.planGenerator;
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create Worker agent
 */
export function createWorkerAgent(
    config?: Partial<WorkerConfig>,
    events?: WorkerEvents
): WorkerAgent {
    return new WorkerAgent(config, events);
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

export {
    InboxWatcher,
    InboxMessage,
    InboxWatcherConfig,
    createInboxWatcher,
    createMessageFromOpenClaw
} from "./inbox-watcher.js";

export {
    PlanGenerator,
    PlanGeneratorConfig,
    RequestedAction,
    createPlanGenerator,
    generateQuickPlan
} from "./plan-generator.js";

export {
    MemoryHandler,
    MemoryHandlerConfig,
    MemorySearchResult,
    MemoryStoreResult,
    createMemoryHandler,
    createEmptyMemoryContext
} from "./memory-handler.js";

export {
    buildEvidence,
    attachGlobalMemoryHint,
    initializeGMVStore,
    getContextBias,
    checkPotentialRedundancy,
    BuildEvidenceOptions
} from "./evidence-builder.js";

// ============================================================================
// HTTP HEALTH SERVER
// ============================================================================

import * as http from "http";

const HTTP_PORT = parseInt(process.env['WORKER_HTTP_PORT'] || "3002", 10);

/**
 * Create HTTP server for health checks and status API
 */
function createHealthServer(worker: WorkerAgent): http.Server {
    const startTime = Date.now();

    const server = http.createServer((req, res) => {
        const url = new URL(req.url || "/", `http://localhost:${HTTP_PORT}`);

        // CORS headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        if (req.method !== "GET") {
            res.writeHead(405, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
        }

        const sendJson = (status: number, data: unknown) => {
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(JSON.stringify(data));
        };

        switch (url.pathname) {
            case "/health": {
                const state = worker.getState();
                const healthy = state.status !== "error";
                sendJson(healthy ? 200 : 503, {
                    status: healthy ? "healthy" : "unhealthy",
                    service: "byon-worker",
                    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
                    timestamp: new Date().toISOString()
                });
                break;
            }

            case "/status": {
                const state = worker.getState();
                const stats = worker.getStats();
                // Channel status from environment (set by OpenClaw gateway)
                const channelConnections = {
                    telegram: process.env['CHANNEL_TELEGRAM'] === "true" || !!process.env['TELEGRAM_BOT_TOKEN'],
                    discord: process.env['CHANNEL_DISCORD'] === "true" || !!process.env['DISCORD_TOKEN'],
                    whatsapp: process.env['CHANNEL_WHATSAPP'] === "true" || !!process.env['WHATSAPP_PHONE_ID']
                };
                sendJson(200, {
                    state: state.status,
                    currentTask: state.current_message_id
                        ? `Processing ${state.current_message_id}`
                        : "Waiting for messages...",
                    pendingEvidence: 0,
                    pendingPlans: 0,
                    processed_count: state.processed_count,
                    error_count: state.error_count,
                    worker_id: stats.worker_id,
                    gmv_enabled: stats.gmv_enabled,
                    channelConnections,
                    uptime_seconds: Math.floor((Date.now() - startTime) / 1000)
                });
                break;
            }

            case "/stats": {
                const stats = worker.getStats();
                sendJson(200, stats);
                break;
            }

            default:
                sendJson(404, { error: "Not found" });
        }
    });

    return server;
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Main entry point for running the Worker agent as a daemon
 */
async function main(): Promise<void> {
    console.log("[Worker] Starting BYON Worker Agent...");
    console.log(`[Worker] Memory Service: ${process.env['MEMORY_SERVICE_URL'] || "http://memory-service:8000"}`);
    console.log(`[Worker] Inbox Path: ${process.env['INBOX_PATH'] || "/handoff/inbox"}`);
    console.log(`[Worker] HTTP Port: ${HTTP_PORT}`);

    const handoffPath = process.env['HANDOFF_PATH'] || "/handoff";
    const fs = await import("fs");

    // Create worker with environment configuration and event handlers
    const worker = createWorkerAgent(
        {
            worker_id: process.env['WORKER_ID'] || `worker-${Date.now()}`,
            inbox: {
                inbox_path: process.env['INBOX_PATH'] || "/handoff/inbox",
                poll_interval_ms: 1000,
                archive_processed: false,
                delete_processed: true
            },
            enable_gmv: process.env['ENABLE_GMV'] === "true",
            gmv_db_path: process.env['GMV_DB_PATH'] || "/app/memory/gmv.db",
            auto_start: true
        },
        {
            onMessageReceived: (message) => {
                console.log(`[Worker] Processing message: ${message.message_id}`);
            },
            onEvidenceBuilt: (evidence) => {
                console.log(`[Worker] Evidence built: ${evidence.evidence_id}`);
            },
            onPlanGenerated: (plan, evidence) => {
                console.log(`[Worker] Plan generated: ${plan.plan_id}`);
            },
            onError: (error, messageId) => {
                console.error(`[Worker] Error processing ${messageId || "unknown"}: ${error.message}`);
            },
            onHandoff: async (plan, evidence) => {
                console.log(`[Worker] Handing off plan ${plan.plan_id} to Auditor...`);
                const outputPath = `${handoffPath}/worker_to_auditor`;
                const timestamp = Date.now();

                // Write evidence pack
                const evidencePath = `${outputPath}/evidence_${timestamp}.json`;
                fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
                console.log(`[Worker] Written evidence to ${evidencePath}`);

                // Write plan draft
                const planPath = `${outputPath}/plan_${timestamp}.json`;
                fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
                console.log(`[Worker] Written plan to ${planPath}`);
            }
        }
    );
    console.log(`[Worker] Created agent: ${worker.getState().status}`);

    // Start HTTP health server
    const httpServer = createHealthServer(worker);
    httpServer.listen(HTTP_PORT, "0.0.0.0", () => {
        console.log(`[Worker] HTTP health server listening on port ${HTTP_PORT}`);
    });

    console.log("[Worker] Worker agent started, watching inbox...");

    // Graceful shutdown handler
    let isShuttingDown = false;
    const shutdown = async (signal: string) => {
        if (isShuttingDown) return;
        isShuttingDown = true;

        console.log(`[Worker] Received ${signal}, shutting down gracefully...`);

        try {
            // Stop HTTP server
            httpServer.close();
            console.log("[Worker] HTTP server stopped");

            // Stop the worker (stops inbox watcher)
            worker.stop();
            console.log("[Worker] Inbox watcher stopped");

            // Log final state
            const state = worker.getState();
            console.log(`[Worker] Final state: processed=${state.processed_count}, errors=${state.error_count}`);

            // Give time for audit to flush
            await new Promise(resolve => setTimeout(resolve, 500));

            console.log("[Worker] Shutdown complete");
            process.exit(0);
        } catch (error) {
            console.error("[Worker] Error during shutdown:", error);
            process.exit(1);
        }
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    // Keep process alive with heartbeat
    const heartbeat = setInterval(() => {
        if (isShuttingDown) {
            clearInterval(heartbeat);
        }
    }, 10000);
}

// Run main if this is the entry point
main().catch((error) => {
    console.error("[Worker] Fatal error:", error);
    process.exit(1);
});
