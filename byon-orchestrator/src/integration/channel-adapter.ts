/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Channel Adapter
 * ===============
 *
 * Adaptor pentru diferitele tipuri de canale OpenClaw.
 * Normalizează formatul mesajelor pentru procesare uniformă în BYON.
 *
 * CRITICAL CONSTRAINT:
 * - Acest adaptor NU comunică direct cu canalele
 * - Tot traficul trece prin OpenClaw Platform
 * - BYON nu implementează channel I/O
 *
 * Supported Channels:
 * - Telegram
 * - Discord
 * - Web UI
 * - CLI
 * - Custom (extensible)
 */

// ============================================================================
// TYPES
// ============================================================================

/** Supported channel types */
export type ChannelType = "telegram" | "discord" | "web" | "cli" | "custom";

/** Channel-specific metadata */
export interface ChannelMetadata {
    channel_type: ChannelType;
    channel_id: string;
    channel_name?: string;
    capabilities: ChannelCapabilities;
    rate_limits?: RateLimits;
}

/** What the channel can do */
export interface ChannelCapabilities {
    supports_attachments: boolean;
    supports_reactions: boolean;
    supports_threads: boolean;
    supports_edits: boolean;
    supports_deletions: boolean;
    max_message_length: number;
    supports_markdown: boolean;
    supports_buttons: boolean;
}

/** Rate limiting info */
export interface RateLimits {
    messages_per_minute: number;
    attachments_per_minute: number;
    current_usage?: {
        messages: number;
        attachments: number;
        reset_at: string;
    };
}

/** Normalized message format (internal to BYON) */
export interface NormalizedMessage {
    id: string;
    timestamp: string;
    channel: ChannelMetadata;
    sender: {
        id: string;
        display_name: string;
        is_bot: boolean;
    };
    content: {
        text: string;
        format: "plain" | "markdown" | "html";
        attachments: NormalizedAttachment[];
    };
    thread?: {
        id: string;
        parent_message_id?: string;
    };
    reply_context?: {
        message_id: string;
        excerpt?: string;
    };
}

/** Normalized attachment */
export interface NormalizedAttachment {
    id: string;
    type: "file" | "image" | "video" | "audio" | "code";
    name: string;
    size_bytes?: number;
    mime_type?: string;
    url?: string;
    inline_content?: string;
}

/** Response format hints for channel */
export interface ResponseFormat {
    prefer_markdown: boolean;
    max_length: number;
    split_long_messages: boolean;
    include_buttons: boolean;
}

// ============================================================================
// CHANNEL PROFILES
// ============================================================================

/** Default capabilities by channel type */
const CHANNEL_PROFILES: Record<ChannelType, ChannelCapabilities> = {
    telegram: {
        supports_attachments: true,
        supports_reactions: true,
        supports_threads: true,
        supports_edits: true,
        supports_deletions: true,
        max_message_length: 4096,
        supports_markdown: true,
        supports_buttons: true
    },
    discord: {
        supports_attachments: true,
        supports_reactions: true,
        supports_threads: true,
        supports_edits: true,
        supports_deletions: true,
        max_message_length: 2000,
        supports_markdown: true,
        supports_buttons: true
    },
    web: {
        supports_attachments: true,
        supports_reactions: true,
        supports_threads: false,
        supports_edits: false,
        supports_deletions: false,
        max_message_length: 50000,
        supports_markdown: true,
        supports_buttons: true
    },
    cli: {
        supports_attachments: false,
        supports_reactions: false,
        supports_threads: false,
        supports_edits: false,
        supports_deletions: false,
        max_message_length: 100000,
        supports_markdown: false,
        supports_buttons: false
    },
    custom: {
        supports_attachments: true,
        supports_reactions: false,
        supports_threads: false,
        supports_edits: false,
        supports_deletions: false,
        max_message_length: 10000,
        supports_markdown: true,
        supports_buttons: false
    }
};

// ============================================================================
// ADAPTER IMPLEMENTATION
// ============================================================================

/**
 * Channel Adapter
 *
 * Normalizes messages from different channels and formats responses appropriately.
 */
export class ChannelAdapter {
    private channelProfiles: Map<string, ChannelMetadata> = new Map();

    /**
     * Register a channel with its metadata
     */
    registerChannel(channelId: string, type: ChannelType, name?: string): void {
        this.channelProfiles.set(channelId, {
            channel_type: type,
            channel_id: channelId,
            channel_name: name,
            capabilities: CHANNEL_PROFILES[type]
        });
    }

    /**
     * Get channel metadata
     */
    getChannelMetadata(channelId: string): ChannelMetadata | null {
        return this.channelProfiles.get(channelId) || null;
    }

    /**
     * Get default capabilities for a channel type
     */
    getDefaultCapabilities(type: ChannelType): ChannelCapabilities {
        return { ...CHANNEL_PROFILES[type] };
    }

    /**
     * Get response format hints for a channel
     */
    getResponseFormat(channelId: string): ResponseFormat {
        const meta = this.channelProfiles.get(channelId);
        const caps = meta?.capabilities || CHANNEL_PROFILES.custom;

        return {
            prefer_markdown: caps.supports_markdown,
            max_length: caps.max_message_length,
            split_long_messages: caps.max_message_length < 10000,
            include_buttons: caps.supports_buttons
        };
    }

    /**
     * Format response text for specific channel
     */
    formatResponse(text: string, channelId: string): string[] {
        const format = this.getResponseFormat(channelId);

        // If text fits in one message, return as-is
        if (text.length <= format.max_length) {
            return [text];
        }

        // Split long messages
        if (format.split_long_messages) {
            return this.splitMessage(text, format.max_length);
        }

        // Truncate if can't split
        return [text.substring(0, format.max_length - 3) + "..."];
    }

    /**
     * Split long message into parts
     */
    private splitMessage(text: string, maxLength: number): string[] {
        const parts: string[] = [];
        let remaining = text;

        while (remaining.length > 0) {
            if (remaining.length <= maxLength) {
                parts.push(remaining);
                break;
            }

            // Find good split point (newline, space, or punctuation)
            let splitAt = maxLength;

            // Look for newline first
            const newlineIdx = remaining.lastIndexOf("\n", maxLength);
            if (newlineIdx > maxLength * 0.5) {
                splitAt = newlineIdx + 1;
            } else {
                // Look for space
                const spaceIdx = remaining.lastIndexOf(" ", maxLength);
                if (spaceIdx > maxLength * 0.5) {
                    splitAt = spaceIdx + 1;
                }
            }

            parts.push(remaining.substring(0, splitAt).trim());
            remaining = remaining.substring(splitAt).trim();
        }

        return parts;
    }

    /**
     * Convert markdown to plain text for channels that don't support it
     */
    stripMarkdown(text: string): string {
        return text
            // Remove code blocks
            .replace(/```[\s\S]*?```/g, (match) => {
                const code = match.replace(/```\w*\n?/g, "").replace(/```/g, "");
                return code.trim();
            })
            // Remove inline code
            .replace(/`([^`]+)`/g, "$1")
            // Remove bold
            .replace(/\*\*([^*]+)\*\*/g, "$1")
            // Remove italic
            .replace(/\*([^*]+)\*/g, "$1")
            .replace(/_([^_]+)_/g, "$1")
            // Remove links but keep text
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            // Remove headers
            .replace(/^#{1,6}\s+/gm, "");
    }

    /**
     * Check if channel supports a feature
     */
    channelSupports(channelId: string, feature: keyof ChannelCapabilities): boolean {
        const meta = this.channelProfiles.get(channelId);
        if (!meta) {return false;}

        const value = meta.capabilities[feature];
        return typeof value === "boolean" ? value : value > 0;
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create channel adapter instance
 */
export function createChannelAdapter(): ChannelAdapter {
    return new ChannelAdapter();
}

// ============================================================================
// NORMALIZATION HELPERS
// ============================================================================

/**
 * Normalize raw message from any channel type
 */
export function normalizeMessage(
    raw: {
        id: string;
        channel_type: ChannelType;
        channel_id: string;
        sender_id: string;
        sender_name?: string;
        text: string;
        timestamp?: string;
        attachments?: Array<{
            type: string;
            name: string;
            url?: string;
            content?: string;
        }>;
    }
): NormalizedMessage {
    return {
        id: raw.id,
        timestamp: raw.timestamp || new Date().toISOString(),
        channel: {
            channel_type: raw.channel_type,
            channel_id: raw.channel_id,
            capabilities: CHANNEL_PROFILES[raw.channel_type]
        },
        sender: {
            id: raw.sender_id,
            display_name: raw.sender_name || raw.sender_id,
            is_bot: false
        },
        content: {
            text: raw.text,
            format: detectFormat(raw.text),
            attachments: (raw.attachments || []).map((a, i) => ({
                id: `${raw.id}-att-${i}`,
                type: normalizeAttachmentType(a.type),
                name: a.name,
                url: a.url,
                inline_content: a.content
            }))
        }
    };
}

/**
 * Detect text format
 */
function detectFormat(text: string): "plain" | "markdown" | "html" {
    if (text.includes("<") && text.includes(">") && /<\w+>/.test(text)) {
        return "html";
    }
    if (/```|\*\*|__|\[.*\]\(.*\)|^#+\s/m.test(text)) {
        return "markdown";
    }
    return "plain";
}

/**
 * Normalize attachment type string
 */
function normalizeAttachmentType(type: string): NormalizedAttachment["type"] {
    const lower = type.toLowerCase();
    if (lower.includes("image") || lower.includes("photo")) {return "image";}
    if (lower.includes("video")) {return "video";}
    if (lower.includes("audio") || lower.includes("voice")) {return "audio";}
    if (lower.includes("code")) {return "code";}
    return "file";
}
