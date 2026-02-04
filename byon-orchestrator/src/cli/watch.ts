/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON CLI - Watch Command
 * ========================
 *
 * Watch for new approval requests and execution receipts in real-time.
 *
 * Usage:
 *   byon watch                    Watch all activity
 *   byon watch --approvals        Watch only approval requests
 *   byon watch --receipts         Watch only execution receipts
 *   byon watch --interval 5000    Set polling interval (ms)
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { WatchOptions, CliResult } from "./types.js";
import { getDefaultConfig } from "../../byon-config.js";

// ============================================================================
// TYPES
// ============================================================================

interface WatchEvent {
    type: "approval_request" | "execution_receipt" | "inbox_message";
    timestamp: string;
    id: string;
    summary: string;
    risk_level?: "low" | "medium" | "high";
    status?: "success" | "partial" | "failed" | "rejected";
}

// ============================================================================
// MAIN COMMAND
// ============================================================================

/**
 * Watch command handler
 */
export async function watchCommand(options: WatchOptions): Promise<CliResult> {
    const config = getDefaultConfig();
    const interval = options.interval || 2000;

    console.log("BYON Watch - Monitoring for activity...");
    console.log(`Interval: ${interval}ms`);
    console.log("Press Ctrl+C to stop\n");

    // Track seen files to detect new ones
    const seen = new Map<string, Set<string>>();

    // Initial scan
    const paths = {
        approvals: path.resolve(config.byon.handoff_base_path, "auditor_to_user"),
        receipts: path.resolve(config.byon.handoff_base_path, "executor_to_worker"),
        inbox: path.resolve(config.byon.handoff_base_path, "inbox")
    };

    for (const [key, dir] of Object.entries(paths)) {
        try {
            const files = await fs.readdir(dir);
            seen.set(key, new Set(files));
        } catch {
            seen.set(key, new Set());
        }
    }

    // Watch loop
    const watch = async (): Promise<void> => {
        while (true) {
            await new Promise(resolve => setTimeout(resolve, interval));

            // Check for new approval requests
            if (!options.filter || options.filter === "pending" || options.filter === "all") {
                await checkNewFiles(paths.approvals, "approvals", seen, (file, content) => {
                    printApprovalRequest(file, content);
                });
            }

            // Check for new receipts
            if (!options.filter || options.filter === "all") {
                await checkNewFiles(paths.receipts, "receipts", seen, (file, content) => {
                    printReceipt(file, content);
                });
            }

            // Check for new inbox messages
            if (!options.filter || options.filter === "all") {
                await checkNewFiles(paths.inbox, "inbox", seen, (file, content) => {
                    printInboxMessage(file, content);
                });
            }
        }
    };

    // Handle graceful shutdown
    process.on("SIGINT", () => {
        console.log("\nStopping watch...");
        process.exit(0);
    });

    await watch();

    return { success: true };
}

// ============================================================================
// FILE CHECKING
// ============================================================================

async function checkNewFiles(
    dir: string,
    key: string,
    seen: Map<string, Set<string>>,
    handler: (file: string, content: unknown) => void
): Promise<void> {
    try {
        const files = await fs.readdir(dir);
        const seenSet = seen.get(key) || new Set();

        for (const file of files) {
            if (!file.endsWith(".json")) continue;
            if (seenSet.has(file)) continue;

            // New file detected
            try {
                const content = await fs.readFile(path.join(dir, file), "utf-8");
                const parsed = JSON.parse(content);
                handler(file, parsed);
            } catch {
                console.log(`  [!] Failed to read ${file}`);
            }

            seenSet.add(file);
        }

        seen.set(key, seenSet);
    } catch {
        // Directory might not exist yet
    }
}

// ============================================================================
// OUTPUT FORMATTING
// ============================================================================

function printApprovalRequest(file: string, content: unknown): void {
    const now = new Date().toLocaleTimeString();
    const req = content as {
        request_id?: string;
        summary?: string;
        risk_level?: string;
        actions_preview?: unknown[];
    };

    console.log(`\n[${now}] NEW APPROVAL REQUEST`);
    console.log(`  ID:      ${req.request_id?.slice(0, 8)}...`);
    console.log(`  Risk:    ${formatRisk(req.risk_level)}`);
    console.log(`  Summary: ${req.summary?.slice(0, 60)}${(req.summary?.length || 0) > 60 ? "..." : ""}`);
    console.log(`  Actions: ${req.actions_preview?.length || 0}`);
    console.log(`  >> Use: byon approve ${req.request_id?.slice(0, 8)}`);
}

function printReceipt(file: string, content: unknown): void {
    const now = new Date().toLocaleTimeString();
    const receipt = content as {
        receipt_id?: string;
        execution_summary?: {
            status?: string;
            actions_completed?: number;
            actions_failed?: number;
            duration_ms?: number;
        };
    };

    const summary = receipt.execution_summary;
    const status = summary?.status || "unknown";
    const statusIcon = status === "success" ? "\u2713" : status === "failed" ? "\u2717" : "\u26A0";

    console.log(`\n[${now}] EXECUTION RECEIPT`);
    console.log(`  ID:        ${receipt.receipt_id?.slice(0, 8)}...`);
    console.log(`  Status:    ${statusIcon} ${status.toUpperCase()}`);
    console.log(`  Completed: ${summary?.actions_completed || 0} actions`);
    if (summary?.actions_failed) {
        console.log(`  Failed:    ${summary.actions_failed} actions`);
    }
    console.log(`  Duration:  ${summary?.duration_ms || 0}ms`);
}

function printInboxMessage(file: string, content: unknown): void {
    const now = new Date().toLocaleTimeString();
    const msg = content as {
        message_id?: string;
        channel?: string;
        content?: string;
    };

    console.log(`\n[${now}] INBOX MESSAGE`);
    console.log(`  Channel: ${msg.channel || "unknown"}`);
    console.log(`  Content: ${msg.content?.slice(0, 60)}${(msg.content?.length || 0) > 60 ? "..." : ""}`);
}

function formatRisk(level?: string): string {
    switch (level) {
        case "low": return "\x1b[32mLOW\x1b[0m";
        case "medium": return "\x1b[33mMEDIUM\x1b[0m";
        case "high": return "\x1b[31mHIGH\x1b[0m";
        default: return level || "unknown";
    }
}
