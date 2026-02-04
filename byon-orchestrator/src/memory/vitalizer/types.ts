/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * GMV Types - Global Memory Vitalizer
 * ====================================
 *
 * Type definitions pentru Global Memory Vitalizer.
 * Toate tipurile sunt pure data structures - nicio logică.
 *
 * GMV Constraints:
 * - Read-only pe FHRSS+FCPE + audit trail
 * - Write-only metadata (attractors, summary)
 * - Zero acces executor, canale, rețea
 * - Zero generare text conversațional
 */

// ============================================================================
// ATTRACTOR
// ============================================================================

/**
 * Attractor - cluster semantic emergent
 *
 * Reprezintă o "temă" sau "domeniu" care atrage evenimente din memorie.
 * NU este generat de LLM, ci calculat determinist din embeddings.
 */
export interface Attractor {
    document_type: "ATTRACTOR";
    document_version: "1.0";

    /** ID determinist (SHA256 din label) */
    attractor_id: string;

    /** Eticheta descriptivă (ex: "BYON-OpenClaw integration") */
    label: string;

    /** Numărul de evenimente recente care susțin acest attractor */
    support: number;

    /** Scor normalizat [0,1] bazat pe support × recency */
    score: number;

    /** Timestamp ISO8601 al ultimei activități */
    last_activity: string;

    /** Context IDs din FHRSS+FCPE asociate acestui attractor */
    ctx_ids: number[];

    /** Domenii semantice (ex: ["memory", "security"]) */
    domains: string[];

    /** Tag-uri opționale pentru filtrare */
    tags?: string[];
}

// ============================================================================
// GLOBAL MEMORY SUMMARY
// ============================================================================

/**
 * Referință la un Attractor în summary
 */
export interface AttractorRef {
    attractor_id: string;
    score: number;
}

/**
 * Domeniu cu ponderea sa în sistem
 */
export interface DomainWeight {
    domain: string;
    weight: number;
}

/**
 * Fir de lucru stagnant (fără activitate recentă)
 */
export interface StagnantThread {
    label: string;
    days_inactive: number;
}

/**
 * GlobalMemorySummary - starea globală emergentă a memoriei
 *
 * NU este rezumat textual. Este o stare structurală:
 * - ce teme sunt active
 * - ce proiecte sunt dominante
 * - ce fire sunt stagnante
 * - coerența globală
 */
export interface GlobalMemorySummary {
    document_type: "GLOBAL_MEMORY_SUMMARY";
    document_version: "1.0";

    /** Timestamp ISO8601 al generării */
    timestamp: string;

    /** Coerență globală [0,1] - 1 = perfect coerent */
    system_coherence: number;

    /** Nivel calitativ de entropie */
    entropy_level: "stable" | "rising" | "fragmented";

    /** Atractorii activi, sortați descrescător după scor */
    active_attractors: AttractorRef[];

    /** Domeniile dominante cu ponderile lor */
    dominant_domains: DomainWeight[];

    /** Fire de lucru stagnante */
    stagnant_threads: StagnantThread[];
}

// ============================================================================
// MEMORY EVENT (input pentru GMV)
// ============================================================================

/**
 * MemoryEvent - eveniment citit din FHRSS+FCPE
 *
 * GMV consumă aceste evenimente READ-ONLY și produce metadata.
 */
export interface MemoryEvent {
    /** Context ID din FHRSS+FCPE */
    ctx_id: number;

    /** Embedding vector (384-dim pentru FCPE) */
    embedding: number[];

    /** Timestamp ISO8601 al stocării */
    timestamp: string;

    /** Domenii semantice asociate */
    domains: string[];

    /** Tag-uri opționale */
    tags?: string[];

    /** Tipul de memorie (code, conversation, fact) */
    memory_type?: "code" | "conversation" | "fact";
}

// ============================================================================
// AUDIT EVENT (input pentru GMV)
// ============================================================================

/**
 * AuditEvent - eveniment citit din audit trail
 *
 * GMV poate observa audit trail-ul pentru a detecta pattern-uri de execuție.
 */
export interface AuditEvent {
    /** Receipt ID sau document ID */
    document_id: string;

    /** Timestamp ISO8601 */
    timestamp: string;

    /** Tip de document */
    document_type: string;

    /** Stare (executed, failed, etc.) */
    status: string;

    /** Domenii asociate */
    domains: string[];
}

// ============================================================================
// GMV CONFIG
// ============================================================================

/**
 * Configurare pentru GMV daemon
 */
export interface GMVConfig {
    /** Interval între cicluri (ms) - default 60000 (1 min) */
    interval_ms: number;

    /** Calea către baza de date SQLite pentru metadata */
    db_path: string;

    /** Prag minim de support pentru un attractor */
    min_support: number;

    /** Recency decay factor (0-1) */
    recency_decay: number;

    /** Număr maxim de attractori activi în summary */
    max_active_attractors: number;

    /** Zile de inactivitate pentru a fi considerat stagnant */
    stagnant_threshold_days: number;
}

/**
 * Default config pentru GMV
 */
export const DEFAULT_GMV_CONFIG: GMVConfig = {
    interval_ms: 60_000,
    db_path: "memory/gmv.sqlite",
    min_support: 3,
    recency_decay: 0.95,
    max_active_attractors: 16,
    stagnant_threshold_days: 7
};

// ============================================================================
// GMV API (read-only exports pentru Worker/Auditor)
// ============================================================================

/**
 * API pentru consumatori (Worker, Auditor, OpenClaw)
 * Toate metodele sunt READ-ONLY
 */
export interface GMVReadOnlyAPI {
    /** Obține summary-ul global curent */
    getGlobalMemorySummary(): GlobalMemorySummary | null;

    /** Obține top N attractori sortați după scor */
    getTopAttractors(n: number): Attractor[];

    /** Obține un attractor specific după ID */
    getAttractor(attractorId: string): Attractor | null;

    /** Obține atractorii pentru un domeniu specific */
    getAttractorsByDomain(domain: string): Attractor[];
}
