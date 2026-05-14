#!/usr/bin/env node
/**
 * BYON Optimus - Full Source Organism Activation Test
 * Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
 *
 * CodeWorkspaceObserver
 * =====================
 *
 * Exercises the Code Workspace Memory layer at byon-orchestrator/scripts/lib/code-workspace/.
 * The layer ships with 9 active modules after PR #8; this observer imports the
 * coordinator (code-workspace-memory.mjs) when the scenario primary capability is
 * software_engineer and asks it to build a context for one coding phase.
 *
 * The observer records:
 *   - code_workspace_memory: context_built (with proof of byte-exact file inclusion)
 *
 * If the scenario primary is NOT software_engineer, the observer marks the organ as
 * not_applicable_to_scenario on the tracker. This is the ONLY organ on the eleven-organ
 * list where N/A is permitted, and only for non-coding scenarios.
 */

import * as path from "node:path";
import { pathToFileURL } from "node:url";

export class CodeWorkspaceObserver {
    constructor(opts) {
        if (!opts?.tracker) throw new Error("CodeWorkspaceObserver requires opts.tracker");
        if (!opts?.orchestratorRoot)
            throw new Error("CodeWorkspaceObserver requires opts.orchestratorRoot (byon-orchestrator/)");
        this.tracker = opts.tracker;
        this.orchestratorRoot = opts.orchestratorRoot;
        this.coordinator = null;
        this.telemetry = {
            scenarios: [],
            errors: []
        };
    }

    async init() {
        const coordPath = path.join(
            this.orchestratorRoot,
            "scripts",
            "lib",
            "code-workspace",
            "code-workspace-memory.mjs"
        );
        const url = pathToFileURL(coordPath).href;
        try {
            const mod = await import(url);
            // Coordinator may export factory, class, or default - support all three.
            this.coordinator =
                (typeof mod.createCodeWorkspaceMemory === "function" && mod.createCodeWorkspaceMemory()) ||
                (typeof mod.CodeWorkspaceMemory === "function" && new mod.CodeWorkspaceMemory()) ||
                (typeof mod.default === "function" && new mod.default()) ||
                mod.default ||
                null;
            return Boolean(this.coordinator);
        } catch (err) {
            this.telemetry.errors.push({
                stage: "init",
                error: err.message
            });
            return false;
        }
    }

    /**
     * Build context for one coding scenario. Returns the built context, plus
     * records the proof on the tracker.
     *
     * Inputs:
     *   scenarioId
     *   phaseTask: { prompt, phase_index, language }
     *   files: optional pre-existing file map { path: content } to seed exact_file_state_store
     */
    async buildContextForCodingScenario(scenarioId, phaseTask, files = {}) {
        if (!this.coordinator) {
            const initialized = await this.init();
            if (!initialized) {
                this.telemetry.scenarios.push({
                    scenario_id: scenarioId,
                    context_built: false,
                    error: "coordinator_not_available",
                    errors: this.telemetry.errors.slice()
                });
                return null;
            }
        }

        try {
            // Seed file store via ingestPatch using the coordinator's expected shape:
            //   { phase, blocks: [{path, content}], reason }
            if (Object.keys(files).length > 0 && typeof this.coordinator.ingestPatch === "function") {
                const blocks = Object.entries(files).map(([p, content]) => ({ path: p, content }));
                this.coordinator.ingestPatch({
                    phase: phaseTask.phase_id || `phase_${phaseTask.phase_index ?? 0}`,
                    blocks,
                    reason: `fsoat_seed_${scenarioId}`
                });
            }

            let ctx;
            if (typeof this.coordinator.buildContext === "function") {
                ctx = this.coordinator.buildContext({
                    phase_id: phaseTask.phase_id || `phase_${phaseTask.phase_index ?? 0}`,
                    phase_title: phaseTask.phase_title || `FSOAT phase for ${scenarioId}`,
                    phase_prompt: phaseTask.prompt,
                    builder_opts: phaseTask.builder_opts || {}
                });
            } else if (typeof this.coordinator.build === "function") {
                ctx = this.coordinator.build(phaseTask);
            } else {
                throw new Error("coordinator exposes neither buildContext nor build");
            }

            const exactFilesIncluded = countExactFiles(ctx);
            const requirementsIncluded = countRequirements(ctx);
            const hasAntiDup = hasAntiDuplicationWarning(ctx);

            const summary = {
                scenario_id: scenarioId,
                context_built: true,
                exact_files_included: exactFilesIncluded,
                requirements_included: requirementsIncluded,
                has_anti_duplication_warning: hasAntiDup,
                phase_task: phaseTask
            };
            this.telemetry.scenarios.push(summary);

            this.tracker.recordProof("code_workspace_memory", "code_workspace_memory.context_built", {
                scenario: scenarioId,
                exact_files: exactFilesIncluded,
                requirements: requirementsIncluded,
                anti_duplication_warning: hasAntiDup
            });

            return ctx;
        } catch (err) {
            this.telemetry.errors.push({
                scenario_id: scenarioId,
                stage: "build",
                error: err.message
            });
            this.telemetry.scenarios.push({
                scenario_id: scenarioId,
                context_built: false,
                error: err.message
            });
            return null;
        }
    }

    /**
     * Mark organ 8 as N/A for a non-coding scenario.
     */
    markScenarioNotApplicable(scenarioId, reason) {
        this.tracker.markCodeWorkspaceNotApplicableToScenario(scenarioId, reason);
        this.telemetry.scenarios.push({
            scenario_id: scenarioId,
            not_applicable_to_scenario: true,
            reason
        });
    }

    telemetrySnapshot() {
        return {
            scenarios: this.telemetry.scenarios.slice(),
            errors: this.telemetry.errors.slice()
        };
    }
}

function countExactFiles(ctx) {
    if (!ctx) return 0;
    if (Array.isArray(ctx.exact_files)) return ctx.exact_files.length;
    if (Array.isArray(ctx.files)) return ctx.files.length;
    if (typeof ctx === "string") {
        const matches = ctx.match(/^### FILE: /gm);
        return matches ? matches.length : 0;
    }
    return 0;
}

function countRequirements(ctx) {
    if (!ctx) return 0;
    if (Array.isArray(ctx.requirements)) return ctx.requirements.length;
    if (typeof ctx === "string") {
        const matches = ctx.match(/REQ_[A-Z_]+/g);
        return matches ? new Set(matches).size : 0;
    }
    return 0;
}

function hasAntiDuplicationWarning(ctx) {
    if (!ctx) return false;
    const s = typeof ctx === "string" ? ctx : JSON.stringify(ctx);
    return /FORBIDDEN_DUPLICATE_PUBLIC_APIS|exactly ONE place|duplicate public API/i.test(s);
}

export function createCodeWorkspaceObserver(opts) {
    return new CodeWorkspaceObserver(opts);
}
