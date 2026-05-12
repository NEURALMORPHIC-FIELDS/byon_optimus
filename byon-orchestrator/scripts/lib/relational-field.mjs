/**
 * Relational Field Facilitation Layer (Level 3 full-organism experiment).
 *
 * Read-only instrumentation that records typed relations between
 * centers, facts, claims, rules, boundaries and outputs as the
 * full-organism runner sees them per turn.
 *
 * STRICT ISOLATION RULES:
 *
 *   - The registry NEVER writes to OmegaRegistry.
 *   - The registry NEVER creates OmegaRecord.
 *   - The registry NEVER creates ReferenceField.
 *   - The registry NEVER calls `check_coagulation`.
 *   - The registry NEVER sets any omega-anchor flag.
 *   - The registry NEVER modifies `theta_s` or `tau_coag`.
 *
 * The relational field metrics (`field_coherence`, `field_resonance`,
 * `field_tension`) are reported separately from the FCE `S_t` they
 * are NOT a replacement for and NOT a proxy of.
 *
 * Public surface:
 *
 *   RELATION_TYPES                       — frozen set of allowed types
 *   FORBIDDEN_VERDICTS                   — frozen set of forbidden strings
 *   makeRelationEvent({...})             — build a typed relation event
 *   class RelationalFieldRegistry        — per-run aggregator
 *     .recordEvent(event)
 *     .recordCenter(center_id, fields)
 *     .snapshot()
 *     .centerFieldStates()
 *     .clear()
 */

export const RELATION_TYPES = Object.freeze([
    "supports",
    "contradicts",
    "constrains",
    "verifies",
    "contests",
    "stabilizes",
    "protects",
    "routes_to",
    "overrides_denied",
    "depends_on",
]);

export const RELATION_TYPE_SET = new Set(RELATION_TYPES);

export const FORBIDDEN_VERDICTS = Object.freeze([
    "LEVEL_3_REACHED",
    "OMEGA_CREATED_MANUALLY",
    "SYNTHETIC_OMEGA",
    "THRESHOLD_LOWERED",
    "REFERENCEFIELD_CREATED_WITHOUT_OMEGA",
]);

/**
 * Build a relation event with operator-locked schema.
 *
 * Required fields:
 *   - source       (string, e.g. "SYSTEM_CANONICAL")
 *   - relation     (string, must be in RELATION_TYPES)
 *   - target       (string, e.g. "AUDITOR_AUTHORITY")
 *   - center_id    (string, the relational anchor)
 *   - run_id       (string)
 *   - scenario_id  (string)
 *   - turn_index   (integer)
 *
 * Provenance fields (optional but recommended):
 *   - source_turn_id        (string)
 *   - source_fact_id        (string|null)
 *   - source_response_id    (string|null)
 *   - trust_tier            (string|null)
 *   - notes                 (string|null)
 */
export function makeRelationEvent(args) {
    const required = [
        "source",
        "relation",
        "target",
        "center_id",
        "run_id",
        "scenario_id",
        "turn_index",
    ];
    for (const k of required) {
        if (args[k] === undefined || args[k] === null || args[k] === "") {
            throw new TypeError(
                `makeRelationEvent: missing required field ${JSON.stringify(k)}`,
            );
        }
    }
    if (!RELATION_TYPE_SET.has(args.relation)) {
        throw new TypeError(
            `makeRelationEvent: relation ${JSON.stringify(args.relation)} ` +
                `not in admitted RELATION_TYPES`,
        );
    }
    if (typeof args.turn_index !== "number" || !Number.isInteger(args.turn_index)) {
        throw new TypeError("makeRelationEvent: turn_index must be an integer");
    }
    // Forbidden-string check on free-form fields.
    const checkFields = [args.source, args.target, args.center_id, args.notes];
    for (const field of checkFields) {
        if (typeof field !== "string") continue;
        for (const forbidden of FORBIDDEN_VERDICTS) {
            // Word-boundary check (don't match substrings inside compound
            // identifiers).
            const re = new RegExp(
                `(?<![A-Za-z0-9_])${escapeRegExp(forbidden)}(?![A-Za-z0-9_])`,
            );
            if (re.test(field)) {
                throw new Error(
                    `makeRelationEvent: forbidden verdict token ` +
                        `${JSON.stringify(forbidden)} appears as standalone ` +
                        `identifier in event field`,
                );
            }
        }
    }
    return Object.freeze({
        source: args.source,
        relation: args.relation,
        target: args.target,
        center_id: args.center_id,
        run_id: args.run_id,
        scenario_id: args.scenario_id,
        turn_index: args.turn_index,
        source_turn_id: args.source_turn_id || null,
        source_fact_id: args.source_fact_id || null,
        source_response_id: args.source_response_id || null,
        trust_tier: args.trust_tier || null,
        notes: args.notes || null,
        emitted_at: args.emitted_at || new Date().toISOString(),
    });
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compute a deterministic coherence / tension / resonance triple for a
 * center given its incoming relation events. Pure function.
 *
 * field_coherence  ∈ [0, 1]   high when relations agree (more
 *                              supports / stabilizes / verifies than
 *                              contradicts / contests)
 * field_tension    ∈ [0, 1]   ratio of contesting relations to total
 * field_resonance  ∈ [0, 1]   diversity of supporting trust tiers
 *                              normalized; higher when the center is
 *                              supported via multiple distinct routes
 */
export function computeCenterFieldMetrics(events) {
    if (!Array.isArray(events) || events.length === 0) {
        return {
            field_coherence: 0.0,
            field_tension: 0.0,
            field_resonance: 0.0,
            field_stability: 0.0,
            total_relations: 0,
            supporting_relations: 0,
            contesting_relations: 0,
            distinct_trust_tiers_supporting: 0,
        };
    }
    const supporting = new Set(["supports", "stabilizes", "verifies", "protects", "depends_on"]);
    const contesting = new Set(["contradicts", "contests"]);
    const constraining = new Set(["constrains", "overrides_denied", "routes_to"]);

    let sup = 0;
    let con = 0;
    let cons = 0;
    const trustTiersSupporting = new Set();
    for (const ev of events) {
        if (supporting.has(ev.relation)) {
            sup += 1;
            if (ev.trust_tier) trustTiersSupporting.add(ev.trust_tier);
        } else if (contesting.has(ev.relation)) {
            con += 1;
        } else if (constraining.has(ev.relation)) {
            cons += 1;
        }
    }
    const total = events.length;
    const supContRatio = (sup - con) / total; // in [-1, 1]
    const field_coherence = Math.max(0, Math.min(1, 0.5 + 0.5 * supContRatio));
    const field_tension = total > 0 ? Math.max(0, Math.min(1, con / total)) : 0.0;
    // Resonance: how many DISTINCT trust tiers contributed supporting evidence.
    // We cap distinct count at 6 (the six admitted trust tiers).
    const trustTierCount = trustTiersSupporting.size;
    const field_resonance = Math.max(0, Math.min(1, trustTierCount / 6));
    // Stability: coherence weighted by how many constraining/structural
    // relations are present.
    const constraintWeight = total > 0 ? cons / total : 0.0;
    const field_stability = Math.max(
        0,
        Math.min(1, field_coherence * (1 - 0.5 * field_tension) + 0.2 * constraintWeight),
    );
    return {
        field_coherence,
        field_tension,
        field_resonance,
        field_stability,
        total_relations: total,
        supporting_relations: sup,
        contesting_relations: con,
        distinct_trust_tiers_supporting: trustTierCount,
    };
}

/**
 * Per-run aggregator. Keeps an in-memory list of relation events plus
 * a per-center index. Pure data structure with no I/O.
 */
export class RelationalFieldRegistry {
    constructor({ run_id }) {
        if (!run_id || typeof run_id !== "string") {
            throw new TypeError("RelationalFieldRegistry: run_id required");
        }
        this.run_id = run_id;
        this._events = [];
        this._byCenter = new Map();
        this._centerHints = new Map(); // center_id -> extra fields from runner
    }

    /**
     * Record one relation event. Throws on schema violation.
     */
    recordEvent(event) {
        // Re-validate via makeRelationEvent so the registry never accepts
        // an unfrozen / unchecked record.
        const ev = makeRelationEvent({
            ...event,
            run_id: event.run_id || this.run_id,
        });
        if (ev.run_id !== this.run_id) {
            throw new Error(
                `RelationalFieldRegistry: run_id mismatch ${ev.run_id} vs ${this.run_id}`,
            );
        }
        this._events.push(ev);
        if (!this._byCenter.has(ev.center_id)) {
            this._byCenter.set(ev.center_id, []);
        }
        this._byCenter.get(ev.center_id).push(ev);
        return ev;
    }

    /**
     * Attach optional hints (e.g. source_turn_ids / source_fact_ids
     * collected from the runner) to a center so the snapshot can carry
     * provenance without requiring every relation to repeat them.
     */
    recordCenterHints(center_id, hints) {
        if (!this._centerHints.has(center_id)) {
            this._centerHints.set(center_id, {
                source_turn_ids: new Set(),
                source_fact_ids: new Set(),
                source_event_ids: new Set(),
            });
        }
        const entry = this._centerHints.get(center_id);
        for (const tid of hints.source_turn_ids || []) entry.source_turn_ids.add(tid);
        for (const fid of hints.source_fact_ids || []) entry.source_fact_ids.add(fid);
        for (const eid of hints.source_event_ids || []) entry.source_event_ids.add(eid);
    }

    centerFieldStates() {
        const states = [];
        for (const [center_id, events] of this._byCenter.entries()) {
            const metrics = computeCenterFieldMetrics(events);
            const hints = this._centerHints.get(center_id) || {
                source_turn_ids: new Set(),
                source_fact_ids: new Set(),
                source_event_ids: new Set(),
            };
            const trustTierDist = {};
            for (const ev of events) {
                const t = ev.trust_tier || "unknown";
                trustTierDist[t] = (trustTierDist[t] || 0) + 1;
            }
            states.push({
                center_id,
                active_relations: events.length,
                supporting_relations: metrics.supporting_relations,
                contesting_relations: metrics.contesting_relations,
                trust_tier_distribution: trustTierDist,
                relation_tension: metrics.field_tension,
                field_coherence: metrics.field_coherence,
                field_resonance: metrics.field_resonance,
                field_stability: metrics.field_stability,
                source_turn_ids: Array.from(hints.source_turn_ids),
                source_fact_ids: Array.from(hints.source_fact_ids),
                source_event_ids: Array.from(hints.source_event_ids),
            });
        }
        // Stable sort by center_id for deterministic output.
        states.sort((a, b) => (a.center_id < b.center_id ? -1 : a.center_id > b.center_id ? 1 : 0));
        return states;
    }

    snapshot() {
        return {
            run_id: this.run_id,
            n_events: this._events.length,
            relation_type_counts: this._countByRelation(),
            center_field_states: this.centerFieldStates(),
            events: this._events.map((e) => ({ ...e })),
        };
    }

    _countByRelation() {
        const counts = {};
        for (const ev of this._events) {
            counts[ev.relation] = (counts[ev.relation] || 0) + 1;
        }
        return counts;
    }

    clear() {
        this._events = [];
        this._byCenter.clear();
        this._centerHints.clear();
    }

    get events() {
        return this._events.slice();
    }
}

/**
 * Detect tensions in an evidence map produced by one turn.
 *
 * `evidence` shape:
 *   {
 *     system_canonical:        string[],   // canonical fact texts
 *     verified_project_fact:   string[],
 *     domain_verified:         string[],
 *     user_preference:         string[],
 *     extracted_user_claim:    string[],
 *     disputed_or_unsafe:      string[],
 *     fce_advisory_active:     boolean,
 *     fce_advisory_implies_approval: boolean, // sanity check
 *     turn_text:               string,      // last user turn
 *     jurisdiction_claim:      string|null  // optional jurisdiction in user claim
 *     declared_jurisdictions:  string[],    // jurisdictions of cited domain facts
 *   }
 *
 * Returns an array of `RelationTension` records.
 */
export function detectRelationTensions(evidence) {
    if (!evidence || typeof evidence !== "object") return [];
    const out = [];
    const has = (arr) => Array.isArray(arr) && arr.length > 0;

    // SYSTEM_CANONICAL vs EXTRACTED_USER_CLAIM
    if (has(evidence.system_canonical) && has(evidence.extracted_user_claim)) {
        out.push({
            kind: "system_canonical_vs_user_claim",
            severity: "high",
            note: "operator-locked rule may be contested by an extracted user claim",
        });
    }

    // VERIFIED_PROJECT_FACT vs user claim
    if (has(evidence.verified_project_fact) && has(evidence.extracted_user_claim)) {
        out.push({
            kind: "verified_fact_vs_user_claim",
            severity: "medium",
            note: "verified project fact present alongside unverified user claim",
        });
    }

    // DOMAIN_VERIFIED vs wrong jurisdiction
    if (
        has(evidence.domain_verified) &&
        evidence.jurisdiction_claim &&
        Array.isArray(evidence.declared_jurisdictions) &&
        !evidence.declared_jurisdictions.includes(evidence.jurisdiction_claim)
    ) {
        out.push({
            kind: "domain_verified_vs_wrong_jurisdiction",
            severity: "high",
            note: `user claim references jurisdiction ${JSON.stringify(evidence.jurisdiction_claim)} ` +
                `but cited domain facts are for ${JSON.stringify(evidence.declared_jurisdictions)}`,
        });
    }

    // FCE_ADVISORY vs AUDITOR_AUTHORITY (advisory must not approve execution)
    if (evidence.fce_advisory_active && evidence.fce_advisory_implies_approval === true) {
        out.push({
            kind: "fce_advisory_vs_auditor_authority",
            severity: "critical",
            note: "FCE advisory must constrain attention but never approve execution",
        });
    }

    // DISPUTED_OR_UNSAFE present in retrieval surface
    if (has(evidence.disputed_or_unsafe)) {
        out.push({
            kind: "disputed_or_unsafe_blocks_memory_authority",
            severity: "high",
            note: "DISPUTED_OR_UNSAFE entry must be blocked from retrieval until operator confirms",
        });
    }

    return out;
}
