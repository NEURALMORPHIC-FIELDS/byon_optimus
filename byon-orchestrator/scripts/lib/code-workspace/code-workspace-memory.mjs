// ---------------------------------------------------------------------------
// CodeWorkspaceMemory — coordinator
// ---------------------------------------------------------------------------
// Owns the seven workspace-memory components and exposes a single API the
// coding benchmark orchestrator can use:
//
//   * buildContext({ phase, prompt })          -> { text, telemetry }
//   * ingestPatch({ phase, blocks })           -> { accepted, risks, patch_id }
//   * recordTestRun({ phase, command, ... })   -> failure entry
//   * snapshot()                               -> full telemetry for artifacts
//
// This module is ACTIVE (status=active in software_engineer manifest after
// this PR). It does NOT replace runConditionB; it sits on top, builds the
// coding-specific user message, and routes it through runConditionB so
// the production pipeline (memory-service / FCE / compliance guard / receipt
// assimilation) still fires.
// ---------------------------------------------------------------------------

import { ExactFileStateStore } from "./exact-file-state-store.mjs";
import { SymbolIndex } from "./symbol-index.mjs";
import { RequirementsLedger } from "./requirements-ledger.mjs";
import { PatchMemory, PATCH_RESULT } from "./patch-memory.mjs";
import { TestFailureMemory } from "./test-failure-memory.mjs";
import { ArchitectureMap } from "./architecture-map.mjs";
import { CodingContextBuilder } from "./coding-context-builder.mjs";
import { WorkspaceDiffGuard } from "./workspace-diff-guard.mjs";

export class CodeWorkspaceMemory {
    constructor({ seed_structural_requirements = true } = {}) {
        this.fileStore = new ExactFileStateStore();
        this.symbolIndex = new SymbolIndex();
        this.requirements = new RequirementsLedger();
        this.patches = new PatchMemory();
        this.failures = new TestFailureMemory();
        this.architecture = new ArchitectureMap(this.fileStore, this.symbolIndex);
        this.guard = new WorkspaceDiffGuard({
            fileStore: this.fileStore,
            requirements: this.requirements,
        });
        this.builder = new CodingContextBuilder({
            fileStore: this.fileStore,
            symbolIndex: this.symbolIndex,
            requirements: this.requirements,
            patches: this.patches,
            failures: this.failures,
            architecture: this.architecture,
        });
        if (seed_structural_requirements) {
            this.requirements.seedStructuralRequirements("P0");
        }
    }

    // -- context for the next phase --------------------------------------------------
    buildContext({ phase_id, phase_title, phase_prompt, builder_opts = {} }) {
        return this.builder.build({ phase_id, phase_title, phase_prompt, builder_opts });
    }

    // -- ingest a patch (blocks parsed from the model's response) -------------------
    /**
     * Inspect + accept (or reject) a patch.
     * NOTE: the caller is responsible for actually writing the files to disk;
     * this method updates the in-memory workspace state.
     *
     * @param {Object} args
     * @param {string} args.phase
     * @param {Array<{path: string, content: string}>} args.blocks
     * @param {string} [args.reason]
     * @returns {{ accepted: boolean, patch_id: string, risks: Array, applied_paths: string[], rejected_paths: string[] }}
     */
    ingestPatch({ phase, blocks, reason = "" }) {
        const inspection = this.guard.inspect(blocks);
        const risks = inspection.risks;
        // Policy: we still INGEST risky patches into the file store so the
        // anti-duplication context can surface the bad state on the NEXT
        // turn. We mark the patch GUARD_BLOCKED so PatchMemory shows the
        // refusal in telemetry. The coding benchmark orchestrator is free
        // to re-prompt the model if it wants to push for a repair pass.
        const applied = [];
        const rejected = [];
        for (const b of blocks) {
            // Cheap path-safety check (orchestrator does the disk-level check too).
            if (!b.path || b.path.includes("..") || /^[a-zA-Z]:[\\\/]/.test(b.path) || b.path.startsWith("/") || b.path.startsWith("\\")) {
                rejected.push({ path: b.path, reason: "unsafe_path" });
                continue;
            }
            this.fileStore.set(b.path, b.content, { phase });
            this.symbolIndex.forgetFile(b.path);
            this.symbolIndex.indexFile(b.path, b.content);
            applied.push(b.path);
        }
        this.architecture.markDirty();

        const result = risks.length > 0 ? PATCH_RESULT.GUARD_BLOCKED : PATCH_RESULT.ACCEPTED;
        const patch = this.patches.record({
            phase,
            files_changed: applied,
            reason,
            requirement_ids: this._inferRequirementsTouched(blocks),
            result,
            failure_summary: risks.length ? risks.map(r => r.message).join("; ") : null,
            rejected_reason: risks.length ? "guard_risks_detected" : null,
        });

        // Mark violated requirements when guard saw bypass acceptance.
        for (const r of risks) {
            if (r.type === "bypass_all_accepted") {
                this.requirements.markViolated("REQ_NO_POLICY_BYPASS", patch.patch_id);
            }
            if (r.type === "audit_append_broken") {
                this.requirements.markViolated("REQ_AUDIT_APPEND_ONLY", patch.patch_id);
            }
            if (r.type === "rollback_erases_audit") {
                this.requirements.markViolated("REQ_ROLLBACK_PRESERVES_AUDIT", patch.patch_id);
            }
        }

        return {
            accepted: risks.length === 0,
            patch_id: patch.patch_id,
            risks,
            applied_paths: applied,
            rejected_paths: rejected,
        };
    }

    /**
     * Notify the workspace that a previously-known file was deleted on disk.
     * The store keeps the entry but marks exists=false so the architecture
     * map and guard can see the deletion.
     */
    markFileDeleted(filePath, phase) {
        this.fileStore.markMissing(filePath, phase);
        this.symbolIndex.forgetFile(filePath);
        this.architecture.markDirty();
    }

    /**
     * Record the result of a test / compile / CLI run for next-phase context.
     */
    recordTestRun({ phase, command, exit_code, stdout, stderr, label }) {
        return this.failures.record({ phase, command, exit_code, stdout, stderr, label });
    }

    /**
     * Telemetry artifact — written to disk by the bench orchestrator as
     * code-workspace-telemetry.json.
     */
    snapshot() {
        return {
            file_store:    this.fileStore.snapshot(),
            symbol_index:  this.symbolIndex.snapshot(),
            requirements: this.requirements.snapshot(),
            patches:      this.patches.snapshot(),
            failures:     this.failures.snapshot(),
            architecture: this.architecture.snapshot(),
            module_status: {
                code_workspace_memory:       "active",
                exact_file_state_store:      "active",
                symbol_index:                "active",
                requirements_ledger:         "active",
                patch_memory:                "active",
                test_failure_memory:         "active",
                architecture_map:            "active",
                workspace_diff_guard:        "active",
                coding_context_builder:      "active",
            },
        };
    }

    _inferRequirementsTouched(blocks) {
        // Heuristic: if any block mentions audit / rollback / policy_gate,
        // tag the corresponding requirement. The model is supposed to be
        // referencing requirements by ID; this is just a fallback so
        // the patch log is informative even without explicit mention.
        const out = new Set();
        for (const b of blocks) {
            const lower = (b.content || "").toLowerCase();
            if (/\baudit\b/.test(lower))    out.add("REQ_AUDIT_APPEND_ONLY");
            if (/\brollback\b/.test(lower)) out.add("REQ_ROLLBACK_PRESERVES_AUDIT");
            if (/\bpolicy[_-]?gate\b/.test(lower) || /\bbypass\b/.test(lower)) out.add("REQ_NO_POLICY_BYPASS");
            if (/\btest_\w+\b/.test(lower))  out.add("REQ_TESTS_NOT_OPTIONAL");
        }
        return [...out];
    }
}

export { ExactFileStateStore, SymbolIndex, RequirementsLedger, PatchMemory, TestFailureMemory, ArchitectureMap, WorkspaceDiffGuard, CodingContextBuilder };
