/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON CLI Types
 * ==============
 *
 * Shared types for BYON CLI commands.
 */

/** CLI command result */
export interface CliResult {
    success: boolean;
    message?: string;
    data?: unknown;
}

/** Common CLI options */
export interface CliOptions {
    verbose?: boolean;
    json?: boolean;
    config?: string;
}

/** Watch options */
export interface WatchOptions extends CliOptions {
    interval?: number;
    filter?: "pending" | "approved" | "rejected" | "all";
}

/** Approve options */
export interface ApproveOptions extends CliOptions {
    reason?: string;
    auto?: boolean;
}

/** History options */
export interface HistoryOptions extends CliOptions {
    limit?: number;
    since?: string;
    status?: "approved" | "rejected" | "all";
}

/** Status options */
export interface StatusOptions extends CliOptions {
    memory?: boolean;
    agents?: boolean;
    handoff?: boolean;
}

/** Inbox options */
export interface InboxOptions extends CliOptions {
    limit?: number;
    unread?: boolean;
}
