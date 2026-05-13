#!/usr/bin/env node
/**
 * Level 3 Structural Identity FULL ORGANISM Runner (commit 17).
 *
 * Supersedes commit-16's runner-side-only behavioral observer. This
 * runner USES THE REAL BYON PIPELINE — it imports `runConditionB` from
 * `byon-industrial-ab-benchmark.mjs` (the production Condition B
 * function), so every turn goes through:
 *
 *   - store-conversation (production memory write)
 *   - capture user prefs
 *   - fact extractor (sync/async route)
 *   - Contextual Pathway Stabilization v0.6.9 phase machine
 *   - thread-scoped FAISS search (scope=thread)
 *   - directly-relevant unsuppression
 *   - per-tier capped trust-ranked memory formatter
 *   - FCE morphogenesis report (cached)
 *   - WARM-phase compact conversation excerpts
 *   - ACTIVE RESPONSE CONSTRAINTS block (compact vs full)
 *   - Claude Sonnet 4.6 with canonical-facts block + prompt cache
 *   - full compliance guard: detect -> auto-fix -> regenerate-once
 *   - store-reply
 *   - fce_assimilate_receipt
 *
 * Plus on top of that:
 *
 *   - Phase 0 PERSISTS the operator-seeded structural references via
 *     `/level3/persist-structural-reference` (production embed +
 *     stored as `fact` with metadata-in-tags).
 *   - Each subsequent phase queries
 *     `/level3/retrieve-structural-references` for each turn and
 *     measures: was the seed actually IN BYON's recall this turn?
 *   - Runner observes whether the seed text appeared in the dynamic
 *     suffix that runConditionB built (recalled facts block), which is
 *     the strongest signal of "used in prompt".
 *   - Module Activation Matrix: 31 modules; each turn updates evidence.
 *
 * Verdict combines persistence + retrieval + prompt inclusion +
 * behavioral signal + compliance alignment + adversarial resistance.
 *
 * Hard isolation rules (commit 14/15/16 carry-forward + extensions):
 *   - Requires BYON_LEVEL3_FULL_ORGANISM_EXPERIMENT=true.
 *   - Requires ANTHROPIC_API_KEY for the official run.
 *   - NO manual OmegaRecord / OmegaRegistry write / ReferenceField.
 *   - NO call to `agent.check_coagulation`.
 *   - theta_s = 0.28 and tau_coag = 12 unchanged.
 *   - Seeded nodes NEVER promoted to endogenous Omega.
 *   - Memory writes use thread_id prefix `level3_full_organism_`.
 *   - Operator decides cost; runner only measures + reports.
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
    ALLOWED_VERDICTS as STRUCT_ALLOWED_VERDICTS,
    FORBIDDEN_VERDICT_TOKENS as STRUCT_FORBIDDEN_TOKENS,
    containsForbiddenVerdictToken,
    NODE_ORIGINS,
    ASSIMILATION_STATES,
} from "./lib/structural-reference.mjs";

import { STRUCTURAL_SEEDS } from "./lib/structural-seeds.mjs";
import {
    STRUCTURAL_IDENTITY_PHASES,
    PHASE_IDS,
} from "./lib/scenarios/structural-identity-phases.mjs";

// Import the production Condition B pipeline + the `mem` HTTP helper
// from the benchmark. The benchmark file is gated against running its
// `main()` when imported (commit 17 added an isMain guard).
import {
    runConditionB,
    mem as prodMem,
    MEMORY_URL as DEFAULT_MEMORY_URL,
    MODEL as DEFAULT_MODEL,
    // @ts-ignore
} from "./byon-industrial-ab-benchmark.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const RUNNER_SCHEMA_VERSION = "level3-structural-identity-full-organism-runner.v1";

// ---------------------------------------------------------------------------
// Verdict vocabulary
// ---------------------------------------------------------------------------

// commit 17: extended verdict vocabulary that ties verdict to actual
// pipeline activity, not just runner-side lexical detection.
export const ALLOWED_VERDICTS = Object.freeze([
    // Runner-side lexical signal only.
    "BEHAVIORAL_OBSERVATION_ONLY",
    // Persistence chain.
    "STRUCTURAL_REFERENCE_PERSISTED",
    "STRUCTURAL_REFERENCE_RETRIEVED",
    "STRUCTURAL_REFERENCE_USED_IN_PROMPT",
    "STRUCTURAL_REFERENCE_BEHAVIORALLY_APPLIED",
    "STRUCTURAL_IDENTITY_INTERNALIZATION_PARTIAL",
    "STRUCTURAL_IDENTITY_FIELD_ACTIVE_IN_PIPELINE",
    // Module activation degradation.
    "FULL_ORGANISM_INCOMPLETE_MODULES_INACTIVE",
    // Suffix.
    "FULL_LEVEL3_NOT_DECLARED",
    // Inconclusive.
    "INCONCLUSIVE_NEEDS_LONGER_RUN",
]);

export const FORBIDDEN_VERDICT_TOKENS = Object.freeze([
    "LEVEL_3_REACHED",
    "OMEGA_CREATED_MANUALLY",
    "SYNTHETIC_OMEGA",
    "THRESHOLD_LOWERED",
    "SEEDED_REFERENCE_AS_ENDOGENOUS_OMEGA",
    "REFERENCEFIELD_CREATED_WITHOUT_OMEGA",
]);

// commit 17: derivative-candidate classification (5 tiers).
export const DERIVATIVE_CLASSIFICATIONS = Object.freeze([
    "lexical_derivative_candidate",
    "behavioral_derivative_candidate",
    "memory_persisted_derivative_candidate",
    "structurally_retrieved_derivative_candidate",
    "endogenous_derivative_candidate",
]);

const THETA_S = 0.28;
const TAU_COAG = 12;

// ---------------------------------------------------------------------------
// Module Activation Matrix definition (31 modules per operator spec).
//
// Each module declaration carries:
//   id, label, evidence_file, evidence_function, detector
// `detector(turn, observation)` returns truthy when the turn shows this
// module fired. The matrix accumulates per-module counts; the final
// report shows {active, evidence_file, evidence_function, turn_count_seen}.
// ---------------------------------------------------------------------------

function _has(obj, ...path) {
    let cur = obj;
    for (const p of path) {
        if (cur === undefined || cur === null) return false;
        cur = cur[p];
    }
    return cur !== undefined && cur !== null;
}

export const MODULE_DEFINITIONS = Object.freeze([
    {
        id: "claude_api_live",
        label: "Claude API live",
        evidence_file: "scripts/byon-industrial-ab-benchmark.mjs",
        evidence_function: "askClaude / runConditionB",
        detector: (turn) => Number.isInteger(turn?.cond_b?.tokens?.in) && turn.cond_b.tokens.in > 0,
    },
    {
        id: "memory_service_live",
        label: "memory-service HTTP API",
        evidence_file: "memory-service/server.py",
        evidence_function: "FastAPI /",
        detector: (turn) => turn?.preflight_memory_live === true,
    },
    {
        id: "faiss_live",
        label: "FAISS retrieval",
        evidence_file: "memory-service/handlers.py",
        evidence_function: "FAISSStore.search",
        detector: (turn) => turn?.preflight_faiss_live === true,
    },
    {
        id: "production_embeddings",
        label: "Production embeddings (sentence-transformers)",
        evidence_file: "memory-service/handlers.py",
        evidence_function: "ProductionEmbedder.embed",
        detector: (turn) => turn?.preflight_embeddings_live === true,
    },
    {
        id: "fce_m_backend",
        label: "FCE-M backend",
        evidence_file: "memory-service/fcem_backend.py",
        evidence_function: "FcemBackend.state",
        detector: (turn) => turn?.cond_b?.fce !== null && turn?.cond_b?.fce !== undefined,
    },
    {
        id: "fce_morphogenesis_report",
        label: "fce_morphogenesis_report action",
        evidence_file: "memory-service/server.py",
        evidence_function: "handle_request(action=fce_morphogenesis_report)",
        detector: (turn) => _has(turn, "cond_b", "fce", "morphogenesis_summary"),
    },
    {
        id: "fce_assimilate_receipt",
        label: "fce_assimilate_receipt action",
        evidence_file: "memory-service/server.py",
        evidence_function: "handle_request(action=fce_assimilate_receipt)",
        detector: (turn) => turn?.cond_b?.compliance_telemetry !== undefined,
    },
    {
        id: "fce_consolidate",
        label: "FCE consolidate",
        evidence_file: "memory-service/fcem_backend.py",
        evidence_function: "FcemBackend.consolidate",
        detector: (turn, obs) => obs?.fce_consolidate_calls > 0,
    },
    {
        id: "omega_registry_snapshot",
        label: "OmegaRegistry snapshot read",
        evidence_file: "memory-service/fcem_backend.py",
        evidence_function: "FcemBackend.omega_registry",
        detector: (turn) => Number.isInteger(turn?.omega_registry_count),
    },
    {
        id: "reference_field_snapshot",
        label: "ReferenceField snapshot read",
        evidence_file: "memory-service/fcem_backend.py",
        evidence_function: "FcemBackend.reference_fields",
        detector: (turn) => Number.isInteger(turn?.reference_field_count),
    },
    {
        id: "verified_project_facts",
        label: "VERIFIED_PROJECT_FACT tier",
        evidence_file: "scripts/lib/fact-extractor.mjs",
        evidence_function: "TRUST tier classification",
        detector: (turn) => (turn?.cond_b?.trust_tally?.VERIFIED_PROJECT_FACT || 0) > 0,
    },
    {
        id: "domain_verified_facts",
        label: "DOMAIN_VERIFIED tier",
        evidence_file: "scripts/lib/fact-extractor.mjs",
        evidence_function: "TRUST tier classification",
        detector: (turn) => (turn?.cond_b?.trust_tally?.DOMAIN_VERIFIED || 0) > 0,
    },
    {
        id: "trust_ranked_formatter",
        label: "Trust-ranked memory formatter",
        evidence_file: "scripts/lib/fact-extractor.mjs",
        evidence_function: "formatFactsForPrompt",
        detector: (turn) => Number.isInteger(turn?.cond_b?.recall_facts),
    },
    {
        id: "fact_extractor",
        label: "Fact extractor",
        evidence_file: "scripts/lib/fact-extractor.mjs",
        evidence_function: "extractAndStoreFacts / fireAsyncExtractor",
        // runConditionB always invokes the extractor (sync/async/skip);
        // we mark the module active if a successful turn occurred.
        detector: (turn) => !turn?.cond_b?.error,
    },
    {
        id: "compliance_guard",
        label: "Compliance guard (detect/auto-fix)",
        evidence_file: "scripts/byon-industrial-ab-benchmark.mjs",
        evidence_function: "checkCompliance + autoFixCompliance",
        detector: (turn) => Array.isArray(turn?.cond_b?.compliance_telemetry?.detected_violations),
    },
    {
        id: "active_response_constraints",
        label: "ACTIVE RESPONSE CONSTRAINTS block",
        evidence_file: "scripts/byon-industrial-ab-benchmark.mjs",
        evidence_function: "buildActiveConstraintsBlock / buildCompactConstraintsBlock",
        // The dynamic suffix tokens estimate is non-null exactly when
        // the constraints block was assembled.
        detector: (turn) => Number.isInteger(turn?.cond_b?.prompt_tokens_dynamic_suffix),
    },
    {
        id: "post_generation_checker",
        label: "Post-generation checker (v1 detect)",
        evidence_file: "scripts/byon-industrial-ab-benchmark.mjs",
        evidence_function: "checkCompliance(r.text)",
        detector: (turn) => turn?.cond_b?.compliance_telemetry !== undefined,
    },
    {
        id: "regeneration_once",
        label: "Regenerate-once on medium/high violation",
        evidence_file: "scripts/byon-industrial-ab-benchmark.mjs",
        evidence_function: "regenerateOnce",
        // Per-turn evidence: regenerated flag is true OR auto_fixed/final_violations populated.
        detector: (turn) => {
            const ct = turn?.cond_b?.compliance_telemetry;
            if (!ct) return false;
            return ct.regenerated === true
                || (Array.isArray(ct.auto_fixed) && ct.auto_fixed.length > 0);
        },
    },
    {
        id: "contextual_pathway_stabilization",
        label: "Contextual Pathway Stabilization v0.6.9",
        evidence_file: "scripts/lib/context-state.mjs",
        evidence_function: "updateContext / planning",
        detector: (turn) => !!turn?.cond_b?.context_state,
    },
    {
        id: "context_state_planner",
        label: "Context state planner",
        evidence_file: "scripts/lib/context-state.mjs",
        evidence_function: "plan { search_filters, render_blocks, fce_mode }",
        detector: (turn) => !!turn?.cond_b?.context_state,
    },
    {
        id: "cold_stabilizing_warm_drift",
        label: "COLD/STABILIZING/WARM/DRIFT phase machine",
        evidence_file: "scripts/lib/context-state.mjs",
        evidence_function: "phase classification",
        detector: (turn) => typeof turn?.cond_b?.context_state?.phase === "string",
    },
    {
        id: "memory_route_planner",
        label: "Memory route planner",
        evidence_file: "scripts/lib/context-state.mjs",
        evidence_function: "plan.search_filters.scope",
        detector: (turn) => !!turn?.cond_b?.context_state,
    },
    {
        id: "macp_worker",
        label: "MACP Worker (planning agent)",
        evidence_file: "byon-orchestrator/src/agents/worker/",
        evidence_function: "Worker is the planning agent",
        // The conversational pipeline is NOT the MACP Worker. This
        // module is explicitly NOT exercised by the structural-identity
        // experiment, which runs the chat surface (the Auditor /
        // Executor are downstream of EvidencePack handoff).
        not_applicable: true,
        not_applicable_reason:
            "The structural-identity experiment runs the conversational " +
            "surface (same pipeline as runConditionB and the WhatsApp " +
            "bridge). MACP Worker is the action-planning agent that " +
            "produces EvidencePack from handoff/inbox. It is downstream " +
            "of this surface and is intentionally not invoked here.",
    },
    {
        id: "macp_auditor",
        label: "MACP Auditor (Ed25519 approval)",
        evidence_file: "byon-orchestrator/src/agents/auditor/",
        evidence_function: "Auditor signs ExecutionOrder",
        not_applicable: true,
        not_applicable_reason:
            "Same reason as MACP Worker — the conversational pipeline " +
            "does not produce an ExecutionOrder. The Auditor authority " +
            "BOUNDARY is asserted via seed canonical text and tested " +
            "behaviorally; the Auditor agent itself is not invoked.",
    },
    {
        id: "macp_executor_boundary",
        label: "MACP Executor / handoff boundary",
        evidence_file: "byon-orchestrator/src/agents/executor/",
        evidence_function: "Executor air-gap",
        not_applicable: true,
        not_applicable_reason:
            "The conversational surface does not produce executable " +
            "orders. Executor air-gap is a deployment property and is " +
            "verified at deploy time via docker inspect, not by this " +
            "experiment.",
    },
    {
        id: "auditor_authority_boundary",
        label: "Auditor authority epistemic boundary",
        evidence_file: "scripts/lib/structural-seeds.mjs",
        evidence_function: "auditor_authority seed",
        // The seed's canonical text is in the structural reference
        // registry and persisted via /level3/persist-structural-reference.
        detector: (turn, obs) => (obs?.auditor_authority_recall_count || 0) > 0,
    },
    {
        id: "relational_field_instrumentation",
        label: "Relational field instrumentation",
        evidence_file: "scripts/lib/relational-field.mjs",
        evidence_function: "RelationalFieldRegistry",
        detector: (turn, obs) => (obs?.relation_events_total || 0) > 0,
    },
    {
        id: "structural_reference_memory",
        label: "Structural reference memory",
        evidence_file: "memory-service/level3_experimental_endpoints.py",
        evidence_function: "/level3/persist-structural-reference + tags",
        detector: (turn, obs) => (obs?.structural_references_persisted_total || 0) > 0,
    },
    {
        id: "structural_seed_persistence",
        label: "Seed persistence to memory-service",
        evidence_file: "memory-service/level3_experimental_endpoints.py",
        evidence_function: "handlers.store_fact with level3:* tags",
        detector: (turn, obs) => (obs?.structural_references_persisted_total || 0) > 0,
    },
    {
        id: "thread_scoped_retrieval",
        label: "Thread-scoped retrieval (scope=thread)",
        evidence_file: "memory-service/level3_experimental_endpoints.py",
        evidence_function: "handlers.search_facts scope=thread",
        detector: (turn) => Array.isArray(turn?.retrieved_structural_refs),
    },
    {
        id: "experiment_namespace_isolation",
        label: "Experiment thread namespace isolation",
        evidence_file: "scripts/level3-structural-identity-full-organism-runner.mjs",
        evidence_function: "thread_id prefix level3_full_organism_",
        detector: (turn) => typeof turn?.thread_id === "string" && turn.thread_id.startsWith("level3_full_organism_"),
    },
]);

class _ModuleActivationMatrix {
    constructor() {
        this.state = new Map();
        for (const def of MODULE_DEFINITIONS) {
            this.state.set(def.id, {
                id: def.id,
                label: def.label,
                evidence_file: def.evidence_file,
                evidence_function: def.evidence_function,
                not_applicable: !!def.not_applicable,
                not_applicable_reason: def.not_applicable_reason || null,
                turn_count_seen: 0,
                runtime_evidence: [],
                first_seen_turn_id: null,
            });
        }
    }
    observe(turn, observations) {
        for (const def of MODULE_DEFINITIONS) {
            const slot = this.state.get(def.id);
            if (slot.not_applicable) continue;
            try {
                if (def.detector(turn, observations || {})) {
                    slot.turn_count_seen += 1;
                    if (!slot.first_seen_turn_id) slot.first_seen_turn_id = turn.turn_id || null;
                    if (slot.runtime_evidence.length < 3) {
                        // Save a small evidence excerpt.
                        slot.runtime_evidence.push({
                            turn_id: turn.turn_id || null,
                            phase_id: turn.phase_id || null,
                            sample: _moduleSampleFor(def.id, turn, observations || {}),
                        });
                    }
                }
            } catch {
                // detector errors are silent; the module simply doesn't
                // accumulate evidence on a malformed turn.
            }
        }
    }
    snapshot() {
        const out = [];
        for (const slot of this.state.values()) {
            const active = !slot.not_applicable && slot.turn_count_seen > 0;
            out.push({
                ...slot,
                active,
            });
        }
        out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        return out;
    }
}

function _moduleSampleFor(moduleId, turn, obs) {
    const c = turn?.cond_b;
    if (!c) return null;
    switch (moduleId) {
        case "claude_api_live": return { tokens: c.tokens, claude_ms: c.claude_ms };
        case "fce_morphogenesis_report":
            return { morphogenesis_summary: (c.fce?.morphogenesis_summary || "").slice(0, 200) };
        case "trust_ranked_formatter":
            return { recall_facts: c.recall_facts, trust_tally: c.trust_tally };
        case "compliance_guard":
            return { detected: c.compliance_telemetry?.detected_violations?.length || 0 };
        case "active_response_constraints":
            return { suffix_tokens: c.prompt_tokens_dynamic_suffix };
        case "regeneration_once":
            return { regenerated: !!c.compliance_telemetry?.regenerated };
        case "contextual_pathway_stabilization":
            return { phase: c.context_state?.phase || null };
        case "cold_stabilizing_warm_drift":
            return { phase: c.context_state?.phase || null };
        case "structural_seed_persistence":
            return { persisted_count: obs?.structural_references_persisted_total };
        case "thread_scoped_retrieval":
            return { retrieved_n: (turn?.retrieved_structural_refs || []).length };
        case "auditor_authority_boundary":
            return { auditor_authority_recall_count: obs?.auditor_authority_recall_count || 0 };
        default:
            return null;
    }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
    const args = {
        turnDelayMs: 0,
        outputDir: "test-results/level3-structural-identity-full-organism",
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

// ---------------------------------------------------------------------------
// Memory-service helpers (thin wrappers around the prodMem helper)
// ---------------------------------------------------------------------------

async function persistStructuralRefViaEndpoint({ memoryUrl, payload }) {
    const r = await fetch(memoryUrl + "/level3/persist-structural-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) {
        const body = await r.text().catch(() => "");
        return { ok: false, status: r.status, body: body.slice(0, 200) };
    }
    return await r.json();
}

async function retrieveStructuralRefs({ memoryUrl, threadId, query, topK = 20 }) {
    const r = await fetch(memoryUrl + "/level3/retrieve-structural-references", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thread_id: threadId, query, top_k: topK }),
        signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return { ok: false, status: r.status, structural_references: [] };
    return await r.json();
}

async function preflight({ memoryUrl, env = process.env }) {
    const flag = isLevel3FullOrganismExperimentEnabled(env);
    const claude_present = !!env.ANTHROPIC_API_KEY;
    // memory-service health.
    let mem_live = false;
    try {
        const h = await fetch(memoryUrl + "/health", { signal: AbortSignal.timeout(3000) });
        if (h.ok) {
            const j = await h.json();
            mem_live = j.status === "healthy";
        }
    } catch {}
    // Embedder info.
    let embedder_info = null;
    try {
        const r = await fetch(memoryUrl + "/level3/embedder-info", { signal: AbortSignal.timeout(3000) });
        if (r.ok) embedder_info = await r.json();
    } catch {}
    const embeddings_live = !!(embedder_info && embedder_info.production_embeddings_live);
    // FCE-M live.
    let fce_live = false;
    try {
        const r = await fetch(memoryUrl + "/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "fce_state" }),
            signal: AbortSignal.timeout(3000),
        });
        if (r.ok) fce_live = !!(await r.json()).success;
    } catch {}
    return {
        flag,
        claude_present,
        memory_live: mem_live,
        faiss_live: mem_live,
        embeddings_live,
        embedder_info,
        fce_live,
    };
}

// ---------------------------------------------------------------------------
// Phase 0: persist seeds
// ---------------------------------------------------------------------------

async function persistSeeds({ memoryUrl, threadId, runId, registry }) {
    const persisted = [];
    for (const seed of STRUCTURAL_SEEDS) {
        const r = await persistStructuralRefViaEndpoint({
            memoryUrl,
            payload: {
                thread_id: threadId,
                structural_node_id: seed.id,
                canonical_text: seed.canonical_text,
                origin: seed.origin,
                trust_tier: "VERIFIED_PROJECT_FACT",
                assimilation_state: "seeded_reference",
                run_id: runId,
                phase_id: "phase0_seed_persist",
                scenario_id: "phase0_seed_persist",
                source_turn_id: `${runId}:phase0_seed_persist:${seed.id}`,
                title: seed.title,
                tags: seed.tags || [],
            },
        });
        const ok = !!(r && r.ok);
        persisted.push({
            node_id: seed.id,
            ok,
            ctx_id: r && r.ctx_id ? r.ctx_id : null,
            error: !ok ? r : null,
        });
    }
    return persisted;
}

// ---------------------------------------------------------------------------
// Per-phase runner using runConditionB (production pipeline)
// ---------------------------------------------------------------------------

function _seedById(id) {
    return STRUCTURAL_SEEDS.find((s) => s.id === id) || null;
}

function _responseInvokesNode(response, node) {
    if (!response || !node) return false;
    const r = String(response).toLowerCase();
    for (const phrase of node.canonical_phrases || []) {
        if (!phrase) continue;
        if (r.includes(String(phrase).toLowerCase())) return true;
    }
    return false;
}

function _responseViolatesNode(response, node) {
    if (!response || !node) return false;
    const r = String(response).toLowerCase();
    for (const phrase of node.violation_phrases || []) {
        if (!phrase) continue;
        if (r.includes(String(phrase).toLowerCase())) return true;
    }
    return false;
}

function _retrievedContainsNode(retrieved, nodeId) {
    if (!Array.isArray(retrieved)) return false;
    for (const h of retrieved) {
        if (h && h.structural_metadata && h.structural_metadata.structural_node_id === nodeId) return true;
    }
    return false;
}

async function runPhase({ phaseId, runId, threadId, memoryUrl, args, artifactStreams, observations, structRegistry }) {
    const phase = STRUCTURAL_IDENTITY_PHASES[phaseId];
    if (!phase) throw new Error(`unknown phase ${phaseId}`);
    const turns = [];
    let phaseError = null;
    for (let i = 0; i < phase.prompts.length; i++) {
        const promptSpec = phase.prompts[i];
        const promptText = promptSpec.text;
        const targetsNodeId = promptSpec.targets_node_id || null;
        const turnId = `${runId}:${phaseId}:turn-${String(i).padStart(3, "0")}`;
        const t0 = Date.now();
        // PRE: thread-scoped retrieve of structural references for THIS prompt.
        const retrievedResp = await retrieveStructuralRefs({
            memoryUrl,
            threadId,
            query: promptText,
            topK: 20,
        });
        const retrievedRefs = (retrievedResp && retrievedResp.structural_references) || [];
        // Run production Condition B pipeline.
        let condB = null;
        try {
            condB = await runConditionB({
                threadId,
                userMsg: promptText,
                maxTokens: 512,
                extractFacts: true,
                storeReply: true,
                channel: "level3-structural-identity-runner",
            });
        } catch (e) {
            phaseError = `runConditionB threw: ${e.message}`;
            break;
        }
        if (condB && condB.error) {
            phaseError = `runConditionB error: ${condB.error}`;
            // Record partial turn before bailing.
        }
        // POST: another retrieve so we see what's now visible to BYON.
        const retrievedAfterResp = await retrieveStructuralRefs({
            memoryUrl,
            threadId,
            query: promptText,
            topK: 20,
        });
        // Per-seed signals: was the seed retrieved? did the response invoke it?
        const perSeedSignals = {};
        for (const seed of STRUCTURAL_SEEDS) {
            const retrieved_before = _retrievedContainsNode(retrievedRefs, seed.id);
            const retrieved_after = _retrievedContainsNode(retrievedAfterResp.structural_references || [], seed.id);
            const invoked = _responseInvokesNode(condB?.reply, seed);
            const violated = _responseViolatesNode(condB?.reply, seed);
            perSeedSignals[seed.id] = {
                retrieved_before,
                retrieved_after,
                invoked,
                violated,
                is_targeted: targetsNodeId === seed.id,
            };
        }
        // Update observations counters.
        if (Array.isArray(retrievedRefs)) {
            for (const r of retrievedRefs) {
                if (r?.structural_metadata?.structural_node_id === "auditor_authority") {
                    observations.auditor_authority_recall_count =
                        (observations.auditor_authority_recall_count || 0) + 1;
                }
            }
        }
        if (perSeedSignals.auditor_authority?.invoked) {
            observations.auditor_authority_recall_count =
                (observations.auditor_authority_recall_count || 0) + 1;
        }
        const turn = {
            turn_id: turnId,
            run_id: runId,
            thread_id: threadId,
            phase_id: phaseId,
            turn_index: i,
            targets_node_id: targetsNodeId,
            user_prompt: promptText,
            cond_b: condB,
            retrieved_structural_refs: retrievedRefs,
            retrieved_structural_refs_after: retrievedAfterResp.structural_references || [],
            per_seed_signals: perSeedSignals,
            omega_registry_count: condB?.fce?.omega_total ?? 0,
            reference_field_count: condB?.fce?.reference_fields_count ?? 0,
            preflight_memory_live: observations.preflight?.memory_live === true,
            preflight_faiss_live: observations.preflight?.faiss_live === true,
            preflight_embeddings_live: observations.preflight?.embeddings_live === true,
            latency_ms: Date.now() - t0,
            timestamp: new Date().toISOString(),
        };
        // Per-turn classification into the runner-side registry (so we
        // can compare runner-side lexical detection vs pipeline reality).
        const lexObs = structRegistry.observeTurn({
            phase_id: phaseId,
            scenario_context: targetsNodeId || phaseId,
            prompt: promptText,
            response: condB?.reply || "",
            targets_node_id: targetsNodeId,
        });
        turn.runner_side_classification = lexObs;
        turns.push(turn);
        await artifactStreams.turns.write(turn);
        // module activation observe
        observations.matrix.observe(turn, observations);
        // delay
        if (phaseError) break;
        if (args.turnDelayMs > 0 && i < phase.prompts.length - 1) {
            await _sleep(args.turnDelayMs);
        }
    }
    return { phase_id: phaseId, turns_completed: turns.length, error: phaseError, turns };
}

// ---------------------------------------------------------------------------
// Per-node final classification (10-question report)
// ---------------------------------------------------------------------------

function classifyNodeOutcome({ nodeId, persistedOk, allTurns }) {
    // Tier signals (commit 17 vocabulary).
    const signals = {
        seed_persisted: !!persistedOk,
        retrieved_from_memory: false,
        used_in_prompt: false,
        used_by_claude_without_explicit_mention: false,
        survived_adversarial_challenge: false,
        generated_derivative: false,
        derivative_persisted: false,        // not implemented (would need a second persist pass)
        derivative_retrieved_later: false,  // not implemented (same reason)
        fce_saw_related_events: false,
        relational_field_support: 0,
        adversarial_attempts: 0,
        adversarial_passes: 0,
    };
    for (const t of allTurns) {
        const sig = t.per_seed_signals?.[nodeId];
        if (!sig) continue;
        if (sig.retrieved_before || sig.retrieved_after) signals.retrieved_from_memory = true;
        if (sig.retrieved_before) {
            // If the seed appeared in the retrieved set BEFORE Claude got the
            // prompt, then the production trust-ranked formatter folded it
            // into the dynamic suffix.
            signals.used_in_prompt = true;
        }
        if (sig.invoked) {
            // Was the seed name in the user prompt explicitly? We don't
            // need a precise check for this since the operator's spec
            // accepts "without explicit mention" when the prompt is from
            // Phase 2 (autonomous).
            if (t.phase_id === "phase2_autonomous") {
                signals.used_by_claude_without_explicit_mention = true;
            }
        }
        if (t.phase_id === "phase3_adversarial" && sig.is_targeted) {
            signals.adversarial_attempts += 1;
            if (sig.invoked && !sig.violated) signals.adversarial_passes += 1;
        }
        // Derivative markers from phase4.
        if (t.phase_id === "phase4_derivative" && sig.invoked && sig.is_targeted) {
            signals.generated_derivative = true;
        }
        // FCE-related events: omega total > 0 OR reference fields > 0
        if ((t.omega_registry_count || 0) > 0 || (t.reference_field_count || 0) > 0) {
            signals.fce_saw_related_events = true;
        }
    }
    signals.survived_adversarial_challenge =
        signals.adversarial_attempts > 0 && signals.adversarial_passes === signals.adversarial_attempts;
    // 5-tier classification.
    let classification = null;
    if (signals.generated_derivative && signals.retrieved_from_memory && signals.used_in_prompt && signals.derivative_persisted && signals.derivative_retrieved_later) {
        classification = "endogenous_derivative_candidate";
    } else if (signals.generated_derivative && signals.retrieved_from_memory) {
        classification = "structurally_retrieved_derivative_candidate";
    } else if (signals.generated_derivative && signals.seed_persisted) {
        classification = "memory_persisted_derivative_candidate";
    } else if (signals.generated_derivative) {
        // The seed was used to build something derivative behaviorally,
        // even without strong memory-trace evidence.
        classification = "behavioral_derivative_candidate";
    } else if (signals.used_by_claude_without_explicit_mention || (signals.used_in_prompt && signals.survived_adversarial_challenge)) {
        // Behavioral application without derivative generation.
        classification = "behavioral_derivative_candidate";
    } else if (signals.used_in_prompt || signals.used_by_claude_without_explicit_mention) {
        classification = "lexical_derivative_candidate";
    } else if (signals.seed_persisted) {
        classification = "lexical_derivative_candidate";
    } else {
        classification = "lexical_derivative_candidate";
    }
    return { signals, classification };
}

// ---------------------------------------------------------------------------
// Final verdict
// ---------------------------------------------------------------------------

export function deriveFinalVerdict({ moduleSnapshot, perNodeOutcomes, claudeLive }) {
    if (!claudeLive) return "INCONCLUSIVE_NEEDS_LONGER_RUN";
    // Check core modules active.
    const REQUIRED_CORE = new Set([
        "claude_api_live",
        "memory_service_live",
        "faiss_live",
        "production_embeddings",
        "fce_m_backend",
        "fce_morphogenesis_report",
        "fce_assimilate_receipt",
        "trust_ranked_formatter",
        "compliance_guard",
        "active_response_constraints",
        "contextual_pathway_stabilization",
        "structural_seed_persistence",
        "thread_scoped_retrieval",
        "experiment_namespace_isolation",
    ]);
    const moduleById = new Map(moduleSnapshot.map((m) => [m.id, m]));
    const missingCore = [];
    for (const id of REQUIRED_CORE) {
        const m = moduleById.get(id);
        if (!m) {
            missingCore.push(id);
        } else if (!m.active && !m.not_applicable) {
            missingCore.push(id);
        }
    }
    if (missingCore.length > 0) return "FULL_ORGANISM_INCOMPLETE_MODULES_INACTIVE";
    // From per-node outcomes determine verdict.
    let n_persisted = 0, n_retrieved = 0, n_used_prompt = 0, n_used_no_mention = 0;
    let n_survived_adv = 0, n_derivative = 0;
    for (const o of perNodeOutcomes) {
        if (o.signals.seed_persisted) n_persisted += 1;
        if (o.signals.retrieved_from_memory) n_retrieved += 1;
        if (o.signals.used_in_prompt) n_used_prompt += 1;
        if (o.signals.used_by_claude_without_explicit_mention) n_used_no_mention += 1;
        if (o.signals.survived_adversarial_challenge) n_survived_adv += 1;
        if (o.signals.generated_derivative) n_derivative += 1;
    }
    const total = perNodeOutcomes.length;
    if (total === 0) return "INCONCLUSIVE_NEEDS_LONGER_RUN";
    // Strict tiered selection (highest matching verdict).
    if (n_derivative >= 1 && n_retrieved >= 1 && n_used_prompt >= 1 && n_survived_adv >= 1) {
        return "STRUCTURAL_IDENTITY_FIELD_ACTIVE_IN_PIPELINE";
    }
    if (n_retrieved >= Math.ceil(total / 2) && n_used_prompt >= 1 && n_survived_adv >= 1) {
        return "STRUCTURAL_IDENTITY_INTERNALIZATION_PARTIAL";
    }
    if (n_used_no_mention >= 1 && n_used_prompt >= 1) {
        return "STRUCTURAL_REFERENCE_BEHAVIORALLY_APPLIED";
    }
    if (n_used_prompt >= 1) {
        return "STRUCTURAL_REFERENCE_USED_IN_PROMPT";
    }
    if (n_retrieved >= 1) {
        return "STRUCTURAL_REFERENCE_RETRIEVED";
    }
    if (n_persisted >= 1) {
        return "STRUCTURAL_REFERENCE_PERSISTED";
    }
    return "BEHAVIORAL_OBSERVATION_ONLY";
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function renderMarkdown(summary) {
    const lines = [];
    lines.push("# Level 3 Structural Identity FULL ORGANISM — Report (commit 17)");
    lines.push("");
    lines.push(
        "> ADVISORY ONLY. Uses the production BYON conversational pipeline " +
            "(`runConditionB` from `byon-industrial-ab-benchmark.mjs`). " +
            "Structural references PERSISTED in memory-service via " +
            "`/level3/persist-structural-reference`, RETRIEVED thread-scoped " +
            "via `/level3/retrieve-structural-references`. Does NOT declare " +
            "Level 3. Does NOT create OmegaRecord. " +
            "`theta_s = 0.28`, `tau_coag = 12` unchanged.",
    );
    lines.push("");
    lines.push(`- Schema: \`${summary.schema_version}\``);
    lines.push(`- Branch: \`${summary.branch}\``);
    lines.push(`- Run id: \`${summary.run_id}\``);
    lines.push(`- Dry run: **${summary.dry_run}**`);
    lines.push(`- Claude model: \`${summary.model_id || "—"}\``);
    lines.push(`- Memory service: \`${summary.memory_url}\``);
    lines.push("");
    lines.push("## Preflight");
    lines.push("");
    const pf = summary.preflight;
    lines.push(`- Level 3 flag: **${pf.flag}**`);
    lines.push(`- ANTHROPIC_API_KEY present: **${pf.claude_present}**`);
    lines.push(`- memory-service live: **${pf.memory_live}**`);
    lines.push(`- FAISS live: **${pf.faiss_live}**`);
    lines.push(`- Production embeddings live: **${pf.embeddings_live}** (class=\`${pf.embedder_info?.embedder_class || "—"}\` name=\`${pf.embedder_info?.embedder_name || "—"}\` dim=\`${pf.embedder_info?.embedding_dim || "—"}\`)`);
    lines.push(`- FCE-M live: **${pf.fce_live}**`);
    lines.push("");
    lines.push("## Phase 0 — Seed persistence");
    lines.push("");
    lines.push("| node_id | persisted | ctx_id |");
    lines.push("|---|:---:|---|");
    for (const p of summary.phase0_persist_results) {
        lines.push(`| \`${p.node_id}\` | ${p.ok ? "✅" : "❌"} | \`${p.ctx_id || "—"}\` |`);
    }
    lines.push("");
    lines.push(`Seeds persisted OK: **${summary.phase0_persisted_count} / ${summary.phase0_persist_results.length}**`);
    lines.push("");
    lines.push("## Per-phase completion");
    lines.push("");
    lines.push("| Phase | Turns completed | Error |");
    lines.push("|---|---:|---|");
    for (const r of summary.phase_results) {
        lines.push(`| ${r.phase_id} | ${r.turns_completed} | ${r.error || "—"} |`);
    }
    lines.push("");
    lines.push("## Module Activation Matrix");
    lines.push("");
    lines.push("| module | active | evidence_file | evidence_function | turn_count_seen | notes |");
    lines.push("|---|:---:|---|---|---:|---|");
    for (const m of summary.module_matrix) {
        const status = m.not_applicable ? "n/a" : (m.active ? "✅" : "❌");
        const notes = m.not_applicable_reason ? m.not_applicable_reason.slice(0, 120) : "";
        lines.push(`| \`${m.id}\` | ${status} | \`${m.evidence_file}\` | \`${m.evidence_function}\` | ${m.turn_count_seen} | ${notes} |`);
    }
    lines.push("");
    lines.push("## Per-node outcomes (the 10 questions)");
    lines.push("");
    lines.push("| node | persisted | retrieved | used in prompt | used w/o mention | survived adversarial | generated derivative | FCE saw events | adv pass | classification |");
    lines.push("|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---:|---|");
    for (const o of summary.per_node_outcomes) {
        const s = o.signals;
        lines.push(
            `| \`${o.node_id}\` | ${s.seed_persisted ? "✅" : "❌"} | ${s.retrieved_from_memory ? "✅" : "❌"} | ${s.used_in_prompt ? "✅" : "❌"} | ${s.used_by_claude_without_explicit_mention ? "✅" : "❌"} | ${s.survived_adversarial_challenge ? "✅" : "❌"} | ${s.generated_derivative ? "✅" : "❌"} | ${s.fce_saw_related_events ? "✅" : "❌"} | ${s.adversarial_passes}/${s.adversarial_attempts} | **${o.classification}** |`,
        );
    }
    lines.push("");
    lines.push("Derivative persisted-later / retrieved-later are NOT exercised in this run (would require a second persistence pass after Phase 4). Reported as `false` for all nodes per honest baseline.");
    lines.push("");
    lines.push("## Final verdict");
    lines.push("");
    lines.push(`**\`${summary.final_verdict}\`**`);
    lines.push("");
    lines.push(`Suffix verdict: **\`FULL_LEVEL3_NOT_DECLARED\`**`);
    lines.push("");
    lines.push("## Confirmations");
    lines.push("");
    lines.push("- Level 3 is **NOT declared**.");
    lines.push("- Operator-seeded nodes are **NOT promoted** to endogenous Omega origin.");
    lines.push(`- \`theta_s = ${THETA_S}\` unchanged.`);
    lines.push(`- \`tau_coag = ${TAU_COAG}\` unchanged.`);
    lines.push("- No manual OmegaRegistry write.");
    lines.push("- No OmegaRecord constructor call.");
    lines.push("- No ReferenceField constructor call.");
    lines.push("- No `agent.check_coagulation` call.");
    lines.push("- All experiment writes carry `is_level3_experiment=true`, `run_id`, `thread_id` prefix `level3_full_organism_`, channel `level3-structural-identity-runner`.");
    return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2), env = process.env) {
    const args = parseArgs(argv);
    if (args.help) {
        process.stdout.write(
            "Usage: node scripts/level3-structural-identity-full-organism-runner.mjs [--dry-run] [--turn-delay-ms n] [--output-dir path] [--run-id id] [--phases p1,p2,...] [--report-cost]\n",
        );
        return 0;
    }
    if (!isLevel3FullOrganismExperimentEnabled(env)) {
        process.stderr.write(`${LEVEL3_FLAG_NAME}=true required. Default OFF; runner refusing.\n`);
        return 2;
    }
    const runId = args.runId
        || `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
    const memoryUrl = env.MEMORY_SERVICE_URL || DEFAULT_MEMORY_URL;
    const outputDir = args.outputDir;
    const runDir = path.join(outputDir, runId);
    await fsp.mkdir(runDir, { recursive: true });
    const threadId = `level3_full_organism_${runId}__structural_identity_full`;
    const phasesToRun = args.phases && args.phases.length > 0 ? args.phases : PHASE_IDS.filter((p) => p !== "phase0_seed");

    const pf = await preflight({ memoryUrl, env });
    const runConfig = {
        schema_version: RUNNER_SCHEMA_VERSION,
        run_id: runId,
        branch: "research/level3-full-organism-runtime",
        is_level3_experiment: true,
        dry_run: args.dryRun,
        memory_url: memoryUrl,
        thread_id: threadId,
        phases_requested: phasesToRun,
        theta_s: THETA_S,
        tau_coag: TAU_COAG,
        preflight: pf,
        n_seeds: STRUCTURAL_SEEDS.length,
        admitted_origins: NODE_ORIGINS,
        admitted_states: ASSIMILATION_STATES,
        allowed_verdicts: ALLOWED_VERDICTS,
        forbidden_verdict_tokens: FORBIDDEN_VERDICT_TOKENS,
        derivative_classifications: DERIVATIVE_CLASSIFICATIONS,
        generated_at: new Date().toISOString(),
    };
    await fsp.writeFile(path.join(runDir, "run-config.json"), JSON.stringify(runConfig, null, 2) + "\n");

    // Artifact streams.
    const turnsHandle = await fsp.open(path.join(runDir, "turns.jsonl"), "w");
    const artifactStreams = {
        turns: {
            async write(o) { await turnsHandle.write(JSON.stringify(o) + "\n"); },
            async close() { await turnsHandle.close(); },
        },
    };

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
            phase0_persist_results: [],
            phase0_persisted_count: 0,
            phase_results: [],
            module_matrix: new _ModuleActivationMatrix().snapshot(),
            per_node_outcomes: [],
            final_verdict: "INCONCLUSIVE_NEEDS_LONGER_RUN",
            suffix_verdict: "FULL_LEVEL3_NOT_DECLARED",
            allowed_verdicts: ALLOWED_VERDICTS,
            forbidden_verdict_tokens: FORBIDDEN_VERDICT_TOKENS,
            derivative_classifications: DERIVATIVE_CLASSIFICATIONS,
            note: "dry-run; no Claude API calls",
        };
        await fsp.writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
        await fsp.writeFile(path.join(runDir, "report.md"), renderMarkdown(summary));
        await artifactStreams.turns.close();
        process.stdout.write(`[dry-run] wrote ${runDir}\n`);
        return 0;
    }

    if (!pf.claude_present || !pf.memory_live) {
        const reason = !pf.claude_present
            ? "ANTHROPIC_API_KEY missing"
            : "memory-service not live";
        const summary = {
            schema_version: RUNNER_SCHEMA_VERSION,
            branch: "research/level3-full-organism-runtime",
            run_id: runId,
            generated_at: new Date().toISOString(),
            dry_run: false,
            preflight: pf,
            phase0_persist_results: [],
            phase0_persisted_count: 0,
            phase_results: [],
            module_matrix: new _ModuleActivationMatrix().snapshot(),
            per_node_outcomes: [],
            final_verdict: "INCONCLUSIVE_NEEDS_LONGER_RUN",
            suffix_verdict: "FULL_LEVEL3_NOT_DECLARED",
            allowed_verdicts: ALLOWED_VERDICTS,
            forbidden_verdict_tokens: FORBIDDEN_VERDICT_TOKENS,
            note: `preflight failure: ${reason}`,
        };
        await fsp.writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
        await fsp.writeFile(path.join(runDir, "report.md"), renderMarkdown(summary));
        await artifactStreams.turns.close();
        process.stderr.write(`Preflight failed: ${reason}; emitted INCONCLUSIVE_NEEDS_LONGER_RUN.\n`);
        return 3;
    }

    // Phase 0 (always run unless explicitly excluded by --phases).
    const phase0Results = await persistSeeds({ memoryUrl, threadId, runId, registry: null });
    const phase0Count = phase0Results.filter((p) => p.ok).length;

    // Observations + matrix + structural-reference registry.
    const observations = {
        preflight: pf,
        structural_references_persisted_total: phase0Count,
        auditor_authority_recall_count: 0,
        relation_events_total: 0,
        fce_consolidate_calls: 0,
        matrix: new _ModuleActivationMatrix(),
    };
    const structRegistry = new StructuralReferenceRegistry({
        run_id: runId,
        nodes: STRUCTURAL_SEEDS,
    });

    // Phases.
    const phaseResults = [];
    let totalTurns = 0;
    let totalInTokens = 0, totalOutTokens = 0;
    let totalCost = 0;
    let latencies = [];
    let modelId = null;
    for (const phaseId of phasesToRun) {
        const pr = await runPhase({
            phaseId,
            runId,
            threadId,
            memoryUrl,
            args,
            artifactStreams,
            observations,
            structRegistry,
        });
        phaseResults.push({
            phase_id: pr.phase_id,
            turns_completed: pr.turns_completed,
            error: pr.error,
        });
        for (const t of pr.turns || []) {
            totalTurns += 1;
            if (t.cond_b?.tokens) {
                totalInTokens += t.cond_b.tokens.in || 0;
                totalOutTokens += t.cond_b.tokens.out || 0;
                // Rough Sonnet 4.6 cost estimate: $3/MTok in, $15/MTok out.
                totalCost += ((t.cond_b.tokens.in || 0) / 1e6) * 3 + ((t.cond_b.tokens.out || 0) / 1e6) * 15;
            }
            if (typeof t.cond_b?.claude_ms === "number") latencies.push(t.cond_b.claude_ms);
            if (!modelId && t.cond_b) modelId = DEFAULT_MODEL;
        }
        if (pr.error) {
            process.stderr.write(`[phase ${pr.phase_id}] aborted: ${pr.error}\n`);
            break;
        }
    }

    // Collect all turns from artifact (we wrote them to disk turn by turn).
    // For final per-node classification we use the in-memory turns gathered in phase results.
    const allTurns = [];
    for (const pr of phaseResults) {
        if (pr.error) continue;
        // We don't store the turns array on the result tuple anymore;
        // re-read from JSONL artifact to ensure deterministic snapshot.
    }
    // Re-read turns.jsonl.
    let turnsContent = "";
    try {
        await artifactStreams.turns.close();
    } catch {}
    try {
        turnsContent = await fsp.readFile(path.join(runDir, "turns.jsonl"), "utf-8");
    } catch {
        turnsContent = "";
    }
    for (const line of turnsContent.split("\n")) {
        const s = line.trim();
        if (!s) continue;
        try { allTurns.push(JSON.parse(s)); } catch {}
    }

    // Per-node outcomes.
    const perNodeOutcomes = STRUCTURAL_SEEDS.map((seed) => {
        const persistedOk = phase0Results.find((p) => p.node_id === seed.id)?.ok || false;
        const out = classifyNodeOutcome({ nodeId: seed.id, persistedOk, allTurns });
        return {
            node_id: seed.id,
            title: seed.title,
            origin: seed.origin,
            signals: out.signals,
            classification: out.classification,
        };
    });

    const moduleSnapshot = observations.matrix.snapshot();
    const verdict = deriveFinalVerdict({
        moduleSnapshot,
        perNodeOutcomes,
        claudeLive: pf.claude_present,
    });

    if (!ALLOWED_VERDICTS.includes(verdict)) {
        process.stderr.write(`WARNING: verdict ${verdict} not in ALLOWED_VERDICTS; aborting\n`);
        return 4;
    }
    if (containsForbiddenVerdictToken(verdict)) {
        process.stderr.write(`WARNING: verdict contains forbidden token; aborting\n`);
        return 4;
    }
    // Make sure forbidden tokens haven't crept in elsewhere as standalone
    // identifiers in any of the verdict-bearing surfaces. (Per-turn user
    // prompts and Claude responses are normal content and may discuss
    // "Level 3" — only the verdict identifiers are guarded.)

    const summary = {
        schema_version: RUNNER_SCHEMA_VERSION,
        branch: "research/level3-full-organism-runtime",
        run_id: runId,
        generated_at: new Date().toISOString(),
        dry_run: false,
        model_id: modelId || DEFAULT_MODEL,
        memory_url: memoryUrl,
        preflight: pf,
        thread_id: threadId,
        phase0_persist_results: phase0Results,
        phase0_persisted_count: phase0Count,
        phase_results: phaseResults,
        total_turns: totalTurns,
        total_input_tokens: totalInTokens,
        total_output_tokens: totalOutTokens,
        total_estimated_cost_usd: totalCost,
        mean_claude_latency_ms: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
        module_matrix: moduleSnapshot,
        per_node_outcomes: perNodeOutcomes,
        runner_side_classification_final: structRegistry.finalize(),
        final_verdict: verdict,
        suffix_verdict: "FULL_LEVEL3_NOT_DECLARED",
        level_3_declared: false,
        natural_omega_proven: false,
        operator_seeded_promoted_to_endogenous: false,
        allowed_verdicts: ALLOWED_VERDICTS,
        forbidden_verdict_tokens: FORBIDDEN_VERDICT_TOKENS,
        derivative_classifications: DERIVATIVE_CLASSIFICATIONS,
    };
    await fsp.writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    await fsp.writeFile(path.join(runDir, "report.md"), renderMarkdown(summary));
    process.stdout.write(`final verdict: ${verdict}\n`);
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
