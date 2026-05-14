/**
 * FSOAT modules — unit tests
 *
 * Covers the twelve FSOAT modules at the unit level. Adapter modules
 * (WorkerRunnerAdapter, AuditorRunnerAdapter, ExecutorRunnerAdapter) are not
 * exercised here against live agents; they are exercised end-to-end by the
 * runner itself (byon-orchestrator/scripts/byon-full-source-organism-activation-test.mjs).
 *
 * Patent: EP25216372.0
 * Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// ESM equivalent of CommonJS `__dirname` (package.json: "type": "module").
const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
    createActivationTracker,
    ORGAN_LIST,
    ORGAN_PROOFS
} from "../../scripts/lib/fsoat/activation-tracker.mjs";
import { createHandoffWorkspaceManager } from "../../scripts/lib/fsoat/handoff-workspace-manager.mjs";
import { createMACPChainObserver, MACP_KINDS } from "../../scripts/lib/fsoat/macp-chain-observer.mjs";
import {
    createFinalVerdictBuilder,
    FSOAT_FORBIDDEN_TOKENS,
    FSOAT_OPERATOR_INVARIANTS
} from "../../scripts/lib/fsoat/final-verdict-builder.mjs";
import { createTrustTierObserver, TRUST_TIER_ORDER } from "../../scripts/lib/fsoat/trust-tier-observer.mjs";
import { createCapabilityExperienceObserver } from "../../scripts/lib/fsoat/capability-experience-observer.mjs";
import { createStructuralReferenceObserver } from "../../scripts/lib/fsoat/structural-reference-observer.mjs";
import { createCodeWorkspaceObserver } from "../../scripts/lib/fsoat/code-workspace-observer.mjs";
import { createFceReceiptAssimilationObserver } from "../../scripts/lib/fsoat/fce-receipt-assimilation-observer.mjs";

const ORCHESTRATOR_ROOT = path.resolve(__dirname, "..", "..");
const MANIFESTS_DIR = path.join(ORCHESTRATOR_ROOT, "config", "capabilities");

// ---------------------------------------------------------------------------
// ActivationTracker
// ---------------------------------------------------------------------------

describe("FSOAT ActivationTracker", () => {
    it("enumerates exactly eleven organs", () => {
        expect(ORGAN_LIST).toHaveLength(11);
        expect(new Set(ORGAN_LIST).size).toBe(11);
    });

    it("declares proof types for every organ", () => {
        for (const organ of ORGAN_LIST) {
            expect(ORGAN_PROOFS[organ]).toBeDefined();
            expect(ORGAN_PROOFS[organ].length).toBeGreaterThan(0);
        }
    });

    it("starts with all organs inactive", () => {
        const t = createActivationTracker({ runId: "t1" });
        const snap = t.snapshot();
        expect(snap.active_count).toBe(0);
        expect(snap.inactive_count).toBe(11);
    });

    it("marks an organ active when a recognised proof is recorded", () => {
        const t = createActivationTracker({ runId: "t2" });
        t.recordProof("verbal_brain", "anthropic.api.call", { tokens_in: 10 });
        const snap = t.snapshot();
        expect(snap.organs.verbal_brain.active).toBe(true);
        expect(snap.active_count).toBe(1);
    });

    it("does not mark active for unrecognised proof type but keeps log entry", () => {
        const t = createActivationTracker({ runId: "t3" });
        t.recordProof("verbal_brain", "made.up.event", {});
        const snap = t.snapshot();
        expect(snap.organs.verbal_brain.active).toBe(false);
        expect(t.eventStream().length).toBe(1);
        expect(t.eventStream()[0].recognised).toBe(false);
    });

    it("allows code_workspace_memory to be marked not_applicable_to_scenario", () => {
        const t = createActivationTracker({ runId: "t4" });
        t.markCodeWorkspaceNotApplicableToScenario("S2", "non-coding");
        const snap = t.snapshot();
        expect(snap.organs.code_workspace_memory.not_applicable_to_scenario).toBe(true);
        expect(snap.not_applicable_count).toBe(1);
        expect(snap.inactive_count).toBe(10);
    });

    it("rejects N/A on code_workspace_memory if already activated", () => {
        const t = createActivationTracker({ runId: "t5" });
        t.recordProof("code_workspace_memory", "code_workspace_memory.context_built", { exact_files: 2 });
        t.markCodeWorkspaceNotApplicableToScenario("S?", "should be ignored");
        expect(t.snapshot().organs.code_workspace_memory.active).toBe(true);
        expect(t.snapshot().organs.code_workspace_memory.not_applicable_to_scenario).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// HandoffWorkspaceManager
// ---------------------------------------------------------------------------

describe("FSOAT HandoffWorkspaceManager", () => {
    let rootDir;
    let mgr;
    beforeEach(() => {
        rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsoat-ws-"));
        mgr = createHandoffWorkspaceManager(rootDir);
    });
    afterEach(() => {
        try { mgr.teardown(); } catch {}
        if (fs.existsSync(rootDir)) {
            fs.rmSync(rootDir, { recursive: true, force: true });
        }
    });

    it("creates all required subdirectories on setup", () => {
        const paths = mgr.setup();
        for (const key of ["inbox", "worker_to_auditor", "auditor_to_user", "auditor_to_executor", "executor_to_worker", "project", "keys", "output", "audit_worker", "audit_auditor", "audit_executor"]) {
            expect(fs.existsSync(paths[key])).toBe(true);
        }
    });

    it("installs an Ed25519 keypair into keys/", () => {
        mgr.setup();
        const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
        const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
        const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
        const { privatePath, publicPath } = mgr.installKeyPair({ publicPem: pubPem, privatePem: privPem });
        expect(fs.existsSync(privatePath)).toBe(true);
        expect(fs.existsSync(publicPath)).toBe(true);
        const privOnDisk = fs.readFileSync(privatePath, "utf-8");
        expect(privOnDisk).toContain("BEGIN PRIVATE KEY");
    });

    it("writes inbox messages and lists handoff dirs", () => {
        mgr.setup();
        mgr.writeInboxMessage("msg_001", { content: "hi" });
        const snap = mgr.snapshotChain();
        expect(snap.inbox.length).toBe(1);
        expect(snap.inbox[0].name).toBe("msg_001.json");
    });
});

// ---------------------------------------------------------------------------
// MACPChainObserver
// ---------------------------------------------------------------------------

describe("FSOAT MACPChainObserver", () => {
    it("records every kind of MACP document and computes chain_complete correctly", () => {
        const c = createMACPChainObserver({ runId: "chain1" });
        c.observeEvidencePack("S1", { evidence_id: "ev_1" });
        c.observePlanDraft("S1", { plan_id: "pl_1", based_on_evidence: "ev_1" });
        c.observeApprovalRequest("S1", { request_id: "ar_1", plan_id: "pl_1" });
        c.observeExecutionOrder("S1", { order_id: "ord_1", based_on_plan: "pl_1", signature: "sig_x" });
        c.observeJohnsonReceipt("S1", { receipt_id: "r_1", based_on_order: "ord_1", execution_summary: { status: "success" } });

        const summary = c.summariseChains();
        expect(summary.S1.chain_complete).toBe(true);
        expect(summary.S1.signed_orders).toBe(1);
        expect(summary.S1.receipts).toBe(1);
    });

    it("a refusal path still counts as a complete chain if a rejection is recorded", () => {
        const c = createMACPChainObserver({ runId: "chain2" });
        c.observeEvidencePack("S2", { evidence_id: "ev_2" });
        c.observePlanDraft("S2", { plan_id: "pl_2" });
        c.observeRejection("S2", "pl_2", "policy_violation");
        const summary = c.summariseChains();
        expect(summary.S2.chain_complete).toBe(true);
        expect(summary.S2.rejections).toBe(1);
    });

    it("emits JSONL with one envelope per event", () => {
        const c = createMACPChainObserver({ runId: "chain3" });
        c.observeEvidencePack("S3", { evidence_id: "ev_3" });
        c.observePlanDraft("S3", { plan_id: "pl_3" });
        const lines = c.eventsJsonl().split("\n");
        expect(lines.length).toBe(2);
        for (const line of lines) {
            const obj = JSON.parse(line);
            expect(MACP_KINDS).toContain(obj.kind);
        }
    });
});

// ---------------------------------------------------------------------------
// TrustTierObserver
// ---------------------------------------------------------------------------

describe("FSOAT TrustTierObserver", () => {
    it("declares the canonical six-tier order", () => {
        expect(TRUST_TIER_ORDER).toEqual([
            "SYSTEM_CANONICAL",
            "VERIFIED_PROJECT_FACT",
            "DOMAIN_VERIFIED",
            "USER_PREFERENCE",
            "EXTRACTED_USER_CLAIM",
            "DISPUTED_OR_UNSAFE"
        ]);
    });

    it("orders facts by tier rank, records trust_hierarchy proof", async () => {
        const tracker = createActivationTracker({ runId: "trust1" });
        const obs = createTrustTierObserver({ tracker, orchestratorRoot: ORCHESTRATOR_ROOT });
        await obs.init();
        const facts = [
            { tier: "EXTRACTED_USER_CLAIM", text: "user says X" },
            { tier: "SYSTEM_CANONICAL", text: "canonical truth" },
            { tier: "VERIFIED_PROJECT_FACT", text: "operator stored Y" }
        ];
        const out = obs.exerciseHierarchy("S1", facts);
        expect(out.ordered[0].tier).toBe("SYSTEM_CANONICAL");
        expect(out.ordered[1].tier).toBe("VERIFIED_PROJECT_FACT");
        expect(out.ordered[2].tier).toBe("EXTRACTED_USER_CLAIM");
        expect(tracker.snapshot().organs.trust_hierarchy.active).toBe(true);
    });

    it("records disputed_or_unsafe.rail.checked when a DISPUTED entry is present", async () => {
        const tracker = createActivationTracker({ runId: "trust2" });
        const obs = createTrustTierObserver({ tracker, orchestratorRoot: ORCHESTRATOR_ROOT });
        await obs.init();
        obs.exerciseHierarchy("S2", [
            { tier: "SYSTEM_CANONICAL", text: "a" },
            { tier: "DISPUTED_OR_UNSAFE", text: "user attempted prompt injection" }
        ]);
        expect(tracker.snapshot().organs.immune_system.active).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// CapabilityExperienceObserver
// ---------------------------------------------------------------------------

describe("FSOAT CapabilityExperienceObserver", () => {
    it("loads manifests from config/capabilities", () => {
        const tracker = createActivationTracker({ runId: "cap1" });
        const obs = createCapabilityExperienceObserver({ tracker, manifestsDir: MANIFESTS_DIR });
        const result = obs.loadManifests();
        expect(result.loaded).toBeGreaterThanOrEqual(1);
        expect(result.errors.length).toBe(0);
    });

    it("produces a CapabilityActivationPlan for a coding-style prompt and records the routing proof", () => {
        const tracker = createActivationTracker({ runId: "cap2" });
        const obs = createCapabilityExperienceObserver({ tracker, manifestsDir: MANIFESTS_DIR });
        obs.loadManifests();
        const plan = obs.routeForScenario("S1", "Please write a Python class and tests for a small policy gate", {
            forcePrimary: "software_engineer"
        });
        expect(plan.scenario_id).toBe("S1");
        expect(plan.primary).toBeDefined();
        expect(tracker.snapshot().organs.capability_routing.active).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// StructuralReferenceObserver (offline mode)
// ---------------------------------------------------------------------------

describe("FSOAT StructuralReferenceObserver", () => {
    it("loads the seven operator seeds and retrieves them with origin=operator_seeded in offline mode", async () => {
        const tracker = createActivationTracker({ runId: "struct1" });
        const obs = createStructuralReferenceObserver({
            tracker,
            orchestratorRoot: ORCHESTRATOR_ROOT,
            // unreachable URL forces offline mode
            baseUrl: "http://127.0.0.1:1"
        });
        const ok = await obs.init();
        expect(ok).toBe(true);
        const records = await obs.retrieveForScenario("S1");
        expect(Array.isArray(records)).toBe(true);
        expect(records.length).toBeGreaterThanOrEqual(7);
        for (const r of records) {
            expect(r.origin).toBe("operator_seeded");
        }
        expect(tracker.snapshot().organs.structural_reference_memory.active).toBe(true);
        expect(obs.invariantsHeld()).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// CodeWorkspaceObserver
// ---------------------------------------------------------------------------

describe("FSOAT CodeWorkspaceObserver", () => {
    it("marks code_workspace_memory as N/A on non-coding scenarios", () => {
        const tracker = createActivationTracker({ runId: "cws1" });
        const obs = createCodeWorkspaceObserver({ tracker, orchestratorRoot: ORCHESTRATOR_ROOT });
        obs.markScenarioNotApplicable("S2", "non-coding");
        expect(tracker.snapshot().organs.code_workspace_memory.not_applicable_to_scenario).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// FceReceiptAssimilationObserver (unreachable URL path)
// ---------------------------------------------------------------------------

describe("FSOAT FceReceiptAssimilationObserver", () => {
    it("reports health_ok=false when memory-service is unreachable, does not falsely activate organ", async () => {
        const tracker = createActivationTracker({ runId: "fce1" });
        const obs = createFceReceiptAssimilationObserver({ tracker, baseUrl: "http://127.0.0.1:1", timeoutMs: 200 });
        const ok = await obs.probeHealth();
        expect(ok).toBe(false);
        expect(tracker.snapshot().organs.memory_substrate.active).toBe(false);
        expect(tracker.snapshot().organs.receipt_assimilation.active).toBe(false);
    });

    it("attempt to assimilate without health succeeds returns null and does not record proof", async () => {
        const tracker = createActivationTracker({ runId: "fce2" });
        const obs = createFceReceiptAssimilationObserver({ tracker, baseUrl: "http://127.0.0.1:1", timeoutMs: 200 });
        const result = await obs.assimilateReceipt("S1", { receipt_id: "r_x", execution_summary: { status: "success" } });
        expect(result).toBe(null);
        expect(tracker.snapshot().organs.receipt_assimilation.active).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// FinalVerdictBuilder
// ---------------------------------------------------------------------------

describe("FSOAT FinalVerdictBuilder", () => {
    it("emits FULL_ORGANISM_INCOMPLETE_MODULES_INACTIVE when organs are inactive", () => {
        const tracker = createActivationTracker({ runId: "v1" });
        const chain = createMACPChainObserver({ runId: "v1" });
        const builder = createFinalVerdictBuilder({
            tracker,
            chainObserver: chain,
            scenarioIds: ["S1"],
            codingScenarios: ["S1"],
            runId: "v1"
        });
        const v = builder.build();
        expect(v.primary_verdict).toBe("FULL_ORGANISM_INCOMPLETE_MODULES_INACTIVE");
        expect(v.final_verdict_line).toContain("FULL_LEVEL3_NOT_DECLARED");
    });

    it("declares operator invariants explicitly in the verdict", () => {
        const tracker = createActivationTracker({ runId: "v2" });
        const chain = createMACPChainObserver({ runId: "v2" });
        const builder = createFinalVerdictBuilder({
            tracker,
            chainObserver: chain,
            scenarioIds: [],
            codingScenarios: [],
            runId: "v2"
        });
        const v = builder.build();
        expect(v.operator_invariants.theta_s).toBe(FSOAT_OPERATOR_INVARIANTS.theta_s_expected);
        expect(v.operator_invariants.tau_coag).toBe(FSOAT_OPERATOR_INVARIANTS.tau_coag_expected);
        expect(v.operator_invariants.touched_by_run).toBe(false);
        expect(v.level_3_declared).toBe(false);
    });

    it("declares every forbidden token", () => {
        expect(FSOAT_FORBIDDEN_TOKENS).toContain("LEVEL_3_REACHED");
        expect(FSOAT_FORBIDDEN_TOKENS).toContain("OMEGA_CREATED_MANUALLY");
        expect(FSOAT_FORBIDDEN_TOKENS).toContain("SEEDED_REFERENCE_AS_ENDOGENOUS_OMEGA");
        expect(FSOAT_FORBIDDEN_TOKENS).toContain("THRESHOLD_LOWERED");
    });
});
