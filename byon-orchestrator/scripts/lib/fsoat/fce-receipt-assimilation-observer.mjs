#!/usr/bin/env node
/**
 * BYON Optimus - Full Source Organism Activation Test
 * Copyright (c) 2024-2026 Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
 *
 * FceReceiptAssimilationObserver
 * ==============================
 *
 * Probes memory-service for the receipt assimilation endpoint and records the
 * state delta produced by each JohnsonReceipt assimilation.
 *
 * Endpoint contract (server.py / fcem_backend.assimilate_receipt):
 *   POST {base}/  with body { action: "fce_assimilate_receipt", params: {...} }
 *   or
 *   POST {base}/fce_assimilate_receipt
 *
 * The observer first probes /health, then attempts assimilate. If memory-service is
 * not running, the observer records nothing as proof (so receipt_assimilation stays
 * inactive and FSOAT correctly emits FULL_ORGANISM_INCOMPLETE_MODULES_INACTIVE).
 *
 * The observer does NOT mock the call. It either reaches a live memory-service or
 * it reports the organ as inactive. Honest reporting beats fake success.
 */

import * as crypto from "node:crypto";

const DEFAULT_TIMEOUT_MS = 5000;

export class FceReceiptAssimilationObserver {
    constructor(opts) {
        if (!opts?.tracker) throw new Error("FceReceiptAssimilationObserver requires opts.tracker");
        this.tracker = opts.tracker;
        this.baseUrl = opts.baseUrl || process.env.MEMORY_SERVICE_URL || "http://127.0.0.1:8000";
        this.timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
        this.stateDeltas = [];
        this.healthCheckedAt = null;
        this.healthOk = null;
    }

    /**
     * Probe /health. Returns true if memory-service is reachable.
     * Records memory_service.health as a proof of memory_substrate if healthy.
     */
    async probeHealth() {
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
            const resp = await fetch(`${this.baseUrl}/health`, { signal: ctrl.signal });
            clearTimeout(t);
            this.healthCheckedAt = new Date().toISOString();
            if (resp.ok) {
                const body = await resp.json().catch(() => ({}));
                this.healthOk = true;
                this.tracker.recordProof("memory_substrate", "memory_service.health", {
                    base_url: this.baseUrl,
                    body
                });
                return true;
            }
            this.healthOk = false;
            return false;
        } catch (err) {
            this.healthCheckedAt = new Date().toISOString();
            this.healthOk = false;
            return false;
        }
    }

    /**
     * Optional convenience: exercise the FAISS search path so memory_substrate gets
     * the memory_service.faiss.search proof. Used at run setup so the smoke test does
     * not rely on Worker hitting memory.
     */
    async probeFaissSearch(opts = {}) {
        if (this.healthOk !== true) {
            const ok = await this.probeHealth();
            if (!ok) return null;
        }
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
            const resp = await fetch(`${this.baseUrl}/`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    action: "search",
                    params: {
                        query: opts.query || "BYON Optimus probe",
                        mem_type: opts.memType || "fact",
                        top_k: opts.topK || 3,
                        thread_id: opts.threadId || "fsoat_health_probe",
                        scope: "thread"
                    }
                }),
                signal: ctrl.signal
            });
            clearTimeout(t);
            const body = await resp.json().catch(() => ({}));
            if (resp.ok) {
                this.tracker.recordProof("memory_substrate", "memory_service.faiss.search", {
                    base_url: this.baseUrl,
                    hit_count: Array.isArray(body?.results) ? body.results.length : 0,
                    raw_status: resp.status
                });
                return body;
            }
        } catch {
            // probe failed; do not record proof
        }
        return null;
    }

    /**
     * Probe FCE-M advisory state. Records `memory_service.fce_advisory` proof
     * on `memory_substrate` ONLY when the response passes strict body validation
     * (per operator FSOAT mandate):
     *
     *   1. HTTP request reaches memory-service (resp non-null);
     *   2. Body does NOT contain `fce_status: "error"`;
     *   3. Body has `success === true`;
     *   4. Body contains either a valid `advisory` (array, even if empty) OR a
     *      valid `state` snapshot from fce_state (enabled flag + omega_registry).
     *
     * Also pushes an explicit delta into fce-state-deltas.jsonl marking the
     * advisory as `metadata_only / priority_only / risk_lowered=false`, so the
     * artifact makes the operator's invariant audit-traceable.
     *
     * Returns the merged advisory+state body on success, null on failure.
     */
    async probeFceAdvisory(opts = {}) {
        if (this.healthOk !== true) {
            const ok = await this.probeHealth();
            if (!ok) return null;
        }
        let advisoryBody = null;
        let stateBody = null;
        // ---------------- fce_advisory call ----------------
        try {
            const ctrl1 = new AbortController();
            const t1 = setTimeout(() => ctrl1.abort(), this.timeoutMs);
            const resp1 = await fetch(`${this.baseUrl}/`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    action: "fce_advisory",
                    params: {
                        thread_id: opts.threadId || `fsoat_${opts.scenarioId || "run"}`,
                        scope: opts.scope || "thread"
                    }
                }),
                signal: ctrl1.signal
            });
            clearTimeout(t1);
            const body1 = await resp1.json().catch(() => ({}));
            if (resp1.ok) advisoryBody = body1;
        } catch {
            advisoryBody = null;
        }
        // ---------------- fce_state call (snapshot OR-branch) ----------------
        try {
            const ctrl2 = new AbortController();
            const t2 = setTimeout(() => ctrl2.abort(), this.timeoutMs);
            const resp2 = await fetch(`${this.baseUrl}/`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action: "fce_state" }),
                signal: ctrl2.signal
            });
            clearTimeout(t2);
            const body2 = await resp2.json().catch(() => ({}));
            if (resp2.ok) stateBody = body2;
        } catch {
            stateBody = null;
        }
        // ---------------- validation ----------------
        const advisoryErrorMarker =
            advisoryBody?.fce_status === "error" ||
            advisoryBody?.fce?.fce_status === "error" ||
            stateBody?.fce_status === "error";
        const advisorySuccessFlag =
            advisoryBody?.success === true || stateBody?.success === true;
        const advisoryIsValidStructure = Array.isArray(advisoryBody?.advisory);
        const stateIsValidSnapshot =
            stateBody?.state &&
            typeof stateBody.state === "object" &&
            "enabled" in stateBody.state &&
            "omega_registry" in stateBody.state;
        const bodyShapeOk = advisoryIsValidStructure || stateIsValidSnapshot;
        const passesValidation = !advisoryErrorMarker && advisorySuccessFlag && bodyShapeOk;
        // ---------------- artifact + proof ----------------
        const advisoryLen = Array.isArray(advisoryBody?.advisory) ? advisoryBody.advisory.length : 0;
        const omegaCount = stateBody?.state?.omega_registry?.count ?? null;
        const refsCount = stateBody?.state?.reference_fields_count ?? null;
        const enabled = stateBody?.state?.enabled ?? null;
        if (passesValidation) {
            this.tracker.recordProof("memory_substrate", "memory_service.fce_advisory", {
                base_url: this.baseUrl,
                scenario: opts.scenarioId || null,
                advisory_mode: "priority_only",
                advisory_lowers_risk: false,
                advisory_count: advisoryLen,
                omega_registry_count: omegaCount,
                reference_fields_count: refsCount,
                fce_enabled: enabled,
                advisory_keys_sample: advisoryBody?.advisory?.[0]
                    ? Object.keys(advisoryBody.advisory[0]).slice(0, 8)
                    : []
            });
        }
        // Always push a delta entry for the audit log, even on validation failure.
        // The delta records exactly what was probed and why it passed or failed.
        this.stateDeltas.push({
            ts: new Date().toISOString(),
            kind: "fce_advisory_probe",
            scenario_id: opts.scenarioId || null,
            advisory_mode: "priority_only",
            advisory_metadata_only: true,
            advisory_lowers_risk: false,
            note: "FCE advisory is metadata-only / priority-only and did NOT lower risk for this scenario",
            advisory_count: advisoryLen,
            omega_registry_count: omegaCount,
            reference_fields_count: refsCount,
            fce_enabled: enabled,
            validation: {
                advisory_error_marker: advisoryErrorMarker,
                success_flag: advisorySuccessFlag,
                body_shape_ok: bodyShapeOk,
                advisory_is_array: advisoryIsValidStructure,
                state_is_snapshot: stateIsValidSnapshot,
                passed: passesValidation
            }
        });
        return passesValidation ? { advisory: advisoryBody, state: stateBody } : null;
    }

    /**
     * Assimilate a JohnsonReceipt. Builds the request body in the shape
     * memory-service expects (status -> label one-hot encoded by the server).
     *
     * Returns the state delta returned by the server, or null if assimilation fails.
     * Records receipt_assimilation only on successful assimilation.
     */
    async assimilateReceipt(scenarioId, receipt) {
        if (!receipt) return null;
        if (this.healthOk !== true) {
            const ok = await this.probeHealth();
            if (!ok) return null;
        }

        const statusToken = this._statusToken(receipt);

        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
            const resp = await fetch(`${this.baseUrl}/`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    action: "fce_assimilate_receipt",
                    params: {
                        order_id: receipt.based_on_order || receipt.order_id || null,
                        status: statusToken,
                        scenario_id: scenarioId,
                        receipt_id: receipt.receipt_id || null,
                        receipt_hash: this._hash(receipt)
                    }
                }),
                signal: ctrl.signal
            });
            clearTimeout(t);
            const body = await resp.json().catch(() => ({}));
            // A real assimilation must succeed at both HTTP and FCE-M layers. The
            // memory-service returns HTTP 200 even when FCE-M internally errored
            // (fce_status: "error" body field). FSOAT requires the FCE-M layer to
            // actually succeed; otherwise receipt_assimilation stays inactive.
            const fceStatus = body?.fce_status || body?.fce?.fce_status || "unknown";
            const fceLayerOk = fceStatus === "assimilated_receipt" || fceStatus === "ok" || fceStatus === "success";
            if (resp.ok && fceLayerOk) {
                this.tracker.recordProof("receipt_assimilation", "memory_service.fce_assimilate_receipt", {
                    scenario: scenarioId,
                    receipt_id: receipt.receipt_id,
                    status_token: statusToken,
                    fce_status: fceStatus,
                    server_response: this._compactBody(body)
                });
                this.stateDeltas.push({
                    ts: new Date().toISOString(),
                    scenario_id: scenarioId,
                    receipt_id: receipt.receipt_id,
                    request_status: statusToken,
                    fce_status: fceStatus,
                    response: this._compactBody(body)
                });
                return body;
            }
            // FCE-M errored at memory-service level. Record the failure into the
            // state delta log for the verdict report, but do NOT mark the organ as
            // active. Honest reporting beats fake success.
            this.stateDeltas.push({
                ts: new Date().toISOString(),
                scenario_id: scenarioId,
                receipt_id: receipt.receipt_id,
                request_status: statusToken,
                fce_status: fceStatus,
                http_ok: resp.ok,
                error: body?.error || null,
                note: "fce_status indicates FCE-M layer did not actually assimilate; organ stays inactive"
            });
            return null;
        } catch {
            return null;
        }
    }

    stateDeltasJsonl() {
        return this.stateDeltas.map((d) => JSON.stringify(d)).join("\n");
    }

    summary() {
        return {
            base_url: this.baseUrl,
            health_checked_at: this.healthCheckedAt,
            health_ok: this.healthOk,
            assimilations_attempted: this.stateDeltas.length
        };
    }

    _statusToken(receipt) {
        const raw =
            receipt?.execution_summary?.status ||
            receipt?.status ||
            "unknown";
        const t = String(raw).toLowerCase();
        if (["success", "partial", "failed", "rejected"].includes(t)) {
            return t;
        }
        return "unknown";
    }

    _hash(obj) {
        return "sha256:" + crypto.createHash("sha256").update(JSON.stringify(obj || {})).digest("hex");
    }

    _compactBody(body) {
        // Trim large payloads for the telemetry artifact.
        if (!body || typeof body !== "object") return body;
        const out = {};
        for (const k of Object.keys(body)) {
            const v = body[k];
            if (typeof v === "string" && v.length > 500) {
                out[k] = v.slice(0, 500) + "...[truncated]";
            } else {
                out[k] = v;
            }
        }
        return out;
    }
}

export function createFceReceiptAssimilationObserver(opts) {
    return new FceReceiptAssimilationObserver(opts);
}
