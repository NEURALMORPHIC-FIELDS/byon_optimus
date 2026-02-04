/**
 * BYON Execution Plan Validator v2
 * =================================
 *
 * Validează documentele BYON_EXECUTION_PLAN.json
 * Folosit de dezvoltatori pentru verificarea planului de execuție
 *
 * Features:
 * - Schema validation via Ajv
 * - Circular dependency detection
 * - Duplicate phase/task ID detection
 * - Missing dependency detection
 * - Separate ERROR vs WARNING levels
 * - CI-ready exit codes (0=OK, 1=ERROR, 2=WARNING)
 *
 * NU este folosit de agenții runtime - aceștia folosesc protocol validators
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

export type CheckLevel = "error" | "warning";

export interface PlanCheck {
    level: CheckLevel;
    code: string;
    message: string;
    path?: string;
}

export interface PlanValidationStats {
    total_phases: number;
    total_tasks: number;
    pending_tasks: number;
    in_progress_tasks: number;
    done_tasks: number;
    blocked_tasks: number;
    critical_phases: number;
    high_priority_phases: number;
}

export interface PlanValidationResult {
    ok: boolean;
    errors: PlanCheck[];
    warnings: PlanCheck[];
    stats: PlanValidationStats;
}

export interface ExecutionPlanDocument {
    $schema?: string;
    document_type?: string;
    document_version?: string;
    meta: {
        project_name: string;
        version: string;
        created_at: string;
        author: string;
        objective: string;
        patent?: string;
    };
    phases: Array<{
        phase_id: string;
        name: string;
        description: string;
        priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
        duration_estimate?: string;
        depends_on?: string[];
        tasks: Array<{
            task_id: string;
            name: string;
            description: string;
            status: "pending" | "in_progress" | "done" | "blocked";
            [key: string]: unknown;
        }>;
    }>;
    [key: string]: unknown;
}

// ============================================================================
// SCHEMA (inline for portability)
// ============================================================================

const PLAN_SCHEMA = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "byon://schema/execution-plan/v1",
    title: "BYON Execution Plan v1",
    type: "object",
    required: ["meta", "phases"],
    properties: {
        $schema: { type: "string" },
        document_type: { type: "string", const: "BYON_EXECUTION_PLAN" },
        document_version: { type: "string", pattern: "^[0-9]+\\.[0-9]+(\\.[0-9]+)?$" },
        meta: {
            type: "object",
            required: ["project_name", "version", "created_at", "author", "objective"],
            properties: {
                project_name: { type: "string", minLength: 3 },
                version: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
                created_at: { type: "string", format: "date-time" },
                author: { type: "string" },
                objective: { type: "string", minLength: 10 },
                patent: { type: "string" }
            }
        },
        phases: {
            type: "array",
            minItems: 1,
            items: {
                type: "object",
                required: ["phase_id", "name", "description", "priority", "tasks"],
                properties: {
                    phase_id: { type: "string", pattern: "^PHASE_[0-9]+$" },
                    name: { type: "string" },
                    description: { type: "string" },
                    duration_estimate: { type: "string" },
                    priority: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
                    depends_on: { type: "array", items: { type: "string", pattern: "^PHASE_[0-9]+$" } },
                    tasks: {
                        type: "array",
                        minItems: 1,
                        items: {
                            type: "object",
                            required: ["task_id", "name", "description", "status"],
                            additionalProperties: true,
                            properties: {
                                task_id: { type: "string" },
                                name: { type: "string" },
                                description: { type: "string" },
                                status: { type: "string", enum: ["pending", "in_progress", "done", "blocked"] }
                            }
                        }
                    }
                }
            }
        },
        key_technical_decisions: { type: "object" },
        file_structure_target: { type: "object" },
        success_criteria: {
            type: "object",
            properties: {
                functional: { type: "array", items: { type: "string" } },
                performance: { type: "array", items: { type: "string" } },
                security: { type: "array", items: { type: "string" } },
                integration: { type: "array", items: { type: "string" } }
            }
        }
    }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function ajvErrorsToChecks(errs: ErrorObject[] | null | undefined): PlanCheck[] {
    if (!errs?.length) return [];
    return errs.map(e => ({
        level: "error" as CheckLevel,
        code: "SCHEMA_VALIDATION",
        message: e.message || "Schema validation error",
        path: e.instancePath || "(root)"
    }));
}

// ============================================================================
// CUSTOM VALIDATORS
// ============================================================================

/**
 * Check for duplicate phase IDs
 */
function checkDuplicatePhaseIds(phases: ExecutionPlanDocument["phases"]): PlanCheck[] {
    const checks: PlanCheck[] = [];
    const seen = new Map<string, number>();

    for (let i = 0; i < phases.length; i++) {
        const phaseId = phases[i].phase_id;
        if (seen.has(phaseId)) {
            checks.push({
                level: "error",
                code: "DUPLICATE_PHASE_ID",
                message: `Duplicate phase_id "${phaseId}" found at index ${seen.get(phaseId)} and ${i}`,
                path: `/phases/${i}/phase_id`
            });
        } else {
            seen.set(phaseId, i);
        }
    }

    return checks;
}

/**
 * Check for duplicate task IDs within each phase
 */
function checkDuplicateTaskIds(phases: ExecutionPlanDocument["phases"]): PlanCheck[] {
    const checks: PlanCheck[] = [];

    for (let pi = 0; pi < phases.length; pi++) {
        const phase = phases[pi];
        const seen = new Map<string, number>();

        for (let ti = 0; ti < phase.tasks.length; ti++) {
            const taskId = phase.tasks[ti].task_id;
            if (seen.has(taskId)) {
                checks.push({
                    level: "error",
                    code: "DUPLICATE_TASK_ID",
                    message: `Duplicate task_id "${taskId}" in phase "${phase.phase_id}" at index ${seen.get(taskId)} and ${ti}`,
                    path: `/phases/${pi}/tasks/${ti}/task_id`
                });
            } else {
                seen.set(taskId, ti);
            }
        }
    }

    return checks;
}

/**
 * Check for missing dependency references
 */
function checkMissingDependencies(phases: ExecutionPlanDocument["phases"]): PlanCheck[] {
    const checks: PlanCheck[] = [];
    const phaseIds = new Set(phases.map(p => p.phase_id));

    for (let i = 0; i < phases.length; i++) {
        const phase = phases[i];
        for (const dep of phase.depends_on || []) {
            if (!phaseIds.has(dep)) {
                checks.push({
                    level: "error",
                    code: "MISSING_DEPENDENCY",
                    message: `Phase "${phase.phase_id}" depends on non-existent phase "${dep}"`,
                    path: `/phases/${i}/depends_on`
                });
            }
        }
    }

    return checks;
}

/**
 * Detect circular dependencies between phases
 */
function checkCircularDependencies(phases: ExecutionPlanDocument["phases"]): PlanCheck[] {
    const checks: PlanCheck[] = [];

    // Build dependency graph
    const graph = new Map<string, string[]>();
    for (const phase of phases) {
        graph.set(phase.phase_id, phase.depends_on || []);
    }

    // DFS for cycle detection
    const visited = new Set<string>();
    const inStack = new Set<string>();

    function dfs(nodeId: string, path: string[]): boolean {
        if (inStack.has(nodeId)) {
            // Found cycle
            const cycleStart = path.indexOf(nodeId);
            const cycle = [...path.slice(cycleStart), nodeId];
            checks.push({
                level: "error",
                code: "CIRCULAR_DEPENDENCY",
                message: `Circular dependency detected: ${cycle.join(" -> ")}`,
                path: `/phases`
            });
            return true;
        }

        if (visited.has(nodeId)) {
            return false;
        }

        visited.add(nodeId);
        inStack.add(nodeId);

        const deps = graph.get(nodeId) || [];
        for (const dep of deps) {
            if (graph.has(dep)) { // Only check if dep exists (missing deps handled separately)
                dfs(dep, [...path, nodeId]);
            }
        }

        inStack.delete(nodeId);
        return false;
    }

    for (const phase of phases) {
        if (!visited.has(phase.phase_id)) {
            dfs(phase.phase_id, []);
        }
    }

    return checks;
}

// ============================================================================
// PLATFORM CONSTRAINT VALIDATORS
// ============================================================================

/**
 * Check that key_technical_decisions contains required platform constraints
 * This ensures the plan explicitly declares the architectural invariants
 */
function checkPlatformConstraints(doc: ExecutionPlanDocument): PlanCheck[] {
    const checks: PlanCheck[] = [];
    const ktd = doc['key_technical_decisions'] as Record<string, unknown> | undefined;

    if (!ktd) {
        checks.push({
            level: "error",
            code: "MISSING_KEY_TECHNICAL_DECISIONS",
            message: "Missing 'key_technical_decisions' section - required for platform constraints",
            path: "/key_technical_decisions"
        });
        return checks;
    }

    // Check communication_platform constraint
    const commPlatform = ktd['communication_platform'] as { decision?: string } | undefined;
    if (!commPlatform) {
        checks.push({
            level: "error",
            code: "MISSING_COMM_PLATFORM_DECISION",
            message: "Missing 'key_technical_decisions.communication_platform' - required policy constraint",
            path: "/key_technical_decisions/communication_platform"
        });
    } else if (!commPlatform.decision) {
        checks.push({
            level: "error",
            code: "MISSING_COMM_PLATFORM_DECISION_VALUE",
            message: "Missing 'key_technical_decisions.communication_platform.decision' value",
            path: "/key_technical_decisions/communication_platform/decision"
        });
    } else if (!commPlatform.decision.includes("SINGLE communication platform")) {
        checks.push({
            level: "error",
            code: "INVALID_COMM_PLATFORM_DECISION",
            message: `Communication platform decision must include "SINGLE communication platform". Got: "${commPlatform.decision}"`,
            path: "/key_technical_decisions/communication_platform/decision"
        });
    }

    // Check execution_engine constraint
    const execEngine = ktd['execution_engine'] as { decision?: string } | undefined;
    if (!execEngine) {
        checks.push({
            level: "error",
            code: "MISSING_EXEC_ENGINE_DECISION",
            message: "Missing 'key_technical_decisions.execution_engine' - required policy constraint",
            path: "/key_technical_decisions/execution_engine"
        });
    } else if (!execEngine.decision) {
        checks.push({
            level: "error",
            code: "MISSING_EXEC_ENGINE_DECISION_VALUE",
            message: "Missing 'key_technical_decisions.execution_engine.decision' value",
            path: "/key_technical_decisions/execution_engine/decision"
        });
    } else if (!execEngine.decision.includes("SINGLE execution engine")) {
        checks.push({
            level: "error",
            code: "INVALID_EXEC_ENGINE_DECISION",
            message: `Execution engine decision must include "SINGLE execution engine". Got: "${execEngine.decision}"`,
            path: "/key_technical_decisions/execution_engine/decision"
        });
    }

    return checks;
}

/**
 * Check layer monotonicity in architecture_overview
 */
function checkLayerMonotonicity(doc: ExecutionPlanDocument): PlanCheck[]  {
    const checks: PlanCheck[] = [];
    const layers = (doc['architecture_overview'] as any)?.target_state?.layers;

    if (Array.isArray(layers)) {
        let prevLayer = 0;
        for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];
            if (typeof layer.layer === "number") {
                if (layer.layer <= prevLayer) {
                    checks.push({
                        level: "warning",
                        code: "NON_MONOTONIC_LAYER",
                        message: `Layer ${layer.layer} at index ${i} is not monotonically increasing (prev: ${prevLayer})`,
                        path: `/architecture_overview/target_state/layers/${i}/layer`
                    });
                }
                prevLayer = layer.layer;
            }
        }
    }

    return checks;
}

/**
 * Generate warnings for non-critical issues
 */
function generateWarnings(doc: ExecutionPlanDocument): PlanCheck[] {
    const warnings: PlanCheck[] = [];

    // Check for document_type
    if (!doc.document_type) {
        warnings.push({
            level: "warning",
            code: "MISSING_DOCUMENT_TYPE",
            message: "Recommended: add 'document_type: \"BYON_EXECUTION_PLAN\"' for document discrimination",
            path: "/document_type"
        });
    }

    // Check for document_version
    if (!doc.document_version) {
        warnings.push({
            level: "warning",
            code: "MISSING_DOCUMENT_VERSION",
            message: "Recommended: add 'document_version' field for schema versioning",
            path: "/document_version"
        });
    }

    // Check for phases without duration estimates
    for (let i = 0; i < doc.phases.length; i++) {
        const phase = doc.phases[i];
        if (!phase.duration_estimate) {
            warnings.push({
                level: "warning",
                code: "MISSING_DURATION_ESTIMATE",
                message: `Phase "${phase.phase_id}" has no duration_estimate`,
                path: `/phases/${i}/duration_estimate`
            });
        }
    }

    // Check for blocked tasks
    const blockedTasks = doc.phases.flatMap((p) =>
        p.tasks.filter(t => t.status === "blocked").map(t => ({ phase: p.phase_id, task: t.task_id }))
    );
    if (blockedTasks.length > 0) {
        warnings.push({
            level: "warning",
            code: "BLOCKED_TASKS",
            message: `${blockedTasks.length} task(s) are blocked: ${blockedTasks.map(t => `${t.phase}/${t.task}`).join(", ")}`,
            path: "/phases"
        });
    }

    // Add layer monotonicity warnings
    warnings.push(...checkLayerMonotonicity(doc));

    return warnings;
}

/**
 * Calculate statistics from the plan
 */
function calculateStats(doc: ExecutionPlanDocument): PlanValidationStats {
    const allTasks = doc.phases.flatMap(p => p.tasks);

    return {
        total_phases: doc.phases.length,
        total_tasks: allTasks.length,
        pending_tasks: allTasks.filter(t => t.status === "pending").length,
        in_progress_tasks: allTasks.filter(t => t.status === "in_progress").length,
        done_tasks: allTasks.filter(t => t.status === "done").length,
        blocked_tasks: allTasks.filter(t => t.status === "blocked").length,
        critical_phases: doc.phases.filter(p => p.priority === "CRITICAL").length,
        high_priority_phases: doc.phases.filter(p => p.priority === "HIGH").length
    };
}

// ============================================================================
// MAIN VALIDATOR
// ============================================================================

/**
 * Validate a BYON Execution Plan document
 */
export function validateExecutionPlan(planDoc: unknown): PlanValidationResult {
    const errors: PlanCheck[] = [];
    const warnings: PlanCheck[] = [];

    // Basic type check
    if (typeof planDoc !== "object" || planDoc === null) {
        return {
            ok: false,
            errors: [{
                level: "error",
                code: "INVALID_DOCUMENT",
                message: "Document must be a non-null object"
            }],
            warnings: [],
            stats: {
                total_phases: 0, total_tasks: 0, pending_tasks: 0,
                in_progress_tasks: 0, done_tasks: 0, blocked_tasks: 0,
                critical_phases: 0, high_priority_phases: 0
            }
        };
    }

    const doc = planDoc as ExecutionPlanDocument;

    // JSON Schema validation
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);

    try {
        const validate = ajv.compile(PLAN_SCHEMA);
        const valid = validate(planDoc);

        if (!valid) {
            errors.push(...ajvErrorsToChecks(validate.errors));
        }
    } catch (e) {
        warnings.push({
            level: "warning",
            code: "SCHEMA_COMPILE_ERROR",
            message: `Schema compilation warning: ${e instanceof Error ? e.message : String(e)}`
        });
    }

    // Custom validations (only if phases exist)
    if (doc.phases && Array.isArray(doc.phases)) {
        // Error-level checks
        errors.push(...checkDuplicatePhaseIds(doc.phases));
        errors.push(...checkDuplicateTaskIds(doc.phases));
        errors.push(...checkMissingDependencies(doc.phases));
        errors.push(...checkCircularDependencies(doc.phases));

        // Warning-level checks
        warnings.push(...generateWarnings(doc));
    }

    // Platform constraint checks (critical policy validation)
    errors.push(...checkPlatformConstraints(doc));

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        stats: doc.phases ? calculateStats(doc) : {
            total_phases: 0, total_tasks: 0, pending_tasks: 0,
            in_progress_tasks: 0, done_tasks: 0, blocked_tasks: 0,
            critical_phases: 0, high_priority_phases: 0
        }
    };
}

/**
 * Validate the BYON_EXECUTION_PLAN.json file from disk
 */
export function validateExecutionPlanFile(filePath: string): PlanValidationResult {
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const doc = JSON.parse(content);
        return validateExecutionPlan(doc);
    } catch (e) {
        return {
            ok: false,
            errors: [{
                level: "error",
                code: "FILE_READ_ERROR",
                message: `Failed to read/parse file: ${e instanceof Error ? e.message : String(e)}`,
                path: filePath
            }],
            warnings: [],
            stats: {
                total_phases: 0, total_tasks: 0, pending_tasks: 0,
                in_progress_tasks: 0, done_tasks: 0, blocked_tasks: 0,
                critical_phases: 0, high_priority_phases: 0
            }
        };
    }
}

// ============================================================================
// CLI
// ============================================================================

/**
 * CLI entry point for validation
 *
 * Exit codes:
 * - 0: OK (no errors, may have warnings)
 * - 1: ERROR (has errors)
 * - 2: WARNING ONLY (no errors, but has warnings)
 */
export function main(): void {
    const args = process.argv.slice(2);
    const filePath = args[0] || "./BYON_EXECUTION_PLAN.json";
    const verbose = args.includes("--verbose") || args.includes("-v");

    console.log(`\n🔍 BYON Execution Plan Validator v2`);
    console.log(`   File: ${filePath}\n`);

    const result = validateExecutionPlanFile(filePath);

    // Stats
    console.log("📊 Stats:");
    console.log(`   Phases: ${result.stats.total_phases} (${result.stats.critical_phases} critical, ${result.stats.high_priority_phases} high)`);
    console.log(`   Tasks: ${result.stats.total_tasks} total`);
    console.log(`      ├─ pending: ${result.stats.pending_tasks}`);
    console.log(`      ├─ in_progress: ${result.stats.in_progress_tasks}`);
    console.log(`      ├─ done: ${result.stats.done_tasks}`);
    console.log(`      └─ blocked: ${result.stats.blocked_tasks}`);

    // Warnings (show top 5 unless verbose)
    if (result.warnings.length > 0) {
        console.log(`\n⚠️  Warnings (${result.warnings.length}):`);
        const toShow = verbose ? result.warnings : result.warnings.slice(0, 5);
        toShow.forEach(w => {
            console.log(`   [${w.code}] ${w.message}`);
            if (w.path) console.log(`      at: ${w.path}`);
        });
        if (!verbose && result.warnings.length > 5) {
            console.log(`   ... and ${result.warnings.length - 5} more (use --verbose to see all)`);
        }
    }

    // Errors (show top 5 unless verbose)
    if (result.errors.length > 0) {
        console.log(`\n❌ Errors (${result.errors.length}):`);
        const toShow = verbose ? result.errors : result.errors.slice(0, 5);
        toShow.forEach(e => {
            console.log(`   [${e.code}] ${e.message}`);
            if (e.path) console.log(`      at: ${e.path}`);
        });
        if (!verbose && result.errors.length > 5) {
            console.log(`   ... and ${result.errors.length - 5} more (use --verbose to see all)`);
        }
    }

    // Result summary
    console.log("\n" + "─".repeat(50));
    if (result.ok && result.warnings.length === 0) {
        console.log("✅ VALID - No errors or warnings\n");
        process.exit(0);
    } else if (result.ok && result.warnings.length > 0) {
        console.log(`⚠️  VALID with ${result.warnings.length} warning(s)\n`);
        process.exit(2);
    } else {
        console.log(`❌ INVALID - ${result.errors.length} error(s), ${result.warnings.length} warning(s)\n`);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}
