/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Audit Service
 * =============
 *
 * Central audit trail service combining hash chain and document states.
 * Provides immutable audit logging for all BYON operations.
 *
 * Features:
 * - Tamper-evident hash chain
 * - Document lifecycle tracking
 * - Query by time, type, state
 * - Export/import capabilities
 */

import * as fs from "fs";
import * as path from "path";
import {
    HashChain,
    HashChainEntry,
    ChainEntryType,
    ChainVerificationResult,
    calculateDocumentHash,
    createHashChain
} from "./hash-chain.js";

import {
    DocumentStateManager,
    DocumentState,
    DocumentWithState,
    StateTransition,
    StateTransitionResult,
    createDocumentStateManager
} from "./document-states.js";

// ============================================================================
// TYPES
// ============================================================================

export interface AuditRecord {
    /** Record ID */
    record_id: string;
    /** Timestamp */
    timestamp: string;
    /** Event type */
    event_type: AuditEventType;
    /** Document ID */
    document_id: string;
    /** Document type */
    document_type: string;
    /** Actor who performed action */
    actor: string;
    /** Event details */
    details: Record<string, unknown>;
    /** Chain entry hash */
    chain_hash: string;
    /** Document state at time of event */
    document_state: DocumentState;
}

export type AuditEventType =
    | "document_created"
    | "document_updated"
    | "document_deleted"
    | "state_changed"
    | "approval_requested"
    | "approval_granted"
    | "approval_denied"
    | "execution_started"
    | "execution_completed"
    | "execution_failed"
    | "error_occurred"
    | "system_event";

export interface AuditQuery {
    /** Filter by document ID */
    document_id?: string;
    /** Filter by document type */
    document_type?: string;
    /** Filter by event type */
    event_type?: AuditEventType;
    /** Filter by actor */
    actor?: string;
    /** Filter by state */
    state?: DocumentState;
    /** Start time */
    start_time?: Date;
    /** End time */
    end_time?: Date;
    /** Limit results */
    limit?: number;
    /** Offset for pagination */
    offset?: number;
}

export interface AuditServiceConfig {
    /** Auto-checkpoint interval (number of entries) */
    checkpointInterval: number;
    /** Enable auto-verification */
    autoVerify: boolean;
    /** Verification interval (ms) */
    verifyInterval: number;
    /** Persistence path (directory) - if set, enables auto-save */
    persistencePath?: string;
    /** Sync to disk on every write (slower but safer) */
    syncOnWrite?: boolean;
    /** Enable log rotation */
    enableRotation?: boolean;
    /** Max log size in bytes before rotation (default: 10MB) */
    maxLogSizeBytes?: number;
    /** Number of rotated logs to keep (default: 5) */
    maxRotatedLogs?: number;
    /** Rotation check interval in ms (default: 60000 = 1 min) */
    rotationCheckInterval?: number;
}

export interface AuditSnapshot {
    /** Snapshot timestamp */
    timestamp: string;
    /** Chain data */
    chain: ReturnType<HashChain["export"]>;
    /** Document states */
    documents: DocumentWithState[];
    /** Audit records */
    records: AuditRecord[];
    /** Verification result */
    verification: ChainVerificationResult;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: AuditServiceConfig = {
    checkpointInterval: 100,
    autoVerify: true,
    verifyInterval: 60000, // 1 minute
    syncOnWrite: true,
    enableRotation: true,
    maxLogSizeBytes: 10 * 1024 * 1024, // 10MB
    maxRotatedLogs: 5,
    rotationCheckInterval: 60000 // 1 minute
};

// ============================================================================
// AUDIT SERVICE
// ============================================================================

/**
 * Audit Service
 *
 * Central service for all audit operations.
 * 
 * ENTERPRISE FEATURES:
 * - Persistent Storage (JSON-based)
 * - Auto-Recovery
 * - Tamper-Evident Hash Chain
 */
export class AuditService {
    private config: AuditServiceConfig;
    private chain: HashChain;
    private stateManager: DocumentStateManager;
    private records: Map<string, AuditRecord>;
    private verifyTimer?: ReturnType<typeof setInterval>;
    private rotationTimer?: ReturnType<typeof setInterval>;
    private entriesSinceCheckpoint: number;

    constructor(config: Partial<AuditServiceConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.chain = createHashChain();
        this.stateManager = createDocumentStateManager();
        this.records = new Map();
        this.entriesSinceCheckpoint = 0;

        // Load from persistence if configured
        if (this.config.persistencePath) {
            this.loadFromPersistence();
        }

        if (this.config.autoVerify && this.config.verifyInterval > 0) {
            this.startAutoVerification();
        }

        // Start rotation checker if enabled
        if (this.config.enableRotation && this.config.persistencePath) {
            this.startRotationChecker();
        }
    }

    /**
     * Log document creation
     */
    logDocumentCreated(
        documentId: string,
        documentType: string,
        document: unknown,
        actor: string
    ): AuditRecord {
        // Register document state
        this.stateManager.register(documentId, documentType, "draft");

        // Add to chain
        const dataHash = calculateDocumentHash(document);
        const chainEntry = this.chain.addEntry(
            "document_created",
            documentId,
            documentType,
            dataHash,
            { actor }
        );

        // Create audit record
        return this.createRecord(
            "document_created",
            documentId,
            documentType,
            actor,
            { document_hash: dataHash },
            chainEntry,
            "draft"
        );
    }


    /**
     * Log document update
     */
    logDocumentUpdated(
        documentId: string,
        document: unknown,
        actor: string,
        changes: Record<string, unknown>
    ): AuditRecord | null {
        const docState = this.stateManager.getDocument(documentId);
        if (!docState) {
            throw new Error(`Document ${documentId} not found`);
        }

        if (!this.stateManager.canModify(documentId)) {
            throw new Error(`Document ${documentId} cannot be modified in state ${docState.state}`);
        }

        const dataHash = calculateDocumentHash(document);
        const chainEntry = this.chain.addEntry(
            "document_updated",
            documentId,
            docState.document_type,
            dataHash,
            { actor, changes }
        );

        return this.createRecord(
            "document_updated",
            documentId,
            docState.document_type,
            actor,
            { document_hash: dataHash, changes },
            chainEntry,
            docState.state
        );
    }

    /**
     * Log state change
     */
    logStateChange(
        documentId: string,
        newState: DocumentState,
        actor: string,
        reason: string
    ): { record: AuditRecord; transition: StateTransitionResult } {
        const docState = this.stateManager.getDocument(documentId);
        if (!docState) {
            throw new Error(`Document ${documentId} not found`);
        }

        const previousState = docState.state;

        // Transition state
        const transition = this.stateManager.transition({
            document_id: documentId,
            target_state: newState,
            reason,
            actor
        });

        if (!transition.success) {
            throw new Error(transition.error || "State transition failed");
        }

        // Add to chain
        const chainEntry = this.chain.addEntry(
            "state_changed",
            documentId,
            docState.document_type,
            calculateDocumentHash({ from: previousState, to: newState }),
            { actor, reason, from: previousState, to: newState }
        );

        const record = this.createRecord(
            "state_changed",
            documentId,
            docState.document_type,
            actor,
            { from: previousState, to: newState, reason },
            chainEntry,
            newState
        );

        return { record, transition };
    }

    /**
     * Log approval request
     */
    logApprovalRequested(
        documentId: string,
        actor: string,
        approvers: string[]
    ): AuditRecord {
        const docState = this.stateManager.getDocument(documentId);
        if (!docState) {
            throw new Error(`Document ${documentId} not found`);
        }

        // Transition to pending
        const { record } = this.logStateChange(documentId, "pending", actor, "Approval requested");

        // Log the approval request event
        const chainEntry = this.chain.addEntry(
            "document_updated",
            documentId,
            docState.document_type,
            calculateDocumentHash({ approvers }),
            { actor, approvers }
        );

        return this.createRecord(
            "approval_requested",
            documentId,
            docState.document_type,
            actor,
            { approvers },
            chainEntry,
            "pending"
        );
    }

    /**
     * Log approval granted
     */
    logApprovalGranted(
        documentId: string,
        approver: string,
        comments?: string
    ): AuditRecord {
        const docState = this.stateManager.getDocument(documentId);
        if (!docState) {
            throw new Error(`Document ${documentId} not found`);
        }

        // Transition to approved
        this.logStateChange(documentId, "approved", approver, "Approval granted");

        const chainEntry = this.chain.addEntry(
            "state_changed",
            documentId,
            docState.document_type,
            calculateDocumentHash({ approved: true, approver }),
            { approver, comments }
        );

        return this.createRecord(
            "approval_granted",
            documentId,
            docState.document_type,
            approver,
            { comments },
            chainEntry,
            "approved"
        );
    }

    /**
     * Log approval denied
     */
    logApprovalDenied(
        documentId: string,
        approver: string,
        reason: string
    ): AuditRecord {
        const docState = this.stateManager.getDocument(documentId);
        if (!docState) {
            throw new Error(`Document ${documentId} not found`);
        }

        // Transition back to draft
        this.logStateChange(documentId, "draft", approver, reason);

        const chainEntry = this.chain.addEntry(
            "state_changed",
            documentId,
            docState.document_type,
            calculateDocumentHash({ approved: false, approver, reason }),
            { approver, reason }
        );

        return this.createRecord(
            "approval_denied",
            documentId,
            docState.document_type,
            approver,
            { reason },
            chainEntry,
            "draft"
        );
    }

    /**
     * Log execution started
     */
    logExecutionStarted(
        documentId: string,
        executor: string
    ): AuditRecord {
        const docState = this.stateManager.getDocument(documentId);
        if (!docState) {
            throw new Error(`Document ${documentId} not found`);
        }

        const chainEntry = this.chain.addEntry(
            "document_updated",
            documentId,
            docState.document_type,
            calculateDocumentHash({ execution_started: true }),
            { executor }
        );

        return this.createRecord(
            "execution_started",
            documentId,
            docState.document_type,
            executor,
            {},
            chainEntry,
            "approved"
        );
    }

    /**
     * Log execution completed
     */
    logExecutionCompleted(
        documentId: string,
        executor: string,
        result: Record<string, unknown>
    ): AuditRecord {
        const docState = this.stateManager.getDocument(documentId);
        if (!docState) {
            throw new Error(`Document ${documentId} not found`);
        }

        // Transition to executed
        this.logStateChange(documentId, "executed", executor, "Execution completed");

        const chainEntry = this.chain.addEntry(
            "state_changed",
            documentId,
            docState.document_type,
            calculateDocumentHash(result),
            { executor, result }
        );

        return this.createRecord(
            "execution_completed",
            documentId,
            docState.document_type,
            executor,
            result,
            chainEntry,
            "executed"
        );
    }

    /**
     * Log execution failed
     */
    logExecutionFailed(
        documentId: string,
        executor: string,
        error: string,
        details?: Record<string, unknown>
    ): AuditRecord {
        const docState = this.stateManager.getDocument(documentId);
        if (!docState) {
            throw new Error(`Document ${documentId} not found`);
        }

        // Transition to failed
        this.logStateChange(documentId, "failed", executor, error);

        const chainEntry = this.chain.addEntry(
            "state_changed",
            documentId,
            docState.document_type,
            calculateDocumentHash({ error, details }),
            { executor, error, details }
        );

        return this.createRecord(
            "execution_failed",
            documentId,
            docState.document_type,
            executor,
            { error, ...details },
            chainEntry,
            "failed"
        );
    }

    /**
     * Log error
     */
    logError(
        documentId: string,
        actor: string,
        error: string,
        details?: Record<string, unknown>
    ): AuditRecord {
        const docState = this.stateManager.getDocument(documentId);

        const chainEntry = this.chain.addEntry(
            "document_updated",
            documentId,
            docState?.document_type || "unknown",
            calculateDocumentHash({ error, details }),
            { actor, error, details }
        );

        return this.createRecord(
            "error_occurred",
            documentId,
            docState?.document_type || "unknown",
            actor,
            { error, ...details },
            chainEntry,
            docState?.state || "draft"
        );
    }

    /**
     * Log system event
     */
    logSystemEvent(
        eventName: string,
        details: Record<string, unknown>
    ): AuditRecord {
        const chainEntry = this.chain.addEntry(
            "checkpoint",
            `system_${Date.now()}`,
            "system_event",
            calculateDocumentHash(details),
            { event: eventName, ...details }
        );

        return this.createRecord(
            "system_event",
            `system_${Date.now()}`,
            "system_event",
            "system",
            { event: eventName, ...details },
            chainEntry,
            "executed"
        );
    }

    /**
     * Create audit record
     */
    private createRecord(
        eventType: AuditEventType,
        documentId: string,
        documentType: string,
        actor: string,
        details: Record<string, unknown>,
        chainEntry: HashChainEntry,
        state: DocumentState
    ): AuditRecord {
        const recordId = `audit_${chainEntry.index}_${Date.now()}`;

        const record: AuditRecord = {
            record_id: recordId,
            timestamp: chainEntry.timestamp,
            event_type: eventType,
            document_id: documentId,
            document_type: documentType,
            actor,
            details,
            chain_hash: chainEntry.hash,
            document_state: state
        };

        this.records.set(recordId, record);
        this.entriesSinceCheckpoint++;

        // Auto checkpoint
        if (this.entriesSinceCheckpoint >= this.config.checkpointInterval) {
            this.createCheckpoint();
        }

        // Auto save if persistence enabled
        if (this.config.persistencePath && this.config.syncOnWrite) {
            this.saveToPersistence();
        }

        return record;
    }

    /**
     * Create checkpoint
     */
    createCheckpoint(): HashChainEntry {
        this.entriesSinceCheckpoint = 0;
        const entry = this.chain.createCheckpoint({
            records_count: this.records.size,
            documents_count: this.stateManager.getStats().total
        });
        
        if (this.config.persistencePath && this.config.syncOnWrite) {
            this.saveToPersistence();
        }
        
        return entry;
    }

    /**
     * Save to persistence
     */
    private saveToPersistence(): void {
        if (!this.config.persistencePath) return;

        try {
            if (!fs.existsSync(this.config.persistencePath)) {
                fs.mkdirSync(this.config.persistencePath, { recursive: true });
            }

            const snapshot = this.createSnapshot();
            const filePath = path.join(this.config.persistencePath, "audit_log.json");
            const tempPath = filePath + ".tmp";

            // Write to temp file first for atomic update
            fs.writeFileSync(tempPath, JSON.stringify(snapshot, null, 2));
            fs.renameSync(tempPath, filePath);
            
        } catch (error) {
            console.error("Failed to save audit log:", error);
        }
    }

    /**
     * Load from persistence
     */
    private loadFromPersistence(): void {
        if (!this.config.persistencePath) return;

        try {
            const filePath = path.join(this.config.persistencePath, "audit_log.json");
            if (!fs.existsSync(filePath)) return;

            const content = fs.readFileSync(filePath, "utf-8");
            const snapshot = JSON.parse(content) as AuditSnapshot;

            this.restoreFromSnapshot(snapshot);
            console.log(`[AuditService] Restored ${snapshot.records.length} records from persistence`);

        } catch (error) {
            console.error("Failed to load audit log:", error);
            // Don't crash - start fresh if corrupted, but log error
        }
    }

    /**
     * Verify chain integrity
     */
    verify(): ChainVerificationResult {
        return this.chain.verify();
    }

    /**
     * Query audit records
     */
    query(query: AuditQuery): AuditRecord[] {
        let results = Array.from(this.records.values());

        // Apply filters
        if (query.document_id) {
            results = results.filter(r => r.document_id === query.document_id);
        }
        if (query.document_type) {
            results = results.filter(r => r.document_type === query.document_type);
        }
        if (query.event_type) {
            results = results.filter(r => r.event_type === query.event_type);
        }
        if (query.actor) {
            results = results.filter(r => r.actor === query.actor);
        }
        if (query.state) {
            results = results.filter(r => r.document_state === query.state);
        }
        if (query.start_time) {
            results = results.filter(r => new Date(r.timestamp) >= query.start_time!);
        }
        if (query.end_time) {
            results = results.filter(r => new Date(r.timestamp) <= query.end_time!);
        }

        // Sort by timestamp descending
        results.sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        // Apply pagination
        if (query.offset) {
            results = results.slice(query.offset);
        }
        if (query.limit) {
            results = results.slice(0, query.limit);
        }

        return results;
    }

    /**
     * Get document state
     */
    getDocumentState(documentId: string): DocumentWithState | undefined {
        return this.stateManager.getDocument(documentId);
    }

    /**
     * Get document history
     */
    getDocumentHistory(documentId: string): AuditRecord[] {
        return this.query({ document_id: documentId });
    }

    /**
     * Create snapshot
     */
    createSnapshot(): AuditSnapshot {
        return {
            timestamp: new Date().toISOString(),
            chain: this.chain.export(),
            documents: this.stateManager.export(),
            records: Array.from(this.records.values()),
            verification: this.verify()
        };
    }

    /**
     * Restore from snapshot
     */
    restoreFromSnapshot(snapshot: AuditSnapshot): void {
        // Verify snapshot chain
        const chain = HashChain.import(snapshot.chain);
        const verification = chain.verify();

        if (!verification.valid) {
            throw new Error(`Snapshot chain is invalid: ${verification.error}`);
        }

        this.chain = chain;
        this.stateManager = createDocumentStateManager();
        this.stateManager.import(snapshot.documents);

        this.records.clear();
        for (const record of snapshot.records) {
            this.records.set(record.record_id, record);
        }
    }

    /**
     * Start auto verification
     */
    private startAutoVerification(): void {
        this.verifyTimer = setInterval(() => {
            const result = this.verify();
            if (!result.valid) {
                console.error("AUDIT CHAIN INTEGRITY VIOLATION:", result.error);
            }
        }, this.config.verifyInterval);
    }

    /**
     * Stop auto verification
     */
    stopAutoVerification(): void {
        if (this.verifyTimer) {
            clearInterval(this.verifyTimer);
            this.verifyTimer = undefined;
        }
    }

    /**
     * Get statistics
     */
    getStats(): {
        chain_length: number;
        records_count: number;
        documents: ReturnType<DocumentStateManager["getStats"]>;
        head_hash: string;
        is_valid: boolean;
    } {
        return {
            chain_length: this.chain.getLength(),
            records_count: this.records.size,
            documents: this.stateManager.getStats(),
            head_hash: this.chain.getHeadHash(),
            is_valid: this.verify().valid
        };
    }

    /**
     * Start rotation checker
     */
    private startRotationChecker(): void {
        this.rotationTimer = setInterval(() => {
            this.checkAndRotate();
        }, this.config.rotationCheckInterval || 60000);
    }

    /**
     * Stop rotation checker
     */
    stopRotationChecker(): void {
        if (this.rotationTimer) {
            clearInterval(this.rotationTimer);
            this.rotationTimer = undefined;
        }
    }

    /**
     * Check if rotation is needed and perform it
     */
    private checkAndRotate(): void {
        if (!this.config.persistencePath) return;

        try {
            const logPath = path.join(this.config.persistencePath, "audit_log.json");
            if (!fs.existsSync(logPath)) return;

            const stats = fs.statSync(logPath);
            const maxSize = this.config.maxLogSizeBytes || 10 * 1024 * 1024;

            if (stats.size >= maxSize) {
                this.rotateLog();
            }
        } catch (error) {
            console.error("[AuditService] Error checking rotation:", error);
        }
    }

    /**
     * Rotate the audit log
     */
    rotateLog(): void {
        if (!this.config.persistencePath) return;

        try {
            const logPath = path.join(this.config.persistencePath, "audit_log.json");
            if (!fs.existsSync(logPath)) return;

            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const archivePath = path.join(
                this.config.persistencePath,
                `audit_log.${timestamp}.json`
            );

            // Move current log to archive
            fs.renameSync(logPath, archivePath);
            console.log(`[AuditService] Rotated log to: ${archivePath}`);

            // Clear in-memory state and start fresh
            this.records.clear();
            this.chain = createHashChain();
            this.stateManager = createDocumentStateManager();
            this.entriesSinceCheckpoint = 0;

            // Log rotation event in new log
            this.logSystemEvent("log_rotated", {
                archived_to: archivePath,
                previous_records: this.records.size
            });

            // Cleanup old rotated logs
            this.cleanupOldLogs();

        } catch (error) {
            console.error("[AuditService] Error rotating log:", error);
        }
    }

    /**
     * Clean up old rotated logs
     */
    private cleanupOldLogs(): void {
        if (!this.config.persistencePath) return;

        try {
            const files = fs.readdirSync(this.config.persistencePath)
                .filter(f => f.startsWith("audit_log.") && f.endsWith(".json") && f !== "audit_log.json")
                .sort()
                .reverse(); // Newest first

            const maxLogs = this.config.maxRotatedLogs || 5;

            // Remove logs beyond the limit
            for (let i = maxLogs; i < files.length; i++) {
                const filePath = path.join(this.config.persistencePath, files[i]);
                fs.unlinkSync(filePath);
                console.log(`[AuditService] Deleted old log: ${files[i]}`);
            }

        } catch (error) {
            console.error("[AuditService] Error cleaning old logs:", error);
        }
    }

    /**
     * Get list of rotated log files
     */
    getRotatedLogs(): { filename: string; size: number; created: Date }[] {
        if (!this.config.persistencePath) return [];

        try {
            return fs.readdirSync(this.config.persistencePath)
                .filter(f => f.startsWith("audit_log.") && f.endsWith(".json"))
                .map(f => {
                    const filePath = path.join(this.config.persistencePath!, f);
                    const stats = fs.statSync(filePath);
                    return {
                        filename: f,
                        size: stats.size,
                        created: stats.mtime
                    };
                })
                .sort((a, b) => b.created.getTime() - a.created.getTime());
        } catch {
            return [];
        }
    }

    /**
     * Cleanup (call on shutdown)
     */
    cleanup(): void {
        this.stopAutoVerification();
        this.stopRotationChecker();
        // Final save before shutdown
        if (this.config.persistencePath) {
            this.saveToPersistence();
        }
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create audit service
 */
export function createAuditService(
    config?: Partial<AuditServiceConfig>
): AuditService {
    return new AuditService(config);
}
