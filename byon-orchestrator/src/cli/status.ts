/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON CLI - Status Command
 * =========================
 *
 * Display BYON system status including memory, agents, and handoff queues.
 *
 * Usage:
 *   byon status                   Show overall status
 *   byon status --memory          Show memory service status
 *   byon status --agents          Show agent status
 *   byon status --handoff         Show handoff queue status
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { StatusOptions, CliResult } from "./types.js";
import { getDefaultConfig } from "../../byon-config.js";

// ============================================================================
// TYPES
// ============================================================================

interface SystemStatus {
    timestamp: string;
    memory: MemoryStatus;
    agents: AgentStatus;
    handoff: HandoffStatus;
}

interface MemoryStatus {
    available: boolean;
    provider: string;
    latency_ms?: number;
    last_check?: string;
    stats?: {
        total_entries?: number;
        total_size_bytes?: number;
        compression_ratio?: number;
    };
}

interface AgentStatus {
    worker: { running: boolean; last_activity?: string };
    auditor: { running: boolean; last_activity?: string };
    executor: { running: boolean; last_activity?: string };
}

interface HandoffStatus {
    pending_approvals: number;
    pending_executions: number;
    pending_receipts: number;
    inbox_messages: number;
}

// ============================================================================
// MAIN COMMAND
// ============================================================================

/**
 * Status command handler
 */
export async function statusCommand(options: StatusOptions): Promise<CliResult> {
    const config = getDefaultConfig();
    const status: SystemStatus = {
        timestamp: new Date().toISOString(),
        memory: await getMemoryStatus(config),
        agents: await getAgentStatus(config),
        handoff: await getHandoffStatus(config)
    };

    if (options.json) {
        return { success: true, data: status };
    }

    // Format output
    const lines: string[] = [];

    lines.push("BYON System Status");
    lines.push("==================");
    lines.push(`Timestamp: ${new Date(status.timestamp).toLocaleString()}`);
    lines.push("");

    // Memory status
    if (!options.agents && !options.handoff || options.memory) {
        lines.push("Memory Service:");
        const mem = status.memory;
        lines.push(`  Status:     ${mem.available ? "\x1b[32mONLINE\x1b[0m" : "\x1b[31mOFFLINE\x1b[0m"}`);
        lines.push(`  Provider:   ${mem.provider}`);
        if (mem.latency_ms !== undefined) {
            lines.push(`  Latency:    ${mem.latency_ms}ms`);
        }
        if (mem.stats) {
            lines.push(`  Entries:    ${mem.stats.total_entries || 0}`);
            if (mem.stats.compression_ratio) {
                lines.push(`  Compression: ${mem.stats.compression_ratio}x`);
            }
        }
        lines.push("");
    }

    // Agent status
    if (!options.memory && !options.handoff || options.agents) {
        lines.push("Agents:");
        const agents = status.agents;
        lines.push(`  Worker:   ${formatAgentStatus(agents.worker)}`);
        lines.push(`  Auditor:  ${formatAgentStatus(agents.auditor)}`);
        lines.push(`  Executor: ${formatAgentStatus(agents.executor)}`);
        lines.push("");
    }

    // Handoff status
    if (!options.memory && !options.agents || options.handoff) {
        lines.push("Handoff Queues:");
        const h = status.handoff;
        lines.push(`  Pending Approvals:  ${h.pending_approvals}`);
        lines.push(`  Pending Executions: ${h.pending_executions}`);
        lines.push(`  Pending Receipts:   ${h.pending_receipts}`);
        lines.push(`  Inbox Messages:     ${h.inbox_messages}`);
        lines.push("");
    }

    return { success: true, message: lines.join("\n") };
}

// ============================================================================
// STATUS COLLECTORS
// ============================================================================

async function getMemoryStatus(config: ReturnType<typeof getDefaultConfig>): Promise<MemoryStatus> {
    const start = Date.now();

    try {
        const response = await fetch(config.byon.memory_service_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "stats" }),
            signal: AbortSignal.timeout(5000)
        });

        const latency = Date.now() - start;

        if (!response.ok) {
            return {
                available: false,
                provider: config.byon.memory_provider,
                latency_ms: latency
            };
        }

        const data = await response.json() as {
            success?: boolean;
            stats?: MemoryStatus["stats"];
        };

        return {
            available: data.success === true,
            provider: config.byon.memory_provider,
            latency_ms: latency,
            last_check: new Date().toISOString(),
            stats: data.stats
        };
    } catch {
        return {
            available: false,
            provider: config.byon.memory_provider,
            latency_ms: Date.now() - start
        };
    }
}

async function getAgentStatus(config: ReturnType<typeof getDefaultConfig>): Promise<AgentStatus> {
    const basePath = config.byon.handoff_base_path;

    // Check for recent activity in handoff directories
    const checkActivity = async (dir: string): Promise<string | undefined> => {
        try {
            const fullPath = path.resolve(basePath, dir);
            const files = await fs.readdir(fullPath);
            if (files.length === 0) {return undefined;}

            // Get most recent file
            let latest = 0;
            for (const file of files) {
                try {
                    const stat = await fs.stat(path.join(fullPath, file));
                    if (stat.mtimeMs > latest) {
                        latest = stat.mtimeMs;
                    }
                } catch {
                    // Skip
                }
            }

            return latest > 0 ? new Date(latest).toISOString() : undefined;
        } catch {
            return undefined;
        }
    };

    return {
        worker: {
            running: true, // Assume running if we got this far
            last_activity: await checkActivity("worker_to_auditor")
        },
        auditor: {
            running: true,
            last_activity: await checkActivity("auditor_to_user") ||
                           await checkActivity("auditor_to_executor")
        },
        executor: {
            running: true,
            last_activity: await checkActivity("executor_to_worker")
        }
    };
}

async function getHandoffStatus(config: ReturnType<typeof getDefaultConfig>): Promise<HandoffStatus> {
    const basePath = config.byon.handoff_base_path;

    const countFiles = async (dir: string): Promise<number> => {
        try {
            const fullPath = path.resolve(basePath, dir);
            const files = await fs.readdir(fullPath);
            return files.filter(f => f.endsWith(".json")).length;
        } catch {
            return 0;
        }
    };

    return {
        pending_approvals: await countFiles("auditor_to_user"),
        pending_executions: await countFiles("auditor_to_executor"),
        pending_receipts: await countFiles("executor_to_worker"),
        inbox_messages: await countFiles("inbox")
    };
}

// ============================================================================
// HELPERS
// ============================================================================

function formatAgentStatus(status: { running: boolean; last_activity?: string }): string {
    const runningStr = status.running ? "\x1b[32mRUNNING\x1b[0m" : "\x1b[31mSTOPPED\x1b[0m";
    if (status.last_activity) {
        const ago = formatTimeAgo(status.last_activity);
        return `${runningStr} (last: ${ago})`;
    }
    return runningStr;
}

function formatTimeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {return `${hours}h ago`;}
    if (minutes > 0) {return `${minutes}m ago`;}
    return `${seconds}s ago`;
}
