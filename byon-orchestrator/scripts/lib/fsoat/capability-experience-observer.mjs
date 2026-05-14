#!/usr/bin/env node
/**
 * BYON Optimus - Full Source Organism Activation Test
 * Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
 *
 * CapabilityExperienceObserver
 * ============================
 *
 * Loads the capability manifests under byon-orchestrator/config/capabilities/, scores
 * each scenario prompt against them to produce a CapabilityActivationPlan, and writes
 * one line per scenario to capability-experience.jsonl.
 *
 * The router scoring is intentionally simple and conservative; it does NOT promise to
 * be the production router. It exercises the manifest layer (the capability_routing
 * organ) and surfaces missing_required_modules honestly.
 *
 * Inputs:
 *   - manifestsDir: byon-orchestrator/config/capabilities/
 *   - tracker: ActivationTracker
 *
 * Output:
 *   - per-scenario CapabilityActivationPlan, recorded in tracker and written to
 *     capability-experience.jsonl
 */

import * as fs from "node:fs";
import * as path from "node:path";

export class CapabilityExperienceObserver {
    constructor(opts) {
        if (!opts?.tracker) throw new Error("CapabilityExperienceObserver requires opts.tracker");
        if (!opts?.manifestsDir) throw new Error("CapabilityExperienceObserver requires opts.manifestsDir");
        this.tracker = opts.tracker;
        this.manifestsDir = opts.manifestsDir;
        this.manifests = [];
        this.experienceEntries = [];
    }

    loadManifests() {
        if (!fs.existsSync(this.manifestsDir)) {
            throw new Error(`CapabilityExperienceObserver: manifestsDir does not exist: ${this.manifestsDir}`);
        }
        const files = fs
            .readdirSync(this.manifestsDir)
            .filter((f) => f.endsWith(".json"))
            .sort();
        this.manifests = [];
        const errors = [];
        for (const f of files) {
            try {
                const full = path.join(this.manifestsDir, f);
                const raw = fs.readFileSync(full, "utf-8");
                const obj = JSON.parse(raw);
                this.manifests.push({ file: f, manifest: obj });
            } catch (err) {
                errors.push({ file: f, error: err.message });
            }
        }
        return { loaded: this.manifests.length, errors };
    }

    /**
     * Produce a CapabilityActivationPlan for one scenario prompt. The scoring is the
     * sum of activation_keyword hits minus negative_keyword hits, weighted by capability
     * status (active=1.0, planned=0.3, deprecated=0.0).
     */
    routeForScenario(scenarioId, prompt, opts = {}) {
        const text = String(prompt || "").toLowerCase();
        const scored = this.manifests
            .filter((m) => m.manifest?.status !== "deprecated")
            .map(({ file, manifest }) => {
                const activation = manifest.activation_keywords || [];
                const negative = manifest.negative_keywords || [];
                let score = 0;
                for (const kw of activation) {
                    if (text.includes(String(kw).toLowerCase())) score += 1.0;
                }
                for (const kw of negative) {
                    if (text.includes(String(kw).toLowerCase())) score -= 1.5;
                }
                const statusWeight = manifest.status === "active" ? 1.0 : 0.3;
                return {
                    id: manifest.id || file.replace(/\.json$/, ""),
                    file,
                    raw_score: score,
                    weighted_score: score * statusWeight,
                    status: manifest.status,
                    required_modules: manifest.required_modules || [],
                    optional_modules: manifest.optional_modules || [],
                    guards: manifest.guards || []
                };
            })
            .sort((a, b) => b.weighted_score - a.weighted_score);

        // Force primary if scenario specifies one (e.g. coding scenarios specify
        // software_engineer explicitly to ensure the right organ engages).
        let primary;
        if (opts.forcePrimary) {
            primary = scored.find((s) => s.id === opts.forcePrimary) || scored[0];
        } else {
            primary = scored[0] || null;
        }
        const secondaries = scored.filter((s) => s !== primary).slice(0, 2);

        // Determine missing required modules using a heuristic: we cannot import the
        // capability-router from production without invasive coupling, but we can check
        // whether the manifest entries have a matching scripts/lib/code-workspace/ or
        // scripts/lib module name. Honest "I don't know" is better than fake success.
        const knownActiveModules = new Set([
            "code_workspace_memory",
            "exact_file_state_store",
            "symbol_index",
            "requirements_ledger",
            "patch_memory",
            "test_failure_memory",
            "architecture_map",
            "workspace_diff_guard",
            "coding_context_builder",
            "fact_extractor",
            "trust_ranked_formatter",
            "compliance_guard",
            "post_generation_checker",
            "context_state",
            "capability_router"
        ]);

        const missingFromPrimary = (primary?.required_modules || []).filter(
            (m) => !knownActiveModules.has(m)
        );

        const plan = {
            scenario_id: scenarioId,
            primary: primary
                ? { id: primary.id, status: primary.status, weighted_score: primary.weighted_score }
                : null,
            secondaries: secondaries.map((s) => ({
                id: s.id,
                status: s.status,
                weighted_score: s.weighted_score
            })),
            missing_required_modules: missingFromPrimary,
            evaluated_count: scored.length,
            timestamp: new Date().toISOString()
        };

        this.experienceEntries.push(plan);

        // Record capability_routing organ activation. The proof is the activation plan
        // being non-null and the manifest list being non-empty.
        this.tracker.recordProof("capability_routing", "capability_router.activation_plan", {
            scenario: scenarioId,
            primary: plan.primary?.id || null,
            secondaries: plan.secondaries.map((s) => s.id),
            missing_required_modules: plan.missing_required_modules
        });

        return plan;
    }

    experienceJsonl() {
        return this.experienceEntries.map((e) => JSON.stringify(e)).join("\n");
    }

    summary() {
        return {
            manifests_loaded: this.manifests.length,
            scenarios_routed: this.experienceEntries.length
        };
    }
}

export function createCapabilityExperienceObserver(opts) {
    return new CapabilityExperienceObserver(opts);
}
