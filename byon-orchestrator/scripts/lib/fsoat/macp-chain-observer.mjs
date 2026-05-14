#!/usr/bin/env node
/**
 * BYON Optimus - Full Source Organism Activation Test
 * Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
 *
 * MACPChainObserver
 * =================
 *
 * Tracks the canonical MACP v1.1 document chain across a single scenario:
 *   EvidencePack -> PlanDraft -> ApprovalRequest -> ExecutionOrder -> JohnsonReceipt
 *
 * Each observed document is appended to mac-document-chain.jsonl with the document
 * itself plus a thin envelope (scenario id, observed_at, kind, hash). The observer
 * does NOT validate schemas. Validation is the job of the orchestrator's runtime
 * (ajv-based validators in byon-orchestrator/src/validation/schema-validator.ts).
 *
 * Hash-chain integrity (each document references the previous one via SHA256) is
 * computed by FinalVerdictBuilder; this observer only records.
 */

import * as crypto from "node:crypto";

const KNOWN_KINDS = Object.freeze([
    "EVIDENCE_PACK",
    "PLAN_DRAFT",
    "APPROVAL_REQUEST",
    "EXECUTION_ORDER",
    "JOHNSON_RECEIPT",
    "REJECTION"
]);

export class MACPChainObserver {
    constructor(opts = {}) {
        this.runId = opts.runId || "unknown";
        this.events = [];
        this.byScenario = new Map();
    }

    observeEvidencePack(scenarioId, evidencePack) {
        this._record(scenarioId, "EVIDENCE_PACK", evidencePack, {
            id_field: "evidence_id"
        });
    }

    observePlanDraft(scenarioId, planDraft) {
        this._record(scenarioId, "PLAN_DRAFT", planDraft, {
            id_field: "plan_id",
            references: { based_on_evidence: planDraft?.based_on_evidence }
        });
    }

    observeApprovalRequest(scenarioId, approvalRequest) {
        this._record(scenarioId, "APPROVAL_REQUEST", approvalRequest, {
            id_field: "request_id",
            references: { plan_id: approvalRequest?.plan_id }
        });
    }

    observeExecutionOrder(scenarioId, executionOrder) {
        this._record(scenarioId, "EXECUTION_ORDER", executionOrder, {
            id_field: "order_id",
            references: { plan_id: executionOrder?.based_on_plan },
            signed: Boolean(executionOrder?.signature)
        });
    }

    observeJohnsonReceipt(scenarioId, receipt) {
        this._record(scenarioId, "JOHNSON_RECEIPT", receipt, {
            id_field: "receipt_id",
            references: { order_id: receipt?.based_on_order }
        });
    }

    observeRejection(scenarioId, planId, reason) {
        this._record(scenarioId, "REJECTION", {
            scenario_id: scenarioId,
            plan_id: planId,
            reason,
            rejected_at: new Date().toISOString()
        }, { id_field: "plan_id" });
    }

    _record(scenarioId, kind, payload, meta = {}) {
        if (!KNOWN_KINDS.includes(kind)) {
            throw new Error(`unknown MACP document kind: ${kind}`);
        }
        const observedAt = new Date().toISOString();
        const docId = payload?.[meta.id_field] || null;
        const hash = this._hash(payload);

        const envelope = {
            run_id: this.runId,
            scenario_id: scenarioId,
            kind,
            doc_id: docId,
            observed_at: observedAt,
            hash,
            signed: meta.signed === true,
            references: meta.references || null,
            document: payload
        };

        this.events.push(envelope);

        if (!this.byScenario.has(scenarioId)) {
            this.byScenario.set(scenarioId, []);
        }
        this.byScenario.get(scenarioId).push(envelope);
    }

    _hash(obj) {
        try {
            const s = JSON.stringify(obj || {});
            return "sha256:" + crypto.createHash("sha256").update(s).digest("hex");
        } catch {
            return "sha256:invalid";
        }
    }

    /**
     * Build per-scenario chain integrity summary. Used by FinalVerdictBuilder
     * to evaluate G_MACP and G_SIGNATURE gates.
     */
    summariseChains() {
        const summary = {};
        for (const [scenarioId, events] of this.byScenario.entries()) {
            const present = new Set(events.map((e) => e.kind));
            const signedOrders = events.filter(
                (e) => e.kind === "EXECUTION_ORDER" && e.signed
            ).length;
            const rejections = events.filter((e) => e.kind === "REJECTION").length;
            const receipts = events.filter((e) => e.kind === "JOHNSON_RECEIPT").length;
            const hasEvidence = present.has("EVIDENCE_PACK");
            const hasPlan = present.has("PLAN_DRAFT");
            const hasOrderOrRejection =
                present.has("EXECUTION_ORDER") || present.has("REJECTION");
            const hasReceiptOrJustifiedRejection = receipts > 0 || rejections > 0;

            summary[scenarioId] = {
                has_evidence_pack: hasEvidence,
                has_plan_draft: hasPlan,
                has_approval_request: present.has("APPROVAL_REQUEST"),
                has_execution_order: present.has("EXECUTION_ORDER"),
                has_rejection: present.has("REJECTION"),
                has_receipt: present.has("JOHNSON_RECEIPT"),
                signed_orders: signedOrders,
                rejections,
                receipts,
                chain_complete:
                    hasEvidence && hasPlan && hasOrderOrRejection && hasReceiptOrJustifiedRejection,
                document_count: events.length
            };
        }
        return summary;
    }

    eventsJsonl() {
        return this.events.map((e) => JSON.stringify(e)).join("\n");
    }
}

export function createMACPChainObserver(opts) {
    return new MACPChainObserver(opts);
}

export const MACP_KINDS = KNOWN_KINDS;
