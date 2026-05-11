/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * BYON Handoff Module
 * ===================
 *
 * Coordinates document handoffs between MACP agents.
 *
 * FLOW:
 * 1. Worker creates EvidencePack + PlanDraft -> Auditor
 * 2. Auditor validates -> ApprovalRequest (to user) or ExecutionOrder (to Executor)
 * 3. Executor executes -> JohnsonReceipt -> Worker
 * 4. Worker processes receipt and continues
 *
 * Patent: FHRSS/OmniVault - Vasile Lucian Borbeleac - EP25216372.0
 */

// ============================================================================
// SERIALIZER
// ============================================================================

export {
    // Types
    MACPDocument,
    DocumentType,
    SerializedDocument,
    DeserializationResult,

    // Functions
    serialize,
    deserialize,
    deserializeTyped,
    parseDocument,
    getDocumentType,
    validateDocument,
    createEnvelope
} from "./serializer.js";

// ============================================================================
// FILE WATCHER
// ============================================================================

export {
    // Types
    FileWatcherConfig,
    WatchedFile,
    FileWatcherEvents,

    // Class
    HandoffFileWatcher,

    // Factory
    createFileWatcher,
    createTypedFileWatcher
} from "./file-watcher.js";

// ============================================================================
// MANAGER
// ============================================================================

export {
    // Types
    HandoffManagerConfig,
    HandoffChannel,
    AgentRole,
    HandoffResult,
    PendingHandoff,

    // Class
    HandoffManager,

    // Factory
    createHandoffManager
} from "./manager.js";

// ============================================================================
// ORCHESTRATOR INTEGRATION
// ============================================================================

import {
    EvidencePack,
    PlanDraft,
    ApprovalRequest,
    ExecutionOrder,
    JohnsonReceipt
} from "../types/protocol.js";
import { HandoffManager, createHandoffManager } from "./manager.js";
import { HandoffFileWatcher, createFileWatcher } from "./file-watcher.js";

/**
 * Orchestrator Handoff Controller
 *
 * High-level controller for agent handoffs.
 */
export class OrchestratorHandoffController {
    private manager: HandoffManager;
    private watchers: Map<string, HandoffFileWatcher> = new Map();

    constructor(basePath: string = "./handoff") {
        this.manager = createHandoffManager({ base_path: basePath });
    }

    /**
     * Start watching for a specific agent
     */
    startWatching(
        agent: "worker" | "auditor" | "executor",
        onDocument: (doc: any, path: string) => void | Promise<void>,
        onError: (err: Error) => void
    ): void {
        const channels = this.manager.listChannels()
            .filter(c => c.to === agent);

        for (const channel of channels) {
            const watcher = createFileWatcher(
                {
                    watch_path: channel.path,
                    filter_types: channel.document_types
                },
                {
                    onDocument,
                    onError,
                    onProcessed: () => {}
                }
            );

            watcher.start();
            this.watchers.set(`${agent}-${channel.name}`, watcher);
        }
    }

    /**
     * Stop all watchers
     */
    stopAll(): void {
        for (const watcher of this.watchers.values()) {
            watcher.stop();
        }
        this.watchers.clear();
    }

    /**
     * Worker sends to Auditor
     */
    workerToAuditor(evidence: EvidencePack, plan: PlanDraft): {
        evidence_handoff: ReturnType<HandoffManager["handoff"]>;
        plan_handoff: ReturnType<HandoffManager["handoff"]>;
    } {
        return {
            evidence_handoff: this.manager.handoff(evidence, "worker"),
            plan_handoff: this.manager.handoff(plan, "worker")
        };
    }

    /**
     * Auditor sends ApprovalRequest (for user review via Worker)
     */
    auditorToUser(request: ApprovalRequest): ReturnType<HandoffManager["handoff"]> {
        return this.manager.handoff(request, "auditor");
    }

    /**
     * Auditor sends ExecutionOrder to Executor
     */
    auditorToExecutor(order: ExecutionOrder): ReturnType<HandoffManager["handoff"]> {
        return this.manager.handoff(order, "auditor");
    }

    /**
     * Executor sends JohnsonReceipt to Worker
     */
    executorToWorker(receipt: JohnsonReceipt): ReturnType<HandoffManager["handoff"]> {
        return this.manager.handoff(receipt, "executor");
    }

    /**
     * Get pending for agent
     */
    getPending(agent: "worker" | "auditor" | "executor"): ReturnType<HandoffManager["pickup"]> {
        return this.manager.pickup(agent);
    }

    /**
     * Consume pending
     */
    consume(pending: ReturnType<HandoffManager["pickup"]>[0]): ReturnType<HandoffManager["consume"]> {
        return this.manager.consume(pending);
    }

    /**
     * Get channel stats
     */
    getStats(): ReturnType<HandoffManager["getChannelStats"]> {
        return this.manager.getChannelStats();
    }

    /**
     * Get underlying manager
     */
    getManager(): HandoffManager {
        return this.manager;
    }
}

/**
 * Create orchestrator handoff controller
 */
export function createOrchestratorHandoff(basePath?: string): OrchestratorHandoffController {
    return new OrchestratorHandoffController(basePath);
}
