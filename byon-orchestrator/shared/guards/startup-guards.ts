/**
 * BYON Startup Guards
 * ====================
 *
 * Guards de validare la pornirea orchestratorului BYON.
 * Aceste verificări TREBUIE să treacă înainte ca sistemul să pornească.
 *
 * Guards:
 * 1. Memory Service - HARD STOP dacă nu e disponibil
 * 2. Execution Plan - HARD STOP dacă e invalid
 * 3. Progression File - SAFE MODE dacă e invalid (read-only)
 *
 * Exit Codes:
 * - 0: All guards passed
 * - 10: Memory service unavailable
 * - 11: Execution plan invalid
 * - 12: Progression file invalid (warning only if --allow-safe-mode)
 */

import * as fs from "fs";
import { validateExecutionPlan } from "../validators/execution-plan-validator.js";

// ============================================================================
// TYPES
// ============================================================================

export interface GuardResult {
    guard: string;
    passed: boolean;
    message: string;
    details?: string[];
    exitCode?: number;
}

export interface StartupGuardsResult {
    allPassed: boolean;
    safeMode: boolean;
    guards: GuardResult[];
    errors: string[];
    warnings: string[];
}

export interface StartupGuardsOptions {
    executionPlanPath?: string;
    progressionPath?: string;
    memoryServiceUrl?: string;
    allowSafeMode?: boolean;
    timeout?: number;
}

// ============================================================================
// GUARD: MEMORY SERVICE
// ============================================================================

/**
 * Check if the memory service is available
 * HARD STOP if not available
 */
async function guardMemoryService(url: string, timeout: number): Promise<GuardResult> {
    const guard = "MEMORY_SERVICE";

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "ping" }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json() as { success?: boolean; result?: { status?: string } };
            if (data.success) {
                return {
                    guard,
                    passed: true,
                    message: `Memory service available at ${url}`,
                    details: [`Status: ${data.result?.status || "ok"}`]
                };
            }
        }

        return {
            guard,
            passed: false,
            message: `Memory service returned error at ${url}`,
            exitCode: 10
        };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
            guard,
            passed: false,
            message: `Memory service unavailable at ${url}`,
            details: [errorMsg],
            exitCode: 10
        };
    }
}

// ============================================================================
// GUARD: EXECUTION PLAN
// ============================================================================

/**
 * Validate the execution plan file
 * HARD STOP if invalid
 */
function guardExecutionPlan(filePath: string): GuardResult {
    const guard = "EXECUTION_PLAN";

    if (!fs.existsSync(filePath)) {
        return {
            guard,
            passed: false,
            message: `Execution plan not found: ${filePath}`,
            exitCode: 11
        };
    }

    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const doc = JSON.parse(content);
        const result = validateExecutionPlan(doc);

        if (result.ok) {
            return {
                guard,
                passed: true,
                message: `Execution plan valid: ${result.stats.total_phases} phases, ${result.stats.total_tasks} tasks`,
                details: result.warnings.map(w => `[WARN] ${w.code}: ${w.message}`)
            };
        } else {
            return {
                guard,
                passed: false,
                message: `Execution plan invalid: ${result.errors.length} error(s)`,
                details: result.errors.map(e => `[ERROR] ${e.code}: ${e.message}`),
                exitCode: 11
            };
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
            guard,
            passed: false,
            message: `Failed to parse execution plan: ${filePath}`,
            details: [errorMsg],
            exitCode: 11
        };
    }
}

// ============================================================================
// GUARD: PROGRESSION FILE
// ============================================================================

/**
 * Validate the progression tracking file
 * SAFE MODE (read-only) if invalid, but allows startup
 */
function guardProgressionFile(filePath: string): GuardResult {
    const guard = "PROGRESSION_FILE";

    if (!fs.existsSync(filePath)) {
        return {
            guard,
            passed: false,
            message: `Progression file not found: ${filePath}`,
            details: ["System will start in SAFE MODE (no progress tracking)"],
            exitCode: 12
        };
    }

    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const doc = JSON.parse(content);

        // Basic structure validation
        const requiredFields = ["meta", "project_context", "current_state", "phases_progress"];
        const missingFields = requiredFields.filter(f => !(f in doc));

        if (missingFields.length > 0) {
            return {
                guard,
                passed: false,
                message: `Progression file missing required fields`,
                details: [`Missing: ${missingFields.join(", ")}`, "System will start in SAFE MODE"],
                exitCode: 12
            };
        }

        // Check document_type if present
        if (doc.meta?.document_type && doc.meta.document_type !== "BYON_PROGRESSION") {
            return {
                guard,
                passed: false,
                message: `Invalid document_type in progression file`,
                details: [`Expected: BYON_PROGRESSION, Got: ${doc.meta.document_type}`],
                exitCode: 12
            };
        }

        return {
            guard,
            passed: true,
            message: `Progression file valid`,
            details: [
                `Current phase: ${doc.current_state?.phase || "unknown"}`,
                `Status: ${doc.current_state?.status || "unknown"}`
            ]
        };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
            guard,
            passed: false,
            message: `Failed to parse progression file: ${filePath}`,
            details: [errorMsg, "System will start in SAFE MODE"],
            exitCode: 12
        };
    }
}

// ============================================================================
// MAIN GUARD RUNNER
// ============================================================================

const DEFAULT_OPTIONS: StartupGuardsOptions = {
    executionPlanPath: "./BYON_EXECUTION_PLAN.json",
    progressionPath: "./BYON_PROGRESSION.json",
    memoryServiceUrl: process.env['MEMORY_SERVICE_URL'] || "http://localhost:8000",
    allowSafeMode: false,
    timeout: 5000
};

/**
 * Run all startup guards
 */
export async function runStartupGuards(options: StartupGuardsOptions = {}): Promise<StartupGuardsResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const guards: GuardResult[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    let safeMode = false;

    console.log("\n🛡️  BYON Startup Guards\n");

    // Guard 1: Memory Service
    console.log("   [1/3] Checking memory service...");
    const memoryResult = await guardMemoryService(opts.memoryServiceUrl!, opts.timeout!);
    guards.push(memoryResult);

    if (memoryResult.passed) {
        console.log(`   ✅ ${memoryResult.message}`);
    } else {
        console.log(`   ❌ ${memoryResult.message}`);
        errors.push(`MEMORY_SERVICE: ${memoryResult.message}`);
    }

    // Guard 2: Execution Plan
    console.log("   [2/3] Validating execution plan...");
    const planResult = guardExecutionPlan(opts.executionPlanPath!);
    guards.push(planResult);

    if (planResult.passed) {
        console.log(`   ✅ ${planResult.message}`);
        if (planResult.details?.length) {
            planResult.details.forEach(d => {
                if (d.startsWith("[WARN]")) {
                    warnings.push(d);
                }
            });
        }
    } else {
        console.log(`   ❌ ${planResult.message}`);
        errors.push(`EXECUTION_PLAN: ${planResult.message}`);
    }

    // Guard 3: Progression File
    console.log("   [3/3] Validating progression file...");
    const progressResult = guardProgressionFile(opts.progressionPath!);
    guards.push(progressResult);

    if (progressResult.passed) {
        console.log(`   ✅ ${progressResult.message}`);
    } else {
        console.log(`   ⚠️  ${progressResult.message}`);
        if (opts.allowSafeMode) {
            safeMode = true;
            warnings.push(`PROGRESSION_FILE: ${progressResult.message} (SAFE MODE enabled)`);
        } else {
            errors.push(`PROGRESSION_FILE: ${progressResult.message}`);
        }
    }

    // Calculate overall result
    const criticalGuardsFailed = guards
        .filter(g => g.guard !== "PROGRESSION_FILE")
        .some(g => !g.passed);

    const allPassed = !criticalGuardsFailed && (progressResult.passed || Boolean(opts.allowSafeMode));

    // Summary
    console.log("\n" + "─".repeat(50));
    if (allPassed && !safeMode) {
        console.log("✅ All guards passed - System ready to start\n");
    } else if (allPassed && safeMode) {
        console.log("⚠️  Guards passed with SAFE MODE - Progress tracking disabled\n");
    } else {
        console.log("❌ Startup blocked - Critical guards failed\n");
        errors.forEach(e => console.log(`   • ${e}`));
    }

    return {
        allPassed,
        safeMode,
        guards,
        errors,
        warnings
    };
}

// ============================================================================
// GUARD ENFORCEMENT
// ============================================================================

/**
 * Enforce startup guards - exits process if critical guards fail
 */
export async function enforceStartupGuards(options: StartupGuardsOptions = {}): Promise<{ safeMode: boolean }> {
    const result = await runStartupGuards(options);

    if (!result.allPassed) {
        // Find the first failed critical guard's exit code
        const failedGuard = result.guards.find(g => !g.passed && g.guard !== "PROGRESSION_FILE");
        const exitCode = failedGuard?.exitCode || 1;

        console.error("\n🚫 BYON Orchestrator cannot start - critical guards failed\n");
        process.exit(exitCode);
    }

    return { safeMode: result.safeMode };
}

// ============================================================================
// CLI
// ============================================================================

export function main(): void {
    const args = process.argv.slice(2);

    const options: StartupGuardsOptions = {
        executionPlanPath: args.find(a => a.startsWith("--plan="))?.split("=")[1] || "./BYON_EXECUTION_PLAN.json",
        progressionPath: args.find(a => a.startsWith("--progression="))?.split("=")[1] || "./BYON_PROGRESSION.json",
        memoryServiceUrl: args.find(a => a.startsWith("--memory-url="))?.split("=")[1] || process.env['MEMORY_SERVICE_URL'] || "http://localhost:8000",
        allowSafeMode: args.includes("--allow-safe-mode"),
        timeout: parseInt(args.find(a => a.startsWith("--timeout="))?.split("=")[1] || "5000", 10)
    };

    runStartupGuards(options).then(result => {
        if (!result.allPassed) {
            const failedGuard = result.guards.find(g => !g.passed && g.guard !== "PROGRESSION_FILE");
            process.exit(failedGuard?.exitCode || 1);
        } else if (result.safeMode) {
            process.exit(2);
        } else {
            process.exit(0);
        }
    }).catch(error => {
        console.error("Startup guards failed with error:", error);
        process.exit(1);
    });
}

if (require.main === module) {
    main();
}
