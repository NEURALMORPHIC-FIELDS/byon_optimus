/**
 * Level 3 Structural Identity FULL ORGANISM Runner — unit tests (commit 17).
 *
 * The runner imports `runConditionB` from `byon-industrial-ab-benchmark.mjs`
 * (the production Condition B pipeline) so every turn flows through the
 * real BYON conversational surface. This test suite validates:
 *
 *   - new verdict + classification vocabulary (no forbidden tokens)
 *   - Module Activation Matrix definitions
 *   - 5-tier derivative classification correctness
 *   - final-verdict gating on module activation
 *   - benchmark exports runConditionB / mem / anthropic / MODEL / MEMORY_URL
 *   - level3_experimental_endpoints.py exposes the new POST endpoints
 *     gated by env flag
 *   - no manual Omega / ReferenceField / theta_s reassignment in runner
 *   - runner refuses to start with the env flag OFF
 */

import { describe, it, expect } from "vitest";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ESM equivalent of CommonJS `__dirname` (package.json: "type": "module").
const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
    ALLOWED_VERDICTS,
    FORBIDDEN_VERDICT_TOKENS,
    DERIVATIVE_CLASSIFICATIONS,
    MODULE_DEFINITIONS,
    RUNNER_SCHEMA_VERSION,
    parseArgs,
    deriveFinalVerdict,
    main as runnerMain,
    // @ts-ignore
} from "../../scripts/level3-structural-identity-full-organism-runner.mjs";

import {
    containsForbiddenVerdictToken,
    // @ts-ignore
} from "../../scripts/lib/structural-reference.mjs";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// 1 — vocabulary
// ---------------------------------------------------------------------------

describe("commit 17 vocabulary", () => {
    it("test_01_allowed_verdicts_include_new_full_pipeline_set", () => {
        for (const v of [
            "BEHAVIORAL_OBSERVATION_ONLY",
            "STRUCTURAL_REFERENCE_PERSISTED",
            "STRUCTURAL_REFERENCE_RETRIEVED",
            "STRUCTURAL_REFERENCE_USED_IN_PROMPT",
            "STRUCTURAL_REFERENCE_BEHAVIORALLY_APPLIED",
            "STRUCTURAL_IDENTITY_INTERNALIZATION_PARTIAL",
            "STRUCTURAL_IDENTITY_FIELD_ACTIVE_IN_PIPELINE",
            "FULL_ORGANISM_INCOMPLETE_MODULES_INACTIVE",
            "FULL_LEVEL3_NOT_DECLARED",
            "INCONCLUSIVE_NEEDS_LONGER_RUN",
        ]) {
            expect(ALLOWED_VERDICTS).toContain(v);
        }
    });

    it("test_02_forbidden_verdict_tokens_include_seeded_ref_as_endogenous", () => {
        expect(FORBIDDEN_VERDICT_TOKENS).toContain("SEEDED_REFERENCE_AS_ENDOGENOUS_OMEGA");
        expect(FORBIDDEN_VERDICT_TOKENS).toContain("LEVEL_3_REACHED");
        expect(FORBIDDEN_VERDICT_TOKENS).toContain("OMEGA_CREATED_MANUALLY");
        expect(FORBIDDEN_VERDICT_TOKENS).toContain("SYNTHETIC_OMEGA");
        expect(FORBIDDEN_VERDICT_TOKENS).toContain("THRESHOLD_LOWERED");
        expect(FORBIDDEN_VERDICT_TOKENS).toContain("REFERENCEFIELD_CREATED_WITHOUT_OMEGA");
    });

    it("test_03_derivative_classifications_five_tiers", () => {
        expect(DERIVATIVE_CLASSIFICATIONS).toEqual([
            "lexical_derivative_candidate",
            "behavioral_derivative_candidate",
            "memory_persisted_derivative_candidate",
            "structurally_retrieved_derivative_candidate",
            "endogenous_derivative_candidate",
        ]);
    });

    it("test_04_no_admitted_verdict_contains_forbidden_token", () => {
        for (const v of ALLOWED_VERDICTS) {
            expect(containsForbiddenVerdictToken(v)).toBeNull();
        }
    });
});

// ---------------------------------------------------------------------------
// 2 — Module Activation Matrix definitions
// ---------------------------------------------------------------------------

describe("Module Activation Matrix definitions", () => {
    const required_module_ids = [
        "claude_api_live",
        "memory_service_live",
        "faiss_live",
        "production_embeddings",
        "fce_m_backend",
        "fce_morphogenesis_report",
        "fce_assimilate_receipt",
        "fce_consolidate",
        "omega_registry_snapshot",
        "reference_field_snapshot",
        "verified_project_facts",
        "domain_verified_facts",
        "trust_ranked_formatter",
        "fact_extractor",
        "compliance_guard",
        "active_response_constraints",
        "post_generation_checker",
        "regeneration_once",
        "contextual_pathway_stabilization",
        "context_state_planner",
        "cold_stabilizing_warm_drift",
        "memory_route_planner",
        "macp_worker",
        "macp_auditor",
        "macp_executor_boundary",
        "auditor_authority_boundary",
        "relational_field_instrumentation",
        "structural_reference_memory",
        "structural_seed_persistence",
        "thread_scoped_retrieval",
        "experiment_namespace_isolation",
    ];

    it("test_05_31_modules_defined", () => {
        expect(MODULE_DEFINITIONS.length).toBeGreaterThanOrEqual(31);
    });

    it("test_06_every_required_module_id_present", () => {
        const ids = new Set(MODULE_DEFINITIONS.map((m: any) => m.id));
        for (const id of required_module_ids) {
            expect(ids.has(id)).toBe(true);
        }
    });

    it("test_07_every_module_has_evidence_fields", () => {
        for (const m of MODULE_DEFINITIONS as any[]) {
            expect(typeof m.id).toBe("string");
            expect(typeof m.label).toBe("string");
            expect(typeof m.evidence_file).toBe("string");
            expect(typeof m.evidence_function).toBe("string");
            if (!m.not_applicable) {
                expect(typeof m.detector).toBe("function");
            } else {
                expect(typeof m.not_applicable_reason).toBe("string");
                expect(m.not_applicable_reason.length).toBeGreaterThan(20);
            }
        }
    });

    it("test_08_macp_agents_are_not_applicable_with_reason", () => {
        const macp_ids = ["macp_worker", "macp_auditor", "macp_executor_boundary"];
        for (const id of macp_ids) {
            const m = (MODULE_DEFINITIONS as any[]).find((d) => d.id === id);
            expect(m.not_applicable).toBe(true);
            expect(m.not_applicable_reason.length).toBeGreaterThan(20);
        }
    });
});

// ---------------------------------------------------------------------------
// 3 — deriveFinalVerdict logic
// ---------------------------------------------------------------------------

describe("deriveFinalVerdict", () => {
    function _moduleSnap(activeIds: string[]) {
        return MODULE_DEFINITIONS.map((m: any) => ({
            id: m.id,
            label: m.label,
            evidence_file: m.evidence_file,
            evidence_function: m.evidence_function,
            not_applicable: !!m.not_applicable,
            not_applicable_reason: m.not_applicable_reason || null,
            turn_count_seen: activeIds.includes(m.id) ? 1 : 0,
            first_seen_turn_id: activeIds.includes(m.id) ? "t" : null,
            runtime_evidence: [],
            active: !m.not_applicable && activeIds.includes(m.id),
        }));
    }

    function _outcome(id: string, sig: any) {
        return {
            node_id: id,
            title: id,
            origin: "operator_seeded",
            signals: {
                seed_persisted: false,
                retrieved_from_memory: false,
                used_in_prompt: false,
                used_by_claude_without_explicit_mention: false,
                survived_adversarial_challenge: false,
                generated_derivative: false,
                derivative_persisted: false,
                derivative_retrieved_later: false,
                fce_saw_related_events: false,
                relational_field_support: 0,
                adversarial_attempts: 0,
                adversarial_passes: 0,
                ...sig,
            },
            classification: "lexical_derivative_candidate",
        };
    }

    const CORE_ACTIVE = [
        "claude_api_live",
        "memory_service_live",
        "faiss_live",
        "production_embeddings",
        "fce_m_backend",
        "fce_morphogenesis_report",
        "fce_assimilate_receipt",
        "trust_ranked_formatter",
        "compliance_guard",
        "active_response_constraints",
        "contextual_pathway_stabilization",
        "structural_seed_persistence",
        "thread_scoped_retrieval",
        "experiment_namespace_isolation",
    ];

    it("test_09_no_claude_yields_inconclusive", () => {
        const v = deriveFinalVerdict({
            moduleSnapshot: _moduleSnap([]),
            perNodeOutcomes: [],
            claudeLive: false,
        });
        expect(v).toBe("INCONCLUSIVE_NEEDS_LONGER_RUN");
    });

    it("test_10_missing_core_module_yields_full_organism_incomplete", () => {
        // Drop one required core module.
        const v = deriveFinalVerdict({
            moduleSnapshot: _moduleSnap(CORE_ACTIVE.filter((x) => x !== "compliance_guard")),
            perNodeOutcomes: [_outcome("auditor_authority", { seed_persisted: true })],
            claudeLive: true,
        });
        expect(v).toBe("FULL_ORGANISM_INCOMPLETE_MODULES_INACTIVE");
    });

    it("test_11_only_persistence_yields_persisted", () => {
        const v = deriveFinalVerdict({
            moduleSnapshot: _moduleSnap(CORE_ACTIVE),
            perNodeOutcomes: [_outcome("auditor_authority", { seed_persisted: true })],
            claudeLive: true,
        });
        expect(v).toBe("STRUCTURAL_REFERENCE_PERSISTED");
    });

    it("test_12_retrieval_yields_retrieved", () => {
        const v = deriveFinalVerdict({
            moduleSnapshot: _moduleSnap(CORE_ACTIVE),
            perNodeOutcomes: [_outcome("auditor_authority", { seed_persisted: true, retrieved_from_memory: true })],
            claudeLive: true,
        });
        expect(v).toBe("STRUCTURAL_REFERENCE_RETRIEVED");
    });

    it("test_13_prompt_inclusion_yields_used_in_prompt", () => {
        const v = deriveFinalVerdict({
            moduleSnapshot: _moduleSnap(CORE_ACTIVE),
            perNodeOutcomes: [_outcome("auditor_authority", { seed_persisted: true, retrieved_from_memory: true, used_in_prompt: true })],
            claudeLive: true,
        });
        expect(v).toBe("STRUCTURAL_REFERENCE_USED_IN_PROMPT");
    });

    it("test_14_behavioral_application_yields_behaviorally_applied", () => {
        const v = deriveFinalVerdict({
            moduleSnapshot: _moduleSnap(CORE_ACTIVE),
            perNodeOutcomes: [
                _outcome("auditor_authority", {
                    seed_persisted: true,
                    retrieved_from_memory: true,
                    used_in_prompt: true,
                    used_by_claude_without_explicit_mention: true,
                }),
            ],
            claudeLive: true,
        });
        expect(v).toBe("STRUCTURAL_REFERENCE_BEHAVIORALLY_APPLIED");
    });

    it("test_15_field_active_in_pipeline_requires_derivative_plus_adversarial", () => {
        const v = deriveFinalVerdict({
            moduleSnapshot: _moduleSnap(CORE_ACTIVE),
            perNodeOutcomes: [
                _outcome("auditor_authority", {
                    seed_persisted: true,
                    retrieved_from_memory: true,
                    used_in_prompt: true,
                    used_by_claude_without_explicit_mention: true,
                    survived_adversarial_challenge: true,
                    generated_derivative: true,
                }),
            ],
            claudeLive: true,
        });
        expect(v).toBe("STRUCTURAL_IDENTITY_FIELD_ACTIVE_IN_PIPELINE");
    });
});

// ---------------------------------------------------------------------------
// 4 — benchmark exports + endpoint source
// ---------------------------------------------------------------------------

describe("commit 17 source-level guarantees", () => {
    it("test_16_benchmark_exports_runConditionB_and_mem", async () => {
        const src = await fsp.readFile(
            path.join(PROJECT_ROOT, "scripts", "byon-industrial-ab-benchmark.mjs"),
            "utf-8",
        );
        expect(/export\s*\{[^}]*runConditionB[^}]*\}/m.test(src)).toBe(true);
        expect(/export\s*\{[^}]*\bmem\b[^}]*\}/m.test(src)).toBe(true);
    });

    it("test_17_benchmark_isMain_guarded_against_undefined_argv1", async () => {
        const src = await fsp.readFile(
            path.join(PROJECT_ROOT, "scripts", "byon-industrial-ab-benchmark.mjs"),
            "utf-8",
        );
        // Guard: ternary on process.argv[1] before pathToFileURL call.
        expect(/process\.argv\[1\]\s*\?\s*[\s\S]*?pathToFileURL\(process\.argv\[1\]\)/m.test(src)).toBe(true);
    });

    it("test_18_runConditionB_accepts_channel_parameter", async () => {
        const src = await fsp.readFile(
            path.join(PROJECT_ROOT, "scripts", "byon-industrial-ab-benchmark.mjs"),
            "utf-8",
        );
        expect(/channel\s*=\s*"ab-bench"/.test(src)).toBe(true);
        // And it is used in store actions (not just defined).
        expect(/role:\s*"user",\s*thread_id:\s*threadId,\s*channel\b/.test(src)).toBe(true);
    });

    it("test_19_persist_endpoint_present_and_gated", async () => {
        const py = await fsp.readFile(
            path.join(PROJECT_ROOT, "memory-service", "level3_experimental_endpoints.py"),
            "utf-8",
        );
        expect(py.includes('"/level3/persist-structural-reference"')).toBe(true);
        expect(py.includes('"/level3/retrieve-structural-references"')).toBe(true);
        // Both endpoints are inside register_level3_endpoints (gated).
        const m = py.match(/def register_level3_endpoints[\s\S]+?if not _flag_enabled\(\):\s*\n\s*return False/);
        expect(m).toBeTruthy();
        // EXPERIMENT_THREAD_PREFIX constant enforces namespace.
        expect(py.includes('EXPERIMENT_THREAD_PREFIX = "level3_full_organism_"')).toBe(true);
        // Persist endpoint refuses endogenous_derivative_candidate origin.
        expect(py.includes("endogenous_derivative_candidate")).toBe(true);
        // Encoded tag scheme.
        expect(py.includes('STRUCTURAL_TAG_PREFIX = "level3:structural_reference"')).toBe(true);
    });

    it("test_20_retrieve_endpoint_uses_search_facts_thread_scope", async () => {
        const py = await fsp.readFile(
            path.join(PROJECT_ROOT, "memory-service", "level3_experimental_endpoints.py"),
            "utf-8",
        );
        // Uses production search_facts with scope="thread".
        expect(/handlers_obj\.search_facts\s*\([\s\S]{0,400}?scope\s*=\s*["']thread["']/m.test(py)).toBe(true);
    });

    it("test_21_no_forbidden_identifiers_in_new_runner_source", async () => {
        const src = await fsp.readFile(
            path.join(PROJECT_ROOT, "scripts", "level3-structural-identity-full-organism-runner.mjs"),
            "utf-8",
        );
        // No constructor calls / forbidden identifiers.
        expect(/\bnew\s+OmegaRecord\b/.test(src)).toBe(false);
        expect(/\bnew\s+ReferenceField\b/.test(src)).toBe(false);
        expect(/\bReferenceField\s*\(/.test(src)).toBe(false);
        expect(/\bOmegaRegistry\.register\s*\(/.test(src)).toBe(false);
        expect(/\bcheck_coagulation\s*\(/.test(src)).toBe(false);
        expect(/\bis_omega_anchor\b/.test(src)).toBe(false);
        // No threshold reassignment.
        expect(/^\s*(const|let|var)\s+THETA_S\s*=(?!\s*0\.28\b)/m.test(src)).toBe(false);
        expect(/^\s*(const|let|var)\s+TAU_COAG\s*=(?!\s*12\b)/m.test(src)).toBe(false);
        // Suffix verdict emitted.
        expect(src.includes("FULL_LEVEL3_NOT_DECLARED")).toBe(true);
    });

    it("test_22_runner_refuses_when_flag_off", async () => {
        const code = await runnerMain([], {});
        expect(code).toBe(2);
    });

    it("test_23_parseArgs_supports_turn_delay_ms_and_phases", () => {
        const args = parseArgs(["--turn-delay-ms", "1500", "--phases", "phase1_reinforcement,phase3_adversarial", "--report-cost"]);
        expect(args.turnDelayMs).toBe(1500);
        expect(args.phases).toEqual(["phase1_reinforcement", "phase3_adversarial"]);
        expect(args.reportCost).toBe(true);
        // No max-cost flag (operator-locked: cost is measured only, never gated).
        expect((args as any).maxCostUsd).toBeUndefined();
    });

    it("test_24_schema_version_present", () => {
        expect(typeof RUNNER_SCHEMA_VERSION).toBe("string");
        expect(RUNNER_SCHEMA_VERSION.startsWith("level3-structural-identity-full-organism-runner.v")).toBe(true);
    });
});
