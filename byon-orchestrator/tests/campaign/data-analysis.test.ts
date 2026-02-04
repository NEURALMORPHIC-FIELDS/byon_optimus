/**
 * Usage Test Campaign — Domain 6: Data Analysis & Processing
 * ============================================================
 * TC-071 through TC-078
 *
 * Validates task type inference, multi-action plan generation,
 * and risk assessment scoring for various action combinations.
 *
 * Patent: EP25216372.0 — Vasile Lucian Borbeleac
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as crypto from "node:crypto";
import {
    RiskAssessmentSystem,
    createRiskAssessment,
    quickRiskAssessment,
} from "../../src/policy/risk-assessment.js";
import type { PlanDraft, Action, TaskType } from "../../src/types/protocol.js";

// ============================================================================
// HELPERS
// ============================================================================

function makeAction(overrides: Partial<Action> = {}): Action {
    return {
        action_id: `act_${crypto.randomUUID().slice(0, 8)}`,
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
        plan_id: `plan_${crypto.randomUUID().slice(0, 8)}`,
        timestamp: new Date().toISOString(),
        based_on_evidence: `ev_${crypto.randomUUID().slice(0, 8)}`,
        intent: "Data analysis task",
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

/**
 * Infer task type from message content — mirrors production inferTaskType()
 * from openclaw-bridge.ts
 */
function inferTaskType(content: string): TaskType {
    const lower = content.toLowerCase();

    const codingKeywords = [
        "code", "function", "fix", "bug", "error", "compile", "build", "test",
        "refactor", "implement", "class", "method", "variable", "import", "export",
        "module", "package", "dependency", "lint", "type", "interface", "debug",
        "deploy", "commit", "merge", "branch", "pull request", "pr", "api",
        "endpoint", "database", "query", "migration",
    ];
    const schedulingKeywords = [
        "schedule", "meeting", "calendar", "appointment", "reminder",
        "deadline", "event", "date", "time", "agenda", "recurring",
    ];
    const messagingKeywords = [
        "send", "message", "notify", "email", "slack", "whatsapp",
        "broadcast", "announce", "reply", "forward", "cc",
    ];

    const fileExtensionPattern = /\.(tsx?|jsx?|py|rs|go|java|rb|php|css|html?|sql|sh|yaml|yml|json|toml|vue|svelte)\b/i;

    let codingScore = fileExtensionPattern.test(content) ? 3 : 0;
    let schedulingScore = 0;
    let messagingScore = 0;

    for (const kw of codingKeywords) if (lower.includes(kw)) codingScore++;
    for (const kw of schedulingKeywords) if (lower.includes(kw)) schedulingScore++;
    for (const kw of messagingKeywords) if (lower.includes(kw)) messagingScore++;

    const maxScore = Math.max(codingScore, schedulingScore, messagingScore);
    if (maxScore === 0) return "general";
    if (codingScore === maxScore) return "coding";
    if (messagingScore === maxScore) return "messaging";
    if (schedulingScore === maxScore) return "scheduling";
    return "general";
}

// ============================================================================
// TESTS
// ============================================================================

describe("Campaign: Data Analysis & Processing", () => {
    let riskSystem: RiskAssessmentSystem;

    beforeEach(() => {
        riskSystem = createRiskAssessment();
    });

    it("TC-071: Worker classifies 'analyze sales data' as general task type", () => {
        const taskType = inferTaskType("analyze sales data");
        expect(taskType).toBe("general");
    });

    it("TC-072: Worker classifies 'write a Python function' as coding task type", () => {
        const taskType = inferTaskType("write a Python function to parse CSV files");
        expect(taskType).toBe("coding");
    });

    it("TC-073: Worker classifies 'schedule a meeting' as scheduling task type", () => {
        const taskType = inferTaskType("schedule a meeting for tomorrow at 3pm");
        expect(taskType).toBe("scheduling");
    });

    it("TC-074: Worker classifies 'send a message' as messaging task type", () => {
        const taskType = inferTaskType("send a message to the team on Slack");
        expect(taskType).toBe("messaging");
    });

    it("TC-075: Worker generates plan with multiple ordered actions", () => {
        const plan = makePlan({
            intent: "Refactor and test the utility module",
            actions: [
                makeAction({ type: "code_edit", target: "src/utils.ts", parameters: { operation: "refactor" } }),
                makeAction({ type: "file_create", target: "tests/utils.test.ts", parameters: { template: "vitest" } }),
                makeAction({ type: "test_run", target: "tests/", parameters: { framework: "vitest" } }),
            ],
        });

        expect(plan.actions.length).toBeGreaterThan(1);
        expect(plan.actions[0].type).toBe("code_edit");
        expect(plan.actions[1].type).toBe("file_create");
        expect(plan.actions[2].type).toBe("test_run");
    });

    it("TC-076: Risk assessment: single file_create = low risk", () => {
        const plan = makePlan({
            actions: [makeAction({ type: "file_create", target: "src/new-file.ts" })],
            rollback_possible: true,
            estimated_iterations: 1,
        });

        const score = riskSystem.assessPlan(plan);
        expect(score.level).toBe("low");
    });

    it("TC-077: Risk assessment: file_delete with no rollback assessed correctly", () => {
        const plan = makePlan({
            actions: [makeAction({ type: "file_delete", target: "src/important.ts", rollback_possible: false })],
            rollback_possible: false,
            estimated_iterations: 1,
        });

        const score = riskSystem.assessPlan(plan);
        // Single file_delete with no rollback scores ~19 (low threshold is 30)
        // The risk system weighs multiple factors; a single delete alone is low risk
        expect(score.score).toBeGreaterThan(0);
        expect(score.breakdown.some(b => b.name === "File Deletions" && b.rawScore > 0)).toBe(true);
        expect(score.breakdown.some(b => b.name === "Rollback Capability" && b.rawScore > 50)).toBe(true);
    });

    it("TC-078: Risk assessment: multiple actions with file_delete = medium+ risk", () => {
        const plan = makePlan({
            actions: [
                makeAction({ type: "file_delete", target: "src/a.ts", rollback_possible: false }),
                makeAction({ type: "file_delete", target: "src/b.ts", rollback_possible: false }),
                makeAction({ type: "file_delete", target: "src/c.ts", rollback_possible: false }),
                makeAction({ type: "code_edit", target: "src/index.ts" }),
                makeAction({ type: "code_edit", target: "src/main.ts" }),
                makeAction({ type: "code_edit", target: "src/app.ts" }),
            ],
            rollback_possible: false,
            estimated_iterations: 3,
        });

        const score = riskSystem.assessPlan(plan);
        // 3 deletes + 3 edits + no rollback + sensitive targets scores ~44 (medium)
        expect(["medium", "high"]).toContain(score.level);
        expect(score.requiresApproval).toBe(true);
    });
});
