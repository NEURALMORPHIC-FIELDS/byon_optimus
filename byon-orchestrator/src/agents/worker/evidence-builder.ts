/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Worker Evidence Builder
 * =======================
 *
 * Builds EvidencePacks for the Worker agent.
 * Integrates with GMV for structural bias (read-only).
 *
 * IMPORTANT:
 * - GMV provides METADATA ONLY (no text content)
 * - Worker does NOT read attractor labels, only IDs
 * - Auditor validates GMV hint is metadata-only
 */

import { GMVStore, createGMVStore } from "../../memory/vitalizer/store.js";
import {
    EvidencePackBuilder,
    createEvidencePackBuilder,
    createGlobalMemoryHint
} from "../../protocol/evidence-pack.js";
import {
    EvidencePack,
    FceContextMetadata,
    GlobalMemoryHint,
    Source,
    ExtractedFact,
    MemoryContext,
    CodebaseContext,
    TaskType
} from "../../types/protocol.js";
import type { MemoryClient } from "../../memory/client.js";

// ============================================================================
// GMV INTEGRATION
// ============================================================================

let gmvStore: GMVStore | null = null;

/**
 * Initialize GMV store for evidence building
 * Call this at Worker startup
 */
export function initializeGMVStore(dbPath?: string): void {
    gmvStore = createGMVStore({ db_path: dbPath });
}

/**
 * Get GMV store instance
 */
function getGMVStore(): GMVStore | null {
    return gmvStore;
}

/**
 * Attach GlobalMemoryHint to EvidencePack (read-only)
 *
 * IMPORTANT:
 * - This reads ONLY metadata from GMV (IDs, state)
 * - NO text content (labels) is included
 * - Auditor MUST validate this before processing
 */
export function attachGlobalMemoryHint(ep: EvidencePack): EvidencePack {
    const store = getGMVStore();
    if (!store) {
        return ep;
    }

    const summary = store.getGlobalMemorySummary();
    if (!summary) {
        return ep;
    }

    // Create hint with ONLY metadata (no labels)
    const hint: GlobalMemoryHint = {
        summary_ref: "GLOBAL_MEMORY_SUMMARY",
        timestamp: summary.timestamp,
        entropy_level: summary.entropy_level,
        active_attractor_ids: summary.active_attractors.map(a => a.attractor_id),
        system_coherence: summary.system_coherence
    };

    return {
        ...ep,
        global_memory_hint: hint
    };
}

// ============================================================================
// EVIDENCE BUILDING
// ============================================================================

export interface BuildEvidenceOptions {
    taskType: TaskType;
    sources: Source[];
    facts?: ExtractedFact[];
    memoryContext?: MemoryContext;
    codebaseContext?: CodebaseContext;
    includeGMVHint?: boolean;
    /** Pre-fetched FCE-M context; if provided, attached to EvidencePack. */
    fceContext?: FceContextMetadata;
}

/**
 * Build an EvidencePack with optional GMV integration
 */
export function buildEvidence(options: BuildEvidenceOptions): EvidencePack {
    const builder = createEvidencePackBuilder()
        .withRandomId()
        .withTaskType(options.taskType)
        .addSources(options.sources);

    // Add facts if provided
    if (options.facts) {
        for (const fact of options.facts) {
            builder.addFact(fact);
        }
    }

    // Set memory context
    if (options.memoryContext) {
        builder.withMemoryContext(options.memoryContext);
    }

    // Set codebase context
    if (options.codebaseContext) {
        builder.withCodebaseContext(options.codebaseContext);
    }

    // Build base evidence
    let evidence = builder.build();

    // Attach GMV hint if requested
    if (options.includeGMVHint !== false) {
        evidence = attachGlobalMemoryHint(evidence);
    }

    // Attach FCE-M context if provided
    if (options.fceContext && options.fceContext.enabled) {
        evidence = { ...evidence, fce_context: sanitizeFceContext(options.fceContext) };
    }

    return evidence;
}

// ============================================================================
// FCE-M CONTEXT
// ============================================================================

/**
 * Fetch FCE-M context from MemoryClient and shape it for EvidencePack.
 *
 * Returns `null` when:
 * - The memory client throws (network / backend down).
 * - FCE-M backend reports disabled.
 *
 * Auditor will reject any FceContextMetadata that contains content text.
 * sanitizeFceContext keeps only counts + hashed center ids.
 */
export async function fetchFceContext(
    memoryClient: MemoryClient,
    query?: string
): Promise<FceContextMetadata | null> {
    try {
        const ctx = await memoryClient.getFceMemoryContext(query);
        if (!ctx || !ctx.enabled || !ctx.morphogenesis) {
            return null;
        }
        const m = ctx.morphogenesis;
        return sanitizeFceContext({
            enabled: true,
            query: m.query,
            omega_active: m.omega_active,
            omega_contested: m.omega_contested,
            omega_inexpressed: m.omega_inexpressed,
            omega_total: m.omega_total,
            reference_fields_count: m.reference_fields_count,
            aligned_reference_fields: m.aligned_reference_fields,
            contested_expressions: m.contested_expressions,
            high_residue_centers: m.high_residue_centers,
            advisory_count: m.advisory_count,
            priority_recommendations_count: m.priority_recommendations_count,
            relation_candidates_count: m.relation_candidates_count,
            risk_centers: ctx.risk_centers,
            morphogenesis_summary: m.morphogenesis_summary
        });
    } catch {
        return null;
    }
}

/**
 * Defensive sanitizer — caps array sizes and trims summary to keep
 * EvidencePack small and ensure no surprise content leaks through.
 */
function sanitizeFceContext(ctx: FceContextMetadata): FceContextMetadata {
    const cap = (arr: string[] | undefined, n: number): string[] =>
        (arr || []).filter(s => typeof s === "string").slice(0, n);
    return {
        enabled: !!ctx.enabled,
        query: ctx.query ? String(ctx.query).slice(0, 200) : undefined,
        omega_active: Number(ctx.omega_active || 0),
        omega_contested: Number(ctx.omega_contested || 0),
        omega_inexpressed: Number(ctx.omega_inexpressed || 0),
        omega_total: Number(ctx.omega_total || 0),
        reference_fields_count: Number(ctx.reference_fields_count || 0),
        aligned_reference_fields: cap(ctx.aligned_reference_fields, 8),
        contested_expressions: cap(ctx.contested_expressions, 8),
        high_residue_centers: cap(ctx.high_residue_centers, 8),
        advisory_count: Number(ctx.advisory_count || 0),
        priority_recommendations_count: Number(
            ctx.priority_recommendations_count || 0
        ),
        relation_candidates_count: Number(ctx.relation_candidates_count || 0),
        risk_centers: cap(ctx.risk_centers, 16),
        morphogenesis_summary: String(ctx.morphogenesis_summary || "").slice(0, 160)
    };
}

// ============================================================================
// CONTEXT BIAS FROM GMV
// ============================================================================

/**
 * Get context bias from GMV for memory search prioritization
 *
 * This helps Worker decide which memory contexts to search first.
 * Uses GMV's active attractors as a structural hint.
 *
 * IMPORTANT: This is READ-ONLY and does not influence decisions directly.
 */
export function getContextBias(): {
    priority_domains: string[];
    entropy_level: "stable" | "rising" | "fragmented";
    coherence: number;
} | null {
    const store = getGMVStore();
    if (!store) {
        return null;
    }

    const summary = store.getGlobalMemorySummary();
    if (!summary) {
        return null;
    }

    return {
        priority_domains: summary.dominant_domains.slice(0, 5).map(d => d.domain),
        entropy_level: summary.entropy_level,
        coherence: summary.system_coherence
    };
}

/**
 * Check if a task might be redundant based on GMV state
 *
 * This is a HINT only - not a decision.
 * Worker can use this to flag potential redundancy for Auditor review.
 */
export function checkPotentialRedundancy(taskDescription: string): {
    possibly_redundant: boolean;
    reason?: string;
} {
    const store = getGMVStore();
    if (!store) {
        return { possibly_redundant: false };
    }

    const attractors = store.getTopAttractors(10);

    // Check if any attractor label contains similar keywords
    // Note: This uses labels which is acceptable for internal Worker logic
    // but NOT for EvidencePack output
    const taskWords = taskDescription.toLowerCase().split(/\s+/);

    for (const attractor of attractors) {
        const labelWords = attractor.label.toLowerCase().split(/\s+/);
        const overlap = taskWords.filter(w => labelWords.includes(w));

        if (overlap.length >= 2 && attractor.support > 20) {
            return {
                possibly_redundant: true,
                reason: `Similar to active attractor with ${attractor.support} recent activities`
            };
        }
    }

    return { possibly_redundant: false };
}
