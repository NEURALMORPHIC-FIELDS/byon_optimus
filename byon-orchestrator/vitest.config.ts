/**
 * Vitest Configuration for BYON Orchestrator
 * ==========================================
 *
 * Test configuration for unit, integration, and security tests.
 *
 * Patent: EP25216372.0 - OmniVault - Vasile Lucian Borbeleac
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
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
