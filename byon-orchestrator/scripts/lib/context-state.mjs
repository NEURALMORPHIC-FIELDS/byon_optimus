/**
 * BYON Optimus v0.6.9 — Contextual Pathway Stabilization
 * =======================================================
 *
 * Implements:
 *   - ActiveContextState (per-thread, in-memory)
 *   - Domain / subdomain / task-mode classifier (centroid + entropy)
 *   - Stabilization detector (COLD → STABILIZING → WARM)
 *   - Drift detector (WARM → COLD on domain change / adversarial / etc.)
 *   - Memory route planner (which trust tiers to render per phase)
 *   - Always-on rails (SYSTEM_CANONICAL / DISPUTED_OR_UNSAFE / adversarial)
 *   - Directly-relevant unsuppression (decision D7)
 *
 * Design contract: `docs/CONTEXTUAL_PATHWAY_STABILIZATION_v0.6.9.md`
 *
 * Critical guarantees:
 *   1. SYSTEM_CANONICAL and DISPUTED_OR_UNSAFE are ALWAYS in active_routes.
 *   2. Adversarial pattern detection ALWAYS triggers full reopen to COLD.
 *   3. Directly-relevant operator/domain facts cannot be suppressed even in
 *      WARM (§4.7 unsuppression rule).
 *   4. False-stabilization protection: confidence ≥ 0.70 AND entropy ≤ 1.5
 *      AND minimum 2 cold turns AND a confirmation turn before WARM.
 *   5. θ_s = 0.28 and τ_coag = 12 are NOT touched here.
 *   6. State is in-memory only. Restart returns every thread to COLD.
 *
 * This module is pure JS (no LLM calls). The only external dependency is the
 * memory-service `embed` action (re-uses FAISS's all-MiniLM-L6-v2 embedder).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { detectAdversarialPattern, TRUST } from "./fact-extractor.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTOTYPES_PATH = join(__dirname, "..", "..", "config", "context-domain-prototypes.json");

// ---------------------------------------------------------------------------
// Prototype loader (lazy + cached)
// ---------------------------------------------------------------------------

let _prototypesConfig = null;
let _prototypeEmbeddings = null;  // domain_id -> Float32Array(384)

export function loadPrototypesConfig() {
    if (_prototypesConfig) return _prototypesConfig;
    const raw = readFileSync(PROTOTYPES_PATH, "utf8");
    _prototypesConfig = JSON.parse(raw);
    return _prototypesConfig;
}

/**
 * Compute / cache prototype centroids by calling the memory-service `embed`
 * endpoint once per prototype. Done lazily on first stabilization check.
 *
 * @param {(payload: object) => Promise<{ok: boolean, body: any}>} memCall
 * @returns {Promise<Map<string, number[]>>}
 */
export async function ensurePrototypeEmbeddings(memCall) {
    if (_prototypeEmbeddings) return _prototypeEmbeddings;
    const cfg = loadPrototypesConfig();
    const texts = cfg.prototypes.map(p => p.prototype_text);
    const r = await memCall({ action: "embed_batch", texts });
    if (!r.ok || !Array.isArray(r.body?.embeddings)) {
        throw new Error("ensurePrototypeEmbeddings: embed_batch failed");
    }
    _prototypeEmbeddings = new Map();
    cfg.prototypes.forEach((p, i) => {
        _prototypeEmbeddings.set(p.domain_id, r.body.embeddings[i]);
    });
    return _prototypeEmbeddings;
}

/** Test-only reset hook. */
export function _resetPrototypeCache() {
    _prototypesConfig = null;
    _prototypeEmbeddings = null;
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

// Softmax temperature for the prototype-similarity → confidence mapping.
// 0.07 is peaky enough that a clear cosine-leader (gap ≥ 0.15 over runner-up)
// maps to softmax probability ≥ 0.70 — matching the operator-locked confidence
// threshold (D2). Ambiguous cases (margin < 0.08) stay below threshold AND
// high entropy, so they correctly remain COLD.
const SOFTMAX_TEMPERATURE = 0.07;

function cosineSimilarity(a, b) {
    const n = Math.min(a.length, b.length);
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < n; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom > 0 ? dot / denom : 0;
}

function averageVectors(vectors) {
    if (vectors.length === 0) return null;
    const n = vectors[0].length;
    const out = new Array(n).fill(0);
    for (const v of vectors) {
        for (let i = 0; i < n; i++) out[i] += v[i];
    }
    for (let i = 0; i < n; i++) out[i] /= vectors.length;
    return out;
}

function softmaxSimilarities(sims, temperature = 1.0) {
    const m = Math.max(...sims);
    const exps = sims.map(s => Math.exp((s - m) / temperature));
    const z = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / (z || 1));
}

function shannonEntropy(probs) {
    let h = 0;
    for (const p of probs) {
        if (p > 0) h -= p * Math.log2(p);
    }
    return h;
}

// ---------------------------------------------------------------------------
// Per-thread state
// ---------------------------------------------------------------------------

const THREAD_STATE = new Map();
const STATE_LRU_MAX = parseInt(process.env.BYON_CONTEXT_LRU_MAX || "1000", 10);

const DEFAULT_THRESHOLDS = {
    cold_turns_required: 2,
    stable_turns_required: 2,
    confidence_min: 0.70,
    entropy_max_bits: 1.5,
    drift_score_threshold: 0.5,
    drift_confidence_min: 0.6,
    warm_sanity_check_every_n_turns: 5,
    adversarial_reopen_min_turns: 3,
};

function freshState(threadId, thresholds) {
    return {
        threadId,
        phase: "cold",
        domain: null,
        subdomain: null,
        task_mode: "unknown",
        topic_center: null,
        topic_center_set_at_turn: null,
        confidence: 0,
        entropy: Infinity,
        stabilized: false,
        active_routes: [],
        suppressed_routes: [],
        drift_score: 0,
        drift_triggered_at_turn: null,
        turn_count: 0,
        turn_count_since_stabilization: 0,
        cold_turns_required: thresholds.cold_turns_required,
        stable_turns_required: thresholds.stable_turns_required,
        // private bookkeeping
        _recent_query_embeddings: [],     // last N user-turn embeddings
        _candidate_stable_streak: 0,      // consecutive turns matching candidate (for confirmation)
        _candidate_domain: null,
        _candidate_subdomain: null,
        _candidate_task_mode: null,
        _last_seen: Date.now(),
        _adversarial_reopen_until_turn: 0,
        // v0.6.9.1: sticky high-water mark for the phase machine. Used by
        // Gate 27 to distinguish "drift failure" from "stabilization not
        // reached". Once a thread reaches "warm" it sets this; even after
        // a drift reset it stays so a later "no drift fired" decision can
        // be classified as a real failure rather than a never-warm case.
        _highest_phase_reached: "cold",
    };
}

export function getActiveContext(threadId, thresholds = DEFAULT_THRESHOLDS) {
    if (!THREAD_STATE.has(threadId)) {
        if (THREAD_STATE.size >= STATE_LRU_MAX) {
            let oldestKey = null, oldestTime = Infinity;
            for (const [k, v] of THREAD_STATE) {
                if (v._last_seen < oldestTime) {
                    oldestTime = v._last_seen;
                    oldestKey = k;
                }
            }
            if (oldestKey) THREAD_STATE.delete(oldestKey);
        }
        THREAD_STATE.set(threadId, freshState(threadId, thresholds));
    }
    const s = THREAD_STATE.get(threadId);
    s._last_seen = Date.now();
    return s;
}

export function resetContext(threadId, reason = "manual") {
    const s = THREAD_STATE.get(threadId);
    if (!s) return;
    const thresholds = {
        cold_turns_required: s.cold_turns_required,
        stable_turns_required: s.stable_turns_required,
    };
    const fresh = freshState(threadId, { ...DEFAULT_THRESHOLDS, ...thresholds });
    fresh.turn_count = s.turn_count;        // preserve cumulative turn counter
    // v0.6.9.1: high-water mark is preserved across drift resets so Gate 27
    // can tell whether this thread EVER reached WARM (the drift reset
    // itself goes cold, but the historical fact stays).
    fresh._highest_phase_reached = s._highest_phase_reached || s.phase;
    fresh._reset_reason = reason;
    THREAD_STATE.set(threadId, fresh);
    return fresh;
}

/** Test-only hook. */
export function _resetAllThreadState() {
    THREAD_STATE.clear();
}

// ---------------------------------------------------------------------------
// Task-mode heuristics (lightweight regex; no LLM call)
// ---------------------------------------------------------------------------

const TASK_MODE_PATTERNS = {
    citation: [
        /\b(citează|citeaza|cit?ation|source|surs[aă]|conform\s+(art|articolul|paragrap)|spune\s+exact|exact\s+ce\s+sp)/i,
        /\b(reglement|standard|norm[aă]|directive|article)\s+\w+/i,
    ],
    refusal: [
        /\b(este\s+(corect|legal|permis)|îmi\s+poți\s+da\s+token|publish.+token|ignora|bypass)/i,
        /\bpot\s+(public|trimite|disclose)/i,
    ],
    "adversarial-test": [
        /\b(memorează|memorize|salvează\s+ca\s+regul|această\s+regul|această\s+memori|salvează\s+ca\s+adevăr|această\s+arhitect|aceasta\s+arhitect|memori[ae]\s+pozitiv|memori[ae]\s+permanent|consideră\s+aceasta)/i,
        /\b(prompt[\s_-]?injection|jailbreak|system\s+override)/i,
    ],
    code: [
        /\b(function|class|module|import|export|def\s|let\s|const\s|var\s)/,
        /```[a-z]*\n/,
    ],
};

export function classifyTaskMode(userText) {
    if (!userText) return "unknown";
    if (detectAdversarialPattern(userText)) return "adversarial-test";
    for (const [mode, patterns] of Object.entries(TASK_MODE_PATTERNS)) {
        for (const rx of patterns) {
            if (rx.test(userText)) return mode;
        }
    }
    return "qa";
}

// ---------------------------------------------------------------------------
// Subdomain / jurisdiction extraction (regex pass)
// ---------------------------------------------------------------------------

const JURISDICTION_PATTERNS = [
    { hint: "Germany/Bavaria",  rx: /\b(bavaria|bayern|m[uü]nchen|germania|germany|deutschland|din\s+\d|bavarez)/i },
    { hint: "Germany",          rx: /\b(german|deutschland|deutsche?)\b/i },
    { hint: "Romania",          rx: /\b(rom[aâ]nia|rom[aâ]n[ăa]?|p[\s-]?100|i?\s?dn?p?\s?\d|bucure[șs]ti|cluj|timi[șs])/i },
    { hint: "EU",               rx: /\b(eu|uniunea\s+european[ăa]|directive|gdpr|eu[\-\s]ets|ai\s+act|ec[2-9])\b/i },
    { hint: "international",    rx: /\b(iso\s+\d|onu\b|\bUN\b|wto\b|international\s+standard)/i },
];

export function extractSubdomain(text) {
    if (!text) return null;
    for (const j of JURISDICTION_PATTERNS) {
        if (j.rx.test(text)) return j.hint;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Classifier — embed user turn, compute (domain, confidence, entropy)
// ---------------------------------------------------------------------------

/**
 * Classify a query embedding against the cached prototype centroids.
 * Pure function — no I/O. Used both for single-turn classification and for
 * classifying the centroid of the last N user turns (the design doc §5.1
 * "embedding centroid agreement" signal).
 */
export function classifyVector(queryVec, protoMap, cfg) {
    if (!Array.isArray(queryVec) && !(queryVec instanceof Float32Array)) {
        return {
            domain_id: cfg.default_domain_id,
            confidence: 0,
            raw_cosine_top1: 0,
            entropy: Infinity,
            distribution: [],
            query_embedding: null,
        };
    }
    const sims = [];
    const ids = [];
    for (const p of cfg.prototypes) {
        const centroid = protoMap.get(p.domain_id);
        if (!centroid) continue;
        sims.push(cosineSimilarity(queryVec, centroid));
        ids.push(p.domain_id);
    }
    if (sims.length === 0) {
        return {
            domain_id: cfg.default_domain_id,
            confidence: 0,
            raw_cosine_top1: 0,
            entropy: Infinity,
            distribution: [],
            query_embedding: queryVec,
        };
    }
    const probs = softmaxSimilarities(sims, SOFTMAX_TEMPERATURE);
    const entropy = shannonEntropy(probs);
    let topIdx = 0;
    for (let i = 1; i < probs.length; i++) {
        if (probs[i] > probs[topIdx]) topIdx = i;
    }
    return {
        domain_id: ids[topIdx],
        confidence: probs[topIdx],
        raw_cosine_top1: sims[topIdx],
        entropy,
        distribution: ids.map((id, i) => ({ domain_id: id, similarity: sims[i], prob: probs[i] })),
        query_embedding: queryVec,
    };
}

/**
 * @param {string} userText
 * @param {(payload: object) => Promise<{ok: boolean, body: any}>} memCall
 * @returns {Promise<{domain_id: string, confidence: number, entropy: number,
 *                   distribution: Array<{domain_id: string, similarity: number, prob: number}>,
 *                   query_embedding: number[]}>}
 */
export async function classifyDomain(userText, memCall) {
    const cfg = loadPrototypesConfig();
    const protoMap = await ensurePrototypeEmbeddings(memCall);

    // Embed the user text via the memory-service endpoint.
    const r = await memCall({ action: "embed", text: userText || "" });
    if (!r.ok || !Array.isArray(r.body?.embedding)) {
        // Embed failure → return unknown with infinite entropy so we stay COLD.
        return {
            domain_id: cfg.default_domain_id,
            confidence: 0,
            entropy: Infinity,
            distribution: [],
            query_embedding: null,
        };
    }
    const queryVec = r.body.embedding;

    // Cosine similarity against each prototype centroid.
    const sims = [];
    const ids = [];
    for (const p of cfg.prototypes) {
        const centroid = protoMap.get(p.domain_id);
        if (!centroid) continue;
        sims.push(cosineSimilarity(queryVec, centroid));
        ids.push(p.domain_id);
    }
    if (sims.length === 0) {
        return {
            domain_id: cfg.default_domain_id,
            confidence: 0,
            entropy: Infinity,
            distribution: [],
            query_embedding: queryVec,
        };
    }

    // Softmax over similarities (temperature 0.1 — peaky enough to give a clear
    // leader when one prototype clearly dominates, conservative enough to keep
    // entropy high on ambiguous queries).
    const probs = softmaxSimilarities(sims, SOFTMAX_TEMPERATURE);
    const entropy = shannonEntropy(probs);

    // Top-1 by softmax probability. Design doc §5.1 prescribes top-1
    // confidence + Shannon entropy "over normalised similarities" — the
    // internally-consistent reading is that BOTH come from the same
    // normalised distribution (softmax probs), so top-1 prob = confidence.
    // The operator-locked threshold (D2) is 0.70 on this same probability.
    let topIdx = 0;
    for (let i = 1; i < probs.length; i++) {
        if (probs[i] > probs[topIdx]) topIdx = i;
    }

    return {
        domain_id: ids[topIdx],
        confidence: probs[topIdx],
        raw_cosine_top1: sims[topIdx],
        entropy,
        distribution: ids.map((id, i) => ({ domain_id: id, similarity: sims[i], prob: probs[i] })),
        query_embedding: queryVec,
    };
}

// ---------------------------------------------------------------------------
// Stabilization detector
// ---------------------------------------------------------------------------

/**
 * Inspects whether COLD/STABILIZING should advance to WARM this turn.
 * Mutates state in place. Returns the new phase.
 */
export function applyStabilizationRule(state, classification, opts = {}) {
    const T = { ...DEFAULT_THRESHOLDS, ...opts };
    const meetsConfidence = classification.confidence >= T.confidence_min;
    const meetsEntropy = classification.entropy <= T.entropy_max_bits;
    const meetsMinTurns = state.turn_count >= T.cold_turns_required;

    state.confidence = classification.confidence;
    state.entropy = classification.entropy;

    if (state.turn_count < T.adversarial_reopen_min_turns
        && state._adversarial_reopen_until_turn > 0
        && state.turn_count < state._adversarial_reopen_until_turn) {
        state.phase = "cold";
        return state.phase;
    }

    if (!meetsConfidence || !meetsEntropy || !meetsMinTurns) {
        if (state.phase === "stabilizing") {
            // 1-turn noise tolerance: consume the budget once. A second
            // sub-threshold turn in a row resets to COLD. Hard signals
            // (adversarial / explicit drift) still reset immediately —
            // those are handled by the drift detector, not this branch.
            state._stab_noise_budget = (state._stab_noise_budget ?? 1);
            if (state._stab_noise_budget > 0 && meetsMinTurns) {
                state._stab_noise_budget -= 1;
                return state.phase;     // stay STABILIZING for one bad turn
            }
            state.phase = "cold";
            state._candidate_stable_streak = 0;
            state._candidate_domain = null;
            state._candidate_subdomain = null;
            state._candidate_task_mode = null;
            state._stab_noise_budget = 1;
        }
        return state.phase;
    }
    state._stab_noise_budget = 1;   // refill on clean turn

    const candidateDomain = classification.domain_id;
    const candidateSubdomain = state._candidate_subdomain || state.subdomain;
    const candidateTaskMode = state._candidate_task_mode || state.task_mode;

    if (state.phase === "cold") {
        state.phase = "stabilizing";
        state._candidate_domain = candidateDomain;
        state._candidate_subdomain = candidateSubdomain;
        state._candidate_task_mode = candidateTaskMode;
        state._candidate_stable_streak = 1;
        return state.phase;
    }

    if (state.phase === "stabilizing") {
        // v0.6.9.1: high-water mark
        if (state._highest_phase_reached === "cold") state._highest_phase_reached = "stabilizing";
        const sameCandidate = state._candidate_domain === candidateDomain;
        if (!sameCandidate) {
            state._candidate_domain = candidateDomain;
            state._candidate_subdomain = candidateSubdomain;
            state._candidate_task_mode = candidateTaskMode;
            state._candidate_stable_streak = 1;
            return state.phase;
        }
        state._candidate_stable_streak += 1;
        if (state._candidate_stable_streak >= T.stable_turns_required) {
            state.phase = "warm";
            state.domain = candidateDomain;
            state.subdomain = candidateSubdomain;
            state.task_mode = candidateTaskMode;
            state.stabilized = true;
            state.topic_center = averageVectors(state._recent_query_embeddings.slice(-3));
            state.topic_center_set_at_turn = state.turn_count;
            state.turn_count_since_stabilization = 0;
            state._highest_phase_reached = "warm";   // v0.6.9.1: high-water mark
        }
        return state.phase;
    }

    return state.phase;
}

// ---------------------------------------------------------------------------
// Drift detection
// ---------------------------------------------------------------------------

const EXPLICIT_TOPIC_SWITCH_RX =
    /\b(acum vorbim|let's switch|schimb[ăa]m\s+subiectul|change topic|new question|altă\s+întrebare|alt[ăa]\s+subiect|on\s+a\s+different\s+note)\b/i;

/**
 * Returns {triggered: boolean, trigger: string|null, hardness: "soft"|"hard"}.
 * Soft drift fires only after 2 consecutive soft signals (noise tolerance).
 * Hard drift fires immediately.
 */
export function checkDrift(state, userText, classification, opts = {}) {
    const T = { ...DEFAULT_THRESHOLDS, ...opts };

    // v0.6.9.1: adversarial pattern triggers a reopen / drift event from ANY
    // phase (cold, stabilizing, or warm). The planner downstream forces
    // full COLD on `_adversarial_reopen_until_turn`, but the drift event
    // itself must still be emitted as telemetry so Gate 26 can observe it.
    if (detectAdversarialPattern(userText)) {
        return { triggered: true, trigger: "adversarial_pattern", hardness: "hard" };
    }
    // v0.6.9.1: the task-mode classifier may flag an `adversarial-test` turn
    // even when the named pattern dictionary misses (covers more flexible
    // phrasings). Treat that as a drift event too, so the telemetry is
    // never silent on a clearly adversarial input.
    if (classifyTaskMode(userText) === "adversarial-test") {
        return { triggered: true, trigger: "adversarial_pattern", hardness: "hard" };
    }

    if (state.phase !== "warm") {
        return { triggered: false, trigger: null, hardness: null };
    }

    // ---- Hard triggers (always fire) ----
    if (EXPLICIT_TOPIC_SWITCH_RX.test(userText)) {
        return { triggered: true, trigger: "explicit_user_correction", hardness: "hard" };
    }

    const newSubdomain = extractSubdomain(userText);
    if (newSubdomain && state.subdomain && newSubdomain !== state.subdomain) {
        const sameRegion = (newSubdomain.startsWith(state.subdomain) || state.subdomain.startsWith(newSubdomain));
        if (!sameRegion) {
            return { triggered: true, trigger: "jurisdiction_mismatch", hardness: "hard" };
        }
    }

    // ---- Soft triggers (need a 2nd matching turn to fire) ----
    let softSignal = null;
    if (classification.domain_id !== state.domain
        && classification.confidence >= T.drift_confidence_min) {
        softSignal = "domain_change";
    } else if (state.topic_center && classification.query_embedding) {
        const sim = cosineSimilarity(state.topic_center, classification.query_embedding);
        const driftScore = 1 - sim;
        state.drift_score = driftScore;
        if (driftScore > T.drift_score_threshold) {
            softSignal = "drift_score";
        }
    }

    const newTaskMode = classifyTaskMode(userText);
    if (!softSignal && state.task_mode && newTaskMode !== state.task_mode
        && newTaskMode !== "unknown") {
        softSignal = "task_mode_change";
    }

    if (softSignal) {
        state._soft_drift_streak = (state._soft_drift_streak || 0) + 1;
        state._soft_drift_signal = softSignal;
        if (state._soft_drift_streak >= 2) {
            state._soft_drift_streak = 0;
            return { triggered: true, trigger: softSignal, hardness: "soft" };
        }
    } else {
        state._soft_drift_streak = 0;
        state._soft_drift_signal = null;
    }

    return { triggered: false, trigger: null, hardness: null };
}

// ---------------------------------------------------------------------------
// Memory route planner — deterministic map from state → render plan
// ---------------------------------------------------------------------------

const ALWAYS_ON = ["trust:SYSTEM_CANONICAL", "trust:DISPUTED_OR_UNSAFE"];

const ALL_ROUTES = [
    "trust:SYSTEM_CANONICAL",
    "trust:VERIFIED_PROJECT_FACT",
    "trust:DOMAIN_VERIFIED",
    "trust:USER_PREFERENCE",
    "trust:EXTRACTED_USER_CLAIM",
    "trust:DISPUTED_OR_UNSAFE",
    "conversation:thread",
    "conversation:global",
    "fce:summary",
];

function dedup(arr) {
    return Array.from(new Set(arr));
}

export function planMemoryRoutes(state, opts = {}) {
    const cfg = loadPrototypesConfig();
    const { force_full_cold = false } = opts;

    // COLD / STABILIZING: everything open.
    if (force_full_cold || state.phase === "cold" || state.phase === "stabilizing") {
        return {
            phase: state.phase,
            search_filters: {
                scope: "thread",
                domain: null,
                jurisdiction: null,
                max_hits_per_tier: { SYSTEM_CANONICAL: 8, VERIFIED_PROJECT_FACT: 8, DOMAIN_VERIFIED: 8,
                                     USER_PREFERENCE: 8, EXTRACTED_USER_CLAIM: 8, DISPUTED_OR_UNSAFE: 8 },
            },
            render_blocks: ALL_ROUTES.slice(),
            suppressed_routes: [],
            fce_mode: state.phase === "stabilizing" ? "medium" : "full",
            reason: `phase=${state.phase}, full retrieval`,
        };
    }

    // WARM: look up the prototype's narrowing recipe.
    const proto = cfg.prototypes.find(p => p.domain_id === state.domain);
    if (!proto) {
        return planMemoryRoutes({ ...state, phase: "cold" }, opts);
    }

    if (proto.force_full_cold_on_task_modes
        && proto.force_full_cold_on_task_modes.includes(state.task_mode)) {
        return {
            phase: "cold",
            search_filters: {
                scope: "thread",
                domain: null,
                jurisdiction: null,
                max_hits_per_tier: { SYSTEM_CANONICAL: 8, VERIFIED_PROJECT_FACT: 8, DOMAIN_VERIFIED: 8,
                                     USER_PREFERENCE: 8, EXTRACTED_USER_CLAIM: 8, DISPUTED_OR_UNSAFE: 8 },
            },
            render_blocks: ALL_ROUTES.slice(),
            suppressed_routes: [],
            fce_mode: "full",
            reason: `domain=${state.domain}, task_mode=${state.task_mode} forces full cold (defense-in-depth)`,
        };
    }

    const taskKey = state.task_mode === "citation"
        ? "active_routes_warm_citation"
        : "active_routes_warm_qa";
    const active = proto[taskKey] || proto.active_routes_warm_qa || [];
    const renderBlocks = dedup([...ALWAYS_ON, ...active]);
    const suppressed = ALL_ROUTES.filter(r => !renderBlocks.includes(r));

    const domainFilter = proto.domain_verified_filter || null;

    return {
        phase: "warm",
        search_filters: {
            scope: "thread",
            domain: domainFilter,
            jurisdiction: state.subdomain || null,
            // v0.6.9.1: tighter intra-tier caps in WARM. Operator-set per
            // v0.6.9.1 §4. SYSTEM_CANONICAL and DISPUTED_OR_UNSAFE remain
            // always-on with their full counts (defense in depth); the
            // narrowed tiers cap to {3, 3, 2, 2} so the dynamic suffix
            // actually shrinks rather than just dropping tier headers.
            max_hits_per_tier: {
                SYSTEM_CANONICAL: 8,
                VERIFIED_PROJECT_FACT: 3,
                DOMAIN_VERIFIED: 3,
                USER_PREFERENCE: 2,
                EXTRACTED_USER_CLAIM: 2,
                DISPUTED_OR_UNSAFE: 8,
            },
            // v0.6.9.1: compaction directives the dynamic-suffix builder
            // honours. Conversation excerpts only appear if directly
            // relevant; ACTIVE RESPONSE CONSTRAINTS uses its short form
            // when no compliance violation was detected recently.
            warm_compaction: {
                conversation_excerpts: "directly_relevant_only",
                active_constraints: "compact_unless_violation",
                fce_summary: "deltas_only",
                system_canonical: "compact",
                disputed_unsafe: "compact_unless_relevant",
            },
        },
        render_blocks: renderBlocks,
        suppressed_routes: suppressed,
        fce_mode: "light_cached",
        reason: `warm on ${state.domain}/${state.subdomain || "—"}/${state.task_mode}`,
    };
}

// ---------------------------------------------------------------------------
// D7 — directly-relevant unsuppression rule (§4.7)
// ---------------------------------------------------------------------------

/**
 * If WARM is suppressing some trust tier but the current query is directly
 * about an operator-verified or domain-verified fact in that tier, force-include
 * it in render_blocks for this turn. Returns the events for telemetry.
 *
 * @param {object} plan          — planMemoryRoutes() output (mutated in place)
 * @param {Array}  topHits       — array of FAISS hits (with `metadata.trust`, `metadata.domain`)
 * @param {object} state         — current ActiveContextState
 * @returns {Array} unsuppression_events
 */
export function applyDirectlyRelevantUnsuppression(plan, topHits, state) {
    if (plan.phase !== "warm") return [];
    if (!Array.isArray(topHits) || topHits.length === 0) return [];

    const events = [];
    const forceIncludeTiers = new Set([TRUST.VERIFIED_PROJECT_FACT, TRUST.DOMAIN_VERIFIED]);

    for (const hit of topHits) {
        const tier = hit?.metadata?.trust || hit?.trust;
        if (!forceIncludeTiers.has(tier)) continue;
        const route = `trust:${tier}`;
        if (plan.render_blocks.includes(route)) continue;
        plan.render_blocks.push(route);
        const idx = plan.suppressed_routes.indexOf(route);
        if (idx >= 0) plan.suppressed_routes.splice(idx, 1);
        events.push({
            type: "unsuppression",
            tier,
            domain: hit?.metadata?.domain || null,
            content_preview: (hit?.content || "").slice(0, 80),
        });

        const hitDomain = hit?.metadata?.domain;
        if (hitDomain && state.domain && hitDomain !== state.domain) {
            state._soft_drift_streak = (state._soft_drift_streak || 0) + 1;
            state._soft_drift_signal = "cross_domain_directly_relevant";
            events.push({ type: "soft_drift_armed", reason: "cross_domain_directly_relevant" });
        }
    }
    return events;
}

// ---------------------------------------------------------------------------
// Main update entry point — called per B turn
// ---------------------------------------------------------------------------

/**
 * One unified call that:
 *   1. classifies the turn
 *   2. checks drift (if WARM)
 *   3. applies stabilization rule (if not WARM)
 *   4. computes the planner output
 *   5. returns everything needed by runConditionB
 *
 * @param {object} args
 *   - threadId: string
 *   - userText: string
 *   - turn: number (current turn index, 0-based)
 *   - memCall: async function for memory-service POSTs
 *   - thresholds: optional override
 * @returns {Promise<{state: ActiveContextState, classification, drift, plan, telemetry}>}
 */
export async function updateContext({ threadId, userText, turn, memCall, thresholds = {} }) {
    const T = { ...DEFAULT_THRESHOLDS, ...thresholds };
    const state = getActiveContext(threadId, T);
    state.turn_count = turn + 1;

    // Per-turn classification — each user turn classified independently
    // against the prototype set. Used for drift detection (per-turn signal).
    const perTurn = await classifyDomain(userText, memCall);
    if (perTurn.query_embedding) {
        state._recent_query_embeddings.push(perTurn.query_embedding);
        if (state._recent_query_embeddings.length > 3) state._recent_query_embeddings.shift();
    }
    state._recent_classifications = state._recent_classifications || [];
    state._recent_classifications.push({
        domain_id: perTurn.domain_id,
        confidence: perTurn.confidence,
        entropy: perTurn.entropy,
    });
    if (state._recent_classifications.length > 3) state._recent_classifications.shift();
    state._recent_texts = state._recent_texts || [];
    state._recent_texts.push(userText || "");
    if (state._recent_texts.length > 3) state._recent_texts.shift();

    // Composite window classification — embed the concatenated text of the
    // last N=3 user turns. Concatenation preserves the joint semantic mass
    // (the prototype embedder sees more domain-specific tokens together)
    // without diluting via 384-dim vector averaging. This is the design
    // doc §5.1 signal in its operationally-robust form.
    const cfg = loadPrototypesConfig();
    const protoMap = await ensurePrototypeEmbeddings(memCall);
    let windowClassification = perTurn;
    if (state._recent_texts.length >= 2) {
        const joined = state._recent_texts.join(" ").slice(0, 1000);
        const r = await memCall({ action: "embed", text: joined });
        if (r.ok && Array.isArray(r.body?.embedding)) {
            windowClassification = classifyVector(r.body.embedding, protoMap, cfg);
        }
    }

    // Agreement signal across the per-turn classifications (top-1 vote).
    const recent = state._recent_classifications;
    const window = recent.slice(-Math.min(3, recent.length));
    const topVote = new Map();
    for (const r of window) {
        topVote.set(r.domain_id, (topVote.get(r.domain_id) || 0) + 1);
    }
    let winnerId = windowClassification.domain_id, winnerCount = 0;
    for (const [id, c] of topVote) {
        if (c > winnerCount) { winnerCount = c; winnerId = id; }
    }
    const agreement = winnerCount / window.length;

    // Stabilization uses the joined-window classification (the composite
    // signal), with a sanity check that the per-turn agreement also points
    // at the same domain (agreement >= 0.5).
    const classification = {
        domain_id: windowClassification.domain_id,
        confidence: windowClassification.confidence,
        raw_cosine_top1: windowClassification.raw_cosine_top1,
        entropy: windowClassification.entropy,
        distribution: windowClassification.distribution,
        query_embedding: perTurn.query_embedding,
        per_turn_domain: perTurn.domain_id,
        per_turn_confidence: perTurn.confidence,
        per_turn_entropy: perTurn.entropy,
        agreement,
        agreement_winner: winnerId,
        window_size: window.length,
    };

    // If the joined classification disagrees with the per-turn agreement
    // winner, drop confidence to 0 so stabilization stays cold (safety:
    // we don't stabilize on a domain that the recent-turn votes disagree on).
    if (agreement < 0.5 || (winnerId !== windowClassification.domain_id && window.length >= 2)) {
        classification.confidence = Math.min(classification.confidence, 0.5);
    }

    let drift = { triggered: false, trigger: null, hardness: null };

    // v0.6.9.1: drift check runs FIRST, regardless of phase. checkDrift
    // returns adversarial_pattern hits even from COLD/STABILIZING so the
    // telemetry surface (Gate 26) never goes silent on a clearly adversarial
    // turn. Other drift triggers (jurisdiction mismatch, domain change,
    // explicit topic switch) still only fire from WARM.
    drift = checkDrift(state, userText, classification, T);
    if (drift.triggered) {
        state.drift_triggered_at_turn = state.turn_count;
        const trigger = drift.trigger;
        const prevDomain = state.domain;
        const prevSubdomain = state.subdomain;
        const prevPhase = state.phase;
        resetContext(threadId, `drift:${trigger}`);
        const fresh = THREAD_STATE.get(threadId);
        fresh.turn_count = state.turn_count;
        fresh.drift_triggered_at_turn = state.turn_count;
        if (trigger === "adversarial_pattern") {
            fresh._adversarial_reopen_until_turn = state.turn_count + T.adversarial_reopen_min_turns;
        }
        const plan = planMemoryRoutes(fresh, { force_full_cold: true });
        return {
            state: fresh,
            classification,
            drift: { ...drift, prev_domain: prevDomain, prev_subdomain: prevSubdomain, prev_phase: prevPhase },
            plan,
            telemetry: buildTelemetry(fresh, classification, plan, drift),
        };
    }

    if (state.phase === "warm") {
        if (state.turn_count_since_stabilization > 0
            && state.turn_count_since_stabilization % T.warm_sanity_check_every_n_turns === 0
            && classification.domain_id !== state.domain
            && classification.confidence >= T.drift_confidence_min) {
            const prevDomain = state.domain;
            const prevSubdomain = state.subdomain;
            resetContext(threadId, "sanity_check_failed");
            const fresh = THREAD_STATE.get(threadId);
            fresh.turn_count = state.turn_count;
            const plan = planMemoryRoutes(fresh, { force_full_cold: true });
            return {
                state: fresh,
                classification,
                drift: { triggered: true, trigger: "sanity_check_failed", hardness: "soft", prev_domain: prevDomain, prev_subdomain: prevSubdomain },
                plan,
                telemetry: buildTelemetry(fresh, classification, plan, { trigger: "sanity_check_failed" }),
            };
        }

        state.turn_count_since_stabilization += 1;
    } else {
        // not WARM: try to advance toward stabilization
        if (!state.subdomain) {
            const sub = extractSubdomain(userText);
            if (sub) state._candidate_subdomain = sub;
        }
        if (!state._candidate_task_mode || state._candidate_task_mode === "unknown") {
            state._candidate_task_mode = classifyTaskMode(userText);
        }
        applyStabilizationRule(state, classification, T);

        if (state.phase === "warm") {
            state.subdomain = state._candidate_subdomain;
            state.task_mode = state._candidate_task_mode || "qa";
        }
    }

    const plan = planMemoryRoutes(state);
    state.active_routes = plan.render_blocks;
    state.suppressed_routes = plan.suppressed_routes;

    return {
        state,
        classification,
        drift,
        plan,
        telemetry: buildTelemetry(state, classification, plan, drift),
    };
}

function buildTelemetry(state, classification, plan, drift) {
    return {
        phase: state.phase,
        domain: state.domain,
        subdomain: state.subdomain,
        task_mode: state.task_mode,
        confidence: classification?.confidence ?? state.confidence,
        entropy: classification?.entropy ?? state.entropy,
        stabilized: state.stabilized,
        active_routes: plan.render_blocks,
        suppressed_routes: plan.suppressed_routes,
        active_routes_count_excl_always_on:
            plan.render_blocks.filter(r => !ALWAYS_ON.includes(r)).length,
        drift_score: state.drift_score,
        drift_triggered_at_turn: state.drift_triggered_at_turn,
        drift_trigger: drift?.trigger || null,
        drift_hardness: drift?.hardness || null,
        // v0.6.9.1: explicit "never reached WARM" marker. Gate 27 reads
        // this to distinguish a true drift failure (WARM reached, drift
        // didn't fire on a topic switch) from stabilization_not_reached
        // (the conversation never accumulated enough confidence — drift
        // cannot fire from a state that doesn't exist).
        stabilization_not_reached:
            state.phase !== "warm" && (state._highest_phase_reached !== "warm"),
        highest_phase_reached: state._highest_phase_reached || state.phase,
        turn_count: state.turn_count,
        turn_count_since_stabilization: state.turn_count_since_stabilization,
        fce_mode: plan.fce_mode,
        plan_reason: plan.reason,
        search_filters: plan.search_filters,
    };
}

// ---------------------------------------------------------------------------
// Module-wide enable/disable knob (D4)
// ---------------------------------------------------------------------------

/**
 * Returns true when the contextual stabilization layer is enabled.
 * Default ON. Disabled if either the CLI flag `--no-stabilization` was passed
 * or env `BYON_CONTEXT_STABILIZATION=false` is set.
 *
 * @param {string[]} argv - process.argv (or test override)
 */
export function isStabilizationEnabled(argv = process.argv) {
    if (argv.includes("--no-stabilization")) return false;
    const envv = (process.env.BYON_CONTEXT_STABILIZATION || "").toLowerCase().trim();
    if (envv === "false" || envv === "0" || envv === "off") return false;
    return true;
}

/**
 * When stabilization is disabled, return a degenerate state + plan that
 * matches v0.6.8 behaviour exactly (all routes open, COLD phase, no drift).
 * Used by runConditionB so the caller code path stays the same.
 */
export function disabledPassthrough(threadId, turn) {
    const state = freshState(threadId, DEFAULT_THRESHOLDS);
    state.turn_count = turn + 1;
    state.phase = "cold";
    state.active_routes = ALL_ROUTES.slice();
    state.suppressed_routes = [];
    return {
        state,
        classification: { domain_id: null, confidence: 0, entropy: Infinity, distribution: [], query_embedding: null },
        drift: { triggered: false, trigger: null, hardness: null },
        plan: {
            phase: "cold",
            search_filters: { scope: "thread", domain: null, jurisdiction: null, max_hits_per_tier: {} },
            render_blocks: ALL_ROUTES.slice(),
            suppressed_routes: [],
            fce_mode: "full",
            reason: "stabilization_disabled",
        },
        telemetry: {
            phase: "cold",
            domain: null,
            subdomain: null,
            task_mode: "unknown",
            confidence: 0,
            entropy: Infinity,
            stabilized: false,
            active_routes: ALL_ROUTES.slice(),
            suppressed_routes: [],
            active_routes_count_excl_always_on: ALL_ROUTES.length - ALWAYS_ON.length,
            drift_score: 0,
            drift_triggered_at_turn: null,
            drift_trigger: null,
            drift_hardness: null,
            turn_count: turn + 1,
            turn_count_since_stabilization: 0,
            fce_mode: "full",
            plan_reason: "stabilization_disabled",
            search_filters: { scope: "thread", domain: null, jurisdiction: null, max_hits_per_tier: {} },
        },
    };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const ALWAYS_ON_ROUTES = ALWAYS_ON;
export const ALL_KNOWN_ROUTES = ALL_ROUTES;
export const DEFAULTS = DEFAULT_THRESHOLDS;
