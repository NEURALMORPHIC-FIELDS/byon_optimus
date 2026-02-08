/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON CLI - History Command
 * ==========================
 *
 * View execution history from the audit trail.
 *
 * Usage:
 *   byon history                  Show recent history
 *   byon history --limit 20       Limit results
 *   byon history --since 1d       Show last day
 *   byon history --status failed  Filter by status
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { HistoryOptions, CliResult } from "./types.js";
import { getDefaultConfig } from "../../byon-config.js";

// ============================================================================
// TYPES
// ============================================================================

interface HistoryEntry {
    id: string;
    type: "approval" | "execution" | "rejection";
    timestamp: string;
    summary: string;
    status: "success" | "partial" | "failed" | "rejected";
    details?: {
        risk_level?: string;
        actions_total?: number;
        actions_completed?: number;
        actions_failed?: number;
        duration_ms?: number;
        reason?: string;
    };
}

// ============================================================================
// MAIN COMMAND
// ============================================================================

/**
 * History command handler
 */
export async function historyCommand(options: HistoryOptions): Promise<CliResult> {
    const config = getDefaultConfig();
    const auditPath = path.resolve(config.audit.base_path, "audit-trail");
    const limit = options.limit || 20;
    const sinceMs = parseSince(options.since);

    try {
        const entries = await loadHistory(auditPath, {
            limit,
            sinceMs,
            status: options.status
        });

        if (options.json) {
            return { success: true, data: entries };
        }

        if (entries.length === 0) {
            return { success: true, message: "No history entries found" };
        }

        // Format output
        const lines: string[] = [];
        lines.push("BYON Execution History");
        lines.push("======================\n");

        for (const entry of entries) {
            const time = new Date(entry.timestamp).toLocaleString();
            const statusIcon = getStatusIcon(entry.status);
            const statusColor = getStatusColor(entry.status);

            lines.push(`${time}  ${statusColor}${statusIcon} ${entry.status.toUpperCase()}\x1b[0m`);
            lines.push(`  ID:      ${entry.id.slice(0, 8)}...`);
            lines.push(`  Type:    ${entry.type}`);
            lines.push(`  Summary: ${entry.summary.slice(0, 60)}${entry.summary.length > 60 ? "..." : ""}`);

            if (entry.details) {
                const d = entry.details;
                if (d.risk_level) {
                    lines.push(`  Risk:    ${d.risk_level}`);
                }
                if (d.actions_total !== undefined) {
                    lines.push(`  Actions: ${d.actions_completed || 0}/${d.actions_total} completed`);
                }
                if (d.actions_failed) {
                    lines.push(`  Failed:  ${d.actions_failed}`);
                }
                if (d.duration_ms) {
                    lines.push(`  Duration: ${d.duration_ms}ms`);
                }
                if (d.reason) {
                    lines.push(`  Reason:  ${d.reason}`);
                }
            }

            lines.push("");
        }

        lines.push(`Showing ${entries.length} of ${limit} max entries`);

        return { success: true, message: lines.join("\n") };
    } catch (error) {
        return {
            success: false,
            message: `Failed to load history: ${error}`
        };
    }
}

// ============================================================================
// HISTORY LOADING
// ============================================================================

async function loadHistory(
    auditPath: string,
    options: {
        limit: number;
        sinceMs?: number;
        status?: "approved" | "rejected" | "all";
    }
): Promise<HistoryEntry[]> {
    const entries: HistoryEntry[] = [];

    try {
        // Ensure directory exists
        await fs.mkdir(auditPath, { recursive: true });

        // Read all audit files
        const files = await fs.readdir(auditPath);
        const jsonFiles = files
            .filter(f => f.endsWith(".json"))
            .sort((a, b) => b.localeCompare(a)); // Newest first

        for (const file of jsonFiles) {
            if (entries.length >= options.limit) {break;}

            try {
                const content = await fs.readFile(path.join(auditPath, file), "utf-8");
                const record = JSON.parse(content);

                // Parse the record based on type
                const entry = parseAuditRecord(record);
                if (!entry) {continue;}

                // Filter by timestamp
                if (options.sinceMs) {
                    const entryTime = new Date(entry.timestamp).getTime();
                    if (entryTime < options.sinceMs) {continue;}
                }

                // Filter by status
                if (options.status && options.status !== "all") {
                    if (options.status === "approved" && entry.status !== "success") {continue;}
                    if (options.status === "rejected" && entry.status !== "rejected" && entry.status !== "failed") {continue;}
                }

                entries.push(entry);
            } catch {
                // Skip invalid files
            }
        }
    } catch {
        // Directory might not exist
    }

    return entries;
}

function parseAuditRecord(record: unknown): HistoryEntry | null {
    if (!record || typeof record !== "object") {return null;}
    const r = record as Record<string, unknown>;

    // Try to identify record type
    if (r.receipt_id) {
        // Johnson Receipt
        const summary = r.execution_summary as Record<string, unknown> | undefined;
        return {
            id: String(r.receipt_id),
            type: "execution",
            timestamp: String(r.timestamp || ""),
            summary: `Execution of order ${String(r.based_on_order || "").slice(0, 8)}...`,
            status: parseStatus(summary?.status),
            details: {
                actions_total: Number(summary?.actions_total) || 0,
                actions_completed: Number(summary?.actions_completed) || 0,
                actions_failed: Number(summary?.actions_failed) || 0,
                duration_ms: Number(summary?.duration_ms) || 0
            }
        };
    }

    if (r.request_id && r.decision) {
        // Approval decision
        return {
            id: String(r.request_id),
            type: r.decision === "reject" ? "rejection" : "approval",
            timestamp: String(r.decided_at || r.timestamp || ""),
            summary: String(r.summary || `${r.decision} decision`),
            status: r.decision === "reject" ? "rejected" : "success",
            details: {
                reason: String(r.reason || "")
            }
        };
    }

    if (r.order_id) {
        // Execution Order
        return {
            id: String(r.order_id),
            type: "approval",
            timestamp: String(r.timestamp || ""),
            summary: `Order based on plan ${String(r.based_on_plan || "").slice(0, 8)}...`,
            status: "success",
            details: {
                risk_level: String((r.constraints as Record<string, unknown>)?.risk_level || "")
            }
        };
    }

    return null;
}

function parseStatus(status: unknown): HistoryEntry["status"] {
    if (status === "success" || status === "partial" || status === "failed" || status === "rejected") {
        return status;
    }
    return "success";
}

// ============================================================================
// HELPERS
// ============================================================================

function parseSince(since?: string): number | undefined {
    if (!since) {return undefined;}

    const match = since.match(/^(\d+)([hdwm])$/);
    if (!match) {return undefined;}

    const value = parseInt(match[1], 10);
    const unit = match[2];

    const now = Date.now();
    switch (unit) {
        case "h": return now - value * 60 * 60 * 1000;
        case "d": return now - value * 24 * 60 * 60 * 1000;
        case "w": return now - value * 7 * 24 * 60 * 60 * 1000;
        case "m": return now - value * 30 * 24 * 60 * 60 * 1000;
        default: return undefined;
    }
}

function getStatusIcon(status: HistoryEntry["status"]): string {
    switch (status) {
        case "success": return "\u2713";
        case "partial": return "\u26A0";
        case "failed": return "\u2717";
        case "rejected": return "\u2717";
    }
}

function getStatusColor(status: HistoryEntry["status"]): string {
    switch (status) {
        case "success": return "\x1b[32m";
        case "partial": return "\x1b[33m";
        case "failed": return "\x1b[31m";
        case "rejected": return "\x1b[31m";
    }
}
