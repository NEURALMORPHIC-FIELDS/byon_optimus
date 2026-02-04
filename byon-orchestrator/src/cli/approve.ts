/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON CLI - Approve Command
 * ==========================
 *
 * Approve or reject pending plan approval requests.
 *
 * Usage:
 *   byon approve <request_id>           Approve a specific request
 *   byon approve --list                 List pending requests
 *   byon approve --reject <id>          Reject a request
 *   byon approve --auto                 Auto-approve low-risk requests
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ApproveOptions, CliResult } from "./types.js";
import type { ApprovalRequest } from "../types/protocol.js";
import { getDefaultConfig } from "../../byon-config.js";

// ============================================================================
// TYPES
// ============================================================================

interface PendingRequest {
    request_id: string;
    summary: string;
    risk_level: "low" | "medium" | "high";
    expires_at: string;
    actions_count: number;
    file_path: string;
}

// ============================================================================
// MAIN COMMAND
// ============================================================================

/**
 * Approve command handler
 */
export async function approveCommand(
    requestId: string | undefined,
    options: ApproveOptions
): Promise<CliResult> {
    const config = getDefaultConfig();
    const handoffPath = path.resolve(config.byon.handoff_base_path, "auditor_to_user");

    // List pending requests
    if (!requestId) {
        return await listPendingRequests(handoffPath, options);
    }

    // Find the request
    const pending = await findPendingRequest(handoffPath, requestId);
    if (!pending) {
        return {
            success: false,
            message: `Request ${requestId} not found or expired`
        };
    }

    // Check if rejecting
    if ((options as { reject?: boolean }).reject) {
        return await rejectRequest(pending, options.reason);
    }

    // Approve the request
    return await approveRequest(pending, options.reason);
}

// ============================================================================
// LIST PENDING
// ============================================================================

async function listPendingRequests(
    handoffPath: string,
    options: ApproveOptions
): Promise<CliResult> {
    try {
        const files = await fs.readdir(handoffPath);
        const pending: PendingRequest[] = [];
        const now = Date.now();

        for (const file of files) {
            if (!file.endsWith(".json")) continue;

            try {
                const content = await fs.readFile(path.join(handoffPath, file), "utf-8");
                const request = JSON.parse(content) as ApprovalRequest;

                // Skip expired
                const expiresAt = new Date(request.expires_at).getTime();
                if (expiresAt <= now) continue;

                pending.push({
                    request_id: request.request_id,
                    summary: request.summary,
                    risk_level: request.risk_level || "medium",
                    expires_at: request.expires_at,
                    actions_count: request.actions_preview?.length || 0,
                    file_path: path.join(handoffPath, file)
                });
            } catch {
                // Skip invalid files
            }
        }

        if (options.json) {
            return { success: true, data: pending };
        }

        if (pending.length === 0) {
            return { success: true, message: "No pending approval requests" };
        }

        // Format output
        const lines = ["Pending Approval Requests:", ""];
        for (const req of pending) {
            const timeLeft = formatTimeRemaining(req.expires_at);
            const riskBadge = formatRiskBadge(req.risk_level);
            lines.push(`  ${req.request_id.slice(0, 8)}...  ${riskBadge}  ${req.summary.slice(0, 50)}${req.summary.length > 50 ? "..." : ""}`);
            lines.push(`                      ${req.actions_count} actions | expires in ${timeLeft}`);
            lines.push("");
        }

        lines.push(`Total: ${pending.length} pending request(s)`);
        lines.push("");
        lines.push("Use: byon approve <request_id> to approve");
        lines.push("     byon approve --reject <request_id> to reject");

        return { success: true, message: lines.join("\n") };
    } catch (error) {
        return {
            success: false,
            message: `Failed to list pending requests: ${error}`
        };
    }
}

// ============================================================================
// APPROVE / REJECT
// ============================================================================

async function approveRequest(
    pending: PendingRequest,
    reason?: string
): Promise<CliResult> {
    try {
        // Read the full request
        const content = await fs.readFile(pending.file_path, "utf-8");
        const request = JSON.parse(content) as ApprovalRequest;

        // Create approval response
        const approval = {
            request_id: request.request_id,
            decision: "approve" as const,
            reason: reason || "Approved via CLI",
            decided_at: new Date().toISOString(),
            decided_by: "cli-user"
        };

        // Write to executor handoff
        const config = getDefaultConfig();
        const executorPath = path.resolve(config.byon.handoff_base_path, "auditor_to_executor");
        await fs.mkdir(executorPath, { recursive: true });

        const approvalFile = path.join(executorPath, `approval-${request.request_id}.json`);
        await fs.writeFile(approvalFile, JSON.stringify(approval, null, 2), "utf-8");

        // Remove from pending
        await fs.unlink(pending.file_path);

        return {
            success: true,
            message: `Approved request ${request.request_id.slice(0, 8)}...\nPlan will now be executed.`
        };
    } catch (error) {
        return {
            success: false,
            message: `Failed to approve request: ${error}`
        };
    }
}

async function rejectRequest(
    pending: PendingRequest,
    reason?: string
): Promise<CliResult> {
    try {
        // Read the full request
        const content = await fs.readFile(pending.file_path, "utf-8");
        const request = JSON.parse(content) as ApprovalRequest;

        // Create rejection response
        const rejection = {
            request_id: request.request_id,
            decision: "reject" as const,
            reason: reason || "Rejected via CLI",
            decided_at: new Date().toISOString(),
            decided_by: "cli-user"
        };

        // Write to worker handoff (rejection goes back to worker)
        const config = getDefaultConfig();
        const workerPath = path.resolve(config.byon.handoff_base_path, "executor_to_worker");
        await fs.mkdir(workerPath, { recursive: true });

        const rejectionFile = path.join(workerPath, `rejection-${request.request_id}.json`);
        await fs.writeFile(rejectionFile, JSON.stringify(rejection, null, 2), "utf-8");

        // Remove from pending
        await fs.unlink(pending.file_path);

        return {
            success: true,
            message: `Rejected request ${request.request_id.slice(0, 8)}...\nReason: ${rejection.reason}`
        };
    } catch (error) {
        return {
            success: false,
            message: `Failed to reject request: ${error}`
        };
    }
}

// ============================================================================
// HELPERS
// ============================================================================

async function findPendingRequest(
    handoffPath: string,
    requestId: string
): Promise<PendingRequest | null> {
    try {
        const files = await fs.readdir(handoffPath);

        for (const file of files) {
            if (!file.endsWith(".json")) continue;

            try {
                const filePath = path.join(handoffPath, file);
                const content = await fs.readFile(filePath, "utf-8");
                const request = JSON.parse(content) as ApprovalRequest;

                if (request.request_id === requestId || request.request_id.startsWith(requestId)) {
                    // Check not expired
                    const expiresAt = new Date(request.expires_at).getTime();
                    if (expiresAt <= Date.now()) {
                        return null;
                    }

                    return {
                        request_id: request.request_id,
                        summary: request.summary,
                        risk_level: request.risk_level || "medium",
                        expires_at: request.expires_at,
                        actions_count: request.actions_preview?.length || 0,
                        file_path: filePath
                    };
                }
            } catch {
                // Skip invalid files
            }
        }

        return null;
    } catch {
        return null;
    }
}

function formatTimeRemaining(expiresAt: string): string {
    const remaining = new Date(expiresAt).getTime() - Date.now();
    if (remaining <= 0) return "expired";

    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    if (minutes > 60) {
        const hours = Math.floor(minutes / 60);
        return `${hours}h ${minutes % 60}m`;
    }

    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatRiskBadge(level: "low" | "medium" | "high"): string {
    switch (level) {
        case "low": return "[LOW]   ";
        case "medium": return "[MEDIUM]";
        case "high": return "[HIGH]  ";
    }
}

// ============================================================================
// AUTO-APPROVE
// ============================================================================

/**
 * Auto-approve all low-risk pending requests
 */
export async function autoApproveCommand(options: ApproveOptions): Promise<CliResult> {
    const config = getDefaultConfig();
    const handoffPath = path.resolve(config.byon.handoff_base_path, "auditor_to_user");

    try {
        const files = await fs.readdir(handoffPath);
        let approved = 0;
        let skipped = 0;
        const now = Date.now();

        for (const file of files) {
            if (!file.endsWith(".json")) continue;

            try {
                const filePath = path.join(handoffPath, file);
                const content = await fs.readFile(filePath, "utf-8");
                const request = JSON.parse(content) as ApprovalRequest;

                // Skip expired
                const expiresAt = new Date(request.expires_at).getTime();
                if (expiresAt <= now) {
                    skipped++;
                    continue;
                }

                // Only auto-approve low risk
                if (request.risk_level !== "low") {
                    skipped++;
                    continue;
                }

                // Approve
                const pending: PendingRequest = {
                    request_id: request.request_id,
                    summary: request.summary,
                    risk_level: request.risk_level,
                    expires_at: request.expires_at,
                    actions_count: request.actions_preview?.length || 0,
                    file_path: filePath
                };

                const result = await approveRequest(pending, "Auto-approved (low risk)");
                if (result.success) {
                    approved++;
                }
            } catch {
                skipped++;
            }
        }

        return {
            success: true,
            message: `Auto-approved ${approved} low-risk request(s)\nSkipped ${skipped} request(s) (not low-risk or expired)`
        };
    } catch (error) {
        return {
            success: false,
            message: `Auto-approve failed: ${error}`
        };
    }
}
