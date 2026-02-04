/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Handoff Manager
 * ===============
 *
 * Coordinates document handoffs between MACP agents.
 * Manages the flow: Worker -> Auditor -> Executor -> Worker
 *
 * ARCHITECTURE:
 * - Worker produces: EvidencePack, PlanDraft
 * - Auditor consumes: EvidencePack, PlanDraft
 * - Auditor produces: ApprovalRequest, ExecutionOrder
 * - Executor consumes: ExecutionOrder
 * - Executor produces: JohnsonReceipt
 * - Worker consumes: JohnsonReceipt
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
    EvidencePack,
    PlanDraft,
    ApprovalRequest,
    ExecutionOrder,
    JohnsonReceipt
} from "../types/protocol.js";
import {
    serialize,
    deserialize,
    SerializedDocument,
    MACPDocument,
    DocumentType
} from "./serializer.js";

// ============================================================================
// TYPES
// ============================================================================

export interface HandoffManagerConfig {
    /** Base directory for handoff channels */
    base_path: string;
    /** Create directories if missing */
    auto_create_dirs: boolean;
}

export interface HandoffChannel {
    /** Channel name */
    name: string;
    /** Source agent */
    from: AgentRole;
    /** Target agent */
    to: AgentRole;
    /** Document types allowed */
    document_types: DocumentType[];
    /** Directory path */
    path: string;
}

export type AgentRole = "worker" | "auditor" | "executor";

export interface HandoffResult {
    success: boolean;
    channel: string;
    file_path: string;
    document_id: string;
    handoff_id: string;
    timestamp: string;
    error?: string;
}

export interface PendingHandoff {
    handoff_id: string;
    channel: string;
    file_path: string;
    document_type: DocumentType;
    document_id: string;
    created_at: string;
}

// ============================================================================
// CHANNEL DEFINITIONS
// ============================================================================

const CHANNELS: Omit<HandoffChannel, "path">[] = [
    {
        name: "worker-to-auditor",
        from: "worker",
        to: "auditor",
        document_types: ["EVIDENCE_PACK", "PLAN_DRAFT"]
    },
    {
        name: "auditor-to-user",
        from: "auditor",
        to: "worker", // Worker handles user interaction
        document_types: ["APPROVAL_REQUEST"]
    },
    {
        name: "auditor-to-executor",
        from: "auditor",
        to: "executor",
        document_types: ["EXECUTION_ORDER"]
    },
    {
        name: "executor-to-worker",
        from: "executor",
        to: "worker",
        document_types: ["JOHNSON_RECEIPT"]
    }
];

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: HandoffManagerConfig = {
    base_path: "./handoff",
    auto_create_dirs: true
};

// ============================================================================
// HANDOFF MANAGER
// ============================================================================

/**
 * Handoff Manager
 *
 * Coordinates document handoffs between agents.
 */
export class HandoffManager {
    private config: HandoffManagerConfig;
    private channels: Map<string, HandoffChannel> = new Map();

    constructor(config: Partial<HandoffManagerConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.initializeChannels();
    }

    /**
     * Initialize channels
     */
    private initializeChannels(): void {
        for (const channelDef of CHANNELS) {
            const channel: HandoffChannel = {
                ...channelDef,
                path: path.join(this.config.base_path, channelDef.name)
            };
            this.channels.set(channel.name, channel);

            if (this.config.auto_create_dirs && !fs.existsSync(channel.path)) {
                fs.mkdirSync(channel.path, { recursive: true });
            }
        }
    }

    /**
     * Hand off document from one agent to another
     */
    handoff(
        document: MACPDocument,
        fromAgent: AgentRole
    ): HandoffResult {
        const documentType = document.document_type || "UNKNOWN";
        const documentId = this.getDocumentId(document);
        const handoffId = `ho_${crypto.randomUUID().replace(/-/g, "")}`;
        const timestamp = new Date().toISOString();

        // Find appropriate channel
        const channel = this.findChannel(fromAgent, documentType as DocumentType);

        if (!channel) {
            return {
                success: false,
                channel: "unknown",
                file_path: "",
                document_id: documentId,
                handoff_id: handoffId,
                timestamp,
                error: `No channel for ${documentType} from ${fromAgent}`
            };
        }

        try {
            // Serialize document
            const serialized = serialize(document);

            // Write to channel directory
            const fileName = `${handoffId}_${(documentType || "unknown").toLowerCase()}.json`;
            const filePath = path.join(channel.path, fileName);

            fs.writeFileSync(
                filePath,
                JSON.stringify(serialized, null, 2),
                "utf-8"
            );

            return {
                success: true,
                channel: channel.name,
                file_path: filePath,
                document_id: documentId,
                handoff_id: handoffId,
                timestamp
            };

        } catch (error) {
            return {
                success: false,
                channel: channel.name,
                file_path: "",
                document_id: documentId,
                handoff_id: handoffId,
                timestamp,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Hand off Worker output (EvidencePack + PlanDraft)
     */
    handoffFromWorker(evidence: EvidencePack, plan: PlanDraft): {
        evidence: HandoffResult;
        plan: HandoffResult;
    } {
        return {
            evidence: this.handoff(evidence, "worker"),
            plan: this.handoff(plan, "worker")
        };
    }

    /**
     * Hand off Auditor output (ApprovalRequest or ExecutionOrder)
     */
    handoffFromAuditor(document: ApprovalRequest | ExecutionOrder): HandoffResult {
        return this.handoff(document, "auditor");
    }

    /**
     * Hand off Executor output (JohnsonReceipt)
     */
    handoffFromExecutor(receipt: JohnsonReceipt): HandoffResult {
        return this.handoff(receipt, "executor");
    }

    /**
     * Pick up pending documents for an agent
     */
    pickup(forAgent: AgentRole): PendingHandoff[] {
        const pending: PendingHandoff[] = [];

        for (const channel of this.channels.values()) {
            if (channel.to !== forAgent) continue;

            if (!fs.existsSync(channel.path)) continue;

            const files = fs.readdirSync(channel.path)
                .filter(f => f.endsWith(".json"))
                .map(f => path.join(channel.path, f));

            for (const filePath of files) {
                try {
                    const content = fs.readFileSync(filePath, "utf-8");
                    const serialized = JSON.parse(content) as SerializedDocument;
                    const result = deserialize(serialized);

                    if (result.success && result.document) {
                        pending.push({
                            handoff_id: path.basename(filePath).split("_")[0],
                            channel: channel.name,
                            file_path: filePath,
                            document_type: serialized.type,
                            document_id: this.getDocumentId(result.document),
                            created_at: serialized.serialized_at
                        });
                    }
                } catch {
                    // Skip invalid files
                }
            }
        }

        // Sort by creation time
        return pending.sort((a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
    }

    /**
     * Read and consume a pending handoff
     */
    consume(handoff: PendingHandoff): MACPDocument | null {
        try {
            const content = fs.readFileSync(handoff.file_path, "utf-8");
            const serialized = JSON.parse(content) as SerializedDocument;
            const result = deserialize(serialized);

            if (result.success && result.document) {
                // Remove file after successful consumption
                fs.unlinkSync(handoff.file_path);
                return result.document;
            }

            return null;
        } catch {
            return null;
        }
    }

    /**
     * Peek at a pending handoff (don't consume)
     */
    peek(handoff: PendingHandoff): MACPDocument | null {
        try {
            const content = fs.readFileSync(handoff.file_path, "utf-8");
            const serialized = JSON.parse(content) as SerializedDocument;
            const result = deserialize(serialized);

            return result.success ? result.document ?? null : null;
        } catch {
            return null;
        }
    }

    /**
     * Find channel for document type from agent
     */
    private findChannel(
        fromAgent: AgentRole,
        documentType: DocumentType
    ): HandoffChannel | undefined {
        for (const channel of this.channels.values()) {
            if (
                channel.from === fromAgent &&
                channel.document_types.includes(documentType)
            ) {
                return channel;
            }
        }
        return undefined;
    }

    /**
     * Get document ID based on type
     */
    private getDocumentId(document: MACPDocument): string {
        switch (document.document_type) {
            case "EVIDENCE_PACK":
                return (document as EvidencePack).evidence_id;
            case "PLAN_DRAFT":
                return (document as PlanDraft).plan_id;
            case "APPROVAL_REQUEST":
                return (document as ApprovalRequest).request_id;
            case "EXECUTION_ORDER":
                return (document as ExecutionOrder).order_id;
            case "JOHNSON_RECEIPT":
                return (document as JohnsonReceipt).receipt_id;
            default:
                return "unknown";
        }
    }

    /**
     * Get channel info
     */
    getChannel(name: string): HandoffChannel | undefined {
        return this.channels.get(name);
    }

    /**
     * List all channels
     */
    listChannels(): HandoffChannel[] {
        return Array.from(this.channels.values());
    }

    /**
     * Get channel statistics
     */
    getChannelStats(): Record<string, {
        pending: number;
        path: string;
    }> {
        const stats: Record<string, { pending: number; path: string }> = {};

        for (const channel of this.channels.values()) {
            let pending = 0;

            if (fs.existsSync(channel.path)) {
                pending = fs.readdirSync(channel.path)
                    .filter(f => f.endsWith(".json"))
                    .length;
            }

            stats[channel.name] = {
                pending,
                path: channel.path
            };
        }

        return stats;
    }

    /**
     * Clear all pending handoffs (use with caution!)
     */
    clearAll(): void {
        for (const channel of this.channels.values()) {
            if (fs.existsSync(channel.path)) {
                const files = fs.readdirSync(channel.path)
                    .filter(f => f.endsWith(".json"));

                for (const file of files) {
                    fs.unlinkSync(path.join(channel.path, file));
                }
            }
        }
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create handoff manager
 */
export function createHandoffManager(
    config?: Partial<HandoffManagerConfig>
): HandoffManager {
    return new HandoffManager(config);
}
