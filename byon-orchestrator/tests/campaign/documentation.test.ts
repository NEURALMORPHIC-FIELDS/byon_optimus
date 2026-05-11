/**
 * Usage Test Campaign — Domain 7: Documentation & Reporting
 * ===========================================================
 * TC-079 through TC-083
 *
 * Validates manifest generation: component inventory, naming conventions,
 * gitignored file reporting, UI metadata, and security section.
 *
 * Patent: EP25216372.0 — Vasile Lucian Borbeleac
 */

import { describe, it, expect, beforeAll } from "vitest";
import { generateManifest } from "../../src/manifest/project-manifest.js";
import type { ProjectManifest } from "../../src/manifest/manifest-types.js";
import * as path from "node:path";

// ============================================================================
// TESTS
// ============================================================================

describe("Campaign: Documentation & Reporting", () => {
    let manifest: ProjectManifest;

    // Generate manifest once for all tests — baseDir is the repo root
    const repoRoot = process.cwd().replace(/\\/g, "/").replace(/\/byon-orchestrator$/, "");

    beforeAll(() => {
        manifest = generateManifest(repoRoot);
    });

    it("TC-079: Manifest contains all 16 components", () => {
        expect(manifest.components).toBeDefined();
        expect(manifest.components.length).toBe(16);

        // Spot-check key components
        const names = manifest.components.map(c => c.name);
        expect(names).toContain("Worker Agent");
        expect(names).toContain("Auditor Agent");
        expect(names).toContain("Executor Agent");
        expect(names).toContain("OpenClaw Gateway");
        expect(names).toContain("WFP Sentinel Bridge");
        expect(names).toContain("Risk Assessment Engine");
    });

    it("TC-080: Manifest contains naming conventions for sentinel, gmv, ui, approval", () => {
        const conventions = manifest.naming_conventions;
        expect(conventions).toBeDefined();
        expect(conventions).toHaveProperty("sentinel");
        expect(conventions).toHaveProperty("gmv");
        expect(conventions).toHaveProperty("ui");
        expect(conventions).toHaveProperty("approval");

        // Verify each convention has required fields
        for (const key of ["sentinel", "gmv", "ui", "approval"]) {
            const conv = conventions[key];
            expect(conv.concept).toBeDefined();
            expect(conv.search_terms.length).toBeGreaterThan(0);
            expect(conv.actual_directory).toBeDefined();
            expect(conv.actual_file_patterns.length).toBeGreaterThan(0);
        }
    });

    it("TC-081: Manifest reports gitignored file existence (boolean only, no contents)", () => {
        const gitignored = manifest.gitignored_present;
        expect(gitignored).toBeDefined();
        expect(gitignored.length).toBeGreaterThan(0);

        for (const entry of gitignored) {
            expect(entry.path).toBeDefined();
            expect(entry.type).toMatch(/^(file|directory)$/);
            expect(entry.description).toBeDefined();
            expect(typeof entry.exists).toBe("boolean");
            // Verify NO file contents are exposed
            expect(entry).not.toHaveProperty("content");
            expect(entry).not.toHaveProperty("data");
        }
    });

    it("TC-082: Manifest UI section identifies Lit framework and /optimus route", () => {
        const ui = manifest.ui;
        expect(ui).toBeDefined();
        expect(ui.framework).toBe("Lit");
        expect(ui.canonical_route).toBe("/optimus");
        expect(ui.build_tool).toBe("Vite");
        expect(ui.canonical_component).toContain("byon-dashboard.ts");
        expect(ui.obsolete_files.length).toBeGreaterThan(0);
    });

    it("TC-083: Manifest security section reports Ed25519, HMAC, CORS, rate limiting", () => {
        const sec = manifest.security;
        expect(sec).toBeDefined();
        expect(sec.signing_algorithm).toContain("Ed25519");
        expect(sec.auth_mechanism).toContain("HMAC");
        expect(sec.cors_mode).toBeDefined();
        expect(sec.rate_limiting).toBeDefined();
        expect(sec.rate_limiting.general).toBeGreaterThan(0);
        expect(sec.rate_limiting.approval).toBeGreaterThan(0);
        expect(sec.nonce_replay_protection).toBe(true);
        expect(sec.ttl_by_risk).toBeDefined();
    });
});
