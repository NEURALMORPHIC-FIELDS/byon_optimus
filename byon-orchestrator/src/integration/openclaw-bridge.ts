/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * OpenClaw-BYON Bridge
 * ====================
 *
 * Bridge pentru conectarea OpenClaw Platform cu BYON Orchestrator.
 *
 * CRITICAL CONSTRAINT:
 * - OpenClaw este SINGLE communication platform
 * - BYON NU implementează direct channel I/O
 * - Tot traficul trece prin OpenClaw channels
 *
 * Flow:
 * OpenClaw Channel -> Message Adapter -> BYON Inbox -> Worker -> Response -> Channel
 */

import { EvidencePack, TaskType } from "../types/protocol.js";
import { AuditService, createAuditService } from "../audit/audit-service.js";
import { KeyManager, createKeyManager } from "../protocol/crypto/key-manager.js";
import * as crypto from "crypto";

// ============================================================================
// TYPES
// ============================================================================

/** OpenClaw message format (incoming from channels) */
export interface OpenClawMessage {
    message_id: string;
    channel_id: string;
    channel_type: "telegram" | "discord" | "web" | "cli" | "custom";
    timestamp: string;
    sender: {
        user_id: string;
        username?: string;
        display_name?: string;
    };
    content: {
        text: string;
        attachments?: Attachment[];
        metadata?: Record<string, unknown>;
    };
    thread_id?: string;
    reply_to?: string;
    signature?: string; // Added for security
}

/** Attachment in message */
export interface Attachment {
    type: "file" | "image" | "code" | "link";
    name: string;
    url?: string;
    content?: string;
    mime_type?: string;
}

/** BYON response to send back through OpenClaw */
export interface ByonResponse {
    response_id: string;
    in_reply_to: string;
    timestamp: string;
    content: {
        text: string;
        attachments?: Attachment[];
        actions?: ResponseAction[];
    };
    requires_approval: boolean;
    plan_id?: string;
    signature?: string; // Added for security
}

/** Optional action buttons in response */
export interface ResponseAction {
    action_id: string;
    label: string;
    action_type: "approve" | "reject" | "modify" | "info";
    payload?: Record<string, unknown>;
}

/** Bridge configuration */
export interface BridgeConfig {
    openclaw_gateway_url: string;
    byon_inbox_path: string;
    response_timeout_ms: number;
    max_retries: number;
    verbose: boolean;
    shared_secret?: string; // For HMAC
    validate_signatures: boolean;
}

/** Bridge status */
export interface BridgeStatus {
    connected: boolean;
    last_message_at: string | null;
    messages_received: number;
    messages_sent: number;
    errors: number;
    uptime_seconds: number;
    last_error?: string;
    circuit_breaker_state: "closed" | "open" | "half-open";
}

/** Circuit breaker configuration */
interface CircuitBreakerConfig {
    failure_threshold: number;     // Number of failures before opening
    reset_timeout_ms: number;      // Time before trying again (half-open)
    success_threshold: number;     // Successes needed to close from half-open
}

// ============================================================================
// BRIDGE IMPLEMENTATION
// ============================================================================

/**
 * OpenClaw-BYON Bridge
 *
 * Handles bidirectional communication between OpenClaw platform and BYON orchestrator.
 * All channel I/O goes through OpenClaw - BYON only receives/sends via this bridge.
 *
 * ENTERPRISE FEATURES:
 * - HMAC Signature Verification
 * - Audit Trail Integration
 * - Structured Logging
 * - Resilience (Retry with Backoff)
 * - Strict Type Validation
 */
export class OpenClawBridge {
    private config: BridgeConfig;
    private status: BridgeStatus;
    private messageHandler: ((msg: OpenClawMessage) => Promise<void>) | null = null;

    // Dependencies
    private auditService: AuditService;
    private keyManager: KeyManager;
    private startTime: number;

    // Circuit breaker state
    private circuitBreaker: {
        config: CircuitBreakerConfig;
        state: "closed" | "open" | "half-open";
        failures: number;
        successes: number;
        lastFailureTime: number;
    };

    constructor(
        config: Partial<BridgeConfig> = {},
        auditService?: AuditService,
        keyManager?: KeyManager
    ) {
        this.config = {
            openclaw_gateway_url: config.openclaw_gateway_url || process.env['OPENCLAW_URL'] || "http://localhost:3000",
            byon_inbox_path: config.byon_inbox_path || process.env['BYON_INBOX'] || "./handoff/inbox",
            response_timeout_ms: config.response_timeout_ms || 30000,
            max_retries: config.max_retries || 3,
            verbose: config.verbose || process.env['NODE_ENV'] === "development",
            shared_secret: config.shared_secret || process.env['BYON_BRIDGE_SECRET'],
            validate_signatures: config.validate_signatures ?? true
        };

        this.status = {
            connected: false,
            last_message_at: null,
            messages_received: 0,
            messages_sent: 0,
            errors: 0,
            uptime_seconds: 0,
            circuit_breaker_state: "closed"
        };

        // Initialize circuit breaker
        this.circuitBreaker = {
            config: {
                failure_threshold: 5,      // Open after 5 consecutive failures
                reset_timeout_ms: 30000,   // Try again after 30 seconds
                success_threshold: 2       // Need 2 successes to fully close
            },
            state: "closed",
            failures: 0,
            successes: 0,
            lastFailureTime: 0
        };

        this.startTime = Date.now();
        this.auditService = auditService || createAuditService();
        this.keyManager = keyManager || createKeyManager();
    }

    /**
     * Initialize bridge and connect to OpenClaw gateway
     */
    async connect(): Promise<boolean> {
        try {
            // Initialize dependencies
            await this.keyManager.initialize();

            // Verify OpenClaw gateway is available
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(`${this.config.openclaw_gateway_url}/health`, {
                method: "GET",
                headers: this.getAuthHeaders(),
                signal: controller.signal
            });
            
            clearTimeout(timeout);

            if (response.ok) {
                this.status.connected = true;
                this.log("Connected to OpenClaw gateway", "info");
                
                this.auditService.logSystemEvent("bridge_connected", {
                    gateway: this.config.openclaw_gateway_url,
                    timestamp: new Date().toISOString()
                });
                
                return true;
            }

            this.status.connected = false;
            this.logError("Failed to connect to OpenClaw gateway: " + response.statusText);
            return false;
        } catch (error) {
            this.status.connected = false;
            this.status.errors++;
            this.logError(`Connection error: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    /**
     * Register message handler for incoming OpenClaw messages
     */
    onMessage(handler: (msg: OpenClawMessage) => Promise<void>): void {
        this.messageHandler = handler;
    }

    /**
     * Receive message from OpenClaw (called by OpenClaw gateway)
     * This is the ONLY entry point for messages into BYON
     */
    async receiveMessage(message: OpenClawMessage): Promise<void> {
        this.status.messages_received++;
        this.status.last_message_at = new Date().toISOString();

        try {
            // 1. Validate Input Structure
            this.validateMessageStructure(message);

            // 2. Security Check: Signature Verification
            if (this.config.validate_signatures && this.config.shared_secret) {
                if (!this.verifySignature(message)) {
                    throw new Error("Invalid message signature");
                }
            }

            this.log(`Received message ${message.message_id} from channel ${message.channel_id}`, "debug");

            // 3. Audit Logging
            this.auditService.logSystemEvent("message_received", {
                message_id: message.message_id,
                channel_id: message.channel_id,
                sender: message.sender.user_id
            });

            // 4. Processing
            if (this.messageHandler) {
                await this.messageHandler(message);
            }
        } catch (error) {
            this.status.errors++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            this.logError(`Error processing message: ${errorMessage}`);
            
            this.auditService.logError("bridge", "OpenClawBridge", errorMessage, {
                message_id: message?.message_id,
                phase: "receive"
            });
            
            throw error; // Re-throw to inform caller (gateway)
        }
    }

    /**
     * Send response back through OpenClaw
     * This is the ONLY exit point for responses from BYON
     */
    async sendResponse(response: ByonResponse): Promise<boolean> {
        // Check circuit breaker first
        if (!this.canMakeRequest()) {
            this.log("Circuit breaker is OPEN - request blocked", "warn");
            this.auditService.logSystemEvent("request_blocked", {
                reason: "circuit_breaker_open",
                response_id: response.response_id
            });
            return false;
        }

        // Sign the response if secret is available
        if (this.config.shared_secret) {
            response.signature = this.signPayload(response);
        }

        let attempt = 0;
        let lastError: Error | null = null;

        while (attempt < this.config.max_retries) {
            try {
                const result = await this.performRequest(
                    `${this.config.openclaw_gateway_url}/byon/response`,
                    "POST",
                    response
                );

                if (result) {
                    this.status.messages_sent++;
                    this.recordSuccess(); // Circuit breaker success
                    this.log(`Sent response ${response.response_id}`, "info");

                    this.auditService.logSystemEvent("response_sent", {
                        response_id: response.response_id,
                        in_reply_to: response.in_reply_to
                    });

                    return true;
                }
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                this.log(`Retry ${attempt + 1}/${this.config.max_retries} failed: ${lastError.message}`, "warn");
            }

            attempt++;
            if (attempt < this.config.max_retries) {
                // Exponential backoff: 200ms, 400ms, 800ms...
                await new Promise(r => setTimeout(r, 200 * Math.pow(2, attempt - 1)));
            }
        }

        // All retries failed - record failure for circuit breaker
        this.recordFailure();
        this.status.errors++;
        this.logError(`Failed to send response after ${this.config.max_retries} attempts`);
        if (lastError) {
            this.auditService.logError("bridge", "OpenClawBridge", "Send Failed", {
                response_id: response.response_id,
                error: lastError.message,
                circuit_state: this.circuitBreaker.state
            });
        }

        return false;
    }

    /**
     * Send approval request to user through OpenClaw
     */
    async sendApprovalRequest(
        channelId: string,
        userId: string,
        planSummary: string,
        actions: ResponseAction[]
    ): Promise<string | null> {
        const response: ByonResponse = {
            response_id: crypto.randomUUID(),
            in_reply_to: "", // Unsolicited - approval request
            timestamp: new Date().toISOString(),
            content: {
                text: planSummary,
                actions
            },
            requires_approval: true
        };

        const success = await this.sendResponse(response);
        return success ? response.response_id : null;
    }

    /**
     * Get bridge status
     */
    getStatus(): BridgeStatus {
        return {
            ...this.status,
            uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
            circuit_breaker_state: this.circuitBreaker.state
        };
    }

    /**
     * Disconnect from OpenClaw gateway
     */
    async disconnect(): Promise<void> {
        this.status.connected = false;
        this.auditService.cleanup();
        this.log("Disconnected from OpenClaw gateway", "info");
    }

    // ========================================================================
    // PRIVATE HELPERS
    // ========================================================================

    private async performRequest(url: string, method: string, body?: unknown): Promise<boolean> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.response_timeout_ms);

        try {
            const response = await fetch(url, {
                method,
                headers: {
                    "Content-Type": "application/json",
                    ...this.getAuthHeaders()
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });

            clearTimeout(timeout);
            return response.ok;
        } catch (error) {
            clearTimeout(timeout);
            throw error;
        }
    }

    private getAuthHeaders(): Record<string, string> {
        return {
            "X-BYON-Bridge": "1.0",
            "X-BYON-Time": new Date().toISOString()
        };
    }

    private validateMessageStructure(msg: OpenClawMessage): void {
        if (!msg.message_id || typeof msg.message_id !== 'string') {throw new Error("Missing message_id");}
        if (!msg.content || typeof msg.content !== 'object') {throw new Error("Missing content");}
        if (typeof msg.content.text !== 'string') {throw new Error("Missing content.text");}
    }

    private signPayload(payload: any): string {
        if (!this.config.shared_secret) {return "";}
        // Remove existing signature to sign content
        const { signature, ...data } = payload;
        return crypto
            .createHmac("sha256", this.config.shared_secret)
            .update(JSON.stringify(data))
            .digest("hex");
    }

    private verifySignature(message: OpenClawMessage): boolean {
        if (!message.signature) {return false;}
        const calculated = this.signPayload(message);
        // Constant time comparison to prevent timing attacks
        return crypto.timingSafeEqual(
            Buffer.from(message.signature),
            Buffer.from(calculated)
        );
    }

    private log(message: string, level: "info" | "warn" | "error" | "debug" = "info"): void {
        if (this.config.verbose || level === "error" || level === "warn") {
            const timestamp = new Date().toISOString();
            console.log(`[OpenClaw-Bridge] [${timestamp}] [${level.toUpperCase()}] ${message}`);
        }
    }

    private logError(message: string): void {
        this.log(message, "error");
        this.status.last_error = message;
    }

    // ========================================================================
    // CIRCUIT BREAKER
    // ========================================================================

    /**
     * Check if circuit breaker allows the request
     */
    private canMakeRequest(): boolean {
        const cb = this.circuitBreaker;
        const now = Date.now();

        switch (cb.state) {
            case "closed":
                return true;

            case "open":
                // Check if reset timeout has passed
                if (now - cb.lastFailureTime >= cb.config.reset_timeout_ms) {
                    cb.state = "half-open";
                    cb.successes = 0;
                    this.log("Circuit breaker: half-open (testing)", "info");
                    this.status.circuit_breaker_state = "half-open";
                    return true;
                }
                return false;

            case "half-open":
                return true;

            default:
                return true;
        }
    }

    /**
     * Record successful request
     */
    private recordSuccess(): void {
        const cb = this.circuitBreaker;

        if (cb.state === "half-open") {
            cb.successes++;
            if (cb.successes >= cb.config.success_threshold) {
                cb.state = "closed";
                cb.failures = 0;
                this.log("Circuit breaker: closed (recovered)", "info");
                this.status.circuit_breaker_state = "closed";
            }
        } else if (cb.state === "closed") {
            cb.failures = 0; // Reset failure count on success
        }
    }

    /**
     * Record failed request
     */
    private recordFailure(): void {
        const cb = this.circuitBreaker;

        if (cb.state === "half-open") {
            // Immediate trip back to open
            cb.state = "open";
            cb.lastFailureTime = Date.now();
            this.log("Circuit breaker: open (failed in half-open)", "warn");
            this.status.circuit_breaker_state = "open";

            this.auditService.logSystemEvent("circuit_breaker_opened", {
                reason: "half-open test failed",
                will_retry_at: new Date(Date.now() + cb.config.reset_timeout_ms).toISOString()
            });
        } else if (cb.state === "closed") {
            cb.failures++;
            if (cb.failures >= cb.config.failure_threshold) {
                cb.state = "open";
                cb.lastFailureTime = Date.now();
                this.log(`Circuit breaker: open (${cb.failures} failures)`, "warn");
                this.status.circuit_breaker_state = "open";

                this.auditService.logSystemEvent("circuit_breaker_opened", {
                    reason: `${cb.failures} consecutive failures`,
                    will_retry_at: new Date(Date.now() + cb.config.reset_timeout_ms).toISOString()
                });
            }
        }
    }

    /**
     * Check if circuit is currently open (blocking requests)
     */
    isCircuitOpen(): boolean {
        return this.circuitBreaker.state === "open" && !this.canMakeRequest();
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create and configure OpenClaw bridge
 */
export function createOpenClawBridge(
    config?: Partial<BridgeConfig>,
    auditService?: AuditService,
    keyManager?: KeyManager
): OpenClawBridge {
    return new OpenClawBridge(config, auditService, keyManager);
}

// ============================================================================
// MESSAGE TRANSFORMATION
// ============================================================================

/**
 * Transform OpenClaw message to BYON inbox format
 */
export function toInboxMessage(msg: OpenClawMessage): {
    inbox_id: string;
    received_at: string;
    source_channel: string;
    source_message_id: string;
    sender_id: string;
    content: string;
    task_type_hint: TaskType;
    metadata: Record<string, unknown>;
} {
    return {
        inbox_id: crypto.randomUUID(),
        received_at: new Date().toISOString(),
        source_channel: `${msg.channel_type}:${msg.channel_id}`,
        source_message_id: msg.message_id,
        sender_id: msg.sender.user_id,
        content: msg.content.text,
        task_type_hint: inferTaskType(msg.content.text),
        metadata: {
            attachments: msg.content.attachments,
            thread_id: msg.thread_id,
            reply_to: msg.reply_to,
            original_metadata: msg.content.metadata
        }
    };
}

/**
 * Infer task type from message content
 */
function inferTaskType(content: string): TaskType {
    const lower = content.toLowerCase();

    if (lower.includes("code") || lower.includes("function") || lower.includes("fix") || lower.includes("bug")) {
        return "coding";
    }
    if (lower.includes("schedule") || lower.includes("meeting") || lower.includes("calendar")) {
        return "scheduling";
    }
    if (lower.includes("send") || lower.includes("message") || lower.includes("notify")) {
        return "messaging";
    }

    return "general";
}
