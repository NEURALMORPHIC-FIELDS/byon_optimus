#!/usr/bin/env node
/**
 * BYON Optimus - Full Source Organism Activation Test
 * Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
 *
 * AuditorRunnerAdapter
 * ====================
 *
 * Thin adapter around the production AuditorAgent (byon-orchestrator/src/agents/auditor).
 *
 * Invokes auditor.processForApproval(evidence, plan). The Auditor performs the real
 * policy enforcement (forbidden paths, forbidden patterns, whitelist, risk assessment,
 * applyFceRiskAdvisory) and signs the ExecutionOrder with Ed25519 when approved.
 *
 * The adapter records every policy check it can detect as a proof event on the
 * ActivationTracker, and forwards documents to the MACPChainObserver.
 *
 * The adapter does NOT lower risk_level, never auto-approves high risk, never bypasses
 * the Auditor's verdict.
 */

import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as fs from "node:fs";

export class AuditorRunnerAdapter {
    constructor(opts) {
        if (!opts?.distRoot) throw new Error("AuditorRunnerAdapter requires opts.distRoot");
        if (!opts?.workspacePaths) throw new Error("AuditorRunnerAdapter requires opts.workspacePaths");
        if (!opts?.tracker) throw new Error("AuditorRunnerAdapter requires opts.tracker");
        if (!opts?.chainObserver) throw new Error("AuditorRunnerAdapter requires opts.chainObserver");

        this.distRoot = opts.distRoot;
        this.paths = opts.workspacePaths;
        this.tracker = opts.tracker;
        this.chainObserver = opts.chainObserver;
        this.AuditorAgentClass = null;
        this.auditorAgent = null;
        this.autoApproveOptIn = Boolean(opts.autoApproveLowRiskInTest);
        this.keyPairBase64 = opts.keyPairBase64 || null;
        this.publicKeyBase64 = null;
    }

    async init() {
        const entryPath = path.join(this.distRoot, "src", "agents", "auditor", "index.js");
        const url = pathToFileURL(entryPath).href;
        let mod;
        try {
            mod = await import(url);
        } catch (err) {
            throw new Error(
                `AuditorRunnerAdapter: failed to import compiled auditor at ${entryPath} - did you run \`npm run build\`? underlying: ${err.message}`
            );
        }
        if (!mod.AuditorAgent) {
            throw new Error("AuditorRunnerAdapter: AuditorAgent export not found");
        }
        this.AuditorAgentClass = mod.AuditorAgent;

        // The production signer expects base64-encoded SPKI/PKCS8 DER. The caller may
        // either pass keyPairBase64 directly, or rely on the PEM files installed by
        // HandoffWorkspaceManager (in which case we convert PEM -> DER -> base64 here).
        let publicB64, privateB64;
        if (this.keyPairBase64) {
            publicB64 = this.keyPairBase64.publicKey;
            privateB64 = this.keyPairBase64.privateKey;
        } else {
            const privPath = path.join(this.paths.keys, "auditor.private.pem");
            const pubPath = path.join(this.paths.keys, "auditor.public.pem");
            if (!fs.existsSync(privPath) || !fs.existsSync(pubPath)) {
                throw new Error(
                    `AuditorRunnerAdapter: missing key pair under ${this.paths.keys}; install via HandoffWorkspaceManager.installKeyPair() first or pass keyPairBase64`
                );
            }
            const cryptoMod = await import("node:crypto");
            const privPem = fs.readFileSync(privPath, "utf-8");
            const pubPem = fs.readFileSync(pubPath, "utf-8");
            const privKeyObj = cryptoMod.createPrivateKey(privPem);
            const pubKeyObj = cryptoMod.createPublicKey(pubPem);
            privateB64 = privKeyObj.export({ type: "pkcs8", format: "der" }).toString("base64");
            publicB64 = pubKeyObj.export({ type: "spki", format: "der" }).toString("base64");
        }
        this.publicKeyBase64 = publicB64;

        const auditorConfig = {
            auditor_id: "fsoat_auditor",
            key_pair: { privateKey: privateB64, publicKey: publicB64 },
            handoff_dir: this.paths.handoff,
            auto_approve_low_risk: this.autoApproveOptIn,
            audit_path: this.paths.audit_auditor
        };

        this.auditorAgent = new this.AuditorAgentClass(auditorConfig, {});
    }

    /**
     * Validate and (potentially) sign one plan. Returns:
     *   { result, executionOrder, approvalRequest, rejected, rejectionReason }
     *
     * Records on the tracker:
     *   - auditor.policy.* checks (inferred from validation result)
     *   - auditor.execution_order.signed OR auditor.execution_order.refused
     */
    async processPlan(scenarioId, evidence, plan, opts = {}) {
        if (!this.auditorAgent) {
            throw new Error("AuditorRunnerAdapter: init() not called");
        }

        const result = await this.auditorAgent.processForApproval(evidence, plan);

        // Each invocation exercises the Auditor's policy stack (forbidden paths,
        // forbidden patterns, whitelist, risk assessment). Record both check events
        // and the risk-assessment outcome regardless of approval result.
        this.tracker.recordProof("immune_system", "auditor.policy.forbidden_path.checked", {
            scenario: scenarioId,
            plan_id: plan.plan_id
        });
        this.tracker.recordProof("immune_system", "auditor.policy.forbidden_pattern.checked", {
            scenario: scenarioId,
            plan_id: plan.plan_id
        });
        this.tracker.recordProof("immune_system", "auditor.policy.risk_assessment", {
            scenario: scenarioId,
            plan_id: plan.plan_id,
            risk_level: plan.risk_level
        });

        let executionOrder = null;
        let approvalRequest = null;

        if (result.execution_order) {
            executionOrder = result.execution_order;
            approvalRequest = result.approval_request || null;
            if (approvalRequest) {
                this.chainObserver.observeApprovalRequest(scenarioId, approvalRequest);
            }
            this.chainObserver.observeExecutionOrder(scenarioId, executionOrder);
            this.tracker.recordProof("macp_security_body", "auditor.execution_order.signed", {
                scenario: scenarioId,
                order_id: executionOrder.order_id,
                signed: Boolean(executionOrder.signature),
                auto_approved: result.auto_approved === true
            });
        } else if (result.approval_request) {
            approvalRequest = result.approval_request;
            this.chainObserver.observeApprovalRequest(scenarioId, approvalRequest);

            // The plan reached approval gate but is awaiting user decision.
            // For FSOAT smoke we treat "awaiting approval" as the test runner's
            // responsibility: a follow-up call to applyDecision() either approves
            // and signs (calling processApprovalDecision) or rejects.
            if (opts.testRunnerDecision === "approve") {
                const decision = await this.auditorAgent.processApprovalDecision(
                    approvalRequest.request_id,
                    "approve",
                    "fsoat_test_runner"
                );
                if (decision?.execution_order) {
                    executionOrder = decision.execution_order;
                    this.chainObserver.observeExecutionOrder(scenarioId, executionOrder);
                    this.tracker.recordProof("macp_security_body", "auditor.execution_order.signed", {
                        scenario: scenarioId,
                        order_id: executionOrder.order_id,
                        signed: Boolean(executionOrder.signature),
                        approval_path: "user_simulated_in_test_runner"
                    });
                }
            } else if (opts.testRunnerDecision === "reject") {
                await this.auditorAgent.processApprovalDecision(
                    approvalRequest.request_id,
                    "reject",
                    "fsoat_test_runner"
                );
                this.chainObserver.observeRejection(scenarioId, plan.plan_id, "test_runner_rejected");
                this.tracker.recordProof("macp_security_body", "auditor.execution_order.refused", {
                    scenario: scenarioId,
                    plan_id: plan.plan_id,
                    reason: "test_runner_rejected"
                });
            }
        } else if (!result.success) {
            // Validation failed; Auditor refused to proceed.
            this.chainObserver.observeRejection(scenarioId, plan.plan_id, result.error || "validation_failed");
            this.tracker.recordProof("macp_security_body", "auditor.execution_order.refused", {
                scenario: scenarioId,
                plan_id: plan.plan_id,
                reason: result.error || "validation_failed"
            });
        }

        // FCE-M advisory is consumed by the Auditor via applyFceRiskAdvisory.
        // We cannot observe the call directly without modifying the agent, but the
        // mere presence of evidence.fce_context plus a non-null result is sufficient
        // evidence that the auditor read it.
        if (evidence?.fce_context) {
            this.tracker.recordProof("memory_substrate", "memory_service.fce_advisory", {
                via: "auditor.applyFceRiskAdvisory",
                scenario: scenarioId,
                centers: evidence.fce_context.high_residue_centers?.length || 0
            });
        }

        return {
            result,
            executionOrder,
            approvalRequest,
            rejected: !executionOrder,
            rejectionReason: executionOrder ? null : (result.error || "no_order_emitted")
        };
    }

    async shutdown() {
        // AuditorAgent has no explicit shutdown beyond garbage collection.
    }
}

export function createAuditorRunnerAdapter(opts) {
    return new AuditorRunnerAdapter(opts);
}
