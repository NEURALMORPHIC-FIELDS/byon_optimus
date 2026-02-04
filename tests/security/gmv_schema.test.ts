/**
 * GMV Schema Tests
 * =================
 *
 * Teste pentru validarea schemelor Attractor și GlobalMemorySummary.
 * Verifică că documentele valide trec și cele invalide sunt respinse.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Import validators
import { validateAttractor } from "../../byon-orchestrator/shared/validators/attractor-validator";
import { validateGlobalMemorySummary } from "../../byon-orchestrator/shared/validators/global-memory-summary-validator";

// ============================================================================
// TEST DATA
// ============================================================================

const FIXTURES_PATH = path.join(__dirname, "../fixtures/gmv");

function loadFixture(filename: string): unknown {
    const filePath = path.join(FIXTURES_PATH, filename);
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
}

// ============================================================================
// ATTRACTOR TESTS
// ============================================================================

describe("Attractor Schema Validation", () => {
    it("should validate a correct Attractor document", () => {
        const attractor = loadFixture("attractor.sample.json");
        const result = validateAttractor(attractor);

        expect(result.ok).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("should reject an invalid Attractor document", () => {
        const invalid = loadFixture("invalid_attractor.sample.json");
        const result = validateAttractor(invalid);

        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should reject Attractor with missing required fields", () => {
        const missing = {
            document_type: "ATTRACTOR",
            document_version: "1.0",
            // Missing: attractor_id, label, support, score, last_activity, ctx_ids, domains
        };

        const result = validateAttractor(missing);

        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should reject Attractor with wrong document_type", () => {
        const attractor = loadFixture("attractor.sample.json") as Record<string, unknown>;
        attractor.document_type = "WRONG_TYPE";

        const result = validateAttractor(attractor);

        expect(result.ok).toBe(false);
    });

    it("should reject Attractor with score > 1", () => {
        const attractor = loadFixture("attractor.sample.json") as Record<string, unknown>;
        attractor.score = 1.5;

        const result = validateAttractor(attractor);

        expect(result.ok).toBe(false);
    });

    it("should reject Attractor with negative support", () => {
        const attractor = loadFixture("attractor.sample.json") as Record<string, unknown>;
        attractor.support = -10;

        const result = validateAttractor(attractor);

        expect(result.ok).toBe(false);
    });

    it("should reject Attractor with short attractor_id", () => {
        const attractor = loadFixture("attractor.sample.json") as Record<string, unknown>;
        attractor.attractor_id = "short";

        const result = validateAttractor(attractor);

        expect(result.ok).toBe(false);
    });

    it("should accept Attractor without optional tags", () => {
        const attractor = loadFixture("attractor.sample.json") as Record<string, unknown>;
        delete attractor.tags;

        const result = validateAttractor(attractor);

        expect(result.ok).toBe(true);
    });
});

// ============================================================================
// GLOBAL MEMORY SUMMARY TESTS
// ============================================================================

describe("GlobalMemorySummary Schema Validation", () => {
    it("should validate a correct GlobalMemorySummary document", () => {
        const summary = loadFixture("global_memory_summary.sample.json");
        const result = validateGlobalMemorySummary(summary);

        expect(result.ok).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("should reject GlobalMemorySummary with missing required fields", () => {
        const missing = {
            document_type: "GLOBAL_MEMORY_SUMMARY",
            document_version: "1.0",
            // Missing: timestamp, system_coherence, entropy_level, active_attractors, dominant_domains, stagnant_threads
        };

        const result = validateGlobalMemorySummary(missing);

        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should reject GlobalMemorySummary with wrong document_type", () => {
        const summary = loadFixture("global_memory_summary.sample.json") as Record<string, unknown>;
        summary.document_type = "WRONG_TYPE";

        const result = validateGlobalMemorySummary(summary);

        expect(result.ok).toBe(false);
    });

    it("should reject GlobalMemorySummary with invalid entropy_level", () => {
        const summary = loadFixture("global_memory_summary.sample.json") as Record<string, unknown>;
        summary.entropy_level = "invalid_level";

        const result = validateGlobalMemorySummary(summary);

        expect(result.ok).toBe(false);
    });

    it("should reject GlobalMemorySummary with coherence > 1", () => {
        const summary = loadFixture("global_memory_summary.sample.json") as Record<string, unknown>;
        summary.system_coherence = 1.5;

        const result = validateGlobalMemorySummary(summary);

        expect(result.ok).toBe(false);
    });

    it("should accept all valid entropy levels", () => {
        const validLevels = ["stable", "rising", "fragmented"];

        for (const level of validLevels) {
            const summary = loadFixture("global_memory_summary.sample.json") as Record<string, unknown>;
            summary.entropy_level = level;

            const result = validateGlobalMemorySummary(summary);

            expect(result.ok).toBe(true);
        }
    });

    it("should reject GlobalMemorySummary with invalid timestamp format", () => {
        const summary = loadFixture("global_memory_summary.sample.json") as Record<string, unknown>;
        summary.timestamp = "not-a-valid-timestamp";

        const result = validateGlobalMemorySummary(summary);

        expect(result.ok).toBe(false);
    });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe("GMV Schema Edge Cases", () => {
    it("should accept empty active_attractors array", () => {
        const summary = loadFixture("global_memory_summary.sample.json") as Record<string, unknown>;
        summary.active_attractors = [];

        const result = validateGlobalMemorySummary(summary);

        expect(result.ok).toBe(true);
    });

    it("should accept empty stagnant_threads array", () => {
        const summary = loadFixture("global_memory_summary.sample.json") as Record<string, unknown>;
        summary.stagnant_threads = [];

        const result = validateGlobalMemorySummary(summary);

        expect(result.ok).toBe(true);
    });

    it("should reject null documents", () => {
        expect(validateAttractor(null).ok).toBe(false);
        expect(validateGlobalMemorySummary(null).ok).toBe(false);
    });

    it("should reject non-object documents", () => {
        expect(validateAttractor("string").ok).toBe(false);
        expect(validateAttractor(123).ok).toBe(false);
        expect(validateAttractor([]).ok).toBe(false);
    });
});
