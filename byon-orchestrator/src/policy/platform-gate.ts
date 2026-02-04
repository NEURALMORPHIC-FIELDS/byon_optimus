/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Platform Gate - Communication Platform Policy
 * ==============================================
 *
 * POLICY: OpenClaw is the ONLY communication platform
 *
 * This gate ensures that:
 * - All inbound messages come through OpenClaw channels
 * - All outbound messages go through OpenClaw channels
 * - BYON orchestrator NEVER implements direct channel IO
 *
 * Violations result in immediate rejection with POLICY_VIOLATION error.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * The single allowed communication platform identifier
 */
export const COMM_PLATFORM = "openclaw" as const;

/**
 * Valid OpenClaw channel types
 */
export const VALID_CHANNELS = new Set([
    "whatsapp",
    "telegram",
    "discord",
    "slack",
    "signal",
    "matrix",
    "msteams",
    "googlechat",
    "line",
    "imessage",
    "web",
    "cli"
] as const);

export type ValidChannel = typeof VALID_CHANNELS extends Set<infer T> ? T : never;

// ============================================================================
// POLICY ENFORCEMENT
// ============================================================================

export interface CommunicationSource {
    platform: string;
    channel?: string;
    raw_source?: string;
}

export interface PlatformGateResult {
    allowed: boolean;
    platform: string;
    channel?: string;
    violation?: string;
}

/**
 * Enforce that communication comes through OpenClaw only
 *
 * @throws Error if platform is not OpenClaw
 */
export function enforceCommunicationPlatform(source: string | CommunicationSource): void {
    const platform = typeof source === "string" ? source : source.platform;

    if (platform.toLowerCase() !== COMM_PLATFORM) {
        throw new Error(
            `POLICY_VIOLATION: Communication must go through OpenClaw only. ` +
            `Received platform="${platform}". ` +
            `All messages must be routed via OpenClaw gateway.`
        );
    }
}

/**
 * Validate communication source without throwing
 */
export function validateCommunicationSource(source: CommunicationSource): PlatformGateResult {
    const platform = source.platform.toLowerCase();

    if (platform !== COMM_PLATFORM) {
        return {
            allowed: false,
            platform: source.platform,
            channel: source.channel,
            violation: `Platform "${source.platform}" is not allowed. Only "${COMM_PLATFORM}" is permitted.`
        };
    }

    // Optionally validate channel
    if (source.channel && !VALID_CHANNELS.has(source.channel.toLowerCase() as ValidChannel)) {
        return {
            allowed: false,
            platform: source.platform,
            channel: source.channel,
            violation: `Channel "${source.channel}" is not a recognized OpenClaw channel.`
        };
    }

    return {
        allowed: true,
        platform: source.platform,
        channel: source.channel
    };
}

/**
 * Check if a raw source string indicates OpenClaw origin
 */
export function isOpenClawSource(rawSource: string): boolean {
    const normalized = rawSource.toLowerCase();
    return normalized === COMM_PLATFORM ||
           normalized.startsWith("openclaw:") ||
           normalized.startsWith("openclaw/") ||
           VALID_CHANNELS.has(normalized as ValidChannel);
}

/**
 * Extract platform and channel from a combined source string
 * Format: "platform:channel" or just "channel"
 */
export function parseSourceString(source: string): CommunicationSource {
    if (source.includes(":")) {
        const [platform, channel] = source.split(":", 2);
        return { platform, channel, raw_source: source };
    }

    // If it's a valid channel, assume OpenClaw platform
    if (VALID_CHANNELS.has(source.toLowerCase() as ValidChannel)) {
        return { platform: COMM_PLATFORM, channel: source.toLowerCase(), raw_source: source };
    }

    // Unknown format - return as platform
    return { platform: source, raw_source: source };
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Create a middleware function that enforces platform gate
 * For use in message processing pipelines
 */
export function createPlatformGateMiddleware() {
    return function platformGate<T extends { source?: string | CommunicationSource }>(
        message: T
    ): T {
        if (!message.source) {
            throw new Error(
                "POLICY_VIOLATION: Message has no source information. " +
                "Cannot verify communication platform."
            );
        }

        const source = typeof message.source === "string"
            ? parseSourceString(message.source)
            : message.source;

        enforceCommunicationPlatform(source);

        return message;
    };
}

// ============================================================================
// AUDIT HELPERS
// ============================================================================

/**
 * Log platform gate check for audit trail
 */
export function auditPlatformCheck(source: CommunicationSource): {
    timestamp: string;
    check: "PLATFORM_GATE";
    source: CommunicationSource;
    result: "PASS" | "FAIL";
    details: string;
} {
    const result = validateCommunicationSource(source);

    return {
        timestamp: new Date().toISOString(),
        check: "PLATFORM_GATE",
        source,
        result: result.allowed ? "PASS" : "FAIL",
        details: result.allowed
            ? `Allowed: ${source.platform}/${source.channel || "unknown"}`
            : result.violation || "Unknown violation"
    };
}
