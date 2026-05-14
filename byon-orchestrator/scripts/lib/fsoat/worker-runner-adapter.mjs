#!/usr/bin/env node
/**
 * BYON Optimus - Full Source Organism Activation Test
 * Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
 *
 * WorkerRunnerAdapter
 * ===================
 *
 * Thin adapter around the production WorkerAgent (byon-orchestrator/src/agents/worker).
 * The adapter loads the compiled JS from dist/ (after `npm run build`) and invokes
 * `processMessage(content, source, taskType)` directly.
 *
 * The adapter is observation-only: it does not modify Worker logic. It captures the
 * EvidencePack and PlanDraft emitted, forwards them to the ActivationTracker and the
 * MACPChainObserver, and returns both documents.
 *
 * If dist/ is not built or the import fails, the adapter throws with a clear message.
 * It does NOT silently fall back to a mock that would falsely report Worker as active.
 */

import * as path from "node:path";
import { pathToFileURL } from "node:url";

export class WorkerRunnerAdapter {
    constructor(opts) {
        if (!opts?.distRoot) {
            throw new Error("WorkerRunnerAdapter requires opts.distRoot (path to byon-orchestrator dist/)");
        }
        if (!opts?.workspacePaths) {
            throw new Error("WorkerRunnerAdapter requires opts.workspacePaths from HandoffWorkspaceManager");
        }
        if (!opts?.tracker) {
            throw new Error("WorkerRunnerAdapter requires opts.tracker (ActivationTracker)");
        }
        if (!opts?.chainObserver) {
            throw new Error("WorkerRunnerAdapter requires opts.chainObserver (MACPChainObserver)");
        }
        this.distRoot = opts.distRoot;
        this.paths = opts.workspacePaths;
        this.tracker = opts.tracker;
        this.chainObserver = opts.chainObserver;
        this.workerAgent = null;
        this.WorkerAgentClass = null;
        this.events = {
            onEvidence: opts.onEvidence || null,
            onPlan: opts.onPlan || null
        };
    }

    async init() {
        const entryPath = path.join(this.distRoot, "src", "agents", "worker", "index.js");
        const url = pathToFileURL(entryPath).href;
        let mod;
        try {
            mod = await import(url);
        } catch (err) {
            throw new Error(
                `WorkerRunnerAdapter: failed to import compiled worker at ${entryPath} - did you run \`npm run build\`? underlying: ${err.message}`
            );
        }
        if (!mod.WorkerAgent || typeof mod.WorkerAgent !== "function") {
            throw new Error("WorkerRunnerAdapter: WorkerAgent export not found in compiled module");
        }
        this.WorkerAgentClass = mod.WorkerAgent;

        const config = {
            worker_id: "fsoat_worker",
            inbox: { path: this.paths.inbox },
            enable_gmv: false,
            auto_start: false,
            audit_path: this.paths.audit_worker
        };

        let lastEvidence = null;
        let lastPlan = null;

        const events = {
            onEvidenceBuilt: (evidence) => {
                lastEvidence = evidence;
            },
            onPlanGenerated: (plan, evidence) => {
                lastPlan = plan;
                if (evidence) {
                    lastEvidence = evidence;
                }
            }
        };

        this.workerAgent = new this.WorkerAgentClass(config, events);
        this._lastEvidenceRef = () => lastEvidence;
        this._lastPlanRef = () => lastPlan;
    }

    /**
     * Process a single user message through the real WorkerAgent.
     * Returns { result, evidence, plan }.
     *
     * Always records proofs on the tracker, regardless of outcome:
     *   - worker.evidence_pack.written if an EvidencePack was produced
     *   - worker.plan_draft.written if a PlanDraft was produced
     */
    async processMessage(scenarioId, content, opts = {}) {
        if (!this.workerAgent) {
            throw new Error("WorkerRunnerAdapter: init() not called");
        }
        const source = opts.source || `fsoat:${scenarioId}`;
        const taskType = opts.taskType || "general";

        const result = await this.workerAgent.processMessage(content, source, taskType);

        const evidence = this._lastEvidenceRef() || result.evidence || null;
        const plan = this._lastPlanRef() || result.plan || null;

        if (evidence) {
            this.tracker.recordProof("macp_security_body", "worker.evidence_pack.written", {
                evidence_id: evidence.evidence_id,
                scenario: scenarioId
            });
            this.chainObserver.observeEvidencePack(scenarioId, evidence);

            // FCE context, if present, is metadata-only by construction (v0.6.0)
            if (evidence.fce_context) {
                this.tracker.recordProof("memory_substrate", "memory_service.fce_advisory", {
                    via: "evidence_pack.fce_context",
                    scenario: scenarioId
                });
            }
        }

        if (plan) {
            this.tracker.recordProof("macp_security_body", "worker.plan_draft.written", {
                plan_id: plan.plan_id,
                risk_level: plan.risk_level,
                actions: plan.actions?.length || 0,
                scenario: scenarioId
            });
            this.chainObserver.observePlanDraft(scenarioId, plan);
        }

        // Detect whether AIProcessor was actually used and which provider it called.
        // The PlanGenerator stamps `ai_generated:true` and `tokens_used:<n>` into the
        // action parameters when the AIProcessor returns a real response. The exact
        // provider (anthropic vs openai_compatible) is decided at AIProcessor init time
        // based on env vars; FSOAT_MODE=full preflight already enforced LLM_PROVIDER=anthropic
        // and a claude-* LLM_MODEL, so an `ai_generated:true` action under FSOAT_MODE=full
        // is proof of a real claude-sonnet-4-* call.
        const aiActions = Array.isArray(plan?.actions)
            ? plan.actions.filter((a) => a?.parameters?.ai_generated === true)
            : [];
        const tokensUsed = aiActions.reduce(
            (acc, a) => acc + (Number(a?.parameters?.tokens_used) || 0),
            0
        );
        const aiFailureActions = Array.isArray(plan?.actions)
            ? plan.actions.filter((a) => a?.target === "output/error.txt" && /AI processing failed/.test(a?.parameters?.content || ""))
            : [];

        const apiKeyPresent = Boolean(process.env.ANTHROPIC_API_KEY);
        const llmProvider = (process.env.LLM_PROVIDER || (apiKeyPresent ? "anthropic" : "openai_compatible")).toLowerCase();
        const modelId = process.env.LLM_MODEL || "claude-sonnet-4-6";

        if (aiActions.length > 0 && tokensUsed > 0 && llmProvider === "anthropic" && modelId.startsWith("claude-")) {
            this.tracker.recordProof("verbal_brain", "anthropic.api.call", {
                scenario: scenarioId,
                provider: "anthropic",
                model: modelId,
                tokens_used: tokensUsed,
                ai_actions: aiActions.length
            });
        } else {
            // Per operator rule (FSOAT live rerun mandate):
            // "Do not let Worker silently fall back to a deterministic generator while
            //  reporting verbal_brain as active. If deterministic fallback is used, the
            //  organ must be reported as: verbal_brain_incomplete_real_llm_not_used."
            // We record this as an UNRECOGNISED proof so the tracker does NOT mark
            // verbal_brain active. The event is preserved in the log for the report.
            this.tracker.recordProof("verbal_brain", "verbal_brain_incomplete_real_llm_not_used", {
                scenario: scenarioId,
                provider: llmProvider,
                model: modelId,
                api_key_present: apiKeyPresent,
                ai_actions: aiActions.length,
                tokens_used: tokensUsed,
                ai_failure_actions: aiFailureActions.length,
                ai_failure_first_content: aiFailureActions[0]?.parameters?.content?.slice(0, 240) || null,
                reason: aiActions.length === 0
                    ? "no ai_generated action in plan; Worker used deterministic plan path"
                    : aiFailureActions.length > 0
                    ? "AI processing failed; Worker fell back to error path"
                    : tokensUsed === 0
                    ? "ai_generated action present but tokens_used=0"
                    : "provider or model not anthropic/claude-*",
                operator_rule: "FSOAT live rerun mandate forbids treating deterministic fallback as verbal_brain activation"
            });
        }

        return { result, evidence, plan };
    }

    async shutdown() {
        if (this.workerAgent && typeof this.workerAgent.stop === "function") {
            try {
                this.workerAgent.stop();
            } catch {
                // best-effort
            }
        }
    }
}

export function createWorkerRunnerAdapter(opts) {
    return new WorkerRunnerAdapter(opts);
}
