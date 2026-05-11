/**
 * Usage Test Campaign — Domain 5: Approval & Human-in-the-Loop
 * ==============================================================
 * TC-061 through TC-070
 *
 * Validates approval workflow: nonce generation, TTL enforcement,
 * auto-approve logic, decision tracking, and replay protection.
 *
 * Patent: EP25216372.0 — Vasile Lucian Borbeleac
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as crypto from "node:crypto";
import {
    ApprovalManager,
    createApprovalManager,
    createSecurityChecks,
} from "../../src/agents/auditor/approval-manager.js";
import type { PlanDraft, Action, SecurityCheck } from "../../src/types/protocol.js";

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
        intent: "Approval test plan",
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

describe("Campaign: Approval & Human-in-the-Loop", () => {
    let manager: ApprovalManager;
    let checks: SecurityCheck[];

    beforeEach(() => {
        manager = createApprovalManager({ auto_approve_low_risk: true });
        checks = createSecurityChecks([], []);
    });

    it("TC-061: ApprovalRequest contains unique request_id", () => {
        const plan = makePlan();
        const request = manager.createApprovalRequest(plan, checks);

        expect(request.request_id).toBeDefined();
        expect(request.request_id).toMatch(/^req_/);
    });

    it("TC-062: ApprovalRequest has valid expires_at timestamp", () => {
        const lowPlan = makePlan({ risk_level: "low", actions: [makeAction({ estimated_risk: "low" })] });
        const medPlan = makePlan({ risk_level: "medium", actions: [makeAction({ estimated_risk: "medium" })] });
        const highPlan = makePlan({ risk_level: "high", actions: [makeAction({ estimated_risk: "high" })] });

        const lowReq = manager.createApprovalRequest(lowPlan, checks);
        const medReq = manager.createApprovalRequest(medPlan, checks);
        const highReq = manager.createApprovalRequest(highPlan, checks);

        // All requests should have expires_at in the future
        const now = Date.now();
        expect(new Date(lowReq.expires_at).getTime()).toBeGreaterThan(now);
        expect(new Date(medReq.expires_at).getTime()).toBeGreaterThan(now);
        expect(new Date(highReq.expires_at).getTime()).toBeGreaterThan(now);
    });

    it("TC-063: Low-risk plan gets auto-approved (no human needed)", () => {
        const plan = makePlan({ risk_level: "low", actions: [makeAction({ estimated_risk: "low" })] });
        const request = manager.createApprovalRequest(plan, checks);

        expect(request.requires_approval).toBe(false);
        expect(manager.shouldAutoApprove(request.request_id)).toBe(true);
    });

    it("TC-064: High-risk plan requires explicit human approval", () => {
        const plan = makePlan({ risk_level: "high", actions: [makeAction({ estimated_risk: "high" })] });
        const failedChecks = createSecurityChecks(["Risk too high"], []);
        const request = manager.createApprovalRequest(plan, failedChecks);

        expect(request.requires_approval).toBe(true);
        expect(manager.shouldAutoApprove(request.request_id)).toBe(false);
    });

    it("TC-065: Approval timeout: request expires after TTL", () => {
        const mgr = createApprovalManager({ auto_approve_low_risk: false });
        const plan = makePlan({ risk_level: "high", actions: [makeAction({ estimated_risk: "high" })] });
        const request = mgr.createApprovalRequest(plan, checks);

        // Artificially expire by setting expires_at in the past
        const pending = mgr.getPending(request.request_id)!;
        pending.expires_at = new Date(Date.now() - 1000).toISOString();

        expect(() => mgr.processDecision(request.request_id, "approved", "user")).toThrow(/expire/i);
    });

    it("TC-066: Approval with 'deny' blocks ExecutionOrder creation", () => {
        const mgr = createApprovalManager({ auto_approve_low_risk: false });
        const plan = makePlan({ risk_level: "medium", actions: [makeAction({ estimated_risk: "medium" })] });
        const request = mgr.createApprovalRequest(plan, checks);

        const decision = mgr.processDecision(request.request_id, "rejected", "admin", undefined, "Too risky");
        expect(decision.decision).toBe("rejected");
        expect(decision.decided_by).toBe("admin");

        const pending = mgr.getPending(request.request_id)!;
        expect(pending.status).toBe("rejected");
    });

    it("TC-067: Approval with 'approve' produces signed ExecutionOrder decision", () => {
        const mgr = createApprovalManager({ auto_approve_low_risk: false });
        const plan = makePlan({ risk_level: "medium", actions: [makeAction({ estimated_risk: "medium" })] });
        const request = mgr.createApprovalRequest(plan, checks);

        const decision = mgr.processDecision(request.request_id, "approved", "user_123", undefined, "Looks good");
        expect(decision.decision).toBe("approved");
        expect(decision.decided_by).toBe("user_123");
        expect(decision.reason).toBe("Looks good");

        const pending = mgr.getPending(request.request_id)!;
        expect(pending.status).toBe("approved");
    });

    it("TC-068: Approval tracks decided_by and reason fields", () => {
        const mgr = createApprovalManager({ auto_approve_low_risk: false });
        const plan = makePlan({ risk_level: "low", actions: [makeAction()] });
        const request = mgr.createApprovalRequest(plan, checks);

        const decision = mgr.processDecision(request.request_id, "approved", "security_team", undefined, "Reviewed and approved by security team");

        expect(decision.decided_by).toBe("security_team");
        expect(decision.decided_at).toBeDefined();
        expect(new Date(decision.decided_at).getTime()).toBeLessThanOrEqual(Date.now());
        expect(decision.reason).toContain("security team");
    });

    it("TC-069: Multiple concurrent approvals: each gets unique request_id", () => {
        const ids = new Set<string>();

        for (let i = 0; i < 10; i++) {
            const plan = makePlan({ intent: `Concurrent plan ${i}`, actions: [makeAction()] });
            const request = manager.createApprovalRequest(plan, checks);
            ids.add(request.request_id);
        }

        expect(ids.size).toBe(10);

        // All request_ids in pending are unique too
        const allPending = manager.getAllPending();
        const requestIds = new Set(allPending.map(p => p.request.request_id));
        expect(requestIds.size).toBe(allPending.length);
    });

    it("TC-070: Approval nonce cannot be reused (replay protection)", () => {
        const mgr = createApprovalManager({ auto_approve_low_risk: false });
        const plan = makePlan({ risk_level: "medium", actions: [makeAction({ estimated_risk: "medium" })] });
        const request = mgr.createApprovalRequest(plan, checks);

        // First approval works
        mgr.processDecision(request.request_id, "approved", "user");

        // Second attempt on same request should fail (already processed)
        expect(() => mgr.processDecision(request.request_id, "approved", "attacker")).toThrow();
    });
});
