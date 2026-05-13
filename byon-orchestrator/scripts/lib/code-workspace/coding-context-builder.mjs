// ---------------------------------------------------------------------------
// CodingContextBuilder
// ---------------------------------------------------------------------------
// Builds the EXACT context block that BYON sends to Claude for a coding
// phase. Anti-drift: includes byte-exact prior file contents (from
// ExactFileStateStore) — NOT a semantic summary.
//
// Context layout (in this order):
//   1. Phase task
//   2. Anti-duplication warning (the previous benchmark's failure mode)
//   3. ArchitectureMap excerpt (forbidden duplicates list)
//   4. RequirementsLedger
//   5. Existing files (paths + content_hash + role)
//   6. Exact file contents for the most relevant N files
//   7. SymbolIndex excerpt (existing classes / dataclasses / public APIs)
//   8. Recent patches (PatchMemory)
//   9. Last failing test output (TestFailureMemory)
//   10. Output protocol reminder
// ---------------------------------------------------------------------------

import { FORBIDDEN_DUPLICATE_PUBLIC_APIS } from "./architecture-map.mjs";

const DEFAULT_OPTS = {
    max_exact_files: 25,
    max_bytes_per_file: 6000,
    include_tests: true,
    max_recent_patches: 5,
};

export class CodingContextBuilder {
    constructor({
        fileStore,
        symbolIndex,
        requirements,
        patches,
        failures,
        architecture,
    }) {
        this.fileStore = fileStore;
        this.symbolIndex = symbolIndex;
        this.requirements = requirements;
        this.patches = patches;
        this.failures = failures;
        this.architecture = architecture;
    }

    /**
     * Build the user-message context for a coding phase.
     * @param {Object} opts
     * @param {string} opts.phase_id
     * @param {string} opts.phase_title
     * @param {string} opts.phase_prompt
     * @param {Object} [opts.builder_opts]   - merges with DEFAULT_OPTS
     * @returns {{ text: string, telemetry: object }}
     */
    build({ phase_id, phase_title, phase_prompt, builder_opts = {} }) {
        const opts = { ...DEFAULT_OPTS, ...builder_opts };

        const exactFiles = this.fileStore
            ? this.fileStore.relevantFiles({ maxFiles: opts.max_exact_files, includeTests: opts.include_tests })
            : [];

        const symbols = this.symbolIndex ? this.symbolIndex.snapshot() : { totals: { files: 0, names: 0 }, by_kind: {}, duplicates: [] };
        const reqs = this.requirements ? this.requirements.snapshot() : null;
        const patches = this.patches ? this.patches.recent(opts.max_recent_patches) : [];
        const lastFailure = this.failures ? this.failures.lastFailure() : null;
        const archSnap = this.architecture ? this.architecture.snapshot() : null;

        const parts = [];
        parts.push(`### CODING TASK — Phase ${phase_id}: ${phase_title}`);
        parts.push("");
        parts.push(phase_prompt);
        parts.push("");

        parts.push("### ANTI-DUPLICATION WARNING (BYON workspace memory)");
        parts.push("");
        parts.push("Coding memory in BYON is now EXACT, not similarity-based. The following symbols are operator-canonical and MUST exist in exactly ONE place across the repo. Do NOT redefine them.");
        parts.push(FORBIDDEN_DUPLICATE_PUBLIC_APIS.map(s => "  - " + s).join("\n"));
        if (archSnap?.forbidden_duplicate_public_apis?.length) {
            parts.push("");
            parts.push("**Already-detected forbidden duplicates that need cleanup before adding more code:**");
            for (const d of archSnap.forbidden_duplicate_public_apis) {
                parts.push(`  - \`${d.name}\` (${d.kind}) — at: ${d.locations.map(l => `${l.file}:${l.line}`).join("; ")}`);
            }
        }
        parts.push("");

        if (reqs) {
            parts.push("### REQUIREMENTS LEDGER (stable IDs across phases — refer to them by ID)");
            parts.push("");
            for (const r of reqs.requirements) {
                const flags = [
                    r.structural ? "[STRUCTURAL]" : null,
                    r.security_relevant ? "[SECURITY]" : null,
                    `status=${r.status}`,
                ].filter(Boolean).join(" ");
                parts.push(`  ${r.id}  ${flags}  ${r.text}`);
            }
            parts.push("");
        }

        if (exactFiles.length > 0) {
            parts.push(`### CURRENT WORKSPACE FILES (${this.fileStore.size()} tracked; ${exactFiles.length} included exactly below)`);
            parts.push("");
            for (const f of this.fileStore.listExisting()) {
                parts.push(`  - ${f.file_path}  [${f.role}${f.test_related ? "/test" : ""}, hash=${f.content_hash}, last_modified=${f.last_modified_phase}]`);
            }
            parts.push("");
            parts.push("### EXACT FILE CONTENTS (byte-exact — DO NOT re-derive these from memory)");
            parts.push("");
            for (const f of exactFiles) {
                const truncated = f.full_content.length > opts.max_bytes_per_file;
                const body = truncated ? f.full_content.slice(0, opts.max_bytes_per_file) + "\n# ... (truncated)\n" : f.full_content;
                parts.push(`#### ${f.file_path} (role=${f.role}${truncated ? ", truncated" : ""})`);
                parts.push("```" + f.language);
                parts.push(body);
                parts.push("```");
                parts.push("");
            }
        }

        if (symbols.totals.names > 0) {
            parts.push(`### SYMBOL INDEX (${symbols.totals.names} unique names across ${symbols.totals.files} files)`);
            parts.push("");
            parts.push("Existing top-level symbols (DO NOT redefine):");
            // Just the duplicates + the FORBIDDEN_DUPLICATE_PUBLIC_APIS names that exist already.
            for (const name of FORBIDDEN_DUPLICATE_PUBLIC_APIS) {
                const locs = this.symbolIndex?.locations(name) || [];
                if (locs.length > 0) {
                    parts.push(`  - ${name}: ${locs.map(l => `${l.file}:${l.line} (${l.kind})`).join("; ")}`);
                }
            }
            if (symbols.duplicates.length > 0) {
                parts.push("");
                parts.push("Symbol duplicates DETECTED in current workspace (resolve, do not add to):");
                for (const d of symbols.duplicates) {
                    parts.push(`  - ${d.name} (${d.kind}): ${d.locations.map(l => `${l.file}:${l.line}`).join("; ")}`);
                }
            }
            parts.push("");
        }

        if (patches.length > 0) {
            parts.push(`### RECENT PATCH HISTORY (most-recent first, last ${patches.length}):`);
            parts.push("");
            for (const p of patches.slice().reverse()) {
                parts.push(`  ${p.patch_id} [${p.phase}] result=${p.result} files=[${p.files_changed.join(", ")}] reason="${(p.reason || "").slice(0, 80)}"`);
            }
            parts.push("");
        }

        if (lastFailure) {
            parts.push(`### LAST TEST FAILURE (verbatim — fix THIS, not a paraphrase)`);
            parts.push("");
            parts.push(`  command: ${lastFailure.command}`);
            parts.push(`  exit_code: ${lastFailure.exit_code}`);
            if (lastFailure.failing_file) parts.push(`  failing_file: ${lastFailure.failing_file}`);
            if (lastFailure.failing_test) parts.push(`  failing_test: ${lastFailure.failing_test}`);
            if (lastFailure.root_cause)   parts.push(`  root_cause:   ${lastFailure.root_cause}`);
            parts.push("");
            parts.push("  stdout (excerpt):");
            parts.push("  ```");
            parts.push((lastFailure.stdout_excerpt || "").split(/\r?\n/).map(l => "  " + l).join("\n"));
            parts.push("  ```");
            if (lastFailure.stderr_excerpt) {
                parts.push("  stderr (excerpt):");
                parts.push("  ```");
                parts.push(lastFailure.stderr_excerpt.split(/\r?\n/).map(l => "  " + l).join("\n"));
                parts.push("  ```");
            }
            parts.push("");
        }

        parts.push("### OUTPUT PROTOCOL (strict)");
        parts.push("");
        parts.push("For every file you want to write or replace, emit:");
        parts.push("    ### FILE: <relative/path/from/repo/root>");
        parts.push("    ```<lang>");
        parts.push("    <full file content — never a diff>");
        parts.push("    ```");
        parts.push("Files not mentioned remain unchanged on disk.");
        parts.push("Honour all requirement IDs above. Do NOT redefine any forbidden duplicate symbol.");
        parts.push("Always ship tests for any behaviour change.");

        const text = parts.join("\n");

        const telemetry = {
            phase_id,
            phase_title,
            exact_files_count: exactFiles.length,
            exact_files_paths: exactFiles.map(f => f.file_path),
            exact_files_bytes_total: exactFiles.reduce((s, f) => s + Math.min(f.full_content.length, opts.max_bytes_per_file), 0),
            symbol_index: { unique_names: symbols.totals.names, duplicates_count: symbols.duplicates.length },
            requirements_included: reqs ? reqs.requirements.length : 0,
            requirements_structural_included: reqs ? reqs.requirements.filter(r => r.structural).length : 0,
            recent_patches_included: patches.length,
            last_failure_included: !!lastFailure,
            architecture_forbidden_dups_detected: archSnap?.forbidden_duplicate_public_apis?.length || 0,
            anti_duplication_warning_included: true,
            output_protocol_included: true,
            context_bytes: text.length,
        };
        return { text, telemetry };
    }

    /**
     * Reports which workspace modules failed to initialise / are missing.
     * Used by router integration tests.
     */
    missingModulesReport() {
        const missing = [];
        if (!this.fileStore)    missing.push("exact_file_state_store");
        if (!this.symbolIndex)  missing.push("symbol_index");
        if (!this.requirements) missing.push("requirements_ledger");
        if (!this.patches)      missing.push("patch_memory");
        if (!this.failures)     missing.push("test_failure_memory");
        if (!this.architecture) missing.push("architecture_map");
        return missing;
    }
}
