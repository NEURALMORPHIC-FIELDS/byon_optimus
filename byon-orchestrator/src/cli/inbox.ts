/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON CLI - Inbox Command
 * ========================
 *
 * View and manage inbox messages from OpenClaw channels.
 *
 * Usage:
 *   byon inbox                    List inbox messages
 *   byon inbox --limit 20         Limit results
 *   byon inbox --unread           Show only unread
 *   byon inbox <message_id>       Show message details
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { InboxOptions, CliResult } from "./types.js";
import { getDefaultConfig } from "../../byon-config.js";

// ============================================================================
// TYPES
// ============================================================================

interface InboxMessage {
    message_id: string;
    channel: string;
    channel_type: string;
    timestamp: string;
    content: string;
    author?: {
        id: string;
        name: string;
    };
    thread_id?: string;
    reply_to?: string;
    attachments?: Array<{
        type: string;
        url?: string;
        filename?: string;
    }>;
    metadata?: Record<string, unknown>;
    processed?: boolean;
    file_path: string;
}

// ============================================================================
// MAIN COMMAND
// ============================================================================

/**
 * Inbox command handler
 */
export async function inboxCommand(
    messageId: string | undefined,
    options: InboxOptions
): Promise<CliResult> {
    const config = getDefaultConfig();
    const inboxPath = path.resolve(config.byon.handoff_base_path, "inbox");
    const limit = options.limit || 20;

    // Show specific message
    if (messageId) {
        return await showMessage(inboxPath, messageId, options);
    }

    // List messages
    return await listMessages(inboxPath, limit, options);
}

// ============================================================================
// LIST MESSAGES
// ============================================================================

async function listMessages(
    inboxPath: string,
    limit: number,
    options: InboxOptions
): Promise<CliResult> {
    try {
        await fs.mkdir(inboxPath, { recursive: true });

        const files = await fs.readdir(inboxPath);
        const messages: InboxMessage[] = [];

        // Load messages
        for (const file of files) {
            if (!file.endsWith(".json")) continue;
            if (messages.length >= limit) break;

            try {
                const filePath = path.join(inboxPath, file);
                const content = await fs.readFile(filePath, "utf-8");
                const msg = JSON.parse(content) as Partial<InboxMessage>;

                // Filter unread if requested
                if (options.unread && msg.processed) continue;

                messages.push({
                    message_id: msg.message_id || file.replace(".json", ""),
                    channel: msg.channel || "unknown",
                    channel_type: msg.channel_type || "unknown",
                    timestamp: msg.timestamp || "",
                    content: msg.content || "",
                    author: msg.author,
                    thread_id: msg.thread_id,
                    reply_to: msg.reply_to,
                    attachments: msg.attachments,
                    metadata: msg.metadata,
                    processed: msg.processed,
                    file_path: filePath
                });
            } catch {
                // Skip invalid files
            }
        }

        // Sort by timestamp (newest first)
        messages.sort((a, b) => {
            const timeA = new Date(a.timestamp).getTime() || 0;
            const timeB = new Date(b.timestamp).getTime() || 0;
            return timeB - timeA;
        });

        if (options.json) {
            return { success: true, data: messages };
        }

        if (messages.length === 0) {
            return { success: true, message: "Inbox is empty" };
        }

        // Format output
        const lines: string[] = [];
        lines.push("BYON Inbox");
        lines.push("==========\n");

        for (const msg of messages) {
            const time = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : "unknown";
            const channelBadge = formatChannelBadge(msg.channel_type);
            const unreadBadge = msg.processed ? "" : " [NEW]";

            lines.push(`${time}  ${channelBadge}${unreadBadge}`);
            lines.push(`  ID:      ${msg.message_id.slice(0, 12)}...`);
            lines.push(`  Channel: ${msg.channel}`);
            if (msg.author?.name) {
                lines.push(`  From:    ${msg.author.name}`);
            }
            lines.push(`  Content: ${msg.content.slice(0, 60)}${msg.content.length > 60 ? "..." : ""}`);
            if (msg.attachments && msg.attachments.length > 0) {
                lines.push(`  Attachments: ${msg.attachments.length}`);
            }
            lines.push("");
        }

        lines.push(`Showing ${messages.length} message(s)`);
        lines.push("\nUse: byon inbox <message_id> to view details");

        return { success: true, message: lines.join("\n") };
    } catch (error) {
        return {
            success: false,
            message: `Failed to list inbox: ${error}`
        };
    }
}

// ============================================================================
// SHOW MESSAGE
// ============================================================================

async function showMessage(
    inboxPath: string,
    messageId: string,
    options: InboxOptions
): Promise<CliResult> {
    try {
        const files = await fs.readdir(inboxPath);
        let found: InboxMessage | null = null;

        for (const file of files) {
            if (!file.endsWith(".json")) continue;

            try {
                const filePath = path.join(inboxPath, file);
                const content = await fs.readFile(filePath, "utf-8");
                const msg = JSON.parse(content) as Partial<InboxMessage>;

                const msgId = msg.message_id || file.replace(".json", "");
                if (msgId === messageId || msgId.startsWith(messageId)) {
                    found = {
                        message_id: msgId,
                        channel: msg.channel || "unknown",
                        channel_type: msg.channel_type || "unknown",
                        timestamp: msg.timestamp || "",
                        content: msg.content || "",
                        author: msg.author,
                        thread_id: msg.thread_id,
                        reply_to: msg.reply_to,
                        attachments: msg.attachments,
                        metadata: msg.metadata,
                        processed: msg.processed,
                        file_path: filePath
                    };
                    break;
                }
            } catch {
                // Skip
            }
        }

        if (!found) {
            return {
                success: false,
                message: `Message ${messageId} not found`
            };
        }

        if (options.json) {
            return { success: true, data: found };
        }

        // Format output
        const lines: string[] = [];
        lines.push("Message Details");
        lines.push("===============\n");

        lines.push(`Message ID:   ${found.message_id}`);
        lines.push(`Channel:      ${found.channel}`);
        lines.push(`Channel Type: ${found.channel_type}`);
        lines.push(`Timestamp:    ${found.timestamp ? new Date(found.timestamp).toLocaleString() : "unknown"}`);
        lines.push(`Processed:    ${found.processed ? "Yes" : "No"}`);

        if (found.author) {
            lines.push(`\nAuthor:`);
            lines.push(`  ID:   ${found.author.id}`);
            lines.push(`  Name: ${found.author.name}`);
        }

        if (found.thread_id) {
            lines.push(`Thread ID: ${found.thread_id}`);
        }

        if (found.reply_to) {
            lines.push(`Reply To:  ${found.reply_to}`);
        }

        lines.push(`\nContent:`);
        lines.push("---");
        lines.push(found.content);
        lines.push("---");

        if (found.attachments && found.attachments.length > 0) {
            lines.push(`\nAttachments (${found.attachments.length}):`);
            for (const att of found.attachments) {
                lines.push(`  - ${att.type}: ${att.filename || att.url || "unnamed"}`);
            }
        }

        if (found.metadata && Object.keys(found.metadata).length > 0) {
            lines.push(`\nMetadata:`);
            for (const [key, value] of Object.entries(found.metadata)) {
                lines.push(`  ${key}: ${JSON.stringify(value)}`);
            }
        }

        return { success: true, message: lines.join("\n") };
    } catch (error) {
        return {
            success: false,
            message: `Failed to read message: ${error}`
        };
    }
}

// ============================================================================
// HELPERS
// ============================================================================

function formatChannelBadge(channelType: string): string {
    const badges: Record<string, string> = {
        telegram: "\x1b[36m[TG]\x1b[0m",
        discord: "\x1b[35m[DC]\x1b[0m",
        slack: "\x1b[33m[SL]\x1b[0m",
        web: "\x1b[32m[WEB]\x1b[0m",
        cli: "\x1b[37m[CLI]\x1b[0m"
    };
    return badges[channelType.toLowerCase()] || `[${channelType.toUpperCase().slice(0, 3)}]`;
}
