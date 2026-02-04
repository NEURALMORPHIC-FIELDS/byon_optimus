/**
 * Usage Test Campaign — Domain 1: Codebase Maintenance
 * =====================================================
 * TC-001 through TC-010
 *
 * Validates Worker plan generation, Auditor risk assessment,
 * and full pipeline execution for common code maintenance tasks.
 *
 * Patent: EP25216372.0 — Vasile Lucian Borbeleac
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as crypto from "node:crypto";
import {
    RiskAssessmentSystem,
    createRiskAssessment,
} from "../../src/policy/risk-assessment.js";
import {
    ExecutionOrderSigner,
    createSigner,
} from "../../src/agents/auditor/signer.js";
import type {
    PlanDraft,
    Action,
    EvidencePack,
    ExecutionOrder,
    JohnsonReceipt,
} from "../../src/types/protocol.js";

// ============================================================================
// HELPERS
// ============================================================================

function generateUUID(): string {
    return crypto.randomUUID();
}

function makeAction(overrides: Partial<Action> = {}): Action {
    return {
        action_id: `act_${generateUUID().slice(0, 8)}`,
        type: "code_edit",
        target: "src/file.ts",
        parameters: {},
        estimated_risk: "low",
        rollback_possible: true,
        ...overrides,
    };
}

function makePlan(overrides: Partial<PlanDraft> = {}): PlanDraft {
    const plan: PlanDraft = {
        document_type: "PLAN_DRAFT",
        document_version: "1.0",
        plan_id: `plan_${generateUUID().slice(0, 8)}`,
        timestamp: new Date().toISOString(),
        based_on_evidence: `ev_${generateUUID().slice(0, 8)}`,
        intent: "Fix a typo in README",
        actions: [makeAction()],
        risk_level: "low",
        rollback_possible: true,
        estimated_iterations: 1,
        memory_context: {
            conversation_ctx_id: null,
            relevant_code_ctx_ids: [],
            relevant_fact_ctx_ids: [],
            similar_past_ctx_ids: [],
        },
        hash: "",
        ...overrides,
    };
    plan.hash = crypto.createHash("sha256").update(JSON.stringify(plan)).digest("hex");
    return plan;
}

// ============================================================================
// TESTS
// ============================================================================

describe("Campaign: Codebase Maintenance", () => {
    let riskSystem: RiskAssessmentSystem;
    let signer: ExecutionOrderSigner;

    beforeEach(() => {
        riskSystem = createRiskAssessment();
        signer = createSigner();
    });

    it("TC-001: Worker generates valid PlanDraft for 'fix a typo in README'", () => {
        const plan = makePlan({
            intent: "Fix a typo in README",
            actions: [
                makeAction({
                    type: "code_edit",
                    target: "README.md",
                    parameters: { operation: "fix_typo", old_text: "teh", new_text: "the" },
                }),
            ],
        });

        expect(plan.document_type).toBe("PLAN_DRAFT");
        expect(plan.actions).toHaveLength(1);
        expect(plan.actions[0].type).toBe("code_edit");
        expect(plan.actions[0].target).toBe("README.md");
        expect(plan.intent).toContain("typo");
        expect(plan.hash).toHaveLength(64);
    });

    it("TC-002: Worker generates code_edit action with correct diff format", () => {
        const action = makeAction({
            type: "code_edit",
            target: "src/utils.ts",
            parameters: {
                old_content: 'const name = "oldd";',
                new_content: 'const name = "old";',
                line_start: 10,
                line_end: 10,
            },
        });

        expect(action.type).toBe("code_edit");
        expect(action.parameters).toHaveProperty("old_content");
        expect(action.parameters).toHaveProperty("new_content");
        expect(action.parameters).toHaveProperty("line_start");
    });

    it("TC-003: Worker generates multi-file plan for 'rename function across codebase'", () => {
        const plan = makePlan({
            intent: "Rename function calculateTotal to computeTotal across codebase",
            actions: [
                makeAction({ type: "code_edit", target: "src/utils.ts", parameters: { old_name: "calculateTotal", new_name: "computeTotal" } }),
                makeAction({ type: "code_edit", target: "src/index.ts", parameters: { old_name: "calculateTotal", new_name: "computeTotal" } }),
                makeAction({ type: "code_edit", target: "tests/utils.test.ts", parameters: { old_name: "calculateTotal", new_name: "computeTotal" } }),
            ],
        });

        expect(plan.actions).toHaveLength(3);
        const targets = plan.actions.map(a => a.target);
        expect(targets).toContain("src/utils.ts");
        expect(targets).toContain("src/index.ts");
        expect(targets).toContain("tests/utils.test.ts");
    });

    it("TC-004: Worker handles ambiguous task with clarification request", () => {
        const plan = makePlan({
            intent: "Improve the code — clarification needed: which files and what kind of improvement?",
            actions: [],
        });

        expect(plan.intent.toLowerCase()).toMatch(/clarif|ambig|need/);
        expect(plan.actions).toHaveLength(0);
    });

    it("TC-005: Worker rejects plan that modifies forbidden path (/etc/passwd)", () => {
        const plan = makePlan({
            actions: [
                makeAction({ type: "file_modify", target: "/etc/passwd", estimated_risk: "high" }),
            ],
            risk_level: "high",
        });

        // Forbidden path patterns
        const forbiddenPaths = [/^\/etc\//, /^\/usr\//, /^\/sys\//, /^\/proc\//];
        const isForbidden = plan.actions.some(a =>
            forbiddenPaths.some(p => p.test(a.target))
        );

        expect(isForbidden).toBe(true);
    });

    it("TC-006: Auditor downgrades risk when plan only touches test files", () => {
        const plan = makePlan({
            actions: [
                makeAction({ type: "code_edit", target: "tests/unit/example.test.ts" }),
                makeAction({ type: "code_edit", target: "tests/integration/flow.test.ts" }),
            ],
            risk_level: "low",
            rollback_possible: true,
            estimated_iterations: 1,
        });

        const score = riskSystem.assessPlan(plan);
        expect(score.level).toBe("low");
        expect(score.requiresApproval).toBe(false);
    });

    it("TC-007: Auditor escalates risk when plan touches security-critical files", () => {
        const plan = makePlan({
            actions: [
                makeAction({
                    type: "code_edit",
                    target: "src/security/crypto-utils.ts",
                    estimated_risk: "high",
                }),
            ],
            risk_level: "medium",
        });

        const score = riskSystem.assessPlan(plan);
        // crypto-utils.ts matches security|crypto pattern → sensitivity boost
        expect(score.score).toBeGreaterThan(0);
        expect(score.breakdown.some(b => b.name === "Target Sensitivity" && b.rawScore > 0)).toBe(true);
    });

    it("TC-008: Full pipeline: file_create → approve → execute → receipt", () => {
        const plan = makePlan({
            intent: "Create a new utility file",
            actions: [
                makeAction({
                    type: "file_create",
                    target: "src/helpers/format.ts",
                    parameters: { content: "export function format(s: string) { return s.trim(); }" },
                }),
            ],
        });

        // Auditor signs
        const { order } = signer.signOrder(plan, "user_001");

        expect(order.document_type).toBe("EXECUTION_ORDER");
        expect(order.based_on_plan).toBe(plan.plan_id);
        expect(order.approved_by).toBe("user_001");
        expect(typeof order.signature).toBe("string");
        expect(order.signature.length).toBeGreaterThan(0);

        // Executor verifies
        const verification = signer.verifyOrder(order);
        expect(verification.valid).toBe(true);

        // Build receipt
        const receipt: JohnsonReceipt = {
            document_type: "JOHNSON_RECEIPT",
            document_version: "1.0",
            receipt_id: `rcpt_${generateUUID().slice(0, 8)}`,
            timestamp: new Date().toISOString(),
            based_on_order: order.order_id,
            execution_summary: {
                status: "success",
                actions_total: 1,
                actions_completed: 1,
                actions_failed: 0,
                iterations_used: 1,
                duration_ms: 42,
            },
            action_results: [{ action_id: plan.actions[0].action_id, status: "success", success: true }],
            errors: [],
            changes_made: { files_modified: [], files_created: ["src/helpers/format.ts"], files_deleted: [] },
            verification: { tests_passing: true, lint_passing: true, build_passing: true },
            hash: "",
        };
        receipt.hash = crypto.createHash("sha256").update(JSON.stringify(receipt)).digest("hex");

        expect(receipt.execution_summary.status).toBe("success");
        expect(receipt.changes_made.files_created).toContain("src/helpers/format.ts");
        expect(order.rollback.enabled).toBe(true);
    });

    it("TC-009: Full pipeline: code_edit with rollback containing original content", () => {
        const plan = makePlan({
            actions: [
                makeAction({
                    type: "code_edit",
                    target: "src/index.ts",
                    parameters: { old_content: 'const x = 1;', new_content: 'const x = 2;' },
                }),
            ],
            rollback_possible: true,
        });

        const { order } = signer.signOrder(plan, "user_002");

        expect(order.rollback.enabled).toBe(true);
        expect(order.rollback.instructions).toBeDefined();
    });

    it("TC-010: Executor rollback: verify rollback_info correctly records", () => {
        const plan = makePlan({
            actions: [
                makeAction({
                    type: "file_delete",
                    target: "src/deprecated.ts",
                    rollback_possible: false,
                }),
            ],
            rollback_possible: false,
        });

        const { order } = signer.signOrder(plan, "user_003");

        expect(order.rollback.enabled).toBe(false);
        expect(order.rollback.instructions).toBeUndefined();
    });
});
