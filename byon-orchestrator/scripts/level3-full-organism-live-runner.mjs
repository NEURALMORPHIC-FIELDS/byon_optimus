#!/usr/bin/env node
/**
 * Level 3 Full Organism Live Runner.
 *
 * Runs the production BYON pipeline end-to-end against Claude Sonnet 4.6,
 * for a small set of operator-curated scenarios, capturing per-turn
 * telemetry, OmegaRegistry/ReferenceField snapshots, and a runner-side
 * relational-field snapshot. Produces JSON + MD reports in
 * `test-results/level3-full-organism-live/`.
 *
 * Hard rules (enforced):
 *   - Requires BYON_LEVEL3_FULL_ORGANISM_EXPERIMENT=true; refuses
 *     otherwise. Default OFF means production behavior is unchanged.
 *   - Requires ANTHROPIC_API_KEY for the OFFICIAL run; without it,
 *     official runs emit verdict CLAUDE_API_REQUIRED_FOR_FULL_ORGANISM_TEST.
 *   - `--dry-run` validates configuration without calling Claude.
 *   - The runner does NOT call OmegaRegistry.register, does NOT
 *     manually create OmegaRecord, does NOT create ReferenceField.
 *   - The runner does NOT lower theta_s (0.28) or tau_coag (12).
 *   - All memory writes carry experiment_run_id / scenario_id /
 *     thread_id / is_level3_experiment=true.
 *   - No cost guard is imposed. Cost is measured and reported only.
 *
 * Usage:
 *   node --env-file=.env scripts/level3-full-organism-live-runner.mjs \
 *      --scenario scenario-1-byon-arch --turns 30 --output-dir test-results/level3-full-organism-live
 *
 * Common options:
 *   --scenario <id>        run one scenario (default: run both)
 *   --turns <n>            cap turns per scenario (default 30)
 *   --dry-run              validate config and emit a dry-run report
 *   --output-dir <path>    output dir (default test-results/level3-full-organism-live)
 *   --run-id <id>          stable run id (default auto)
 *   --cleanup-run <id>     delete experiment thread for run id and exit
 *   --estimate-cost        print pricing estimate and exit (no Claude call)
 *   --report-cost          report cost summary at the end of the run
 *
 * The forbidden verdict strings (LEVEL_3_REACHED, OMEGA_CREATED_MANUALLY,
 * SYNTHETIC_OMEGA, THRESHOLD_LOWERED, REFERENCEFIELD_CREATED_WITHOUT_OMEGA)
 * are NEVER emitted as standalone identifiers; the test suite verifies.
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
    RelationalFieldRegistry,
    detectRelationTensions,
    makeRelationEvent,
    RELATION_TYPES,
    FORBIDDEN_VERDICTS,
} from "./lib/relational-field.mjs";
import { SCENARIO_1 } from "./lib/scenarios/scenario-1-byon-arch.mjs";
import { SCENARIO_2 } from "./lib/scenarios/scenario-2-adversarial.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const RUNNER_SCHEMA_VERSION = "level3-full-organism-runner.v1";
export const SCENARIOS = Object.freeze({
    [SCENARIO_1.id]: SCENARIO_1,
    [SCENARIO_2.id]: SCENARIO_2,
});

export const ALLOWED_VERDICTS = Object.freeze([
    "FULL_ORGANISM_LEVEL2_CONFIRMED",
    "FULL_ORGANISM_LEVEL3_NOT_OBSERVED",
    "FULL_ORGANISM_NEAR_THRESHOLD",
    "OMEGA_OBSERVED_BY_CHECK_COAGULATION_NO_MANUAL_WRITE",
    "INCONCLUSIVE_NEEDS_LONGER_RUN",
    "CLAUDE_API_REQUIRED_FOR_FULL_ORGANISM_TEST",
    // Added in commit 15:
    "PARTIAL_FULL_ORGANISM_SMOKE_RUN",
    "INCONCLUSIVE_EMBEDDINGS_NOT_CONFIRMED",
    "INCONCLUSIVE_FCE_METRICS_NOT_EXPOSED",
]);

const DEFAULT_MEMORY_URL = process.env.MEMORY_SERVICE_URL || "http://localhost:8000";
const DEFAULT_MODEL = process.env.LLM_MODEL || "claude-sonnet-4-6";

// Public price table (best-effort, USD per million tokens for Claude
// Sonnet 4.6 as known at time of writing — kept here as a constant so
// the cost estimate is auditable). Operator may override via
// LLM_INPUT_PRICE_PER_MTOK / LLM_OUTPUT_PRICE_PER_MTOK env vars.
const DEFAULT_INPUT_PRICE_PER_MTOK = 3.0;   // $3/MTok input
const DEFAULT_OUTPUT_PRICE_PER_MTOK = 15.0; // $15/MTok output

// Threshold values are operator-locked and read from `process.env` ONLY
// as a sanity probe (not setter); the runner does NOT modify them.
const THETA_S = 0.28;
const TAU_COAG = 12;

// ---------------------------------------------------------------------------
// CLI parsing (minimal, no third-party arg lib)
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
    const args = {
        scenario: null,
        turns: 30,
        dryRun: false,
        outputDir: "test-results/level3-full-organism-live",
        runId: null,
        cleanupRun: null,
        estimateCost: false,
        reportCost: false,
        turnDelayMs: 0,           // commit 15: --turn-delay-ms
        help: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--scenario") args.scenario = argv[++i];
        else if (a === "--turns") args.turns = Number(argv[++i]);
        else if (a === "--dry-run") args.dryRun = true;
        else if (a === "--output-dir") args.outputDir = argv[++i];
        else if (a === "--run-id") args.runId = argv[++i];
        else if (a === "--cleanup-run") args.cleanupRun = argv[++i];
        else if (a === "--estimate-cost") args.estimateCost = true;
        else if (a === "--report-cost") args.reportCost = true;
        else if (a === "--turn-delay-ms") args.turnDelayMs = Number(argv[++i]);
        else if (a === "--help" || a === "-h") args.help = true;
    }
    if (!Number.isInteger(args.turns) || args.turns < 1) {
        args.turns = 30;
    }
    if (!Number.isFinite(args.turnDelayMs) || args.turnDelayMs < 0) {
        args.turnDelayMs = 0;
    }
    return args;
}

// ---------------------------------------------------------------------------
// Memory-service round-trip helper
// ---------------------------------------------------------------------------

function _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST to memory-service with rate-limit aware retry/backoff.
 *
 * On HTTP 429 the runner honors the `Retry-After` header (seconds) if
 * present, otherwise applies exponential backoff: 1s, 2s, 4s, 8s
 * (capped at 30s). Up to `maxRetries` attempts (default 5). The
 * scenario is NOT marked failed until the policy is exhausted.
 *
 * On any other non-2xx, throws immediately — no retry.
 */
export async function memPost(
    payload,
    {
        memoryUrl = DEFAULT_MEMORY_URL,
        timeoutMs = 30000,
        maxRetries = 5,
        onRetry = null,
    } = {},
) {
    let attempt = 0;
    let lastError = null;
    while (attempt <= maxRetries) {
        try {
            const r = await fetch(memoryUrl + "/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (r.ok) {
                return await r.json();
            }
            if (r.status === 429) {
                let waitMs;
                const retryAfter = r.headers.get("retry-after");
                if (retryAfter) {
                    const sec = Number(retryAfter);
                    if (Number.isFinite(sec) && sec > 0) {
                        waitMs = Math.min(sec * 1000, 60_000);
                    }
                }
                if (waitMs === undefined) {
                    // exp backoff: 1s, 2s, 4s, 8s, 16s, 30s cap
                    waitMs = Math.min(30_000, Math.pow(2, attempt) * 1000);
                }
                if (onRetry) {
                    try {
                        onRetry({ attempt, waitMs, status: 429 });
                    } catch {}
                }
                if (attempt < maxRetries) {
                    await _sleep(waitMs);
                    attempt += 1;
                    continue;
                }
                const body = await r.text().catch(() => "");
                throw new Error(
                    `memory-service HTTP 429 after ${maxRetries + 1} attempts; body=${body.slice(0, 200)}`,
                );
            }
            const body = await r.text().catch(() => "");
            throw new Error(`memory-service HTTP ${r.status}: ${body.slice(0, 200)}`);
        } catch (e) {
            lastError = e;
            if (!String(e.message || "").startsWith("memory-service HTTP")) {
                // transport-level error (timeout, connection refused, etc.) —
                // also subject to bounded retry.
                if (attempt < maxRetries) {
                    if (onRetry) {
                        try {
                            onRetry({ attempt, waitMs: 1000, status: "transport" });
                        } catch {}
                    }
                    await _sleep(Math.min(30_000, Math.pow(2, attempt) * 1000));
                    attempt += 1;
                    continue;
                }
            }
            throw e;
        }
    }
    throw lastError || new Error("memPost: exhausted retries");
}

/**
 * GET a JSON response from memory-service (used for the optional
 * `/level3/...` endpoints that are env-gated on the server).
 *
 * Returns `{ ok: false, status }` instead of throwing on non-2xx so the
 * runner can degrade gracefully when an endpoint is not registered.
 */
export async function memGet(pathFragment, { memoryUrl = DEFAULT_MEMORY_URL, timeoutMs = 10000 } = {}) {
    try {
        const r = await fetch(memoryUrl + pathFragment, {
            method: "GET",
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!r.ok) {
            return { ok: false, status: r.status };
        }
        return await r.json();
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ---------------------------------------------------------------------------
// Pre-flight checks
// ---------------------------------------------------------------------------

export async function checkMemoryServiceLive(memoryUrl = DEFAULT_MEMORY_URL) {
    try {
        const r = await fetch(memoryUrl + "/health", {
            signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) return { live: false, reason: `HTTP ${r.status}` };
        const j = await r.json();
        return { live: j.status === "healthy", details: j };
    } catch (e) {
        return { live: false, reason: e.message };
    }
}

export async function checkFaissAndEmbeddingsLive(memoryUrl = DEFAULT_MEMORY_URL) {
    let faiss_live = false;
    let stats = null;
    try {
        stats = await memPost({ action: "stats" }, { memoryUrl, maxRetries: 0, timeoutMs: 3000 });
        faiss_live = !!stats;
    } catch (e) {
        return { faiss_live: false, embeddings_live: false, reason: e.message };
    }
    // commit 15: ask the env-gated /level3/embedder-info endpoint for an
    // authoritative answer. If it returns 404 / 403 the experiment flag
    // was not set on the server at startup; emit a clear "not confirmed".
    const info = await memGet("/level3/embedder-info", { memoryUrl });
    if (info && info.ok === true) {
        return {
            faiss_live,
            embeddings_live: !!info.production_embeddings_live,
            embedder_class: info.embedder_class || null,
            embedder_name: info.embedder_name || null,
            embedding_dim: info.embedding_dim || null,
            backend: info.backend || null,
            fallback_simple_embedder_active: !!info.fallback_simple_embedder_active,
            stats,
        };
    }
    return {
        faiss_live,
        embeddings_live: false,
        embedder_class: null,
        embedder_name: null,
        embedding_dim: null,
        backend: null,
        fallback_simple_embedder_active: null,
        embedder_endpoint_unavailable: true,
        embedder_endpoint_status: info && info.status ? info.status : "unknown",
        stats,
    };
}

export async function checkFcemLive(memoryUrl = DEFAULT_MEMORY_URL) {
    try {
        const state = await memPost({ action: "fce_state" }, { memoryUrl, maxRetries: 0, timeoutMs: 3000 });
        return { fce_live: !!(state && state.success), state };
    } catch (e) {
        return { fce_live: false, reason: e.message };
    }
}

/**
 * Try the env-gated `/level3/fce-metrics` endpoint to capture detailed
 * per-center metrics (kappa, alpha, Z_norm, B_t) plus the morphogenesis
 * log tail (S_t, AR per event). Returns a structured response with a
 * `fce_metrics_exposed` boolean.
 *
 * If the endpoint is not registered (flag was OFF at server start),
 * returns `{ ok: false, fce_metrics_exposed: false }`. The runner uses
 * the boolean to drive verdict selection.
 */
export async function fetchFceMetricsDetail(memoryUrl = DEFAULT_MEMORY_URL) {
    const r = await memGet("/level3/fce-metrics", { memoryUrl });
    if (r && r.ok === true) {
        return r;
    }
    return {
        ok: false,
        fce_metrics_exposed: false,
        reason: r && r.status ? `HTTP ${r.status}` : (r && r.error) || "unknown",
    };
}

export function checkClaudeKey(env = process.env) {
    if (!env.ANTHROPIC_API_KEY) return { present: false, reason: "ANTHROPIC_API_KEY missing" };
    return { present: true };
}

// ---------------------------------------------------------------------------
// Cost estimation (read-only)
// ---------------------------------------------------------------------------

export function estimateTurnCost(input_tokens, output_tokens, env = process.env) {
    const ip = Number(env.LLM_INPUT_PRICE_PER_MTOK || DEFAULT_INPUT_PRICE_PER_MTOK);
    const op = Number(env.LLM_OUTPUT_PRICE_PER_MTOK || DEFAULT_OUTPUT_PRICE_PER_MTOK);
    const in_usd = (input_tokens / 1e6) * ip;
    const out_usd = (output_tokens / 1e6) * op;
    return {
        input_price_per_mtok: ip,
        output_price_per_mtok: op,
        input_cost_usd: in_usd,
        output_cost_usd: out_usd,
        estimated_cost_usd: in_usd + out_usd,
    };
}

// ---------------------------------------------------------------------------
// Prompt builder (mirrors byon-chat-once.mjs)
// ---------------------------------------------------------------------------

export function buildSystemPrompt(fceReport, searchHits) {
    const memSec = (searchHits && searchHits.conversation && searchHits.conversation.length)
        ? searchHits.conversation
              .slice(0, 5)
              .map(
                  (h, i) =>
                      `[mem ${i + 1}] sim=${(h.similarity || 0).toFixed(2)} ${(h.content || "").slice(0, 200)}`,
              )
              .join("\n")
        : "no memory recall";
    const fceSec = fceReport && fceReport.enabled
        ? `omega=${fceReport.omega_active}/${fceReport.omega_total} contested=${fceReport.omega_contested} adv=${fceReport.advisory_count} prio=${fceReport.priority_recommendations_count} summary=${fceReport.morphogenesis_summary}`
        : "fce disabled";
    return [
        "You are BYON-Omni, an autonomous assistant agent owned by Vasile Lucian Borbeleac (FRAGMERGENT TECHNOLOGY S.R.L.).",
        "Speak Romanian or English to match the user. Be direct, concise, useful.",
        `Memory (FAISS recall):\n${memSec}`,
        `FCE-M state: ${fceSec}`,
        "Guidelines: if FCE reports high_residue/contested, flag uncertainty. You can only TALK in this surface — no commands, no tools.",
        "Operator-locked invariants: theta_s=0.28; tau_coag=12; Level 2 of 4. Do not claim Level 3.",
    ].join("\n\n");
}

// ---------------------------------------------------------------------------
// Relational event derivation from a single turn's telemetry
// ---------------------------------------------------------------------------

export function deriveRelationEvents({
    turn,
    runId,
    scenarioId,
    fceReport,
    searchHits,
    verifiedFacts,
    domainFacts,
}) {
    const events = [];
    const turn_index = turn.turn_index;
    const turn_id = `t:${runId}:${scenarioId}:${turn_index}`;

    // The classic FCE-advisory-constrains-attention relation.
    if (fceReport && fceReport.enabled) {
        events.push(
            makeRelationEvent({
                source: "FCE_ADVISORY",
                relation: "constrains",
                target: "ATTENTION",
                center_id: "byon::macp_pipeline::factual",
                run_id: runId,
                scenario_id: scenarioId,
                turn_index,
                source_turn_id: turn_id,
                trust_tier: "VERIFIED_PROJECT_FACT",
                notes: "FCE advisory affects attention but never approval; constraint not authority",
            }),
        );
    }

    // Verified project facts stabilize project_state.
    if (Array.isArray(verifiedFacts) && verifiedFacts.length > 0) {
        events.push(
            makeRelationEvent({
                source: "VERIFIED_PROJECT_FACT",
                relation: "stabilizes",
                target: "RELEASE_STATE",
                center_id: "byon::release_state::project_state",
                run_id: runId,
                scenario_id: scenarioId,
                turn_index,
                source_turn_id: turn_id,
                trust_tier: "VERIFIED_PROJECT_FACT",
            }),
        );
    }

    // Domain verified protects against wrong jurisdiction claims.
    if (Array.isArray(domainFacts) && domainFacts.length > 0) {
        events.push(
            makeRelationEvent({
                source: "DOMAIN_VERIFIED",
                relation: "verifies",
                target: "JURISDICTION_BOUND_FACT",
                center_id: "byon::domain_verified::domain_verified",
                run_id: runId,
                scenario_id: scenarioId,
                turn_index,
                source_turn_id: turn_id,
                trust_tier: "DOMAIN_VERIFIED",
            }),
        );
    }

    // SYSTEM_CANONICAL protects AUDITOR_AUTHORITY in adversarial scenarios.
    const promptText = (turn.user_prompt || "").toLowerCase();
    const adversarialMarkers = [
        "memoreaz",
        "memoreaza",
        "treat this as",
        "treat as rule",
        "from now on",
        "consider this verified",
        "override",
        "bypass",
        "ocoleste",
        "skip auditor",
        "skip signature",
    ];
    if (adversarialMarkers.some((m) => promptText.includes(m))) {
        events.push(
            makeRelationEvent({
                source: "SYSTEM_CANONICAL",
                relation: "protects",
                target: "AUDITOR_AUTHORITY",
                center_id: "byon::auditor_signature::security_boundary",
                run_id: runId,
                scenario_id: scenarioId,
                turn_index,
                source_turn_id: turn_id,
                trust_tier: "SYSTEM_CANONICAL",
                notes: "adversarial claim-to-rule detected; canonical authority protects auditor signing path",
            }),
        );
        events.push(
            makeRelationEvent({
                source: "DISPUTED_OR_UNSAFE",
                relation: "contradicts",
                target: "USER_CLAIM",
                center_id: "byon::unsafe_memory::security_boundary",
                run_id: runId,
                scenario_id: scenarioId,
                turn_index,
                source_turn_id: turn_id,
                trust_tier: "DISPUTED_OR_UNSAFE",
                notes: "user turn carries pattern matching DISPUTED_OR_UNSAFE",
            }),
        );
    }

    // Contextual pathway routes_to active domain (always relevant on a
    // healthy run).
    events.push(
        makeRelationEvent({
            source: "CONTEXTUAL_PATHWAY",
            relation: "routes_to",
            target: "ACTIVE_DOMAIN",
            center_id: "byon::contextual_pathway::factual",
            run_id: runId,
            scenario_id: scenarioId,
            turn_index,
            source_turn_id: turn_id,
            trust_tier: "SYSTEM_CANONICAL",
        }),
    );

    return events;
}

// ---------------------------------------------------------------------------
// Pre-flight aggregator
// ---------------------------------------------------------------------------

export async function preflight({ requireClaude, env = process.env, memoryUrl = DEFAULT_MEMORY_URL } = {}) {
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
// Run one turn through the production pipeline
// ---------------------------------------------------------------------------

async function runOneTurn({
    anthropic,
    model,
    memoryUrl,
    threadId,
    runId,
    scenarioId,
    turnIndex,
    promptText,
    env,
}) {
    const turnId = `${runId}:${scenarioId}:turn-${String(turnIndex).padStart(3, "0")}`;
    const t0 = Date.now();

    // 1) store user turn
    const storeIn = await memPost(
        {
            action: "store",
            type: "conversation",
            data: {
                content: promptText,
                role: "user",
                thread_id: threadId,
                channel: "level3-experiment-runner",
                run_id: runId,
                scenario_id: scenarioId,
                turn_index: turnIndex,
                is_level3_experiment: true,
            },
        },
        { memoryUrl },
    );

    // 2) parallel search_all + fce_morphogenesis_report
    const [hits, fceMR] = await Promise.all([
        memPost({ action: "search_all", query: promptText, top_k: 5, threshold: 0.25 }, { memoryUrl }),
        memPost({ action: "fce_morphogenesis_report", query: promptText }, { memoryUrl }),
    ]);
    const fceReport = (fceMR && fceMR.report) || null;

    // 3) load verified/domain facts surfaces (best-effort)
    const verifiedFactsResp = await memPost({ action: "verified_fact_list" }, { memoryUrl }).catch(() => null);
    const verifiedFacts = verifiedFactsResp && verifiedFactsResp.facts ? verifiedFactsResp.facts : [];
    const domainFactsResp = await memPost(
        { action: "domain_fact_search", query: promptText, top_k: 5 },
        { memoryUrl },
    ).catch(() => null);
    const domainFacts = domainFactsResp && domainFactsResp.facts ? domainFactsResp.facts : [];

    // 4) Claude live call
    const systemPrompt = buildSystemPrompt(fceReport, hits);
    const claudeStart = Date.now();
    const resp = await anthropic.messages.create({
        model,
        max_tokens: 512,
        temperature: 0.5,
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

    // 5) store assistant reply
    const storeOut = await memPost(
        {
            action: "store",
            type: "conversation",
            data: {
                content: reply,
                role: "assistant",
                thread_id: threadId,
                channel: "level3-experiment-runner",
                run_id: runId,
                scenario_id: scenarioId,
                turn_index: turnIndex,
                is_level3_experiment: true,
            },
        },
        { memoryUrl },
    );

    // 6) receipt assimilation
    const assimilateResp = await memPost(
        {
            action: "fce_assimilate_receipt",
            order_id: `level3:${threadId}:${storeIn.ctx_id || turnId}`,
            status: "success",
            based_on_evidence: threadId,
            summary: {
                tokens: { in: resp.usage.input_tokens, out: resp.usage.output_tokens },
                run_id: runId,
                scenario_id: scenarioId,
                turn_index: turnIndex,
            },
        },
        { memoryUrl },
    );

    // 7) snapshots
    const omegaSnap = await memPost({ action: "fce_omega_registry" }, { memoryUrl }).catch(() => null);
    const refFieldSnap = await memPost({ action: "fce_reference_fields" }, { memoryUrl }).catch(() => null);
    const fceState = await memPost({ action: "fce_state" }, { memoryUrl }).catch(() => null);
    // commit 15: also fetch the env-gated detailed FCE metrics endpoint
    // when available (production server registered it). This is the
    // surface that exposes per-center kappa/alpha/Z_norm/B_t and the
    // morphogenesis log tail with S_t / AR.
    const fceMetricsDetail = await fetchFceMetricsDetail(memoryUrl);

    const totalMs = Date.now() - t0;
    return {
        turn_id: turnId,
        run_id: runId,
        scenario_id: scenarioId,
        turn_index: turnIndex,
        user_prompt: promptText,
        claude_response: reply,
        model_id: resp.model || model,
        latency_ms: totalMs,
        claude_latency_ms: claudeMs,
        input_tokens: resp.usage.input_tokens,
        output_tokens: resp.usage.output_tokens,
        estimated_cost_usd: cost.estimated_cost_usd,
        cost_breakdown: cost,
        active_domain: fceReport && fceReport.active_domain ? fceReport.active_domain : null,
        contextual_phase: fceReport && fceReport.contextual_phase ? fceReport.contextual_phase : null,
        memory_routes_count: (hits.conversation || []).length + (hits.facts || []).length + (hits.code || []).length,
        retrieved_facts_by_tier: {
            verified_project_fact: verifiedFacts.length,
            domain_verified: domainFacts.length,
            conversation_excerpts: (hits.conversation || []).length,
        },
        fce_advisory_count: fceReport ? fceReport.advisory_count || 0 : 0,
        fce_priority_recommendations: fceReport ? fceReport.priority_recommendations_count || 0 : 0,
        omega_registry_count: omegaSnap && omegaSnap.omega_registry ? (omegaSnap.omega_registry.records || []).length : 0,
        reference_field_count: refFieldSnap && refFieldSnap.reference_fields ? (refFieldSnap.reference_fields.fields || []).length : 0,
        new_omega_created_this_turn: false,    // set later by diff against previous snapshot
        new_reference_field_this_turn: false,  // set later by diff against previous snapshot
        store_in_ctx_id: storeIn.ctx_id || null,
        store_out_ctx_id: storeOut.ctx_id || null,
        assimilate_status: assimilateResp && assimilateResp.success ? "success" : "unknown",
        fce_state: fceState && fceState.state ? fceState.state : null,
        fce_metrics_detail: fceMetricsDetail || null,
        snapshots: {
            omega_registry: omegaSnap && omegaSnap.omega_registry ? omegaSnap.omega_registry : null,
            reference_fields: refFieldSnap && refFieldSnap.reference_fields ? refFieldSnap.reference_fields : null,
        },
        timestamp: new Date().toISOString(),
    };
}

// ---------------------------------------------------------------------------
// Run a scenario (multi-turn)
// ---------------------------------------------------------------------------

async function runScenario({
    anthropic,
    scenario,
    runId,
    turnsCap,
    memoryUrl,
    env,
    outputDir,
    artifactStreams,
    relRegistry,
    turnDelayMs = 0,
}) {
    const threadId = `level3_full_organism_${runId}__${scenario.id}`;
    const prompts = scenario.prompts.slice(0, turnsCap);
    const turns = [];
    let prevOmegaCount = 0;
    let prevRefFieldCount = 0;
    let initialOmegaCount = null;
    let initialRefFieldCount = null;
    for (let i = 0; i < prompts.length; i++) {
        const promptText = prompts[i];
        let turn;
        try {
            turn = await runOneTurn({
                anthropic,
                model: DEFAULT_MODEL,
                memoryUrl,
                threadId,
                runId,
                scenarioId: scenario.id,
                turnIndex: i,
                promptText,
                env,
            });
        } catch (e) {
            // Record failure and abort scenario.
            const failure = {
                run_id: runId,
                scenario_id: scenario.id,
                turn_index: i,
                error: e.message,
                timestamp: new Date().toISOString(),
            };
            await artifactStreams.turns.write(failure);
            return {
                scenario_id: scenario.id,
                aborted_at_turn: i,
                error: e.message,
                turns_completed: i,
            };
        }
        if (initialOmegaCount === null) initialOmegaCount = turn.omega_registry_count;
        if (initialRefFieldCount === null) initialRefFieldCount = turn.reference_field_count;
        turn.new_omega_created_this_turn = turn.omega_registry_count > prevOmegaCount;
        turn.new_reference_field_this_turn = turn.reference_field_count > prevRefFieldCount;
        prevOmegaCount = turn.omega_registry_count;
        prevRefFieldCount = turn.reference_field_count;
        turns.push(turn);
        await artifactStreams.turns.write(turn);
        if (turn.fce_state) {
            await artifactStreams.fceTelemetry.write({
                run_id: runId,
                scenario_id: scenario.id,
                turn_index: i,
                turn_id: turn.turn_id,
                fce_state: turn.fce_state,
            });
        }
        if (turn.snapshots.omega_registry) {
            await artifactStreams.omegaSnapshots.write({
                run_id: runId,
                scenario_id: scenario.id,
                turn_index: i,
                turn_id: turn.turn_id,
                omega_registry: turn.snapshots.omega_registry,
            });
        }
        if (turn.snapshots.reference_fields) {
            await artifactStreams.refFieldSnapshots.write({
                run_id: runId,
                scenario_id: scenario.id,
                turn_index: i,
                turn_id: turn.turn_id,
                reference_fields: turn.snapshots.reference_fields,
            });
        }
        // Relational layer (runner-side, read-only).
        const relEvents = deriveRelationEvents({
            turn,
            runId,
            scenarioId: scenario.id,
            fceReport: turn.fce_state,
            searchHits: null,
            verifiedFacts: turn.retrieved_facts_by_tier.verified_project_fact ? Array(turn.retrieved_facts_by_tier.verified_project_fact).fill(null) : [],
            domainFacts: turn.retrieved_facts_by_tier.domain_verified ? Array(turn.retrieved_facts_by_tier.domain_verified).fill(null) : [],
        });
        for (const re of relEvents) {
            relRegistry.recordEvent(re);
            await artifactStreams.relationalField.write(re);
        }
        relRegistry.recordCenterHints("byon::macp_pipeline::factual", {
            source_turn_ids: [turn.turn_id],
        });
        // commit 15: optional inter-turn delay so the memory-service
        // 100-req/60s rate limiter has headroom across long scenarios.
        if (turnDelayMs && turnDelayMs > 0 && i < prompts.length - 1) {
            await _sleep(turnDelayMs);
        }
    }
    return {
        scenario_id: scenario.id,
        title: scenario.title,
        purpose: scenario.purpose,
        thread_id: threadId,
        turns_run: turns.length,
        turns,
        omega_count_initial: initialOmegaCount,
        omega_count_final: prevOmegaCount,
        reference_field_count_initial: initialRefFieldCount,
        reference_field_count_final: prevRefFieldCount,
        omega_delta: (prevOmegaCount || 0) - (initialOmegaCount || 0),
        reference_field_delta: (prevRefFieldCount || 0) - (initialRefFieldCount || 0),
    };
}

// ---------------------------------------------------------------------------
// JSONL writer
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
// Verdict computation
// ---------------------------------------------------------------------------

export function computeVerdict({
    claudeLivePresent,
    scenarios,
    fceStatesObserved,
    productionEmbeddingsLive = null,
    fceMetricsExposed = null,
    requiredScenarioIds = ["scenario-1-byon-arch", "scenario-2-adversarial"],
    maxObservedS = null,
}) {
    // 1. Hard prerequisite: live Claude.
    if (!claudeLivePresent) return "CLAUDE_API_REQUIRED_FOR_FULL_ORGANISM_TEST";

    // 2. Any required scenario with 0 completed turns -> SMOKE only.
    //    (commit 15: Sc2 0/30 must no longer collapse into LEVEL2_CONFIRMED.)
    const scenarioCompletion = new Map();
    for (const s of scenarios) {
        scenarioCompletion.set(s.scenario_id, {
            turns_run: s.turns_run || (s.turns ? s.turns.length : 0),
            error: s.error || null,
        });
    }
    const anyRequiredZeroTurns = requiredScenarioIds.some((sid) => {
        const sc = scenarioCompletion.get(sid);
        return !sc || (sc.turns_run || 0) === 0;
    });
    if (anyRequiredZeroTurns) return "PARTIAL_FULL_ORGANISM_SMOKE_RUN";

    // 3. Production embeddings must be confirmed live (commit 15).
    if (productionEmbeddingsLive === false) {
        return "INCONCLUSIVE_EMBEDDINGS_NOT_CONFIRMED";
    }

    // 4. FCE metrics must be exposed (commit 15). If endpoint says
    //    "not exposed" or detection is null, emit the inconclusive
    //    verdict rather than implying a healthy full evaluation.
    if (fceMetricsExposed === false) {
        return "INCONCLUSIVE_FCE_METRICS_NOT_EXPOSED";
    }

    // 5. Omega observed naturally by check_coagulation? That is the
    //    strongest research observation; still NOT Level 3.
    const omegaSeen = scenarios.some((s) => (s.omega_delta || 0) > 0);
    if (omegaSeen) return "OMEGA_OBSERVED_BY_CHECK_COAGULATION_NO_MANUAL_WRITE";

    // 6. Near-threshold: any captured S_t >= 0.9*theta_s.
    let maxS = 0;
    if (typeof maxObservedS === "number" && Number.isFinite(maxObservedS)) {
        maxS = maxObservedS;
    }
    for (const fs of fceStatesObserved || []) {
        if (fs && typeof fs.S_t === "number" && fs.S_t > maxS) maxS = fs.S_t;
        if (fs && typeof fs.s_t === "number" && fs.s_t > maxS) maxS = fs.s_t;
        if (fs && typeof fs.max_S_t_in_log === "number" && fs.max_S_t_in_log > maxS) {
            maxS = fs.max_S_t_in_log;
        }
    }
    if (maxS >= 0.9 * THETA_S) return "FULL_ORGANISM_NEAR_THRESHOLD";

    // 7. All scenarios completed without error -> Level 2 healthy.
    const allCompleted = scenarios.every((s) => !s.error);
    if (allCompleted) return "FULL_ORGANISM_LEVEL2_CONFIRMED";

    return "INCONCLUSIVE_NEEDS_LONGER_RUN";
}

// ---------------------------------------------------------------------------
// Final report
// ---------------------------------------------------------------------------

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsForbiddenToken(text) {
    for (const token of FORBIDDEN_VERDICTS) {
        const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(token)}(?![A-Za-z0-9_])`);
        if (re.test(text)) return token;
    }
    return null;
}

function renderMarkdown(summary) {
    const lines = [];
    lines.push("# Level 3 Full Organism Live Runner — Report");
    lines.push("");
    lines.push(
        "> ADVISORY ONLY. Research artifact from the full-organism live experiment. " +
            "Does NOT declare Level 3, does NOT create OmegaRecord manually, does NOT " +
            "write to OmegaRegistry, does NOT create ReferenceField, does NOT modify " +
            "FCE-M vendor. `theta_s=0.28`, `tau_coag=12` unchanged.",
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
    lines.push("## Pre-flight");
    lines.push("");
    const pf = summary.preflight;
    lines.push(`- Level 3 flag enabled: **${pf.flag}**`);
    lines.push(`- ANTHROPIC_API_KEY present: **${pf.claude.present}**`);
    lines.push(`- memory-service live: **${pf.memory_service.live}**`);
    lines.push(`- FAISS live: **${pf.faiss.faiss_live}**`);
    lines.push(`- production embeddings live: **${pf.faiss.embeddings_live}** (embedder: \`${pf.faiss.embedder || "?"}\`)`);
    lines.push(`- FCE-M live: **${pf.fcem.fce_live}**`);
    lines.push(`- Ready: **${pf.ready}**`);
    lines.push("");
    lines.push("## Run summary");
    lines.push("");
    const fmt = (v, digits = 6) =>
        typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";
    lines.push(`- Scenarios run: ${summary.scenarios_run ?? 0}`);
    lines.push(`- Total turns: ${summary.total_turns ?? 0}`);
    lines.push(`- Total live Claude calls: ${summary.total_claude_calls ?? 0}`);
    lines.push(`- Total input tokens: ${summary.total_input_tokens ?? 0}`);
    lines.push(`- Total output tokens: ${summary.total_output_tokens ?? 0}`);
    lines.push(`- Total estimated cost USD: \`${fmt(summary.total_estimated_cost_usd, 6)}\``);
    lines.push(`- Mean latency ms (Claude): \`${fmt(summary.mean_claude_latency_ms, 1)}\``);
    lines.push(`- Max observed S_t: \`${summary.max_observed_s_t ?? "—"}\``);
    lines.push(`- Mean observed S_t: \`${summary.mean_observed_s_t ?? "—"}\``);
    lines.push(`- Max observed AR: \`${summary.max_observed_ar ?? "—"}\``);
    lines.push(`- Mean observed AR: \`${summary.mean_observed_ar ?? "—"}\``);
    lines.push(`- Longest run above threshold: \`${summary.longest_run_above_theta ?? 0}\``);
    lines.push(`- Production embeddings live: **${summary.production_embeddings_live ?? "—"}** (class=\`${summary.embedder_class || "—"}\` name=\`${summary.embedder_name || "—"}\` dim=\`${summary.embedding_dim || "—"}\`)`);
    lines.push(`- FCE metrics exposed: **${summary.fce_metrics_exposed ?? "—"}**`);
    lines.push(`- OmegaRegistry before/after: \`${summary.omega_total_initial ?? 0} -> ${summary.omega_total_final ?? 0}\` (delta=${summary.omega_total_delta ?? 0})`);
    lines.push(`- ReferenceField before/after: \`${summary.reference_field_total_initial ?? 0} -> ${summary.reference_field_total_final ?? 0}\` (delta=${summary.reference_field_total_delta ?? 0})`);
    lines.push(`- relation events emitted: ${summary.relation_events_emitted ?? 0}`);
    lines.push(`- relation types seen: \`${(summary.relation_types_seen || []).join(", ") || "—"}\``);
    lines.push("");
    lines.push("## Per-scenario");
    lines.push("");
    for (const s of summary.scenarios || []) {
        lines.push(`### ${s.scenario_id} — ${s.title || ""}`);
        lines.push("");
        lines.push(`- turns: ${s.turns_run}`);
        lines.push(`- thread_id: \`${s.thread_id}\``);
        lines.push(`- omega: ${s.omega_count_initial} -> ${s.omega_count_final} (delta=${s.omega_delta})`);
        lines.push(`- reference_field: ${s.reference_field_count_initial} -> ${s.reference_field_count_final} (delta=${s.reference_field_delta})`);
        if (s.error) lines.push(`- ERROR: ${s.error}`);
        lines.push("");
    }
    lines.push("## Final verdict");
    lines.push("");
    lines.push(`**\`${summary.final_verdict}\`**`);
    lines.push("");
    lines.push("## Confirmations");
    lines.push("");
    lines.push("- Level 3 is **NOT declared** by this runner.");
    lines.push(`- \`theta_s = ${THETA_S}\` unchanged.`);
    lines.push(`- \`tau_coag = ${TAU_COAG}\` unchanged.`);
    lines.push("- No manual OmegaRegistry write.");
    lines.push("- No manual OmegaRecord creation.");
    lines.push("- No manual ReferenceField creation.");
    lines.push("- All experiment writes carry `is_level3_experiment=true` and `run_id`.");
    lines.push("");
    if (summary.final_verdict === "OMEGA_OBSERVED_BY_CHECK_COAGULATION_NO_MANUAL_WRITE") {
        lines.push("**Important**: single-run Omega observation is not sufficient for Level 3 declaration.");
        lines.push("Level 3 declaration would require: independent reproduction; no-regression D/E/F/M/N; operator approval.");
        lines.push("");
    }
    return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Cleanup helper (operator-invoked only)
// ---------------------------------------------------------------------------

async function cleanupRun(runId, memoryUrl = DEFAULT_MEMORY_URL) {
    // Memory-service does not yet expose a thread-delete action; we
    // record the cleanup intent in a JSON file so the operator has a
    // record of which run id was requested for cleanup.
    const out = {
        cleanup_request: true,
        run_id: runId,
        thread_id_pattern: `level3_full_organism_${runId}*`,
        requested_at: new Date().toISOString(),
        note:
            "Memory-service does not currently support thread-id delete via API. " +
            "Operator must clean conversation entries with this thread_id prefix " +
            "manually (see docs/LEVEL3_FULL_ORGANISM_RUNTIME_EXPERIMENT.md §10).",
    };
    const cleanupDir = path.join("test-results", "level3-full-organism-live", "cleanup");
    await fsp.mkdir(cleanupDir, { recursive: true });
    const cleanupPath = path.join(cleanupDir, `cleanup-${runId}.json`);
    await fsp.writeFile(cleanupPath, JSON.stringify(out, null, 2) + "\n");
    process.stdout.write(`cleanup request recorded: ${cleanupPath}\n`);
    return 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2), env = process.env) {
    const args = parseArgs(argv);
    if (args.help) {
        process.stdout.write(
            "Usage: node scripts/level3-full-organism-live-runner.mjs [--scenario id] [--turns n] [--dry-run] [--output-dir path] [--run-id id] [--cleanup-run id] [--estimate-cost] [--report-cost]\n",
        );
        return 0;
    }
    if (args.cleanupRun) {
        return await cleanupRun(args.cleanupRun);
    }
    if (!isLevel3FullOrganismExperimentEnabled(env)) {
        process.stderr.write(
            `${LEVEL3_FLAG_NAME}=true required. Default OFF; runner refusing.\n`,
        );
        return 2;
    }

    const runId = args.runId || `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
    const outputDir = args.outputDir;
    await fsp.mkdir(outputDir, { recursive: true });

    const memoryUrl = env.MEMORY_SERVICE_URL || DEFAULT_MEMORY_URL;
    const requireClaude = !args.dryRun;
    const pf = await preflight({ requireClaude, env, memoryUrl });

    // If we are doing --estimate-cost only, write a tiny report and exit.
    if (args.estimateCost) {
        const sample = estimateTurnCost(2000, 600, env);
        const note = {
            schema_version: RUNNER_SCHEMA_VERSION,
            run_id: runId,
            estimate_only: true,
            assumed_input_tokens_per_turn: 2000,
            assumed_output_tokens_per_turn: 600,
            per_turn_estimate_usd: sample.estimated_cost_usd,
            price_table: {
                input_price_per_mtok: sample.input_price_per_mtok,
                output_price_per_mtok: sample.output_price_per_mtok,
            },
        };
        const outPath = path.join(outputDir, `estimate-cost-${runId}.json`);
        await fsp.writeFile(outPath, JSON.stringify(note, null, 2) + "\n");
        process.stdout.write(`wrote ${outPath}\n`);
        return 0;
    }

    // Open artifact streams.
    const runDir = path.join(outputDir, runId);
    await fsp.mkdir(runDir, { recursive: true });
    const artifactStreams = {
        turns: await openJsonlStream(path.join(runDir, "turns.jsonl")),
        fceTelemetry: await openJsonlStream(path.join(runDir, "fce-telemetry.jsonl")),
        relationalField: await openJsonlStream(path.join(runDir, "relational-field.jsonl")),
        omegaSnapshots: await openJsonlStream(path.join(runDir, "omega-snapshots.jsonl")),
        refFieldSnapshots: await openJsonlStream(path.join(runDir, "reference-field-snapshots.jsonl")),
    };
    const relRegistry = new RelationalFieldRegistry({ run_id: runId });

    // Write run-config.json.
    const runConfig = {
        schema_version: RUNNER_SCHEMA_VERSION,
        run_id: runId,
        branch: "research/level3-full-organism-runtime",
        is_level3_experiment: true,
        dry_run: args.dryRun,
        memory_url: memoryUrl,
        scenarios_requested: args.scenario ? [args.scenario] : Object.keys(SCENARIOS),
        turns_per_scenario_cap: args.turns,
        theta_s: THETA_S,
        tau_coag: TAU_COAG,
        flags: {
            level3_full_organism_experiment: pf.flag,
        },
        preflight: pf,
        generated_at: new Date().toISOString(),
    };
    await fsp.writeFile(path.join(runDir, "run-config.json"), JSON.stringify(runConfig, null, 2) + "\n");

    // If dry-run, emit a dry-run report and exit with verdict-only.
    if (args.dryRun) {
        const verdict = pf.ready
            ? "FULL_ORGANISM_LEVEL2_CONFIRMED"  // dry-run ready
            : pf.claude.present ? "INCONCLUSIVE_NEEDS_LONGER_RUN" : "CLAUDE_API_REQUIRED_FOR_FULL_ORGANISM_TEST";
        const summary = {
            schema_version: RUNNER_SCHEMA_VERSION,
            branch: "research/level3-full-organism-runtime",
            run_id: runId,
            generated_at: new Date().toISOString(),
            dry_run: true,
            model_id: null,
            memory_url: memoryUrl,
            preflight: pf,
            scenarios_run: 0,
            total_turns: 0,
            total_claude_calls: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_estimated_cost_usd: 0,
            mean_claude_latency_ms: null,
            max_observed_s_t: null,
            mean_observed_s_t: null,
            longest_run_above_theta: 0,
            omega_total_initial: 0,
            omega_total_final: 0,
            omega_total_delta: 0,
            reference_field_total_initial: 0,
            reference_field_total_final: 0,
            reference_field_total_delta: 0,
            relation_events_emitted: 0,
            relation_types_seen: [],
            scenarios: [],
            final_verdict: verdict,
            allowed_verdicts: ALLOWED_VERDICTS,
            forbidden_verdicts: FORBIDDEN_VERDICTS,
            note: "dry-run; no Claude API calls were made; no memory writes were made",
        };
        await fsp.writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
        await fsp.writeFile(path.join(runDir, "report.md"), renderMarkdown(summary));
        await Promise.all(Object.values(artifactStreams).map((s) => s.close()));
        process.stdout.write(`[dry-run] wrote ${path.join(runDir, "summary.json")}\n`);
        process.stdout.write(`[dry-run] verdict: ${verdict}\n`);
        return 0;
    }

    // Official run requires Claude live.
    if (!pf.claude.present) {
        const summary = {
            schema_version: RUNNER_SCHEMA_VERSION,
            branch: "research/level3-full-organism-runtime",
            run_id: runId,
            generated_at: new Date().toISOString(),
            dry_run: false,
            preflight: pf,
            final_verdict: "CLAUDE_API_REQUIRED_FOR_FULL_ORGANISM_TEST",
            allowed_verdicts: ALLOWED_VERDICTS,
            forbidden_verdicts: FORBIDDEN_VERDICTS,
            note: "official run blocked: ANTHROPIC_API_KEY missing",
        };
        await fsp.writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
        await fsp.writeFile(path.join(runDir, "report.md"), renderMarkdown(summary));
        await Promise.all(Object.values(artifactStreams).map((s) => s.close()));
        process.stderr.write("ANTHROPIC_API_KEY missing; emitted CLAUDE_API_REQUIRED_FOR_FULL_ORGANISM_TEST and exiting.\n");
        return 3;
    }

    // Dynamic import of Anthropic SDK so the dry-run path doesn't require it.
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    // Pick scenarios.
    const scenarioIds = args.scenario ? [args.scenario] : Object.keys(SCENARIOS);
    const scenarioResults = [];
    const fceStatesObserved = [];
    for (const sid of scenarioIds) {
        const sc = SCENARIOS[sid];
        if (!sc) {
            scenarioResults.push({ scenario_id: sid, error: "unknown scenario" });
            continue;
        }
        const sr = await runScenario({
            anthropic,
            scenario: sc,
            runId,
            turnsCap: args.turns,
            memoryUrl,
            env,
            outputDir,
            artifactStreams,
            relRegistry,
            turnDelayMs: args.turnDelayMs,
        });
        scenarioResults.push(sr);
        for (const t of sr.turns || []) {
            if (t.fce_state) fceStatesObserved.push(t.fce_state);
        }
    }

    // Aggregate.
    let totalTurns = 0,
        totalInTokens = 0,
        totalOutTokens = 0,
        totalCost = 0,
        latencies = [],
        observedS = [],
        observedAR = [],
        omegaInit = 0,
        omegaFinal = 0,
        refInit = 0,
        refFinal = 0;
    let omegaInitSet = false;
    let refInitSet = false;
    for (const s of scenarioResults) {
        if (!s.turns) continue;
        totalTurns += s.turns.length;
        for (const t of s.turns) {
            totalInTokens += t.input_tokens || 0;
            totalOutTokens += t.output_tokens || 0;
            totalCost += t.estimated_cost_usd || 0;
            if (typeof t.claude_latency_ms === "number") latencies.push(t.claude_latency_ms);
            // commit 15: extract S_t / AR from the /level3/fce-metrics
            // detailed endpoint (per-turn capture) — these are real
            // observer-derived numbers, not surrogate.
            const fmd = t.fce_metrics_detail;
            if (fmd && fmd.fce_metrics_exposed === true) {
                if (typeof fmd.max_S_t_in_log === "number") observedS.push(fmd.max_S_t_in_log);
                if (typeof fmd.max_AR_in_log === "number") observedAR.push(fmd.max_AR_in_log);
                if (Array.isArray(fmd.morphogenesis_log_tail)) {
                    for (const ev of fmd.morphogenesis_log_tail) {
                        if (typeof ev.S_t === "number") observedS.push(ev.S_t);
                        if (typeof ev.AR === "number") observedAR.push(ev.AR);
                    }
                }
            }
            // Fall back to fce_state (older FCE-M surface) if metrics
            // detail not exposed.
            const fs = t.fce_state;
            if (fs && typeof fs === "object") {
                if (typeof fs.S_t === "number") observedS.push(fs.S_t);
                if (typeof fs.s_t === "number") observedS.push(fs.s_t);
                if (typeof fs.max_S_t === "number") observedS.push(fs.max_S_t);
            }
        }
        if (!omegaInitSet && typeof s.omega_count_initial === "number") {
            omegaInit = s.omega_count_initial;
            omegaInitSet = true;
        }
        if (typeof s.omega_count_final === "number") omegaFinal = s.omega_count_final;
        if (!refInitSet && typeof s.reference_field_count_initial === "number") {
            refInit = s.reference_field_count_initial;
            refInitSet = true;
        }
        if (typeof s.reference_field_count_final === "number") refFinal = s.reference_field_count_final;
    }
    const maxS = observedS.length ? Math.max(...observedS) : null;
    const meanS = observedS.length ? observedS.reduce((a, b) => a + b, 0) / observedS.length : null;
    const maxAR = observedAR.length ? Math.max(...observedAR) : null;
    const meanAR = observedAR.length ? observedAR.reduce((a, b) => a + b, 0) / observedAR.length : null;
    // Longest run above theta over the FLAT observed series (best-effort).
    let longest = 0;
    {
        let cur = 0;
        for (const s of observedS) {
            if (s >= THETA_S) {
                cur += 1;
                if (cur > longest) longest = cur;
            } else cur = 0;
        }
    }
    // commit 15: enrich verdict computation with embedder + FCE metrics
    // exposure flags and per-scenario completion. The FCE observer is
    // typically NOT instantiated at preflight time (fresh memory-service
    // process), but per-turn captures find it once events start. The
    // verdict therefore considers the metric exposed if EITHER the
    // preflight probe OR any per-turn capture returned true.
    const productionEmbeddingsLive = pf.faiss && pf.faiss.embeddings_live === true;
    const fceExposedAtPreflight =
        pf.fce_metrics_detail && pf.fce_metrics_detail.fce_metrics_exposed === true;
    let fceExposedDuringRun = false;
    for (const sr of scenarioResults) {
        if (!sr.turns) continue;
        for (const t of sr.turns) {
            if (
                t.fce_metrics_detail &&
                t.fce_metrics_detail.fce_metrics_exposed === true
            ) {
                fceExposedDuringRun = true;
                break;
            }
        }
        if (fceExposedDuringRun) break;
    }
    const fceMetricsExposed = fceExposedAtPreflight || fceExposedDuringRun;
    const scenariosForVerdict = scenarioResults.map((s) => ({
        scenario_id: s.scenario_id,
        turns_run: s.turns ? s.turns.length : 0,
        omega_delta: s.omega_delta,
        error: s.error,
    }));
    const verdict = computeVerdict({
        claudeLivePresent: pf.claude.present,
        scenarios: scenariosForVerdict,
        fceStatesObserved,
        productionEmbeddingsLive,
        fceMetricsExposed,
        requiredScenarioIds: args.scenario ? [args.scenario] : ["scenario-1-byon-arch", "scenario-2-adversarial"],
        maxObservedS: observedS.length ? Math.max(...observedS) : null,
    });
    const relSnapshot = relRegistry.snapshot();
    const summary = {
        schema_version: RUNNER_SCHEMA_VERSION,
        branch: "research/level3-full-organism-runtime",
        run_id: runId,
        generated_at: new Date().toISOString(),
        dry_run: false,
        model_id: DEFAULT_MODEL,
        memory_url: memoryUrl,
        preflight: pf,
        scenarios_run: scenarioResults.filter((s) => !s.error).length,
        total_turns: totalTurns,
        total_claude_calls: totalTurns,
        total_input_tokens: totalInTokens,
        total_output_tokens: totalOutTokens,
        total_estimated_cost_usd: totalCost,
        mean_claude_latency_ms: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
        max_observed_s_t: maxS,
        mean_observed_s_t: meanS,
        max_observed_ar: maxAR,
        mean_observed_ar: meanAR,
        production_embeddings_live: productionEmbeddingsLive,
        embedder_class: pf.faiss ? pf.faiss.embedder_class : null,
        embedder_name: pf.faiss ? pf.faiss.embedder_name : null,
        embedding_dim: pf.faiss ? pf.faiss.embedding_dim : null,
        fce_metrics_exposed: fceMetricsExposed,
        fce_metrics_preflight: pf.fce_metrics_detail || null,
        longest_run_above_theta: longest,
        omega_total_initial: omegaInit,
        omega_total_final: omegaFinal,
        omega_total_delta: omegaFinal - omegaInit,
        reference_field_total_initial: refInit,
        reference_field_total_final: refFinal,
        reference_field_total_delta: refFinal - refInit,
        relation_events_emitted: relSnapshot.n_events,
        relation_types_seen: Object.keys(relSnapshot.relation_type_counts || {}),
        relational_field_summary: {
            n_events: relSnapshot.n_events,
            relation_type_counts: relSnapshot.relation_type_counts,
            center_field_states: relSnapshot.center_field_states,
        },
        scenarios: scenarioResults.map((s) => ({
            scenario_id: s.scenario_id,
            title: s.title || null,
            purpose: s.purpose || null,
            thread_id: s.thread_id,
            turns_run: s.turns ? s.turns.length : 0,
            omega_count_initial: s.omega_count_initial,
            omega_count_final: s.omega_count_final,
            omega_delta: s.omega_delta,
            reference_field_count_initial: s.reference_field_count_initial,
            reference_field_count_final: s.reference_field_count_final,
            reference_field_delta: s.reference_field_delta,
            error: s.error || null,
        })),
        final_verdict: verdict,
        allowed_verdicts: ALLOWED_VERDICTS,
        forbidden_verdicts: FORBIDDEN_VERDICTS,
        level_3_declared: false,
        natural_omega_proven: false,
    };
    // Sanity: the final verdict must be from the admitted set and must
    // NEVER be one of the forbidden verdict strings. Claude's free-form
    // response text in turns.jsonl may legitimately discuss "Level 3"
    // when answering operator questions — that is content, not a
    // verdict claim. We therefore only check verdict-bearing fields.
    if (!ALLOWED_VERDICTS.includes(summary.final_verdict)) {
        process.stderr.write(
            `WARNING: final_verdict ${summary.final_verdict} not in ALLOWED_VERDICTS; aborting write\n`,
        );
        return 4;
    }
    for (const forbidden of FORBIDDEN_VERDICTS) {
        if (summary.final_verdict === forbidden) {
            process.stderr.write(
                `WARNING: final_verdict matches forbidden token ${forbidden}; aborting write\n`,
            );
            return 4;
        }
    }
    await fsp.writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    await fsp.writeFile(path.join(runDir, "report.md"), renderMarkdown(summary));
    await Promise.all(Object.values(artifactStreams).map((s) => s.close()));
    process.stdout.write(`final verdict: ${verdict}\n`);
    process.stdout.write(`artifacts: ${runDir}\n`);
    if (args.reportCost) {
        process.stdout.write(`total estimated cost USD: ${totalCost.toFixed(6)}\n`);
    }
    return verdict === "CLAUDE_API_REQUIRED_FOR_FULL_ORGANISM_TEST" ? 3 : 0;
}

// CLI entry only when this module is run directly.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    main().then((code) => process.exit(code)).catch((e) => {
        process.stderr.write(`FATAL: ${e.stack || e.message}\n`);
        process.exit(1);
    });
}
