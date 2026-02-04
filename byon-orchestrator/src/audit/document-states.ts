/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Document States
 * ===============
 *
 * Manages document lifecycle states for BYON audit trail.
 * Enforces state transitions and immutability rules.
 *
 * States:
 * - draft: can be deleted by user
 * - pending: awaiting approval
 * - approved: ready for execution
 * - executed: immutable - soft delete only
 * - failed: immutable - soft delete only
 * - cancelled: soft deleted
 */

// ============================================================================
// TYPES
// ============================================================================

export type DocumentState =
    | "draft"
    | "pending"
    | "approved"
    | "executed"
    | "failed"
    | "cancelled";

export interface DocumentStateInfo {
    /** Current state */
    state: DocumentState;
    /** Whether document can be hard deleted */
    canHardDelete: boolean;
    /** Whether document can be modified */
    canModify: boolean;
    /** Whether state is terminal */
    isTerminal: boolean;
    /** Allowed next states */
    allowedTransitions: DocumentState[];
    /** Description */
    description: string;
}

export interface StateTransition {
    /** From state */
    from: DocumentState;
    /** To state */
    to: DocumentState;
    /** Transition timestamp */
    timestamp: string;
    /** Reason for transition */
    reason: string;
    /** Actor who initiated transition */
    actor: string;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
}

export interface DocumentWithState {
    /** Document ID */
    document_id: string;
    /** Document type */
    document_type: string;
    /** Current state */
    state: DocumentState;
    /** State history */
    state_history: StateTransition[];
    /** Created timestamp */
    created_at: string;
    /** Last updated timestamp */
    updated_at: string;
    /** Soft deleted flag */
    is_deleted: boolean;
    /** Deleted timestamp */
    deleted_at?: string;
}

export interface StateTransitionRequest {
    /** Document ID */
    document_id: string;
    /** Target state */
    target_state: DocumentState;
    /** Reason for transition */
    reason: string;
    /** Actor initiating transition */
    actor: string;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
}

export interface StateTransitionResult {
    /** Whether transition succeeded */
    success: boolean;
    /** Error message if failed */
    error?: string;
    /** Previous state */
    previous_state?: DocumentState;
    /** New state */
    new_state?: DocumentState;
    /** Transition record */
    transition?: StateTransition;
}

// ============================================================================
// STATE DEFINITIONS
// ============================================================================

const STATE_INFO: Record<DocumentState, DocumentStateInfo> = {
    draft: {
        state: "draft",
        canHardDelete: true,
        canModify: true,
        isTerminal: false,
        allowedTransitions: ["pending", "cancelled"],
        description: "Document is being drafted, can be deleted or modified"
    },
    pending: {
        state: "pending",
        canHardDelete: false,
        canModify: false,
        isTerminal: false,
        allowedTransitions: ["approved", "draft", "cancelled"],
        description: "Document is awaiting approval"
    },
    approved: {
        state: "approved",
        canHardDelete: false,
        canModify: false,
        isTerminal: false,
        allowedTransitions: ["executed", "failed", "cancelled"],
        description: "Document is approved and ready for execution"
    },
    executed: {
        state: "executed",
        canHardDelete: false,
        canModify: false,
        isTerminal: true,
        allowedTransitions: ["cancelled"], // Only soft delete
        description: "Document has been executed, immutable"
    },
    failed: {
        state: "failed",
        canHardDelete: false,
        canModify: false,
        isTerminal: true,
        allowedTransitions: ["cancelled"], // Only soft delete
        description: "Document execution failed, immutable"
    },
    cancelled: {
        state: "cancelled",
        canHardDelete: false,
        canModify: false,
        isTerminal: true,
        allowedTransitions: [],
        description: "Document has been soft deleted"
    }
};

// ============================================================================
// DOCUMENT STATE MANAGER
// ============================================================================

/**
 * Document State Manager
 *
 * Manages document lifecycle states and enforces transitions.
 */
export class DocumentStateManager {
    private documents: Map<string, DocumentWithState>;

    constructor() {
        this.documents = new Map();
    }

    /**
     * Register new document
     */
    register(
        documentId: string,
        documentType: string,
        initialState: DocumentState = "draft"
    ): DocumentWithState {
        if (this.documents.has(documentId)) {
            throw new Error(`Document ${documentId} already registered`);
        }

        const now = new Date().toISOString();
        const document: DocumentWithState = {
            document_id: documentId,
            document_type: documentType,
            state: initialState,
            state_history: [
                {
                    from: initialState,
                    to: initialState,
                    timestamp: now,
                    reason: "Document created",
                    actor: "system"
                }
            ],
            created_at: now,
            updated_at: now,
            is_deleted: false
        };

        this.documents.set(documentId, document);
        return document;
    }

    /**
     * Get document state
     */
    getDocument(documentId: string): DocumentWithState | undefined {
        return this.documents.get(documentId);
    }

    /**
     * Get current state
     */
    getState(documentId: string): DocumentState | undefined {
        return this.documents.get(documentId)?.state;
    }

    /**
     * Get state info
     */
    getStateInfo(state: DocumentState): DocumentStateInfo {
        return STATE_INFO[state];
    }

    /**
     * Check if transition is allowed
     */
    canTransition(documentId: string, targetState: DocumentState): boolean {
        const document = this.documents.get(documentId);
        if (!document) return false;

        const currentStateInfo = STATE_INFO[document.state];
        return currentStateInfo.allowedTransitions.includes(targetState);
    }

    /**
     * Transition document state
     */
    transition(request: StateTransitionRequest): StateTransitionResult {
        const document = this.documents.get(request.document_id);

        if (!document) {
            return {
                success: false,
                error: `Document ${request.document_id} not found`
            };
        }

        if (document.is_deleted) {
            return {
                success: false,
                error: `Document ${request.document_id} has been deleted`
            };
        }

        const currentStateInfo = STATE_INFO[document.state];

        if (!currentStateInfo.allowedTransitions.includes(request.target_state)) {
            return {
                success: false,
                error: `Cannot transition from ${document.state} to ${request.target_state}`,
                previous_state: document.state
            };
        }

        const previousState = document.state;
        const now = new Date().toISOString();

        const transition: StateTransition = {
            from: previousState,
            to: request.target_state,
            timestamp: now,
            reason: request.reason,
            actor: request.actor,
            metadata: request.metadata
        };

        document.state = request.target_state;
        document.state_history.push(transition);
        document.updated_at = now;

        // Handle soft delete for cancelled state
        if (request.target_state === "cancelled") {
            document.is_deleted = true;
            document.deleted_at = now;
        }

        return {
            success: true,
            previous_state: previousState,
            new_state: request.target_state,
            transition
        };
    }

    /**
     * Check if document can be hard deleted
     */
    canHardDelete(documentId: string): boolean {
        const document = this.documents.get(documentId);
        if (!document) return false;

        return STATE_INFO[document.state].canHardDelete;
    }

    /**
     * Check if document can be modified
     */
    canModify(documentId: string): boolean {
        const document = this.documents.get(documentId);
        if (!document) return false;

        return STATE_INFO[document.state].canModify && !document.is_deleted;
    }

    /**
     * Hard delete document (only if allowed)
     */
    hardDelete(documentId: string, actor: string): boolean {
        const document = this.documents.get(documentId);
        if (!document) return false;

        if (!this.canHardDelete(documentId)) {
            return false;
        }

        this.documents.delete(documentId);
        return true;
    }

    /**
     * Soft delete document
     */
    softDelete(documentId: string, actor: string, reason: string): StateTransitionResult {
        return this.transition({
            document_id: documentId,
            target_state: "cancelled",
            reason,
            actor
        });
    }

    /**
     * Get documents by state
     */
    getDocumentsByState(state: DocumentState): DocumentWithState[] {
        return Array.from(this.documents.values())
            .filter(d => d.state === state && !d.is_deleted);
    }

    /**
     * Get documents by type
     */
    getDocumentsByType(documentType: string): DocumentWithState[] {
        return Array.from(this.documents.values())
            .filter(d => d.document_type === documentType && !d.is_deleted);
    }

    /**
     * Get all active documents
     */
    getActiveDocuments(): DocumentWithState[] {
        return Array.from(this.documents.values())
            .filter(d => !d.is_deleted);
    }

    /**
     * Get deleted documents
     */
    getDeletedDocuments(): DocumentWithState[] {
        return Array.from(this.documents.values())
            .filter(d => d.is_deleted);
    }

    /**
     * Get state history for document
     */
    getStateHistory(documentId: string): StateTransition[] {
        const document = this.documents.get(documentId);
        return document ? [...document.state_history] : [];
    }

    /**
     * Export all documents
     */
    export(): DocumentWithState[] {
        return Array.from(this.documents.values());
    }

    /**
     * Import documents
     */
    import(documents: DocumentWithState[]): void {
        for (const doc of documents) {
            this.documents.set(doc.document_id, doc);
        }
    }

    /**
     * Get statistics
     */
    getStats(): {
        total: number;
        byState: Record<DocumentState, number>;
        deleted: number;
        active: number;
    } {
        const byState: Record<DocumentState, number> = {
            draft: 0,
            pending: 0,
            approved: 0,
            executed: 0,
            failed: 0,
            cancelled: 0
        };

        let deleted = 0;
        let active = 0;

        for (const doc of this.documents.values()) {
            byState[doc.state]++;
            if (doc.is_deleted) {
                deleted++;
            } else {
                active++;
            }
        }

        return {
            total: this.documents.size,
            byState,
            deleted,
            active
        };
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create document state manager
 */
export function createDocumentStateManager(): DocumentStateManager {
    return new DocumentStateManager();
}

/**
 * Get state info
 */
export function getStateInfo(state: DocumentState): DocumentStateInfo {
    return STATE_INFO[state];
}

/**
 * Check if state is terminal
 */
export function isTerminalState(state: DocumentState): boolean {
    return STATE_INFO[state].isTerminal;
}

/**
 * Check if state allows modification
 */
export function stateAllowsModification(state: DocumentState): boolean {
    return STATE_INFO[state].canModify;
}

/**
 * Get allowed transitions from state
 */
export function getAllowedTransitions(state: DocumentState): DocumentState[] {
    return [...STATE_INFO[state].allowedTransitions];
}
