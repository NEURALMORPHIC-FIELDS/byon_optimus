// ---------------------------------------------------------------------------
// Capability Router
// ---------------------------------------------------------------------------
// Given a user prompt + conversation metadata + (optional) Contextual Pathway
// Stabilization state, produces a CapabilityActivationPlan describing which
// cognitive capability pack(s) should drive this turn.
//
// IMPORTANT: this module is ADDITIVE.
//   - It does NOT replace context-state.mjs (v0.6.9.1 phase classifier).
//   - It does NOT touch runConditionB.
//   - It does NOT modify any production memory route.
//   - It does NOT declare Level 3.
//
// Pipeline contract (v0.7 intent):
//   context-state → capability-router → memory-route-planner → prompt builder
//
// The router only DECIDES which capability is in play. Memory-route planning
// continues to be done by the existing Contextual Pathway Stabilization layer.
// ---------------------------------------------------------------------------

import { CapabilityRegistry } from "./capability-registry.mjs";

/**
 * @typedef {Object} CapabilityActivationPlan
 * @property {string|null} primary_capability         - id of top-scoring capability or null
 * @property {string[]} secondary_capabilities         - other ids above min threshold
 * @property {string[]} selected_capabilities          - primary + secondary, deduped
 * @property {number} confidence                       - 0..1 normalised score for primary
 * @property {Object.<string, number>} scores          - id -> raw score
 * @property {string[]} matched_domains                - domains hit across selected caps
 * @property {string[]} matched_intents                - intents hit across selected caps
 * @property {string[]} required_modules               - union of required_modules across selected
 * @property {string[]} missing_required_modules       - modules whose module_status != "active"
 * @property {string[]} memory_routes                  - union of memory_routes across selected
 * @property {string|null} context_builder             - primary's context_builder
 * @property {string[]} guards                         - union of guards across selected
 * @property {string[]} reason_codes                   - structured reasons (see ROUTER_REASON_CODES)
 * @property {Object} input                            - echo of normalized inputs
 */

export const ROUTER_REASON_CODES = Object.freeze({
    KEYWORD_MATCH: "keyword_match",
    DOMAIN_MATCH: "domain_match",
    INTENT_MATCH: "intent_match",
    ROLE_MATCH: "role_match",
    NEGATIVE_KEYWORD_PENALTY: "negative_keyword_penalty",
    LOW_CONFIDENCE_FALLBACK: "low_confidence_fallback",
    MULTI_CAPABILITY_SELECTED: "multi_capability_selected",
    MISSING_REQUIRED_MODULE: "missing_required_module",
});

// Scoring constants — tunable, not arbitrary.
const KEYWORD_WEIGHT = 1.0;
const DOMAIN_WEIGHT = 1.5;
const INTENT_WEIGHT = 1.2;
const ROLE_WEIGHT = 1.4;
const NEGATIVE_KEYWORD_PENALTY = 1.5;

// A capability counts as "secondary" if its score is at least this fraction of
// the primary's score AND above an absolute floor.
const SECONDARY_FRACTION = 0.45;
const SECONDARY_ABS_FLOOR = 1.5;

// Confidence is normalised to [0,1] via this saturation point.
const CONFIDENCE_SATURATION = 6.0;

function tokensOf(text) {
    if (!text || typeof text !== "string") return [];
    return text.toLowerCase().match(/[a-z][a-z0-9_-]*|[0-9]+/g) || [];
}

function lowerText(text) {
    return (text || "").toLowerCase();
}

function countMatches(haystack, needles) {
    const lower = lowerText(haystack);
    let total = 0, matched = [];
    for (const n of needles || []) {
        if (!n) continue;
        // Match whole-token or substring depending on length. Short tokens
        // (<=3 chars) require word-boundary to avoid false positives like
        // "ts" matching "test"; longer phrases match as substrings.
        const needle = n.toLowerCase();
        let found = false;
        if (needle.length <= 3) {
            const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
            found = re.test(haystack);
        } else if (needle.includes(" ")) {
            found = lower.includes(needle);
        } else {
            // Token-level match for single words to avoid spurious substring hits.
            const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
            found = re.test(haystack);
        }
        if (found) { total += 1; matched.push(n); }
    }
    return { count: total, matched };
}

function scoreCapability(prompt, manifest, ctx) {
    const reasons = [];
    let score = 0;

    const kw = countMatches(prompt, manifest.activation_keywords);
    if (kw.count > 0) {
        score += kw.count * KEYWORD_WEIGHT;
        reasons.push({ code: ROUTER_REASON_CODES.KEYWORD_MATCH, capability: manifest.id, hits: kw.matched.slice(0, 8) });
    }

    const nk = countMatches(prompt, manifest.negative_keywords);
    if (nk.count > 0) {
        score -= nk.count * NEGATIVE_KEYWORD_PENALTY;
        reasons.push({ code: ROUTER_REASON_CODES.NEGATIVE_KEYWORD_PENALTY, capability: manifest.id, hits: nk.matched.slice(0, 8) });
    }

    // Domain match via ctx.domains
    if (Array.isArray(ctx?.domains) && ctx.domains.length) {
        const dom = manifest.domains.filter(d => ctx.domains.includes(d));
        if (dom.length) {
            score += dom.length * DOMAIN_WEIGHT;
            reasons.push({ code: ROUTER_REASON_CODES.DOMAIN_MATCH, capability: manifest.id, hits: dom });
        }
    } else {
        // Also try cheap heuristic: any domain string appearing as a substring of prompt.
        const dom = manifest.domains.filter(d => lowerText(prompt).includes(d.toLowerCase()));
        if (dom.length) {
            score += dom.length * DOMAIN_WEIGHT;
            reasons.push({ code: ROUTER_REASON_CODES.DOMAIN_MATCH, capability: manifest.id, hits: dom });
        }
    }

    // Intent match via ctx.intents
    if (Array.isArray(ctx?.intents) && ctx.intents.length) {
        const ix = manifest.intents.filter(i => ctx.intents.includes(i));
        if (ix.length) {
            score += ix.length * INTENT_WEIGHT;
            reasons.push({ code: ROUTER_REASON_CODES.INTENT_MATCH, capability: manifest.id, hits: ix });
        }
    }

    // Role match via ctx.role
    if (ctx?.role && manifest.roles.includes(ctx.role)) {
        score += ROLE_WEIGHT;
        reasons.push({ code: ROUTER_REASON_CODES.ROLE_MATCH, capability: manifest.id, hits: [ctx.role] });
    }

    return { score, reasons, manifest };
}

/**
 * Main entry point.
 *
 * @param {string} prompt
 * @param {Object} [ctx]
 * @param {string[]} [ctx.domains]
 * @param {string[]} [ctx.intents]
 * @param {string}   [ctx.role]
 * @param {Object}   [ctx.contextual_pathway_state]  - v0.6.9.1 ctx state (passed through, unused for scoring)
 * @param {CapabilityRegistry} [registry]
 * @returns {CapabilityActivationPlan}
 */
export function routeCapability(prompt, ctx = {}, registry = null) {
    const reg = registry || CapabilityRegistry.fromDirectory();
    const candidates = reg.listActive();

    const scored = candidates
        .map(m => scoreCapability(prompt, m, ctx))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
        return emptyPlan(prompt, ctx, reg);
    }

    const primary = scored[0];
    const primaryScore = primary.score;
    const secondary = scored.slice(1).filter(s =>
        s.score >= SECONDARY_FRACTION * primaryScore && s.score >= SECONDARY_ABS_FLOOR
    );
    const selected = [primary, ...secondary];
    const reasonCodes = selected.flatMap(s => s.reasons);

    if (secondary.length > 0) {
        reasonCodes.push({
            code: ROUTER_REASON_CODES.MULTI_CAPABILITY_SELECTED,
            capability: primary.manifest.id,
            secondary: secondary.map(s => s.manifest.id),
        });
    }

    const requiredModules = unionList(selected.map(s => s.manifest.required_modules || []));
    const memoryRoutes = unionList(selected.map(s => s.manifest.memory_routes || []));
    const guards = unionList(selected.map(s => s.manifest.guards || []));
    const matchedDomains = unionList(selected.map(s =>
        s.reasons.filter(r => r.code === ROUTER_REASON_CODES.DOMAIN_MATCH).flatMap(r => r.hits)));
    const matchedIntents = unionList(selected.map(s =>
        s.reasons.filter(r => r.code === ROUTER_REASON_CODES.INTENT_MATCH).flatMap(r => r.hits)));

    // Module status: report what's planned-but-not-implemented across the
    // full selected set. Each selected manifest contributes its own gaps.
    const missingRequired = unionList(selected.map(s => {
        const mod = s.manifest.module_status || {};
        return (s.manifest.required_modules || []).filter(n => mod[n] && mod[n] !== "active");
    }));
    if (missingRequired.length > 0) {
        reasonCodes.push({
            code: ROUTER_REASON_CODES.MISSING_REQUIRED_MODULE,
            capability: primary.manifest.id,
            modules: missingRequired,
        });
    }

    const confidence = Math.min(1, primaryScore / CONFIDENCE_SATURATION);
    if (confidence < 0.25) {
        reasonCodes.push({ code: ROUTER_REASON_CODES.LOW_CONFIDENCE_FALLBACK, capability: primary.manifest.id });
    }

    return {
        primary_capability: primary.manifest.id,
        secondary_capabilities: secondary.map(s => s.manifest.id),
        selected_capabilities: selected.map(s => s.manifest.id),
        confidence,
        scores: Object.fromEntries(scored.map(s => [s.manifest.id, Number(s.score.toFixed(3))])),
        matched_domains: matchedDomains,
        matched_intents: matchedIntents,
        required_modules: requiredModules,
        missing_required_modules: missingRequired,
        memory_routes: memoryRoutes,
        context_builder: primary.manifest.context_builder || null,
        guards,
        reason_codes: reasonCodes,
        input: {
            prompt_length: (prompt || "").length,
            ctx_domains: ctx.domains || null,
            ctx_intents: ctx.intents || null,
            ctx_role: ctx.role || null,
            had_pathway_state: !!ctx.contextual_pathway_state,
        },
    };
}

function emptyPlan(prompt, ctx, _reg) {
    return {
        primary_capability: null,
        secondary_capabilities: [],
        selected_capabilities: [],
        confidence: 0,
        scores: {},
        matched_domains: [],
        matched_intents: [],
        required_modules: [],
        missing_required_modules: [],
        memory_routes: [],
        context_builder: null,
        guards: [],
        reason_codes: [{ code: ROUTER_REASON_CODES.LOW_CONFIDENCE_FALLBACK, capability: null }],
        input: {
            prompt_length: (prompt || "").length,
            ctx_domains: ctx.domains || null,
            ctx_intents: ctx.intents || null,
            ctx_role: ctx.role || null,
            had_pathway_state: !!ctx.contextual_pathway_state,
        },
    };
}

function unionList(listOfLists) {
    const out = new Set();
    for (const l of listOfLists) for (const x of l) out.add(x);
    return [...out];
}

export { tokensOf, countMatches };
