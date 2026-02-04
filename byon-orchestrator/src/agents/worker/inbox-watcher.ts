/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Worker Inbox Watcher
 * ====================
 *
 * Monitors inbox directory for incoming messages/events.
 * Parses events and triggers Worker processing pipeline.
 *
 * OpenClaw is the SINGLE communication platform - all I/O goes through it.
 * This module watches for files dropped by OpenClaw integration.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ============================================================================
// TYPES
// ============================================================================

export interface InboxMessage {
    /** Message ID */
    message_id: string;
    /** Timestamp when received */
    received_at: string;
    /** Source (OpenClaw channel) */
    source: string;
    /** Message type */
    type: "user_request" | "system_event" | "callback" | "receipt";
    /** Raw content */
    content: string;
    /** Parsed payload */
    payload: Record<string, unknown>;
    /** File path if from file */
    file_path?: string;
}

export interface InboxWatcherConfig {
    /** Inbox directory path */
    inbox_path: string;
    /** Poll interval in milliseconds */
    poll_interval_ms: number;
    /** File extensions to watch */
    watch_extensions: string[];
    /** Move processed files to archive */
    archive_processed: boolean;
    /** Archive directory */
    archive_path?: string;
    /** Delete processed files (if not archiving) */
    delete_processed: boolean;
}

export interface InboxWatcherEvents {
    onMessage: (message: InboxMessage) => void | Promise<void> | Promise<unknown>;
    onError: (error: Error, filePath?: string) => void;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: InboxWatcherConfig = {
    inbox_path: "./inbox",
    poll_interval_ms: 1000,
    watch_extensions: [".json", ".msg"],
    archive_processed: true,
    archive_path: "./inbox/archive",
    delete_processed: false
};

// ============================================================================
// INBOX WATCHER
// ============================================================================

/**
 * Inbox Watcher
 *
 * Polls inbox directory for new messages.
 * Parses and dispatches to handler.
 */
export class InboxWatcher {
    private config: InboxWatcherConfig;
    private events: InboxWatcherEvents;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private processing: Set<string> = new Set();
    private processedFiles: Set<string> = new Set();

    constructor(
        config: Partial<InboxWatcherConfig>,
        events: InboxWatcherEvents
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.events = events;
    }

    /**
     * Start watching inbox
     */
    start(): void {
        if (this.pollTimer) {
            return; // Already running
        }

        // Ensure directories exist
        this.ensureDirectories();

        // Start polling
        this.pollTimer = setInterval(
            () => this.poll(),
            this.config.poll_interval_ms
        );

        // Initial poll
        this.poll();
    }

    /**
     * Stop watching inbox
     */
    stop(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /**
     * Check if watching
     */
    isWatching(): boolean {
        return this.pollTimer !== null;
    }

    /**
     * Poll inbox for new files
     */
    private async poll(): Promise<void> {
        try {
            const files = this.listInboxFiles();

            for (const filePath of files) {
                // Skip if already processing or processed
                if (this.processing.has(filePath) || this.processedFiles.has(filePath)) {
                    continue;
                }

                // Mark as processing
                this.processing.add(filePath);

                try {
                    await this.processFile(filePath);
                    this.processedFiles.add(filePath);
                } catch (error) {
                    this.events.onError(
                        error instanceof Error ? error : new Error(String(error)),
                        filePath
                    );
                } finally {
                    this.processing.delete(filePath);
                }
            }
        } catch (error) {
            this.events.onError(
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    /**
     * List files in inbox matching extensions
     */
    private listInboxFiles(): string[] {
        if (!fs.existsSync(this.config.inbox_path)) {
            return [];
        }

        const files = fs.readdirSync(this.config.inbox_path);

        return files
            .filter(file => {
                const ext = path.extname(file).toLowerCase();
                return this.config.watch_extensions.includes(ext);
            })
            .map(file => path.join(this.config.inbox_path, file))
            .filter(filePath => {
                const stat = fs.statSync(filePath);
                return stat.isFile();
            })
            .sort((a, b) => {
                // Sort by modification time (oldest first)
                const statA = fs.statSync(a);
                const statB = fs.statSync(b);
                return statA.mtimeMs - statB.mtimeMs;
            });
    }

    /**
     * Process a single inbox file
     */
    private async processFile(filePath: string): Promise<void> {
        // Read file content
        const content = fs.readFileSync(filePath, "utf-8");

        // Parse message
        const message = this.parseMessage(filePath, content);

        // Dispatch to handler
        await this.events.onMessage(message);

        // Handle post-processing
        if (this.config.archive_processed && this.config.archive_path) {
            this.archiveFile(filePath);
        } else if (this.config.delete_processed) {
            fs.unlinkSync(filePath);
        }
    }

    /**
     * Parse file content into InboxMessage
     */
    private parseMessage(filePath: string, content: string): InboxMessage {
        const fileName = path.basename(filePath);
        const ext = path.extname(filePath).toLowerCase();

        let payload: Record<string, unknown> = {};
        let type: InboxMessage["type"] = "user_request";
        let source = "unknown";

        // Try to parse JSON
        if (ext === ".json") {
            try {
                payload = JSON.parse(content);

                // Extract type from payload
                if (payload.type && typeof payload.type === "string") {
                    const validTypes = ["user_request", "system_event", "callback", "receipt"];
                    if (validTypes.includes(payload.type)) {
                        type = payload.type as InboxMessage["type"];
                    }
                }

                // Extract source from payload
                if (payload.source && typeof payload.source === "string") {
                    source = payload.source;
                } else if (payload.channel && typeof payload.channel === "string") {
                    source = payload.channel;
                }
            } catch {
                // Not valid JSON, treat as raw text
                payload = { raw: content };
            }
        } else {
            // Non-JSON file
            payload = { raw: content };
        }

        // Generate message ID
        const messageId = this.generateMessageId(filePath, content);

        return {
            message_id: messageId,
            received_at: new Date().toISOString(),
            source,
            type,
            content,
            payload,
            file_path: filePath
        };
    }

    /**
     * Generate unique message ID
     */
    private generateMessageId(filePath: string, content: string): string {
        const hash = crypto
            .createHash("sha256")
            .update(filePath)
            .update(content)
            .update(Date.now().toString())
            .digest("hex")
            .substring(0, 16);

        return `msg_${hash}`;
    }

    /**
     * Archive processed file
     */
    private archiveFile(filePath: string): void {
        if (!this.config.archive_path) return;

        const fileName = path.basename(filePath);
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const archiveName = `${timestamp}_${fileName}`;
        const archivePath = path.join(this.config.archive_path, archiveName);

        fs.renameSync(filePath, archivePath);
    }

    /**
     * Ensure inbox and archive directories exist
     */
    private ensureDirectories(): void {
        if (!fs.existsSync(this.config.inbox_path)) {
            fs.mkdirSync(this.config.inbox_path, { recursive: true });
        }

        if (this.config.archive_processed && this.config.archive_path) {
            if (!fs.existsSync(this.config.archive_path)) {
                fs.mkdirSync(this.config.archive_path, { recursive: true });
            }
        }
    }

    /**
     * Manually inject a message (for testing or direct API calls)
     */
    async inject(message: Omit<InboxMessage, "message_id" | "received_at">): Promise<void> {
        const fullMessage: InboxMessage = {
            ...message,
            message_id: `msg_${crypto.randomUUID().replace(/-/g, "").substring(0, 16)}`,
            received_at: new Date().toISOString()
        };

        await this.events.onMessage(fullMessage);
    }

    /**
     * Get inbox statistics
     */
    getStats(): {
        pending_files: number;
        processed_count: number;
        currently_processing: number;
    } {
        const pendingFiles = this.listInboxFiles().filter(
            f => !this.processedFiles.has(f) && !this.processing.has(f)
        ).length;

        return {
            pending_files: pendingFiles,
            processed_count: this.processedFiles.size,
            currently_processing: this.processing.size
        };
    }

    /**
     * Clear processed files tracking (for memory management)
     */
    clearProcessedTracking(): void {
        this.processedFiles.clear();
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create inbox watcher
 */
export function createInboxWatcher(
    config: Partial<InboxWatcherConfig>,
    events: InboxWatcherEvents
): InboxWatcher {
    return new InboxWatcher(config, events);
}

/**
 * Create message from OpenClaw format
 */
export function createMessageFromOpenClaw(
    openClawMessage: {
        id?: string;
        channel: string;
        content: string;
        metadata?: Record<string, unknown>;
    }
): InboxMessage {
    const messageId = openClawMessage.id ||
        `msg_${crypto.randomUUID().replace(/-/g, "").substring(0, 16)}`;

    return {
        message_id: messageId,
        received_at: new Date().toISOString(),
        source: openClawMessage.channel,
        type: "user_request",
        content: openClawMessage.content,
        payload: {
            ...openClawMessage.metadata,
            channel: openClawMessage.channel,
            content: openClawMessage.content
        }
    };
}
