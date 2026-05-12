#!/usr/bin/env node
/**
 * BYON Operator-Verified Domain Knowledge CLI (v0.6.8)
 * =====================================================
 *
 * The ONLY production path to create a DOMAIN_VERIFIED fact.
 * Server-side channel-gated to "operator-cli" or "domain-ingestion-tool".
 *
 * Trust hierarchy (v0.6.8):
 *   [1] SYSTEM_CANONICAL
 *   [2] VERIFIED_PROJECT_FACT
 *   [3] DOMAIN_VERIFIED         (THIS TOOL — operator only)
 *   [4] USER_PREFERENCE
 *   [5] EXTRACTED_USER_CLAIM
 *   [6] DISPUTED_OR_UNSAFE      (includes EXPIRED domain facts)
 *
 * Domain facts go to thread_id=null (global) so they are visible across
 * all threads, but are filtered by jurisdiction + scope at query time.
 *
 * Required metadata for every domain fact:
 *   --domain <str>        (e.g. construction, legal, tax, infosec)
 *   --jurisdiction <str>  (e.g. EU, Germany/Bavaria, Romania)
 *   --subject <str>
 *   --predicate <str>
 *   --object <str>
 *   --source-name <str>   OR --source-url <url>   OR --source-path <path>
 *   --retrieved-at <ISO-8601 date>
 *   --effective-from <ISO-8601 date | unknown>
 *   --review-after <ISO-8601 date>
 *   --citation <str>      (short citation string for inline output)
 *   --operator <id>
 *
 * Optional:
 *   --kind <one of: domain_fact|legal_rule|technical_standard|
 *                   regulatory_constraint|official_document|
 *                   internal_policy|safety_procedure|industry_standard>
 *   --source-type <law|standard|manual|official_doc|internal_policy|...>
 *   --version <str>
 *   --scope <global|project|client:<id>|jurisdiction>
 *   --supersedes <ctx1,ctx2,...>
 *
 * Subcommands:
 *   add-domain     create a DOMAIN_VERIFIED fact
 *   list-domain    list active domain facts (filters: --jurisdiction --domain --kind --scope --include-revoked --include-expired)
 *   revoke-domain  demote to DISPUTED_OR_UNSAFE  (--ctx-id --reason --operator)
 *   review-domain  list domain facts past review_after
 *   search-domain  domain-only semantic search   (--query --jurisdiction --domain --top-k)
 *   expire-domain  alias of revoke-domain with reason=expired
 *
 * Env:
 *   MEMORY_SERVICE_URL  default http://localhost:8000
 *   BYON_DOMAIN_CHANNEL default "operator-cli"  (the other allowed is "domain-ingestion-tool")
 *
 * Usage example (Bavaria construction standard, freeze-resistant adhesive):
 *
 *   node scripts/byon-domain.mjs add-domain \
 *     --domain construction --jurisdiction "Germany/Bavaria" \
 *     --kind technical_standard \
 *     --subject "exterior-travertine-installation" \
 *     --predicate requires \
 *     --object "freeze-resistant adhesive and movement joints per manufacturer spec" \
 *     --source-name "Baumit technical sheet 2024" \
 *     --source-url "https://baumit.de/..." \
 *     --source-type standard \
 *     --retrieved-at 2026-05-12 --effective-from 2024-01-01 --review-after 2026-11-12 \
 *     --version "2024-01" \
 *     --citation "Baumit TS 2024 §3.2 (Bavaria)" \
 *     --operator lucian
 */

const MEMORY_URL = process.env.MEMORY_SERVICE_URL || "http://localhost:8000";
const CHANNEL = process.env.BYON_DOMAIN_CHANNEL || "operator-cli";

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

function dashKey(k) { return k.replace(/-/g, "_"); }

function pickData(args, fields) {
    const out = { channel: CHANNEL };
    for (const f of fields) {
        const v = args[f] !== undefined ? args[f] : args[dashKey(f)];
        if (v !== undefined) out[dashKey(f)] = v;
    }
    return out;
}

async function cmdAddDomain(args) {
    const required = [
        "domain", "jurisdiction",
        "subject", "predicate", "object",
        "retrieved-at", "effective-from", "review-after",
        "citation", "operator",
    ];
    for (const f of required) {
        const v = args[f] ?? args[dashKey(f)];
        if (!v || typeof v !== "string" || !v.trim()) fail(`--${f} is required (non-empty string)`);
    }
    const hasSource = ["source-name", "source-url", "source-path"]
        .some(f => typeof (args[f] ?? args[dashKey(f)]) === "string" && (args[f] ?? args[dashKey(f)]).trim());
    if (!hasSource) fail("at least one of --source-name / --source-url / --source-path is required");

    const data = {
        channel: CHANNEL,
        domain: args.domain,
        jurisdiction: args.jurisdiction,
        kind: args.kind || "domain_fact",
        subject: args.subject,
        predicate: args.predicate,
        object: args.object,
        source_name: args["source-name"] || args.source_name,
        source_url:  args["source-url"]  || args.source_url,
        source_path: args["source-path"] || args.source_path,
        source_type: args["source-type"] || args.source_type || "unspecified",
        retrieved_at:   args["retrieved-at"]   || args.retrieved_at,
        effective_from: args["effective-from"] || args.effective_from,
        review_after:   args["review-after"]   || args.review_after,
        version: args.version || null,
        citation: args.citation,
        operator: args.operator,
        ingested_by: args.operator,
        scope: args.scope || "global",
        supersedes: args.supersedes
            ? String(args.supersedes).split(",").map(s => parseInt(s.trim(), 10)).filter(n => !Number.isNaN(n))
            : [],
    };
    const res = await mem({ action: "domain_fact_add", data });
    console.log(JSON.stringify(res, null, 2));
}

async function cmdRevokeDomain(args) {
    const ctxId = args["ctx-id"] !== undefined ? parseInt(args["ctx-id"], 10) : undefined;
    const reason = args.reason || "operator revoke";
    const operator = args.operator;
    if (Number.isNaN(ctxId) || ctxId === undefined) fail("--ctx-id required (integer)");
    if (!operator || !operator.trim()) fail("--operator required");
    const res = await mem({
        action: "domain_fact_revoke",
        data: { ctx_id: ctxId, reason, operator, channel: CHANNEL },
    });
    console.log(JSON.stringify(res, null, 2));
}

async function cmdExpireDomain(args) {
    args.reason = args.reason || "operator-marked expired";
    return cmdRevokeDomain(args);
}

async function cmdListDomain(args) {
    const data = {};
    for (const k of ["jurisdiction", "domain", "kind", "scope"]) if (args[k]) data[k] = args[k];
    if (args["include-revoked"]) data.include_revoked = true;
    if (args["include-expired"]) data.include_expired = true;
    const res = await mem({ action: "domain_fact_list", data });
    if (args.json) { console.log(JSON.stringify(res, null, 2)); return; }
    console.log(`Domain-verified facts (${res.count}):`);
    console.log("");
    for (const f of res.facts || []) {
        const status = [f.revoked && "[REVOKED]", f.expired && "[EXPIRED]"].filter(Boolean).join(" ");
        console.log(`  #${f.ctx_id} ${status}`);
        console.log(`    fact:          ${f.fact}`);
        console.log(`    domain:        ${f.domain}`);
        console.log(`    jurisdiction:  ${f.jurisdiction}`);
        console.log(`    kind:          ${f.kind}`);
        console.log(`    source:        ${f.source_name || f.source_url || f.source_path}`);
        console.log(`    retrieved_at:  ${f.retrieved_at}`);
        console.log(`    effective:     ${f.effective_from} → review_after ${f.review_after}`);
        if (f.version) console.log(`    version:       ${f.version}`);
        console.log(`    citation:      ${f.citation}`);
        console.log("");
    }
}

async function cmdReviewDomain(args) {
    const res = await mem({ action: "domain_fact_review", data: {} });
    if (args.json) { console.log(JSON.stringify(res, null, 2)); return; }
    console.log(`Domain facts past review_after (${res.count}):`);
    for (const f of res.facts || []) {
        console.log(`  #${f.ctx_id}  domain=${f.domain}  jurisdiction=${f.jurisdiction}  review_after=${f.review_after}  ${f.days_overdue}d overdue`);
        console.log(`    fact: ${f.fact}`);
    }
}

async function cmdSearchDomain(args) {
    if (!args.query) fail("--query required");
    const data = { query: args.query, top_k: parseInt(args["top-k"] || "10", 10) };
    if (args.jurisdiction) data.jurisdiction = args.jurisdiction;
    if (args.domain) data.domain = args.domain;
    const res = await mem({ action: "domain_fact_search", data });
    if (args.json) { console.log(JSON.stringify(res, null, 2)); return; }
    console.log(`Search hits (${res.count}):`);
    for (const r of res.results || []) {
        console.log(`  #${r.ctx_id}  sim=${r.similarity.toFixed(2)}  ${r.jurisdiction}  ${r.fact}`);
        console.log(`    citation: ${r.citation}   retrieved=${r.retrieved_at}  review_after=${r.review_after}${r.revoked ? "  [REVOKED]" : ""}`);
    }
}

function usage() {
    console.log(`BYON Operator-Verified Domain Knowledge CLI (v0.6.8)

Subcommands:
  add-domain      Create a DOMAIN_VERIFIED fact (full schema required)
  list-domain     List active facts (filters: --jurisdiction --domain --kind --scope --include-revoked --include-expired --json)
  revoke-domain   Mark fact revoked (demote to DISPUTED_OR_UNSAFE) (--ctx-id --reason --operator)
  expire-domain   Alias of revoke-domain with reason=expired
  review-domain   List facts past review_after
  search-domain   Domain-only semantic search (--query --jurisdiction --domain --top-k --json)

Server-side: writes require channel in {operator-cli, domain-ingestion-tool}.
There is NO conversational path to DOMAIN_VERIFIED.
`);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const cmd = args._[0];
    if (!cmd || args.help || args.h) { usage(); return; }
    try {
        switch (cmd) {
            case "add-domain":     await cmdAddDomain(args); break;
            case "list-domain":    await cmdListDomain(args); break;
            case "revoke-domain":  await cmdRevokeDomain(args); break;
            case "expire-domain":  await cmdExpireDomain(args); break;
            case "review-domain":  await cmdReviewDomain(args); break;
            case "search-domain":  await cmdSearchDomain(args); break;
            default: usage(); process.exit(2);
        }
    } catch (e) {
        if (e.status === 403) {
            console.error(`FATAL: server rejected with 403 — domain-fact writes are channel-gated.`);
            console.error(`Detail: ${e.body?.detail || e.message}`);
            process.exit(3);
        }
        if (e.status === 400) {
            console.error(`FATAL: server rejected with 400 — schema validation failed.`);
            console.error(`Detail: ${e.body?.detail || e.message}`);
            process.exit(4);
        }
        console.error(`FATAL: ${e.message}`);
        if (e.body) console.error(JSON.stringify(e.body, null, 2));
        process.exit(1);
    }
}

main();
