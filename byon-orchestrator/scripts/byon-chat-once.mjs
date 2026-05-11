#!/usr/bin/env node
/**
 * BYON-Omni one-shot chat CLI (bypasses WhatsApp transport).
 *
 * Sends one message through the SAME pipeline the WhatsApp bridge uses:
 *   store conversation → search_all → fce_morphogenesis_report
 *   → Claude Sonnet 4.6 → store reply → fce_assimilate_receipt
 *
 * Usage:
 *   node --env-file=../.env scripts/byon-chat-once.mjs "your question here"
 *
 *   ENV:
 *     BYON_CHAT_THREAD  thread id (default "cli:default")
 */

import Anthropic from "@anthropic-ai/sdk";

const MEMORY_URL = process.env.MEMORY_SERVICE_URL || "http://localhost:8000";
const MODEL = process.env.LLM_MODEL || "claude-sonnet-4-6";
const THREAD = process.env.BYON_CHAT_THREAD || "cli:default";

const userMsg = process.argv.slice(2).join(" ").trim();
if (!userMsg) {
    console.error("usage: node scripts/byon-chat-once.mjs <message>");
    process.exit(2);
}
if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY missing");
    process.exit(2);
}
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function mem(p) {
    const r = await fetch(MEMORY_URL + "/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
        signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
}

function buildSystem(fce, hits) {
    const memSec = hits?.conversation?.length
        ? hits.conversation
              .slice(0, 5)
              .map(
                  (h, i) =>
                      `[mem ${i + 1}] sim=${h.similarity.toFixed(2)} ${(h.content || "").slice(0, 200)}`,
              )
              .join("\n")
        : "no memory recall";
    const fceSec = fce?.enabled
        ? `omega=${fce.omega_active}/${fce.omega_total} contested=${fce.omega_contested} adv=${fce.advisory_count} prio=${fce.priority_recommendations_count} summary=${fce.morphogenesis_summary}`
        : "fce disabled";
    return [
        `You are BYON-Omni, an autonomous assistant agent owned by Vasile Lucian Borbeleac (FRAGMERGENT TECHNOLOGY S.R.L.).`,
        `Speak Romanian or English to match the user. Be direct, concise, useful.`,
        `Memory (FAISS recall):\n${memSec}`,
        `FCE-M state: ${fceSec}`,
        `Guidelines: if FCE reports high_residue/contested, flag uncertainty. You can only TALK in this surface — no commands, no tools.`,
    ].join("\n\n");
}

async function main() {
    const t0 = Date.now();

    const sIn = await mem({
        action: "store",
        type: "conversation",
        data: { content: userMsg, role: "user", thread_id: THREAD, channel: "cli" },
    });

    const [hits, fceRes] = await Promise.all([
        mem({ action: "search_all", query: userMsg, top_k: 5, threshold: 0.25 }),
        mem({ action: "fce_morphogenesis_report", query: userMsg }),
    ]);

    const claudeStart = Date.now();
    const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 512,
        temperature: 0.5,
        system: buildSystem(fceRes.report, hits),
        messages: [{ role: "user", content: userMsg }],
    });
    const claudeMs = Date.now() - claudeStart;

    const reply = resp.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

    await mem({
        action: "store",
        type: "conversation",
        data: { content: reply, role: "assistant", thread_id: THREAD, channel: "cli" },
    });

    await mem({
        action: "fce_assimilate_receipt",
        order_id: `cli:${THREAD}:${sIn.ctx_id}`,
        status: "success",
        based_on_evidence: THREAD,
        summary: { tokens: { in: resp.usage.input_tokens, out: resp.usage.output_tokens } },
    });

    const totalMs = Date.now() - t0;
    console.log(
        `--- in_ctx=${sIn.ctx_id} recall=${hits.conversation?.length || 0} fce=${fceRes.report?.morphogenesis_summary || "off"} claude=${claudeMs}ms total=${totalMs}ms tokens=${resp.usage.input_tokens}/${resp.usage.output_tokens} ---`,
    );
    console.log("\n[BYON]:");
    console.log(reply);
}

main().catch((e) => {
    console.error("FATAL:", e.message);
    process.exit(1);
});
