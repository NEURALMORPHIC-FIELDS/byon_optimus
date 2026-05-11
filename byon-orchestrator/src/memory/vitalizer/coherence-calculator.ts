/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Coherence Calculator - Global State Computation
 * ================================================
 *
 * Calculator determinist pentru starea globală a memoriei.
 * Produce GlobalMemorySummary din attractori.
 *
 * Metrici:
 * - system_coherence: 1 - (clusters / events) - mai puține clustere = mai coerent
 * - entropy_level: stable | rising | fragmented
 * - dominant_domains: top domenii după support
 * - stagnant_threads: domenii fără activitate recentă
 */

import { Attractor, GlobalMemorySummary, StagnantThread, DomainWeight, AttractorRef, GMVConfig, DEFAULT_GMV_CONFIG } from "./types.js";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Coherence thresholds */
const COHERENCE_STABLE_THRESHOLD = 0.75;
const COHERENCE_RISING_THRESHOLD = 0.40;

/** Maximum items in summary arrays */
const MAX_ACTIVE_ATTRACTORS = 16;
const MAX_DOMINANT_DOMAINS = 8;
const MAX_STAGNANT_THREADS = 32;

// ============================================================================
// COHERENCE CALCULATION
// ============================================================================

/**
 * Calculate system coherence from attractors
 *
 * Coherence = 1 - (num_attractors / total_support)
 * - High coherence: few attractors, high support each
 * - Low coherence: many attractors, scattered support
 */
function calculateCoherence(attractors: Attractor[]): number {
    if (attractors.length === 0) {
        return 1.0; // Empty system is "perfectly coherent"
    }

    const totalSupport = attractors.reduce((sum, a) => sum + a.support, 0);

    if (totalSupport === 0) {
        return 0.5; // No support = neutral coherence
    }

    // More attractors relative to support = lower coherence
    const fragmentation = attractors.length / Math.max(1, totalSupport);

    // Invert and clamp to [0, 1]
    const coherence = Math.max(0, Math.min(1, 1 - fragmentation));

    return Number(coherence.toFixed(3));
}

/**
 * Determine entropy level from coherence
 */
function determineEntropyLevel(coherence: number): "stable" | "rising" | "fragmented" {
    if (coherence > COHERENCE_STABLE_THRESHOLD) {
        return "stable";
    } else if (coherence > COHERENCE_RISING_THRESHOLD) {
        return "rising";
    } else {
        return "fragmented";
    }
}

// ============================================================================
// DOMAIN ANALYSIS
// ============================================================================

/**
 * Calculate dominant domains with weights
 */
function calculateDominantDomains(attractors: Attractor[]): DomainWeight[] {
    const domainSupport = new Map<string, number>();
    let totalSupport = 0;

    for (const a of attractors) {
        for (const domain of a.domains) {
            const current = domainSupport.get(domain) || 0;
            domainSupport.set(domain, current + a.support);
            totalSupport += a.support;
        }
    }

    if (totalSupport === 0) {
        return [];
    }

    // Convert to weighted array
    const weighted: DomainWeight[] = Array.from(domainSupport.entries())
        .map(([domain, support]) => ({
            domain,
            weight: Number((support / totalSupport).toFixed(3))
        }))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, MAX_DOMINANT_DOMAINS);

    return weighted;
}

// ============================================================================
// STAGNATION DETECTION
// ============================================================================

/**
 * Detect stagnant threads (no recent activity)
 */
function detectStagnantThreads(
    attractors: Attractor[],
    stagnantThresholdDays: number,
    now: Date = new Date()
): StagnantThread[] {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - stagnantThresholdDays);

    const stagnant: StagnantThread[] = [];

    for (const a of attractors) {
        const lastActivity = new Date(a.last_activity);

        if (lastActivity < cutoff) {
            const daysInactive = Math.floor(
                (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24)
            );

            stagnant.push({
                label: a.label,
                days_inactive: daysInactive
            });
        }
    }

    // Sort by days inactive (descending)
    return stagnant
        .sort((a, b) => b.days_inactive - a.days_inactive)
        .slice(0, MAX_STAGNANT_THREADS);
}

// ============================================================================
// ACTIVE ATTRACTORS
// ============================================================================

/**
 * Get active attractors for summary (top N by score)
 */
function getActiveAttractors(
    attractors: Attractor[],
    maxCount: number = MAX_ACTIVE_ATTRACTORS
): AttractorRef[] {
    return attractors
        .sort((a, b) => b.score - a.score)
        .slice(0, maxCount)
        .map(a => ({
            attractor_id: a.attractor_id,
            score: a.score
        }));
}

// ============================================================================
// SUMMARY COMPUTATION
// ============================================================================

export interface ComputeSummaryOptions {
    /** Maximum active attractors in summary */
    maxActiveAttractors?: number;

    /** Days threshold for stagnation */
    stagnantThresholdDays?: number;

    /** Current timestamp for calculations */
    now?: Date;
}

const DEFAULT_COMPUTE_OPTIONS: ComputeSummaryOptions = {
    maxActiveAttractors: DEFAULT_GMV_CONFIG.max_active_attractors,
    stagnantThresholdDays: DEFAULT_GMV_CONFIG.stagnant_threshold_days,
    now: undefined
};

/**
 * Compute GlobalMemorySummary from attractors
 *
 * @param attractors - Current attractors
 * @param options - Computation options
 * @returns GlobalMemorySummary
 */
export function computeSummary(
    attractors: Attractor[],
    options: ComputeSummaryOptions = {}
): GlobalMemorySummary {
    const opts = { ...DEFAULT_COMPUTE_OPTIONS, ...options };
    const now = opts.now || new Date();

    // Calculate metrics
    const systemCoherence = calculateCoherence(attractors);
    const entropyLevel = determineEntropyLevel(systemCoherence);
    const activeAttractors = getActiveAttractors(attractors, opts.maxActiveAttractors);
    const dominantDomains = calculateDominantDomains(attractors);
    const stagnantThreads = detectStagnantThreads(attractors, opts.stagnantThresholdDays!, now);

    return {
        document_type: "GLOBAL_MEMORY_SUMMARY",
        document_version: "1.0",
        timestamp: now.toISOString(),
        system_coherence: systemCoherence,
        entropy_level: entropyLevel,
        active_attractors: activeAttractors,
        dominant_domains: dominantDomains,
        stagnant_threads: stagnantThreads
    };
}

// ============================================================================
// CHANGE DETECTION
// ============================================================================

/**
 * Detect significant changes between two summaries
 */
export function detectChanges(
    previous: GlobalMemorySummary | null,
    current: GlobalMemorySummary
): {
    coherence_changed: boolean;
    entropy_changed: boolean;
    new_attractors: string[];
    removed_attractors: string[];
    new_stagnant: string[];
} {
    if (!previous) {
        return {
            coherence_changed: true,
            entropy_changed: true,
            new_attractors: current.active_attractors.map(a => a.attractor_id),
            removed_attractors: [],
            new_stagnant: current.stagnant_threads.map(t => t.label)
        };
    }

    const prevAttractorIds = new Set(previous.active_attractors.map(a => a.attractor_id));
    const currAttractorIds = new Set(current.active_attractors.map(a => a.attractor_id));

    const prevStagnant = new Set(previous.stagnant_threads.map(t => t.label));
    const currStagnant = new Set(current.stagnant_threads.map(t => t.label));

    return {
        coherence_changed: Math.abs(previous.system_coherence - current.system_coherence) > 0.1,
        entropy_changed: previous.entropy_level !== current.entropy_level,
        new_attractors: Array.from(currAttractorIds).filter(id => !prevAttractorIds.has(id)),
        removed_attractors: Array.from(prevAttractorIds).filter(id => !currAttractorIds.has(id)),
        new_stagnant: Array.from(currStagnant).filter(label => !prevStagnant.has(label))
    };
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * Check if system is in healthy state
 */
export function checkSystemHealth(summary: GlobalMemorySummary): {
    healthy: boolean;
    warnings: string[];
} {
    const warnings: string[] = [];

    if (summary.entropy_level === "fragmented") {
        warnings.push("System is fragmented - memory lacks coherence");
    }

    if (summary.stagnant_threads.length > 10) {
        warnings.push(`Many stagnant threads (${summary.stagnant_threads.length})`);
    }

    if (summary.active_attractors.length === 0) {
        warnings.push("No active attractors - system may need more data");
    }

    if (summary.system_coherence < 0.3) {
        warnings.push(`Low coherence (${summary.system_coherence})`);
    }

    return {
        healthy: warnings.length === 0,
        warnings
    };
}
