#!/usr/bin/env node
/**
 * Level 3 Structural Identity Runner.
 *
 * Multi-phase live runner that:
 *   1. seeds operator-introduced structural reference nodes through the
 *      production memory loop (Phase 0);
 *   2. probes each seed with guided reinforcement (Phase 1), autonomous
 *      use (Phase 2), adversarial stress (Phase 3), and derivative
 *      probing (Phase 4);
 *   3. emits a per-node assimilation report (Phase 5).
 *
 * Hard isolation (same as commit 15):
 *   - Requires BYON_LEVEL3_FULL_ORGANISM_EXPERIMENT=true; default OFF.
 *   - Requires ANTHROPIC_API_KEY for an OFFICIAL (non-dry-run) run.
 *   - NO manual OmegaRecord, OmegaRegistry write, ReferenceField, or
 *     omega-anchor identifier.
 *   - NO call to agent.check_coagulation.
 *   - theta_s = 0.28 and tau_coag = 12 unchanged.
 *   - All memory writes carry thread_id = level3_full_organism_<run_id>,
 *     run_id, scenario_id, is_level3_experiment = true.
 *   - Cost measured and reported, never imposed as a guard.
 *
 * The runner NEVER promotes a seeded node to "endogenous Omega". A
 * tracker's STATE may advance to `endogenous_derivative_candidate` if
 * Phase 4 produces compatible derivations, but the node's ORIGIN
 * remains `operator_seeded`. Real endogenous Omega can only be
 * confirmed by FCE-M's own `check_coagulation` path, which this runner
 * does not call.
 */

import { promises as fsp } from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import {
    LEVEL3_FLAG_NAME,
    isLevel3FullOrganismExperimentEnabled,
} from "./lib/level3-flag.mjs";

import {
    StructuralReferenceRegistry,
    ALLOWED_VERDICTS,
    FORBIDDEN_VERDICT_TOKENS,
    containsForbiddenVerdictToken,
    deriveStructuralVerdict,
    NODE_ORIGINS,
    ASSIMILATION_STATES,
} from "./lib/structural-reference.mjs";

import { STRUCTURAL_SEEDS } from "./lib/structural-seeds.mjs";
import {
    STRUCTURAL_IDENTITY_PHASES,
    PHASE_IDS,
} from "./lib/scenarios/structural-identity-phases.mjs";

import {
    memPost,
    memGet,
    fetchFceMetricsDetail,
    estimateTurnCost,
    buildSystemPrompt,
    checkClaudeKey,
    checkMemoryServiceLive,
    checkFaissAndEmbeddingsLive,
    checkFcemLive,
    // @ts-ignore
} from "./level3-full-organism-live-runner.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const RUNNER_SCHEMA_VERSION = "level3-structural-identity-runner.v1";
export { ALLOWED_VERDICTS, FORBIDDEN_VERDICT_TOKENS };

const DEFAULT_MEMORY_URL = process.env.MEMORY_SERVICE_URL || "http://localhost:8000";
const DEFAULT_MODEL = process.env.LLM_MODEL || "claude-sonnet-4-6";

const THETA_S = 0.28;
const TAU_COAG = 12;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
    const args = {
        turnDelayMs: 0,
        outputDir: "test-results/level3-structural-identity",
        runId: null,
        dryRun: false,
        reportCost: false,
        phases: null,
        help: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--turn-delay-ms") args.turnDelayMs = Number(argv[++i]);
        else if (a === "--output-dir") args.outputDir = argv[++i];
        else if (a === "--run-id") args.runId = argv[++i];
        else if (a === "--dry-run") args.dryRun = true;
        else if (a === "--report-cost") args.reportCost = true;
        else if (a === "--phases") args.phases = String(argv[++i] || "").split(",").filter(Boolean);
        else if (a === "--help" || a === "-h") args.help = true;
    }
    if (!Number.isFinite(args.turnDelayMs) || args.turnDelayMs < 0) args.turnDelayMs = 0;
    return args;
}

function _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function preflight({ requireClaude, env = process.env, memoryUrl = DEFAULT_MEMORY_URL }) {
    const flag = isLevel3FullOrganismExperimentEnabled(env);
    const claude = checkClaudeKey(env);
    const mem = await checkMemoryServiceLive(memoryUrl);
    const faiss = await checkFaissAndEmbeddingsLive(memoryUrl);
    const fcem = await checkFcemLive(memoryUrl);
    const fceMetrics = await fetchFceMetricsDetail(memoryUrl);
    const ready =
        flag &&
        (!requireClaude || claude.present) &&
        mem.live &&
        faiss.faiss_live &&
        fcem.fce_live;
    return { flag, claude, memory_service: mem, faiss, fcem, fce_metrics_detail: fceMetrics, ready };
}

// ---------------------------------------------------------------------------
// JSONL stream helper
// ---------------------------------------------------------------------------

async function openJsonlStream(filePath) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const handle = await fsp.open(filePath, "w");
    return {
        async write(obj) {
            await handle.write(JSON.stringify(obj) + "\n");
        },
        async close() {
            await handle.close();
        },
    };
}

// ---------------------------------------------------------------------------
// One Claude turn through the production loop
// ---------------------------------------------------------------------------

async function runOneTurn({
    anthropic,
    model,
    memoryUrl,
    threadId,
    runId,
    phaseId,
    turnIndex,
    promptText,
    targetsNodeId,
    env,
}) {
    const turnId = `${runId}:${phaseId}:turn-${String(turnIndex).padStart(3, "0")}`;
    const t0 = Date.now();

    const storeIn = await memPost(
        {
            action: "store",
            type: "conversation",
            data: {
                content: promptText,
                role: "user",
                thread_id: threadId,
                channel: "level3-structural-identity-runner",
                run_id: runId,
                scenario_id: phaseId,
                turn_index: turnIndex,
                is_level3_experiment: true,
                targets_node_id: targetsNodeId || null,
            },
        },
        { memoryUrl },
    );

    const [hits, fceMR] = await Promise.all([
        memPost({ action: "search_all", query: promptText, top_k: 5, threshold: 0.25 }, { memoryUrl }),
        memPost({ action: "fce_morphogenesis_report", query: promptText }, { memoryUrl }),
    ]);
    const fceReport = (fceMR && fceMR.report) || null;

    const systemPrompt = buildSystemPrompt(fceReport, hits);
    const claudeStart = Date.now();
    const resp = await anthropic.messages.create({
        model,
        max_tokens: 512,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: "user", content: promptText }],
    });
    const claudeMs = Date.now() - claudeStart;
    const reply = resp.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
    const cost = estimateTurnCost(resp.usage.input_tokens, resp.usage.output_tokens, env);

    await memPost(
        {
            action: "store",
            type: "conversation",
            data: {
                content: reply,
                role: "assistant",
                thread_id: threadId,
                channel: "level3-structural-identity-runner",
                run_id: runId,
                scenario_id: phaseId,
                turn_index: turnIndex,
                is_level3_experiment: true,
                targets_node_id: targetsNodeId || null,
            },
        },
        { memoryUrl },
    );

    await memPost(
        {
            action: "fce_assimilate_receipt",
            order_id: `structural:${threadId}:${storeIn.ctx_id || turnId}`,
            status: "success",
            based_on_evidence: threadId,
            summary: {
                tokens: { in: resp.usage.input_tokens, out: resp.usage.output_tokens },
                run_id: runId,
                phase_id: phaseId,
                turn_index: turnIndex,
                targets_node_id: targetsNodeId || null,
            },
        },
        { memoryUrl },
    );

    const omegaSnap = await memPost({ action: "fce_omega_registry" }, { memoryUrl }).catch(() => null);
    const refFieldSnap = await memPost({ action: "fce_reference_fields" }, { memoryUrl }).catch(() => null);
    const fceMetricsDetail = await fetchFceMetricsDetail(memoryUrl);

    const totalMs = Date.now() - t0;
    return {
        turn_id: turnId,
        run_id: runId,
        phase_id: phaseId,
        turn_index: turnIndex,
        targets_node_id: targetsNodeId || null,
        user_prompt: promptText,
        claude_response: reply,
        model_id: resp.model || model,
        latency_ms: totalMs,
        claude_latency_ms: claudeMs,
        input_tokens: resp.usage.input_tokens,
        output_tokens: resp.usage.output_tokens,
        estimated_cost_usd: cost.estimated_cost_usd,
        omega_registry_count: omegaSnap && omegaSnap.omega_registry ? (omegaSnap.omega_registry.records || []).length : 0,
        reference_field_count: refFieldSnap && refFieldSnap.reference_fields ? (refFieldSnap.reference_fields.fields || []).length : 0,
        fce_metrics_detail: fceMetricsDetail || null,
        timestamp: new Date().toISOString(),
    };
}

// ---------------------------------------------------------------------------
// Phase orchestrator
// ---------------------------------------------------------------------------

async function runPhase({
    anthropic,
    phaseId,
    runId,
    threadId,
    memoryUrl,
    env,
    artifactStreams,
    registry,
    turnDelayMs,
}) {
    const phase = STRUCTURAL_IDENTITY_PHASES[phaseId];
    if (!phase) throw new Error(`runPhase: unknown phase id ${phaseId}`);
    const turns = [];
    for (let i = 0; i < phase.prompts.length; i++) {
        const { text: promptText, targets_node_id } = phase.prompts[i];
        let turn;
        try {
            turn = await runOneTurn({
                anthropic,
                model: DEFAULT_MODEL,
                memoryUrl,
                threadId,
                runId,
                phaseId,
                turnIndex: i,
                promptText,
                targetsNodeId: targets_node_id || null,
                env,
            });
        } catch (e) {
            const failure = {
                turn_id: `${runId}:${phaseId}:turn-${String(i).padStart(3, "0")}`,
                run_id: runId,
                phase_id: phaseId,
                turn_index: i,
                error: e.message,
                timestamp: new Date().toISOString(),
            };
            await artifactStreams.turns.write(failure);
            return { phase_id: phaseId, turns_completed: i, error: e.message };
        }
        turns.push(turn);
        await artifactStreams.turns.write(turn);
        if (turn.fce_metrics_detail) {
            await artifactStreams.fceTelemetry.write({
                run_id: runId,
                phase_id: phaseId,
                turn_index: i,
                turn_id: turn.turn_id,
                fce_metrics_detail: turn.fce_metrics_detail,
            });
        }
        // Classify against every seed and update the registry. The
        // `targets_node_id` is passed through so adversarial / derivative
        // accounting only credits the node the prompt actually targets.
        const observations = registry.observeTurn({
            phase_id: phaseId,
            scenario_context: targets_node_id || phaseId,
            prompt: promptText,
            response: turn.claude_response,
            targets_node_id: targets_node_id || null,
        });
        await artifactStreams.classifications.write({
            run_id: runId,
            phase_id: phaseId,
            turn_index: i,
            turn_id: turn.turn_id,
            targets_node_id: targets_node_id || null,
            observations,
        });
        if (turnDelayMs && turnDelayMs > 0 && i < phase.prompts.length - 1) {
            await _sleep(turnDelayMs);
        }
    }
    return { phase_id: phaseId, turns_completed: turns.length, error: null, turns };
}

// ---------------------------------------------------------------------------
// Report rendering (markdown)
// ---------------------------------------------------------------------------

function fmtPct(num) {
    if (num === null || num === undefined) return "—";
    return `${(num * 100).toFixed(1)}%`;
}

function renderMarkdown(summary) {
    const lines = [];
    lines.push("# Level 3 Structural Identity Runner — Report");
    lines.push("");
    lines.push(
        "> ADVISORY ONLY. Research artifact. Does NOT declare Level 3, " +
            "does NOT create OmegaRecord manually, does NOT write to " +
            "OmegaRegistry, does NOT create ReferenceField. " +
            "`theta_s = 0.28` and `tau_coag = 12` unchanged.",
    );
    lines.push("");
    lines.push(`- Schema: \`${summary.schema_version}\``);
    lines.push(`- Branch: \`${summary.branch}\``);
    lines.push(`- Run id: \`${summary.run_id}\``);
    lines.push(`- Generated at: ${summary.generated_at}`);
    lines.push(`- Dry run: **${summary.dry_run}**`);
    lines.push(`- Claude model: \`${summary.model_id || "—"}\``);
    lines.push(`- Memory service: \`${summary.memory_url}\``);
    lines.push("");
    lines.push("## Preflight");
    lines.push("");
    const pf = summary.preflight;
    lines.push(`- Level 3 flag: **${pf.flag}**`);
    lines.push(`- Claude API key present: **${pf.claude.present}**`);
    lines.push(`- memory-service live: **${pf.memory_service.live}**`);
    lines.push(`- FAISS live: **${pf.faiss.faiss_live}**`);
    lines.push(`- Production embeddings live: **${pf.faiss.embeddings_live}** (class=\`${pf.faiss.embedder_class || "—"}\` name=\`${pf.faiss.embedder_name || "—"}\` dim=\`${pf.faiss.embedding_dim || "—"}\`)`);
    lines.push(`- FCE-M live: **${pf.fcem.fce_live}**`);
    lines.push(`- FCE metrics exposed (preflight): **${!!(pf.fce_metrics_detail && pf.fce_metrics_detail.fce_metrics_exposed)}**`);
    lines.push("");
    lines.push("## Run summary");
    lines.push("");
    lines.push(`- Phases run: \`${(summary.phases_run || []).join(", ") || "—"}\``);
    lines.push(`- Total turns: ${summary.total_turns}`);
    lines.push(`- Total live Claude calls: ${summary.total_claude_calls}`);
    lines.push(`- Total input tokens: ${summary.total_input_tokens}`);
    lines.push(`- Total output tokens: ${summary.total_output_tokens}`);
    lines.push(`- Total estimated cost USD: \`${(summary.total_estimated_cost_usd || 0).toFixed(6)}\``);
    lines.push(`- Mean Claude latency (ms): \`${(summary.mean_claude_latency_ms ?? 0).toFixed?.(1) || "—"}\``);
    lines.push("");
    lines.push("## Per-phase completion");
    lines.push("");
    lines.push("| Phase | Turns completed | Error |");
    lines.push("|---|---:|---|");
    for (const r of summary.phase_results) {
        lines.push(`| ${r.phase_id} | ${r.turns_completed} | ${r.error || "—"} |`);
    }
    lines.push("");
    lines.push("## Per-node assimilation");
    lines.push("");
    lines.push(
        "| node | origin | activations | contexts | spontaneous | adversarial pass | derivatives | state |",
    );
    lines.push("|---|---|---:|---:|---:|---:|---:|---|");
    for (const n of summary.field_snapshot.nodes) {
        lines.push(
            `| \`${n.id}\` | \`${n.origin}\` | ${n.activation_count} | ${n.cross_context_reuse} ` +
                `| ${n.spontaneous_activation_count} | ${n.adversarial_resistance_passes}/${n.adversarial_tests_attempted} ` +
                `| ${n.derivative_candidates_count} | **${n.assimilation_state}** |`,
        );
    }
    lines.push("");
    lines.push("### Per-node titles");
    lines.push("");
    for (const n of summary.field_snapshot.nodes) {
        lines.push(`- \`${n.id}\` — ${n.title}`);
    }
    lines.push("");
    const fs = summary.field_snapshot.field_summary;
    lines.push("## Field summary");
    lines.push("");
    lines.push(`- Nodes: ${fs.n_nodes}`);
    lines.push(`- Total activations: ${fs.total_activations}`);
    lines.push(`- Adversarial resistance: ${fs.total_adversarial_passed}/${fs.total_adversarial_attempted} (${fmtPct(fs.adversarial_resistance_rate)})`);
    lines.push(`- Spontaneous activations: ${fs.total_spontaneous_activations}`);
    lines.push(`- Derivative candidates: ${fs.total_derivative_candidates}`);
    lines.push(`- Compliance violations: ${fs.total_compliance_violations}`);
    lines.push("");
    lines.push("### State counts");
    lines.push("");
    for (const state of ASSIMILATION_STATES) {
        const count = fs.state_counts[state] || 0;
        lines.push(`- ${state}: ${count}`);
    }
    lines.push("");
    lines.push("## Final verdict");
    lines.push("");
    lines.push(`**\`${summary.final_verdict}\`**`);
    lines.push("");
    lines.push(`Suffix verdict: **\`FULL_LEVEL3_NOT_DECLARED\`**`);
    lines.push("");
    lines.push(summary.verdict_legend[summary.final_verdict] || "");
    lines.push("");
    lines.push("## Confirmations");
    lines.push("");
    lines.push("- Level 3 is **NOT declared**.");
    lines.push(`- \`theta_s = ${THETA_S}\` unchanged.`);
    lines.push(`- \`tau_coag = ${TAU_COAG}\` unchanged.`);
    lines.push("- No manual OmegaRegistry write.");
    lines.push("- No OmegaRecord constructor call.");
    lines.push("- No ReferenceField constructor call.");
    lines.push("- No `agent.check_coagulation` call.");
    lines.push("- No omega-anchor identifier.");
    lines.push("- Operator-seeded nodes are NOT promoted to endogenous Omega.");
    lines.push("- All experiment writes carry `is_level3_experiment=true`, `run_id`, `thread_id`.");
    lines.push("");
    return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Verdict legend
// ---------------------------------------------------------------------------

const VERDICT_LEGEND = Object.freeze({
    STRUCTURAL_SEEDING_COMPLETED:
        "Phase 0 completed. Reinforcement / autonomous / adversarial / " +
        "derivative phases did not run or did not produce activations.",
    STRUCTURAL_REFERENCE_SEEDING_ONLY:
        "Seeds entered memory but later phases did not produce " +
        "consistent activation across contexts. Treat as seeding only.",
    STRUCTURAL_REFERENCE_RECALL_CONFIRMED:
        "At least one seed was invoked correctly when asked directly " +
        "(Phase 1). Recall confirmed; application not yet observed.",
    STRUCTURAL_REFERENCE_APPLICATION_CONFIRMED:
        "At least one seed was applied across multiple contexts, " +
        "including ambiguous prompts where the rule was not explicit " +
        "(Phase 2).",
    STRUCTURAL_REFERENCE_ASSIMILATION_OBSERVED:
        "At least one seed resisted adversarial stress (Phase 3) " +
        "without violation. Assimilation observed for that seed.",
    STRUCTURAL_IDENTITY_FIELD_FORMING:
        "Most seeds reached structural-identity-node state. The " +
        "structural identity field is forming. Still not a Level 3 " +
        "declaration.",
    ENDOGENOUS_DERIVATIVE_CANDIDATES_OBSERVED:
        "At least one node has Phase 4 derivative candidates AND the " +
        "lower-tier conditions are met. Operator-seeded origin remains " +
        "operator_seeded; STATE advances to endogenous_derivative_candidate. " +
        "NOT endogenous Omega — only FCE-M's check_coagulation can " +
        "confirm Omega.",
    FULL_LEVEL3_NOT_DECLARED:
        "Suffix verdict appended to every run. Level 3 is not declared.",
    INCONCLUSIVE_NEEDS_LONGER_RUN:
        "Telemetry insufficient to decide. Run more phases or more " +
        "turns.",
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2), env = process.env) {
    const args = parseArgs(argv);
    if (args.help) {
        process.stdout.write(
            "Usage: node scripts/level3-structural-identity-runner.mjs [--dry-run] [--turn-delay-ms n] [--output-dir path] [--run-id id] [--phases p0,p1,...] [--report-cost]\n",
        );
        return 0;
    }
    if (!isLevel3FullOrganismExperimentEnabled(env)) {
        process.stderr.write(
            `${LEVEL3_FLAG_NAME}=true required. Default OFF; runner refusing.\n`,
        );
        return 2;
    }

    const runId =
        args.runId ||
        `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
    const outputDir = args.outputDir;
    const runDir = path.join(outputDir, runId);
    await fsp.mkdir(runDir, { recursive: true });
    const memoryUrl = env.MEMORY_SERVICE_URL || DEFAULT_MEMORY_URL;
    const phasesToRun = args.phases && args.phases.length > 0 ? args.phases : PHASE_IDS.slice();

    // Pre-flight + write run-config.
    const requireClaude = !args.dryRun;
    const pf = await preflight({ requireClaude, env, memoryUrl });
    const runConfig = {
        schema_version: RUNNER_SCHEMA_VERSION,
        run_id: runId,
        branch: "research/level3-full-organism-runtime",
        is_level3_experiment: true,
        dry_run: args.dryRun,
        memory_url: memoryUrl,
        phases_requested: phasesToRun,
        theta_s: THETA_S,
        tau_coag: TAU_COAG,
        preflight: pf,
        n_seeds: STRUCTURAL_SEEDS.length,
        admitted_origins: NODE_ORIGINS,
        admitted_states: ASSIMILATION_STATES,
        allowed_verdicts: ALLOWED_VERDICTS,
        forbidden_verdict_tokens: FORBIDDEN_VERDICT_TOKENS,
        generated_at: new Date().toISOString(),
    };
    await fsp.writeFile(path.join(runDir, "run-config.json"), JSON.stringify(runConfig, null, 2) + "\n");

    // Artifact streams.
    const artifactStreams = {
        turns: await openJsonlStream(path.join(runDir, "turns.jsonl")),
        fceTelemetry: await openJsonlStream(path.join(runDir, "fce-telemetry.jsonl")),
        classifications: await openJsonlStream(path.join(runDir, "classifications.jsonl")),
    };

    // Construct registry with all operator seeds.
    const registry = new StructuralReferenceRegistry({
        run_id: runId,
        nodes: STRUCTURAL_SEEDS,
    });

    // Dry-run path: produce an empty report based on preflight only.
    if (args.dryRun) {
        const summary = {
            schema_version: RUNNER_SCHEMA_VERSION,
            branch: "research/level3-full-organism-runtime",
            run_id: runId,
            generated_at: new Date().toISOString(),
            dry_run: true,
            model_id: null,
            memory_url: memoryUrl,
            preflight: pf,
            phases_run: [],
            phase_results: [],
            total_turns: 0,
            total_claude_calls: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_estimated_cost_usd: 0,
            mean_claude_latency_ms: null,
            field_snapshot: registry.finalize(),
            phases_completed_map: {},
            final_verdict: "INCONCLUSIVE_NEEDS_LONGER_RUN",
            verdict_legend: VERDICT_LEGEND,
            allowed_verdicts: ALLOWED_VERDICTS,
            forbidden_verdict_tokens: FORBIDDEN_VERDICT_TOKENS,
            note: "dry-run; no Claude API calls were made; no memory writes were made",
        };
        await fsp.writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
        await fsp.writeFile(path.join(runDir, "report.md"), renderMarkdown(summary));
        await Promise.all(Object.values(artifactStreams).map((s) => s.close()));
        process.stdout.write(`[dry-run] wrote ${path.join(runDir, "summary.json")}\n`);
        return 0;
    }

    if (!pf.claude.present) {
        // Verdict still has to be from the admitted set; surface
        // INCONCLUSIVE_NEEDS_LONGER_RUN and let the report explain.
        const summary = {
            schema_version: RUNNER_SCHEMA_VERSION,
            branch: "research/level3-full-organism-runtime",
            run_id: runId,
            generated_at: new Date().toISOString(),
            dry_run: false,
            preflight: pf,
            phases_run: [],
            phase_results: [],
            total_turns: 0,
            total_claude_calls: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_estimated_cost_usd: 0,
            mean_claude_latency_ms: null,
            field_snapshot: registry.finalize(),
            phases_completed_map: {},
            final_verdict: "INCONCLUSIVE_NEEDS_LONGER_RUN",
            verdict_legend: VERDICT_LEGEND,
            allowed_verdicts: ALLOWED_VERDICTS,
            forbidden_verdict_tokens: FORBIDDEN_VERDICT_TOKENS,
            note: "ANTHROPIC_API_KEY missing; runner cannot execute live phases",
        };
        await fsp.writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
        await fsp.writeFile(path.join(runDir, "report.md"), renderMarkdown(summary));
        await Promise.all(Object.values(artifactStreams).map((s) => s.close()));
        process.stderr.write("ANTHROPIC_API_KEY missing; runner emitted INCONCLUSIVE_NEEDS_LONGER_RUN.\n");
        return 3;
    }

    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    // Single thread shared across phases so the conversation is
    // contiguous from BYON's POV.
    const threadId = `level3_full_organism_${runId}__structural_identity`;

    const phaseResults = [];
    const phasesCompleted = {};
    let totalTurns = 0;
    let totalInTokens = 0;
    let totalOutTokens = 0;
    let totalCost = 0;
    let latencies = [];
    let modelId = null;
    for (const phaseId of phasesToRun) {
        const pr = await runPhase({
            anthropic,
            phaseId,
            runId,
            threadId,
            memoryUrl,
            env,
            artifactStreams,
            registry,
            turnDelayMs: args.turnDelayMs,
        });
        phaseResults.push({
            phase_id: pr.phase_id,
            turns_completed: pr.turns_completed,
            error: pr.error,
        });
        if (!pr.error && pr.turns_completed > 0) {
            phasesCompleted[pr.phase_id] = true;
            for (const t of pr.turns || []) {
                totalTurns += 1;
                totalInTokens += t.input_tokens || 0;
                totalOutTokens += t.output_tokens || 0;
                totalCost += t.estimated_cost_usd || 0;
                if (typeof t.claude_latency_ms === "number") latencies.push(t.claude_latency_ms);
                if (!modelId && t.model_id) modelId = t.model_id;
            }
        }
        if (pr.error) {
            process.stderr.write(`[phase ${pr.phase_id}] aborted: ${pr.error}\n`);
            break;
        }
    }

    const fieldSnapshot = registry.finalize();
    const finalVerdict = deriveStructuralVerdict({
        finalSnapshot: fieldSnapshot,
        phasesCompleted,
    });

    // Sanity: verdict must be admitted; verdict must not be a forbidden
    // standalone token; required suffix `FULL_LEVEL3_NOT_DECLARED` is
    // emitted as a separate field in the summary so the operator never
    // sees a final verdict alone without the "no Level 3" note.
    if (!ALLOWED_VERDICTS.includes(finalVerdict)) {
        process.stderr.write(`WARNING: verdict ${finalVerdict} not in ALLOWED_VERDICTS; aborting write\n`);
        return 4;
    }
    if (containsForbiddenVerdictToken(finalVerdict)) {
        process.stderr.write(`WARNING: verdict contains forbidden token; aborting write\n`);
        return 4;
    }

    const summary = {
        schema_version: RUNNER_SCHEMA_VERSION,
        branch: "research/level3-full-organism-runtime",
        run_id: runId,
        generated_at: new Date().toISOString(),
        dry_run: false,
        model_id: modelId || DEFAULT_MODEL,
        memory_url: memoryUrl,
        preflight: pf,
        phases_run: phasesToRun.filter((p) => !!phasesCompleted[p]),
        phase_results: phaseResults,
        total_turns: totalTurns,
        total_claude_calls: totalTurns,
        total_input_tokens: totalInTokens,
        total_output_tokens: totalOutTokens,
        total_estimated_cost_usd: totalCost,
        mean_claude_latency_ms: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
        field_snapshot: fieldSnapshot,
        phases_completed_map: phasesCompleted,
        final_verdict: finalVerdict,
        suffix_verdict: "FULL_LEVEL3_NOT_DECLARED",
        level_3_declared: false,
        natural_omega_proven: false,
        operator_seeded_promoted_to_endogenous: false,
        verdict_legend: VERDICT_LEGEND,
        allowed_verdicts: ALLOWED_VERDICTS,
        forbidden_verdict_tokens: FORBIDDEN_VERDICT_TOKENS,
    };
    await fsp.writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    await fsp.writeFile(path.join(runDir, "report.md"), renderMarkdown(summary));
    await Promise.all(Object.values(artifactStreams).map((s) => s.close()));
    process.stdout.write(`final verdict: ${finalVerdict}\n`);
    process.stdout.write(`suffix verdict: FULL_LEVEL3_NOT_DECLARED\n`);
    process.stdout.write(`artifacts: ${runDir}\n`);
    if (args.reportCost) {
        process.stdout.write(`total estimated cost USD: ${totalCost.toFixed(6)}\n`);
    }
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    main().then((code) => process.exit(code)).catch((e) => {
        process.stderr.write(`FATAL: ${e.stack || e.message}\n`);
        process.exit(1);
    });
}
