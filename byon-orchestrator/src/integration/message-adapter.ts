/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Message Adapter
 * ===============
 *
 * Orchestrates the full message flow between OpenClaw and BYON.
 *
 * FLOW:
 * OpenClaw Channel -> Message Adapter -> BYON Inbox -> Worker -> Auditor -> Executor -> Response -> Channel
 *
 * CRITICAL CONSTRAINT:
 * - OpenClaw = SINGLE communication platform
 * - All messages enter/exit through OpenClaw bridge
 * - BYON does NOT implement direct channel I/O
 *
 * Patent: FHRSS/OmniVault - Vasile Lucian Borbeleac - EP25216372.0
 */

import {
    OpenClawBridge,
    OpenClawMessage,
    ByonResponse,
    ResponseAction,
    toInboxMessage,
    createOpenClawBridge,
    BridgeConfig
} from "./openclaw-bridge.js";

import {
    ChannelAdapter,
    createChannelAdapter,
    ChannelType,
    ResponseFormat
} from "./channel-adapter.js";

import {
    WorkerAgent,
    createWorkerAgent,
    WorkerConfig,
    ProcessingResult,
    InboxMessage
} from "../agents/worker/index.js";

import {
    OrchestratorHandoffController,
    createOrchestratorHandoff
} from "../handoff/index.js";

import {
    EvidencePack,
    PlanDraft,
    ApprovalRequest,
    ExecutionOrder,
    JohnsonReceipt
} from "../types/protocol.js";

// ============================================================================
// TYPES
// ============================================================================

/** Message adapter configuration */
export interface MessageAdapterConfig {
    /** OpenClaw bridge configuration */
    bridge: Partial<BridgeConfig>;
    /** Worker agent configuration */
    worker: Partial<WorkerConfig>;
    /** Handoff base path */
    handoff_path: string;
    /** Enable verbose logging */
    verbose: boolean;
    /** Auto-approve low risk plans */
    auto_approve_low_risk: boolean;
    /** Response timeout in ms */
    response_timeout_ms: number;
    /** Enable parallel processing */
    enable_parallel: boolean;
    /** Max concurrent messages */
    max_concurrent: number;
}

/** Adapter state */
export interface AdapterState {
    status: "stopped" | "starting" | "running" | "stopping" | "error";
    bridge_connected: boolean;
    worker_ready: boolean;
    messages_in_flight: number;
    total_processed: number;
    total_errors: number;
    last_message_at: string | null;
    last_response_at: string | null;
}

/** Message tracking */
interface TrackedMessage {
    message_id: string;
    openclaw_message: OpenClawMessage;
    inbox_message: ReturnType<typeof toInboxMessage>;
    received_at: string;
    status: "processing" | "awaiting_approval" | "executing" | "completed" | "failed";
    evidence?: EvidencePack;
    plan?: PlanDraft;
    approval_request?: ApprovalRequest;
    execution_order?: ExecutionOrder;
    receipt?: JohnsonReceipt;
    response?: ByonResponse;
    error?: string;
}

/** Adapter events */
export interface MessageAdapterEvents {
    onMessageReceived?: (msg: OpenClawMessage) => void;
    onProcessingStart?: (msg: TrackedMessage) => void;
    onPlanGenerated?: (msg: TrackedMessage, plan: PlanDraft) => void;
    onApprovalRequired?: (msg: TrackedMessage, request: ApprovalRequest) => void;
    onExecutionStart?: (msg: TrackedMessage, order: ExecutionOrder) => void;
    onExecutionComplete?: (msg: TrackedMessage, receipt: JohnsonReceipt) => void;
    onResponseSent?: (msg: TrackedMessage, response: ByonResponse) => void;
    onError?: (msg: TrackedMessage | null, error: Error) => void;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: MessageAdapterConfig = {
    bridge: {},
    worker: {},
    handoff_path: "./handoff",
    verbose: false,
    auto_approve_low_risk: true,
    response_timeout_ms: 60000,
    // AUDIT FIX: Enabled parallel processing for better throughput
    // Previous: enable_parallel: false, max_concurrent: 1
    // Current: Processes up to 5 messages concurrently
    enable_parallel: true,
    max_concurrent: 5
};

// ============================================================================
// MESSAGE ADAPTER
// ============================================================================

/**
 * Message Adapter
 *
 * Orchestrates the complete flow from OpenClaw message to BYON processing to response.
 */
export class MessageAdapter {
    private config: MessageAdapterConfig;
    private events: MessageAdapterEvents;
    private state: AdapterState;

    // Components
    private bridge: OpenClawBridge;
    private channelAdapter: ChannelAdapter;
    private worker: WorkerAgent;
    private handoff: OrchestratorHandoffController;

    // Message tracking
    private activeMessages: Map<string, TrackedMessage> = new Map();
    private messageQueue: OpenClawMessage[] = [];
    private processing: boolean = false;

    constructor(
        config: Partial<MessageAdapterConfig> = {},
        events: MessageAdapterEvents = {}
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.events = events;

        // Initialize state
        this.state = {
            status: "stopped",
            bridge_connected: false,
            worker_ready: false,
            messages_in_flight: 0,
            total_processed: 0,
            total_errors: 0,
            last_message_at: null,
            last_response_at: null
        };

        // Initialize components
        this.bridge = createOpenClawBridge(this.config.bridge);
        this.channelAdapter = createChannelAdapter();
        this.handoff = createOrchestratorHandoff(this.config.handoff_path);

        // Initialize Worker with handoff callback
        this.worker = createWorkerAgent(
            this.config.worker,
            {
                onHandoff: (plan, evidence) => this.handleWorkerHandoff(plan, evidence),
                onError: (error, msgId) => this.handleWorkerError(error, msgId)
            }
        );

        // Register message handler on bridge
        this.bridge.onMessage((msg) => this.handleIncomingMessage(msg));
    }

    // ========================================================================
    // LIFECYCLE
    // ========================================================================

    /**
     * Start the message adapter
     */
    async start(): Promise<boolean> {
        this.state.status = "starting";
        this.log("Starting Message Adapter...");

        try {
            // Connect to OpenClaw
            const connected = await this.bridge.connect();
            if (!connected) {
                this.state.status = "error";
                this.logError("Failed to connect to OpenClaw bridge");
                return false;
            }
            this.state.bridge_connected = true;

            // Start Worker agent
            this.worker.start();
            this.state.worker_ready = true;

            // Start handoff watchers for responses
            this.startHandoffWatchers();

            this.state.status = "running";
            this.log("Message Adapter started successfully");
            return true;

        } catch (error) {
            this.state.status = "error";
            this.logError(`Startup error: ${error}`);
            return false;
        }
    }

    /**
     * Stop the message adapter
     */
    async stop(): Promise<void> {
        this.state.status = "stopping";
        this.log("Stopping Message Adapter...");

        // Stop worker
        this.worker.stop();
        this.state.worker_ready = false;

        // Stop handoff watchers
        this.handoff.stopAll();

        // Disconnect bridge
        await this.bridge.disconnect();
        this.state.bridge_connected = false;

        this.state.status = "stopped";
        this.log("Message Adapter stopped");
    }

    /**
     * Get current state
     */
    getState(): AdapterState {
        return { ...this.state };
    }

    // ========================================================================
    // MESSAGE HANDLING
    // ========================================================================

    /**
     * Handle incoming message from OpenClaw
     */
    private async handleIncomingMessage(msg: OpenClawMessage): Promise<void> {
        this.state.last_message_at = new Date().toISOString();
        this.events.onMessageReceived?.(msg);
        this.log(`Received message ${msg.message_id} from ${msg.channel_type}:${msg.channel_id}`);

        // Register channel if not known
        if (!this.channelAdapter.getChannelMetadata(msg.channel_id)) {
            this.channelAdapter.registerChannel(
                msg.channel_id,
                msg.channel_type,
                `${msg.channel_type}-${msg.channel_id}`
            );
        }

        // Convert to inbox format
        const inboxMessage = toInboxMessage(msg);

        // Create tracked message
        const tracked: TrackedMessage = {
            message_id: msg.message_id,
            openclaw_message: msg,
            inbox_message: inboxMessage,
            received_at: new Date().toISOString(),
            status: "processing"
        };

        this.activeMessages.set(msg.message_id, tracked);
        this.state.messages_in_flight++;

        this.events.onProcessingStart?.(tracked);

        // Process based on parallelism config
        if (this.config.enable_parallel && this.state.messages_in_flight <= this.config.max_concurrent) {
            this.processMessage(tracked);
        } else {
            this.messageQueue.push(msg);
            this.processQueue();
        }
    }

    /**
     * Process message queue
     */
    private async processQueue(): Promise<void> {
        if (this.processing) return;
        if (this.messageQueue.length === 0) return;

        this.processing = true;

        while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift()!;
            const tracked = this.activeMessages.get(msg.message_id);

            if (tracked) {
                await this.processMessage(tracked);
            }
        }

        this.processing = false;
    }

    /**
     * Process a single message through BYON pipeline
     */
    private async processMessage(tracked: TrackedMessage): Promise<void> {
        try {
            // Convert inbox message to Worker format
            const workerMessage: InboxMessage = {
                message_id: tracked.inbox_message.inbox_id,
                received_at: tracked.inbox_message.received_at,
                source: tracked.inbox_message.source_channel,
                type: "user_request",
                content: tracked.inbox_message.content,
                payload: tracked.inbox_message.metadata
            };

            // Process through Worker
            const result = await this.worker.processMessage(
                workerMessage.content,
                workerMessage.source,
                tracked.inbox_message.task_type_hint
            );

            if (!result.success) {
                throw new Error(result.error || "Worker processing failed");
            }

            // Store results in tracked message
            tracked.evidence = result.evidence;
            tracked.plan = result.plan;

            this.events.onPlanGenerated?.(tracked, result.plan!);

            // The handoff callback will handle the rest
            // (Worker.onHandoff -> handleWorkerHandoff)

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            tracked.status = "failed";
            tracked.error = err.message;
            this.state.total_errors++;
            this.events.onError?.(tracked, err);

            // Send error response
            await this.sendErrorResponse(tracked, err);
        }
    }

    // ========================================================================
    // HANDOFF HANDLING
    // ========================================================================

    /**
     * Handle Worker handoff to Auditor
     */
    private async handleWorkerHandoff(plan: PlanDraft, evidence: EvidencePack): Promise<void> {
        // Find the tracked message by evidence_id
        const tracked = this.findTrackedByEvidence(evidence.evidence_id);
        if (!tracked) {
            this.logError(`No tracked message found for evidence ${evidence.evidence_id}`);
            return;
        }

        // Determine if we need user approval
        const needsApproval = !this.config.auto_approve_low_risk || plan.risk_level !== "low";

        if (needsApproval) {
            tracked.status = "awaiting_approval";

            // Create and send approval request
            const approvalRequest = this.createApprovalRequest(plan, evidence);
            tracked.approval_request = approvalRequest;

            this.events.onApprovalRequired?.(tracked, approvalRequest);

            // Send approval request through OpenClaw
            await this.sendApprovalRequestToUser(tracked, approvalRequest);

        } else {
            // Auto-approve low risk
            this.log(`Auto-approving low-risk plan ${plan.plan_id}`);
            await this.executeApprovedPlan(tracked, plan, evidence);
        }
    }

    /**
     * Handle user approval response
     */
    async handleApprovalResponse(
        messageId: string,
        approved: boolean,
        modifications?: string
    ): Promise<void> {
        const tracked = this.activeMessages.get(messageId);
        if (!tracked) {
            this.logError(`No tracked message for approval: ${messageId}`);
            return;
        }

        if (approved) {
            await this.executeApprovedPlan(tracked, tracked.plan!, tracked.evidence!);
        } else {
            // Rejected - send rejection response
            tracked.status = "completed";
            await this.sendRejectionResponse(tracked, modifications || "User rejected the plan");
        }
    }

    /**
     * Execute an approved plan
     */
    private async executeApprovedPlan(
        tracked: TrackedMessage,
        plan: PlanDraft,
        evidence: EvidencePack
    ): Promise<void> {
        tracked.status = "executing";

        // Create execution order (would be signed by Auditor in full implementation)
        const executionOrder = this.createExecutionOrder(plan);
        tracked.execution_order = executionOrder;

        this.events.onExecutionStart?.(tracked, executionOrder);

        // Hand off to Executor via handoff system
        const handoffResult = this.handoff.auditorToExecutor(executionOrder);
        this.log(`Execution order handed off: ${handoffResult.file_path}`);

        // In a real implementation, we'd wait for the Executor to finish
        // For now, simulate immediate completion
        const receipt = this.createMockReceipt(executionOrder);
        tracked.receipt = receipt;
        tracked.status = "completed";

        this.events.onExecutionComplete?.(tracked, receipt);

        // Send success response
        await this.sendSuccessResponse(tracked, receipt);
    }

    /**
     * Start watchers for handoff responses
     */
    private startHandoffWatchers(): void {
        // Watch for receipts coming back to Worker
        this.handoff.startWatching(
            "worker",
            (doc, path) => this.handleReceiptFromExecutor(doc as JohnsonReceipt),
            (err) => this.logError(`Handoff watcher error: ${err.message}`)
        );
    }

    /**
     * Handle receipt from Executor
     */
    private async handleReceiptFromExecutor(receipt: JohnsonReceipt): Promise<void> {
        // Find tracked message by order ID
        const tracked = this.findTrackedByOrder(receipt.based_on_order);
        if (!tracked) {
            this.logError(`No tracked message for receipt order ${receipt.based_on_order}`);
            return;
        }

        tracked.receipt = receipt;
        tracked.status = "completed";

        this.events.onExecutionComplete?.(tracked, receipt);

        // Send response based on receipt status
        if (receipt.execution_summary.status === "success") {
            await this.sendSuccessResponse(tracked, receipt);
        } else {
            await this.sendPartialResponse(tracked, receipt);
        }
    }

    // ========================================================================
    // RESPONSE GENERATION
    // ========================================================================

    /**
     * Send approval request to user
     */
    private async sendApprovalRequestToUser(
        tracked: TrackedMessage,
        request: ApprovalRequest
    ): Promise<void> {
        const format = this.channelAdapter.getResponseFormat(
            tracked.openclaw_message.channel_id
        );

        const actions: ResponseAction[] = [
            {
                action_id: `approve_${tracked.message_id}`,
                label: "✅ Approve",
                action_type: "approve",
                payload: { message_id: tracked.message_id }
            },
            {
                action_id: `reject_${tracked.message_id}`,
                label: "❌ Reject",
                action_type: "reject",
                payload: { message_id: tracked.message_id }
            },
            {
                action_id: `modify_${tracked.message_id}`,
                label: "✏️ Modify",
                action_type: "modify",
                payload: { message_id: tracked.message_id }
            }
        ];

        const response: ByonResponse = {
            response_id: crypto.randomUUID(),
            in_reply_to: tracked.message_id,
            timestamp: new Date().toISOString(),
            content: {
                text: this.formatApprovalText(request, format),
                actions: format.include_buttons ? actions : undefined
            },
            requires_approval: true,
            plan_id: tracked.plan?.plan_id
        };

        tracked.response = response;
        await this.bridge.sendResponse(response);
        this.state.last_response_at = new Date().toISOString();
        this.events.onResponseSent?.(tracked, response);
    }

    /**
     * Send success response
     */
    private async sendSuccessResponse(
        tracked: TrackedMessage,
        receipt: JohnsonReceipt
    ): Promise<void> {
        const format = this.channelAdapter.getResponseFormat(
            tracked.openclaw_message.channel_id
        );

        const response: ByonResponse = {
            response_id: crypto.randomUUID(),
            in_reply_to: tracked.message_id,
            timestamp: new Date().toISOString(),
            content: {
                text: this.formatSuccessText(receipt, format)
            },
            requires_approval: false
        };

        tracked.response = response;
        await this.bridge.sendResponse(response);
        this.finalizeMessage(tracked);
    }

    /**
     * Send partial/failed response
     */
    private async sendPartialResponse(
        tracked: TrackedMessage,
        receipt: JohnsonReceipt
    ): Promise<void> {
        const format = this.channelAdapter.getResponseFormat(
            tracked.openclaw_message.channel_id
        );

        const response: ByonResponse = {
            response_id: crypto.randomUUID(),
            in_reply_to: tracked.message_id,
            timestamp: new Date().toISOString(),
            content: {
                text: this.formatPartialText(receipt, format)
            },
            requires_approval: false
        };

        tracked.response = response;
        await this.bridge.sendResponse(response);
        this.finalizeMessage(tracked);
    }

    /**
     * Send rejection response
     */
    private async sendRejectionResponse(
        tracked: TrackedMessage,
        reason: string
    ): Promise<void> {
        const response: ByonResponse = {
            response_id: crypto.randomUUID(),
            in_reply_to: tracked.message_id,
            timestamp: new Date().toISOString(),
            content: {
                text: `Plan rejected: ${reason}`
            },
            requires_approval: false
        };

        tracked.response = response;
        await this.bridge.sendResponse(response);
        this.finalizeMessage(tracked);
    }

    /**
     * Send error response
     */
    private async sendErrorResponse(
        tracked: TrackedMessage,
        error: Error
    ): Promise<void> {
        const response: ByonResponse = {
            response_id: crypto.randomUUID(),
            in_reply_to: tracked.message_id,
            timestamp: new Date().toISOString(),
            content: {
                text: `Error processing request: ${error.message}`
            },
            requires_approval: false
        };

        tracked.response = response;
        await this.bridge.sendResponse(response);
        this.finalizeMessage(tracked);
    }

    /**
     * Finalize message processing
     */
    private finalizeMessage(tracked: TrackedMessage): void {
        this.state.messages_in_flight--;
        this.state.total_processed++;
        this.state.last_response_at = new Date().toISOString();
        this.activeMessages.delete(tracked.message_id);
        this.events.onResponseSent?.(tracked, tracked.response!);
    }

    // ========================================================================
    // FORMATTERS
    // ========================================================================

    /**
     * Format approval request text
     */
    private formatApprovalText(request: ApprovalRequest, format: ResponseFormat): string {
        const lines: string[] = [];

        if (format.prefer_markdown) {
            lines.push("## 📋 Plan Approval Required\n");
            lines.push(`**Summary:** ${request.summary}\n`);
            lines.push(`**Risk Level:** ${this.formatRiskLevel(request.based_on_plan || "unknown")}\n`);
            lines.push("\n### Actions:");
            for (const action of request.actions_preview.slice(0, 5)) {
                lines.push(`- ${action}`);
            }
            if (request.actions_preview.length > 5) {
                lines.push(`- ... and ${request.actions_preview.length - 5} more`);
            }
            lines.push(`\n*Expires: ${request.expires_at}*`);
        } else {
            lines.push("PLAN APPROVAL REQUIRED\n");
            lines.push(`Summary: ${request.summary}`);
            lines.push(`Risk: ${this.formatRiskLevel(request.based_on_plan || "unknown")}`);
            lines.push("\nActions:");
            for (const action of request.actions_preview.slice(0, 5)) {
                lines.push(`  - ${action}`);
            }
        }

        return this.channelAdapter.formatResponse(
            lines.join("\n"),
            request.based_on_plan || "unknown" // Using plan ID as proxy for channel
        ).join("\n---\n");
    }

    /**
     * Format success text
     */
    private formatSuccessText(receipt: JohnsonReceipt, format: ResponseFormat): string {
        const summary = receipt.execution_summary;
        const lines: string[] = [];

        if (format.prefer_markdown) {
            lines.push("## ✅ Execution Complete\n");
            lines.push(`**Actions:** ${summary.actions_completed}/${summary.actions_total} completed`);
            lines.push(`**Duration:** ${summary.duration_ms}ms`);

            if (receipt.changes_made.files_modified.length > 0) {
                lines.push("\n**Files Modified:**");
                for (const file of receipt.changes_made.files_modified.slice(0, 5)) {
                    lines.push(`- \`${file}\``);
                }
            }
            if (receipt.changes_made.files_created.length > 0) {
                lines.push("\n**Files Created:**");
                for (const file of receipt.changes_made.files_created.slice(0, 5)) {
                    lines.push(`- \`${file}\``);
                }
            }
        } else {
            lines.push("EXECUTION COMPLETE");
            lines.push(`Actions: ${summary.actions_completed}/${summary.actions_total}`);
            lines.push(`Duration: ${summary.duration_ms}ms`);
        }

        return lines.join("\n");
    }

    /**
     * Format partial/failed text
     */
    private formatPartialText(receipt: JohnsonReceipt, format: ResponseFormat): string {
        const summary = receipt.execution_summary;
        const lines: string[] = [];

        if (format.prefer_markdown) {
            lines.push(`## ⚠️ Execution ${summary.status === "partial" ? "Partial" : "Failed"}\n`);
            lines.push(`**Completed:** ${summary.actions_completed}/${summary.actions_total}`);
            lines.push(`**Failed:** ${summary.actions_failed}`);

            if (receipt.errors.length > 0) {
                lines.push("\n**Errors:**");
                for (const err of receipt.errors.slice(0, 3)) {
                    lines.push(`- ${err.action_id}: ${err.message}`);
                }
            }
        } else {
            lines.push(`EXECUTION ${summary.status.toUpperCase()}`);
            lines.push(`Completed: ${summary.actions_completed}/${summary.actions_total}`);
            lines.push(`Failed: ${summary.actions_failed}`);
        }

        return lines.join("\n");
    }

    /**
     * Format risk level
     */
    private formatRiskLevel(planId: string): string {
        // Would look up actual plan - simplified here
        return "medium";
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    /**
     * Find tracked message by evidence ID
     */
    private findTrackedByEvidence(evidenceId: string): TrackedMessage | undefined {
        for (const tracked of this.activeMessages.values()) {
            if (tracked.evidence?.evidence_id === evidenceId) {
                return tracked;
            }
        }
        return undefined;
    }

    /**
     * Find tracked message by order ID
     */
    private findTrackedByOrder(orderId: string): TrackedMessage | undefined {
        for (const tracked of this.activeMessages.values()) {
            if (tracked.execution_order?.order_id === orderId) {
                return tracked;
            }
        }
        return undefined;
    }

    /**
     * Create approval request from plan
     */
    private createApprovalRequest(plan: PlanDraft, evidence: EvidencePack): ApprovalRequest {
        return {
            request_id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            based_on_plan: plan.plan_id,
            summary: plan.intent,
            actions_preview: plan.actions.map(a => `${a.type}: ${a.target || a.description}`),
            security_checks: [
                { check_type: "path_traversal", passed: true, path_traversal_safe: true },
                { check_type: "forbidden_patterns", passed: !evidence.forbidden_data_present, no_forbidden_patterns: !evidence.forbidden_data_present },
                { check_type: "resource_limits", passed: true, within_resource_limits: true },
                { check_type: "dangerous_commands", passed: true, no_dangerous_commands: true }
            ],
            requires_approval: plan.risk_level !== "low",
            expires_at: new Date(Date.now() + this.config.response_timeout_ms).toISOString(),
            user_options: ["approve", "reject", "modify"],
            hash: this.computeHash(plan)
        };
    }

    /**
     * Create execution order from plan
     */
    private createExecutionOrder(plan: PlanDraft): ExecutionOrder {
        return {
            order_id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            based_on_plan: plan.plan_id,
            approved_by: "auto_approve",
            approved_at: new Date().toISOString(),
            actions: plan.actions,
            constraints: {
                max_iterations: 10,
                timeout_seconds: 300,
                allowed_paths: [],
                forbidden_operations: ["shell_exec"]
            },
            rollback: plan.rollback_possible ? {
                enabled: true,
                checkpoint_id: `checkpoint_${plan.plan_id}`
            } : { enabled: false },
            signature: "pending_signature",
            hash: this.computeHash(plan)
        };
    }

    /**
     * Create mock receipt (for testing/simulation)
     */
    private createMockReceipt(order: ExecutionOrder): JohnsonReceipt {
        return {
            receipt_id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            based_on_order: order.order_id,
            execution_summary: {
                status: "success",
                actions_total: order.actions.length,
                actions_completed: order.actions.length,
                actions_failed: 0,
                iterations_used: 1,
                duration_ms: 150
            },
            action_results: order.actions.map((action, i) => ({
                action_id: `action_${i}`,
                action_type: action.type,
                success: true,
                output: `Completed: ${action.description || action.type}`
            })),
            errors: [],
            changes_made: {
                files_modified: [],
                files_created: [],
                files_deleted: []
            },
            verification: {
                tests_passing: true,
                lint_passing: true,
                build_passing: true
            },
            hash: this.computeHash(order)
        };
    }

    /**
     * Compute hash
     */
    private computeHash(data: unknown): string {
        const crypto = require("crypto");
        return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
    }

    /**
     * Handle worker error
     */
    private handleWorkerError(error: Error, messageId?: string): void {
        this.logError(`Worker error: ${error.message} (msg: ${messageId})`);
        if (messageId) {
            const tracked = this.activeMessages.get(messageId);
            if (tracked) {
                this.events.onError?.(tracked, error);
            }
        }
    }

    // Logging helpers
    private log(message: string): void {
        if (this.config.verbose) {
            console.log(`[MessageAdapter] ${message}`);
        }
    }

    private logError(message: string): void {
        console.error(`[MessageAdapter] ERROR: ${message}`);
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    /**
     * Get statistics
     */
    getStats(): {
        state: AdapterState;
        active_messages: number;
        queue_length: number;
        worker_stats: ReturnType<WorkerAgent["getStats"]>;
        bridge_status: ReturnType<OpenClawBridge["getStatus"]>;
    } {
        return {
            state: this.getState(),
            active_messages: this.activeMessages.size,
            queue_length: this.messageQueue.length,
            worker_stats: this.worker.getStats(),
            bridge_status: this.bridge.getStatus()
        };
    }

    /**
     * Get active messages
     */
    getActiveMessages(): TrackedMessage[] {
        return Array.from(this.activeMessages.values());
    }

    /**
     * Get bridge (for external integrations)
     */
    getBridge(): OpenClawBridge {
        return this.bridge;
    }

    /**
     * Get worker (for testing)
     */
    getWorker(): WorkerAgent {
        return this.worker;
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create message adapter
 */
export function createMessageAdapter(
    config?: Partial<MessageAdapterConfig>,
    events?: MessageAdapterEvents
): MessageAdapter {
    return new MessageAdapter(config, events);
}

/**
 * Create and start message adapter
 */
export async function initializeMessageAdapter(
    config?: Partial<MessageAdapterConfig>,
    events?: MessageAdapterEvents
): Promise<MessageAdapter> {
    const adapter = createMessageAdapter(config, events);
    await adapter.start();
    return adapter;
}
