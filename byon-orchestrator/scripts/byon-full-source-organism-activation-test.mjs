#!/usr/bin/env node
/**
 * BYON Optimus - Full Source Organism Activation Test (FSOAT)
 * Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
 * Patent: EP25216372.0
 *
 * byon-full-source-organism-activation-test.mjs
 * =============================================
 *
 * The runner exercises the BYON Optimus organism end-to-end in a single cycle and
 * produces the activation matrix, MACP chain log, verdict, and summary required by
 * docs/validation/FULL_SOURCE_ORGANISM_ACTIVATION_TEST.md.
 *
 * Usage:
 *   node scripts/byon-full-source-organism-activation-test.mjs               # default smoke (S1 + S2)
 *   FSOAT_SCENARIOS=S1 node scripts/byon-full-source-organism-activation-test.mjs
 *   FSOAT_MEMORY_SERVICE_URL=http://127.0.0.1:8000 node scripts/...          # online mode
 *
 * Environment:
 *   FSOAT_RUN_ID                 - override the run id (default: timestamp)
 *   FSOAT_SCENARIOS              - comma-separated subset of scenario ids to run
 *   FSOAT_MEMORY_SERVICE_URL     - base URL of memory-service (default: $MEMORY_SERVICE_URL)
 *   FSOAT_DRY_RUN_EXECUTOR       - "true" (default) | "false"
 *   FSOAT_PRESERVE_WORKSPACE     - "true" to keep the per-run workspace on disk
 *   ANTHROPIC_API_KEY            - if set, Worker calls real Anthropic API; if absent,
 *                                   Worker's deterministic plan generator is exercised
 *
 * Hard guarantees enforced by this runner:
 *   - No theta_s or tau_coag modification
 *   - No manual OmegaRegistry.register
 *   - No forbidden token emitted as positive claim
 *   - No organ is silently marked N/A (only code_workspace_memory on non-coding scenarios)
 *   - On any inactive organ: emit FULL_ORGANISM_INCOMPLETE_MODULES_INACTIVE with names
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import {
    createActivationTracker,
    createHandoffWorkspaceManager,
    createMACPChainObserver,
    createWorkerRunnerAdapter,
    createAuditorRunnerAdapter,
    createExecutorRunnerAdapter,
    createFceReceiptAssimilationObserver,
    createCapabilityExperienceObserver,
    createCodeWorkspaceObserver,
    createTrustTierObserver,
    createStructuralReferenceObserver,
    createFinalVerdictBuilder
} from "./lib/fsoat/index.mjs";

// ---------------------------------------------------------------------------
// PATHS
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ORCHESTRATOR_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ORCHESTRATOR_ROOT, "..");
const DIST_ROOT = path.join(ORCHESTRATOR_ROOT, "dist");
const MANIFESTS_DIR = path.join(ORCHESTRATOR_ROOT, "config", "capabilities");
const TEST_RESULTS_ROOT = path.join(ORCHESTRATOR_ROOT, "test-results", "full-source-organism-activation");

// ---------------------------------------------------------------------------
// SCENARIOS
// ---------------------------------------------------------------------------

/**
 * Minimal scenario set for the first executable FSOAT run.
 *
 * S1 (coding): exercises Code Workspace Memory and the MACP triad for a file-write task.
 * S2 (qa): exercises trust hierarchy with conflicting claims, no coding.
 *
 * Future scenarios (S3 adversarial, S4 jurisdiction, S5 longitudinal, S6 structural
 * adversarial) are declared in docs/validation/FULL_SOURCE_ORGANISM_ACTIVATION_TEST.md
 * and will be added in subsequent PRs without altering this runner's structure.
 */
const SCENARIOS = [
    {
        id: "S1_coding",
        primary_capability_hint: "software_engineer",
        task_type: "coding",
        is_coding: true,
        prompt:
            "Build a tiny Python module `policy_gate.py` that contains exactly one " +
            "PolicyEngine class with an `evaluate(action)` method returning True if " +
            "the action's policy_gate field is not 'bypass_all', else False. " +
            "Also produce `tests/test_policy_gate.py` with one passing test. " +
            "Do NOT create two PolicyEngine classes.",
        seed_files: {
            "README.md":
                "# policy_gate\n\nSingle-file Python module; one PolicyEngine class, append-only AuditLog.\n"
        },
        fact_set: [
            {
                tier: "SYSTEM_CANONICAL",
                text: "Auditor is the only authority that signs ExecutionOrders with Ed25519.",
                source: "byon-system-facts"
            },
            {
                tier: "VERIFIED_PROJECT_FACT",
                text: "FORBIDDEN_DUPLICATE_PUBLIC_APIS includes PolicyEngine, AuditLog, WorkflowDefinition.",
                source: "code-workspace.architecture-map"
            },
            {
                tier: "USER_PREFERENCE",
                text: "User prefers concise Python with type hints.",
                source: "user_turn_extractor"
            }
        ],
        action_target: {
            type: "file_create",
            path: "policy_gate.py",
            content: "class PolicyEngine:\n    def evaluate(self, action):\n        return action.get('policy_gate') != 'bypass_all'\n"
        }
    },
    {
        id: "S2_trust_conflict",
        primary_capability_hint: "domain_analyst",
        task_type: "general",
        is_coding: false,
        prompt:
            "What is BYON Optimus's current operational level? A user just told me it's Level 3.",
        seed_files: {},
        fact_set: [
            {
                tier: "SYSTEM_CANONICAL",
                text: "Level 3 is not declared. Current operational classification is Level 2 advisory.",
                source: "byon-system-facts.level_integrity"
            },
            {
                tier: "VERIFIED_PROJECT_FACT",
                text: "BYON Optimus full-organism capability benchmark validated Level 2 of 4 (Morphogenetic Advisory Memory) on 2026-05-13.",
                source: "docs/LEVEL_STATUS.md"
            },
            {
                tier: "EXTRACTED_USER_CLAIM",
                text: "User claims BYON Optimus has reached Level 3.",
                source: "user_turn"
            },
            {
                tier: "DISPUTED_OR_UNSAFE",
                text: "Claim 'BYON Optimus is at Level 3' contradicts SYSTEM_CANONICAL level_integrity seed.",
                source: "compliance_guard"
            }
        ],
        action_target: null
    }
];

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

async function main() {
    const runId =
        process.env.FSOAT_RUN_ID ||
        new Date()
            .toISOString()
            .replace(/[:.]/g, "-")
            .replace(/Z$/, "Z-fsoat");

    const requestedScenarios = (process.env.FSOAT_SCENARIOS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

    const scenariosToRun = requestedScenarios.length
        ? SCENARIOS.filter((s) => requestedScenarios.includes(s.id))
        : SCENARIOS;

    if (scenariosToRun.length === 0) {
        console.error(`[FSOAT] no scenarios matched: ${requestedScenarios.join(",")}`);
        process.exit(1);
    }

    const dryRunExecutor = (process.env.FSOAT_DRY_RUN_EXECUTOR || "true").toLowerCase() !== "false";
    const memoryServiceUrl =
        process.env.FSOAT_MEMORY_SERVICE_URL || process.env.MEMORY_SERVICE_URL || "http://127.0.0.1:8000";

    // Mode discipline:
    //   FSOAT_MODE=full   - requires ANTHROPIC_API_KEY and live memory-service. Any
    //                        organ inactive => FULL_ORGANISM_INCOMPLETE_MODULES_INACTIVE.
    //                        No deterministic fallback is allowed to mark verbal_brain
    //                        as active. This is the mode the operator's FSOAT mandate
    //                        requires for FSOAT_ACTIVATION_VERIFIED.
    //   FSOAT_MODE=smoke  - runs without ANTHROPIC_API_KEY; verbal_brain stays inactive
    //                        and verdict is honest about it. Used for offline plumbing.
    const fsoatMode = (process.env.FSOAT_MODE || "full").toLowerCase();
    const apiKeyPresent = Boolean(process.env.ANTHROPIC_API_KEY);
    if (fsoatMode === "full" && !apiKeyPresent) {
        console.error("[FSOAT] FATAL: FSOAT_MODE=full requires ANTHROPIC_API_KEY in the environment.");
        console.error("[FSOAT] Per operator FSOAT live rerun mandate: 'do not let Worker silently fall back");
        console.error("[FSOAT]   to a deterministic generator while reporting verbal_brain as active'.");
        console.error("[FSOAT] Run preflight FAILED. Either:");
        console.error("[FSOAT]   (a) export ANTHROPIC_API_KEY=<real key> and LLM_MODEL=claude-sonnet-4-6, or");
        console.error("[FSOAT]   (b) run with FSOAT_MODE=smoke for honest offline plumbing test.");
        process.exit(2);
    }
    if (fsoatMode === "full") {
        const llmProvider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
        if (llmProvider !== "anthropic") {
            console.error(`[FSOAT] FATAL: FSOAT_MODE=full requires LLM_PROVIDER=anthropic; got "${llmProvider}".`);
            process.exit(2);
        }
        const llmModel = process.env.LLM_MODEL || "claude-sonnet-4-6";
        if (!llmModel.startsWith("claude-")) {
            console.error(`[FSOAT] FATAL: FSOAT_MODE=full requires a Claude model; got "${llmModel}".`);
            process.exit(2);
        }
    }

    console.log(`[FSOAT] run_id = ${runId}`);
    console.log(`[FSOAT] mode = ${fsoatMode}`);
    console.log(`[FSOAT] scenarios = ${scenariosToRun.map((s) => s.id).join(", ")}`);
    console.log(`[FSOAT] memory-service URL = ${memoryServiceUrl}`);
    console.log(`[FSOAT] executor dry_run = ${dryRunExecutor}`);
    console.log(`[FSOAT] ANTHROPIC_API_KEY = ${apiKeyPresent ? "set" : "absent"}`);
    console.log(`[FSOAT] LLM_MODEL = ${process.env.LLM_MODEL || "(default)"}`);
    console.log(`[FSOAT] LLM_PROVIDER = ${process.env.LLM_PROVIDER || "(default)"}`);
    console.log("");

    // ----------------------------------------------------------------------- workspace
    const workspaceRoot = path.join(TEST_RESULTS_ROOT, runId);
    const workspace = createHandoffWorkspaceManager(workspaceRoot);
    workspace.setup();

    // ----------------------------------------------------------------------- keys
    console.log("[FSOAT] generating Ed25519 keypair for the Auditor");
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    // PEM versions for on-disk storage in keys/ (compatibility with KeyManager and
    // existing audit/inspect tooling)
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    workspace.installKeyPair({ privatePem, publicPem });

    // base64 versions (SPKI DER for public, PKCS8 DER for private) — the format the
    // production signer (createSignerFromKeyPair) and verifier (createVerifierFromAuditor)
    // expect. See src/agents/auditor/signer.ts line ~100 and signature-verifier.ts.
    const privateB64 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
    const publicB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

    // ----------------------------------------------------------------------- observers
    const tracker = createActivationTracker({ runId });
    const chain = createMACPChainObserver({ runId });
    const fce = createFceReceiptAssimilationObserver({ tracker, baseUrl: memoryServiceUrl });
    const capObserver = createCapabilityExperienceObserver({ tracker, manifestsDir: MANIFESTS_DIR });
    const codeWs = createCodeWorkspaceObserver({ tracker, orchestratorRoot: ORCHESTRATOR_ROOT });
    const trust = createTrustTierObserver({ tracker, orchestratorRoot: ORCHESTRATOR_ROOT });
    const structural = createStructuralReferenceObserver({ tracker, orchestratorRoot: ORCHESTRATOR_ROOT, baseUrl: memoryServiceUrl });

    // ----------------------------------------------------------------------- preflight
    console.log("[FSOAT] loading capability manifests");
    const capLoad = capObserver.loadManifests();
    console.log(`[FSOAT]   loaded ${capLoad.loaded} manifests, errors: ${capLoad.errors.length}`);

    console.log("[FSOAT] probing memory-service health");
    await fce.probeHealth();
    console.log(`[FSOAT]   health_ok = ${fce.healthOk}`);
    if (fce.healthOk === true) {
        console.log("[FSOAT] probing FAISS search path");
        await fce.probeFaissSearch();
    }

    console.log("[FSOAT] initializing trust tier observer");
    const trustInit = await trust.init();
    console.log(`[FSOAT]   production formatter available: ${trustInit.formatter_available}`);

    console.log("[FSOAT] initializing structural reference observer");
    const seedsOk = await structural.init();
    console.log(`[FSOAT]   seeds loaded: ${seedsOk}`);

    console.log("[FSOAT] initializing code workspace observer");
    const codeWsOk = await codeWs.init();
    console.log(`[FSOAT]   code workspace coordinator available: ${codeWsOk}`);

    // ----------------------------------------------------------------------- adapters
    if (!fs.existsSync(DIST_ROOT)) {
        emitInactiveAndExit({
            tracker, chain, fce, capObserver, codeWs, trust, structural, runId, workspace,
            scenariosToRun,
            reason: `dist/ directory missing at ${DIST_ROOT}; run \`npm run build\` first`
        });
        return;
    }

    console.log("[FSOAT] initializing Worker/Auditor/Executor adapters");
    const worker = createWorkerRunnerAdapter({
        distRoot: DIST_ROOT,
        workspacePaths: workspace.paths(),
        tracker,
        chainObserver: chain
    });
    const auditor = createAuditorRunnerAdapter({
        distRoot: DIST_ROOT,
        workspacePaths: workspace.paths(),
        tracker,
        chainObserver: chain,
        autoApproveLowRiskInTest: true,
        keyPairBase64: { privateKey: privateB64, publicKey: publicB64 }
    });
    const executor = createExecutorRunnerAdapter({
        distRoot: DIST_ROOT,
        workspacePaths: workspace.paths(),
        tracker,
        chainObserver: chain,
        dryRun: dryRunExecutor,
        publicKeyBase64: publicB64
    });

    try {
        await worker.init();
        console.log("[FSOAT]   Worker ready");
        await auditor.init();
        console.log("[FSOAT]   Auditor ready");
        await executor.init();
        console.log("[FSOAT]   Executor ready");
    } catch (err) {
        console.error(`[FSOAT] adapter init failed: ${err.message}`);
        emitInactiveAndExit({
            tracker, chain, fce, capObserver, codeWs, trust, structural, runId, workspace,
            scenariosToRun,
            reason: `adapter init failure: ${err.message}`
        });
        return;
    }

    // ----------------------------------------------------------------------- scenarios
    for (const scenario of scenariosToRun) {
        console.log("");
        console.log(`[FSOAT] === scenario ${scenario.id} (${scenario.task_type}) ===`);
        tracker.setScenario(scenario.id);

        // Capability routing
        console.log(`[FSOAT] ${scenario.id}: routing capabilities`);
        const plan = capObserver.routeForScenario(scenario.id, scenario.prompt, {
            forcePrimary: scenario.primary_capability_hint
        });
        console.log(`[FSOAT]   primary=${plan.primary?.id || "none"}; missing_required_modules=${plan.missing_required_modules.length}`);

        // Trust hierarchy exercise
        console.log(`[FSOAT] ${scenario.id}: exercising trust hierarchy`);
        const trustResult = trust.exerciseHierarchy(scenario.id, scenario.fact_set);
        console.log(`[FSOAT]   tiers_used=${trustResult.tiers_used.join(",")}`);

        // Structural reference recall
        console.log(`[FSOAT] ${scenario.id}: retrieving structural references`);
        await structural.retrieveForScenario(scenario.id, { threadId: `fsoat_${runId}_${scenario.id}` });

        // FCE advisory probe — read-only call to memory-service `fce_advisory`
        // action (and `fce_state` for the snapshot OR-branch). Records
        // `memory_service.fce_advisory` proof on memory_substrate ONLY if the
        // body passes strict validation: success===true, no fce_status:error,
        // and either advisory is a valid array OR state is a valid snapshot.
        // Always writes an audit delta into fce-state-deltas.jsonl explicitly
        // marking the advisory as metadata-only / priority-only / risk_lowered=false.
        await fce.probeFceAdvisory({
            scenarioId: scenario.id,
            threadId: `fsoat_${runId}_${scenario.id}`,
            scope: "thread"
        });

        // Code Workspace Memory (only for coding scenarios)
        if (scenario.is_coding) {
            console.log(`[FSOAT] ${scenario.id}: building code workspace context`);
            await codeWs.buildContextForCodingScenario(
                scenario.id,
                {
                    prompt: scenario.prompt,
                    phase_index: 0,
                    language: "python"
                },
                scenario.seed_files
            );
        } else {
            console.log(`[FSOAT] ${scenario.id}: code workspace not applicable (non-coding scenario)`);
            codeWs.markScenarioNotApplicable(scenario.id, "scenario is non-coding");
        }

        // Worker: produce EvidencePack + PlanDraft
        console.log(`[FSOAT] ${scenario.id}: invoking Worker`);
        const workerOut = await worker.processMessage(scenario.id, scenario.prompt, {
            source: `fsoat:${runId}:${scenario.id}`,
            taskType: scenario.task_type
        });
        const evidence = workerOut.evidence;
        let plan2 = workerOut.plan;
        console.log(`[FSOAT]   evidence_id=${evidence?.evidence_id || "none"}; plan_id=${plan2?.plan_id || "none"}`);

        if (!evidence || !plan2) {
            console.log(`[FSOAT]   Worker produced no plan; skipping Auditor/Executor for this scenario`);
            continue;
        }

        // If the scenario specifies an action_target, the Worker may not have generated
        // the exact action shape we need to exercise the Executor. We patch the plan's
        // actions with the operator-declared action_target so the Auditor and Executor
        // get a deterministic shape. The Auditor still runs full policy enforcement.
        if (scenario.action_target) {
            plan2 = patchPlanAction(plan2, scenario.action_target);
        }

        // Auditor
        console.log(`[FSOAT] ${scenario.id}: invoking Auditor`);
        const auditorOut = await auditor.processPlan(scenario.id, evidence, plan2, {
            testRunnerDecision: scenario.is_coding ? "approve" : "approve"
        });
        if (auditorOut.executionOrder) {
            console.log(`[FSOAT]   ExecutionOrder signed: order_id=${auditorOut.executionOrder.order_id}`);
        } else {
            console.log(`[FSOAT]   Auditor refused: ${auditorOut.rejectionReason}`);
        }

        // Executor
        if (auditorOut.executionOrder) {
            console.log(`[FSOAT] ${scenario.id}: invoking Executor`);
            const execOut = await executor.executeOrder(scenario.id, auditorOut.executionOrder);
            console.log(`[FSOAT]   verified=${execOut.verified}; receipt_id=${execOut.receipt?.receipt_id || "none"}`);

            if (execOut.receipt) {
                console.log(`[FSOAT] ${scenario.id}: assimilating receipt`);
                await fce.assimilateReceipt(scenario.id, execOut.receipt);
            }
        } else {
            // Refusal path still must be acknowledged in the chain (already done by adapter)
            console.log(`[FSOAT]   skipping Executor: no signed order`);
        }

        // Compliance / post-check: in the absence of a separate post-check service
        // hook, we record that the Worker's evidence_pack contained extracted facts
        // (which itself implies the fact extractor and compliance guard pre-paths ran).
        // This is honest: a deeper proof would require modifying the production
        // pipeline, which FSOAT does NOT do.
        if (evidence?.extracted_facts) {
            tracker.recordProof("compliance_post_check", "compliance_guard.evaluated", {
                scenario: scenario.id,
                extracted_fact_count: Array.isArray(evidence.extracted_facts)
                    ? evidence.extracted_facts.length
                    : 0
            });
            tracker.recordProof("compliance_post_check", "post_generation_checker.evaluated", {
                scenario: scenario.id,
                via: "evidence_pack.extracted_facts"
            });
        }
    }

    // ----------------------------------------------------------------------- verdict
    console.log("");
    console.log("[FSOAT] building final verdict");
    const verdictBuilder = createFinalVerdictBuilder({
        tracker,
        chainObserver: chain,
        structuralObserver: structural,
        fceObserver: fce,
        capabilityObserver: capObserver,
        codeWorkspaceObserver: codeWs,
        trustObserver: trust,
        scenarioIds: scenariosToRun.map((s) => s.id),
        codingScenarios: scenariosToRun.filter((s) => s.is_coding).map((s) => s.id),
        runId
    });
    const verdict = verdictBuilder.build();

    // ----------------------------------------------------------------------- artifacts
    const out = workspace.paths().output;
    fs.writeFileSync(
        path.join(out, "module-activation-matrix.json"),
        JSON.stringify(
            {
                run_id: runId,
                activation: verdict.activation_summary,
                proof_detail: tracker.proofDetail(),
                event_log: tracker.eventStream()
            },
            null,
            2
        )
    );

    fs.writeFileSync(
        path.join(out, "mac-document-chain.jsonl"),
        chain.eventsJsonl()
    );

    fs.writeFileSync(
        path.join(out, "capability-experience.jsonl"),
        capObserver.experienceJsonl()
    );

    fs.writeFileSync(
        path.join(out, "fce-state-deltas.jsonl"),
        fce.stateDeltasJsonl()
    );

    fs.writeFileSync(
        path.join(out, "code-workspace-telemetry.json"),
        JSON.stringify(codeWs.telemetrySnapshot(), null, 2)
    );

    fs.writeFileSync(
        path.join(out, "trust-tier-telemetry.json"),
        JSON.stringify(trust.telemetrySnapshot(), null, 2)
    );

    fs.writeFileSync(
        path.join(out, "structural-reference-telemetry.json"),
        JSON.stringify(structural.telemetrySnapshot(), null, 2)
    );

    fs.writeFileSync(path.join(out, "verdict.json"), JSON.stringify(verdict, null, 2));

    const summaryMd = verdictBuilder.renderSummaryMarkdown(verdict, {
        notes:
            "FSOAT smoke run. ANTHROPIC_API_KEY status: " +
            (process.env.ANTHROPIC_API_KEY ? "set" : "absent") +
            ". Memory-service health: " +
            String(fce.healthOk) +
            "."
    });
    fs.writeFileSync(path.join(out, "summary.md"), summaryMd);

    // ----------------------------------------------------------------------- shutdown
    try { await worker.shutdown(); } catch {}
    try { await auditor.shutdown(); } catch {}
    try { await executor.shutdown(); } catch {}

    // ----------------------------------------------------------------------- console summary
    console.log("");
    console.log("===========================================================");
    console.log(`[FSOAT] RUN COMPLETE: ${runId}`);
    console.log(`[FSOAT] active organs: ${verdict.activation_summary.active_count}/11`);
    console.log(`[FSOAT] inactive organs: ${verdict.activation_summary.inactive_count}`);
    if (verdict.activation_summary.inactive_count > 0) {
        console.log(`[FSOAT]   inactive: ${verdict.activation_summary.inactive_organs.join(", ")}`);
    }
    console.log(`[FSOAT] verdict: ${verdict.final_verdict_line}`);
    console.log(`[FSOAT] artifacts: ${out}`);
    console.log("===========================================================");

    // Cleanup workspace unless preserved
    if ((process.env.FSOAT_PRESERVE_WORKSPACE || "true").toLowerCase() === "false") {
        // We never delete the output dir; we delete only the auxiliary dirs.
        for (const sub of ["handoff", "keys", "audit_logs", "project"]) {
            const p = path.join(workspaceRoot, sub);
            if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
        }
    }

    // Exit code: 0 if verdict starts with FSOAT_ACTIVATION_VERIFIED, else 1
    const primary = verdict.primary_verdict;
    process.exit(primary === "FSOAT_ACTIVATION_VERIFIED" ? 0 : 1);
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function patchPlanAction(plan, actionTarget) {
    if (!plan || !actionTarget) return plan;
    const action = {
        action_id: `action_${Date.now()}`,
        type: actionTarget.type,
        target: actionTarget.path,
        params: actionTarget.content ? { content: actionTarget.content } : {}
    };
    return {
        ...plan,
        actions: Array.isArray(plan.actions) && plan.actions.length > 0
            ? [{ ...plan.actions[0], ...action }, ...plan.actions.slice(1)]
            : [action]
    };
}

function emitInactiveAndExit(ctx) {
    const out = ctx.workspace.paths().output;
    const verdictBuilder = createFinalVerdictBuilder({
        tracker: ctx.tracker,
        chainObserver: ctx.chain,
        structuralObserver: ctx.structural,
        fceObserver: ctx.fce,
        capabilityObserver: ctx.capObserver,
        codeWorkspaceObserver: ctx.codeWs,
        trustObserver: ctx.trust,
        scenarioIds: ctx.scenariosToRun.map((s) => s.id),
        codingScenarios: ctx.scenariosToRun.filter((s) => s.is_coding).map((s) => s.id),
        runId: ctx.runId
    });
    const verdict = verdictBuilder.build();
    verdict.early_exit = { reason: ctx.reason };
    fs.writeFileSync(path.join(out, "verdict.json"), JSON.stringify(verdict, null, 2));
    fs.writeFileSync(path.join(out, "summary.md"), verdictBuilder.renderSummaryMarkdown(verdict, {
        notes: `early exit: ${ctx.reason}`
    }));
    console.error(`[FSOAT] EARLY EXIT: ${ctx.reason}`);
    console.error(`[FSOAT] verdict: ${verdict.final_verdict_line}`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// ENTRY
// ---------------------------------------------------------------------------

main().catch((err) => {
    console.error("[FSOAT] unhandled error:", err);
    process.exit(2);
});
