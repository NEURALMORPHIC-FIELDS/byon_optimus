/**
 * Worker -> Auditor Integration Tests
 * ====================================
 *
 * Tests the flow from Worker generating EvidencePack and PlanDraft
 * to Auditor validating and signing ExecutionOrder.
 *
 * Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================
// Test Configuration
// ============================================

const TEST_HANDOFF_DIR = "./test-handoff";

// ============================================
// Mock Worker Agent
// ============================================

interface MockEvidencePack {
    evidence_id: string;
    timestamp: string;
    task_type: "coding" | "scheduling" | "messaging" | "general";
    sources: Array<{ type: string; content: string; source_id: string }>;
    extracted_facts: Array<{ fact: string; confidence: number; fact_id: string }>;
    memory_context: {
        conversation_ctx_id?: number;
        relevant_code_ctx_ids: number[];
        relevant_fact_ctx_ids: number[];
    };
    forbidden_data_present: boolean;
    hash: string;
}

interface MockPlanDraft {
    plan_id: string;
    timestamp: string;
    based_on_evidence: string;
    intent: string;
    actions: Array<{
        action_id: string;
        type: string;
        target: string;
        params: Record<string, unknown>;
    }>;
    risk_level: "low" | "medium" | "high";
    rollback_possible: boolean;
    estimated_iterations: number;
    hash: string;
}

class MockWorkerAgent {
    private handoffDir: string;
    private idCounter = 0;

    constructor(handoffDir: string) {
        this.handoffDir = handoffDir;
    }

    createEvidencePack(message: string, taskType: MockEvidencePack["task_type"]): MockEvidencePack {
        const evidenceId = `EV-${Date.now()}-${this.idCounter++}`;
        return {
            evidence_id: evidenceId,
            timestamp: new Date().toISOString(),
            task_type: taskType,
            sources: [
                {
                    type: "user_message",
                    content: message,
                    source_id: `SRC-${Date.now()}`
                }
            ],
            extracted_facts: [
                {
                    fact: `User requested: ${message.slice(0, 50)}`,
                    confidence: 0.9,
                    fact_id: `FACT-${Date.now()}`
                }
            ],
            memory_context: {
                conversation_ctx_id: 1,
                relevant_code_ctx_ids: [],
                relevant_fact_ctx_ids: []
            },
            forbidden_data_present: false,
            hash: this.computeHash(evidenceId)
        };
    }

    createPlanDraft(evidence: MockEvidencePack, intent: string): MockPlanDraft {
        const planId = `PLAN-${Date.now()}`;
        return {
            plan_id: planId,
            timestamp: new Date().toISOString(),
            based_on_evidence: evidence.evidence_id,
            intent: intent,
            actions: [
                {
                    action_id: `ACT-${Date.now()}`,
                    type: "code_edit",
                    target: "src/example.ts",
                    params: { changes: "add function" }
                }
            ],
            risk_level: "low",
            rollback_possible: true,
            estimated_iterations: 1,
            hash: this.computeHash(planId)
        };
    }

    sendToAuditor(evidence: MockEvidencePack, plan: MockPlanDraft): void {
        const handoffPath = path.join(this.handoffDir, "worker_to_auditor");
        if (!fs.existsSync(handoffPath)) {
            fs.mkdirSync(handoffPath, { recursive: true });
        }

        const payload = {
            evidence,
            plan,
            sent_at: new Date().toISOString()
        };

        fs.writeFileSync(
            path.join(handoffPath, `${plan.plan_id}.json`),
            JSON.stringify(payload, null, 2)
        );
    }

    private computeHash(data: string): string {
        // Simple mock hash for testing
        return `HASH-${Buffer.from(data).toString("base64").slice(0, 16)}`;
    }
}

// ============================================
// Mock Auditor Agent
// ============================================

interface MockExecutionOrder {
    order_id: string;
    timestamp: string;
    based_on_plan: string;
    approved_by: string;
    approved_at: string;
    actions: Array<{
        action_id: string;
        type: string;
        target: string;
        params: Record<string, unknown>;
    }>;
    signature: string;
    hash: string;
}

interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    security_checks: {
        forbidden_patterns: boolean;
        path_traversal: boolean;
        dangerous_commands: boolean;
    };
}

class MockAuditorAgent {
    private handoffDir: string;
    private privateKey: string;

    constructor(handoffDir: string) {
        this.handoffDir = handoffDir;
        this.privateKey = "mock-private-key";
    }

    receiveFromWorker(): Array<{ evidence: MockEvidencePack; plan: MockPlanDraft }> {
        const handoffPath = path.join(this.handoffDir, "worker_to_auditor");
        if (!fs.existsSync(handoffPath)) {
            return [];
        }

        const files = fs.readdirSync(handoffPath).filter(f => f.endsWith(".json"));
        return files.map(file => {
            const content = fs.readFileSync(path.join(handoffPath, file), "utf-8");
            const payload = JSON.parse(content);
            // Clean up after reading
            fs.unlinkSync(path.join(handoffPath, file));
            return { evidence: payload.evidence, plan: payload.plan };
        });
    }

    validatePlan(evidence: MockEvidencePack, plan: MockPlanDraft): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Validate evidence link
        if (plan.based_on_evidence !== evidence.evidence_id) {
            errors.push("Plan does not reference correct evidence");
        }

        // Check for forbidden data
        if (evidence.forbidden_data_present) {
            errors.push("Evidence contains forbidden data");
        }

        // Validate actions
        for (const action of plan.actions) {
            // Check path traversal
            if (action.target.includes("..")) {
                errors.push(`Path traversal detected in action ${action.action_id}`);
            }

            // Check dangerous commands
            if (action.type === "shell_exec") {
                warnings.push(`Shell execution in action ${action.action_id}`);
            }
        }

        // Security checks
        const securityChecks = {
            forbidden_patterns: !this.hasForbiddenPatterns(plan),
            path_traversal: !plan.actions.some(a => a.target.includes("..")),
            dangerous_commands: !plan.actions.some(a => a.type === "shell_exec")
        };

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            security_checks: securityChecks
        };
    }

    createExecutionOrder(plan: MockPlanDraft, approver: string): MockExecutionOrder {
        const orderId = `ORDER-${Date.now()}`;
        const timestamp = new Date().toISOString();

        const order: MockExecutionOrder = {
            order_id: orderId,
            timestamp,
            based_on_plan: plan.plan_id,
            approved_by: approver,
            approved_at: timestamp,
            actions: plan.actions,
            signature: "",
            hash: ""
        };

        // Sign the order
        order.signature = this.signOrder(order);
        order.hash = this.computeHash(JSON.stringify(order));

        return order;
    }

    sendToExecutor(order: MockExecutionOrder): void {
        const handoffPath = path.join(this.handoffDir, "auditor_to_executor");
        if (!fs.existsSync(handoffPath)) {
            fs.mkdirSync(handoffPath, { recursive: true });
        }

        fs.writeFileSync(
            path.join(handoffPath, `${order.order_id}.json`),
            JSON.stringify(order, null, 2)
        );
    }

    private hasForbiddenPatterns(plan: MockPlanDraft): boolean {
        const forbidden = ["eval(", "exec(", "fetch(", "child_process"];
        const planStr = JSON.stringify(plan);
        return forbidden.some(pattern => planStr.includes(pattern));
    }

    private signOrder(order: MockExecutionOrder): string {
        // Mock Ed25519 signature
        const data = `${order.order_id}:${order.based_on_plan}:${order.approved_by}`;
        return `SIG-${Buffer.from(data).toString("base64").slice(0, 32)}`;
    }

    private computeHash(data: string): string {
        return `HASH-${Buffer.from(data).toString("base64").slice(0, 16)}`;
    }
}

// ============================================
// Integration Tests
// ============================================

describe("Worker -> Auditor Integration", () => {
    let worker: MockWorkerAgent;
    let auditor: MockAuditorAgent;

    beforeEach(() => {
        // Setup test handoff directory
        if (fs.existsSync(TEST_HANDOFF_DIR)) {
            fs.rmSync(TEST_HANDOFF_DIR, { recursive: true });
        }
        fs.mkdirSync(TEST_HANDOFF_DIR, { recursive: true });

        worker = new MockWorkerAgent(TEST_HANDOFF_DIR);
        auditor = new MockAuditorAgent(TEST_HANDOFF_DIR);
    });

    afterEach(() => {
        // Cleanup
        if (fs.existsSync(TEST_HANDOFF_DIR)) {
            fs.rmSync(TEST_HANDOFF_DIR, { recursive: true });
        }
    });

    describe("Evidence Pack Generation", () => {
        it("should create valid evidence pack from user message", () => {
            const message = "Add a new function to calculate user scores";
            const evidence = worker.createEvidencePack(message, "coding");

            expect(evidence.evidence_id).toMatch(/^EV-\d+(-\d+)?$/);
            expect(evidence.task_type).toBe("coding");
            expect(evidence.sources).toHaveLength(1);
            expect(evidence.sources[0].content).toBe(message);
            expect(evidence.forbidden_data_present).toBe(false);
            expect(evidence.hash).toBeTruthy();
        });

        it("should extract facts from message", () => {
            const message = "Update the login function to use OAuth";
            const evidence = worker.createEvidencePack(message, "coding");

            expect(evidence.extracted_facts).toHaveLength(1);
            expect(evidence.extracted_facts[0].confidence).toBeGreaterThan(0.5);
        });
    });

    describe("Plan Draft Generation", () => {
        it("should create plan draft based on evidence", () => {
            const evidence = worker.createEvidencePack("Add a button", "coding");
            const plan = worker.createPlanDraft(evidence, "Add UI button component");

            expect(plan.plan_id).toMatch(/^PLAN-\d+$/);
            expect(plan.based_on_evidence).toBe(evidence.evidence_id);
            expect(plan.intent).toBe("Add UI button component");
            expect(plan.actions.length).toBeGreaterThan(0);
            expect(plan.risk_level).toBe("low");
        });
    });

    describe("Handoff Communication", () => {
        it("should transfer evidence and plan via file handoff", () => {
            const evidence = worker.createEvidencePack("Test message", "general");
            const plan = worker.createPlanDraft(evidence, "Process test");

            // Worker sends to auditor
            worker.sendToAuditor(evidence, plan);

            // Verify file exists
            const handoffPath = path.join(TEST_HANDOFF_DIR, "worker_to_auditor");
            const files = fs.readdirSync(handoffPath);
            expect(files).toHaveLength(1);

            // Auditor receives
            const received = auditor.receiveFromWorker();
            expect(received).toHaveLength(1);
            expect(received[0].evidence.evidence_id).toBe(evidence.evidence_id);
            expect(received[0].plan.plan_id).toBe(plan.plan_id);

            // File should be cleaned up
            expect(fs.readdirSync(handoffPath)).toHaveLength(0);
        });
    });

    describe("Plan Validation", () => {
        it("should validate correct plan", () => {
            const evidence = worker.createEvidencePack("Add feature", "coding");
            const plan = worker.createPlanDraft(evidence, "Add feature");

            const result = auditor.validatePlan(evidence, plan);

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
            expect(result.security_checks.forbidden_patterns).toBe(true);
            expect(result.security_checks.path_traversal).toBe(true);
        });

        it("should detect evidence mismatch", () => {
            const evidence1 = worker.createEvidencePack("Task 1", "coding");
            const evidence2 = worker.createEvidencePack("Task 2", "coding");
            const plan = worker.createPlanDraft(evidence1, "Do task 1");

            // Validate with wrong evidence
            const result = auditor.validatePlan(evidence2, plan);

            expect(result.valid).toBe(false);
            expect(result.errors).toContain("Plan does not reference correct evidence");
        });

        it("should detect path traversal", () => {
            const evidence = worker.createEvidencePack("Edit file", "coding");
            const plan = worker.createPlanDraft(evidence, "Edit");

            // Inject path traversal
            plan.actions[0].target = "../../../etc/passwd";

            const result = auditor.validatePlan(evidence, plan);

            expect(result.valid).toBe(false);
            expect(result.security_checks.path_traversal).toBe(false);
        });
    });

    describe("Execution Order Creation", () => {
        it("should create signed execution order", () => {
            const evidence = worker.createEvidencePack("Add feature", "coding");
            const plan = worker.createPlanDraft(evidence, "Add feature");

            const order = auditor.createExecutionOrder(plan, "user@test.com");

            expect(order.order_id).toMatch(/^ORDER-\d+$/);
            expect(order.based_on_plan).toBe(plan.plan_id);
            expect(order.approved_by).toBe("user@test.com");
            expect(order.signature).toMatch(/^SIG-/);
            expect(order.hash).toBeTruthy();
        });

        it("should send execution order to executor", () => {
            const evidence = worker.createEvidencePack("Task", "coding");
            const plan = worker.createPlanDraft(evidence, "Execute task");
            const order = auditor.createExecutionOrder(plan, "admin");

            auditor.sendToExecutor(order);

            const handoffPath = path.join(TEST_HANDOFF_DIR, "auditor_to_executor");
            const files = fs.readdirSync(handoffPath);
            expect(files).toHaveLength(1);
            expect(files[0]).toBe(`${order.order_id}.json`);
        });
    });

    describe("Full Worker -> Auditor Flow", () => {
        it("should complete full flow from message to execution order", async () => {
            // 1. Worker processes message
            const message = "Create a new API endpoint for user registration";
            const evidence = worker.createEvidencePack(message, "coding");
            const plan = worker.createPlanDraft(evidence, "Create registration API");

            // 2. Worker sends to auditor
            worker.sendToAuditor(evidence, plan);

            // 3. Auditor receives and validates
            const received = auditor.receiveFromWorker();
            expect(received).toHaveLength(1);

            const validation = auditor.validatePlan(
                received[0].evidence,
                received[0].plan
            );
            expect(validation.valid).toBe(true);

            // 4. Auditor creates execution order
            const order = auditor.createExecutionOrder(
                received[0].plan,
                "system-auto-approve"
            );
            expect(order.signature).toBeTruthy();

            // 5. Auditor sends to executor
            auditor.sendToExecutor(order);

            // Verify order is in executor handoff
            const executorPath = path.join(TEST_HANDOFF_DIR, "auditor_to_executor");
            expect(fs.existsSync(executorPath)).toBe(true);
            expect(fs.readdirSync(executorPath)).toHaveLength(1);
        });
    });
});
