/**
 * Full Message Flow Integration Tests
 * ====================================
 *
 * Tests the complete flow from OpenClaw message input
 * through BYON orchestrator to response output.
 *
 * OpenClaw -> Worker -> Auditor -> Executor -> Response
 *
 * Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================
// Test Configuration
// ============================================

const TEST_ROOT = "./test-full-flow";
const HANDOFF_DIR = path.join(TEST_ROOT, "handoff");
const PROJECT_DIR = path.join(TEST_ROOT, "project");
const KEYS_DIR = path.join(TEST_ROOT, "keys");

// ============================================
// Orchestrator Components (Simplified)
// ============================================

// Message from OpenClaw
interface OpenClawMessage {
    message_id: string;
    channel_id: string;
    channel_type: "web" | "telegram" | "discord" | "cli";
    content: string;
    user_id: string;
    timestamp: string;
}

// Worker output
interface WorkerOutput {
    evidence_id: string;
    plan_id: string;
    task_type: string;
    intent: string;
    actions: Array<{
        action_id: string;
        type: string;
        target: string;
        params: Record<string, unknown>;
    }>;
    risk_level: "low" | "medium" | "high";
    memory_context: {
        conversation_ctx_id?: number;
        code_ctx_ids: number[];
        fact_ctx_ids: number[];
    };
}

// Auditor decision
interface AuditorDecision {
    order_id: string;
    approved: boolean;
    approval_type: "auto" | "user";
    signature?: string;
    rejection_reason?: string;
}

// Executor result
interface ExecutorResult {
    receipt_id: string;
    status: "success" | "partial" | "failed" | "rejected";
    changes: {
        files_created: string[];
        files_modified: string[];
        files_deleted: string[];
    };
    errors: string[];
}

// Final response to OpenClaw
interface OpenClawResponse {
    response_id: string;
    channel_id: string;
    content: string;
    attachments?: Array<{ type: string; data: unknown }>;
}

// ============================================
// Mock Orchestrator
// ============================================

class MockOrchestrator {
    private handoffDir: string;
    private projectDir: string;
    private autoApproveRiskLevel: "low" | "medium" | "none" = "low";
    private memoryStore: Map<number, { content: string; type: string }> = new Map();
    private nextCtxId = 1;

    constructor(handoffDir: string, projectDir: string) {
        this.handoffDir = handoffDir;
        this.projectDir = projectDir;
    }

    async initialize(): Promise<void> {
        // Create directories
        const dirs = [
            this.handoffDir,
            path.join(this.handoffDir, "inbox"),
            path.join(this.handoffDir, "worker_to_auditor"),
            path.join(this.handoffDir, "auditor_to_user"),
            path.join(this.handoffDir, "auditor_to_executor"),
            path.join(this.handoffDir, "executor_to_worker"),
            this.projectDir
        ];

        for (const dir of dirs) {
            await fs.promises.mkdir(dir, { recursive: true });
        }
    }

    setAutoApproveRisk(level: "low" | "medium" | "none"): void {
        this.autoApproveRiskLevel = level;
    }

    // Worker phase
    async workerProcess(message: OpenClawMessage): Promise<WorkerOutput> {
        // Store conversation in memory
        const convCtxId = await this.storeInMemory(message.content, "conversation");

        // Determine task type
        const taskType = this.detectTaskType(message.content);

        // Search for relevant context
        const codeCtxIds = await this.searchMemory(message.content, "code");
        const factCtxIds = await this.searchMemory(message.content, "fact");

        // Generate actions based on intent
        const actions = this.generateActions(message.content, taskType);

        // Calculate risk
        const riskLevel = this.calculateRisk(actions);

        return {
            evidence_id: `EV-${Date.now()}`,
            plan_id: `PLAN-${Date.now()}`,
            task_type: taskType,
            intent: message.content.slice(0, 100),
            actions,
            risk_level: riskLevel,
            memory_context: {
                conversation_ctx_id: convCtxId,
                code_ctx_ids: codeCtxIds,
                fact_ctx_ids: factCtxIds
            }
        };
    }

    // Auditor phase
    async auditorProcess(workerOutput: WorkerOutput): Promise<AuditorDecision> {
        const orderId = `ORD-${Date.now()}`;

        // Security validation
        const securityIssues = this.validateSecurity(workerOutput.actions);
        if (securityIssues.length > 0) {
            return {
                order_id: orderId,
                approved: false,
                approval_type: "auto",
                rejection_reason: `Security issues: ${securityIssues.join(", ")}`
            };
        }

        // Check auto-approve
        const canAutoApprove =
            (this.autoApproveRiskLevel === "low" && workerOutput.risk_level === "low") ||
            (this.autoApproveRiskLevel === "medium" &&
                (workerOutput.risk_level === "low" || workerOutput.risk_level === "medium"));

        if (canAutoApprove) {
            return {
                order_id: orderId,
                approved: true,
                approval_type: "auto",
                signature: this.signOrder(orderId, workerOutput.plan_id)
            };
        }

        // Would send to user for approval in real implementation
        // For tests, simulate user approval
        return {
            order_id: orderId,
            approved: true,
            approval_type: "user",
            signature: this.signOrder(orderId, workerOutput.plan_id)
        };
    }

    // Executor phase
    async executorProcess(
        workerOutput: WorkerOutput,
        auditorDecision: AuditorDecision
    ): Promise<ExecutorResult> {
        const receiptId = `RCPT-${Date.now()}`;
        const changes = {
            files_created: [] as string[],
            files_modified: [] as string[],
            files_deleted: [] as string[]
        };
        const errors: string[] = [];

        if (!auditorDecision.approved) {
            return {
                receipt_id: receiptId,
                status: "rejected",
                changes,
                errors: [auditorDecision.rejection_reason || "Not approved"]
            };
        }

        // Verify signature
        if (!auditorDecision.signature) {
            return {
                receipt_id: receiptId,
                status: "rejected",
                changes,
                errors: ["Missing signature"]
            };
        }

        // Execute actions
        for (const action of workerOutput.actions) {
            try {
                // Security check
                if (action.target.includes("..")) {
                    throw new Error("Path traversal blocked");
                }

                const targetPath = path.join(this.projectDir, action.target);

                switch (action.type) {
                    case "file_create": {
                        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
                        await fs.promises.writeFile(
                            targetPath,
                            action.params.content as string || ""
                        );
                        changes.files_created.push(action.target);
                        break;
                    }
                    case "code_edit": {
                        if (fs.existsSync(targetPath)) {
                            await fs.promises.writeFile(
                                targetPath,
                                action.params.content as string || ""
                            );
                            changes.files_modified.push(action.target);
                        } else {
                            await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
                            await fs.promises.writeFile(
                                targetPath,
                                action.params.content as string || ""
                            );
                            changes.files_created.push(action.target);
                        }
                        break;
                    }
                    case "file_delete": {
                        if (fs.existsSync(targetPath)) {
                            await fs.promises.unlink(targetPath);
                            changes.files_deleted.push(action.target);
                        }
                        break;
                    }
                }
            } catch (err) {
                errors.push(`${action.action_id}: ${err instanceof Error ? err.message : "Unknown error"}`);
            }
        }

        const status =
            errors.length === 0
                ? "success"
                : errors.length < workerOutput.actions.length
                    ? "partial"
                    : "failed";

        return {
            receipt_id: receiptId,
            status,
            changes,
            errors
        };
    }

    // Response generation
    generateResponse(
        message: OpenClawMessage,
        executorResult: ExecutorResult
    ): OpenClawResponse {
        let content: string;

        switch (executorResult.status) {
            case "success":
                content = this.formatSuccessResponse(executorResult);
                break;
            case "partial":
                content = this.formatPartialResponse(executorResult);
                break;
            case "failed":
            case "rejected":
                content = this.formatErrorResponse(executorResult);
                break;
        }

        return {
            response_id: `RESP-${Date.now()}`,
            channel_id: message.channel_id,
            content
        };
    }

    // Helper methods
    private detectTaskType(content: string): string {
        const lower = content.toLowerCase();
        if (lower.includes("code") || lower.includes("function") || lower.includes("fix")) {
            return "coding";
        }
        if (lower.includes("schedule") || lower.includes("remind") || lower.includes("meeting")) {
            return "scheduling";
        }
        if (lower.includes("send") || lower.includes("message") || lower.includes("notify")) {
            return "messaging";
        }
        return "general";
    }

    private generateActions(content: string, taskType: string): WorkerOutput["actions"] {
        // Simple action generation based on keywords
        const actions: WorkerOutput["actions"] = [];

        if (content.toLowerCase().includes("create")) {
            actions.push({
                action_id: `ACT-${Date.now()}`,
                type: "file_create",
                target: "src/new-file.ts",
                params: { content: "// New file content" }
            });
        }

        if (content.toLowerCase().includes("edit") || content.toLowerCase().includes("update")) {
            actions.push({
                action_id: `ACT-${Date.now() + 1}`,
                type: "code_edit",
                target: "src/existing.ts",
                params: { content: "// Updated content" }
            });
        }

        if (content.toLowerCase().includes("delete") || content.toLowerCase().includes("remove")) {
            actions.push({
                action_id: `ACT-${Date.now() + 2}`,
                type: "file_delete",
                target: "src/deprecated.ts",
                params: {}
            });
        }

        // Default action if none generated
        if (actions.length === 0) {
            actions.push({
                action_id: `ACT-${Date.now()}`,
                type: "code_edit",
                target: "src/response.ts",
                params: { content: `// Response to: ${content}` }
            });
        }

        return actions;
    }

    private calculateRisk(actions: WorkerOutput["actions"]): "low" | "medium" | "high" {
        const hasDelete = actions.some(a => a.type === "file_delete");
        const multipleActions = actions.length > 3;

        if (hasDelete && multipleActions) return "high";
        if (hasDelete || multipleActions) return "medium";
        return "low";
    }

    private validateSecurity(actions: WorkerOutput["actions"]): string[] {
        const issues: string[] = [];

        for (const action of actions) {
            if (action.target.includes("..")) {
                issues.push("Path traversal detected");
            }
            if (action.target.includes(".env") || action.target.includes("credentials")) {
                issues.push("Sensitive file access");
            }
            if (action.target.includes("node_modules")) {
                issues.push("Node modules modification");
            }
        }

        return issues;
    }

    private signOrder(orderId: string, planId: string): string {
        // Mock Ed25519 signature
        return `SIG-${Buffer.from(`${orderId}:${planId}`).toString("base64").slice(0, 32)}`;
    }

    private async storeInMemory(content: string, type: string): Promise<number> {
        const ctxId = this.nextCtxId++;
        this.memoryStore.set(ctxId, { content, type });
        return ctxId;
    }

    private async searchMemory(query: string, type: string): Promise<number[]> {
        const results: number[] = [];
        for (const [id, entry] of this.memoryStore) {
            if (entry.type === type && entry.content.toLowerCase().includes(query.toLowerCase().slice(0, 10))) {
                results.push(id);
            }
        }
        return results.slice(0, 3);
    }

    private formatSuccessResponse(result: ExecutorResult): string {
        const parts = [];
        if (result.changes.files_created.length > 0) {
            parts.push(`Created: ${result.changes.files_created.join(", ")}`);
        }
        if (result.changes.files_modified.length > 0) {
            parts.push(`Modified: ${result.changes.files_modified.join(", ")}`);
        }
        if (result.changes.files_deleted.length > 0) {
            parts.push(`Deleted: ${result.changes.files_deleted.join(", ")}`);
        }
        return `Task completed successfully.\n${parts.join("\n")}`;
    }

    private formatPartialResponse(result: ExecutorResult): string {
        return `Task partially completed.\n${this.formatSuccessResponse(result)}\nErrors:\n${result.errors.join("\n")}`;
    }

    private formatErrorResponse(result: ExecutorResult): string {
        return `Task failed.\nErrors:\n${result.errors.join("\n")}`;
    }
}

// ============================================
// Integration Tests
// ============================================

describe("Full Message Flow Integration", () => {
    let orchestrator: MockOrchestrator;

    beforeEach(async () => {
        // Cleanup
        if (fs.existsSync(TEST_ROOT)) {
            fs.rmSync(TEST_ROOT, { recursive: true });
        }

        orchestrator = new MockOrchestrator(HANDOFF_DIR, PROJECT_DIR);
        await orchestrator.initialize();
    });

    afterEach(() => {
        if (fs.existsSync(TEST_ROOT)) {
            fs.rmSync(TEST_ROOT, { recursive: true });
        }
    });

    describe("Simple Task Flow", () => {
        it("should process create file request", async () => {
            const message: OpenClawMessage = {
                message_id: "MSG-001",
                channel_id: "web-main",
                channel_type: "web",
                content: "Create a new utility function file",
                user_id: "user-123",
                timestamp: new Date().toISOString()
            };

            // Worker
            const workerOutput = await orchestrator.workerProcess(message);
            expect(workerOutput.task_type).toBe("coding");
            expect(workerOutput.actions.some(a => a.type === "file_create")).toBe(true);
            expect(workerOutput.risk_level).toBe("low");

            // Auditor
            const auditorDecision = await orchestrator.auditorProcess(workerOutput);
            expect(auditorDecision.approved).toBe(true);
            expect(auditorDecision.approval_type).toBe("auto"); // Low risk = auto-approve

            // Executor
            const executorResult = await orchestrator.executorProcess(workerOutput, auditorDecision);
            expect(executorResult.status).toBe("success");
            expect(executorResult.changes.files_created.length).toBeGreaterThan(0);

            // Response
            const response = orchestrator.generateResponse(message, executorResult);
            expect(response.content).toContain("completed successfully");
            expect(response.channel_id).toBe(message.channel_id);
        });

        it("should process edit request", async () => {
            // Create existing file first
            const existingFile = path.join(PROJECT_DIR, "src/existing.ts");
            await fs.promises.mkdir(path.dirname(existingFile), { recursive: true });
            await fs.promises.writeFile(existingFile, "// Original content");

            const message: OpenClawMessage = {
                message_id: "MSG-002",
                channel_id: "telegram-123",
                channel_type: "telegram",
                content: "Edit the existing configuration",
                user_id: "user-456",
                timestamp: new Date().toISOString()
            };

            const workerOutput = await orchestrator.workerProcess(message);
            const auditorDecision = await orchestrator.auditorProcess(workerOutput);
            const executorResult = await orchestrator.executorProcess(workerOutput, auditorDecision);

            expect(executorResult.status).toBe("success");
            expect(executorResult.changes.files_modified.length).toBeGreaterThan(0);
        });
    });

    describe("Risk-Based Flow", () => {
        it("should auto-approve low risk tasks", async () => {
            orchestrator.setAutoApproveRisk("low");

            const message: OpenClawMessage = {
                message_id: "MSG-003",
                channel_id: "web",
                channel_type: "web",
                content: "Create a simple helper function",
                user_id: "user",
                timestamp: new Date().toISOString()
            };

            const workerOutput = await orchestrator.workerProcess(message);
            expect(workerOutput.risk_level).toBe("low");

            const auditorDecision = await orchestrator.auditorProcess(workerOutput);
            expect(auditorDecision.approval_type).toBe("auto");
        });

        it("should require user approval for high risk", async () => {
            orchestrator.setAutoApproveRisk("low");

            const message: OpenClawMessage = {
                message_id: "MSG-004",
                channel_id: "web",
                channel_type: "web",
                content: "Delete all deprecated files and create multiple new modules",
                user_id: "user",
                timestamp: new Date().toISOString()
            };

            const workerOutput = await orchestrator.workerProcess(message);
            // Force high risk for test
            workerOutput.risk_level = "high";

            const auditorDecision = await orchestrator.auditorProcess(workerOutput);
            expect(auditorDecision.approval_type).toBe("user");
        });

        it("should auto-approve medium risk when configured", async () => {
            orchestrator.setAutoApproveRisk("medium");

            const message: OpenClawMessage = {
                message_id: "MSG-005",
                channel_id: "cli",
                channel_type: "cli",
                content: "Delete the old config file",
                user_id: "admin",
                timestamp: new Date().toISOString()
            };

            const workerOutput = await orchestrator.workerProcess(message);
            expect(workerOutput.risk_level).toBe("medium");

            const auditorDecision = await orchestrator.auditorProcess(workerOutput);
            expect(auditorDecision.approval_type).toBe("auto");
        });
    });

    describe("Security Enforcement", () => {
        it("should block path traversal", async () => {
            const message: OpenClawMessage = {
                message_id: "MSG-006",
                channel_id: "web",
                channel_type: "web",
                content: "Edit file",
                user_id: "user",
                timestamp: new Date().toISOString()
            };

            const workerOutput = await orchestrator.workerProcess(message);
            // Inject malicious path
            workerOutput.actions[0].target = "../../../etc/passwd";

            const auditorDecision = await orchestrator.auditorProcess(workerOutput);
            expect(auditorDecision.approved).toBe(false);
            expect(auditorDecision.rejection_reason).toContain("Path traversal");
        });

        it("should block sensitive file access", async () => {
            const message: OpenClawMessage = {
                message_id: "MSG-007",
                channel_id: "discord",
                channel_type: "discord",
                content: "Edit configuration",
                user_id: "user",
                timestamp: new Date().toISOString()
            };

            const workerOutput = await orchestrator.workerProcess(message);
            workerOutput.actions[0].target = ".env.production";

            const auditorDecision = await orchestrator.auditorProcess(workerOutput);
            expect(auditorDecision.approved).toBe(false);
            expect(auditorDecision.rejection_reason).toContain("Sensitive file");
        });

        it("should reject unsigned orders", async () => {
            const message: OpenClawMessage = {
                message_id: "MSG-008",
                channel_id: "web",
                channel_type: "web",
                content: "Create file",
                user_id: "user",
                timestamp: new Date().toISOString()
            };

            const workerOutput = await orchestrator.workerProcess(message);
            const auditorDecision: AuditorDecision = {
                order_id: "ORD-TEST",
                approved: true,
                approval_type: "auto",
                signature: undefined // Missing signature!
            };

            const executorResult = await orchestrator.executorProcess(workerOutput, auditorDecision);
            expect(executorResult.status).toBe("rejected");
            expect(executorResult.errors).toContain("Missing signature");
        });
    });

    describe("Error Handling", () => {
        it("should handle partial failures gracefully", async () => {
            const message: OpenClawMessage = {
                message_id: "MSG-009",
                channel_id: "web",
                channel_type: "web",
                content: "Create multiple files",
                user_id: "user",
                timestamp: new Date().toISOString()
            };

            const workerOutput = await orchestrator.workerProcess(message);
            // Add invalid action
            workerOutput.actions.push({
                action_id: `ACT-bad`,
                type: "code_edit",
                target: "../invalid/path.ts",
                params: {}
            });

            const auditorDecision = await orchestrator.auditorProcess(workerOutput);
            // Remove security check for this test
            auditorDecision.approved = true;
            auditorDecision.signature = "SIG-test";

            const executorResult = await orchestrator.executorProcess(workerOutput, auditorDecision);
            expect(executorResult.status).toBe("partial");
            expect(executorResult.errors.length).toBeGreaterThan(0);
        });

        it("should generate appropriate error response", async () => {
            const message: OpenClawMessage = {
                message_id: "MSG-010",
                channel_id: "telegram",
                channel_type: "telegram",
                content: "Do something",
                user_id: "user",
                timestamp: new Date().toISOString()
            };

            const executorResult: ExecutorResult = {
                receipt_id: "RCPT-ERR",
                status: "failed",
                changes: { files_created: [], files_modified: [], files_deleted: [] },
                errors: ["Action failed: Permission denied", "Another error"]
            };

            const response = orchestrator.generateResponse(message, executorResult);
            expect(response.content).toContain("failed");
            expect(response.content).toContain("Permission denied");
        });
    });

    describe("Channel-Specific Handling", () => {
        const channels: OpenClawMessage["channel_type"][] = ["web", "telegram", "discord", "cli"];

        for (const channelType of channels) {
            it(`should process messages from ${channelType} channel`, async () => {
                const message: OpenClawMessage = {
                    message_id: `MSG-${channelType}`,
                    channel_id: `${channelType}-123`,
                    channel_type: channelType,
                    content: "Create a new component",
                    user_id: `user-${channelType}`,
                    timestamp: new Date().toISOString()
                };

                const workerOutput = await orchestrator.workerProcess(message);
                const auditorDecision = await orchestrator.auditorProcess(workerOutput);
                const executorResult = await orchestrator.executorProcess(workerOutput, auditorDecision);
                const response = orchestrator.generateResponse(message, executorResult);

                expect(response.channel_id).toBe(message.channel_id);
                expect(executorResult.status).toBe("success");
            });
        }
    });

    describe("Memory Integration", () => {
        it("should store conversation context", async () => {
            const message: OpenClawMessage = {
                message_id: "MSG-MEM-001",
                channel_id: "web",
                channel_type: "web",
                content: "Create a user authentication module",
                user_id: "user",
                timestamp: new Date().toISOString()
            };

            const workerOutput = await orchestrator.workerProcess(message);

            expect(workerOutput.memory_context.conversation_ctx_id).toBeDefined();
            expect(workerOutput.memory_context.conversation_ctx_id).toBeGreaterThan(0);
        });

        it("should accumulate context across messages", async () => {
            const messages: OpenClawMessage[] = [
                {
                    message_id: "MSG-MEM-002",
                    channel_id: "web",
                    channel_type: "web",
                    content: "Create user model",
                    user_id: "user",
                    timestamp: new Date().toISOString()
                },
                {
                    message_id: "MSG-MEM-003",
                    channel_id: "web",
                    channel_type: "web",
                    content: "Create user authentication",
                    user_id: "user",
                    timestamp: new Date().toISOString()
                }
            ];

            const outputs: WorkerOutput[] = [];
            for (const msg of messages) {
                outputs.push(await orchestrator.workerProcess(msg));
            }

            // Second message should have more context
            expect(outputs[1].memory_context.conversation_ctx_id).toBeGreaterThan(
                outputs[0].memory_context.conversation_ctx_id!
            );
        });
    });

    describe("Complete Flow Tracing", () => {
        it("should trace complete flow with all IDs linked", async () => {
            const message: OpenClawMessage = {
                message_id: "MSG-TRACE",
                channel_id: "web-trace",
                channel_type: "web",
                content: "Create a new service module",
                user_id: "trace-user",
                timestamp: new Date().toISOString()
            };

            // Full flow
            const workerOutput = await orchestrator.workerProcess(message);
            const auditorDecision = await orchestrator.auditorProcess(workerOutput);
            const executorResult = await orchestrator.executorProcess(workerOutput, auditorDecision);
            const response = orchestrator.generateResponse(message, executorResult);

            // Verify ID chain
            expect(workerOutput.evidence_id).toMatch(/^EV-\d+$/);
            expect(workerOutput.plan_id).toMatch(/^PLAN-\d+$/);
            expect(auditorDecision.order_id).toMatch(/^ORD-\d+$/);
            expect(executorResult.receipt_id).toMatch(/^RCPT-\d+$/);
            expect(response.response_id).toMatch(/^RESP-\d+$/);

            // All completed successfully
            expect(auditorDecision.approved).toBe(true);
            expect(executorResult.status).toBe("success");
            expect(response.content).toContain("successfully");
        });
    });
});
