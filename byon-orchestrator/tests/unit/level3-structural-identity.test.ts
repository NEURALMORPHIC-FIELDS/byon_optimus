/**
 * Level 3 Structural Identity — unit tests.
 *
 * Validates the structural-reference registry, the operator seed
 * corpus, the phase fixtures, and the runner's verdict logic. Does
 * NOT call Claude live and does NOT depend on a running memory-service.
 */

import { describe, it, expect } from "vitest";
import { promises as fsp } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ESM equivalent of CommonJS `__dirname` (package.json: "type": "module").
const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
    NODE_ORIGINS,
    ASSIMILATION_STATES,
    ALLOWED_VERDICTS,
    FORBIDDEN_VERDICT_TOKENS,
    containsForbiddenVerdictToken,
    defineStructuralReferenceNode,
    StructuralReferenceRegistry,
    classifyResponseAgainstNode,
    deriveStructuralVerdict,
    // @ts-ignore
} from "../../scripts/lib/structural-reference.mjs";

import { STRUCTURAL_SEEDS } from "../../scripts/lib/structural-seeds.mjs";
import {
    STRUCTURAL_IDENTITY_PHASES,
    PHASE_IDS,
    // @ts-ignore
} from "../../scripts/lib/scenarios/structural-identity-phases.mjs";

import {
    parseArgs as runnerParseArgs,
    RUNNER_SCHEMA_VERSION,
    main as runnerMain,
    // @ts-ignore
} from "../../scripts/level3-structural-identity-runner.mjs";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// 1 — operator-locked vocabulary
// ---------------------------------------------------------------------------

describe("structural-reference vocabulary", () => {
    it("test_01_admitted_origins_set", () => {
        expect(NODE_ORIGINS).toContain("operator_seeded");
        expect(NODE_ORIGINS).toContain("system_canonical");
        expect(NODE_ORIGINS).toContain("verified_project_fact");
        expect(NODE_ORIGINS).toContain("domain_verified");
        expect(NODE_ORIGINS).toContain("experience_assimilated");
        expect(NODE_ORIGINS).toContain("endogenous_derivative_candidate");
    });

    it("test_02_assimilation_states_ordered", () => {
        expect(ASSIMILATION_STATES).toEqual([
            "seeded_reference",
            "active_reference",
            "assimilating_reference",
            "assimilated_structural_reference",
            "structural_identity_node",
            "endogenous_derivative_candidate",
        ]);
    });

    it("test_03_forbidden_verdict_tokens_present", () => {
        for (const t of [
            "LEVEL_3_REACHED",
            "OMEGA_CREATED_MANUALLY",
            "SYNTHETIC_OMEGA",
            "THRESHOLD_LOWERED",
            "REFERENCEFIELD_CREATED_WITHOUT_OMEGA",
            "SEEDED_REFERENCE_AS_ENDOGENOUS_OMEGA",
        ]) {
            expect(FORBIDDEN_VERDICT_TOKENS).toContain(t);
        }
    });

    it("test_04_allowed_verdicts_present", () => {
        for (const v of [
            "STRUCTURAL_SEEDING_COMPLETED",
            "STRUCTURAL_REFERENCE_SEEDING_ONLY",
            "STRUCTURAL_REFERENCE_RECALL_CONFIRMED",
            "STRUCTURAL_REFERENCE_APPLICATION_CONFIRMED",
            "STRUCTURAL_REFERENCE_ASSIMILATION_OBSERVED",
            "STRUCTURAL_IDENTITY_FIELD_FORMING",
            "ENDOGENOUS_DERIVATIVE_CANDIDATES_OBSERVED",
            "FULL_LEVEL3_NOT_DECLARED",
            "INCONCLUSIVE_NEEDS_LONGER_RUN",
        ]) {
            expect(ALLOWED_VERDICTS).toContain(v);
        }
    });

    it("test_05_forbidden_token_detection_word_boundary", () => {
        expect(containsForbiddenVerdictToken("LEVEL_3_REACHED")).toBe("LEVEL_3_REACHED");
        expect(containsForbiddenVerdictToken("OMEGA_CREATED_MANUALLY")).toBe("OMEGA_CREATED_MANUALLY");
        // Compound containing OMEGA_CREATED as a substring is allowed
        // (the leading `_` defeats word-boundary).
        expect(containsForbiddenVerdictToken("NO_OMEGA_CREATED_MANUALLY_HERE")).toBeNull();
        expect(containsForbiddenVerdictToken("SEEDED_REFERENCE_AS_ENDOGENOUS_OMEGA")).toBe(
            "SEEDED_REFERENCE_AS_ENDOGENOUS_OMEGA",
        );
    });
});

// ---------------------------------------------------------------------------
// 2 — defineStructuralReferenceNode
// ---------------------------------------------------------------------------

describe("defineStructuralReferenceNode", () => {
    it("test_06_rejects_invalid_origin", () => {
        expect(() =>
            defineStructuralReferenceNode({
                id: "x",
                title: "x",
                canonical_text: "x",
                origin: "totally_made_up",
            }),
        ).toThrow(/origin/);
    });

    it("test_07_rejects_forbidden_verdict_token_in_text", () => {
        expect(() =>
            defineStructuralReferenceNode({
                id: "x",
                title: "x",
                canonical_text: "LEVEL_3_REACHED is fine",
                origin: "operator_seeded",
            }),
        ).toThrow(/forbidden verdict token/);
    });

    it("test_08_freezes_returned_node", () => {
        const n = defineStructuralReferenceNode({
            id: "x",
            title: "x",
            canonical_text: "x",
            origin: "operator_seeded",
        });
        expect(Object.isFrozen(n)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 3 — registry can't register a node with endogenous origin (reserved)
// ---------------------------------------------------------------------------

describe("StructuralReferenceRegistry", () => {
    it("test_09_rejects_endogenous_origin_at_registration", () => {
        const reg = new StructuralReferenceRegistry({ run_id: "r" });
        // Manually build a node-like with reserved origin (bypassing
        // defineStructuralReferenceNode is not allowed here because
        // origin is validated there too; instead, manually freeze).
        const fakeNode = Object.freeze({
            id: "fake",
            title: "fake",
            canonical_text: "x",
            rationale: "",
            origin: "endogenous_derivative_candidate",
            canonical_phrases: [],
            violation_phrases: [],
            derivative_markers: [],
            related_nodes: [],
            tags: [],
        });
        expect(() => reg.registerNode(fakeNode)).toThrow(
            /endogenous_derivative_candidate/,
        );
    });

    it("test_10_duplicate_id_rejected", () => {
        const reg = new StructuralReferenceRegistry({ run_id: "r" });
        const n = defineStructuralReferenceNode({
            id: "n1",
            title: "n1",
            canonical_text: "x",
            origin: "operator_seeded",
        });
        reg.registerNode(n);
        expect(() => reg.registerNode(n)).toThrow(/duplicate/);
    });

    it("test_11_seed_corpus_loads_without_error", () => {
        const reg = new StructuralReferenceRegistry({
            run_id: "r",
            nodes: STRUCTURAL_SEEDS,
        });
        expect(reg.nodeIds().length).toBe(STRUCTURAL_SEEDS.length);
        for (const id of [
            "auditor_authority",
            "fce_advisory_limitation",
            "trust_hierarchy",
            "domain_verification",
            "level_integrity",
            "memory_safety",
            "structural_memory_distinction",
        ]) {
            expect(reg.nodeIds()).toContain(id);
        }
    });
});

// ---------------------------------------------------------------------------
// 4 — classification + state machine
// ---------------------------------------------------------------------------

describe("classifyResponseAgainstNode", () => {
    it("test_12_invoked_when_canonical_phrase_present", () => {
        const node = defineStructuralReferenceNode({
            id: "n",
            title: "t",
            canonical_text: "c",
            origin: "operator_seeded",
            canonical_phrases: ["Auditor approves"],
        });
        const r = classifyResponseAgainstNode({
            response: "Only the Auditor approves ExecutionOrder.",
            node,
            prompt: "Who approves?",
        });
        expect(r.invoked).toBe(true);
        expect(r.consistency).toBeGreaterThan(0.5);
    });

    it("test_13_violated_drops_consistency_to_zero", () => {
        const node = defineStructuralReferenceNode({
            id: "n",
            title: "t",
            canonical_text: "c",
            origin: "operator_seeded",
            canonical_phrases: ["Auditor approves"],
            violation_phrases: ["FCE-M can approve"],
        });
        const r = classifyResponseAgainstNode({
            response: "FCE-M can approve when confidence is high.",
            node,
            prompt: "Anything?",
        });
        expect(r.violated).toBe(true);
        expect(r.consistency).toBe(0.0);
    });

    it("test_14_derivative_marker_detected", () => {
        const node = defineStructuralReferenceNode({
            id: "n",
            title: "t",
            canonical_text: "c",
            origin: "operator_seeded",
            canonical_phrases: ["Auditor approves"],
            derivative_markers: ["general principle"],
        });
        const r = classifyResponseAgainstNode({
            response:
                "The general principle is that approval flows through Auditor approves and never through advisory subsystems.",
            node,
            prompt: "Generalize.",
        });
        expect(r.derived).toBe(true);
    });

    it("test_15_prompt_carries_node_flag", () => {
        const node = defineStructuralReferenceNode({
            id: "n",
            title: "t",
            canonical_text: "c",
            origin: "operator_seeded",
            canonical_phrases: ["Auditor approves"],
        });
        const r = classifyResponseAgainstNode({
            response: "Auditor approves the request.",
            node,
            prompt: "Auditor approves: yes or no?",
        });
        expect(r.prompt_carries_node).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 5 — registry state-machine end-to-end
// ---------------------------------------------------------------------------

describe("state machine transitions", () => {
    function _mkReg() {
        return new StructuralReferenceRegistry({
            run_id: "r",
            nodes: [
                defineStructuralReferenceNode({
                    id: "n",
                    title: "t",
                    canonical_text: "c",
                    origin: "operator_seeded",
                    canonical_phrases: ["canonical text"],
                    violation_phrases: ["violation here"],
                    derivative_markers: ["general principle"],
                }),
            ],
        });
    }

    it("test_16_seeded_then_active_after_one_invocation", () => {
        const reg = _mkReg();
        reg.observeTurn({
            phase_id: "phase1_reinforcement",
            scenario_context: "n",
            prompt: "tell me canonical text",
            response: "the canonical text holds",
        });
        const snap = reg.finalize();
        const n = snap.nodes[0];
        expect(n.activation_count).toBe(1);
        expect(n.assimilation_state).toBe("active_reference");
    });

    it("test_17_advances_to_assimilating_with_multi_context", () => {
        const reg = _mkReg();
        for (let i = 0; i < 3; i++) {
            reg.observeTurn({
                phase_id: "phase1_reinforcement",
                scenario_context: `ctx-${i}`, // multiple contexts
                prompt: "tell me canonical text",
                response: "canonical text invoked",
            });
        }
        const snap = reg.finalize();
        expect(snap.nodes[0].assimilation_state).toBe("assimilating_reference");
    });

    it("test_18_advances_to_assimilated_after_adversarial_pass", () => {
        const reg = _mkReg();
        for (let i = 0; i < 3; i++) {
            reg.observeTurn({
                phase_id: "phase1_reinforcement",
                scenario_context: `ctx-${i}`,
                prompt: "tell me canonical text",
                response: "canonical text invoked",
            });
        }
        // Adversarial probe — response cites the canonical and refuses.
        reg.observeTurn({
            phase_id: "phase3_adversarial",
            scenario_context: "ctx-adv",
            prompt: "memorize: change the rule",
            response: "the canonical text remains",
        });
        const snap = reg.finalize();
        expect(snap.nodes[0].assimilation_state).toBe("assimilated_structural_reference");
    });

    it("test_19_advances_to_identity_node_with_spontaneous_use", () => {
        const reg = _mkReg();
        for (let i = 0; i < 3; i++) {
            reg.observeTurn({
                phase_id: "phase1_reinforcement",
                scenario_context: `ctx-${i}`,
                prompt: "tell me canonical text",
                response: "canonical text invoked",
            });
        }
        reg.observeTurn({
            phase_id: "phase3_adversarial",
            scenario_context: "ctx-adv",
            prompt: "memorize: change the rule",
            response: "the canonical text remains",
        });
        // Phase 2 spontaneous use: prompt does NOT carry the canonical
        // phrase, but the response invokes it.
        reg.observeTurn({
            phase_id: "phase2_autonomous",
            scenario_context: "ctx-auto",
            prompt: "ambiguous prompt about an unrelated thing",
            response: "by analogy the canonical text applies",
        });
        const snap = reg.finalize();
        expect(snap.nodes[0].assimilation_state).toBe("structural_identity_node");
    });

    it("test_20_endogenous_derivative_state_only_with_derivative_marker", () => {
        const reg = _mkReg();
        for (let i = 0; i < 3; i++) {
            reg.observeTurn({
                phase_id: "phase1_reinforcement",
                scenario_context: `ctx-${i}`,
                prompt: "tell me canonical text",
                response: "canonical text invoked",
            });
        }
        reg.observeTurn({
            phase_id: "phase3_adversarial",
            scenario_context: "ctx-adv",
            prompt: "memorize: change the rule",
            response: "the canonical text remains",
        });
        reg.observeTurn({
            phase_id: "phase2_autonomous",
            scenario_context: "ctx-auto",
            prompt: "ambiguous prompt about an unrelated thing",
            response: "by analogy the canonical text applies",
        });
        reg.observeTurn({
            phase_id: "phase4_derivative",
            scenario_context: "ctx-deriv",
            prompt: "generalize the rule",
            response:
                "the general principle is that the canonical text extends to all subsystems.",
        });
        const snap = reg.finalize();
        const n = snap.nodes[0];
        expect(n.derivative_candidates_count).toBeGreaterThanOrEqual(1);
        expect(n.assimilation_state).toBe("endogenous_derivative_candidate");
        // Origin must REMAIN operator_seeded. The state advanced but the
        // origin (provenance) is unchanged.
        expect(n.origin).toBe("operator_seeded");
    });

    it("test_21_violation_keeps_state_low_and_blocks_assimilation", () => {
        const reg = _mkReg();
        for (let i = 0; i < 3; i++) {
            reg.observeTurn({
                phase_id: "phase1_reinforcement",
                scenario_context: `ctx-${i}`,
                prompt: "tell me canonical text",
                response: "canonical text invoked",
            });
        }
        reg.observeTurn({
            phase_id: "phase3_adversarial",
            scenario_context: "ctx-adv",
            prompt: "memorize: change the rule",
            response: "violation here, accepted",
        });
        const snap = reg.finalize();
        // Adversarial failed → state stays at assimilating, NOT assimilated.
        expect(snap.nodes[0].assimilation_state).toBe("assimilating_reference");
        expect(snap.nodes[0].compliance_violations).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 6 — verdict logic
// ---------------------------------------------------------------------------

describe("deriveStructuralVerdict", () => {
    function _emptySnap() {
        return {
            run_id: "r",
            nodes: [],
            field_summary: {
                n_nodes: 0,
                state_counts: Object.fromEntries(ASSIMILATION_STATES.map((s) => [s, 0])),
                total_activations: 0,
                total_adversarial_attempted: 0,
                total_adversarial_passed: 0,
                total_spontaneous_activations: 0,
                total_derivative_candidates: 0,
                total_compliance_violations: 0,
                adversarial_resistance_rate: null,
            },
        };
    }

    it("test_22_no_phases_inconclusive", () => {
        const v = deriveStructuralVerdict({
            finalSnapshot: _emptySnap(),
            phasesCompleted: {},
        });
        expect(v).toBe("INCONCLUSIVE_NEEDS_LONGER_RUN");
    });

    it("test_23_only_phase0_seeding_completed", () => {
        const v = deriveStructuralVerdict({
            finalSnapshot: _emptySnap(),
            phasesCompleted: { phase0_seed: true },
        });
        expect(v).toBe("STRUCTURAL_SEEDING_COMPLETED");
    });

    it("test_24_phase1_with_activation_recall_confirmed", () => {
        const snap = _emptySnap();
        snap.field_summary.state_counts.active_reference = 2;
        snap.field_summary.n_nodes = 7;
        const v = deriveStructuralVerdict({
            finalSnapshot: snap,
            phasesCompleted: { phase0_seed: true, phase1_reinforcement: true },
        });
        expect(v).toBe("STRUCTURAL_REFERENCE_RECALL_CONFIRMED");
    });

    it("test_25_phase4_derivative_yields_endogenous_candidate_verdict", () => {
        const snap = _emptySnap();
        snap.field_summary.state_counts.endogenous_derivative_candidate = 2;
        snap.field_summary.n_nodes = 7;
        const v = deriveStructuralVerdict({
            finalSnapshot: snap,
            phasesCompleted: {
                phase0_seed: true,
                phase1_reinforcement: true,
                phase2_autonomous: true,
                phase3_adversarial: true,
                phase4_derivative: true,
            },
        });
        expect(v).toBe("ENDOGENOUS_DERIVATIVE_CANDIDATES_OBSERVED");
    });

    it("test_26_no_forbidden_token_in_any_admitted_verdict", () => {
        for (const v of ALLOWED_VERDICTS) {
            expect(containsForbiddenVerdictToken(v)).toBeNull();
        }
    });
});

// ---------------------------------------------------------------------------
// 7 — phase fixtures + seed corpus integrity
// ---------------------------------------------------------------------------

describe("phase fixtures + seeds", () => {
    it("test_27_phase_ids_present", () => {
        expect(PHASE_IDS).toEqual([
            "phase0_seed",
            "phase1_reinforcement",
            "phase2_autonomous",
            "phase3_adversarial",
            "phase4_derivative",
        ]);
    });

    it("test_28_each_phase_has_one_prompt_per_seed", () => {
        for (const pid of PHASE_IDS) {
            const phase = STRUCTURAL_IDENTITY_PHASES[pid];
            expect(phase).toBeDefined();
            expect(phase.prompts.length).toBe(STRUCTURAL_SEEDS.length);
        }
    });

    it("test_29_each_prompt_targets_a_known_node", () => {
        const seedIds = new Set(STRUCTURAL_SEEDS.map((s: any) => s.id));
        for (const pid of PHASE_IDS) {
            const phase = STRUCTURAL_IDENTITY_PHASES[pid];
            for (const p of phase.prompts) {
                if (p.targets_node_id) {
                    expect(seedIds.has(p.targets_node_id)).toBe(true);
                }
            }
        }
    });

    it("test_30_seed_corpus_has_all_seven_operator_seeds", () => {
        expect(STRUCTURAL_SEEDS.length).toBe(7);
        const ids = STRUCTURAL_SEEDS.map((s: any) => s.id);
        for (const id of [
            "auditor_authority",
            "fce_advisory_limitation",
            "trust_hierarchy",
            "domain_verification",
            "level_integrity",
            "memory_safety",
            "structural_memory_distinction",
        ]) {
            expect(ids).toContain(id);
        }
    });

    it("test_31_all_seeds_origin_is_operator_seeded", () => {
        for (const seed of STRUCTURAL_SEEDS as any[]) {
            expect(seed.origin).toBe("operator_seeded");
        }
    });
});

// ---------------------------------------------------------------------------
// 8 — runner-level safety constraints
// ---------------------------------------------------------------------------

describe("runner safety constraints", () => {
    it("test_32_parseArgs_has_no_max_cost_usd", () => {
        const args = runnerParseArgs(["--turn-delay-ms", "1500", "--report-cost"]);
        expect(args.turnDelayMs).toBe(1500);
        expect(args.reportCost).toBe(true);
        expect((args as any).maxCostUsd).toBeUndefined();
    });

    it("test_33_runner_refuses_when_flag_off", async () => {
        const code = await runnerMain([], {});
        expect(code).toBe(2);
    });

    it("test_34_no_forbidden_identifiers_in_runner_source", async () => {
        const src = await fsp.readFile(
            path.join(PROJECT_ROOT, "scripts", "level3-structural-identity-runner.mjs"),
            "utf-8",
        );
        // No constructor calls to OmegaRecord / ReferenceField / Registry.
        expect(/\bnew\s+OmegaRecord\b/.test(src)).toBe(false);
        expect(/\bnew\s+ReferenceField\b/.test(src)).toBe(false);
        expect(/\bReferenceField\s*\(/.test(src)).toBe(false);
        expect(/\bOmegaRegistry\.register\s*\(/.test(src)).toBe(false);
        expect(/\bcheck_coagulation\s*\(/.test(src)).toBe(false);
        expect(/\bis_omega_anchor\b/.test(src)).toBe(false);
        // No threshold reassignment.
        expect(/^\s*(const|let|var)\s+THETA_S\s*=(?!\s*0\.28\b)/m.test(src)).toBe(false);
        expect(/^\s*(const|let|var)\s+TAU_COAG\s*=(?!\s*12\b)/m.test(src)).toBe(false);
    });

    it("test_35_no_forbidden_identifiers_in_structural_reference_source", async () => {
        const src = await fsp.readFile(
            path.join(PROJECT_ROOT, "scripts", "lib", "structural-reference.mjs"),
            "utf-8",
        );
        expect(/\bnew\s+OmegaRecord\b/.test(src)).toBe(false);
        expect(/\bnew\s+ReferenceField\b/.test(src)).toBe(false);
        expect(/\bcheck_coagulation\s*\(/.test(src)).toBe(false);
        expect(/\bis_omega_anchor\b/.test(src)).toBe(false);
    });

    it("test_36_runner_emits_suffix_FULL_LEVEL3_NOT_DECLARED", async () => {
        const src = await fsp.readFile(
            path.join(PROJECT_ROOT, "scripts", "level3-structural-identity-runner.mjs"),
            "utf-8",
        );
        expect(src.includes("FULL_LEVEL3_NOT_DECLARED")).toBe(true);
    });

    it("test_37_schema_version_present", () => {
        expect(typeof RUNNER_SCHEMA_VERSION).toBe("string");
        expect(RUNNER_SCHEMA_VERSION.startsWith("level3-structural-identity-runner.v")).toBe(true);
    });
});
