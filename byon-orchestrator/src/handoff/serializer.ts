/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Handoff Serializer
 * ==================
 *
 * Serializes and deserializes MACP documents for handoff.
 * Ensures type safety and integrity during inter-agent communication.
 */

import * as crypto from "crypto";
import {
    EvidencePack,
    PlanDraft,
    ApprovalRequest,
    ExecutionOrder,
    JohnsonReceipt,
    isEvidencePack,
    isPlanDraft,
    isApprovalRequest,
    isExecutionOrder,
    isJohnsonReceipt
} from "../types/protocol.js";

// ============================================================================
// TYPES
// ============================================================================

export type MACPDocument =
    | EvidencePack
    | PlanDraft
    | ApprovalRequest
    | ExecutionOrder
    | JohnsonReceipt;

export type DocumentType =
    | "EVIDENCE_PACK"
    | "PLAN_DRAFT"
    | "APPROVAL_REQUEST"
    | "EXECUTION_ORDER"
    | "JOHNSON_RECEIPT";

export interface SerializedDocument {
    /** Document type */
    type: DocumentType;
    /** Document version */
    version: string;
    /** Serialized content (JSON string) */
    content: string;
    /** Content hash for integrity */
    hash: string;
    /** Serialization timestamp */
    serialized_at: string;
}

export interface DeserializationResult<T> {
    success: boolean;
    document?: T;
    type?: DocumentType;
    error?: string;
}

// ============================================================================
// SERIALIZER
// ============================================================================

/**
 * Serialize a MACP document
 */
export function serialize(document: MACPDocument): SerializedDocument {
    const content = JSON.stringify(document, null, 2);
    const hash = crypto.createHash("sha256").update(content).digest("hex");

    return {
        type: (document.document_type || "EVIDENCE_PACK") as DocumentType,
        version: document.document_version || "1.0",
        content,
        hash,
        serialized_at: new Date().toISOString()
    };
}

/**
 * Deserialize a MACP document
 */
export function deserialize(serialized: SerializedDocument): DeserializationResult<MACPDocument> {
    try {
        // Verify hash
        const expectedHash = crypto
            .createHash("sha256")
            .update(serialized.content)
            .digest("hex");

        if (serialized.hash !== expectedHash) {
            return {
                success: false,
                error: "Hash mismatch - content may have been tampered"
            };
        }

        // Parse content
        const document = JSON.parse(serialized.content);

        // Validate type
        if (document.document_type !== serialized.type) {
            return {
                success: false,
                error: `Type mismatch: expected ${serialized.type}, got ${document.document_type}`
            };
        }

        return {
            success: true,
            document,
            type: serialized.type
        };

    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

/**
 * Deserialize with type checking
 */
export function deserializeTyped<T extends MACPDocument>(
    serialized: SerializedDocument,
    expectedType: DocumentType
): DeserializationResult<T> {
    if (serialized.type !== expectedType) {
        return {
            success: false,
            error: `Wrong document type: expected ${expectedType}, got ${serialized.type}`
        };
    }

    const result = deserialize(serialized);

    if (!result.success) {
        return {
            success: false,
            error: result.error
        };
    }

    return {
        success: true,
        document: result.document as T,
        type: expectedType
    };
}

/**
 * Parse raw JSON to MACP document
 */
export function parseDocument(json: string): DeserializationResult<MACPDocument> {
    try {
        const document = JSON.parse(json);

        if (!document.document_type) {
            return {
                success: false,
                error: "Missing document_type field"
            };
        }

        // Validate document type
        const validTypes: DocumentType[] = [
            "EVIDENCE_PACK",
            "PLAN_DRAFT",
            "APPROVAL_REQUEST",
            "EXECUTION_ORDER",
            "JOHNSON_RECEIPT"
        ];

        if (!validTypes.includes(document.document_type)) {
            return {
                success: false,
                error: `Unknown document type: ${document.document_type}`
            };
        }

        return {
            success: true,
            document,
            type: document.document_type
        };

    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

/**
 * Type guard for documents
 */
export function getDocumentType(document: unknown): DocumentType | null {
    if (isEvidencePack(document)) return "EVIDENCE_PACK";
    if (isPlanDraft(document)) return "PLAN_DRAFT";
    if (isApprovalRequest(document)) return "APPROVAL_REQUEST";
    if (isExecutionOrder(document)) return "EXECUTION_ORDER";
    if (isJohnsonReceipt(document)) return "JOHNSON_RECEIPT";
    return null;
}

/**
 * Validate document structure
 */
export function validateDocument(document: MACPDocument): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    // Check required fields
    if (!document.document_type) {
        errors.push("Missing document_type");
    }

    if (!document.document_version) {
        errors.push("Missing document_version");
    }

    // Type-specific validation
    switch (document.document_type) {
        case "EVIDENCE_PACK":
            if (!(document as EvidencePack).evidence_id) {
                errors.push("Missing evidence_id");
            }
            break;

        case "PLAN_DRAFT":
            if (!(document as PlanDraft).plan_id) {
                errors.push("Missing plan_id");
            }
            if (!(document as PlanDraft).based_on_evidence) {
                errors.push("Missing based_on_evidence");
            }
            break;

        case "APPROVAL_REQUEST":
            if (!(document as ApprovalRequest).request_id) {
                errors.push("Missing request_id");
            }
            break;

        case "EXECUTION_ORDER":
            if (!(document as ExecutionOrder).order_id) {
                errors.push("Missing order_id");
            }
            if (!(document as ExecutionOrder).signature) {
                errors.push("Missing signature");
            }
            break;

        case "JOHNSON_RECEIPT":
            if (!(document as JohnsonReceipt).receipt_id) {
                errors.push("Missing receipt_id");
            }
            break;
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Create document envelope for transport
 */
export function createEnvelope(
    document: MACPDocument,
    metadata?: Record<string, unknown>
): {
    envelope_id: string;
    created_at: string;
    document: SerializedDocument;
    metadata?: Record<string, unknown>;
} {
    return {
        envelope_id: `env_${crypto.randomUUID().replace(/-/g, "")}`,
        created_at: new Date().toISOString(),
        document: serialize(document),
        metadata
    };
}
