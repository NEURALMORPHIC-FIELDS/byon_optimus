/**
 * Contextual Capability Archive — unit tests.
 *
 * Covers the 14 acceptance items the operator listed for the v0.7
 * infrastructure layer:
 *   1.  all manifests load
 *   2.  schema is validated
 *   3.  duplicate id is rejected
 *   4.  router selects software_engineer for coding prompts
 *   5.  router selects novelist for fiction prompts
 *   6.  router selects philosopher for ontology / metaethics prompts
 *   7.  router selects domain_analyst for norms / standards / legislation
 *   8.  router can select multiple capabilities (multi-cap plan)
 *   9.  coding prompt surfaces required coding modules
 *   10. missing required modules are reported, not hidden
 *   11. context-state integration does not break v0.6.9.1 (passthrough only)
 *   12. no Level 3 claim anywhere in archive
 *   13. no theta_s / tau_coag modification in router or registry
 *   14. archive is extensible — adding a valid manifest in-memory works
 */

import { describe, it, expect } from "vitest";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
    CapabilityRegistry,
    ManifestValidationError,
    DuplicateCapabilityError,
    validateManifest,
    FORBIDDEN_TOKENS,
} from "../../scripts/lib/capability-registry.mjs";
import {
    routeCapability,
    ROUTER_REASON_CODES,
} from "../../scripts/lib/capability-router.mjs";
import { CapabilityExperienceLog } from "../../scripts/lib/capability-experience-log.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR_ROOT = path.resolve(__dirname, "..", "..");
const CAPS_DIR = path.join(ORCHESTRATOR_ROOT, "config", "capabilities");

const EXPECTED_IDS = [
    "software_engineer", "project_manager", "security_auditor",
    "domain_analyst", "novelist", "philosopher",
    "construction_advisor", "legal_analyst", "pharmacology_safety_analyst",
];

describe("Contextual Capability Archive", () => {
    describe("1. all manifests load", () => {
        it("loads all 9 capability manifests from disk", () => {
            const reg = CapabilityRegistry.fromDirectory(CAPS_DIR);
            expect(reg.size()).toBe(9);
            expect(reg.listIds()).toEqual([...EXPECTED_IDS].sort());
        });

        it("invalid() is empty after a clean load", () => {
            const reg = CapabilityRegistry.fromDirectory(CAPS_DIR);
            expect(reg.invalid()).toEqual([]);
        });
    });

    describe("2. schema is validated", () => {
        it("rejects a manifest missing required fields", () => {
            const reg = new CapabilityRegistry();
            expect(() => reg.register({ id: "bad_one" } as any))
                .toThrow(ManifestValidationError);
        });

        it("rejects a manifest with non-snake-case id", () => {
            const reg = new CapabilityRegistry();
            const bad = makeMinimalManifest({ id: "BadId" });
            expect(() => reg.register(bad)).toThrow(ManifestValidationError);
        });

        it("rejects a manifest with status outside the allowed set", () => {
            const reg = new CapabilityRegistry();
            const bad = makeMinimalManifest({ status: "supreme" });
            expect(() => reg.register(bad)).toThrow(ManifestValidationError);
        });

        it("validateManifest returns problems for non-array array fields", () => {
            const bad = makeMinimalManifest({ activation_keywords: "not an array" as any });
            const problems = validateManifest(bad, "x");
            expect(problems.length).toBeGreaterThan(0);
            expect(problems.some(p => /activation_keywords/.test(p))).toBe(true);
        });
    });

    describe("3. duplicate id is rejected", () => {
        it("two manifests with the same id throw DuplicateCapabilityError", () => {
            const reg = new CapabilityRegistry();
            const a = makeMinimalManifest({ id: "dup_one" });
            const b = makeMinimalManifest({ id: "dup_one" });
            reg.register(a, "<a>");
            expect(() => reg.register(b, "<b>")).toThrow(DuplicateCapabilityError);
        });
    });

    describe("4. router selects software_engineer for coding", () => {
        it("a refactor prompt routes to software_engineer primary", () => {
            const reg = CapabilityRegistry.fromDirectory(CAPS_DIR);
            const plan = routeCapability(
                "Refactor the engine so execution planning is separated from execution. Update tests and the CLI subcommand `workflow plan`.",
                {},
                reg,
            );
            expect(plan.primary_capability).toBe("software_engineer");
        });

        it("a bug-fix prompt routes to software_engineer", () => {
            const reg = CapabilityRegistry.fromDirectory(CAPS_DIR);
            const plan = routeCapability(
                "Find the cause of the regression where a skipped step incorrectly fails downstream, add a regression test, and update CHANGELOG.",
                {},
                reg,
            );
            expect(plan.primary_capability).toBe("software_engineer");
        });
    });

    describe("5. router selects novelist for fiction", () => {
        it("a scene-writing prompt routes to novelist", () => {
            const reg = CapabilityRegistry.fromDirectory(CAPS_DIR);
            const plan = routeCapability(
                "Write a scene where Sara, the archaeologist protagonist of my novel set in Constanța, discovers a Roman artefact in chapter 3.",
                {},
                reg,
            );
            expect(plan.primary_capability).toBe("novelist");
        });
    });

    describe("6. router selects philosopher for ontology / metaethics", () => {
        it("a metaethics prompt routes to philosopher", () => {
            const reg = CapabilityRegistry.fromDirectory(CAPS_DIR);
            const plan = routeCapability(
                "Discuss the ontological status of moral facts: are there mind-independent ethical truths, and what is the epistemic basis for our access to them?",
                {},
                reg,
            );
            expect(plan.primary_capability).toBe("philosopher");
        });
    });

    describe("7. router selects domain_analyst for norms / standards / legislation", () => {
        it("a GDPR / jurisdiction prompt routes to domain_analyst or legal_analyst", () => {
            const reg = CapabilityRegistry.fromDirectory(CAPS_DIR);
            const plan = routeCapability(
                "Confirm the response deadline under GDPR article 17 in the EU jurisdiction and cite the official source. Compare with California (CCPA).",
                {},
                reg,
            );
            // Both are legitimate primaries for this query; either is acceptable.
            expect(["domain_analyst", "legal_analyst"]).toContain(plan.primary_capability);
            // The other one should appear as secondary because both share heavy keyword overlap.
            const both = [plan.primary_capability, ...plan.secondary_capabilities];
            expect(both).toContain("domain_analyst");
        });
    });

    describe("8. router can select multiple capabilities", () => {
        it("a coding+release prompt activates multi-cap (software_engineer primary)", () => {
            const reg = CapabilityRegistry.fromDirectory(CAPS_DIR);
            const plan = routeCapability(
                "Refactor src/policy_engine/engine.py, add unit tests in tests/test_engine.py, run pytest, " +
                "and plan the v0.7 release milestone and ETA.",
                {},
                reg,
            );
            expect(plan.primary_capability).toBe("software_engineer");
            expect(plan.selected_capabilities.length).toBeGreaterThanOrEqual(2);
            expect(plan.selected_capabilities).toContain("project_manager");
            expect(plan.reason_codes.some(r => r.code === ROUTER_REASON_CODES.MULTI_CAPABILITY_SELECTED)).toBe(true);
        });

        it("a security+coding prompt can land both software_engineer and security_auditor", () => {
            const reg = CapabilityRegistry.fromDirectory(CAPS_DIR);
            const plan = routeCapability(
                "Audit src/auth/token_handler.py for secret leakage and add a vulnerability test in tests/test_token_handler.py.",
                {},
                reg,
            );
            // Order may go either way depending on phrasing; both must be selected.
            expect(plan.selected_capabilities).toContain("software_engineer");
            expect(plan.selected_capabilities).toContain("security_auditor");
            expect(plan.reason_codes.some(r => r.code === ROUTER_REASON_CODES.MULTI_CAPABILITY_SELECTED)).toBe(true);
        });
    });

    describe("9. coding prompt surfaces required coding modules", () => {
        it("software_engineer required_modules show up in the activation plan", () => {
            const reg = CapabilityRegistry.fromDirectory(CAPS_DIR);
            const plan = routeCapability(
                "Implement a new function in src/policy_engine/loader.py and add unit tests.",
                {},
                reg,
            );
            expect(plan.primary_capability).toBe("software_engineer");
            // These are the operator-mandated coding modules from the brief.
            const expected = [
                "code_workspace_memory", "exact_file_state_store", "symbol_index",
                "requirements_ledger", "patch_memory", "test_failure_memory",
                "architecture_map", "workspace_diff_guard", "coding_context_builder",
            ];
            for (const m of expected) {
                expect(plan.required_modules).toContain(m);
            }
        });
    });

    describe("10. missing required modules are reported, not hidden", () => {
        it("plan surfaces missing_required_modules for software_engineer", () => {
            const reg = CapabilityRegistry.fromDirectory(CAPS_DIR);
            const plan = routeCapability(
                "Refactor the codebase and add tests.",
                {},
                reg,
            );
            expect(plan.primary_capability).toBe("software_engineer");
            // All 9 required coding modules are currently `planned`, so they must be missing.
            expect(plan.missing_required_modules.length).toBeGreaterThanOrEqual(9);
            // And the reason code must surface it.
            expect(plan.reason_codes.some(r => r.code === ROUTER_REASON_CODES.MISSING_REQUIRED_MODULE)).toBe(true);
        });

        it("registry.missingRequiredModules() returns the same gap list", () => {
            const reg = CapabilityRegistry.fromDirectory(CAPS_DIR);
            const gaps = reg.missingRequiredModules("software_engineer");
            expect(gaps.length).toBeGreaterThanOrEqual(9);
            expect(gaps).toContain("code_workspace_memory");
            expect(gaps).toContain("exact_file_state_store");
        });
    });

    describe("11. context-state integration is passthrough (does not break v0.6.9.1)", () => {
        it("passing a contextual_pathway_state through ctx is preserved, not parsed", () => {
            const reg = CapabilityRegistry.fromDirectory(CAPS_DIR);
            const fakePathwayState = { phase: "warm", drift: { triggered: false } };
            const plan = routeCapability(
                "Refactor the engine",
                { contextual_pathway_state: fakePathwayState },
                reg,
            );
            // The router should not crash when given a pathway state, and the
            // plan must record that it received one.
            expect(plan.input.had_pathway_state).toBe(true);
            // The router must NOT have mutated the input object.
            expect(fakePathwayState).toEqual({ phase: "warm", drift: { triggered: false } });
        });
    });

    describe("12. no Level 3 claim anywhere in archive", () => {
        it("no manifest sets level3_claim=true", async () => {
            const files = (await fsp.readdir(CAPS_DIR)).filter(f => f.endsWith(".json"));
            for (const f of files) {
                const raw = await fsp.readFile(path.join(CAPS_DIR, f), "utf-8");
                const m = JSON.parse(raw);
                expect(m.level3_claim).not.toBe(true);
            }
        });

        it("no manifest contains forbidden tokens", async () => {
            const files = (await fsp.readdir(CAPS_DIR)).filter(f => f.endsWith(".json"));
            for (const f of files) {
                const raw = await fsp.readFile(path.join(CAPS_DIR, f), "utf-8");
                for (const tok of FORBIDDEN_TOKENS) {
                    expect(raw.includes(tok)).toBe(false);
                }
            }
        });
    });

    describe("13. no theta_s / tau_coag modification in router or registry source", () => {
        it("router source does not assign theta_s or tau_coag", async () => {
            const file = path.join(ORCHESTRATOR_ROOT, "scripts", "lib", "capability-router.mjs");
            const src = await fsp.readFile(file, "utf-8");
            expect(/theta_s\s*=/.test(src)).toBe(false);
            expect(/tau_coag\s*=/.test(src)).toBe(false);
        });

        it("registry source does not assign theta_s or tau_coag", async () => {
            const file = path.join(ORCHESTRATOR_ROOT, "scripts", "lib", "capability-registry.mjs");
            const src = await fsp.readFile(file, "utf-8");
            expect(/theta_s\s*=/.test(src)).toBe(false);
            expect(/tau_coag\s*=/.test(src)).toBe(false);
        });
    });

    describe("14. archive is extensible — new manifests are accepted via the same path", () => {
        it("registering a new valid in-memory manifest works", () => {
            const reg = CapabilityRegistry.fromDirectory(CAPS_DIR);
            const before = reg.size();
            reg.register(makeMinimalManifest({ id: "music_composer" }), "<test>");
            expect(reg.size()).toBe(before + 1);
            expect(reg.has("music_composer")).toBe(true);
            expect(reg.get("music_composer")?.id).toBe("music_composer");
        });
    });

    describe("ExperienceLog smoke", () => {
        it("records a routing decision to a per-day jsonl file", async () => {
            const tmp = path.join(ORCHESTRATOR_ROOT, "test-results", "capability-routing-unit-test");
            await fsp.rm(tmp, { recursive: true, force: true });
            const log = new CapabilityExperienceLog({ dir: tmp });
            const reg = CapabilityRegistry.fromDirectory(CAPS_DIR);
            const plan = routeCapability("Refactor the engine", {}, reg);
            const row = log.record({
                prompt_id: "unit-test-0001",
                plan,
                modules_active: ["claude_api_live", "memory_service_live"],
                modules_missing: plan.missing_required_modules,
                verdict: "ROUTER_OK",
            });
            expect(row.primary_capability).toBe("software_engineer");
            const today = log.readDay();
            expect(today.length).toBeGreaterThanOrEqual(1);
            await fsp.rm(tmp, { recursive: true, force: true });
        });
    });
});

// -----------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------

function makeMinimalManifest(overrides: Record<string, unknown> = {}) {
    return {
        id: "test_capability",
        version: "0.1.0",
        status: "active",
        description: "test fixture",
        domains: ["test"],
        intents: ["test"],
        roles: ["tester"],
        activation_keywords: ["foo"],
        negative_keywords: [],
        required_modules: [],
        optional_modules: [],
        memory_routes: [],
        context_builder: "default_context_builder",
        output_contract: "default",
        guards: [],
        experience_log: true,
        ...overrides,
    } as any;
}
