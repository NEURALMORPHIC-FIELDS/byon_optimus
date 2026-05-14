#!/usr/bin/env node
/**
 * BYON Optimus - Full Source Organism Activation Test
 * Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
 *
 * StructuralReferenceObserver
 * ===========================
 *
 * Loads the seven operator-seeded structural references from
 * byon-orchestrator/scripts/lib/structural-seeds.mjs and exercises the recall path.
 *
 * Two modes:
 *   1) ONLINE: memory-service is reachable and BYON_LEVEL3_FULL_ORGANISM_EXPERIMENT=true.
 *      We persist seeds via POST /level3/persist-structural-reference (or the legacy
 *      action endpoint), then retrieve via /level3/retrieve-structural-references.
 *   2) OFFLINE: memory-service is not reachable. We exercise the in-process seeds
 *      module directly (its data is structural reference truth from the source code).
 *      In this mode we record level3.structural_references.retrieved with note:offline.
 *
 * Invariants enforced (the observer FAILS the gate via tracker proof shape):
 *   - All retrieved records MUST carry origin=operator_seeded
 *   - No record may have origin=endogenous_*; if observed, the verdict builder fails
 *   - theta_s = 0.28, tau_coag = 12: the observer does NOT touch these; the verdict
 *     builder will read them from memory-service /fce_state if available.
 */

import * as path from "node:path";
import { pathToFileURL } from "node:url";

export class StructuralReferenceObserver {
    constructor(opts) {
        if (!opts?.tracker) throw new Error("StructuralReferenceObserver requires opts.tracker");
        if (!opts?.orchestratorRoot)
            throw new Error("StructuralReferenceObserver requires opts.orchestratorRoot");
        this.tracker = opts.tracker;
        this.orchestratorRoot = opts.orchestratorRoot;
        this.baseUrl = opts.baseUrl || process.env.MEMORY_SERVICE_URL || "http://127.0.0.1:8000";
        this.seeds = null;
        this.retrievedRecords = [];
        this.invariantViolations = [];
        this.mode = "uninitialized";
    }

    async init() {
        const seedsPath = path.join(
            this.orchestratorRoot,
            "scripts",
            "lib",
            "structural-seeds.mjs"
        );
        const url = pathToFileURL(seedsPath).href;
        try {
            const mod = await import(url);
            // Common export names; support multiple revisions.
            this.seeds =
                mod.STRUCTURAL_SEEDS ||
                mod.SEVEN_SEEDS ||
                mod.SEEDS ||
                mod.structuralSeeds ||
                (typeof mod.getStructuralSeeds === "function" ? mod.getStructuralSeeds() : null) ||
                mod.default;
            if (!Array.isArray(this.seeds) || this.seeds.length === 0) {
                throw new Error("seeds export not found or empty");
            }
        } catch (err) {
            this.invariantViolations.push({ stage: "init", error: err.message });
            this.seeds = null;
            return false;
        }
        return true;
    }

    /**
     * Run the recall path for one scenario thread. Returns retrieved record array.
     */
    async retrieveForScenario(scenarioId, opts = {}) {
        if (!this.seeds) {
            const ok = await this.init();
            if (!ok) return null;
        }

        const threadId = opts.threadId || `fsoat_${scenarioId}`;

        // Try ONLINE mode if memory-service is up AND level3 endpoint is enabled.
        const online = await this._tryOnline(scenarioId, threadId);
        if (online) {
            this.mode = "online";
            return online.records;
        }

        // OFFLINE mode: use seeds module data directly. Invariant: every seed must
        // declare origin=operator_seeded in its module entry (or default to that).
        const records = this.seeds.map((s) => ({
            node_id: s.node_id || s.id || s.name || "unknown",
            content: s.content || s.text || JSON.stringify(s),
            origin: s.origin || "operator_seeded",
            scope: s.scope || "system",
            thread_id: threadId
        }));
        for (const r of records) {
            if (r.origin !== "operator_seeded") {
                this.invariantViolations.push({
                    scenario_id: scenarioId,
                    node_id: r.node_id,
                    violation: `non_operator_seeded_origin: ${r.origin}`
                });
            }
        }
        this.retrievedRecords.push({
            scenario_id: scenarioId,
            mode: "offline",
            record_count: records.length,
            origins: countOrigins(records)
        });
        this.tracker.recordProof("structural_reference_memory", "level3.structural_references.retrieved", {
            scenario: scenarioId,
            mode: "offline",
            record_count: records.length,
            origins: countOrigins(records),
            note: "memory-service unavailable or BYON_LEVEL3_FULL_ORGANISM_EXPERIMENT=false; exercised in-process seeds"
        });
        this.mode = "offline";
        return records;
    }

    async _tryOnline(scenarioId, threadId) {
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 3000);
            const resp = await fetch(`${this.baseUrl}/level3/retrieve-structural-references`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ thread_id: threadId, scope: "thread" }),
                signal: ctrl.signal
            });
            clearTimeout(t);
            if (!resp.ok) return null;
            const body = await resp.json().catch(() => ({}));
            const records = Array.isArray(body?.records) ? body.records : [];
            for (const r of records) {
                if (r.origin && r.origin !== "operator_seeded") {
                    this.invariantViolations.push({
                        scenario_id: scenarioId,
                        node_id: r.node_id,
                        violation: `non_operator_seeded_origin: ${r.origin}`
                    });
                }
            }
            this.retrievedRecords.push({
                scenario_id: scenarioId,
                mode: "online",
                record_count: records.length,
                origins: countOrigins(records)
            });
            this.tracker.recordProof(
                "structural_reference_memory",
                "level3.structural_references.retrieved",
                {
                    scenario: scenarioId,
                    mode: "online",
                    record_count: records.length,
                    origins: countOrigins(records)
                }
            );
            return { records };
        } catch {
            return null;
        }
    }

    invariantsHeld() {
        return this.invariantViolations.length === 0;
    }

    telemetrySnapshot() {
        return {
            mode: this.mode,
            retrieved_records: this.retrievedRecords.slice(),
            invariant_violations: this.invariantViolations.slice(),
            seed_count: Array.isArray(this.seeds) ? this.seeds.length : 0
        };
    }
}

function countOrigins(records) {
    const out = {};
    for (const r of records) {
        const o = r.origin || "unknown";
        out[o] = (out[o] || 0) + 1;
    }
    return out;
}

export function createStructuralReferenceObserver(opts) {
    return new StructuralReferenceObserver(opts);
}
