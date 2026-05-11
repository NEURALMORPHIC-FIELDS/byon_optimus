/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Global Memory Vitalizer (GMV) - Module Export
 * ==============================================
 *
 * GMV menține starea globală emergentă a memoriei prin metadata.
 *
 * Constraints:
 * - Read-only pe FHRSS+FCPE + audit trail
 * - Write-only metadata (attractors, summary)
 * - Zero acces executor, canale, rețea
 * - Zero generare text conversațional
 *
 * Usage:
 * ```ts
 * import { startGMVDaemon, createGMVReadOnlyAPI } from './memory/vitalizer';
 *
 * // Start daemon
 * const daemon = startGMVDaemon({ verbose: true });
 *
 * // Get read-only API for Worker/Auditor
 * const api = daemon.getAPI();
 * const summary = api.getGlobalMemorySummary();
 * const topAttractors = api.getTopAttractors(5);
 * ```
 */

// Types
export type {
    Attractor,
    AttractorRef,
    DomainWeight,
    StagnantThread,
    GlobalMemorySummary,
    MemoryEvent,
    AuditEvent,
    GMVConfig,
    GMVReadOnlyAPI
} from "./types.js";

export { DEFAULT_GMV_CONFIG } from "./types.js";

// Store
export { GMVStore, createGMVStore, createGMVReadOnlyAPI } from "./store.js";

// Attractor Engine
export {
    buildAttractors,
    decayAttractors,
    filterWeakAttractors,
    rankDomains
} from "./attractor-engine.js";

// Coherence Calculator
export {
    computeSummary,
    detectChanges,
    checkSystemHealth
} from "./coherence-calculator.js";

// Daemon
export type { GMVDaemonState, GMVDaemonOptions } from "./daemon.js";
export {
    GMVDaemon,
    startGMVDaemon,
    createGMVDaemon
} from "./daemon.js";
