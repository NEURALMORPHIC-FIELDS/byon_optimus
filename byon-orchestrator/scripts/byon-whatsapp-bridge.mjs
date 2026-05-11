#!/usr/bin/env node
/**
 * BYON-Omni WhatsApp Bridge (OpenClaw substitute, Baileys backend)
 * =================================================================
 *
 * Standalone Node.js bridge wiring WhatsApp ↔ BYON memory + FCE-M ↔
 * Claude Sonnet 4.6, plus post-reply assimilation back into FCE-Omega.
 *
 * Backend: @whiskeysockets/baileys (WebSocket, no browser, no Chromium).
 *
 * Pipeline per inbound message:
 *   1. store message as conversation (memory-service /action=store)
 *   2. search_all for related context (FAISS top-K)
 *   3. fetch FCE morphogenesis report (counts + hashed centers)
 *   4. ask Claude Sonnet 4.6 (system prompt embeds memory + FCE summary)
 *   5. send reply to WhatsApp
 *   6. store reply, run fce_assimilate_receipt as morphogenetic event
 *
 * Security:
 *   - No Auditor / no Executor in this path. Text-only conversational surface.
 *   - WhatsApp session stored under ./whatsapp-session/ (gitignored).
 *   - Allowlist via env BYON_WHATSAPP_ALLOW (comma-separated JIDs or "*").
 *
 * Run:
 *   cd byon-orchestrator
 *   node --env-file=../.env scripts/byon-whatsapp-bridge.mjs
 *
 * First run prints a QR code. Scan with WhatsApp → Settings → Linked Devices →
 * Link a Device. Session persists after that.
 */

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Boom } from "@hapi/boom";
import {
    makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import pino from "pino";
import Anthropic from "@anthropic-ai/sdk";
import {
    extractAndStoreFacts,
    formatFactsForPrompt,
} from "./lib/fact-extractor.mjs";
import { seedSystemFacts, renderCanonicalFactsBlock } from "./lib/byon-system-facts.mjs";

const CANONICAL_FACTS_BLOCK = renderCanonicalFactsBlock();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ORCHESTRATOR_ROOT = path.resolve(__dirname, "..");

const CONFIG = {
    memoryServiceUrl: process.env.MEMORY_SERVICE_URL || "http://localhost:8000",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.LLM_MODEL || "claude-sonnet-4-6",
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || "1024", 10),
    temperature: parseFloat(process.env.LLM_TEMPERATURE || "0.6"),
    sessionDir: path.join(ORCHESTRATOR_ROOT, "whatsapp-session"),
    allowlist: (process.env.BYON_WHATSAPP_ALLOW || "*")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    fceEnabled: (process.env.FCEM_ENABLED || "true").toLowerCase() === "true",
    requestTimeoutMs: 30000,
    botName: process.env.BYON_BOT_NAME || "BYON-Omni",
};

if (!CONFIG.anthropicApiKey) {
    console.error("[byon-bridge] FATAL: ANTHROPIC_API_KEY not set (load .env)");
    process.exit(2);
}

const anthropic = new Anthropic({ apiKey: CONFIG.anthropicApiKey });
const logger = pino({ level: "warn" }); // baileys is chatty at info

// ---------------------------------------------------------------------------
// Memory service client
// ---------------------------------------------------------------------------

async function memoryPost(payload, timeoutMs = CONFIG.requestTimeoutMs) {
    const r = await fetch(CONFIG.memoryServiceUrl + "/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${payload.action}`);
    return await r.json();
}

async function memoryHealth() {
    try {
        const r = await fetch(CONFIG.memoryServiceUrl + "/health", {
            signal: AbortSignal.timeout(3000),
        });
        return r.ok;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(fceCtx, memoryHits) {
    const fceSection = (() => {
        if (!fceCtx || !fceCtx.enabled) return "FCE-M layer: disabled.";
        const lines = [
            `FCE-M morphogenetic layer: enabled`,
            `  Omega (active/total): ${fceCtx.omega_active}/${fceCtx.omega_total}`,
            `  Contested expressions: ${fceCtx.omega_contested}`,
            `  Inexpressed/high-residue: ${fceCtx.omega_inexpressed}`,
            `  ReferenceFields: ${fceCtx.reference_fields_count}`,
            `  Advisory items: ${fceCtx.advisory_count} (priority=${fceCtx.priority_recommendations_count})`,
            `  Summary: ${fceCtx.morphogenesis_summary || "(none)"}`,
        ];
        return lines.join("\n");
    })();

    const memSection = (() => {
        if (
            !memoryHits ||
            (!memoryHits.conversation?.length && !memoryHits.facts?.length)
        ) {
            return "Memory recall: none for this query.";
        }
        // v0.6.2: prioritize canonical facts; conversation is secondary.
        const factsBlock = formatFactsForPrompt(memoryHits.facts || [], 8);
        const conv = (memoryHits.conversation || [])
            .slice(0, 5)
            .map(
                (h, i) =>
                    `  [conv ${i + 1}] (sim=${h.similarity.toFixed(2)}) ${(h.content || "").slice(0, 200)}`,
            )
            .join("\n");
        const parts = [];
        if (factsBlock) parts.push(`Canonical facts (authoritative for the user):\n${factsBlock}`);
        if (conv) parts.push(`Conversation history:\n${conv}`);
        return parts.length ? parts.join("\n\n") : "Memory recall: none for this query.";
    })();

    return [
        `You are ${CONFIG.botName}, an autonomous assistant agent owned by Vasile Lucian Borbeleac (FRAGMERGENT TECHNOLOGY S.R.L.).`,
        `Speak Romanian or English to match the user. Be direct, concise, useful.`,
        `You are connected to a FAISS semantic memory and an FCE-M (Fragmergent Causal Exponentiation Memory) morphogenetic layer.`,
        ``,
        // v0.6.4a — canonical BYON architecture facts always visible
        CANONICAL_FACTS_BLOCK,
        ``,
        memSection,
        ``,
        fceSection,
        ``,
        `Guidelines:`,
        `- If FCE-M reports HIGH RESIDUE or CONTESTED EXPRESSIONS, be cautious and flag uncertainty.`,
        `- You only TALK in this bridge. You cannot execute commands, edit files, or call external tools.`,
        `- Refuse harmful, illegal, or destructive requests politely.`,
        `- WhatsApp replies: keep under ~1500 chars unless asked otherwise.`,
    ].join("\n");
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

async function processMessage({ threadId, content, channel = "whatsapp" }) {
    const t0 = Date.now();
    const log = (label, extra = "") =>
        console.log(`[byon-bridge] ${label} (${Date.now() - t0}ms) ${extra}`);

    let inboundCtxId = null;
    try {
        const res = await memoryPost({
            action: "store",
            type: "conversation",
            data: { content, role: "user", thread_id: threadId, channel },
        });
        inboundCtxId = res?.ctx_id ?? null;
        log("stored inbound", `ctx_id=${inboundCtxId} fce=${res?.fce?.fce_status ?? "n/a"}`);
    } catch (e) {
        console.warn("[byon-bridge] memory store failed:", e.message);
    }

    // v0.6.2: extract & store canonical facts before recall.
    // Adapt mem signature for fact-extractor (returns shaped wrapper).
    extractAndStoreFacts({
        anthropic,
        model: CONFIG.model,
        mem: async (p) => {
            const body = await memoryPost(p).catch(() => null);
            return { body, ok: !!body };
        },
        text: content,
        role: "user",
        threadId,
        channel,
    })
        .then((r) => {
            if (r.facts.length > 0) {
                log("extracted facts", `count=${r.facts.length} kinds=[${r.facts.map(f => f.kind).join(",")}]`);
            }
        })
        .catch(() => null);

    const [memoryHits, fceCtx] = await Promise.all([
        memoryPost({
            action: "search_all",
            query: content,
            top_k: 5,
            threshold: 0.25,
            thread_id: threadId,
            scope: "thread", // v0.6.1: per-thread recall by default
        }).catch(() => null),
        CONFIG.fceEnabled
            ? memoryPost({
                  action: "fce_morphogenesis_report",
                  query: content,
              })
                  .then((r) => r?.report || null)
                  .catch(() => null)
            : Promise.resolve(null),
    ]);
    log(
        "recall+fce",
        `conv=${memoryHits?.conversation?.length || 0} facts=${memoryHits?.facts?.length || 0} fce=${fceCtx?.enabled ? "on" : "off"}`,
    );

    const systemPrompt = buildSystemPrompt(fceCtx, memoryHits);
    const aiStart = Date.now();
    let reply = "(empty reply)";
    let usage = { input: 0, output: 0 };
    try {
        const resp = await anthropic.messages.create({
            model: CONFIG.model,
            max_tokens: CONFIG.maxTokens,
            temperature: CONFIG.temperature,
            system: systemPrompt,
            messages: [{ role: "user", content }],
        });
        reply = resp.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("\n")
            .trim();
        usage = { input: resp.usage.input_tokens, output: resp.usage.output_tokens };
    } catch (e) {
        console.warn("[byon-bridge] anthropic call failed:", e.message);
        reply = `Eroare la modelul Claude: ${e.message}`;
    }
    log(
        "claude reply",
        `${reply.length} chars in ${Date.now() - aiStart}ms tokens=${usage.input}/${usage.output}`,
    );

    try {
        const res = await memoryPost({
            action: "store",
            type: "conversation",
            data: { content: reply, role: "assistant", thread_id: threadId, channel },
        });
        log("stored reply", `ctx_id=${res?.ctx_id}`);
    } catch (e) {
        console.warn("[byon-bridge] memory store reply failed:", e.message);
    }

    try {
        if (CONFIG.fceEnabled) {
            await memoryPost({
                action: "fce_assimilate_receipt",
                order_id: `whatsapp:${threadId}:${inboundCtxId}`,
                status: "success",
                based_on_evidence: threadId,
                summary: { tokens: usage, latency_ms: Date.now() - t0 },
            });
        }
    } catch (e) {
        console.warn("[byon-bridge] fce assimilate receipt failed:", e.message);
    }

    return { reply, latencyMs: Date.now() - t0, tokens: usage };
}

// ---------------------------------------------------------------------------
// WhatsApp socket
// ---------------------------------------------------------------------------

function isAllowed(jid) {
    if (CONFIG.allowlist.includes("*")) return true;
    return CONFIG.allowlist.includes(jid);
}

async function startBridge() {
    fs.mkdirSync(CONFIG.sessionDir, { recursive: true });

    const healthy = await memoryHealth();
    if (!healthy) {
        console.error(
            `[byon-bridge] FATAL: memory service unreachable at ${CONFIG.memoryServiceUrl}/health`,
        );
        console.error(`[byon-bridge] Start it first: python memory-service/server.py`);
        process.exit(3);
    }
    console.log(`[byon-bridge] memory service OK at ${CONFIG.memoryServiceUrl}`);

    // v0.6.4a — seed canonical BYON architecture facts (idempotent).
    const seedMem = async (p) => {
        const body = await memoryPost(p).catch(() => null);
        return { body, ok: !!body };
    };
    const seed = await seedSystemFacts(seedMem, { verbose: false }).catch(() => null);
    if (seed && !seed.skipped) {
        console.log(`[byon-bridge] v0.6.4a: ${seed.seeded} system facts seeded.`);
    } else if (seed?.skipped) {
        console.log(`[byon-bridge] v0.6.4a: system facts already present, skipped.`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(CONFIG.sessionDir);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(
        `[byon-bridge] WhatsApp Web version ${version.join(".")} (latest=${isLatest})`,
    );

    // Unique device identifier — prevents WhatsApp's "device_removed" 401
    // conflict where two sessions claim the same browser fingerprint.
    const deviceLabel =
        process.env.BYON_DEVICE_LABEL ||
        `BYON-Omni@${os.hostname() || "host"}`;

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false, // we render the QR ourselves
        logger,
        browser: [deviceLabel, "Desktop", "1.0.0"],
        syncFullHistory: false,
        markOnlineOnConnect: false, // less aggressive about claiming presence
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log(
                "\n[byon-bridge] Scan this QR with WhatsApp (Settings → Linked Devices → Link a Device):\n",
            );
            qrcode.generate(qr, { small: true });
        }
        if (connection === "close") {
            const code =
                lastDisconnect?.error instanceof Boom
                    ? lastDisconnect.error.output?.statusCode
                    : 0;
            const reconnect = code !== DisconnectReason.loggedOut;
            console.warn(
                `[byon-bridge] connection closed (code=${code}, reconnect=${reconnect})`,
            );
            if (reconnect) {
                setTimeout(startBridge, 3000);
            } else {
                console.error(
                    "[byon-bridge] logged out — delete ./whatsapp-session/ and re-scan to re-link.",
                );
                process.exit(1);
            }
        } else if (connection === "open") {
            console.log(
                `[byon-bridge] READY. Logged in as ${sock.user?.id ?? "(unknown)"}. ` +
                    `Allowlist: ${CONFIG.allowlist.join(", ")}. ` +
                    `Model: ${CONFIG.model}. FCE-M: ${CONFIG.fceEnabled ? "on" : "off"}.`,
            );
        }
    });

    // Trigger prefix for SELF-messages — lets the owner DM themselves
    // (or "Message Yourself" chat) using a command word.
    const SELF_TRIGGER = (process.env.BYON_SELF_TRIGGER || "/byon").toLowerCase();

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        for (const msg of messages) {
            if (!msg.message) continue;
            const jid = msg.key.remoteJid;
            if (!jid) continue;

            // Extract plain text (conversation or extended)
            const rawText =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption ||
                "";
            if (!rawText.trim()) continue;

            let text = rawText.trim();

            // Self-messages: require explicit trigger so we don't loop on our own replies
            if (msg.key.fromMe) {
                if (!text.toLowerCase().startsWith(SELF_TRIGGER)) {
                    continue;
                }
                // strip the trigger
                text = text.slice(SELF_TRIGGER.length).trim();
                if (!text) {
                    // empty after trigger — treat as greeting
                    text = "salut";
                }
            }

            if (!isAllowed(jid)) {
                console.log(`[byon-bridge] ignoring ${jid} (not on allowlist)`);
                continue;
            }

            console.log(
                `[byon-bridge] msg ${msg.key.fromMe ? "(self)" : "from"} ${jid}: ${text.slice(0, 80)}`,
            );
            try {
                const { reply } = await processMessage({
                    threadId: jid,
                    content: text,
                    channel: "whatsapp",
                });
                await sock.sendMessage(jid, { text: reply || "(no reply)" });
            } catch (e) {
                console.error("[byon-bridge] processMessage failed:", e);
                try {
                    await sock.sendMessage(jid, {
                        text: `Eroare internă: ${e.message}`,
                    });
                } catch {
                    // ignore
                }
            }
        }
    });

    return sock;
}

startBridge().catch((e) => {
    console.error("[byon-bridge] FATAL:", e);
    process.exit(1);
});
