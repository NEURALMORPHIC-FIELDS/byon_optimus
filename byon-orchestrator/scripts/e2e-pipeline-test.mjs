#!/usr/bin/env node
/**
 * BYON-Omni End-to-End Pipeline Test (no WhatsApp scan needed)
 * =============================================================
 *
 * Exercises the same pipeline byon-whatsapp-bridge.mjs uses, but with
 * synthetic messages — so we validate the full chain without needing
 * the user to physically scan a QR code:
 *
 *   message → memory store (FAISS + FCE)
 *           → memory search_all
 *           → fce_morphogenesis_report
 *           → Claude Sonnet 4.6
 *           → store reply
 *           → fce_assimilate_receipt
 *
 * After several turns, dump the FCE state to show that morphogenesis
 * advanced and that the asimilare cycle ran.
 *
 * Run:
 *   cd byon-orchestrator
 *   node --env-file=../.env scripts/e2e-pipeline-test.mjs
 */

import Anthropic from "@anthropic-ai/sdk";

const MEMORY_URL = process.env.MEMORY_SERVICE_URL || "http://localhost:8000";
const MODEL = process.env.LLM_MODEL || "claude-sonnet-4-6";
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
    console.error("FATAL: ANTHROPIC_API_KEY missing");
    process.exit(2);
}
const anthropic = new Anthropic({ apiKey });

async function mem(payload) {
    const r = await fetch(MEMORY_URL + "/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
}

function buildSystem(fce, hits) {
    const memSec = hits?.conversation?.length
        ? hits.conversation
              .slice(0, 3)
              .map((h, i) => `[mem ${i + 1}] sim=${h.similarity.toFixed(2)} ${(h.content || "").slice(0, 100)}`)
              .join("\n")
        : "no memory";
    const fceSec = fce?.enabled
        ? `omega=${fce.omega_active}/${fce.omega_total} contested=${fce.omega_contested} adv=${fce.advisory_count} summary=${fce.morphogenesis_summary}`
        : "fce disabled";
    return `You are BYON-Omni. Be terse. Romanian or English. Memory:\n${memSec}\nFCE-M: ${fceSec}`;
}

async function turn(threadId, content) {
    const t0 = Date.now();
    const trace = {};
    trace.input = content;

    // 1. store inbound
    const sIn = await mem({
        action: "store",
        type: "conversation",
        data: { content, role: "user", thread_id: threadId, channel: "e2e" },
    });
    trace.inbound_ctx_id = sIn.ctx_id;
    trace.fce_inbound = sIn.fce?.fce_status;

    // 2. recall + fce
    const [hits, fceRes] = await Promise.all([
        mem({ action: "search_all", query: content, top_k: 5, threshold: 0.25 }),
        mem({ action: "fce_morphogenesis_report", query: content }),
    ]);
    trace.recall = { conv: hits.conversation?.length, facts: hits.facts?.length };
    trace.fce_summary = fceRes.report?.morphogenesis_summary;

    // 3. Claude
    const aiStart = Date.now();
    const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 256,
        temperature: 0.5,
        system: buildSystem(fceRes.report, hits),
        messages: [{ role: "user", content }],
    });
    trace.claude_ms = Date.now() - aiStart;
    trace.tokens = { in: resp.usage.input_tokens, out: resp.usage.output_tokens };
    const reply = resp.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
    trace.reply = reply.slice(0, 200);

    // 4. store reply
    const sOut = await mem({
        action: "store",
        type: "conversation",
        data: { content: reply, role: "assistant", thread_id: threadId, channel: "e2e" },
    });
    trace.reply_ctx_id = sOut.ctx_id;

    // 5. fce assimilate (success)
    const fceAsim = await mem({
        action: "fce_assimilate_receipt",
        order_id: `e2e:${threadId}:${sIn.ctx_id}`,
        status: "success",
        based_on_evidence: threadId,
        summary: trace.tokens,
    });
    trace.fce_asim = fceAsim.fce_status;
    trace.total_ms = Date.now() - t0;
    return trace;
}

async function main() {
    console.log("=== BYON-Omni E2E Pipeline Test ===");
    console.log(`Memory: ${MEMORY_URL}`);
    console.log(`Model:  ${MODEL}\n`);

    // Sanity
    const h = await mem({ action: "ping" });
    console.log(`ping OK version=${h.version}`);
    const s0 = await mem({ action: "fce_state" });
    console.log(`initial FCE: ${JSON.stringify(s0.state)}\n`);

    // 5 turns to drive some morphogenesis
    const thread = "e2e:lucian-test";
    const dialogue = [
        "Salut! Cum se numește acest proiect?",
        "Ce este FCE-M?",
        "Cum protejează Auditor-ul execuția?",
        "Repetăm: BYON înseamnă...?",
        "Și care e diferența între OmegaRecord și ReferenceField?",
    ];

    for (let i = 0; i < dialogue.length; i++) {
        console.log(`--- Turn ${i + 1}: ${dialogue[i]} ---`);
        const t = await turn(thread, dialogue[i]);
        console.log(
            `  in_ctx=${t.inbound_ctx_id} fce_in=${t.fce_inbound} recall=${t.recall.conv}/${t.recall.facts} ` +
                `claude=${t.claude_ms}ms tokens=${t.tokens.in}/${t.tokens.out} fce_asim=${t.fce_asim} ` +
                `total=${t.total_ms}ms`,
        );
        console.log(`  fce_ctx: ${t.fce_summary}`);
        console.log(`  reply:   ${t.reply}\n`);
    }

    // Final state
    console.log("=== Final FCE state ===");
    const sFinal = await mem({ action: "fce_state" });
    console.log(JSON.stringify(sFinal.state, null, 2));

    console.log("\n=== Final advisory (priority) ===");
    const advFinal = await mem({ action: "fce_priority_recommendations" });
    console.log(JSON.stringify(advFinal.recommendations?.slice(0, 5) || [], null, 2));

    console.log("\n=== Memory stats ===");
    const stats = await mem({ action: "stats" });
    console.log(JSON.stringify(stats, null, 2));

    console.log("\n=== DONE ===");
}

main().catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
});
