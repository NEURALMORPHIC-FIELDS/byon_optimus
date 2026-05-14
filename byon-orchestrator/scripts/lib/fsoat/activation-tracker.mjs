#!/usr/bin/env node
/**
 * BYON Optimus - Full Source Organism Activation Test
 * Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
 * Patent: EP25216372.0
 *
 * ActivationTracker
 * =================
 *
 * Per-organ event collector. Pure observer. Records activation evidence for each
 * of the eleven organs declared in docs/validation/FULL_SOURCE_ORGANISM_ACTIVATION_TEST.md
 * and .claude/project_concept.json.
 *
 * The tracker does NOT decide pass/fail. It only records evidence. FinalVerdictBuilder
 * reads the activation matrix and decides verdict.
 *
 * An organ is marked active only when at least one "proof event" is recorded. There is
 * no toggle that exempts an organ. If an organ has zero proof events at end-of-run, it
 * is reported `ORGAN_INACTIVE: <name>`.
 */

const ELEVEN_ORGANS = Object.freeze([
    "verbal_brain",
    "macp_security_body",
    "memory_substrate",
    "trust_hierarchy",
    "immune_system",
    "controlled_hands",
    "capability_routing",
    "code_workspace_memory",
    "compliance_post_check",
    "receipt_assimilation",
    "structural_reference_memory"
]);

const REQUIRED_PROOFS = Object.freeze({
    verbal_brain: ["anthropic.api.call"],
    macp_security_body: [
        "worker.evidence_pack.written",
        "worker.plan_draft.written",
        "auditor.execution_order.signed",
        "auditor.execution_order.refused",
        "executor.receipt.written"
    ],
    memory_substrate: [
        "memory_service.faiss.search",
        "memory_service.fce_advisory",
        "memory_service.health"
    ],
    trust_hierarchy: ["trust_ranked_formatter.tiers_used"],
    immune_system: [
        "auditor.policy.forbidden_path.checked",
        "auditor.policy.forbidden_pattern.checked",
        "auditor.policy.risk_assessment",
        "compliance_guard.evaluated",
        "disputed_or_unsafe.rail.checked"
    ],
    controlled_hands: [
        "executor.signature.verified",
        "executor.signature.rejected",
        "executor.container.airgap"
    ],
    capability_routing: ["capability_router.activation_plan"],
    code_workspace_memory: ["code_workspace_memory.context_built"],
    compliance_post_check: [
        "compliance_guard.evaluated",
        "post_generation_checker.evaluated"
    ],
    receipt_assimilation: ["memory_service.fce_assimilate_receipt"],
    structural_reference_memory: ["level3.structural_references.retrieved"]
});

export class ActivationTracker {
    constructor(opts = {}) {
        this.runId = opts.runId || "unknown";
        this.startedAt = new Date().toISOString();
        this.organs = new Map();
        this.eventLog = [];
        this.scenarioContext = { current: null };

        for (const organ of ELEVEN_ORGANS) {
            this.organs.set(organ, {
                organ,
                active: false,
                not_applicable_to_scenario: false,
                proofs: [],
                first_proof_at: null,
                last_proof_at: null
            });
        }
    }

    setScenario(scenarioId) {
        this.scenarioContext.current = scenarioId;
    }

    /**
     * Record a proof event. Validates that the proof type is one of the declared
     * REQUIRED_PROOFS for the organ. Silently ignores unknown organs to avoid breaking
     * the run, but emits a warning event so the final report flags it.
     */
    recordProof(organ, proofType, evidence = {}) {
        const ts = new Date().toISOString();

        if (!this.organs.has(organ)) {
            this.eventLog.push({
                ts,
                level: "warn",
                organ,
                proof_type: proofType,
                evidence,
                scenario: this.scenarioContext.current,
                note: "unknown_organ"
            });
            return;
        }

        const known = REQUIRED_PROOFS[organ];
        const recognised = known.includes(proofType);

        const record = this.organs.get(organ);
        record.proofs.push({
            ts,
            proof_type: proofType,
            recognised,
            scenario: this.scenarioContext.current,
            evidence
        });
        record.active = record.active || recognised;
        if (recognised && !record.first_proof_at) {
            record.first_proof_at = ts;
        }
        if (recognised) {
            record.last_proof_at = ts;
        }

        this.eventLog.push({
            ts,
            level: recognised ? "info" : "warn",
            organ,
            proof_type: proofType,
            evidence,
            scenario: this.scenarioContext.current,
            recognised
        });
    }

    /**
     * Mark organ 8 (code_workspace_memory) as not_applicable_to_scenario.
     * This is the ONLY organ allowed to be marked N/A, and only for non-coding scenarios.
     * For all other organs, lack of activation is reported as ORGAN_INACTIVE, never N/A.
     */
    markCodeWorkspaceNotApplicableToScenario(scenarioId, reason) {
        const record = this.organs.get("code_workspace_memory");
        if (record.active) {
            // Already activated; ignore the N/A request.
            return;
        }
        record.not_applicable_to_scenario = true;
        this.eventLog.push({
            ts: new Date().toISOString(),
            level: "info",
            organ: "code_workspace_memory",
            proof_type: "not_applicable_to_scenario",
            scenario: scenarioId,
            reason
        });
    }

    snapshot() {
        const organs = {};
        const inactive = [];
        const active = [];
        const notApplicable = [];

        for (const organ of ELEVEN_ORGANS) {
            const record = this.organs.get(organ);
            organs[organ] = {
                active: record.active,
                not_applicable_to_scenario: record.not_applicable_to_scenario,
                proof_count: record.proofs.filter((p) => p.recognised).length,
                first_proof_at: record.first_proof_at,
                last_proof_at: record.last_proof_at
            };
            if (record.active) {
                active.push(organ);
            } else if (record.not_applicable_to_scenario) {
                notApplicable.push(organ);
            } else {
                inactive.push(organ);
            }
        }

        return {
            run_id: this.runId,
            started_at: this.startedAt,
            ended_at: new Date().toISOString(),
            organs,
            active_count: active.length,
            inactive_count: inactive.length,
            not_applicable_count: notApplicable.length,
            active_organs: active,
            inactive_organs: inactive,
            not_applicable_organs: notApplicable
        };
    }

    eventStream() {
        return this.eventLog.slice();
    }

    proofDetail() {
        const detail = {};
        for (const organ of ELEVEN_ORGANS) {
            detail[organ] = this.organs.get(organ).proofs.slice();
        }
        return detail;
    }
}

export const ORGAN_LIST = ELEVEN_ORGANS;
export const ORGAN_PROOFS = REQUIRED_PROOFS;

export function createActivationTracker(opts) {
    return new ActivationTracker(opts);
}
