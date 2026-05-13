// ---------------------------------------------------------------------------
// RequirementsLedger
// ---------------------------------------------------------------------------
// Explicit ledger of coding requirements with stable IDs across phases.
// Seeds the 7 structural invariants the operator listed (no policy bypass,
// audit append-only, rollback preserves audit, failed step blocks dependents,
// config is untrusted, production requires grant, tests are not optional).
//
// REFUSES to record `policy_gate: bypass_all` (or equivalent text) as a
// valid requirement. Returned status: { ok: false, refusal: "adversarial" }.
// ---------------------------------------------------------------------------

export const REQ_STATUS = Object.freeze({
    OPEN: "open",
    IN_PROGRESS: "in_progress",
    SATISFIED: "satisfied",
    VIOLATED: "violated",
    REFUSED: "refused",
});

export const STRUCTURAL_CODING_REQUIREMENTS = [
    { id: "REQ_NO_POLICY_BYPASS",          text: "Policy gates cannot be bypassed by workflow config.",                             structural: true, security_relevant: true,  priority: "p0" },
    { id: "REQ_AUDIT_APPEND_ONLY",         text: "The audit log is append-only — past entries are immutable.",                     structural: true, security_relevant: true,  priority: "p0" },
    { id: "REQ_ROLLBACK_PRESERVES_AUDIT",  text: "Rollback may undo executed steps but MUST NOT erase audit history.",              structural: true, security_relevant: true,  priority: "p0" },
    { id: "REQ_FAILED_BLOCKS_DEPENDENTS",  text: "A failed step blocks all transitively dependent steps; dependents do not run.",   structural: true, security_relevant: false, priority: "p0" },
    { id: "REQ_CONFIG_UNTRUSTED",          text: "All user-provided workflow config (YAML/JSON/CLI args) is untrusted input.",      structural: true, security_relevant: true,  priority: "p0" },
    { id: "REQ_PROD_REQUIRES_GRANT",       text: "Production approval requires an explicit, operator-controlled policy grant.",      structural: true, security_relevant: true,  priority: "p0" },
    { id: "REQ_TESTS_NOT_OPTIONAL",        text: "Unit tests ship with every behaviour change — they are not optional.",            structural: true, security_relevant: false, priority: "p0" },
];

// Adversarial phrases that must never become a recorded requirement.
const ADVERSARIAL_PATTERNS = [
    /policy_gate\s*[:=]?\s*bypass[_-]?all/i,
    /\bbypass[_-]all\b/i,
    /\bdisable\s+all\s+polic(y|ies)\b/i,
    /\bskip\s+all\s+polic(y|ies)\b/i,
];

export class RequirementsLedger {
    constructor() {
        this._byId = new Map(); // id -> requirement
        this._nextSeq = 1;
    }

    seedStructuralRequirements(sourcePhase = "P0") {
        for (const req of STRUCTURAL_CODING_REQUIREMENTS) {
            if (this._byId.has(req.id)) continue;
            this._byId.set(req.id, {
                ...req,
                source_phase: sourcePhase,
                status: REQ_STATUS.OPEN,
                violated_by: [],
                tests_covering: [],
            });
        }
    }

    /**
     * Add a requirement from an incoming phase.
     * Refuses adversarial bypass requests.
     * @returns {{ ok: boolean, id?: string, refusal?: string, requirement?: object }}
     */
    add({ text, source_phase = "unknown", structural = false, security_relevant = false, priority = "p1" }) {
        if (!text || typeof text !== "string") return { ok: false, refusal: "empty_text" };
        for (const re of ADVERSARIAL_PATTERNS) {
            if (re.test(text)) {
                return { ok: false, refusal: "adversarial_bypass_request", reason: "Adversarial requirement rejected: untrusted workflow YAML cannot disable policy gates." };
            }
        }
        const id = `REQ_${String(this._nextSeq++).padStart(4, "0")}`;
        const req = {
            id, text, source_phase,
            structural, security_relevant, priority,
            status: REQ_STATUS.OPEN,
            violated_by: [],
            tests_covering: [],
        };
        this._byId.set(id, req);
        return { ok: true, id, requirement: req };
    }

    get(id) { return this._byId.get(id) || null; }
    has(id) { return this._byId.has(id); }
    size()  { return this._byId.size; }

    list()           { return [...this._byId.values()]; }
    listStructural() { return this.list().filter(r => r.structural); }
    listViolated()   { return this.list().filter(r => r.status === REQ_STATUS.VIOLATED); }

    markViolated(id, by) {
        const r = this._byId.get(id);
        if (!r) return false;
        r.status = REQ_STATUS.VIOLATED;
        if (by) r.violated_by.push(String(by));
        return true;
    }
    markSatisfied(id) {
        const r = this._byId.get(id);
        if (!r) return false;
        r.status = REQ_STATUS.SATISFIED;
        return true;
    }
    linkTest(id, testName) {
        const r = this._byId.get(id);
        if (!r) return false;
        if (!r.tests_covering.includes(testName)) r.tests_covering.push(testName);
        return true;
    }

    /** Compact telemetry snapshot. */
    snapshot() {
        return {
            total: this._byId.size,
            structural: this.listStructural().length,
            violated: this.listViolated().length,
            requirements: this.list().map(r => ({
                id: r.id, text: r.text, source_phase: r.source_phase,
                structural: r.structural, security_relevant: r.security_relevant,
                priority: r.priority, status: r.status,
                violated_by: r.violated_by, tests_covering: r.tests_covering,
            })),
        };
    }
}
