/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Integration Module Exports
 * ==========================
 *
 * Central export for all BYON-OpenClaw integration components.
 */

// OpenClaw Bridge
export {
    OpenClawBridge,
    createOpenClawBridge,
    toInboxMessage,
    type OpenClawMessage,
    type ByonResponse,
    type ResponseAction,
    type Attachment,
    type BridgeConfig,
    type BridgeStatus
} from "./openclaw-bridge.js";

// Channel Adapter
export {
    ChannelAdapter,
    createChannelAdapter,
    normalizeMessage,
    type ChannelType,
    type ChannelMetadata,
    type ChannelCapabilities,
    type RateLimits,
    type NormalizedMessage,
    type NormalizedAttachment,
    type ResponseFormat
} from "./channel-adapter.js";

// Memory Bridge
export {
    MemoryBridge,
    createMemoryBridge,
    initializeMemoryBridge,
    type MemoryProvider,
    type MemoryBridgeConfig,
    type MemoryHealth,
    type MemoryResult
} from "./memory-bridge.js";

// Message Adapter
export {
    MessageAdapter,
    createMessageAdapter,
    initializeMessageAdapter,
    type MessageAdapterConfig,
    type AdapterState,
    type MessageAdapterEvents
} from "./message-adapter.js";
