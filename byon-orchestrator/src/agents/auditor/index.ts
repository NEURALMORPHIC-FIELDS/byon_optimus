/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON Auditor Agent
 * ==================
 *
 * Main Auditor agent for MACP v1.1 (Multi-Agent Control Protocol).
 *
 * Responsibilities:
 * - Validate EvidencePacks and PlanDrafts
 * - Enforce GMV gate (metadata-only)
 * - Check security policies
 * - Manage approval workflow
 * - Sign ExecutionOrders (Ed25519)
 * - Hand off to Executor
 *
 * CRITICAL POLICIES:
 * - GMV hint must be metadata-only (no text content)
 * - High-risk plans require explicit user approval
 * - All ExecutionOrders must be signed
 *
 * Patent: FHRSS/OmniVault - Vasile Lucian Borbeleac - EP25216372.0
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
    EvidencePack,
    PlanDraft,
    ApprovalRequest,
    ExecutionOrder,
    SecurityCheck,
    RiskLevel
} from "../../types/protocol.js";
import { PlanWatcher, createPlanWatcher, PlanEvidence } from "./plan-watcher.js";

// Auditor components
import {
    validateEvidencePack,
    validatePlanDraft,
    validateEvidenceAndPlan,
    validateGlobalMemoryHint,
    ValidationResult
} from "./validator.js";
import {
    ExecutionOrderSigner,
    createSigner,
    createSignerFromKeyPair,
    KeyPair,
    SigningResult
} from "./signer.js";
import {
    ApprovalManager,
    createApprovalManager,
    createSecurityChecks,
    ApprovalDecision,
    PendingApproval,
    ApprovalManagerConfig
} from "./approval-manager.js";

// ============================================================================
// TYPES
// ============================================================================

export interface AuditorConfig {
    /** Auditor ID */
    auditor_id: string;
    /** Key pair for signing (optional - generated if not provided) */
    key_pair?: KeyPair;
    /** Approval manager config */
    approval_config: Partial<ApprovalManagerConfig>;
    /** Strict GMV validation */
    strict_gmv_validation: boolean;
    /** Enable audit logging */
    enable_audit_logging: boolean;
}

export interface AuditorState {
    status: "idle" | "validating" | "awaiting_approval" | "signing" | "error";
    current_plan_id: string | null;
    last_order_id: string | null;
    validated_count: number;
    approved_count: number;
    rejected_count: number;
    error_count: number;
}

export interface ValidationResponse {
    valid: boolean;
    errors: string[];
    warnings: string[];
    evidence_id: string;
    plan_id: string;
}

export interface ProcessingResult {
    success: boolean;
    plan_id: string;
    approval_request?: ApprovalRequest;
    execution_order?: ExecutionOrder;
    error?: string;
    auto_approved?: boolean;
}

export interface AuditorEvents {
    onValidationComplete?: (result: ValidationResponse) => void;
    onApprovalRequired?: (request: ApprovalRequest) => void;
    onAutoApproved?: (plan: PlanDraft) => void;
    onOrderSigned?: (order: ExecutionOrder) => void;
    onRejected?: (planId: string, reason: string) => void;
    onError?: (error: Error, planId?: string) => void;
    onHandoff?: (order: ExecutionOrder) => void | Promise<void>;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: AuditorConfig = {
    auditor_id: "auditor_main",
    approval_config: {},
    strict_gmv_validation: true,
    enable_audit_logging: true
};

// ============================================================================
// AUDITOR AGENT
// ============================================================================

/**
 * BYON Auditor Agent
 *
 * Validates plans and manages the approval-to-execution workflow.
 */
export class AuditorAgent {
    private config: AuditorConfig;
    private events: AuditorEvents;
    private signer: ExecutionOrderSigner;
    private approvalManager: ApprovalManager;
    private state: AuditorState;
    private auditLog: Array<{
        timestamp: string;
        action: string;
        plan_id?: string;
        details?: string;
    }> = [];

    constructor(
        config: Partial<AuditorConfig> = {},
        events: AuditorEvents = {}
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.events = events;

        // Initialize state
        this.state = {
            status: "idle",
            current_plan_id: null,
            last_order_id: null,
            validated_count: 0,
            approved_count: 0,
            rejected_count: 0,
            error_count: 0
        };

        // Initialize signer
        this.signer = this.config.key_pair
            ? createSignerFromKeyPair(this.config.key_pair)
            : createSigner();

        // Initialize approval manager
        this.approvalManager = createApprovalManager(this.config.approval_config);
    }

    /**
     * Get current state
     */
    getState(): AuditorState {
        return { ...this.state };
    }

    /**
     * Get public key for signature verification
     */
    getPublicKey(): string {
        return this.signer.getPublicKey();
    }

    /**
     * Process a plan with its evidence
     */
    async processForApproval(
        evidence: EvidencePack,
        plan: PlanDraft
    ): Promise<ProcessingResult> {
        this.state.status = "validating";
        this.state.current_plan_id = plan.plan_id;

        try {
            // Step 1: Validate evidence and plan
            const validation = this.validate(evidence, plan);
            this.log("validation", plan.plan_id, validation.valid ? "passed" : "failed");

            this.events.onValidationComplete?.(validation);

            if (!validation.valid) {
                this.state.rejected_count++;
                this.state.status = "idle";
                this.events.onRejected?.(plan.plan_id, validation.errors.join("; "));

                return {
                    success: false,
                    plan_id: plan.plan_id,
                    error: `Validation failed: ${validation.errors.join("; ")}`
                };
            }

            this.state.validated_count++;

            // Step 2: Create security checks from validation
            const securityChecks = createSecurityChecks(
                validation.errors,
                validation.warnings
            );

            // Step 3: Create approval request
            this.state.status = "awaiting_approval";
            const approvalRequest = this.approvalManager.createApprovalRequest(
                plan,
                securityChecks
            );

            this.log("approval_request", plan.plan_id, approvalRequest.request_id);

            // Step 4: Check for auto-approval
            if (this.approvalManager.shouldAutoApprove(approvalRequest.request_id)) {
                // Auto-approve and sign
                const decision = this.approvalManager.autoApprove(approvalRequest.request_id);
                this.log("auto_approved", plan.plan_id);

                this.events.onAutoApproved?.(plan);

                // Sign and create execution order
                const order = await this.signAndDeliver(plan, "auto");

                this.state.approved_count++;
                this.state.status = "idle";

                return {
                    success: true,
                    plan_id: plan.plan_id,
                    approval_request: approvalRequest,
                    execution_order: order,
                    auto_approved: true
                };
            }

            // Requires user approval
            this.events.onApprovalRequired?.(approvalRequest);

            return {
                success: true,
                plan_id: plan.plan_id,
                approval_request: approvalRequest
            };

        } catch (error) {
            this.state.error_count++;
            this.state.status = "error";

            const err = error instanceof Error ? error : new Error(String(error));
            this.events.onError?.(err, plan.plan_id);

            return {
                success: false,
                plan_id: plan.plan_id,
                error: err.message
            };
        }
    }

    /**
     * Validate evidence and plan
     */
    validate(evidence: EvidencePack, plan: PlanDraft): ValidationResponse {
        // Full validation
        const result = validateEvidenceAndPlan(evidence, plan);

        // Additional GMV validation if strict mode
        if (this.config.strict_gmv_validation && evidence.global_memory_hint) {
            const gmvResult = validateGlobalMemoryHint(evidence.global_memory_hint);
            result.errors.push(...gmvResult.errors);
            result.warnings.push(...gmvResult.warnings);
        }

        return {
            valid: result.valid && result.errors.length === 0,
            errors: result.errors,
            warnings: result.warnings,
            evidence_id: evidence.evidence_id,
            plan_id: plan.plan_id
        };
    }

    /**
     * Process user approval decision
     */
    async processApprovalDecision(
        requestId: string,
        approved: boolean,
        decidedBy: string,
        reason?: string
    ): Promise<ProcessingResult> {
        try {
            const pending = this.approvalManager.getPending(requestId);
            if (!pending) {
                throw new Error(`Approval request not found: ${requestId}`);
            }

            if (approved) {
                // Process approval
                const decision = this.approvalManager.processDecision(
                    requestId,
                    "approved",
                    decidedBy,
                    undefined,
                    reason
                );

                this.log("approved", pending.plan.plan_id, decidedBy);

                // Sign and deliver
                const order = await this.signAndDeliver(pending.plan, decidedBy);

                this.state.approved_count++;
                this.state.status = "idle";

                return {
                    success: true,
                    plan_id: pending.plan.plan_id,
                    execution_order: order
                };

            } else {
                // Process rejection
                const decision = this.approvalManager.processDecision(
                    requestId,
                    "rejected",
                    decidedBy,
                    undefined,
                    reason
                );

                this.log("rejected", pending.plan.plan_id, reason || "User rejected");

                this.state.rejected_count++;
                this.state.status = "idle";

                this.events.onRejected?.(pending.plan.plan_id, reason || "User rejected");

                return {
                    success: false,
                    plan_id: pending.plan.plan_id,
                    error: reason || "User rejected the plan"
                };
            }

        } catch (error) {
            this.state.error_count++;
            this.state.status = "error";

            const err = error instanceof Error ? error : new Error(String(error));
            this.events.onError?.(err);

            return {
                success: false,
                plan_id: "unknown",
                error: err.message
            };
        }
    }

    /**
     * Sign plan and create ExecutionOrder
     */
    private async signAndDeliver(
        plan: PlanDraft,
        approvedBy: string
    ): Promise<ExecutionOrder> {
        this.state.status = "signing";

        // Sign the order
        const signingResult = this.signer.signOrder(plan, approvedBy);

        this.log("signed", plan.plan_id, signingResult.order.order_id);

        this.state.last_order_id = signingResult.order.order_id;

        this.events.onOrderSigned?.(signingResult.order);

        // Hand off to executor
        if (this.events.onHandoff) {
            await this.events.onHandoff(signingResult.order);
        }

        return signingResult.order;
    }

    /**
     * Verify an ExecutionOrder signature
     */
    verifyOrder(order: ExecutionOrder): {
        valid: boolean;
        error?: string;
    } {
        const result = this.signer.verifyOrder(order);
        return {
            valid: result.valid,
            error: result.error
        };
    }

    /**
     * Get pending approvals
     */
    getPendingApprovals(): PendingApproval[] {
        return this.approvalManager.getAllPending();
    }

    /**
     * Get approval history
     */
    getApprovalHistory(limit?: number): ApprovalDecision[] {
        return this.approvalManager.getHistory(limit);
    }

    /**
     * Get statistics
     */
    getStats(): {
        auditor_id: string;
        state: AuditorState;
        approvals: ReturnType<ApprovalManager["getStats"]>;
        public_key: string;
    } {
        return {
            auditor_id: this.config.auditor_id,
            state: this.getState(),
            approvals: this.approvalManager.getStats(),
            public_key: this.getPublicKey()
        };
    }

    /**
     * Get audit log
     */
    getAuditLog(limit?: number): typeof this.auditLog {
        const log = [...this.auditLog].reverse();
        return limit ? log.slice(0, limit) : log;
    }

    /**
     * Log action
     */
    private log(action: string, planId?: string, details?: string): void {
        if (!this.config.enable_audit_logging) {return;}

        this.auditLog.push({
            timestamp: new Date().toISOString(),
            action,
            plan_id: planId,
            details
        });

        // Keep log size manageable
        if (this.auditLog.length > 1000) {
            this.auditLog = this.auditLog.slice(-500);
        }
    }

    /**
     * Export key pair (PROTECT PRIVATE KEY!)
     */
    exportKeyPair(): KeyPair {
        return this.signer.exportKeyPair();
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create Auditor agent
 */
export function createAuditorAgent(
    config?: Partial<AuditorConfig>,
    events?: AuditorEvents
): AuditorAgent {
    return new AuditorAgent(config, events);
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

export {
    validateEvidencePack,
    validatePlanDraft,
    validateEvidenceAndPlan,
    validateGlobalMemoryHint,
    ValidationResult
} from "./validator.js";

export {
    ExecutionOrderSigner,
    SignatureVerifier,
    KeyPair,
    SigningResult,
    VerificationResult,
    createSigner,
    createSignerFromKeyPair,
    createVerifier,
    generateKeyPair
} from "./signer.js";

export {
    ApprovalManager,
    ApprovalManagerConfig,
    ApprovalDecision,
    PendingApproval,
    PlanModification,
    createApprovalManager,
    createSecurityChecks
} from "./approval-manager.js";

// ============================================================================
// HTTP HEALTH SERVER
// ============================================================================

import * as http from "http";

const HTTP_PORT = parseInt(process.env['AUDITOR_HTTP_PORT'] || "3003", 10);

/**
 * Create HTTP server for health checks and status API
 */
function createHealthServer(auditor: AuditorAgent): http.Server {
    const startTime = Date.now();

    const server = http.createServer((req, res) => {
        const url = new URL(req.url || "/", `http://localhost:${HTTP_PORT}`);

        // CORS headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        const sendJson = (status: number, data: unknown) => {
            res.writeHead(status, { "Content-Type": "application/json" });
            res.end(JSON.stringify(data));
        };

        // Handle POST requests for approvals
        if (req.method === "POST") {
            if (url.pathname === "/approve") {
                let body = "";
                req.on("data", chunk => body += chunk);
                req.on("end", async () => {
                    try {
                        const { request_id, approved, decided_by, reason } = JSON.parse(body);
                        if (!request_id) {
                            sendJson(400, { error: "request_id is required" });
                            return;
                        }
                        const result = await auditor.processApprovalDecision(
                            request_id,
                            approved !== false, // default to approve
                            decided_by || "api_user",
                            reason
                        );
                        sendJson(result.success ? 200 : 400, result);
                    } catch (error) {
                        sendJson(400, { error: error instanceof Error ? error.message : "Invalid request" });
                    }
                });
                return;
            }
            sendJson(404, { error: "Not found" });
            return;
        }

        if (req.method !== "GET") {
            res.writeHead(405, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
        }

        switch (url.pathname) {
            case "/health": {
                const state = auditor.getState();
                const healthy = state.status !== "error";
                sendJson(healthy ? 200 : 503, {
                    status: healthy ? "healthy" : "unhealthy",
                    service: "byon-auditor",
                    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
                    timestamp: new Date().toISOString()
                });
                break;
            }

            case "/status": {
                const state = auditor.getState();
                const stats = auditor.getStats();
                const pendingApprovals = auditor.getPendingApprovals();
                sendJson(200, {
                    state: state.status,
                    pendingApprovals: pendingApprovals.length,
                    lastCheck: new Date().toISOString(),
                    signedOrders: state.approved_count,
                    rejectedPlans: state.rejected_count,
                    validated_count: state.validated_count,
                    error_count: state.error_count,
                    auditor_id: stats.auditor_id,
                    public_key: stats.public_key,
                    uptime_seconds: Math.floor((Date.now() - startTime) / 1000)
                });
                break;
            }

            case "/stats": {
                const stats = auditor.getStats();
                sendJson(200, stats);
                break;
            }

            case "/pending": {
                const pending = auditor.getPendingApprovals();
                sendJson(200, { pending });
                break;
            }

            case "/history": {
                const limit = parseInt(url.searchParams.get("limit") || "20", 10);
                const history = auditor.getApprovalHistory(limit);
                sendJson(200, { history });
                break;
            }

            case "/audit-log": {
                const limit = parseInt(url.searchParams.get("limit") || "50", 10);
                const log = auditor.getAuditLog(limit);
                sendJson(200, { log });
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
 * Main entry point for running the Auditor agent as a daemon
 */
async function main(): Promise<void> {
    console.log("[Auditor] Starting BYON Auditor Agent...");
    console.log(`[Auditor] Auto-approve level: ${process.env['AUTO_APPROVE_RISK_LEVEL'] || "none"}`);
    console.log(`[Auditor] HTTP Port: ${HTTP_PORT}`);

    const handoffPath = process.env['HANDOFF_PATH'] || "/handoff";

    // Create auditor with environment configuration
    const auditor = createAuditorAgent({
        auditor_id: process.env['AUDITOR_ID'] || `auditor-${Date.now()}`,
        approval_config: {
            auto_approve_low_risk: process.env['AUTO_APPROVE_RISK_LEVEL'] === "low"
        },
        strict_gmv_validation: process.env['STRICT_GMV'] === "true",
        enable_audit_logging: true
    }, {
        // Event: When approval is required, write to auditor_to_user
        onApprovalRequired: (request) => {
            console.log(`[Auditor] Approval required for plan: ${request.based_on_plan || request.request_id}`);
            const outputPath = `${handoffPath}/auditor_to_user`;
            const filePath = `${outputPath}/approval_${Date.now()}.json`;
            fs.mkdirSync(outputPath, { recursive: true });
            fs.writeFileSync(filePath, JSON.stringify(request, null, 2));
            console.log(`[Auditor] Written approval request to: ${filePath}`);
        },
        // Event: When order is signed, write to auditor_to_executor
        onHandoff: async (order) => {
            console.log(`[Auditor] Handing off order to Executor: ${order.order_id}`);
            const outputPath = `${handoffPath}/auditor_to_executor`;
            const filePath = `${outputPath}/order_${Date.now()}.json`;
            fs.mkdirSync(outputPath, { recursive: true });
            fs.writeFileSync(filePath, JSON.stringify(order, null, 2));
            console.log(`[Auditor] Written execution order to: ${filePath}`);
        },
        // Event: Log auto-approved plans
        onAutoApproved: (plan) => {
            console.log(`[Auditor] Auto-approved plan: ${plan.plan_id}`);
        },
        // Event: Log rejected plans
        onRejected: (planId, reason) => {
            console.log(`[Auditor] Rejected plan ${planId}: ${reason}`);
        },
        // Event: Log errors
        onError: (error, planId) => {
            console.error(`[Auditor] Error${planId ? ` (plan: ${planId})` : ''}: ${error.message}`);
        }
    });
    console.log(`[Auditor] Created agent: ${auditor.getState().status}`);

    // Export public key for Executor signature verification
    const keysPath = process.env['KEYS_PATH'] || "/keys";
    try {
        const publicKey = auditor.getPublicKey();
        const publicKeyPath = `${keysPath}/auditor_public.pem`;
        fs.mkdirSync(keysPath, { recursive: true });
        fs.writeFileSync(publicKeyPath, publicKey);
        console.log(`[Auditor] Exported public key to: ${publicKeyPath}`);
    } catch (error) {
        console.warn(`[Auditor] Failed to export public key: ${error instanceof Error ? error.message : error}`);
    }

    // Create plan watcher to monitor worker_to_auditor directory
    const planWatcher = createPlanWatcher({
        watch_path: `${handoffPath}/worker_to_auditor`,
        poll_interval_ms: 2000,
        archive_processed: true,
        archive_path: `${handoffPath}/worker_to_auditor/archive`
    }, {
        onPlanReceived: async (data: PlanEvidence) => {
            console.log(`[Auditor] Received plan: ${data.plan.plan_id}`);
            console.log(`[Auditor] Evidence: ${data.evidence.evidence_id}`);

            const result = await auditor.processForApproval(data.evidence, data.plan);

            if (result.success) {
                if (result.auto_approved) {
                    console.log(`[Auditor] Plan auto-approved and signed: ${result.plan_id}`);
                } else {
                    console.log(`[Auditor] Plan awaiting user approval: ${result.plan_id}`);
                }
            } else {
                console.log(`[Auditor] Plan processing failed: ${result.error}`);
            }
        },
        onError: (error, filePath) => {
            console.error(`[Auditor] PlanWatcher error${filePath ? ` (${filePath})` : ''}: ${error.message}`);
        }
    });

    // Start watching for plans
    planWatcher.start();
    console.log(`[Auditor] Plan watcher started on: ${handoffPath}/worker_to_auditor`);

    // Start HTTP health server
    const httpServer = createHealthServer(auditor);
    httpServer.listen(HTTP_PORT, "0.0.0.0", () => {
        console.log(`[Auditor] HTTP health server listening on port ${HTTP_PORT}`);
    });

    console.log("[Auditor] Auditor agent started, watching for plans...");

    // Graceful shutdown handler
    let isShuttingDown = false;
    const shutdown = async (signal: string) => {
        if (isShuttingDown) {return;}
        isShuttingDown = true;

        console.log(`[Auditor] Received ${signal}, shutting down gracefully...`);

        try {
            // Stop plan watcher
            planWatcher.stop();
            console.log("[Auditor] Plan watcher stopped");

            // Stop HTTP server
            httpServer.close();
            console.log("[Auditor] HTTP server stopped");

            // Log final state
            const state = auditor.getState();
            console.log(`[Auditor] Final state: validated=${state.validated_count}, approved=${state.approved_count}, rejected=${state.rejected_count}`);

            // Give time for audit to flush
            await new Promise(resolve => setTimeout(resolve, 500));

            console.log("[Auditor] Shutdown complete");
            process.exit(0);
        } catch (error) {
            console.error("[Auditor] Error during shutdown:", error);
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
    console.error("[Auditor] Fatal error:", error);
    process.exit(1);
});
