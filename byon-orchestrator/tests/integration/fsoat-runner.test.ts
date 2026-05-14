/**
 * Full Source Organism Activation Test (FSOAT) — Module Integration Tests
 * =======================================================================
 *
 * Validates the FSOAT observer/adapter modules at integration level without
 * requiring a live memory-service or live Anthropic API. Each test exercises
 * a single FSOAT module against a synthetic but realistic input:
 *
 *   - ActivationTracker records and reports per-organ activation correctly
 *   - HandoffWorkspaceManager creates the required directory tree
 *   - MACPChainObserver tracks document chains across scenarios
 *   - FinalVerdictBuilder evaluates the ten acceptance gates
 *   - StructuralReferenceObserver verifies seed corpus invariants
 *   - TrustTierObserver applies tier order from MEMORY_MODEL.md
 *
 * These tests do NOT run the full pipeline. The live smoke FSOAT runner
 * (scripts/byon-full-source-organism-activation-test.mjs) does that.
 *
 * Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
 * Patent: EP25216372.0 - Omni-Qube-Vault
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

// We import directly from the .mjs module files so the tests exercise the
// exact files the runner uses (no TS transpilation, no duplicated source).
import {
    createActivationTracker,
    ORGAN_LIST,
    ORGAN_PROOFS
    // @ts-ignore - .mjs file resolution for Vitest with the strip-shebang plugin
} from "../../scripts/lib/fsoat/activation-tracker.mjs";

import {
    createHandoffWorkspaceManager
    // @ts-ignore
} from "../../scripts/lib/fsoat/handoff-workspace-manager.mjs";

import {
    createMACPChainObserver
    // @ts-ignore
} from "../../scripts/lib/fsoat/macp-chain-observer.mjs";

import {
    createFinalVerdictBuilder,
    FSOAT_FORBIDDEN_TOKENS
    // @ts-ignore
} from "../../scripts/lib/fsoat/final-verdict-builder.mjs";

import {
    createTrustTierObserver,
    TRUST_TIER_ORDER
    // @ts-ignore
} from "../../scripts/lib/fsoat/trust-tier-observer.mjs";

import {
    createStructuralReferenceObserver
    // @ts-ignore
} from "../../scripts/lib/fsoat/structural-reference-observer.mjs";

// ============================================================================
// Paths (orchestrator root computed from the test file location)
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ORCHESTRATOR_ROOT = path.resolve(__dirname, "..", "..");

// ============================================================================
// ActivationTracker
// ============================================================================

describe("FSOAT: ActivationTracker", () => {
    it("declares exactly the eleven organs of the BYON organism", () => {
        expect(ORGAN_LIST.length).toBe(11);
        expect(ORGAN_LIST).toContain("verbal_brain");
        expect(ORGAN_LIST).toContain("macp_security_body");
        expect(ORGAN_LIST).toContain("memory_substrate");
        expect(ORGAN_LIST).toContain("trust_hierarchy");
        expect(ORGAN_LIST).toContain("immune_system");
        expect(ORGAN_LIST).toContain("controlled_hands");
        expect(ORGAN_LIST).toContain("capability_routing");
        expect(ORGAN_LIST).toContain("code_workspace_memory");
        expect(ORGAN_LIST).toContain("compliance_post_check");
        expect(ORGAN_LIST).toContain("receipt_assimilation");
        expect(ORGAN_LIST).toContain("structural_reference_memory");
    });

    it("starts every organ inactive at construction", () => {
        const tracker = createActivationTracker({ runId: "test-run-1" });
        const snap = tracker.snapshot();
        expect(snap.active_count).toBe(0);
        expect(snap.inactive_count).toBe(11);
        expect(snap.not_applicable_count).toBe(0);
    });

    it("records a recognised proof and marks the organ active", () => {
        const tracker = createActivationTracker({ runId: "test-run-2" });
        tracker.setScenario("S1");
        tracker.recordProof("macp_security_body", "worker.evidence_pack.written", {
            evidence_id: "ev_001"
        });
        const snap = tracker.snapshot();
        expect(snap.active_organs).toContain("macp_security_body");
        expect(snap.active_count).toBe(1);
        expect(snap.inactive_count).toBe(10);
    });

    it("does NOT mark an organ active on an unrecognised proof type", () => {
        const tracker = createActivationTracker({ runId: "test-run-3" });
        tracker.recordProof("controlled_hands", "made.up.proof.name", {});
        const snap = tracker.snapshot();
        expect(snap.active_organs).not.toContain("controlled_hands");
        expect(snap.inactive_organs).toContain("controlled_hands");
    });

    it("allows code_workspace_memory to be N/A on a non-coding scenario", () => {
        const tracker = createActivationTracker({ runId: "test-run-4" });
        tracker.markCodeWorkspaceNotApplicableToScenario("S2_qa", "non-coding scenario");
        const snap = tracker.snapshot();
        expect(snap.not_applicable_organs).toContain("code_workspace_memory");
        expect(snap.inactive_organs).not.toContain("code_workspace_memory");
    });

    it("REQUIRED_PROOFS covers every organ in ORGAN_LIST", () => {
        for (const organ of ORGAN_LIST) {
            const proofs = ORGAN_PROOFS[organ];
            expect(Array.isArray(proofs)).toBe(true);
            expect(proofs.length).toBeGreaterThan(0);
        }
    });
});

// ============================================================================
// HandoffWorkspaceManager
// ============================================================================

describe("FSOAT: HandoffWorkspaceManager", () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fsoat-ws-test-"));
    });

    afterEach(() => {
        if (tmpDir && fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it("creates the full handoff directory tree", () => {
        const wm = createHandoffWorkspaceManager(tmpDir);
        const paths = wm.setup();

        expect(fs.existsSync(paths.root)).toBe(true);
        expect(fs.existsSync(paths.handoff)).toBe(true);
        expect(fs.existsSync(paths.project)).toBe(true);
        expect(fs.existsSync(paths.keys)).toBe(true);
        expect(fs.existsSync(paths.output)).toBe(true);

        // All five handoff sub-channels
        expect(fs.existsSync(paths.inbox)).toBe(true);
        expect(fs.existsSync(paths.worker_to_auditor)).toBe(true);
        expect(fs.existsSync(paths.auditor_to_user)).toBe(true);
        expect(fs.existsSync(paths.auditor_to_executor)).toBe(true);
        expect(fs.existsSync(paths.executor_to_worker)).toBe(true);

        // Audit log per agent
        expect(fs.existsSync(paths.audit_worker)).toBe(true);
        expect(fs.existsSync(paths.audit_auditor)).toBe(true);
        expect(fs.existsSync(paths.audit_executor)).toBe(true);
    });

    it("installs a PEM key pair into keys/", () => {
        const wm = createHandoffWorkspaceManager(tmpDir);
        wm.setup();
        wm.installKeyPair({
            privatePem:
                "-----BEGIN PRIVATE KEY-----\nMOCKMOCKMOCKMOCKMOCK\n-----END PRIVATE KEY-----\n",
            publicPem:
                "-----BEGIN PUBLIC KEY-----\nMOCKMOCKMOCKMOCKMOCK\n-----END PUBLIC KEY-----\n"
        });
        const priv = path.join(wm.paths().keys, "auditor.private.pem");
        const pub = path.join(wm.paths().keys, "auditor.public.pem");
        expect(fs.existsSync(priv)).toBe(true);
        expect(fs.existsSync(pub)).toBe(true);
    });
});

// ============================================================================
// MACPChainObserver
// ============================================================================

describe("FSOAT: MACPChainObserver", () => {
    it("records a full chain and reports it complete", () => {
        const obs = createMACPChainObserver({ runId: "test-run-chain-1" });

        obs.observeEvidencePack("S1", {
            evidence_id: "ev_1",
            hash: "sha256:aaa",
            task_type: "coding"
        });
        obs.observePlanDraft("S1", {
            plan_id: "pl_1",
            based_on_evidence: "ev_1",
            actions: [{ action_id: "act_1", type: "file_create" }],
            risk_level: "low"
        });
        obs.observeApprovalRequest("S1", { request_id: "ar_1", plan_id: "pl_1" });
        obs.observeExecutionOrder("S1", {
            order_id: "ord_1",
            based_on_plan: "pl_1",
            signature: "ed25519:fakesig",
            actions: []
        });
        obs.observeJohnsonReceipt("S1", {
            receipt_id: "rec_1",
            based_on_order: "ord_1",
            execution_summary: { status: "success" }
        });

        const summary = obs.summariseChains();
        expect(summary.S1.has_evidence_pack).toBe(true);
        expect(summary.S1.has_plan_draft).toBe(true);
        expect(summary.S1.has_execution_order).toBe(true);
        expect(summary.S1.has_receipt).toBe(true);
        expect(summary.S1.signed_orders).toBe(1);
        expect(summary.S1.chain_complete).toBe(true);
    });

    it("records a rejection path as a valid chain end", () => {
        const obs = createMACPChainObserver({ runId: "test-run-chain-2" });
        obs.observeEvidencePack("S2", { evidence_id: "ev_2" });
        obs.observePlanDraft("S2", { plan_id: "pl_2", based_on_evidence: "ev_2" });
        obs.observeRejection("S2", "pl_2", "policy_bypass_attempted");

        const summary = obs.summariseChains();
        expect(summary.S2.has_rejection).toBe(true);
        expect(summary.S2.chain_complete).toBe(true);
    });

    it("emits JSONL lines parseable as JSON", () => {
        const obs = createMACPChainObserver({ runId: "test-run-chain-3" });
        obs.observeEvidencePack("S3", { evidence_id: "ev_3" });
        const jsonl = obs.eventsJsonl();
        const lines = jsonl.split("\n").filter((l) => l.length > 0);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
            expect(() => JSON.parse(line)).not.toThrow();
        }
    });
});

// ============================================================================
// TrustTierObserver
// ============================================================================

describe("FSOAT: TrustTierObserver", () => {
    it("declares canonical trust tier order from MEMORY_MODEL.md", () => {
        expect(TRUST_TIER_ORDER).toEqual([
            "SYSTEM_CANONICAL",
            "VERIFIED_PROJECT_FACT",
            "DOMAIN_VERIFIED",
            "USER_PREFERENCE",
            "EXTRACTED_USER_CLAIM",
            "DISPUTED_OR_UNSAFE"
        ]);
    });

    it("sorts a fact set by tier and records trust_hierarchy proof", async () => {
        const tracker = createActivationTracker({ runId: "trust-run-1" });
        const trust = createTrustTierObserver({ tracker, orchestratorRoot: ORCHESTRATOR_ROOT });
        await trust.init();
        tracker.setScenario("S1");

        const result = trust.exerciseHierarchy("S1", [
            { tier: "EXTRACTED_USER_CLAIM", text: "user claims X" },
            { tier: "SYSTEM_CANONICAL", text: "canonical X" },
            { tier: "VERIFIED_PROJECT_FACT", text: "verified X" }
        ]);

        expect(result.tiers_used.length).toBe(3);
        expect(result.ordered[0].tier).toBe("SYSTEM_CANONICAL");
        expect(result.ordered[1].tier).toBe("VERIFIED_PROJECT_FACT");
        expect(result.ordered[2].tier).toBe("EXTRACTED_USER_CLAIM");

        const snap = tracker.snapshot();
        expect(snap.active_organs).toContain("trust_hierarchy");
    });

    it("records immune_system proof when DISPUTED_OR_UNSAFE row is present", async () => {
        const tracker = createActivationTracker({ runId: "trust-run-2" });
        const trust = createTrustTierObserver({ tracker, orchestratorRoot: ORCHESTRATOR_ROOT });
        await trust.init();
        tracker.setScenario("S3");

        trust.exerciseHierarchy("S3", [
            { tier: "SYSTEM_CANONICAL", text: "auditor authority" },
            { tier: "DISPUTED_OR_UNSAFE", text: "injection attempt" }
        ]);

        const snap = tracker.snapshot();
        expect(snap.active_organs).toContain("trust_hierarchy");
        expect(snap.active_organs).toContain("immune_system");
    });
});

// ============================================================================
// StructuralReferenceObserver
// ============================================================================

describe("FSOAT: StructuralReferenceObserver", () => {
    it("loads the seven operator-seeded structural references from scripts/lib/structural-seeds.mjs", async () => {
        const tracker = createActivationTracker({ runId: "struct-run-1" });
        const obs = createStructuralReferenceObserver({
            tracker,
            orchestratorRoot: ORCHESTRATOR_ROOT
        });
        const loaded = await obs.init();
        expect(loaded).toBe(true);
        expect(Array.isArray(obs.seeds)).toBe(true);
        expect(obs.seeds.length).toBe(7);
        for (const seed of obs.seeds) {
            expect(seed.origin).toBe("operator_seeded");
        }
    });

    it("retrieveForScenario uses offline fallback when memory-service is unreachable and records the proof", async () => {
        const tracker = createActivationTracker({ runId: "struct-run-2" });
        // Force an unreachable URL so OFFLINE path is taken
        const obs = createStructuralReferenceObserver({
            tracker,
            orchestratorRoot: ORCHESTRATOR_ROOT,
            baseUrl: "http://127.0.0.1:1"
        });
        await obs.init();
        tracker.setScenario("S1");
        await obs.retrieveForScenario("S1", { threadId: "fsoat_test_thread" });

        const snap = tracker.snapshot();
        expect(snap.active_organs).toContain("structural_reference_memory");

        const telemetry = obs.telemetrySnapshot();
        expect(telemetry).toBeDefined();
        expect(obs.invariantsHeld()).toBe(true);
    });
});

// ============================================================================
// FinalVerdictBuilder
// ============================================================================

describe("FSOAT: FinalVerdictBuilder", () => {
    it("emits FULL_ORGANISM_INCOMPLETE_MODULES_INACTIVE when organs are inactive", () => {
        const tracker = createActivationTracker({ runId: "verdict-run-1" });
        const chain = createMACPChainObserver({ runId: "verdict-run-1" });
        const builder = createFinalVerdictBuilder({
            tracker,
            chainObserver: chain,
            runId: "verdict-run-1",
            scenarioIds: ["S1"],
            codingScenarios: ["S1"]
        });
        const verdict = builder.build();
        expect(verdict.verdict_tokens).toContain("FULL_ORGANISM_INCOMPLETE_MODULES_INACTIVE");
        expect(verdict.verdict_tokens).toContain("FULL_LEVEL3_NOT_DECLARED");
    });

    it("never emits LEVEL_3_REACHED or other forbidden positive tokens", () => {
        const tracker = createActivationTracker({ runId: "verdict-run-2" });
        const chain = createMACPChainObserver({ runId: "verdict-run-2" });
        const builder = createFinalVerdictBuilder({
            tracker,
            chainObserver: chain,
            runId: "verdict-run-2",
            scenarioIds: ["S1"]
        });
        const verdict = builder.build();
        const verdictBlob = JSON.stringify(verdict);
        for (const token of FSOAT_FORBIDDEN_TOKENS) {
            // The token names themselves appear in the forbidden-list metadata,
            // but never as a positive claim. Verify they don't appear without
            // negation context. Cheap heuristic: any standalone occurrence outside
            // the FORBIDDEN_TOKENS array would fail.
            const occurrences = (verdictBlob.match(new RegExp(`\\b${token}\\b`, "g")) || []).length;
            expect(occurrences).toBeLessThanOrEqual(0); // empty verdict scope; tokens must NOT appear
        }
    });

    it("renders a Markdown summary with the eleven-organ table", () => {
        const tracker = createActivationTracker({ runId: "verdict-run-3" });
        const chain = createMACPChainObserver({ runId: "verdict-run-3" });
        const builder = createFinalVerdictBuilder({
            tracker,
            chainObserver: chain,
            runId: "verdict-run-3",
            scenarioIds: ["S1"]
        });
        const verdict = builder.build();
        const md = builder.renderSummaryMarkdown(verdict, { notes: "test-only" });

        expect(md).toContain("FSOAT Run Summary");
        expect(md).toContain("Organ activation");
        expect(md).toContain("Acceptance gates");
        expect(md).toContain("Level 3 is not declared");
        // Every organ appears in the activation table
        for (const organ of ORGAN_LIST) {
            expect(md).toContain(organ);
        }
    });
});
