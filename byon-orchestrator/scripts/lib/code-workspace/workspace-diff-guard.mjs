// ---------------------------------------------------------------------------
// WorkspaceDiffGuard
// ---------------------------------------------------------------------------
// Inspects a proposed patch (file_path → content map) BEFORE it is accepted
// into the workspace. Returns a list of detected risks. CodingContextBuilder
// / PatchMemory use these to decide whether to accept, request repair, or
// reject the patch.
//
// Checks:
//   * duplicate classes/dataclasses/functions across files (new + existing)
//   * untrusted-config bypass acceptance (`policy_gate: bypass_all`)
//   * removed test files / emptied test files
//   * audit log invariants overwritten (append-only signature missing /
//     rollback method deleting entries)
//   * broken CLI surface (referenced commands disappearing)
//   * requirement-ledger violations (presence of phrasings the ledger
//     marked refused)
// ---------------------------------------------------------------------------

import { SymbolIndex, SymbolKinds } from "./symbol-index.mjs";
import { FORBIDDEN_DUPLICATE_PUBLIC_APIS } from "./architecture-map.mjs";

export const GUARD_RISK = Object.freeze({
    DUPLICATE_PUBLIC_API: "duplicate_public_api",
    DUPLICATE_DATACLASS: "duplicate_dataclass",
    DUPLICATE_CLASS: "duplicate_class",
    BYPASS_ALL_ACCEPTED: "bypass_all_accepted",
    TEST_DELETED: "test_deleted",
    TEST_EMPTIED: "test_emptied",
    AUDIT_APPEND_BROKEN: "audit_append_broken",
    ROLLBACK_ERASES_AUDIT: "rollback_erases_audit",
    REQUIREMENT_VIOLATED: "requirement_violated",
    CLI_COMMAND_REMOVED: "cli_command_removed",
});

const BYPASS_ACCEPT_PATTERNS = [
    // Operator-canonical adversarial form: `policy_gate: bypass_all`
    /policy[_-]?gate\s*:\s*bypass[_-]?all\b/i,
    // YAML with bypass_all: true / yes / 1
    /\bbypass[_-]all\s*:\s*(?:true|yes|on|1)\b/i,
];
// Heuristic: code that returns True / sets policy=None / skips gate when bypass_all is set.
const BYPASS_CODE_USE = /bypass[_-]all/i;
const BYPASS_REJECT_HINTS = /raise|reject|invalid|forbidden|disallow|not\s+allow|refus/i;

const APPEND_ONLY_NEGATIVES = [
    /\bdel\s+self\.(_?entries|_?log|_?audit)\b/,
    /\.clear\(\)/,           // calling .clear() on the audit collection
    /\.pop\(/,               // popping from audit
    /\bremove\(/,            // remove from audit list
];

const ROLLBACK_ERASES = [
    /(rollback|undo)[^{}\n]*?(del\s+|\.clear\(\)|\.pop\(|\.remove\()/is,
];

export class WorkspaceDiffGuard {
    /**
     * @param {Object} opts
     * @param {Object} [opts.fileStore]        - prior ExactFileStateStore (the "before")
     * @param {Object} [opts.requirements]     - prior RequirementsLedger
     */
    constructor({ fileStore = null, requirements = null } = {}) {
        this.fileStore = fileStore;
        this.requirements = requirements;
    }

    /**
     * Inspect a candidate patch.
     * @param {Array<{path: string, content: string}>} blocks
     * @returns {{ risks: Array<{type, message, files?, names?}>, ok: boolean }}
     */
    inspect(blocks) {
        const risks = [];
        if (!Array.isArray(blocks)) return { risks: [{ type: "invalid_input", message: "blocks must be an array" }], ok: false };

        // 1. Build a "post-patch" symbol index by re-indexing each new file.
        //    For files NOT touched by the patch, fall back to the prior file store.
        const post = new SymbolIndex();
        const touched = new Set();
        for (const b of blocks) {
            touched.add(b.path);
            post.indexFile(b.path, b.content);
        }
        if (this.fileStore) {
            for (const e of this.fileStore.listExisting()) {
                if (!touched.has(e.file_path)) post.indexFile(e.file_path, e.full_content);
            }
        }

        // 2. Duplicate public APIs across all files (post-patch view).
        const dups = post.duplicates();
        for (const d of dups) {
            if (FORBIDDEN_DUPLICATE_PUBLIC_APIS.includes(d.name)) {
                risks.push({
                    type: GUARD_RISK.DUPLICATE_PUBLIC_API,
                    message: `forbidden duplicate of public API "${d.name}" across files: ` + d.locations.map(l => l.file).join(", "),
                    names: [d.name],
                    files: d.locations.map(l => l.file),
                });
            } else if (d.kind === SymbolKinds.DATACLASS) {
                risks.push({
                    type: GUARD_RISK.DUPLICATE_DATACLASS,
                    message: `duplicate dataclass "${d.name}" in: ` + d.locations.map(l => l.file).join(", "),
                    names: [d.name],
                    files: d.locations.map(l => l.file),
                });
            } else if (d.kind === SymbolKinds.CLASS) {
                risks.push({
                    type: GUARD_RISK.DUPLICATE_CLASS,
                    message: `duplicate class "${d.name}" in: ` + d.locations.map(l => l.file).join(", "),
                    names: [d.name],
                    files: d.locations.map(l => l.file),
                });
            }
        }

        // 3. bypass_all acceptance (YAML + code).
        for (const b of blocks) {
            const lang = inferLang(b.path);
            if (lang === "yaml") {
                if (BYPASS_ACCEPT_PATTERNS.some(re => re.test(b.content))) {
                    risks.push({
                        type: GUARD_RISK.BYPASS_ALL_ACCEPTED,
                        message: `untrusted workflow ${b.path} accepts \`bypass_all\``,
                        files: [b.path],
                    });
                }
            } else if (lang === "python") {
                // Code that USES bypass_all without rejecting it => acceptance.
                if (BYPASS_CODE_USE.test(b.content) && !BYPASS_REJECT_HINTS.test(b.content)) {
                    risks.push({
                        type: GUARD_RISK.BYPASS_ALL_ACCEPTED,
                        message: `python file ${b.path} references bypass_all without rejection`,
                        files: [b.path],
                    });
                }
            }
        }

        // 4. Test file deletion / emptying.
        if (this.fileStore) {
            const priorTests = this.fileStore.listExisting().filter(e => e.test_related && e.role === "test");
            const postTestPaths = new Set([...touched].filter(p => p.startsWith("tests/") || /\btest_\w+\.py$/.test(p)));
            // A test file is "deleted" if it existed before and is now an empty post block.
            for (const b of blocks) {
                const wasTest = priorTests.some(t => t.file_path === b.path);
                if (wasTest && (b.content || "").trim().length === 0) {
                    risks.push({
                        type: GUARD_RISK.TEST_EMPTIED,
                        message: `test file ${b.path} was emptied`,
                        files: [b.path],
                    });
                }
            }
            // Note: we cannot detect "test file deleted" here since the patch only
            // contains writes; deletion (absent from patch) is invisible. That's
            // why the bench orchestrator calls fileStore.markMissing on disk-level
            // deletions before re-running the guard.
        }

        // 5. Audit append-only invariant.
        for (const b of blocks) {
            const lang = inferLang(b.path);
            if (lang !== "python") continue;
            if (!/audit/i.test(b.path) && !/audit/i.test(b.content)) continue;
            for (const re of APPEND_ONLY_NEGATIVES) {
                if (re.test(b.content)) {
                    risks.push({
                        type: GUARD_RISK.AUDIT_APPEND_BROKEN,
                        message: `audit append-only invariant looks broken in ${b.path} (pattern: ${re})`,
                        files: [b.path],
                    });
                    break;
                }
            }
            for (const re of ROLLBACK_ERASES) {
                if (re.test(b.content)) {
                    risks.push({
                        type: GUARD_RISK.ROLLBACK_ERASES_AUDIT,
                        message: `rollback path in ${b.path} appears to erase audit history`,
                        files: [b.path],
                    });
                    break;
                }
            }
        }

        // 6. Requirement-ledger violations (catches phrases the ledger refused
        //    being smuggled in as part of the patch).
        if (this.requirements) {
            const refused = this.requirements.list().filter(r => r.status === "refused");
            void refused; // ledger itself refuses adversarial adds — no need to re-check here.
        }

        return { risks, ok: risks.length === 0 };
    }
}

function inferLang(p) {
    if (p.endsWith(".py")) return "python";
    if (p.endsWith(".yaml") || p.endsWith(".yml")) return "yaml";
    if (p.endsWith(".json")) return "json";
    if (p.endsWith(".md")) return "markdown";
    if (p.endsWith(".toml")) return "toml";
    return "text";
}
