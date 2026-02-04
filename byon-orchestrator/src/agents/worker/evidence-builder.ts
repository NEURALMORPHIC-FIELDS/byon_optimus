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
    GlobalMemoryHint,
    Source,
    ExtractedFact,
    MemoryContext,
    CodebaseContext,
    TaskType
} from "../../types/protocol.js";

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

    return evidence;
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
