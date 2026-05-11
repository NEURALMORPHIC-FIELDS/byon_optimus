/**
 * Usage Test Campaign — Domain 9: Multi-Channel & Gateway
 * =========================================================
 * TC-091 through TC-095
 *
 * Validates OpenClaw bridge message transformation across
 * multiple channels (web, telegram, discord, cli) and
 * graceful handling of missing channel metadata.
 *
 * Patent: EP25216372.0 — Vasile Lucian Borbeleac
 */

import { describe, it, expect } from "vitest";
import * as crypto from "node:crypto";
import {
    toInboxMessage,
    type OpenClawMessage,
} from "../../src/integration/openclaw-bridge.js";

// ============================================================================
// HELPERS
// ============================================================================

function makeMessage(overrides: Partial<OpenClawMessage> = {}): OpenClawMessage {
    return {
        message_id: `msg_${crypto.randomUUID().slice(0, 8)}`,
        channel_id: "ch_001",
        channel_type: "web",
        timestamp: new Date().toISOString(),
        sender: {
            user_id: "user_001",
            username: "testuser",
            display_name: "Test User",
        },
        content: {
            text: "Hello, please help with my code",
        },
        ...overrides,
    };
}

// ============================================================================
// TESTS
// ============================================================================

describe("Campaign: Multi-Channel & Gateway", () => {
    it("TC-091: Message from 'web' channel processed correctly", () => {
        const msg = makeMessage({ channel_type: "web", channel_id: "web_001" });
        const inbox = toInboxMessage(msg);

        expect(inbox.source_channel).toContain("web");
        expect(inbox.source_channel).toContain("web_001");
        expect(inbox.content).toBe("Hello, please help with my code");
        expect(inbox.sender_id).toBe("user_001");
        expect(inbox.inbox_id).toBeDefined();
        expect(inbox.received_at).toBeDefined();
    });

    it("TC-092: Message from 'telegram' channel processed correctly", () => {
        const msg = makeMessage({ channel_type: "telegram", channel_id: "tg_group_123" });
        const inbox = toInboxMessage(msg);

        expect(inbox.source_channel).toContain("telegram");
        expect(inbox.source_channel).toContain("tg_group_123");
    });

    it("TC-093: Message from 'discord' channel processed correctly", () => {
        const msg = makeMessage({ channel_type: "discord", channel_id: "discord_guild_456" });
        const inbox = toInboxMessage(msg);

        expect(inbox.source_channel).toContain("discord");
        expect(inbox.source_channel).toContain("discord_guild_456");
    });

    it("TC-094: Message from 'cli' channel processed correctly", () => {
        const msg = makeMessage({ channel_type: "cli", channel_id: "cli_local" });
        const inbox = toInboxMessage(msg);

        expect(inbox.source_channel).toContain("cli");
        expect(inbox.source_channel).toContain("cli_local");
    });

    it("TC-095: Message with missing optional fields defaults gracefully", () => {
        const msg: OpenClawMessage = {
            message_id: `msg_${crypto.randomUUID().slice(0, 8)}`,
            channel_id: "ch_default",
            channel_type: "web",
            timestamp: new Date().toISOString(),
            sender: {
                user_id: "anonymous",
                // username and display_name omitted
            },
            content: {
                text: "Help me",
                // No attachments, no metadata
            },
            // No thread_id, no reply_to
        };

        const inbox = toInboxMessage(msg);

        expect(inbox.inbox_id).toBeDefined();
        expect(inbox.content).toBe("Help me");
        expect(inbox.sender_id).toBe("anonymous");
        expect(inbox.task_type_hint).toBeDefined();
        // Metadata should not crash even when optional fields are undefined
        expect(inbox.metadata).toBeDefined();
    });
});
