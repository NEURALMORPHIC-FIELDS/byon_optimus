/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON Executor Agent
 * ===================
 *
 * Air-gapped execution engine for MACP v1.1.
 *
 * CRITICAL: AIR-GAPPED SECURITY
 * - NO network access
 * - NO external API calls
 * - All errors reported via JohnsonReceipt
 * - Signature verification required
 * - Sandboxed file operations
 *
 * Responsibilities:
 * - Verify ExecutionOrder signature
 * - Execute whitelisted actions
 * - Track changes and errors
 * - Generate JohnsonReceipt
 * - Drop receipt to outbox
 *
 * Patent: FHRSS/OmniVault - Vasile Lucian Borbeleac - EP25216372.0
 */

import * as fs from "fs";
import * as path from "path";
import { AuditService, createAuditService } from "../../audit/audit-service.js";

import {
    ExecutionOrder,
    JohnsonReceipt,
    ActionResult
} from "../../types/protocol.js";

// Executor components
import {
    ExecutionOrderVerifier,
    createVerifier,
    createVerifierFromAuditor,
    VerificationResult
} from "./signature-verifier.js";
import {
    createHandlerRegistry,
    HandlerRegistry,
    ActionContext
} from "./action-handlers.js";
import {
    ReceiptGenerator,
    createReceiptGenerator,
    ExecutionContext
} from "./receipt-generator.js";
import { OrderWatcher, createOrderWatcher } from "./order-watcher.js";

// ============================================================================
// TYPES
// ============================================================================

export interface ExecutorConfig {
    /** Executor ID */
    executor_id: string;
    /** Project root directory */
    project_root: string;
    /** Trusted Auditor public key */
    auditor_public_key: string;
    /** Outbox directory for receipts */
    outbox_path: string;
    /** Enable backup before modifications */
    backup_enabled: boolean;
    /** Backup directory */
    backup_path: string;
    /** Dry run mode */
    dry_run: boolean;
    /** Maximum iterations per order */
    max_iterations: number;
    /** Timeout in milliseconds */
    timeout_ms: number;
    /** Audit log path */
    audit_path?: string;
}

export interface ExecutorState {
    status: "idle" | "verifying" | "executing" | "generating_receipt" | "error";
    current_order_id: string | null;
    last_receipt_id: string | null;
    executed_count: number;
    rejected_count: number;
    error_count: number;
}

export interface ExecutionResult {
    success: boolean;
    order_id: string;
    receipt: JohnsonReceipt;
    receipt_path?: string;
}

export interface ExecutorEvents {
    onOrderReceived?: (order: ExecutionOrder) => void;
    onVerificationComplete?: (result: VerificationResult) => void;
    onActionExecuted?: (result: ActionResult) => void;
    onReceiptGenerated?: (receipt: JohnsonReceipt) => void;
    onError?: (error: Error, orderId?: string) => void;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: Partial<ExecutorConfig> = {
    executor_id: "executor_main",
    outbox_path: "./outbox",
    backup_enabled: true,
    backup_path: "./backups",
    dry_run: false,
    max_iterations: 10,
    timeout_ms: 30 * 60 * 1000, // 30 minutes
    audit_path: "./audit_logs/executor"
};

// ============================================================================
// EXECUTOR AGENT
// ============================================================================

/**
 * BYON Executor Agent
 *
 * Air-gapped execution engine.
 * 
 * ENTERPRISE FEATURES:
 * - Local Audit Trail (Tamper-Evident)
 * - Strict Action Logging
 */
export class ExecutorAgent {
    private config: ExecutorConfig;
    private events: ExecutorEvents;
    private verifier: ExecutionOrderVerifier;
    private handlers: HandlerRegistry;
    private receiptGenerator: ReceiptGenerator;
    private auditService: AuditService;
    private state: ExecutorState;

    constructor(
        config: Partial<ExecutorConfig> & {
            project_root: string;
            auditor_public_key: string;
        },
        events: ExecutorEvents = {}
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config } as ExecutorConfig;
        this.events = events;

        // Initialize state
        this.state = {
            status: "idle",
            current_order_id: null,
            last_receipt_id: null,
            executed_count: 0,
            rejected_count: 0,
            error_count: 0
        };

        // Initialize components
        this.verifier = createVerifierFromAuditor(config.auditor_public_key);
        this.handlers = createHandlerRegistry();
        this.receiptGenerator = createReceiptGenerator();
        
        // Initialize Audit Service
        const auditDir = this.config.audit_path ? path.resolve(this.config.audit_path) : path.resolve("./audit_logs/executor");
        this.auditService = createAuditService({
            persistencePath: auditDir,
            syncOnWrite: true
        });

        // Ensure directories exist
        this.ensureDirectories();
        
        this.auditService.logSystemEvent("executor_started", {
            executor_id: this.config.executor_id,
            config: {
                ...this.config,
                auditor_public_key: "REDACTED"
            }
        });
    }

    /**
     * Get current state
     */
    getState(): ExecutorState {
        return { ...this.state };
    }

    /**
     * Execute an order
     */
    async execute(order: ExecutionOrder): Promise<ExecutionResult> {
        this.state.status = "verifying";
        this.state.current_order_id = order.order_id;

        // AUDIT: Order Received (using logSystemEvent to avoid state machine complexity)
        // The ExecutionOrder already went through Auditor approval, so we just log events
        this.auditService.logSystemEvent("execution_order_received", {
            order_id: order.order_id,
            based_on_plan: order.based_on_plan,
            actions_count: order.actions.length,
            executor: this.config.executor_id
        });

        this.events.onOrderReceived?.(order);

        try {
            // Step 1: Verify signature
            const verification = this.verifier.verify(order);

            this.events.onVerificationComplete?.(verification);

            if (!verification.verified) {
                // Generate rejection receipt
                this.state.rejected_count++;
                this.state.status = "idle";
                
                // AUDIT: Verification Failed
                this.auditService.logError("executor", "verifier", "Signature verification failed", {
                    order_id: order.order_id,
                    error: verification.error
                });

                const receipt = this.receiptGenerator.generateFailureReceipt(
                    order.order_id,
                    verification.error || "Signature verification failed"
                );

                return this.finalizeReceipt(receipt, order.order_id, false);
            }
            
            // AUDIT: Verified
            this.auditService.logSystemEvent("order_verified", { order_id: order.order_id });

            // Step 2: Execute actions
            this.state.status = "executing";
            // AUDIT: Start Execution (use logSystemEvent to avoid state machine issues)
            this.auditService.logSystemEvent("execution_started", {
                order_id: order.order_id,
                executor: this.config.executor_id,
                based_on_plan: order.based_on_plan
            });
            
            const context = this.receiptGenerator.createContext(order);

            const actionContext: ActionContext = {
                project_root: this.config.project_root,
                dry_run: this.config.dry_run,
                backup_enabled: this.config.backup_enabled,
                backup_dir: this.config.backup_path
            };

            // Execute each action
            for (const action of order.actions) {
                // Check iteration limit
                if (context.iterations >= order.constraints.max_iterations) {
                    const errorMsg = `Iteration limit reached: ${order.constraints.max_iterations}`;
                    context.errors.push({
                        action_id: action.action_id,
                        error_type: "iteration_limit",
                        message: errorMsg,
                        recoverable: false
                    });
                    this.auditService.logError("executor", "loop_guard", errorMsg, { order_id: order.order_id });
                    break;
                }

                // Execute action
                this.receiptGenerator.incrementIterations(context);
                const result = await this.handlers.execute(action, actionContext);
                
                // AUDIT: Action Result
                this.auditService.logSystemEvent("action_executed", {
                    action_id: action.action_id,
                    type: action.type,
                    status: result.status,
                    duration_ms: result.duration_ms
                });

                // Record result
                this.receiptGenerator.addResult(context, result);
                this.events.onActionExecuted?.(result);

                // Track changes
                if (result.status === "success") {
                    this.trackActionChange(context, action.type, action.target);
                }
            }

            // Step 3: Generate receipt
            this.state.status = "generating_receipt";
            const receipt = this.receiptGenerator.generate(context);

            this.state.executed_count++;
            
            // AUDIT: Execution result (use logSystemEvent to avoid state machine issues)
            if (receipt.execution_summary.status === "success") {
                this.auditService.logSystemEvent("execution_completed", {
                    order_id: order.order_id,
                    executor: this.config.executor_id,
                    receipt_id: receipt.receipt_id,
                    actions_completed: receipt.execution_summary.actions_completed
                });
            } else {
                this.auditService.logSystemEvent("execution_failed", {
                    order_id: order.order_id,
                    executor: this.config.executor_id,
                    receipt_id: receipt.receipt_id,
                    failed_count: receipt.execution_summary.actions_failed,
                    status: receipt.execution_summary.status
                });
            }

            return this.finalizeReceipt(
                receipt,
                order.order_id,
                receipt.execution_summary.status === "success"
            );

        } catch (error) {
            this.state.error_count++;
            this.state.status = "error";

            const err = error instanceof Error ? error : new Error(String(error));
            this.events.onError?.(err, order.order_id);
            
            this.auditService.logError("executor", "execution_engine", err.message, { order_id: order.order_id });

            // Generate error receipt
            const receipt = this.receiptGenerator.generateFailureReceipt(
                order.order_id,
                err.message
            );

            return this.finalizeReceipt(receipt, order.order_id, false);
        }
    }

    /**
     * Track action change in context
     */
    private trackActionChange(
        context: ExecutionContext,
        actionType: string,
        target: string
    ): void {
        switch (actionType) {
            case "code_edit":
            case "file_modify":
            case "file_write":
                this.receiptGenerator.trackChange(context, "modified", target);
                break;
            case "file_create":
                this.receiptGenerator.trackChange(context, "created", target);
                break;
            case "file_delete":
                this.receiptGenerator.trackChange(context, "deleted", target);
                break;
        }
    }

    /**
     * Finalize and save receipt
     */
    private finalizeReceipt(
        receipt: JohnsonReceipt,
        orderId: string,
        success: boolean
    ): ExecutionResult {
        this.state.last_receipt_id = receipt.receipt_id;

        this.events.onReceiptGenerated?.(receipt);

        // Save receipt to outbox
        const receiptPath = this.saveReceipt(receipt);

        // Reset state
        this.state.status = "idle";
        this.state.current_order_id = null;

        return {
            success,
            order_id: orderId,
            receipt,
            receipt_path: receiptPath
        };
    }

    /**
     * Save receipt to outbox
     */
    private saveReceipt(receipt: JohnsonReceipt): string {
        const fileName = `${receipt.receipt_id}.json`;
        const filePath = path.join(this.config.outbox_path, fileName);

        fs.writeFileSync(filePath, JSON.stringify(receipt, null, 2), "utf-8");

        return filePath;
    }

    /**
     * Ensure required directories exist
     */
    private ensureDirectories(): void {
        if (!fs.existsSync(this.config.outbox_path)) {
            fs.mkdirSync(this.config.outbox_path, { recursive: true });
        }

        if (this.config.backup_enabled && !fs.existsSync(this.config.backup_path)) {
            fs.mkdirSync(this.config.backup_path, { recursive: true });
        }
    }

    /**
     * Verify order without executing
     */
    verifyOrder(order: ExecutionOrder): VerificationResult {
        return this.verifier.verify(order);
    }

    /**
     * Get statistics
     */
    getStats(): {
        executor_id: string;
        state: ExecutorState;
        config: {
            project_root: string;
            dry_run: boolean;
            backup_enabled: boolean;
        };
    } {
        return {
            executor_id: this.config.executor_id,
            state: this.getState(),
            config: {
                project_root: this.config.project_root,
                dry_run: this.config.dry_run,
                backup_enabled: this.config.backup_enabled
            }
        };
    }

    /**
     * Set dry run mode
     */
    setDryRun(enabled: boolean): void {
        this.config.dry_run = enabled;
    }

    /**
     * List pending receipts in outbox
     */
    listPendingReceipts(): string[] {
        if (!fs.existsSync(this.config.outbox_path)) {
            return [];
        }

        return fs
            .readdirSync(this.config.outbox_path)
            .filter(f => f.endsWith(".json"))
            .map(f => path.join(this.config.outbox_path, f));
    }

    /**
     * Read receipt from outbox
     */
    readReceipt(receiptPath: string): JohnsonReceipt | null {
        try {
            const content = fs.readFileSync(receiptPath, "utf-8");
            return JSON.parse(content) as JohnsonReceipt;
        } catch {
            return null;
        }
    }

    /**
     * Clear processed receipt from outbox
     */
    clearReceipt(receiptPath: string): boolean {
        try {
            if (fs.existsSync(receiptPath)) {
                fs.unlinkSync(receiptPath);
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create Executor agent
 */
export function createExecutorAgent(
    config: Partial<ExecutorConfig> & {
        project_root: string;
        auditor_public_key: string;
    },
    events?: ExecutorEvents
): ExecutorAgent {
    return new ExecutorAgent(config, events);
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

export {
    ExecutionOrderVerifier,
    VerificationResult,
    createVerifier,
    createVerifierFromAuditor
} from "./signature-verifier.js";

export {
    createHandlerRegistry,
    HandlerRegistry,
    ActionContext,
    ActionHandler,
    resolveSafePath,
    isForbiddenPath
} from "./action-handlers.js";

export {
    ReceiptGenerator,
    ExecutionContext,
    createReceiptGenerator
} from "./receipt-generator.js";

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Main entry point for running the Executor agent (AIR-GAPPED)
 */
async function main(): Promise<void> {
    console.log("[Executor] Starting BYON Executor Agent (AIR-GAPPED)...");
    console.log(`[Executor] Project Root: ${process.env['PROJECT_ROOT'] || "/project"}`);
    console.log(`[Executor] Outbox: ${process.env['OUTBOX_PATH'] || "/handoff/executor_to_worker"}`);

    // Load auditor public key
    const keysPath = process.env['KEYS_PATH'] || "/keys";
    const publicKeyPath = `${keysPath}/auditor_public.pem`;

    let auditorPublicKey = "MOCK_KEY";
    try {
        if (fs.existsSync(publicKeyPath)) {
            // IMPORTANT: trim() to remove any trailing whitespace/newlines
            auditorPublicKey = fs.readFileSync(publicKeyPath, "utf-8").trim();
            console.log("[Executor] Loaded auditor public key:", auditorPublicKey.substring(0, 20) + "...");
        } else {
            console.warn("[Executor] No auditor public key found, signature verification disabled");
        }
    } catch (error) {
        console.warn("[Executor] Failed to load auditor public key:", error);
    }

    // Create executor with environment configuration
    const executor = createExecutorAgent({
        project_root: process.env['PROJECT_ROOT'] || "/project",
        auditor_public_key: auditorPublicKey,
        executor_id: process.env['EXECUTOR_ID'] || `executor-${Date.now()}`,
        outbox_path: process.env['OUTBOX_PATH'] || "/handoff/executor_to_worker",
        backup_enabled: true,
        backup_path: "/app/backups",
        dry_run: process.env['DRY_RUN'] === "true",
        max_iterations: parseInt(process.env['MAX_ITERATIONS'] || "10"),
        timeout_ms: parseInt(process.env['EXECUTION_TIMEOUT'] || "1800000")
    });
    console.log(`[Executor] Created agent: ${executor.getState().status}`);

    // Create order watcher to monitor auditor_to_executor directory
    const handoffPath = process.env['HANDOFF_PATH'] || "/handoff";
    const orderWatcher = createOrderWatcher({
        watch_path: `${handoffPath}/auditor_to_executor`,
        poll_interval_ms: 2000,
        archive_processed: true,
        archive_path: `${handoffPath}/auditor_to_executor/archive`
    }, {
        onOrderReceived: async (order, filePath) => {
            console.log(`[Executor] Received order: ${order.order_id}`);
            console.log(`[Executor] Actions: ${order.actions.length}`);

            try {
                const result = await executor.execute(order);
                console.log(`[Executor] Execution complete: ${result.receipt.receipt_id}`);
                console.log(`[Executor] Status: ${result.receipt.execution_summary.status}`);
                console.log(`[Executor] Success: ${result.success}`);

                // Receipt is already written by executor.execute(), just log
                if (result.receipt_path) {
                    console.log(`[Executor] Receipt saved to: ${result.receipt_path}`);
                }
            } catch (error) {
                console.error(`[Executor] Execution failed: ${error instanceof Error ? error.message : error}`);
            }
        },
        onError: (error, filePath) => {
            console.error(`[Executor] OrderWatcher error${filePath ? ` (${filePath})` : ''}: ${error.message}`);
        }
    });

    // Start watching for orders
    orderWatcher.start();
    console.log(`[Executor] Order watcher started on: ${handoffPath}/auditor_to_executor`);

    console.log("[Executor] Executor agent started, watching for orders...");

    // Graceful shutdown handler
    let isShuttingDown = false;
    const shutdown = async (signal: string) => {
        if (isShuttingDown) return;
        isShuttingDown = true;

        console.log(`[Executor] Received ${signal}, shutting down gracefully...`);

        try {
            // Stop order watcher
            orderWatcher.stop();
            console.log("[Executor] Order watcher stopped");

            // Log final state
            const state = executor.getState();
            console.log(`[Executor] Final state: executed=${state.executed_count}, rejected=${state.rejected_count}, errors=${state.error_count}`);

            // Note: Executor should complete current work if any before exit
            // For safety, we allow brief time for any in-flight operation
            await new Promise(resolve => setTimeout(resolve, 500));

            console.log("[Executor] Shutdown complete");
            process.exit(0);
        } catch (error) {
            console.error("[Executor] Error during shutdown:", error);
            process.exit(1);
        }
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    // Keep process alive with heartbeat and write health status
    const HEALTH_FILE = "/tmp/healthy";
    const writeHealthStatus = () => {
        if (isShuttingDown) {
            return;
        }
        try {
            const state = executor.getState();
            const healthData = {
                status: "healthy",
                timestamp: new Date().toISOString(),
                executor_state: state.status,
                executed_count: state.executed_count,
                rejected_count: state.rejected_count,
                error_count: state.error_count,
                uptime_seconds: Math.floor((Date.now() - startTime) / 1000)
            };
            fs.writeFileSync(HEALTH_FILE, JSON.stringify(healthData, null, 2), "utf-8");
        } catch (error) {
            console.error("[Executor] Failed to write health status:", error);
        }
    };

    // Initial health status write
    const startTime = Date.now();
    writeHealthStatus();

    // Update health status every 10 seconds
    const heartbeat = setInterval(() => {
        if (isShuttingDown) {
            clearInterval(heartbeat);
            // Remove health file on shutdown
            try {
                if (fs.existsSync(HEALTH_FILE)) {
                    fs.unlinkSync(HEALTH_FILE);
                }
            } catch {
                // Ignore cleanup errors
            }
        } else {
            writeHealthStatus();
        }
    }, 10000);
}

// Run main if this is the entry point
main().catch((error) => {
    console.error("[Executor] Fatal error:", error);
    process.exit(1);
});
