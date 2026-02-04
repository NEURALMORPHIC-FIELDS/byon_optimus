/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Attractor Engine - Cluster Builder
 * ===================================
 *
 * Motor determinist pentru construirea attractorilor din evenimente de memorie.
 * NU folosește LLM sau rețele neuronale - doar clustering simplu.
 *
 * Algoritm:
 * 1. Grupare evenimente pe domenii
 * 2. Calcul support (număr de evenimente)
 * 3. Calcul score (support × recency decay)
 * 4. Generare ID determinist (SHA256)
 */

import crypto from "crypto";
import { Attractor, MemoryEvent, GMVConfig, DEFAULT_GMV_CONFIG } from "./types.js";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum ctx_ids stored per attractor */
const MAX_CTX_IDS = 2000;

/** Score normalization factor */
const SCORE_NORMALIZATION = 50;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate deterministic attractor ID from label
 */
function generateAttractorId(label: string): string {
    return crypto
        .createHash("sha256")
        .update(label.toLowerCase().trim())
        .digest("hex");
}

/**
 * Calculate recency score for a timestamp
 */
function calculateRecencyScore(timestamp: string, now: Date, decayFactor: number): number {
    const eventDate = new Date(timestamp);
    const daysDiff = (now.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24);

    // Exponential decay
    return Math.pow(decayFactor, daysDiff);
}

/**
 * Find most recent timestamp in a list
 */
function findMostRecentTimestamp(timestamps: string[]): string {
    return timestamps.reduce((a, b) => (a > b ? a : b), timestamps[0]);
}

// ============================================================================
// ATTRACTOR BUILDER
// ============================================================================

export interface AttractorBuildOptions {
    /** Minimum support to create attractor */
    minSupport: number;

    /** Recency decay factor */
    recencyDecay: number;

    /** Current timestamp for recency calculation */
    now?: Date;
}

const DEFAULT_BUILD_OPTIONS: AttractorBuildOptions = {
    minSupport: DEFAULT_GMV_CONFIG.min_support,
    recencyDecay: DEFAULT_GMV_CONFIG.recency_decay,
    now: undefined
};

/**
 * Build attractors from memory events
 *
 * @param events - Memory events to process
 * @param existing - Existing attractors (for merging)
 * @param options - Build options
 * @returns Array of attractors
 */
export function buildAttractors(
    events: MemoryEvent[],
    existing: Attractor[] = [],
    options: Partial<AttractorBuildOptions> = {}
): Attractor[] {
    const opts = { ...DEFAULT_BUILD_OPTIONS, ...options };
    const now = opts.now || new Date();

    // Group events by domain
    const byDomain = new Map<string, MemoryEvent[]>();

    for (const event of events) {
        for (const domain of event.domains) {
            const normalized = domain.toLowerCase().trim();
            if (!byDomain.has(normalized)) {
                byDomain.set(normalized, []);
            }
            byDomain.get(normalized)!.push(event);
        }
    }

    // Build new attractors
    const attractors: Attractor[] = [];

    for (const [domain, domainEvents] of byDomain.entries()) {
        // Skip if below minimum support
        if (domainEvents.length < opts.minSupport) {
            continue;
        }

        const attractorId = generateAttractorId(domain);
        const ctxIds = domainEvents.map(e => e.ctx_id);
        const timestamps = domainEvents.map(e => e.timestamp);
        const lastActivity = findMostRecentTimestamp(timestamps);

        // Calculate support with recency weighting
        const support = domainEvents.reduce((sum, event) => {
            const recency = calculateRecencyScore(event.timestamp, now, opts.recencyDecay);
            return sum + recency;
        }, 0);

        // Normalize score to [0, 1]
        const score = Math.min(1, support / SCORE_NORMALIZATION);

        // Collect all unique tags
        const allTags = new Set<string>();
        for (const event of domainEvents) {
            if (event.tags) {
                for (const tag of event.tags) {
                    allTags.add(tag);
                }
            }
        }

        attractors.push({
            document_type: "ATTRACTOR",
            document_version: "1.0",
            attractor_id: attractorId,
            label: domain,
            support: Math.round(support),
            score: Number(score.toFixed(3)),
            last_activity: lastActivity,
            ctx_ids: ctxIds.slice(0, MAX_CTX_IDS),
            domains: [domain],
            tags: Array.from(allTags).slice(0, 64)
        });
    }

    // Merge with existing attractors
    return mergeAttractors(existing, attractors, opts);
}

/**
 * Merge existing attractors with new ones
 */
function mergeAttractors(
    existing: Attractor[],
    newAttractors: Attractor[],
    options: AttractorBuildOptions
): Attractor[] {
    const merged = new Map<string, Attractor>();

    // Add existing
    for (const a of existing) {
        merged.set(a.attractor_id, a);
    }

    // Merge or replace with new
    for (const a of newAttractors) {
        const existingAttractor = merged.get(a.attractor_id);

        if (existingAttractor) {
            // Merge ctx_ids (dedupe)
            const mergedCtxIds = new Set([...existingAttractor.ctx_ids, ...a.ctx_ids]);

            // Update with newer data
            merged.set(a.attractor_id, {
                ...a,
                support: a.support + existingAttractor.support,
                score: Math.min(1, (a.score + existingAttractor.score) / 2),
                ctx_ids: Array.from(mergedCtxIds).slice(0, MAX_CTX_IDS),
                last_activity: a.last_activity > existingAttractor.last_activity
                    ? a.last_activity
                    : existingAttractor.last_activity
            });
        } else {
            merged.set(a.attractor_id, a);
        }
    }

    return Array.from(merged.values());
}

/**
 * Decay existing attractors (reduce score over time)
 */
export function decayAttractors(
    attractors: Attractor[],
    decayFactor: number = DEFAULT_GMV_CONFIG.recency_decay,
    now: Date = new Date()
): Attractor[] {
    return attractors.map(a => {
        const daysSinceActivity =
            (now.getTime() - new Date(a.last_activity).getTime()) / (1000 * 60 * 60 * 24);

        const decay = Math.pow(decayFactor, daysSinceActivity);
        const newScore = Number((a.score * decay).toFixed(3));

        return {
            ...a,
            score: Math.max(0, newScore)
        };
    });
}

/**
 * Filter attractors below minimum score
 */
export function filterWeakAttractors(
    attractors: Attractor[],
    minScore: number = 0.01
): Attractor[] {
    return attractors.filter(a => a.score >= minScore);
}

/**
 * Get attractor domains ranked by total support
 */
export function rankDomains(attractors: Attractor[]): Map<string, number> {
    const domainSupport = new Map<string, number>();

    for (const a of attractors) {
        for (const domain of a.domains) {
            const current = domainSupport.get(domain) || 0;
            domainSupport.set(domain, current + a.support);
        }
    }

    return new Map(
        Array.from(domainSupport.entries())
            .sort((a, b) => b[1] - a[1])
    );
}
