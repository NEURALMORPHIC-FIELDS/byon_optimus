/**
 * ESLint Flat Config for BYON Orchestrator
 * ESLint v9.x format
 */

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginSecurity from "eslint-plugin-security";
import globals from "globals";

export default tseslint.config(
    // Global ignores
    {
        ignores: ["node_modules/", "dist/", "**/*.js", "!eslint.config.js"]
    },

    // Base ESLint recommended
    eslint.configs.recommended,

    // TypeScript ESLint recommended
    ...tseslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,

    // Security plugin recommended
    pluginSecurity.configs.recommended,

    // Main configuration for TypeScript files
    {
        files: ["src/**/*.ts", "shared/**/*.ts", "byon-config.ts"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                ...globals.node,
                ...globals.es2022
            },
            parserOptions: {
                project: "./tsconfig.json"
            }
        },
        rules: {
            // TypeScript rules
            "@typescript-eslint/no-unused-vars": "error",
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/explicit-function-return-type": "off",
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/await-thenable": "error",
            "@typescript-eslint/no-misused-promises": "error",

            // Security rules (override to warnings where appropriate)
            "security/detect-object-injection": "warn",
            "security/detect-non-literal-regexp": "error",
            "security/detect-eval-with-expression": "error",
            "security/detect-child-process": "warn",
            "security/detect-possible-timing-attacks": "warn",

            // General rules
            "no-console": ["warn", { allow: ["warn", "error"] }],
            "no-debugger": "error",
            "no-eval": "error",
            "no-implied-eval": "error",
            "no-new-func": "error",
            "prefer-const": "error",
            "eqeqeq": ["error", "always"],
            "curly": ["error", "all"],
            "no-var": "error"
        }
    },

    // Test files with relaxed rules
    {
        files: ["**/*.test.ts", "**/*.spec.ts"],
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
            "security/detect-object-injection": "off"
        }
    }
);
