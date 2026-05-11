/**
 * BYON Optimus - Proprietary Software
 * Copyright (c) 2025-2026 Vasile Lucian Borbeleac
 * Patent: EP25216372.0 - FHRSS (Omni-Qube-Vault)
 *
 * CONFIDENTIAL AND PROPRIETARY
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

/**
 * Schema Validator
 * ================
 *
 * Ajv-based JSON Schema validation for all MACP v1.1 document types.
 * Validates documents at handoff read/write points to enforce structural
 * integrity across the Worker → Auditor → Executor pipeline.
 */

import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";
import { readFileSync } from "fs";
import { createRequire } from "module";

// Handle CJS/ESM interop for Ajv
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv = (AjvModule as any).default || AjvModule;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addFormats = (addFormatsModule as any).default || addFormatsModule;

const require = createRequire(import.meta.url);

// Schema imports (use require for JSON in NodeNext)
const evidencePackSchema = require("../schemas/evidence-pack.schema.json");
const planDraftSchema = require("../schemas/plan-draft.schema.json");
const approvalRequestSchema = require("../schemas/approval-request.schema.json");
const executionOrderSchema = require("../schemas/execution-order.schema.json");
const johnsonReceiptSchema = require("../schemas/johnson-receipt.schema.json");

// ============================================================================
// TYPES
// ============================================================================

export type DocumentType =
    | "EVIDENCE_PACK"
    | "PLAN_DRAFT"
    | "APPROVAL_REQUEST"
    | "EXECUTION_ORDER"
    | "JOHNSON_RECEIPT";

export interface ValidationResult {
    valid: boolean;
    documentType: DocumentType;
    errors: ValidationError[];
}

export interface ValidationError {
    path: string;
    message: string;
    keyword: string;
}

// ============================================================================
// VALIDATOR
// ============================================================================

 
type AjvValidateFunction = (data: unknown) => boolean & { errors?: Array<{ instancePath?: string; message?: string; keyword?: string }> | null };

export class SchemaValidator {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private ajv: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private validators: Map<DocumentType, any>;

    constructor() {
        this.ajv = new Ajv({
            allErrors: true,
            strict: false
        });
        addFormats(this.ajv);

        this.validators = new Map();

        // Compile all schemas
        this.validators.set("EVIDENCE_PACK", this.ajv.compile(evidencePackSchema));
        this.validators.set("PLAN_DRAFT", this.ajv.compile(planDraftSchema));
        this.validators.set("APPROVAL_REQUEST", this.ajv.compile(approvalRequestSchema));
        this.validators.set("EXECUTION_ORDER", this.ajv.compile(executionOrderSchema));
        this.validators.set("JOHNSON_RECEIPT", this.ajv.compile(johnsonReceiptSchema));
    }

    /**
     * Validate a document against its schema
     */
    validate(document: unknown, documentType: DocumentType): ValidationResult {
        const validator = this.validators.get(documentType);
        if (!validator) {
            return {
                valid: false,
                documentType,
                errors: [{ path: "", message: `Unknown document type: ${documentType}`, keyword: "type" }]
            };
        }

        const valid = validator(document);

        return {
            valid: !!valid,
            documentType,
            errors: valid
                ? []
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                : (validator.errors || []).map((err: any) => ({
                    path: err.instancePath || "",
                    message: err.message || "Unknown validation error",
                    keyword: err.keyword || "unknown"
                }))
        };
    }

    /**
     * Auto-detect document type and validate
     */
    validateAuto(document: unknown): ValidationResult {
        if (typeof document !== "object" || document === null) {
            return {
                valid: false,
                documentType: "EVIDENCE_PACK",
                errors: [{ path: "", message: "Document must be a non-null object", keyword: "type" }]
            };
        }

        const doc = document as Record<string, unknown>;
        const docType = this.detectDocumentType(doc);

        if (!docType) {
            return {
                valid: false,
                documentType: "EVIDENCE_PACK",
                errors: [{ path: "", message: "Cannot determine document type", keyword: "type" }]
            };
        }

        return this.validate(document, docType);
    }

    /**
     * Detect document type from content
     */
    private detectDocumentType(doc: Record<string, unknown>): DocumentType | null {
        // Check explicit document_type field
        if (doc.document_type) {
            const validTypes: DocumentType[] = [
                "EVIDENCE_PACK", "PLAN_DRAFT", "APPROVAL_REQUEST",
                "EXECUTION_ORDER", "JOHNSON_RECEIPT"
            ];
            if (validTypes.includes(doc.document_type as DocumentType)) {
                return doc.document_type as DocumentType;
            }
        }

        // Heuristic detection by unique fields
        if ("evidence_id" in doc && "extracted_facts" in doc) {return "EVIDENCE_PACK";}
        if ("plan_id" in doc && "based_on_evidence" in doc) {return "PLAN_DRAFT";}
        if ("request_id" in doc && "actions_preview" in doc) {return "APPROVAL_REQUEST";}
        if ("order_id" in doc && "signature" in doc) {return "EXECUTION_ORDER";}
        if ("receipt_id" in doc && "execution_summary" in doc) {return "JOHNSON_RECEIPT";}

        return null;
    }

    /**
     * Validate a handoff file (reads JSON from disk)
     */
    validateFile(filePath: string, documentType?: DocumentType): ValidationResult {
        try {
            const content = readFileSync(filePath, "utf-8");
            const document = JSON.parse(content);

            if (documentType) {
                return this.validate(document, documentType);
            }
            return this.validateAuto(document);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                valid: false,
                documentType: documentType || "EVIDENCE_PACK",
                errors: [{ path: "", message: `Failed to read/parse file: ${message}`, keyword: "file" }]
            };
        }
    }
}

// ============================================================================
// SINGLETON & FACTORY
// ============================================================================

let _instance: SchemaValidator | null = null;

/**
 * Get shared SchemaValidator instance
 */
export function getSchemaValidator(): SchemaValidator {
    if (!_instance) {
        _instance = new SchemaValidator();
    }
    return _instance;
}

/**
 * Create new SchemaValidator instance
 */
export function createSchemaValidator(): SchemaValidator {
    return new SchemaValidator();
}

/**
 * Quick validation helper
 */
export function validateDocument(
    document: unknown,
    documentType: DocumentType
): ValidationResult {
    return getSchemaValidator().validate(document, documentType);
}

/**
 * Quick auto-detect validation helper
 */
export function validateDocumentAuto(document: unknown): ValidationResult {
    return getSchemaValidator().validateAuto(document);
}
