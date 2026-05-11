/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Manifest Module Exports
 * =======================
 *
 * Central export for project manifest generation.
 */

export { generateManifest, writeManifest } from "./project-manifest.js";

export type {
    ProjectManifest,
    ComponentEntry,
    NamingConvention,
    GitignoredEntry,
} from "./manifest-types.js";
