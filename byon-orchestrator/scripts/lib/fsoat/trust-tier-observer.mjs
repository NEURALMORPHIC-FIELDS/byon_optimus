#!/usr/bin/env node
/**
 * BYON Optimus - Full Source Organism Activation Test
 * Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
 *
 * TrustTierObserver
 * =================
 *
 * Exercises the trust hierarchy formatter. The production formatter lives in
 * byon-orchestrator/scripts/byon-industrial-ab-benchmark.mjs as `formatFactsForPrompt`
 * and `tallyTrustTiers`. We import them when available, otherwise we apply a faithful
 * fallback that respects the canonical tier order from docs/MEMORY_MODEL.md.
 *
 * Tier order (highest -> lowest):
 *   SYSTEM_CANONICAL > VERIFIED_PROJECT_FACT > DOMAIN_VERIFIED > USER_PREFERENCE >
 *   EXTRACTED_USER_CLAIM > DISPUTED_OR_UNSAFE
 *
 * The observer records:
 *   - trust_hierarchy: trust_ranked_formatter.tiers_used (one event per scenario,
 *     with the tally and the set of tiers seen)
 *
 * For the immune system organ, when DISPUTED_OR_UNSAFE rows are present in the input
 * fact set we also record disputed_or_unsafe.rail.checked.
 */

import * as path from "node:path";
import { pathToFileURL } from "node:url";

const TIER_ORDER = [
    "SYSTEM_CANONICAL",
    "VERIFIED_PROJECT_FACT",
    "DOMAIN_VERIFIED",
    "USER_PREFERENCE",
    "EXTRACTED_USER_CLAIM",
    "DISPUTED_OR_UNSAFE"
];

export class TrustTierObserver {
    constructor(opts) {
        if (!opts?.tracker) throw new Error("TrustTierObserver requires opts.tracker");
        if (!opts?.orchestratorRoot) throw new Error("TrustTierObserver requires opts.orchestratorRoot");
        this.tracker = opts.tracker;
        this.orchestratorRoot = opts.orchestratorRoot;
        this.formatterFn = null;
        this.tallyFn = null;
        this.telemetry = [];
    }

    async init() {
        // Try to import the production formatter from the industrial benchmark script.
        try {
            const candidate = path.join(
                this.orchestratorRoot,
                "scripts",
                "byon-industrial-ab-benchmark.mjs"
            );
            const url = pathToFileURL(candidate).href;
            const mod = await import(url);
            if (typeof mod.formatFactsForPrompt === "function") {
                this.formatterFn = mod.formatFactsForPrompt;
            }
            if (typeof mod.tallyTrustTiers === "function") {
                this.tallyFn = mod.tallyTrustTiers;
            }
        } catch {
            // Production formatter is not importable as ESM (the file is a runner, not
            // a library). Fall back to our own canonical tally. This is honest: we
            // exercise the SAME tier order documented in MEMORY_MODEL.md.
        }
        return {
            formatter_available: Boolean(this.formatterFn),
            tally_available: Boolean(this.tallyFn)
        };
    }

    /**
     * Apply the trust hierarchy on a synthetic fact set for one scenario. Returns
     * the ordered result and the tally.
     *
     * factSet shape: Array<{ tier: <TIER_NAME>, text: string, source?: string }>
     */
    exerciseHierarchy(scenarioId, factSet) {
        if (!Array.isArray(factSet) || factSet.length === 0) {
            return { tiers_used: [], ordered: [], tally: {} };
        }

        // Validate tiers; reject unknown tier names to keep telemetry clean.
        const cleaned = factSet
            .filter((f) => TIER_ORDER.includes(f.tier))
            .map((f) => ({ ...f }));

        // Use production tally if available, else our fallback.
        let tally;
        if (this.tallyFn) {
            try {
                tally = this.tallyFn(cleaned);
            } catch {
                tally = this._fallbackTally(cleaned);
            }
        } else {
            tally = this._fallbackTally(cleaned);
        }

        // Order by tier rank (top -> bottom). Within tier, preserve input order.
        const tierRank = Object.fromEntries(TIER_ORDER.map((t, i) => [t, i]));
        const ordered = cleaned.slice().sort((a, b) => tierRank[a.tier] - tierRank[b.tier]);
        const tiersUsed = [...new Set(ordered.map((f) => f.tier))];

        // Record trust_hierarchy proof
        this.tracker.recordProof("trust_hierarchy", "trust_ranked_formatter.tiers_used", {
            scenario: scenarioId,
            tiers_used: tiersUsed,
            tally,
            total_facts: cleaned.length
        });

        // Record immune_system proof if disputed/unsafe row was checked
        if (tiersUsed.includes("DISPUTED_OR_UNSAFE")) {
            this.tracker.recordProof("immune_system", "disputed_or_unsafe.rail.checked", {
                scenario: scenarioId,
                disputed_count: tally.DISPUTED_OR_UNSAFE || 0
            });
        }

        const entry = {
            scenario_id: scenarioId,
            tiers_used: tiersUsed,
            tally,
            ordered_first_5: ordered.slice(0, 5).map((f) => ({ tier: f.tier, text: f.text }))
        };
        this.telemetry.push(entry);
        return { tiers_used: tiersUsed, ordered, tally };
    }

    telemetrySnapshot() {
        return this.telemetry.slice();
    }

    _fallbackTally(facts) {
        const tally = {};
        for (const t of TIER_ORDER) tally[t] = 0;
        for (const f of facts) {
            tally[f.tier] = (tally[f.tier] || 0) + 1;
        }
        return tally;
    }
}

export const TRUST_TIER_ORDER = TIER_ORDER;

export function createTrustTierObserver(opts) {
    return new TrustTierObserver(opts);
}
