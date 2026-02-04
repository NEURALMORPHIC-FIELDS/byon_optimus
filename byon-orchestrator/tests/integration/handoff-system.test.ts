/**
 * Handoff System Integration Tests
 * =================================
 *
 * Tests the file-based handoff communication between agents:
 * - Worker -> Auditor
 * - Auditor -> User (approval requests)
 * - Auditor -> Executor
 * - Executor -> Worker (receipts)
 *
 * Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

// ============================================
// Test Configuration
// ============================================

const TEST_HANDOFF_ROOT = "./test-handoff-system";

const HANDOFF_CHANNELS = {
    INBOX: "inbox",
    WORKER_TO_AUDITOR: "worker_to_auditor",
    AUDITOR_TO_USER: "auditor_to_user",
    AUDITOR_TO_EXECUTOR: "auditor_to_executor",
    EXECUTOR_TO_WORKER: "executor_to_worker"
} as const;

// ============================================
// Types
// ============================================

interface HandoffMessage<T = unknown> {
    message_id: string;
    timestamp: string;
    source: string;
    destination: string;
    payload: T;
    hash: string;
}

interface EvidencePack {
    evidence_id: string;
    task_type: string;
    sources: Array<{ type: string; content: string }>;
    hash: string;
}

interface PlanDraft {
    plan_id: string;
    based_on_evidence: string;
    intent: string;
    actions: Array<{ type: string; target: string }>;
    risk_level: "low" | "medium" | "high";
    hash: string;
}

interface ApprovalRequest {
    request_id: string;
    based_on_plan: string;
    summary: string;
    risk_level: string;
    expires_at: string;
    hash: string;
}

interface ExecutionOrder {
    order_id: string;
    based_on_plan: string;
    actions: Array<{ type: string; target: string }>;
    signature: string;
    hash: string;
}

interface JohnsonReceipt {
    receipt_id: string;
    based_on_order: string;
    execution_summary: {
        status: string;
        actions_completed: number;
        actions_failed: number;
    };
    hash: string;
}

// ============================================
// Handoff Manager
// ============================================

class HandoffManager {
    private rootDir: string;

    constructor(rootDir: string) {
        this.rootDir = rootDir;
    }

    async initialize(): Promise<void> {
        for (const channel of Object.values(HANDOFF_CHANNELS)) {
            const channelPath = path.join(this.rootDir, channel);
            await fs.promises.mkdir(channelPath, { recursive: true });
        }
    }

    async send<T>(
        channel: string,
        payload: T,
        source: string,
        destination: string
    ): Promise<string> {
        const messageId = `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const timestamp = new Date().toISOString();
        const hash = this.computeHash(JSON.stringify(payload));

        const message: HandoffMessage<T> = {
            message_id: messageId,
            timestamp,
            source,
            destination,
            payload,
            hash
        };

        const channelPath = path.join(this.rootDir, channel);
        const filePath = path.join(channelPath, `${messageId}.json`);

        await fs.promises.writeFile(filePath, JSON.stringify(message, null, 2));

        return messageId;
    }

    async receive<T>(channel: string): Promise<Array<HandoffMessage<T>>> {
        const channelPath = path.join(this.rootDir, channel);

        if (!fs.existsSync(channelPath)) {
            return [];
        }

        const files = await fs.promises.readdir(channelPath);
        const jsonFiles = files.filter(f => f.endsWith(".json"));

        const messages: Array<HandoffMessage<T>> = [];

        for (const file of jsonFiles) {
            const filePath = path.join(channelPath, file);
            const content = await fs.promises.readFile(filePath, "utf-8");
            const message = JSON.parse(content) as HandoffMessage<T>;

            // Verify hash
            const expectedHash = this.computeHash(JSON.stringify(message.payload));
            if (message.hash !== expectedHash) {
                console.warn(`Hash mismatch for message ${message.message_id}`);
                continue;
            }

            messages.push(message);
        }

        return messages.sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
    }

    async acknowledge(channel: string, messageId: string): Promise<void> {
        const filePath = path.join(this.rootDir, channel, `${messageId}.json`);
        if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
        }
    }

    async getPending(channel: string): Promise<number> {
        const channelPath = path.join(this.rootDir, channel);
        if (!fs.existsSync(channelPath)) {
            return 0;
        }
        const files = await fs.promises.readdir(channelPath);
        return files.filter(f => f.endsWith(".json")).length;
    }

    private computeHash(data: string): string {
        return crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
    }
}

// ============================================
// File Watcher
// ============================================

class FileWatcher {
    private watchers: Map<string, ReturnType<typeof setInterval>> = new Map();
    private callbacks: Map<string, (files: string[]) => void> = new Map();
    private pollInterval: number;

    constructor(pollInterval: number = 100) {
        this.pollInterval = pollInterval;
    }

    watch(directory: string, callback: (files: string[]) => void): void {
        this.callbacks.set(directory, callback);
        let lastFiles: string[] = [];

        const watcher = setInterval(async () => {
            if (!fs.existsSync(directory)) {
                return;
            }

            const files = await fs.promises.readdir(directory);
            const jsonFiles = files.filter(f => f.endsWith(".json"));

            // Check for new files
            const newFiles = jsonFiles.filter(f => !lastFiles.includes(f));
            if (newFiles.length > 0) {
                callback(newFiles);
            }

            lastFiles = jsonFiles;
        }, this.pollInterval);

        this.watchers.set(directory, watcher);
    }

    stop(directory: string): void {
        const watcher = this.watchers.get(directory);
        if (watcher) {
            clearInterval(watcher);
            this.watchers.delete(directory);
        }
    }

    stopAll(): void {
        for (const [dir] of this.watchers) {
            this.stop(dir);
        }
    }
}

// ============================================
// Integration Tests
// ============================================

describe("Handoff System Integration", () => {
    let handoff: HandoffManager;
    let watcher: FileWatcher;

    beforeEach(async () => {
        // Cleanup and setup
        if (fs.existsSync(TEST_HANDOFF_ROOT)) {
            fs.rmSync(TEST_HANDOFF_ROOT, { recursive: true });
        }

        handoff = new HandoffManager(TEST_HANDOFF_ROOT);
        await handoff.initialize();

        watcher = new FileWatcher(50); // Fast polling for tests
    });

    afterEach(() => {
        watcher.stopAll();
        if (fs.existsSync(TEST_HANDOFF_ROOT)) {
            fs.rmSync(TEST_HANDOFF_ROOT, { recursive: true });
        }
    });

    describe("Channel Initialization", () => {
        it("should create all handoff directories", async () => {
            for (const channel of Object.values(HANDOFF_CHANNELS)) {
                const channelPath = path.join(TEST_HANDOFF_ROOT, channel);
                expect(fs.existsSync(channelPath)).toBe(true);
            }
        });
    });

    describe("Message Serialization", () => {
        it("should send message with hash verification", async () => {
            const payload = { test: "data", value: 42 };

            const messageId = await handoff.send(
                HANDOFF_CHANNELS.INBOX,
                payload,
                "external",
                "worker"
            );

            expect(messageId).toMatch(/^MSG-\d+-\w+$/);

            const messages = await handoff.receive<typeof payload>(HANDOFF_CHANNELS.INBOX);
            expect(messages).toHaveLength(1);
            expect(messages[0].payload).toEqual(payload);
        });

        it("should preserve message order by timestamp", async () => {
            await handoff.send(HANDOFF_CHANNELS.INBOX, { order: 1 }, "src", "dest");
            await new Promise(r => setTimeout(r, 10));
            await handoff.send(HANDOFF_CHANNELS.INBOX, { order: 2 }, "src", "dest");
            await new Promise(r => setTimeout(r, 10));
            await handoff.send(HANDOFF_CHANNELS.INBOX, { order: 3 }, "src", "dest");

            const messages = await handoff.receive<{ order: number }>(HANDOFF_CHANNELS.INBOX);

            expect(messages).toHaveLength(3);
            expect(messages[0].payload.order).toBe(1);
            expect(messages[1].payload.order).toBe(2);
            expect(messages[2].payload.order).toBe(3);
        });

        it("should acknowledge and remove messages", async () => {
            const id = await handoff.send(HANDOFF_CHANNELS.INBOX, { data: "test" }, "s", "d");

            let pending = await handoff.getPending(HANDOFF_CHANNELS.INBOX);
            expect(pending).toBe(1);

            await handoff.acknowledge(HANDOFF_CHANNELS.INBOX, id);

            pending = await handoff.getPending(HANDOFF_CHANNELS.INBOX);
            expect(pending).toBe(0);
        });
    });

    describe("Worker -> Auditor Handoff", () => {
        it("should transfer evidence pack and plan draft", async () => {
            const evidence: EvidencePack = {
                evidence_id: "EV-001",
                task_type: "coding",
                sources: [{ type: "user_message", content: "Add feature" }],
                hash: "hash-ev"
            };

            const plan: PlanDraft = {
                plan_id: "PLAN-001",
                based_on_evidence: "EV-001",
                intent: "Add new feature",
                actions: [{ type: "code_edit", target: "src/feature.ts" }],
                risk_level: "low",
                hash: "hash-plan"
            };

            await handoff.send(
                HANDOFF_CHANNELS.WORKER_TO_AUDITOR,
                { evidence, plan },
                "worker",
                "auditor"
            );

            const messages = await handoff.receive<{ evidence: EvidencePack; plan: PlanDraft }>(
                HANDOFF_CHANNELS.WORKER_TO_AUDITOR
            );

            expect(messages).toHaveLength(1);
            expect(messages[0].payload.evidence.evidence_id).toBe("EV-001");
            expect(messages[0].payload.plan.plan_id).toBe("PLAN-001");
        });
    });

    describe("Auditor -> User Handoff (Approval Requests)", () => {
        it("should send approval request", async () => {
            const approval: ApprovalRequest = {
                request_id: "REQ-001",
                based_on_plan: "PLAN-001",
                summary: "Create new API endpoint",
                risk_level: "medium",
                expires_at: new Date(Date.now() + 3600000).toISOString(),
                hash: "hash-req"
            };

            await handoff.send(
                HANDOFF_CHANNELS.AUDITOR_TO_USER,
                approval,
                "auditor",
                "user"
            );

            const messages = await handoff.receive<ApprovalRequest>(
                HANDOFF_CHANNELS.AUDITOR_TO_USER
            );

            expect(messages).toHaveLength(1);
            expect(messages[0].payload.request_id).toBe("REQ-001");
            expect(messages[0].payload.risk_level).toBe("medium");
        });

        it("should handle multiple pending approvals", async () => {
            for (let i = 0; i < 3; i++) {
                await handoff.send(
                    HANDOFF_CHANNELS.AUDITOR_TO_USER,
                    { request_id: `REQ-${i}`, summary: `Request ${i}` },
                    "auditor",
                    "user"
                );
            }

            const pending = await handoff.getPending(HANDOFF_CHANNELS.AUDITOR_TO_USER);
            expect(pending).toBe(3);

            const messages = await handoff.receive(HANDOFF_CHANNELS.AUDITOR_TO_USER);
            expect(messages).toHaveLength(3);
        });
    });

    describe("Auditor -> Executor Handoff", () => {
        it("should send signed execution order", async () => {
            const order: ExecutionOrder = {
                order_id: "ORD-001",
                based_on_plan: "PLAN-001",
                actions: [
                    { type: "file_create", target: "src/new-file.ts" }
                ],
                signature: "SIG-mock-ed25519-signature",
                hash: "hash-order"
            };

            await handoff.send(
                HANDOFF_CHANNELS.AUDITOR_TO_EXECUTOR,
                order,
                "auditor",
                "executor"
            );

            const messages = await handoff.receive<ExecutionOrder>(
                HANDOFF_CHANNELS.AUDITOR_TO_EXECUTOR
            );

            expect(messages).toHaveLength(1);
            expect(messages[0].payload.order_id).toBe("ORD-001");
            expect(messages[0].payload.signature).toMatch(/^SIG-/);
        });
    });

    describe("Executor -> Worker Handoff (Receipts)", () => {
        it("should send execution receipt", async () => {
            const receipt: JohnsonReceipt = {
                receipt_id: "RCPT-001",
                based_on_order: "ORD-001",
                execution_summary: {
                    status: "success",
                    actions_completed: 3,
                    actions_failed: 0
                },
                hash: "hash-receipt"
            };

            await handoff.send(
                HANDOFF_CHANNELS.EXECUTOR_TO_WORKER,
                receipt,
                "executor",
                "worker"
            );

            const messages = await handoff.receive<JohnsonReceipt>(
                HANDOFF_CHANNELS.EXECUTOR_TO_WORKER
            );

            expect(messages).toHaveLength(1);
            expect(messages[0].payload.receipt_id).toBe("RCPT-001");
            expect(messages[0].payload.execution_summary.status).toBe("success");
        });
    });

    describe("File Watcher", () => {
        it("should detect new files", async () => {
            const receivedFiles: string[] = [];

            watcher.watch(
                path.join(TEST_HANDOFF_ROOT, HANDOFF_CHANNELS.INBOX),
                files => receivedFiles.push(...files)
            );

            await handoff.send(HANDOFF_CHANNELS.INBOX, { data: "test" }, "s", "d");

            // Wait for watcher to detect
            await new Promise(r => setTimeout(r, 150));

            expect(receivedFiles.length).toBeGreaterThan(0);
            expect(receivedFiles[0]).toMatch(/^MSG-.*\.json$/);
        });

        it("should not re-notify for existing files", async () => {
            await handoff.send(HANDOFF_CHANNELS.INBOX, { data: "existing" }, "s", "d");

            let notificationCount = 0;

            watcher.watch(
                path.join(TEST_HANDOFF_ROOT, HANDOFF_CHANNELS.INBOX),
                () => notificationCount++
            );

            // Wait for a few poll cycles
            await new Promise(r => setTimeout(r, 200));

            // Should notify only once for the initial file
            expect(notificationCount).toBeLessThanOrEqual(1);
        });

        it("should stop watching", async () => {
            const receivedFiles: string[] = [];
            const channelPath = path.join(TEST_HANDOFF_ROOT, HANDOFF_CHANNELS.INBOX);

            watcher.watch(channelPath, files => receivedFiles.push(...files));

            // Stop the watcher
            watcher.stop(channelPath);

            // Add new file
            await handoff.send(HANDOFF_CHANNELS.INBOX, { data: "after-stop" }, "s", "d");
            await new Promise(r => setTimeout(r, 150));

            // Should not have received the new file
            expect(receivedFiles.filter(f => f.includes("after-stop")).length).toBe(0);
        });
    });

    describe("Full Handoff Flow", () => {
        it("should complete full MACP flow via handoff", async () => {
            // 1. External message arrives in inbox
            const inboxMessage = { content: "Create new endpoint", channel: "web" };
            await handoff.send(HANDOFF_CHANNELS.INBOX, inboxMessage, "web", "worker");

            // 2. Worker processes and sends to auditor
            const inboxMsgs = await handoff.receive(HANDOFF_CHANNELS.INBOX);
            expect(inboxMsgs).toHaveLength(1);

            const evidence: EvidencePack = {
                evidence_id: "EV-FLOW-001",
                task_type: "coding",
                sources: [{ type: "user_message", content: inboxMessage.content }],
                hash: "hash-ev-flow"
            };

            const plan: PlanDraft = {
                plan_id: "PLAN-FLOW-001",
                based_on_evidence: evidence.evidence_id,
                intent: "Create API endpoint",
                actions: [{ type: "file_create", target: "src/api/endpoint.ts" }],
                risk_level: "low",
                hash: "hash-plan-flow"
            };

            await handoff.send(
                HANDOFF_CHANNELS.WORKER_TO_AUDITOR,
                { evidence, plan },
                "worker",
                "auditor"
            );

            // Clean up inbox
            await handoff.acknowledge(HANDOFF_CHANNELS.INBOX, inboxMsgs[0].message_id);

            // 3. Auditor validates and sends to executor (auto-approve for low risk)
            const auditorMsgs = await handoff.receive<{ evidence: EvidencePack; plan: PlanDraft }>(
                HANDOFF_CHANNELS.WORKER_TO_AUDITOR
            );
            expect(auditorMsgs).toHaveLength(1);

            const order: ExecutionOrder = {
                order_id: "ORD-FLOW-001",
                based_on_plan: plan.plan_id,
                actions: plan.actions,
                signature: "SIG-auto-approved",
                hash: "hash-order-flow"
            };

            await handoff.send(
                HANDOFF_CHANNELS.AUDITOR_TO_EXECUTOR,
                order,
                "auditor",
                "executor"
            );

            // Clean up auditor inbox
            await handoff.acknowledge(
                HANDOFF_CHANNELS.WORKER_TO_AUDITOR,
                auditorMsgs[0].message_id
            );

            // 4. Executor executes and sends receipt
            const executorMsgs = await handoff.receive<ExecutionOrder>(
                HANDOFF_CHANNELS.AUDITOR_TO_EXECUTOR
            );
            expect(executorMsgs).toHaveLength(1);

            const receipt: JohnsonReceipt = {
                receipt_id: "RCPT-FLOW-001",
                based_on_order: order.order_id,
                execution_summary: {
                    status: "success",
                    actions_completed: 1,
                    actions_failed: 0
                },
                hash: "hash-receipt-flow"
            };

            await handoff.send(
                HANDOFF_CHANNELS.EXECUTOR_TO_WORKER,
                receipt,
                "executor",
                "worker"
            );

            // Clean up executor inbox
            await handoff.acknowledge(
                HANDOFF_CHANNELS.AUDITOR_TO_EXECUTOR,
                executorMsgs[0].message_id
            );

            // 5. Worker receives receipt
            const workerMsgs = await handoff.receive<JohnsonReceipt>(
                HANDOFF_CHANNELS.EXECUTOR_TO_WORKER
            );
            expect(workerMsgs).toHaveLength(1);
            expect(workerMsgs[0].payload.receipt_id).toBe("RCPT-FLOW-001");
            expect(workerMsgs[0].payload.execution_summary.status).toBe("success");

            // Verify all channels are empty
            for (const channel of Object.values(HANDOFF_CHANNELS)) {
                if (channel !== HANDOFF_CHANNELS.EXECUTOR_TO_WORKER) {
                    expect(await handoff.getPending(channel)).toBe(0);
                }
            }
        });

        it("should handle approval flow for medium/high risk", async () => {
            // 1. Worker sends high-risk plan
            const plan: PlanDraft = {
                plan_id: "PLAN-HIGH-001",
                based_on_evidence: "EV-HIGH-001",
                intent: "Delete old files",
                actions: [{ type: "file_delete", target: "src/deprecated/" }],
                risk_level: "high",
                hash: "hash-high"
            };

            await handoff.send(
                HANDOFF_CHANNELS.WORKER_TO_AUDITOR,
                { evidence: { evidence_id: "EV-HIGH-001" }, plan },
                "worker",
                "auditor"
            );

            // 2. Auditor sends approval request to user
            const approval: ApprovalRequest = {
                request_id: "REQ-HIGH-001",
                based_on_plan: plan.plan_id,
                summary: "Delete deprecated files",
                risk_level: "high",
                expires_at: new Date(Date.now() + 3600000).toISOString(),
                hash: "hash-approval"
            };

            await handoff.send(
                HANDOFF_CHANNELS.AUDITOR_TO_USER,
                approval,
                "auditor",
                "user"
            );

            // 3. Verify approval is pending
            const pending = await handoff.getPending(HANDOFF_CHANNELS.AUDITOR_TO_USER);
            expect(pending).toBe(1);

            const approvals = await handoff.receive<ApprovalRequest>(
                HANDOFF_CHANNELS.AUDITOR_TO_USER
            );
            expect(approvals[0].payload.risk_level).toBe("high");
        });
    });
});
