#!/usr/bin/env node
/**
 * BYON-Omni Architecture Verification Suite
 * ==========================================
 *
 * Runs ~25 assertions across the full system to verify the integration
 * matches the architecture described in misiunea.txt + the integration plan.
 *
 * Categories:
 *   A. Memory-service base (FAISS API backward compat)
 *   B. FCE-M morphogenetic layer (UFME + FCE-Ω)
 *   C. Hybrid mirror-write semantics
 *   D. Receipt assimilation status mapping
 *   E. Claude Sonnet 4.6 wiring
 *   F. EvidencePack fce_context shape + Auditor gate policy
 *   G. End-to-end pipeline (memory → FCE → Claude → receipt)
 *   H. Persistence (FCE snapshot on disk)
 *
 * Output: structured pass/fail per assertion + summary.
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    validateFceContext,
    applyFceRiskAdvisory,
} from "../dist/src/agents/auditor/validator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MEMORY_URL = process.env.MEMORY_SERVICE_URL || "http://localhost:8000";
const MODEL = process.env.LLM_MODEL || "claude-sonnet-4-6";
const apiKey = process.env.ANTHROPIC_API_KEY;
const anthropic = apiKey ? new Anthropic({ apiKey }) : null;

const results = [];
function record(category, name, ok, detail = "") {
    results.push({ category, name, ok, detail });
    const stamp = ok ? "PASS" : "FAIL";
    const line = `[${stamp}] ${category} :: ${name}${detail ? "  →  " + detail : ""}`;
    console.log(line);
}

async function mem(payload, timeoutMs = 30000) {
    const r = await fetch(MEMORY_URL + "/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
}

async function memHealth() {
    const r = await fetch(MEMORY_URL + "/health", {
        signal: AbortSignal.timeout(5000),
    });
    return { ok: r.ok, body: await r.json() };
}

// ---------------------------------------------------------------------------
// A. Memory-service base (backward compat with pre-FCE BYON)
// ---------------------------------------------------------------------------

async function testA_BackwardCompat() {
    const h = await memHealth();
    record("A", "GET /health responds healthy", h.ok && h.body.status === "healthy",
        `backend=${h.body.backend} uptime=${h.body.uptime_seconds?.toFixed(1)}s`);

    const ping = await mem({ action: "ping" });
    record("A", "POST action=ping returns version", ping.ok && ping.body.version?.startsWith("4."),
        `version=${ping.body.version}`);

    const stats0 = await mem({ action: "stats" });
    record("A", "POST action=stats returns FAISS profile",
        stats0.ok && stats0.body.fhrss_profile === "FAISS-IndexFlatIP" && stats0.body.fcpe_dim === 384,
        `dim=${stats0.body.fcpe_dim} backend=${stats0.body.fhrss_profile}`);

    // store + search roundtrip on each type
    const stCode = await mem({
        action: "store", type: "code",
        data: { code: "function auth(token) { return verify(token); }", file_path: "src/auth.ts", line_number: 10, tags: ["auth"] }
    });
    record("A", "store type=code returns ctx_id",
        stCode.ok && typeof stCode.body.ctx_id === "number",
        `ctx_id=${stCode.body.ctx_id} fce=${stCode.body.fce?.fce_status}`);

    const stConv = await mem({
        action: "store", type: "conversation",
        data: { content: "How do I authenticate users with JWT?", role: "user", thread_id: "verify:t1" }
    });
    record("A", "store type=conversation returns ctx_id",
        stConv.ok && typeof stConv.body.ctx_id === "number",
        `ctx_id=${stConv.body.ctx_id} fce=${stConv.body.fce?.fce_status}`);

    const stFact = await mem({
        action: "store", type: "fact",
        data: { fact: "JWT tokens use HS256 by default", source: "docs/auth.md", tags: ["jwt", "crypto"] }
    });
    record("A", "store type=fact returns ctx_id",
        stFact.ok && typeof stFact.body.ctx_id === "number",
        `ctx_id=${stFact.body.ctx_id} fce=${stFact.body.fce?.fce_status}`);

    const sCode = await mem({ action: "search", type: "code", query: "authenticate JWT token", top_k: 3, threshold: 0.0 });
    record("A", "search type=code recalls the stored auth code",
        sCode.ok && sCode.body.results?.length > 0 && sCode.body.results[0].similarity > 0.3,
        `top_sim=${sCode.body.results?.[0]?.similarity?.toFixed(2)} hits=${sCode.body.results?.length}`);

    const sAll = await mem({ action: "search_all", query: "JWT authentication", top_k: 3, threshold: 0.0 });
    const totalHits = (sAll.body.code?.length || 0) + (sAll.body.conversation?.length || 0) + (sAll.body.facts?.length || 0);
    record("A", "search_all returns hits across all 3 types",
        sAll.ok && totalHits >= 3,
        `code=${sAll.body.code?.length} conv=${sAll.body.conversation?.length} facts=${sAll.body.facts?.length}`);
}

// ---------------------------------------------------------------------------
// B. FCE-M morphogenetic layer
// ---------------------------------------------------------------------------

async function testB_FceLayer() {
    const state = await mem({ action: "fce_state" });
    record("B", "fce_state action returns enabled",
        state.ok && state.body.state?.enabled === true,
        `omega_count=${state.body.state?.omega_registry?.count}`);

    const reg = await mem({ action: "fce_omega_registry" });
    record("B", "fce_omega_registry has expected shape",
        reg.ok &&
            typeof reg.body.omega_registry?.count === "number" &&
            typeof reg.body.omega_registry?.active === "number" &&
            typeof reg.body.omega_registry?.contested === "number" &&
            typeof reg.body.omega_registry?.inexpressed === "number" &&
            Array.isArray(reg.body.omega_registry?.records),
        `keys=count,active,contested,inexpressed,records ✓`);

    const refs = await mem({ action: "fce_reference_fields" });
    record("B", "fce_reference_fields returns arrays",
        refs.ok && Array.isArray(refs.body.reference_fields) && Array.isArray(refs.body.events),
        `refs_len=${refs.body.reference_fields?.length} events_len=${refs.body.events?.length}`);

    // Drive enough events to produce advisories
    for (let i = 0; i < 6; i++) {
        await mem({
            action: "store", type: "conversation",
            data: { content: `Repeated coherent question about JWT auth flow ${i}`, role: "user", thread_id: "verify:loop" }
        });
    }

    const consol = await mem({ action: "fce_consolidate" });
    record("B", "fce_consolidate runs morphogenetic cycle",
        consol.ok && consol.body.fce_status === "consolidated" && typeof consol.body.report?.episode_id === "number",
        `episode=${consol.body.report?.episode_id} fce_omega_cycles=${consol.body.report?.fce_omega_report?.cycles_advanced}`);

    const adv = await mem({ action: "fce_advisory" });
    record("B", "fce_advisory list is populated after coherent loop",
        adv.ok && Array.isArray(adv.body.advisory) && adv.body.advisory.length > 0,
        `count=${adv.body.advisory?.length}`);

    const advItem = adv.body.advisory?.[0];
    const validShape =
        advItem &&
        typeof advItem.feedback_id === "string" &&
        typeof advItem.center_key === "string" &&
        typeof advItem.kind === "string" &&
        typeof advItem.priority_delta === "number" &&
        typeof advItem.recommended_action === "string" &&
        typeof advItem.reason === "string";
    record("B", "advisory feedback has full schema (feedback_id, center_key, kind, priority_delta, reason)",
        !!validShape,
        advItem ? `kind=${advItem.kind} delta=${advItem.priority_delta.toFixed(3)}` : "no advisory");

    const prio = await mem({ action: "fce_priority_recommendations" });
    record("B", "fce_priority_recommendations subset of advisory",
        prio.ok && Array.isArray(prio.body.recommendations),
        `count=${prio.body.recommendations?.length}`);

    const morph = await mem({ action: "fce_morphogenesis_report", query: "auth" });
    const r = morph.body.report;
    record("B", "fce_morphogenesis_report carries summary + hashed centers",
        morph.ok && r?.enabled === true && typeof r?.morphogenesis_summary === "string",
        `summary="${r?.morphogenesis_summary}"`);
    record("B", "morphogenesis report center IDs are HASHED (no spaces, no labels)",
        r &&
            r.aligned_reference_fields.every(s => typeof s === "string" && !s.includes(" ")) &&
            r.contested_expressions.every(s => typeof s === "string" && !s.includes(" ")) &&
            r.high_residue_centers.every(s => typeof s === "string" && !s.includes(" ")),
        `aligned=${r?.aligned_reference_fields?.length} contested=${r?.contested_expressions?.length} high_res=${r?.high_residue_centers?.length}`);
}

// ---------------------------------------------------------------------------
// C. Hybrid mirror-write semantics
// ---------------------------------------------------------------------------

async function testC_HybridMirror() {
    const before = await mem({ action: "stats" });
    const beforeCount = before.body.num_contexts;
    const beforeAdv = (await mem({ action: "fce_advisory" })).body.advisory?.length || 0;

    const r = await mem({
        action: "store", type: "conversation",
        data: { content: "Mirror-write test: this should appear in both FAISS and FCE", role: "user", thread_id: "verify:mirror" }
    });

    const after = await mem({ action: "stats" });
    const afterCount = after.body.num_contexts;

    record("C", "store grows FAISS context count by 1",
        afterCount === beforeCount + 1,
        `before=${beforeCount} after=${afterCount}`);

    record("C", "store response includes fce field (mirror-write happened)",
        r.body.fce?.fce_status === "assimilated",
        `fce_status=${r.body.fce?.fce_status} entity_id=${r.body.fce?.entity_id}`);

    record("C", "fce entity_id derives from thread_id for conversation",
        r.body.fce?.entity_id === "verify:mirror",
        `entity_id=${r.body.fce?.entity_id}`);
}

// ---------------------------------------------------------------------------
// D. Receipt assimilation status mapping
// ---------------------------------------------------------------------------

async function testD_ReceiptAssimilation() {
    const cases = [
        { status: "success", expectedLabel: 1 },
        { status: "partial", expectedLabel: 2 },
        { status: "failed", expectedLabel: 3 },
        { status: "rejected", expectedLabel: 4 },
    ];
    for (const c of cases) {
        const r = await mem({
            action: "fce_assimilate_receipt",
            order_id: `verify:receipt:${c.status}`,
            status: c.status,
            based_on_evidence: `evidence-${c.status}`,
            summary: { test: true }
        });
        record("D", `receipt status="${c.status}" maps to label ${c.expectedLabel}`,
            r.body.fce_status === "assimilated_receipt" && r.body.label === c.expectedLabel,
            `actual_label=${r.body.label} status=${r.body.status}`);
    }
}

// ---------------------------------------------------------------------------
// E. Claude Sonnet 4.6 wiring
// ---------------------------------------------------------------------------

async function testE_Claude() {
    if (!anthropic) {
        record("E", "Claude live call (skipped: no API key)", false, "ANTHROPIC_API_KEY missing");
        return;
    }
    const t0 = Date.now();
    let resp;
    try {
        resp = await anthropic.messages.create({
            model: MODEL,
            max_tokens: 40,
            messages: [{ role: "user", content: "Reply with exactly: VERIFY-OK" }],
        });
    } catch (e) {
        record("E", "Claude API call succeeds", false, `error=${e.message}`);
        return;
    }
    const txt = resp.content.filter(b => b.type === "text").map(b => b.text).join("").trim();

    record("E", "Anthropic API responds",
        resp.id?.startsWith("msg_"),
        `id=${resp.id?.slice(0, 20)}... latency=${Date.now() - t0}ms`);

    record("E", `model id is "${MODEL}"`,
        resp.model === MODEL,
        `actual=${resp.model}`);

    record("E", "reply contains VERIFY-OK",
        txt.includes("VERIFY-OK"),
        `reply="${txt.slice(0, 80)}"`);

    record("E", "usage tokens present",
        typeof resp.usage?.input_tokens === "number" && typeof resp.usage?.output_tokens === "number",
        `in=${resp.usage?.input_tokens} out=${resp.usage?.output_tokens}`);
}

// ---------------------------------------------------------------------------
// F. EvidencePack fce_context + Auditor gate
// ---------------------------------------------------------------------------

function testF_AuditorGate() {
    // Valid metadata-only context
    const goodCtx = {
        enabled: true,
        query: "auth",
        omega_active: 1,
        omega_contested: 0,
        omega_inexpressed: 0,
        omega_total: 1,
        reference_fields_count: 1,
        aligned_reference_fields: ["abc123de"],
        contested_expressions: [],
        high_residue_centers: ["ff00aabb"],
        advisory_count: 3,
        priority_recommendations_count: 2,
        relation_candidates_count: 0,
        risk_centers: ["ff00aabb"],
        morphogenesis_summary: "omega:1/1 refs:1 adv:3 prio:2",
    };
    const v1 = validateFceContext(goodCtx);
    record("F", "validateFceContext accepts well-formed metadata", v1.valid, `errors=${v1.errors.join("|")}`);

    // Forbidden field — should be rejected
    const badField = { ...goodCtx, label: "auth_center_human_label" };
    const v2 = validateFceContext(badField);
    record("F", "validateFceContext rejects forbidden 'label' field",
        !v2.valid && v2.errors.some(e => e.includes("label")),
        `errors=${v2.errors[0]}`);

    // ID with space (looks like label)
    const labelLooking = { ...goodCtx, contested_expressions: ["auth flow center"] };
    const v3 = validateFceContext(labelLooking);
    record("F", "validateFceContext rejects center IDs with spaces (label leak)",
        !v3.valid && v3.errors.some(e => e.includes("looks like a label")),
        `errors=${v3.errors[0]}`);

    // Non-string ID
    const badType = { ...goodCtx, risk_centers: [123] };
    const v4 = validateFceContext(badType);
    record("F", "validateFceContext rejects non-string IDs",
        !v4.valid && v4.errors.some(e => e.includes("must be a string id")),
        `errors=${v4.errors[0]}`);

    // applyFceRiskAdvisory
    const plan = { plan_id: "p1", risk_level: "low", actions: [] };
    const evidenceWithContested = {
        evidence_id: "e1", task_type: "coding", document_type: "EVIDENCE_PACK",
        fce_context: { ...goodCtx, contested_expressions: ["abc12345"] }
    };
    const w1 = applyFceRiskAdvisory(evidenceWithContested, plan);
    record("F", "applyFceRiskAdvisory escalates 'low' plan on contested_expression",
        w1.some(s => s.includes("FCE_ADVISORY") && s.includes("low")),
        w1.join(" | ") || "no warning");

    const evidenceWithResidue = {
        evidence_id: "e2", task_type: "coding", document_type: "EVIDENCE_PACK",
        fce_context: { ...goodCtx, high_residue_centers: ["aa", "bb", "cc"] }
    };
    const w2 = applyFceRiskAdvisory(evidenceWithResidue, plan);
    record("F", "applyFceRiskAdvisory warns on high_residue centers",
        w2.some(s => s.includes("high_residue")),
        w2.join(" | ") || "no warning");

    const evidenceAligned = {
        evidence_id: "e3", task_type: "coding", document_type: "EVIDENCE_PACK",
        fce_context: { ...goodCtx, aligned_reference_fields: ["aa", "bb"] }
    };
    const w3 = applyFceRiskAdvisory(evidenceAligned, plan);
    record("F", "applyFceRiskAdvisory notes 'context stable' but does NOT bypass approval",
        w3.some(s => s.includes("context stable") && s.includes("does NOT bypass")),
        w3.join(" | ") || "no note");
}

// ---------------------------------------------------------------------------
// G. End-to-end pipeline (memory → FCE → Claude → receipt)
// ---------------------------------------------------------------------------

async function testG_E2EPipeline() {
    if (!anthropic) {
        record("G", "E2E pipeline (skipped: no Anthropic key)", false);
        return;
    }
    const t0 = Date.now();
    const userMsg = "Remember: my favorite color is petrol blue and I dislike emojis.";
    const followUp = "Recall my color and emoji preference.";
    const thread = "verify:e2e";

    // Turn 1
    const s1 = await mem({
        action: "store", type: "conversation",
        data: { content: userMsg, role: "user", thread_id: thread, channel: "verify" }
    });
    const hits1 = await mem({ action: "search_all", query: userMsg, top_k: 5, threshold: 0.25 });
    const fce1 = await mem({ action: "fce_morphogenesis_report", query: userMsg });
    const r1 = await anthropic.messages.create({
        model: MODEL, max_tokens: 64,
        system: `You are BYON-Omni. Memory hits: ${hits1.body.conversation?.length || 0}. FCE: ${fce1.body.report?.morphogenesis_summary}. Acknowledge briefly.`,
        messages: [{ role: "user", content: userMsg }]
    });
    const reply1 = r1.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
    await mem({ action: "store", type: "conversation", data: { content: reply1, role: "assistant", thread_id: thread, channel: "verify" } });
    await mem({ action: "fce_assimilate_receipt", order_id: `verify:e2e:${s1.body.ctx_id}`, status: "success", based_on_evidence: thread });

    record("G", "turn 1 completes (store→recall→fce→claude→reply→assimilate)",
        !!reply1, `reply_len=${reply1.length}`);

    // Turn 2 — should recall preference
    const s2 = await mem({
        action: "store", type: "conversation",
        data: { content: followUp, role: "user", thread_id: thread, channel: "verify" }
    });
    const hits2 = await mem({ action: "search_all", query: followUp, top_k: 5, threshold: 0.25 });
    const fce2 = await mem({ action: "fce_morphogenesis_report", query: followUp });
    const r2 = await anthropic.messages.create({
        model: MODEL, max_tokens: 80,
        system: `You are BYON-Omni. Memory recall:\n${hits2.body.conversation?.slice(0, 3).map(h => `[${h.similarity.toFixed(2)}] ${h.content?.slice(0, 100)}`).join("\n") || "none"}\nFCE: ${fce2.body.report?.morphogenesis_summary}\nAnswer in ONE short sentence from memory.`,
        messages: [{ role: "user", content: followUp }]
    });
    const reply2 = r2.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
    await mem({ action: "store", type: "conversation", data: { content: reply2, role: "assistant", thread_id: thread, channel: "verify" } });

    record("G", "turn 2: memory recalls 'petrol blue' preference into prompt",
        hits2.body.conversation?.some(h => h.content?.toLowerCase().includes("petrol blue")),
        `top_sim=${hits2.body.conversation?.[0]?.similarity?.toFixed(2)}`);

    record("G", "turn 2: Claude reply mentions 'petrol blue' from memory",
        reply2.toLowerCase().includes("petrol") || reply2.toLowerCase().includes("blue"),
        `reply="${reply2.slice(0, 120)}"`);

    console.log(`\n  E2E reply 1: ${reply1.slice(0, 180)}`);
    console.log(`  E2E reply 2: ${reply2.slice(0, 180)}\n`);
}

// ---------------------------------------------------------------------------
// H. Persistence
// ---------------------------------------------------------------------------

async function testH_Persistence() {
    await mem({ action: "fce_consolidate" });
    // Auto-detect the active storage dir — service may use ./memory_storage
    // by default, or a per-run override. Pick whichever exists.
    const memSvcDir = path.resolve(__dirname, "..", "memory-service");
    const candidates = fs
        .readdirSync(memSvcDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name.startsWith("memory_storage"))
        .map(d => path.join(memSvcDir, d.name));
    let storageDir = null;
    for (const c of candidates) {
        if (fs.existsSync(path.join(c, "fcem", "fcem_snapshot.json"))) {
            storageDir = c;
            break;
        }
    }
    storageDir = storageDir || candidates[0] || path.join(memSvcDir, "memory_storage");

    const snap = path.join(storageDir, "fcem", "fcem_snapshot.json");
    const exists = fs.existsSync(snap);
    record("H", "fcem_snapshot.json persisted on consolidate",
        exists, exists ? `path=${path.basename(storageDir)}/fcem/fcem_snapshot.json` : "MISSING");

    if (exists) {
        const data = JSON.parse(fs.readFileSync(snap, "utf-8"));
        record("H", "snapshot contains version + omega_registry + advisory_feedback",
            data.version === "0.6.0" && data.omega_registry && Array.isArray(data.advisory_feedback),
            `version=${data.version} advisory=${data.advisory_feedback?.length}`);
    } else {
        record("H", "snapshot contains version + omega_registry + advisory_feedback",
            false, "snapshot missing");
    }

    const faissCode = path.join(storageDir, "faiss_code.bin");
    const faissConv = path.join(storageDir, "faiss_conversation.bin");
    const faissFact = path.join(storageDir, "faiss_fact.bin");
    record("H", "FAISS .bin files persisted (code/conv/fact)",
        fs.existsSync(faissCode) && fs.existsSync(faissConv) && fs.existsSync(faissFact),
        `code=${fs.existsSync(faissCode)} conv=${fs.existsSync(faissConv)} fact=${fs.existsSync(faissFact)}`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
    console.log("================================================================");
    console.log("  BYON-Omni Architecture Verification");
    console.log("================================================================");
    console.log(`  Memory: ${MEMORY_URL}`);
    console.log(`  Model : ${MODEL}`);
    console.log("================================================================\n");

    await testA_BackwardCompat();
    console.log();
    await testB_FceLayer();
    console.log();
    await testC_HybridMirror();
    console.log();
    await testD_ReceiptAssimilation();
    console.log();
    await testE_Claude();
    console.log();
    testF_AuditorGate();
    console.log();
    await testG_E2EPipeline();
    console.log();
    await testH_Persistence();

    console.log("\n================================================================");
    const pass = results.filter(r => r.ok).length;
    const fail = results.filter(r => !r.ok).length;
    const byCat = {};
    for (const r of results) {
        byCat[r.category] = byCat[r.category] || { pass: 0, fail: 0 };
        if (r.ok) byCat[r.category].pass++;
        else byCat[r.category].fail++;
    }
    console.log(`  TOTAL: ${pass}/${pass + fail} pass    ${fail} fail`);
    for (const cat of Object.keys(byCat).sort()) {
        const v = byCat[cat];
        const label = {
            A: "Memory-service base + backward compat",
            B: "FCE-M morphogenetic layer",
            C: "Hybrid mirror-write semantics",
            D: "Receipt assimilation",
            E: "Claude Sonnet 4.6 wiring",
            F: "Auditor gate (fce_context policy)",
            G: "End-to-end pipeline",
            H: "Persistence on disk",
        }[cat] || cat;
        console.log(`  ${cat}. ${label}: ${v.pass} pass / ${v.fail} fail`);
    }
    console.log("================================================================");

    if (fail > 0) {
        console.log("\nFailures detail:");
        for (const r of results.filter(r => !r.ok)) {
            console.log(`  - ${r.category} :: ${r.name} → ${r.detail}`);
        }
    }

    process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
    console.error("FATAL:", e);
    process.exit(2);
});
