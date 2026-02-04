/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON Types - Module Export
 * ==========================
 *
 * Central export for all BYON type definitions.
 */

// Protocol types (MACP v1.1)
export type {
    TaskType,
    RiskLevel,
    ExecutionStatus,
    DocumentState,
    Source,
    ExtractedFact,
    RawQuote,
    CodebaseContext,
    MemoryContext,
    GlobalMemoryHint,
    EvidencePack,
    ActionType,
    Action,
    PlanDraft,
    SecurityCheck,
    UserOption,
    ApprovalRequest,
    ExecutionOrder,
    ActionResult,
    ExecutionError,
    JohnsonReceipt
} from "./protocol.js";

export {
    isEvidencePack,
    isPlanDraft,
    isApprovalRequest,
    isExecutionOrder,
    isJohnsonReceipt
} from "./protocol.js";

// Memory types (FHRSS+FCPE)
export type {
    MemoryType,
    MemoryEntry,
    CodeMemory,
    ConversationRole,
    ConversationMemory,
    FactMemory,
    SearchResult,
    SearchOptions,
    FHRSSConfig,
    FCPEConfig,
    RecoveryTestResult,
    MemoryStats,
    MemoryServiceAPI
} from "./memory.js";

// Audit types
export type {
    AuditEventType,
    AuditEntry,
    HashChainState,
    CalendarLevel,
    CalendarIndexEntry,
    DailyDigest,
    AuditServiceAPI
} from "./audit.js";
