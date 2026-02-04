/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Handoff File Watcher
 * ====================
 *
 * Watches directories for handoff files between agents.
 * Provides event-based notification when new documents arrive.
 */

import * as fs from "fs";
import * as path from "path";
import {
    SerializedDocument,
    DocumentType,
    deserialize,
    MACPDocument
} from "./serializer.js";

// ============================================================================
// TYPES
// ============================================================================

export interface FileWatcherConfig {
    /** Directory to watch */
    watch_path: string;
    /** Poll interval in milliseconds */
    poll_interval_ms: number;
    /** File extensions to watch */
    extensions: string[];
    /** Archive processed files */
    archive_processed: boolean;
    /** Archive directory */
    archive_path?: string;
    /** Delete after processing */
    delete_processed: boolean;
    /** Filter by document type */
    filter_types?: DocumentType[];
}

export interface WatchedFile {
    path: string;
    name: string;
    created_at: Date;
    size: number;
}

export interface FileWatcherEvents {
    onDocument: (document: MACPDocument, filePath: string) => void | Promise<void>;
    onError: (error: Error, filePath?: string) => void;
    onProcessed: (filePath: string) => void;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: FileWatcherConfig = {
    watch_path: "./handoff",
    poll_interval_ms: 500,
    extensions: [".json", ".handoff"],
    archive_processed: true,
    archive_path: "./handoff/archive",
    delete_processed: false
};

// ============================================================================
// FILE WATCHER
// ============================================================================

/**
 * Handoff File Watcher
 *
 * Monitors directory for new handoff documents.
 */
// Maximum number of processed files to track (prevents memory leak)
const MAX_PROCESSED_FILES = 10000;
// TTL for processed file entries in milliseconds (1 hour)
const PROCESSED_FILE_TTL_MS = 60 * 60 * 1000;

export class HandoffFileWatcher {
    private config: FileWatcherConfig;
    private events: FileWatcherEvents;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private processing: Set<string> = new Set();
    // PERFORMANCE: Use Map with timestamps instead of Set to enable TTL expiration
    private processedFiles: Map<string, number> = new Map();

    constructor(
        config: Partial<FileWatcherConfig>,
        events: FileWatcherEvents
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.events = events;
    }

    /**
     * Start watching
     */
    start(): void {
        if (this.pollTimer) {
            return;
        }

        this.ensureDirectories();

        this.pollTimer = setInterval(
            () => this.poll(),
            this.config.poll_interval_ms
        );

        // Initial poll
        this.poll();
    }

    /**
     * Stop watching
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
     * Poll for new files
     */
    private async poll(): Promise<void> {
        try {
            const files = this.listFiles();

            // PERFORMANCE: Clean up expired entries before processing
            this.cleanupExpiredEntries();

            for (const file of files) {
                if (this.processing.has(file.path) || this.processedFiles.has(file.path)) {
                    continue;
                }

                this.processing.add(file.path);

                try {
                    await this.processFile(file);
                    // PERFORMANCE: Store with timestamp for TTL expiration
                    this.processedFiles.set(file.path, Date.now());
                    // Enforce max size limit
                    if (this.processedFiles.size > MAX_PROCESSED_FILES) {
                        const oldestKey = this.processedFiles.keys().next().value;
                        if (oldestKey) {
                            this.processedFiles.delete(oldestKey);
                        }
                    }
                    this.events.onProcessed(file.path);
                } catch (error) {
                    this.events.onError(
                        error instanceof Error ? error : new Error(String(error)),
                        file.path
                    );
                } finally {
                    this.processing.delete(file.path);
                }
            }
        } catch (error) {
            this.events.onError(
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    /**
     * List files in watch directory
     */
    private listFiles(): WatchedFile[] {
        if (!fs.existsSync(this.config.watch_path)) {
            return [];
        }

        const files = fs.readdirSync(this.config.watch_path);

        return files
            .filter(file => {
                const ext = path.extname(file).toLowerCase();
                return this.config.extensions.includes(ext);
            })
            .map(file => {
                const filePath = path.join(this.config.watch_path, file);
                const stat = fs.statSync(filePath);
                return {
                    path: filePath,
                    name: file,
                    created_at: stat.birthtime,
                    size: stat.size
                };
            })
            .filter(file => fs.statSync(file.path).isFile())
            .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
    }

    /**
     * Process a single file
     */
    private async processFile(file: WatchedFile): Promise<void> {
        // Read file content
        const content = fs.readFileSync(file.path, "utf-8");

        // Try to parse as SerializedDocument
        let document: MACPDocument;

        try {
            const parsed = JSON.parse(content);

            // Check if it's a SerializedDocument envelope
            if (parsed.type && parsed.content && parsed.hash) {
                const result = deserialize(parsed as SerializedDocument);
                if (!result.success || !result.document) {
                    throw new Error(result.error || "Deserialization failed");
                }

                // Filter by type if configured
                if (this.config.filter_types && this.config.filter_types.length > 0) {
                    if (!this.config.filter_types.includes(result.type!)) {
                        return; // Skip this file
                    }
                }

                document = result.document;
            } else if (parsed.document_type) {
                // Raw MACP document
                if (this.config.filter_types && this.config.filter_types.length > 0) {
                    if (!this.config.filter_types.includes(parsed.document_type)) {
                        return; // Skip this file
                    }
                }

                document = parsed as MACPDocument;
            } else {
                throw new Error("Unknown document format");
            }

        } catch (error) {
            throw new Error(`Failed to parse ${file.name}: ${error}`);
        }

        // Dispatch document
        await this.events.onDocument(document, file.path);

        // Handle post-processing
        if (this.config.archive_processed && this.config.archive_path) {
            this.archiveFile(file.path);
        } else if (this.config.delete_processed) {
            fs.unlinkSync(file.path);
        }
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
     * Ensure directories exist
     */
    private ensureDirectories(): void {
        if (!fs.existsSync(this.config.watch_path)) {
            fs.mkdirSync(this.config.watch_path, { recursive: true });
        }

        if (this.config.archive_processed && this.config.archive_path) {
            if (!fs.existsSync(this.config.archive_path)) {
                fs.mkdirSync(this.config.archive_path, { recursive: true });
            }
        }
    }

    /**
     * Get watcher statistics
     */
    getStats(): {
        pending_files: number;
        processed_count: number;
        currently_processing: number;
        watching: boolean;
    } {
        const pending = this.listFiles().filter(
            f => !this.processedFiles.has(f.path) && !this.processing.has(f.path)
        ).length;

        // Clean up expired entries during stats call
        this.cleanupExpiredEntries();

        return {
            pending_files: pending,
            processed_count: this.processedFiles.size,
            currently_processing: this.processing.size,
            watching: this.isWatching()
        };
    }

    /**
     * Clear processed tracking
     */
    clearProcessedTracking(): void {
        this.processedFiles.clear();
    }

    /**
     * Clean up expired entries from processedFiles map
     * PERFORMANCE: Prevents unbounded memory growth
     */
    private cleanupExpiredEntries(): void {
        const now = Date.now();
        for (const [path, timestamp] of this.processedFiles.entries()) {
            if (now - timestamp > PROCESSED_FILE_TTL_MS) {
                this.processedFiles.delete(path);
            }
        }
    }

    /**
     * Write document to watch directory (for testing/injection)
     */
    writeDocument(document: MACPDocument, fileName?: string): string {
        const name = fileName || `${(document.document_type || "unknown").toLowerCase()}_${Date.now()}.json`;
        const filePath = path.join(this.config.watch_path, name);

        fs.writeFileSync(filePath, JSON.stringify(document, null, 2), "utf-8");

        return filePath;
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create file watcher
 */
export function createFileWatcher(
    config: Partial<FileWatcherConfig>,
    events: FileWatcherEvents
): HandoffFileWatcher {
    return new HandoffFileWatcher(config, events);
}

/**
 * Create file watcher for specific document types
 */
export function createTypedFileWatcher(
    watchPath: string,
    types: DocumentType[],
    events: FileWatcherEvents
): HandoffFileWatcher {
    return new HandoffFileWatcher({
        watch_path: watchPath,
        filter_types: types
    }, events);
}
