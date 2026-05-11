/**
 * Attractor Validator
 * ===================
 *
 * Validator pentru documente Attractor din Global Memory Vitalizer.
 * Folosește Ajv cu format: date-time pentru validare strictă.
 */

import AjvModule, { ErrorObject } from "ajv";
import addFormatsModule from "ajv-formats";

// ESM compatibility
const Ajv = (AjvModule as any).default || AjvModule;
const addFormats = (addFormatsModule as any).default || addFormatsModule;
import * as fs from "fs";

// ============================================================================
// TYPES
// ============================================================================

export interface ValidationResult {
    ok: boolean;
    errors: string[];
}

export interface Attractor {
    document_type: "ATTRACTOR";
    document_version: "1.0";
    attractor_id: string;
    label: string;
    support: number;
    score: number;
    last_activity: string;
    ctx_ids: number[];
    domains: string[];
    tags?: string[];
}

// ============================================================================
// SCHEMA (inline for portability)
// ============================================================================

const ATTRACTOR_SCHEMA = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "byon://schema/attractor/v1",
    title: "Attractor v1",
    type: "object",
    additionalProperties: false,
    required: [
        "document_type",
        "document_version",
        "attractor_id",
        "label",
        "support",
        "score",
        "last_activity",
        "ctx_ids",
        "domains"
    ],
    properties: {
        document_type: { type: "string", const: "ATTRACTOR" },
        document_version: { type: "string", const: "1.0" },
        attractor_id: { type: "string", minLength: 16, maxLength: 128 },
        label: { type: "string", minLength: 2, maxLength: 200 },
        support: { type: "integer", minimum: 0, maximum: 1000000 },
        score: { type: "number", minimum: 0, maximum: 1 },
        last_activity: { type: "string", format: "date-time" },
        ctx_ids: {
            type: "array",
            minItems: 1,
            maxItems: 2000,
            items: { type: "integer", minimum: 0 }
        },
        domains: {
            type: "array",
            minItems: 0,
            maxItems: 32,
            items: { type: "string", minLength: 1, maxLength: 64 }
        },
        tags: {
            type: "array",
            minItems: 0,
            maxItems: 64,
            items: { type: "string", minLength: 1, maxLength: 64 }
        }
    }
};

// ============================================================================
// HELPERS
// ============================================================================

function formatErrors(errs: ErrorObject[] | null | undefined): string[] {
    if (!errs?.length) return [];
    return errs.map(e => `${e.instancePath || "(root)"}: ${e.message || "schema error"}`);
}

// ============================================================================
// VALIDATOR
// ============================================================================

/**
 * Validate an Attractor document
 */
export function validateAttractor(doc: unknown): ValidationResult {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);

    const validate = ajv.compile(ATTRACTOR_SCHEMA);
    const ok = validate(doc) as boolean;

    return {
        ok,
        errors: ok ? [] : formatErrors(validate.errors)
    };
}

/**
 * Validate an Attractor from file
 */
export function validateAttractorFile(filePath: string): ValidationResult {
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const doc = JSON.parse(content);
        return validateAttractor(doc);
    } catch (e) {
        return {
            ok: false,
            errors: [`Failed to read/parse file: ${e instanceof Error ? e.message : String(e)}`]
        };
    }
}

/**
 * Type guard for Attractor
 */
export function isAttractor(doc: unknown): doc is Attractor {
    return validateAttractor(doc).ok;
}

// ============================================================================
// CLI
// ============================================================================

export function main(): void {
    const args = process.argv.slice(2);
    const filePath = args[0];

    if (!filePath) {
        console.log("Usage: attractor-validator <file.json>");
        process.exit(1);
    }

    const result = validateAttractorFile(filePath);

    if (result.ok) {
        console.log("✅ Valid Attractor document");
        process.exit(0);
    } else {
        console.log("❌ Invalid Attractor document:");
        result.errors.forEach(e => console.log(`   ${e}`));
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
