#!/usr/bin/env node
/**
 * BYON Operator-Verified Facts CLI (v0.6.6)
 * ==========================================
 *
 * The ONLY production path to create a VERIFIED_PROJECT_FACT.
 * Channel-gated on the server side (channel=operator-cli).
 *
 * Trust hierarchy reminder:
 *   [1] SYSTEM_CANONICAL          (canonical-facts seeder only)
 *   [2] VERIFIED_PROJECT_FACT     (THIS TOOL — operator only)
 *   [3] USER_PREFERENCE           (extractor from conversation)
 *   [4] EXTRACTED_USER_CLAIM      (extractor from conversation, default)
 *   [5] DISPUTED_OR_UNSAFE        (adversarial pattern + revoked verified)
 *
 * Verified facts go to thread_id=null (global) so they are visible
 * across all threads. They sit above user-claimed memory but below
 * the 18-entry canonical corpus. They can be revoked; revoked facts
 * are demoted to DISPUTED_OR_UNSAFE and hidden from prompt rendering.
 *
 * Usage:
 *   node scripts/byon-facts.mjs add-verified \
 *       --subject "byon.version" --predicate "is" --object "v0.6.6-..." \
 *       --evidence "tag + CI run url" --operator lucian [--scope global]
 *
 *   node scripts/byon-facts.mjs list-verified [--scope global] [--include-revoked]
 *
 *   node scripts/byon-facts.mjs revoke-verified \
 *       --ctx-id <id> --reason "<text>" --operator lucian
 *
 *   node scripts/byon-facts.mjs verify-existing --ctx-id <id> \
 *       --operator lucian --evidence "<text>"
 *       (not supported in v0.6.6 — re-add as new verified fact instead)
 *
 * Environment:
 *   MEMORY_SERVICE_URL    default http://localhost:8000
 */

const MEMORY_URL = process.env.MEMORY_SERVICE_URL || "http://localhost:8000";
const CHANNEL = "operator-cli";

function parseArgs(argv) {
    const out = { _: [] };
    let i = 0;
    while (i < argv.length) {
        const a = argv[i];
        if (a.startsWith("--")) {
            const k = a.slice(2);
            const v = (i + 1 < argv.length && !argv[i + 1].startsWith("--")) ? argv[++i] : true;
            out[k] = v;
        } else {
            out._.push(a);
        }
        i++;
    }
    return out;
}

async function mem(payload) {
    const r = await fetch(MEMORY_URL + "/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
        const err = new Error(`HTTP ${r.status}: ${body.detail || JSON.stringify(body).slice(0, 200)}`);
        err.status = r.status;
        err.body = body;
        throw err;
    }
    return body;
}

function fail(msg, code = 2) {
    console.error("FATAL:", msg);
    process.exit(code);
}

async function cmdAddVerified(args) {
    const subject = args.subject;
    const predicate = args.predicate;
    const object = args.object;
    const operator = args.operator;
    const evidence = args.evidence;
    const scope = args.scope || "global";
    const supersedes = args.supersedes
        ? String(args.supersedes).split(",").map(s => parseInt(s.trim(), 10)).filter(n => !Number.isNaN(n))
        : [];

    for (const [k, v] of Object.entries({ subject, predicate, object, operator, evidence })) {
        if (!v || typeof v !== "string" || !v.trim()) {
            fail(`--${k} is required (non-empty string)`);
        }
    }

    const res = await mem({
        action: "verified_fact_add",
        data: { subject, predicate, object, operator, evidence, scope, supersedes, channel: CHANNEL },
    });
    console.log(JSON.stringify(res, null, 2));
}

async function cmdRevokeVerified(args) {
    const ctxId = args["ctx-id"] !== undefined ? parseInt(args["ctx-id"], 10) : undefined;
    const reason = args.reason;
    const operator = args.operator;

    if (Number.isNaN(ctxId) || ctxId === undefined) fail("--ctx-id required (integer)");
    if (!reason || !reason.trim()) fail("--reason required");
    if (!operator || !operator.trim()) fail("--operator required");

    const res = await mem({
        action: "verified_fact_revoke",
        data: { ctx_id: ctxId, reason, operator, channel: CHANNEL },
    });
    console.log(JSON.stringify(res, null, 2));
}

async function cmdListVerified(args) {
    const data = { channel: CHANNEL };
    if (args.scope) data.scope = args.scope;
    if (args["include-revoked"]) data.include_revoked = true;

    const res = await mem({ action: "verified_fact_list", data });
    if (args.json) {
        console.log(JSON.stringify(res, null, 2));
        return;
    }
    console.log(`Verified facts (${res.count}):`);
    console.log("");
    for (const f of res.facts || []) {
        const status = f.revoked ? "[REVOKED]" : "";
        console.log(`  #${f.ctx_id} ${status}`);
        console.log(`    fact:     ${f.fact}`);
        console.log(`    operator: ${f.operator}`);
        console.log(`    scope:    ${f.scope}`);
        console.log(`    evidence: ${f.evidence}`);
        if (f.supersedes?.length) console.log(`    supersedes: ${f.supersedes.join(", ")}`);
        if (f.revoked) {
            console.log(`    revoked_by:     ${f.revoked_by}`);
            console.log(`    revoked_reason: ${f.revoked_reason}`);
        }
        console.log("");
    }
}

function usage() {
    console.log(`BYON Operator-Verified Facts CLI

Subcommands:
  add-verified     Create a new VERIFIED_PROJECT_FACT
                   Required: --subject --predicate --object --evidence --operator
                   Optional: --scope (default global) --supersedes ctx1,ctx2,...

  list-verified    List active verified facts
                   Optional: --scope <s> --include-revoked --json

  revoke-verified  Mark a verified fact revoked
                   Required: --ctx-id <id> --reason "<text>" --operator <id>

Server-side enforcement: writes require channel=operator-cli. There is
NO conversational path to VERIFIED_PROJECT_FACT.
`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const cmd = args._[0];

    if (!cmd || args.help || args.h) { usage(); return; }

    try {
        switch (cmd) {
            case "add-verified":    await cmdAddVerified(args); break;
            case "list-verified":   await cmdListVerified(args); break;
            case "revoke-verified": await cmdRevokeVerified(args); break;
            default: usage(); process.exit(2);
        }
    } catch (e) {
        if (e.status === 403) {
            console.error(`FATAL: server rejected with 403 — verified-fact writes are channel-gated.`);
            console.error(`Detail: ${e.body?.detail || e.message}`);
            process.exit(3);
        }
        console.error(`FATAL: ${e.message}`);
        if (e.body) console.error(JSON.stringify(e.body, null, 2));
        process.exit(1);
    }
}

main();
