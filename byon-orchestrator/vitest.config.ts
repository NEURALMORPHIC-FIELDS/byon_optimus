/**
 * Vitest Configuration for BYON Orchestrator
 * ==========================================
 *
 * Test configuration for unit, integration, and security tests.
 *
 * Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
 */

import { defineConfig } from "vitest/config";
import * as fs from "node:fs";

/**
 * Strip the leading `#!/usr/bin/env node` shebang from .mjs files before
 * Vite's `vite:import-analysis` plugin parses them. Node strips shebangs
 * natively at runtime, but Vite's import analyser does not, so .mjs scripts
 * that are imported by test files were rejected by Vitest 4 with the very
 * misleading error "SyntaxError: Invalid or unexpected token".
 *
 * This plugin is read-only and test-harness only: it does not modify the
 * files on disk, does not change runtime semantics (Node still strips the
 * shebang exactly as before when the script is executed directly), and does
 * not weaken any test.
 */
const stripShebangPlugin = {
    name: "strip-mjs-shebang",
    enforce: "pre" as const,
    load(id: string) {
        if (!id.endsWith(".mjs")) return null;
        const fsPath = id.split("?")[0];
        try {
            const raw = fs.readFileSync(fsPath, "utf-8");
            if (raw.startsWith("#!")) {
                const newlineIdx = raw.indexOf("\n");
                if (newlineIdx >= 0) {
                    return "//" + raw.slice(2, newlineIdx) + raw.slice(newlineIdx);
                }
            }
        } catch {
            // fall through; let Vite handle the load normally
        }
        return null;
    },
};

export default defineConfig({
    plugins: [stripShebangPlugin],
    test: {
        // Test environment
        environment: "node",

        // Include patterns
        include: [
            "tests/**/*.test.ts",
            "tests/**/*.spec.ts"
        ],

        // Exclude patterns
        exclude: [
            "node_modules",
            "dist"
        ],

        // Coverage configuration
        coverage: {
            provider: "v8",
            reporter: ["text", "json", "html"],
            reportsDirectory: "./coverage",
            include: ["src/**/*.ts"],
            exclude: [
                "src/**/*.d.ts",
                "src/**/index.ts",
                "src/types/**"
            ],
            thresholds: {
                global: {
                    statements: 70,
                    branches: 60,
                    functions: 70,
                    lines: 70
                }
            }
        },

        // Globals
        globals: true,

        // Reporters
        reporters: ["verbose"],

        // Timeout for tests (ms)
        testTimeout: 10000,

        // Timeout for hooks (ms)
        hookTimeout: 10000,

        // Pool options
        pool: "threads",
        poolOptions: {
            threads: {
                singleThread: false
            }
        },

        // Watch mode
        watch: false,

        // Bail on first failure in CI
        bail: process.env.CI ? 1 : 0
    }
});
