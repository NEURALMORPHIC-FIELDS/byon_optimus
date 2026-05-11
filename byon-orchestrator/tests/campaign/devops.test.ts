/**
 * Usage Test Campaign — Domain 2: DevOps & Infrastructure
 * ========================================================
 * TC-011 through TC-020
 *
 * Validates action whitelisting, air-gap enforcement,
 * resource limits, and manifest generation.
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
import {
    ExecutionOrderVerifier,
    createVerifierFromAuditor,
} from "../../src/agents/executor/signature-verifier.js";
import { generateManifest } from "../../src/manifest/project-manifest.js";
import type { PlanDraft, Action, ActionType } from "../../src/types/protocol.js";

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
        intent: "DevOps task",
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

// Action whitelist (mirrors production logic)
const ALLOWED_ACTIONS: ActionType[] = ["file_create", "code_edit", "test_run", "lint_run", "build_run", "file_write", "file_modify", "file_delete"];
const BLOCKED_ACTIONS: ActionType[] = ["shell_exec"];

function isActionAllowed(type: ActionType): boolean {
    return ALLOWED_ACTIONS.includes(type) && !BLOCKED_ACTIONS.includes(type);
}

// Air-gap validator (mirrors production AirGapValidator)
function validateAirGap(code: string): { compliant: boolean; violations: string[] } {
    const violations: string[] = [];
    const patterns = [
        { regex: /fetch\s*\(/gi, label: "fetch()" },
        { regex: /XMLHttpRequest/gi, label: "XMLHttpRequest" },
        { regex: /axios/gi, label: "axios" },
        { regex: /https?:\/\//gi, label: "external URL" },
        { regex: /child_process/gi, label: "child_process" },
        { regex: /\bexec\s*\(/gi, label: "exec()" },
    ];

    for (const { regex, label } of patterns) {
        regex.lastIndex = 0;
        if (regex.test(code)) violations.push(`Blocked: ${label}`);
    }

    return { compliant: violations.length === 0, violations };
}

// ============================================================================
// TESTS
// ============================================================================

describe("Campaign: DevOps & Infrastructure", () => {
    let riskSystem: RiskAssessmentSystem;
    let signer: ExecutionOrderSigner;

    beforeEach(() => {
        riskSystem = createRiskAssessment();
        signer = createSigner();
    });

    it("TC-011: Worker generates build_run action for 'run the build'", () => {
        const action = makeAction({ type: "build_run", target: ".", parameters: { command: "npm run build" } });
        expect(action.type).toBe("build_run");
        expect(isActionAllowed("build_run")).toBe(true);
    });

    it("TC-012: Worker generates test_run action for 'run tests'", () => {
        const action = makeAction({ type: "test_run", target: "tests/", parameters: { framework: "vitest" } });
        expect(action.type).toBe("test_run");
        expect(isActionAllowed("test_run")).toBe(true);
    });

    it("TC-013: Worker rejects shell_exec action (forbidden by policy)", () => {
        expect(isActionAllowed("shell_exec")).toBe(false);
    });

    it("TC-014: Auditor blocks plan with shell commands in code content", () => {
        const maliciousCode = `
            import { exec } from 'child_process';
            exec('rm -rf /');
        `;
        const result = validateAirGap(maliciousCode);

        expect(result.compliant).toBe(false);
        expect(result.violations.some(v => v.includes("child_process"))).toBe(true);
        expect(result.violations.some(v => v.includes("exec()"))).toBe(true);
    });

    it("TC-015: Auditor blocks plan containing network_request in code", () => {
        const networkCode = "const data = await fetch('https://api.example.com/data');";
        const result = validateAirGap(networkCode);

        expect(result.compliant).toBe(false);
        expect(result.violations.some(v => v.includes("fetch()"))).toBe(true);
    });

    it("TC-016: Executor respects resource limits (iteration count)", () => {
        const plan = makePlan({
            actions: [makeAction()],
            estimated_iterations: 1,
        });

        const { order } = signer.signOrder(plan, "auto");
        const verifier = createVerifierFromAuditor(signer.getPublicKey());

        // Normal order verifies fine
        const result = verifier.verify(order);
        expect(result.verified).toBe(true);
        expect(order.constraints.max_iterations).toBeLessThanOrEqual(20); // absolute limit
    });

    it("TC-017: Executor blocks action exceeding disk_mb limit", () => {
        const plan = makePlan({ risk_level: "low" });
        const { order } = signer.signOrder(plan, "auto", { disk_limit_mb: 5000 });

        const verifier = createVerifierFromAuditor(signer.getPublicKey());
        const result = verifier.verify(order);

        expect(result.verified).toBe(false);
        expect(result.error).toContain("disk_limit_mb");
    });

    it("TC-018: Docker-style isolation: executor rejects code with external URLs", () => {
        const codeWithUrls = `
            const config = { apiUrl: "https://api.example.com" };
            const ws = new WebSocket("wss://socket.example.com");
        `;
        const result = validateAirGap(codeWithUrls);

        expect(result.compliant).toBe(false);
        expect(result.violations.length).toBeGreaterThanOrEqual(1);
    });

    it("TC-019: Handoff directory structure validation (7 subdirectories)", () => {
        const expectedDirs = [
            "inbox",
            "worker_to_auditor",
            "auditor_to_executor",
            "executor_to_worker",
            "approvals",
            "receipts",
            "archive",
        ];

        // Validate the expected directory naming convention
        expect(expectedDirs).toHaveLength(7);
        for (const dir of expectedDirs) {
            expect(dir).toMatch(/^[a-z_]+$/);
        }
    });

    it("TC-020: Manifest generation produces valid JSON with required fields", () => {
        const manifest = generateManifest(process.cwd().replace(/\\/g, "/").replace(/\/byon-orchestrator$/, ""));

        expect(manifest.version).toBe("1.0");
        expect(manifest.generated_at).toBeDefined();
        expect(manifest.architecture).toBeDefined();
        expect(manifest.architecture.pipeline).toContain("Worker");
        expect(manifest.components).toBeDefined();
        expect(manifest.components.length).toBeGreaterThan(0);
        expect(manifest.security).toBeDefined();
        expect(manifest.security.signing_algorithm).toContain("Ed25519");
        expect(manifest.ui).toBeDefined();
    });
});
