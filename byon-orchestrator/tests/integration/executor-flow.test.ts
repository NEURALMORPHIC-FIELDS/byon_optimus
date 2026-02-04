/**
 * Executor Flow Integration Tests
 * ================================
 *
 * Tests the Executor agent receiving signed orders,
 * verifying signatures, executing actions, and generating receipts.
 *
 * Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================
// Test Configuration
// ============================================

const TEST_HANDOFF_DIR = "./test-handoff-executor";
const TEST_PROJECT_DIR = "./test-project";

// ============================================
// Types
// ============================================

interface ExecutionOrder {
    order_id: string;
    timestamp: string;
    based_on_plan: string;
    approved_by: string;
    approved_at: string;
    actions: Array<{
        action_id: string;
        type: "code_edit" | "file_create" | "file_delete" | "test_run" | "lint_run";
        target: string;
        params: Record<string, unknown>;
    }>;
    signature: string;
    hash: string;
}

interface JohnsonReceipt {
    receipt_id: string;
    timestamp: string;
    based_on_order: string;
    execution_summary: {
        status: "success" | "partial" | "failed" | "rejected";
        actions_total: number;
        actions_completed: number;
        actions_failed: number;
        duration_ms: number;
    };
    action_results: Array<{
        action_id: string;
        status: "success" | "failed" | "skipped";
        error?: string;
        output?: string;
    }>;
    changes_made: {
        files_modified: string[];
        files_created: string[];
        files_deleted: string[];
    };
    verification: {
        tests_passing: boolean | null;
        lint_passing: boolean | null;
        build_passing: boolean | null;
    };
    hash: string;
}

// ============================================
// Mock Executor Agent (AIR-GAPPED)
// ============================================

class MockExecutorAgent {
    private handoffDir: string;
    private projectDir: string;
    private publicKey: string;

    // AIR-GAP: No network operations allowed
    private readonly NETWORK_DISABLED = true;

    constructor(handoffDir: string, projectDir: string) {
        this.handoffDir = handoffDir;
        this.projectDir = projectDir;
        this.publicKey = "mock-public-key";
    }

    receiveFromAuditor(): ExecutionOrder[] {
        const handoffPath = path.join(this.handoffDir, "auditor_to_executor");
        if (!fs.existsSync(handoffPath)) {
            return [];
        }

        const files = fs.readdirSync(handoffPath).filter(f => f.endsWith(".json"));
        return files.map(file => {
            const content = fs.readFileSync(path.join(handoffPath, file), "utf-8");
            fs.unlinkSync(path.join(handoffPath, file)); // Clean up
            return JSON.parse(content) as ExecutionOrder;
        });
    }

    verifySignature(order: ExecutionOrder): boolean {
        // Mock signature verification
        // In real implementation: Ed25519 verify using public key
        if (!order.signature || !order.signature.startsWith("SIG-")) {
            return false;
        }

        // Reconstruct expected signature data
        const expectedData = `${order.order_id}:${order.based_on_plan}:${order.approved_by}`;
        const expectedSig = `SIG-${Buffer.from(expectedData).toString("base64").slice(0, 32)}`;

        return order.signature === expectedSig;
    }

    async executeOrder(order: ExecutionOrder): Promise<JohnsonReceipt> {
        const startTime = Date.now();
        const actionResults: JohnsonReceipt["action_results"] = [];
        const changes: JohnsonReceipt["changes_made"] = {
            files_modified: [],
            files_created: [],
            files_deleted: []
        };

        // Verify signature first
        if (!this.verifySignature(order)) {
            return this.createRejectionReceipt(order, "Invalid signature");
        }

        // Execute each action
        for (const action of order.actions) {
            try {
                // Security check: path traversal
                if (action.target.includes("..")) {
                    throw new Error("Path traversal detected");
                }

                // Security check: forbidden paths
                const forbiddenPaths = ["/etc", "/usr", ".env", ".git", "node_modules"];
                if (forbiddenPaths.some(fp => action.target.includes(fp))) {
                    throw new Error(`Forbidden path: ${action.target}`);
                }

                // Execute action based on type
                const result = await this.executeAction(action, changes);
                actionResults.push({
                    action_id: action.action_id,
                    status: "success",
                    output: result
                });
            } catch (error) {
                actionResults.push({
                    action_id: action.action_id,
                    status: "failed",
                    error: error instanceof Error ? error.message : "Unknown error"
                });
            }
        }

        const duration = Date.now() - startTime;
        const completed = actionResults.filter(r => r.status === "success").length;
        const failed = actionResults.filter(r => r.status === "failed").length;

        return {
            receipt_id: `RCPT-${Date.now()}`,
            timestamp: new Date().toISOString(),
            based_on_order: order.order_id,
            execution_summary: {
                status: failed === 0 ? "success" : completed === 0 ? "failed" : "partial",
                actions_total: order.actions.length,
                actions_completed: completed,
                actions_failed: failed,
                duration_ms: duration
            },
            action_results: actionResults,
            changes_made: changes,
            verification: {
                tests_passing: null, // Would run tests in real implementation
                lint_passing: null,
                build_passing: null
            },
            hash: this.computeHash(`RCPT-${order.order_id}`)
        };
    }

    private async executeAction(
        action: ExecutionOrder["actions"][0],
        changes: JohnsonReceipt["changes_made"]
    ): Promise<string> {
        const targetPath = path.join(this.projectDir, action.target);

        switch (action.type) {
            case "file_create": {
                const content = action.params.content as string || "";
                fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                fs.writeFileSync(targetPath, content);
                changes.files_created.push(action.target);
                return `Created: ${action.target}`;
            }

            case "code_edit": {
                if (!fs.existsSync(targetPath)) {
                    // Create if doesn't exist
                    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                    fs.writeFileSync(targetPath, action.params.content as string || "");
                    changes.files_created.push(action.target);
                } else {
                    // Modify existing
                    const existing = fs.readFileSync(targetPath, "utf-8");
                    const updated = (action.params.content as string) || existing;
                    fs.writeFileSync(targetPath, updated);
                    changes.files_modified.push(action.target);
                }
                return `Edited: ${action.target}`;
            }

            case "file_delete": {
                if (fs.existsSync(targetPath)) {
                    fs.unlinkSync(targetPath);
                    changes.files_deleted.push(action.target);
                }
                return `Deleted: ${action.target}`;
            }

            case "test_run":
            case "lint_run": {
                // AIR-GAPPED: Cannot actually run external commands
                // In real implementation: would use sandboxed execution
                return `Simulated ${action.type} for ${action.target}`;
            }

            default:
                throw new Error(`Unknown action type: ${action.type}`);
        }
    }

    sendReceiptToWorker(receipt: JohnsonReceipt): void {
        const handoffPath = path.join(this.handoffDir, "executor_to_worker");
        if (!fs.existsSync(handoffPath)) {
            fs.mkdirSync(handoffPath, { recursive: true });
        }

        fs.writeFileSync(
            path.join(handoffPath, `${receipt.receipt_id}.json`),
            JSON.stringify(receipt, null, 2)
        );
    }

    private createRejectionReceipt(order: ExecutionOrder, reason: string): JohnsonReceipt {
        return {
            receipt_id: `RCPT-${Date.now()}`,
            timestamp: new Date().toISOString(),
            based_on_order: order.order_id,
            execution_summary: {
                status: "rejected",
                actions_total: order.actions.length,
                actions_completed: 0,
                actions_failed: 0,
                duration_ms: 0
            },
            action_results: order.actions.map(a => ({
                action_id: a.action_id,
                status: "skipped" as const,
                error: reason
            })),
            changes_made: {
                files_modified: [],
                files_created: [],
                files_deleted: []
            },
            verification: {
                tests_passing: null,
                lint_passing: null,
                build_passing: null
            },
            hash: this.computeHash(`RCPT-REJECT-${order.order_id}`)
        };
    }

    private computeHash(data: string): string {
        return `HASH-${Buffer.from(data).toString("base64").slice(0, 16)}`;
    }
}

// ============================================
// Helper: Create Test Order
// ============================================

function createTestOrder(options: {
    type?: ExecutionOrder["actions"][0]["type"];
    target?: string;
    validSignature?: boolean;
}): ExecutionOrder {
    const orderId = `ORDER-${Date.now()}`;
    const planId = `PLAN-${Date.now()}`;
    const approver = "test@example.com";

    const order: ExecutionOrder = {
        order_id: orderId,
        timestamp: new Date().toISOString(),
        based_on_plan: planId,
        approved_by: approver,
        approved_at: new Date().toISOString(),
        actions: [
            {
                action_id: `ACT-${Date.now()}`,
                type: options.type || "code_edit",
                target: options.target || "src/test-file.ts",
                params: { content: "// Test content" }
            }
        ],
        signature: "",
        hash: ""
    };

    // Generate signature
    if (options.validSignature !== false) {
        const data = `${order.order_id}:${order.based_on_plan}:${order.approved_by}`;
        order.signature = `SIG-${Buffer.from(data).toString("base64").slice(0, 32)}`;
    } else {
        order.signature = "INVALID-SIGNATURE";
    }

    order.hash = `HASH-${Buffer.from(order.order_id).toString("base64").slice(0, 16)}`;

    return order;
}

// ============================================
// Integration Tests
// ============================================

describe("Executor Flow Integration", () => {
    let executor: MockExecutorAgent;

    beforeEach(() => {
        // Setup test directories
        [TEST_HANDOFF_DIR, TEST_PROJECT_DIR].forEach(dir => {
            if (fs.existsSync(dir)) {
                fs.rmSync(dir, { recursive: true });
            }
            fs.mkdirSync(dir, { recursive: true });
        });

        // Create executor handoff directory
        fs.mkdirSync(path.join(TEST_HANDOFF_DIR, "auditor_to_executor"), { recursive: true });
        fs.mkdirSync(path.join(TEST_HANDOFF_DIR, "executor_to_worker"), { recursive: true });

        executor = new MockExecutorAgent(TEST_HANDOFF_DIR, TEST_PROJECT_DIR);
    });

    afterEach(() => {
        // Cleanup
        [TEST_HANDOFF_DIR, TEST_PROJECT_DIR].forEach(dir => {
            if (fs.existsSync(dir)) {
                fs.rmSync(dir, { recursive: true });
            }
        });
    });

    describe("Signature Verification", () => {
        it("should accept valid signature", () => {
            const order = createTestOrder({ validSignature: true });
            expect(executor.verifySignature(order)).toBe(true);
        });

        it("should reject invalid signature", () => {
            const order = createTestOrder({ validSignature: false });
            expect(executor.verifySignature(order)).toBe(false);
        });

        it("should reject missing signature", () => {
            const order = createTestOrder({ validSignature: true });
            order.signature = "";
            expect(executor.verifySignature(order)).toBe(false);
        });
    });

    describe("Order Execution", () => {
        it("should execute file_create action", async () => {
            const order = createTestOrder({
                type: "file_create",
                target: "src/new-file.ts"
            });
            order.actions[0].params = { content: "export const x = 1;" };

            const receipt = await executor.executeOrder(order);

            expect(receipt.execution_summary.status).toBe("success");
            expect(receipt.changes_made.files_created).toContain("src/new-file.ts");

            // Verify file was created
            const filePath = path.join(TEST_PROJECT_DIR, "src/new-file.ts");
            expect(fs.existsSync(filePath)).toBe(true);
            expect(fs.readFileSync(filePath, "utf-8")).toBe("export const x = 1;");
        });

        it("should execute code_edit action", async () => {
            // Create existing file
            const existingPath = path.join(TEST_PROJECT_DIR, "src/existing.ts");
            fs.mkdirSync(path.dirname(existingPath), { recursive: true });
            fs.writeFileSync(existingPath, "// Original content");

            const order = createTestOrder({
                type: "code_edit",
                target: "src/existing.ts"
            });
            order.actions[0].params = { content: "// Modified content" };

            const receipt = await executor.executeOrder(order);

            expect(receipt.execution_summary.status).toBe("success");
            expect(receipt.changes_made.files_modified).toContain("src/existing.ts");
            expect(fs.readFileSync(existingPath, "utf-8")).toBe("// Modified content");
        });

        it("should execute file_delete action", async () => {
            // Create file to delete
            const filePath = path.join(TEST_PROJECT_DIR, "to-delete.ts");
            fs.writeFileSync(filePath, "delete me");

            const order = createTestOrder({
                type: "file_delete",
                target: "to-delete.ts"
            });

            const receipt = await executor.executeOrder(order);

            expect(receipt.execution_summary.status).toBe("success");
            expect(receipt.changes_made.files_deleted).toContain("to-delete.ts");
            expect(fs.existsSync(filePath)).toBe(false);
        });
    });

    describe("Security Enforcement", () => {
        it("should reject path traversal", async () => {
            const order = createTestOrder({
                target: "../../../etc/passwd"
            });

            const receipt = await executor.executeOrder(order);

            expect(receipt.action_results[0].status).toBe("failed");
            expect(receipt.action_results[0].error).toContain("Path traversal");
        });

        it("should reject forbidden paths", async () => {
            const forbiddenTargets = [
                ".env",
                ".git/config",
                "node_modules/package/index.js"
            ];

            for (const target of forbiddenTargets) {
                const order = createTestOrder({ target });
                const receipt = await executor.executeOrder(order);

                expect(receipt.action_results[0].status).toBe("failed");
                expect(receipt.action_results[0].error).toContain("Forbidden path");
            }
        });

        it("should reject unsigned orders", async () => {
            const order = createTestOrder({ validSignature: false });

            const receipt = await executor.executeOrder(order);

            expect(receipt.execution_summary.status).toBe("rejected");
            expect(receipt.action_results.every(r => r.status === "skipped")).toBe(true);
        });
    });

    describe("Receipt Generation", () => {
        it("should generate success receipt", async () => {
            const order = createTestOrder({
                type: "file_create",
                target: "success-test.ts"
            });

            const receipt = await executor.executeOrder(order);

            expect(receipt.receipt_id).toMatch(/^RCPT-\d+$/);
            expect(receipt.based_on_order).toBe(order.order_id);
            expect(receipt.execution_summary.status).toBe("success");
            expect(receipt.execution_summary.actions_total).toBe(1);
            expect(receipt.execution_summary.actions_completed).toBe(1);
            expect(receipt.execution_summary.actions_failed).toBe(0);
            expect(receipt.hash).toBeTruthy();
        });

        it("should generate partial receipt", async () => {
            const order = createTestOrder({ target: "valid-file.ts" });
            // Add a second action that will fail
            order.actions.push({
                action_id: `ACT-${Date.now() + 1}`,
                type: "code_edit",
                target: "../invalid-path.ts",
                params: {}
            });

            const receipt = await executor.executeOrder(order);

            expect(receipt.execution_summary.status).toBe("partial");
            expect(receipt.execution_summary.actions_completed).toBe(1);
            expect(receipt.execution_summary.actions_failed).toBe(1);
        });

        it("should send receipt to worker", async () => {
            const order = createTestOrder({ type: "file_create", target: "test.ts" });
            const receipt = await executor.executeOrder(order);

            executor.sendReceiptToWorker(receipt);

            const receiptPath = path.join(
                TEST_HANDOFF_DIR,
                "executor_to_worker",
                `${receipt.receipt_id}.json`
            );
            expect(fs.existsSync(receiptPath)).toBe(true);

            const saved = JSON.parse(fs.readFileSync(receiptPath, "utf-8"));
            expect(saved.receipt_id).toBe(receipt.receipt_id);
        });
    });

    describe("Full Executor Flow", () => {
        it("should complete full flow from order to receipt", async () => {
            // 1. Place order in handoff
            const order = createTestOrder({
                type: "file_create",
                target: "new-feature.ts"
            });
            order.actions[0].params = { content: "export function feature() { return 42; }" };

            const orderPath = path.join(
                TEST_HANDOFF_DIR,
                "auditor_to_executor",
                `${order.order_id}.json`
            );
            fs.writeFileSync(orderPath, JSON.stringify(order, null, 2));

            // 2. Executor receives order
            const orders = executor.receiveFromAuditor();
            expect(orders).toHaveLength(1);

            // 3. Verify signature
            expect(executor.verifySignature(orders[0])).toBe(true);

            // 4. Execute order
            const receipt = await executor.executeOrder(orders[0]);
            expect(receipt.execution_summary.status).toBe("success");

            // 5. Send receipt to worker
            executor.sendReceiptToWorker(receipt);

            // 6. Verify receipt in handoff
            const receiptFiles = fs.readdirSync(
                path.join(TEST_HANDOFF_DIR, "executor_to_worker")
            );
            expect(receiptFiles).toHaveLength(1);

            // 7. Verify file was created
            const createdFile = path.join(TEST_PROJECT_DIR, "new-feature.ts");
            expect(fs.existsSync(createdFile)).toBe(true);
            expect(fs.readFileSync(createdFile, "utf-8")).toContain("export function feature");
        });
    });
});
