// ---------------------------------------------------------------------------
// PatchMemory
// ---------------------------------------------------------------------------
// Append-only ledger of patches applied during a coding run. Each patch
// records what changed, why, which requirements it claims to satisfy, the
// tests that were run, and whether the patch was accepted.
// ---------------------------------------------------------------------------

export const PATCH_RESULT = Object.freeze({
    ACCEPTED: "accepted",
    REJECTED: "rejected",
    FAILED_TESTS: "failed_tests",
    GUARD_BLOCKED: "guard_blocked",
});

export class PatchMemory {
    constructor() {
        this._patches = []; // append-only
        this._seq = 1;
    }

    /**
     * @param {Object} p
     * @param {string} p.phase
     * @param {string[]} p.files_changed
     * @param {string} [p.reason]
     * @param {string[]} [p.requirement_ids]
     * @param {string[]} [p.tests_run]
     * @param {Object} [p.test_result]   - { exit_code, summary, ... }
     * @param {string} [p.result]        - PATCH_RESULT value
     * @param {string} [p.failure_summary]
     * @param {boolean} [p.rollback_needed]
     * @param {string} [p.rejected_reason]
     */
    record(p) {
        const id = `PATCH_${String(this._seq++).padStart(4, "0")}`;
        const entry = {
            patch_id: id,
            ts: new Date().toISOString(),
            phase: p.phase ?? "unknown",
            files_changed: Array.isArray(p.files_changed) ? p.files_changed.slice() : [],
            reason: p.reason || "",
            requirement_ids: Array.isArray(p.requirement_ids) ? p.requirement_ids.slice() : [],
            tests_run: Array.isArray(p.tests_run) ? p.tests_run.slice() : [],
            test_result: p.test_result || null,
            result: p.result || PATCH_RESULT.ACCEPTED,
            failure_summary: p.failure_summary || null,
            rollback_needed: !!p.rollback_needed,
            accepted: p.result == null ? true : p.result === PATCH_RESULT.ACCEPTED,
            rejected_reason: p.rejected_reason || null,
        };
        this._patches.push(entry);
        return entry;
    }

    markRejected(patchId, reason) {
        const p = this._patches.find(x => x.patch_id === patchId);
        if (!p) return false;
        p.result = PATCH_RESULT.REJECTED;
        p.accepted = false;
        p.rejected_reason = reason || "unspecified";
        return true;
    }

    listAll() { return this._patches.slice(); }
    listByPhase(phase) { return this._patches.filter(p => p.phase === phase); }
    listAccepted() { return this._patches.filter(p => p.accepted); }
    listRejected() { return this._patches.filter(p => !p.accepted); }
    recent(n = 5) { return this._patches.slice(-n); }

    snapshot() {
        return {
            total: this._patches.length,
            accepted: this.listAccepted().length,
            rejected: this.listRejected().length,
            patches: this._patches.slice(),
        };
    }
}
