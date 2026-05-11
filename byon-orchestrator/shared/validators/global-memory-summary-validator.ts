/**
 * GlobalMemorySummary Validator
 * =============================
 *
 * Validator pentru documente GlobalMemorySummary din Global Memory Vitalizer.
 * Folosește Ajv cu format: date-time pentru validare strictă.
 */

import AjvModule, { ErrorObject } from "ajv";
import addFormatsModule from "ajv-formats";
import * as fs from "fs";

// ESM compatibility
const Ajv = (AjvModule as any).default || AjvModule;
const addFormats = (addFormatsModule as any).default || addFormatsModule;

// ============================================================================
// TYPES
// ============================================================================

export interface ValidationResult {
    ok: boolean;
    errors: string[];
}

export interface AttractorRef {
    attractor_id: string;
    score: number;
}

export interface DomainWeight {
    domain: string;
    weight: number;
}

export interface StagnantThread {
    label: string;
    days_inactive: number;
}

export interface GlobalMemorySummary {
    document_type: "GLOBAL_MEMORY_SUMMARY";
    document_version: "1.0";
    timestamp: string;
    system_coherence: number;
    entropy_level: "stable" | "rising" | "fragmented";
    active_attractors: AttractorRef[];
    dominant_domains: DomainWeight[];
    stagnant_threads: StagnantThread[];
}

// ============================================================================
// SCHEMA (inline for portability)
// ============================================================================

const GLOBAL_MEMORY_SUMMARY_SCHEMA = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "byon://schema/global-memory-summary/v1",
    title: "GlobalMemorySummary v1",
    type: "object",
    additionalProperties: false,
    required: [
        "document_type",
        "document_version",
        "timestamp",
        "system_coherence",
        "entropy_level",
        "active_attractors",
        "dominant_domains",
        "stagnant_threads"
    ],
    properties: {
        document_type: { type: "string", const: "GLOBAL_MEMORY_SUMMARY" },
        document_version: { type: "string", const: "1.0" },
        timestamp: { type: "string", format: "date-time" },
        system_coherence: { type: "number", minimum: 0, maximum: 1 },
        entropy_level: { type: "string", enum: ["stable", "rising", "fragmented"] },
        active_attractors: {
            type: "array",
            minItems: 0,
            maxItems: 128,
            items: {
                type: "object",
                additionalProperties: false,
                required: ["attractor_id", "score"],
                properties: {
                    attractor_id: { type: "string", minLength: 16, maxLength: 128 },
                    score: { type: "number", minimum: 0, maximum: 1 }
                }
            }
        },
        dominant_domains: {
            type: "array",
            minItems: 0,
            maxItems: 32,
            items: {
                type: "object",
                additionalProperties: false,
                required: ["domain", "weight"],
                properties: {
                    domain: { type: "string", minLength: 1, maxLength: 64 },
                    weight: { type: "number", minimum: 0, maximum: 1 }
                }
            }
        },
        stagnant_threads: {
            type: "array",
            minItems: 0,
            maxItems: 128,
            items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "days_inactive"],
                properties: {
                    label: { type: "string", minLength: 1, maxLength: 200 },
                    days_inactive: { type: "integer", minimum: 0, maximum: 36500 }
                }
            }
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
 * Validate a GlobalMemorySummary document
 */
export function validateGlobalMemorySummary(doc: unknown): ValidationResult {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);

    const validate = ajv.compile(GLOBAL_MEMORY_SUMMARY_SCHEMA);
    const ok = validate(doc) as boolean;

    return {
        ok,
        errors: ok ? [] : formatErrors(validate.errors)
    };
}

/**
 * Validate a GlobalMemorySummary from file
 */
export function validateGlobalMemorySummaryFile(filePath: string): ValidationResult {
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const doc = JSON.parse(content);
        return validateGlobalMemorySummary(doc);
    } catch (e) {
        return {
            ok: false,
            errors: [`Failed to read/parse file: ${e instanceof Error ? e.message : String(e)}`]
        };
    }
}

/**
 * Type guard for GlobalMemorySummary
 */
export function isGlobalMemorySummary(doc: unknown): doc is GlobalMemorySummary {
    return validateGlobalMemorySummary(doc).ok;
}

// ============================================================================
// CLI
// ============================================================================

export function main(): void {
    const args = process.argv.slice(2);
    const filePath = args[0];

    if (!filePath) {
        console.log("Usage: global-memory-summary-validator <file.json>");
        process.exit(1);
    }

    const result = validateGlobalMemorySummaryFile(filePath);

    if (result.ok) {
        console.log("✅ Valid GlobalMemorySummary document");
        process.exit(0);
    } else {
        console.log("❌ Invalid GlobalMemorySummary document:");
        result.errors.forEach(e => console.log(`   ${e}`));
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
