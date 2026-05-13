// ---------------------------------------------------------------------------
// Capability Experience Log
// ---------------------------------------------------------------------------
// Per-turn log of capability routing decisions + module-activation gaps +
// any failures the runtime surfaces. Designed to be cheap, append-only, and
// independent from the FCE / memory-service receipt assimilation path.
//
// Storage:
//   test-results/capability-routing/<YYYY-MM-DD>.jsonl
// One JSON object per line. Append-only.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ORCHESTRATOR_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_DIR = path.join(ORCHESTRATOR_ROOT, "test-results", "capability-routing");

export class CapabilityExperienceLog {
    constructor({ dir = DEFAULT_DIR } = {}) {
        this.dir = dir;
        fs.mkdirSync(this.dir, { recursive: true });
    }

    /**
     * Append a single record. Caller passes a plan + outcome metadata.
     * @param {Object} entry
     * @param {string} entry.prompt_id
     * @param {Object} entry.plan          - a CapabilityActivationPlan
     * @param {string[]} [entry.modules_active]
     * @param {string[]} [entry.modules_missing]
     * @param {string} [entry.verdict]
     * @param {string[]} [entry.failures]
     * @param {string[]} [entry.gaps]
     */
    record(entry) {
        const row = {
            ts: new Date().toISOString(),
            prompt_id: String(entry.prompt_id || ""),
            primary_capability: entry.plan?.primary_capability || null,
            secondary_capabilities: entry.plan?.secondary_capabilities || [],
            confidence: entry.plan?.confidence ?? null,
            reason_codes: (entry.plan?.reason_codes || []).map(r => r.code),
            modules_active: entry.modules_active || [],
            modules_missing: entry.modules_missing || entry.plan?.missing_required_modules || [],
            verdict: entry.verdict || null,
            failures: entry.failures || [],
            gaps: entry.gaps || [],
        };
        const day = row.ts.slice(0, 10);
        const fp = path.join(this.dir, `${day}.jsonl`);
        fs.appendFileSync(fp, JSON.stringify(row) + "\n", "utf-8");
        return row;
    }

    /**
     * Read all records for a given day (or today).
     */
    readDay(day = null) {
        const d = day || new Date().toISOString().slice(0, 10);
        const fp = path.join(this.dir, `${d}.jsonl`);
        if (!fs.existsSync(fp)) return [];
        return fs.readFileSync(fp, "utf-8").trim().split("\n").filter(Boolean).map(l => {
            try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean);
    }
}

export { DEFAULT_DIR };
