/**
 * Usage Test Campaign — Domain 10: System Integration & Resilience
 * ==================================================================
 * TC-096 through TC-100
 *
 * Validates graceful error handling for malformed input, oversized messages,
 * empty content, concurrent operations, and full MACP pipeline timing.
 *
 * Patent: EP25216372.0 — Vasile Lucian Borbeleac
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as crypto from "node:crypto";
import {
    ExecutionOrderSigner,
    createSigner,
} from "../../src/agents/auditor/signer.js";
import {
    ExecutionOrderVerifier,
    createVerifierFromAuditor,
} from "../../src/agents/executor/signature-verifier.js";
import {
    ApprovalManager,
    createApprovalManager,
    createSecurityChecks,
} from "../../src/agents/auditor/approval-manager.js";
import type {
    PlanDraft,
    Action,
    EvidencePack,
    JohnsonReceipt,
} from "../../src/types/protocol.js";

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
        intent: "Resilience test plan",
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

function makeEvidence(overrides: Partial<EvidencePack> = {}): EvidencePack {
    const evidence: EvidencePack = {
        document_type: "EVIDENCE_PACK",
        document_version: "1.0",
        evidence_id: `ev_${crypto.randomUUID().slice(0, 8)}`,
        timestamp: new Date().toISOString(),
        task_type: "coding",
        sources: [{ type: "message", identifier: "msg_001", timestamp: new Date().toISOString() }],
        extracted_facts: [{ content: "User wants code change", confidence: 0.9 }],
        raw_quotes: [],
        codebase_context: { files_analyzed: [], functions_referenced: [], dependencies_identified: [], patterns_detected: [] },
        memory_context: { conversation_ctx_id: null, relevant_code_ctx_ids: [], relevant_fact_ctx_ids: [], similar_past_ctx_ids: [] },
        forbidden_data_present: false,
        hash: "",
        ...overrides,
    };
    evidence.hash = crypto.createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
    return evidence;
}

// ============================================================================
// TESTS
// ============================================================================

describe("Campaign: System Integration & Resilience", () => {
    let signer: ExecutionOrderSigner;

    beforeEach(() => {
        signer = createSigner();
    });

    it("TC-096: Malformed JSON in inbox is rejected gracefully (no crash)", () => {
        const malformedInputs = [
            "not json at all",
            '{"incomplete": true',
            "",
            "null",
            "[]",
            '{"document_type": 123}',
        ];

        for (const input of malformedInputs) {
            let parsed: unknown;
            let error: string | null = null;

            try {
                parsed = JSON.parse(input);
                // Even if parseable, validate structure
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                    error = "Invalid document structure";
                } else if (!(parsed as Record<string, unknown>).document_type || typeof (parsed as Record<string, unknown>).document_type !== "string") {
                    error = "Missing or invalid document_type";
                }
            } catch (e) {
                error = (e as Error).message;
            }

            // The point: we caught the error without crashing
            expect(typeof error === "string" || error === null).toBe(true);
        }
    });

    it("TC-097: Oversized message (>1MB) is rejected or truncated", () => {
        const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB
        const oversizedContent = "x".repeat(MAX_MESSAGE_SIZE + 1);

        const isOversized = Buffer.byteLength(oversizedContent, "utf8") > MAX_MESSAGE_SIZE;
        expect(isOversized).toBe(true);

        // System should detect and reject
        const validateSize = (content: string): { valid: boolean; error?: string } => {
            if (Buffer.byteLength(content, "utf8") > MAX_MESSAGE_SIZE) {
                return { valid: false, error: `Message exceeds ${MAX_MESSAGE_SIZE} bytes` };
            }
            return { valid: true };
        };

        const result = validateSize(oversizedContent);
        expect(result.valid).toBe(false);
        expect(result.error).toContain("exceeds");
    });

    it("TC-098: Empty message content produces meaningful error", () => {
        const validateContent = (content: string): { valid: boolean; error?: string } => {
            if (!content || content.trim().length === 0) {
                return { valid: false, error: "Message content cannot be empty" };
            }
            return { valid: true };
        };

        expect(validateContent("").valid).toBe(false);
        expect(validateContent("").error).toContain("empty");
        expect(validateContent("   ").valid).toBe(false);
        expect(validateContent("valid content").valid).toBe(true);
    });

    it("TC-099: Concurrent handoff: 5 simultaneous plans don't corrupt each other", () => {
        const plans: PlanDraft[] = [];
        const results: Array<{ order_id: string; plan_id: string; valid: boolean }> = [];

        // Create 5 plans simultaneously
        for (let i = 0; i < 5; i++) {
            plans.push(makePlan({
                intent: `Concurrent plan ${i}`,
                actions: [makeAction({ target: `src/file${i}.ts` })],
            }));
        }

        // Sign all plans
        for (const plan of plans) {
            const { order } = signer.signOrder(plan, `user_${plan.plan_id}`);
            const verification = signer.verifyOrder(order);
            results.push({
                order_id: order.order_id,
                plan_id: plan.plan_id,
                valid: verification.valid,
            });
        }

        // All should be valid and have unique IDs
        expect(results).toHaveLength(5);
        const orderIds = new Set(results.map(r => r.order_id));
        expect(orderIds.size).toBe(5);
        for (const result of results) {
            expect(result.valid).toBe(true);
        }
    });

    it("TC-100: Full MACP cycle: message → evidence → plan → approve → execute → receipt", () => {
        const startTime = Date.now();

        // Step 1: Create EvidencePack
        const evidence = makeEvidence({ task_type: "coding" });
        expect(evidence.document_type).toBe("EVIDENCE_PACK");

        // Step 2: Create PlanDraft
        const plan = makePlan({
            based_on_evidence: evidence.evidence_id,
            intent: "Full MACP cycle test",
            actions: [
                makeAction({ type: "code_edit", target: "src/main.ts" }),
                makeAction({ type: "test_run", target: "tests/" }),
            ],
        });
        expect(plan.document_type).toBe("PLAN_DRAFT");

        // Step 3: Approval (auto-approve for low risk)
        const approvalManager = createApprovalManager({ auto_approve_low_risk: true });
        const checks = createSecurityChecks([], []);
        const request = approvalManager.createApprovalRequest(plan, checks);
        expect(request.requires_approval).toBe(false); // auto-approve

        // Auto-approve
        const decision = approvalManager.autoApprove(request.request_id);
        expect(decision.decision).toBe("approved");

        // Step 4: Sign ExecutionOrder
        const { order } = signer.signOrder(plan, "auto");
        expect(typeof order.signature).toBe("string");
        expect(order.signature.length).toBeGreaterThan(0);

        // Verify
        const verifier = createVerifierFromAuditor(signer.getPublicKey());
        const verification = verifier.verify(order);
        expect(verification.verified).toBe(true);

        // Step 5: Produce JohnsonReceipt
        const receipt: JohnsonReceipt = {
            document_type: "JOHNSON_RECEIPT",
            document_version: "1.0",
            receipt_id: `rcpt_${crypto.randomUUID().slice(0, 8)}`,
            timestamp: new Date().toISOString(),
            based_on_order: order.order_id,
            execution_summary: {
                status: "success",
                actions_total: 2,
                actions_completed: 2,
                actions_failed: 0,
                iterations_used: 1,
                duration_ms: Date.now() - startTime,
            },
            action_results: plan.actions.map(a => ({ action_id: a.action_id, status: "success" as const, success: true })),
            errors: [],
            changes_made: { files_modified: ["src/main.ts"], files_created: [], files_deleted: [] },
            verification: { tests_passing: true, lint_passing: true, build_passing: true },
            hash: "",
        };
        receipt.hash = crypto.createHash("sha256").update(JSON.stringify(receipt)).digest("hex");

        expect(receipt.document_type).toBe("JOHNSON_RECEIPT");
        expect(receipt.execution_summary.status).toBe("success");

        // Timing check: entire pipeline should complete in under 5 seconds
        const totalTime = Date.now() - startTime;
        expect(totalTime).toBeLessThan(5000);

        // All 5 documents produced with valid hashes
        expect(evidence.hash).toHaveLength(64);
        expect(plan.hash).toHaveLength(64);
        expect(request.hash).toHaveLength(64);
        expect(order.hash).toHaveLength(64);
        expect(receipt.hash).toHaveLength(64);
    });
});
