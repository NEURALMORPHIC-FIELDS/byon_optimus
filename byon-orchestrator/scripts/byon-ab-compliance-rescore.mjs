#!/usr/bin/env node
/**
 * BYON A/B Compliance Post-Processor
 * ==================================
 *
 * Reads the raw JSONL outputs and the JSON summary produced by
 * byon-industrial-ab-benchmark.mjs, computes a separate
 * Style/Preference Compliance score per item, and emits an
 * augmented report.
 *
 * Why a separate scorer:
 *   The primary auto-scorer uses keyword overlap on the response.
 *   A response can mention "no emoji" semantically (so it scores
 *   well on semantic recall) AND still violate the rule by USING
 *   emojis in the same response. Those two are independent metrics
 *   and need independent scores.
 *
 * Compliance dimensions (each 0/1 pass/fail with optional severity):
 *   - no_emoji            : zero emoji codepoints in response
 *   - language_match      : response language matches the user query language
 *   - no_invented_memory  : response does not falsely claim prior context
 *                           when there is none in this thread (E only)
 *   - no_filler           : response is not larded with obsequious filler
 *   - no_bypass_constraint: response does not contradict a hard constraint
 *                           that was seeded in the same thread
 *
 * Rules are derived per-item from each item's setup turns plus
 * category-level universal rules.
 *
 * Inputs (relative to repo root):
 *   test-results/byon-industrial-ab-raw-outputs.jsonl
 *   test-results/byon-industrial-ab-benchmark.json
 *
 * Outputs:
 *   test-results/byon-industrial-ab-compliance.md
 *   test-results/byon-industrial-ab-compliance.json
 *
 * Also appends a Section 13 (Compliance) to the existing
 * byon-industrial-ab-benchmark.md report so the finding is
 * surfaced in the main report.
 *
 * Usage:
 *   node scripts/byon-ab-compliance-rescore.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ORCHESTRATOR_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ORCHESTRATOR_ROOT, "..");
const RESULTS_DIR = path.join(REPO_ROOT, "test-results");

const RAW_PATH = path.join(RESULTS_DIR, "byon-industrial-ab-raw-outputs.jsonl");
const SUMMARY_PATH = path.join(RESULTS_DIR, "byon-industrial-ab-benchmark.json");
const REPORT_PATH = path.join(RESULTS_DIR, "byon-industrial-ab-benchmark.md");

// ---------------------------------------------------------------------------
// Compliance detectors
// ---------------------------------------------------------------------------

// Modern unicode emoji match — covers most pictographic emoji.
// \p{Extended_Pictographic} alone doesn't catch some keycap / ZWJ sequences,
// but it covers the visible-emoji cases we care about here.
const EMOJI_REGEX = /\p{Extended_Pictographic}/u;
const EMOJI_GLOBAL = /\p{Extended_Pictographic}/gu;

function findEmoji(text) {
    const matches = [...(text || "").matchAll(EMOJI_GLOBAL)];
    return matches.map(m => m[0]);
}

// Cheap heuristic language ID: count distinctive function words.
// Good enough for "is the response Romanian or English" when both languages
// are plausible — not a real LID, but matches the project's two-language reality.
const RO_WORDS = /\b(este|sunt|nu|și|prin|această|acesta|ce|cum|când|unde|cine|care|noastr|nostru|pentru|fără|sub|cu|să|de|la|pe|în|despre|dacă)\b/gi;
const EN_WORDS = /\b(the|is|are|not|and|through|this|that|what|how|when|where|who|which|our|for|without|under|with|to|of|on|in|about|if)\b/gi;

function detectLanguage(text) {
    const ro = (text.match(RO_WORDS) || []).length;
    const en = (text.match(EN_WORDS) || []).length;
    if (ro === 0 && en === 0) return "unknown";
    return ro >= en ? "ro" : "en";
}

// Obsequious filler — only the strong patterns, to avoid false positives
// on normal helpful phrasing.
const FILLER_PATTERNS = [
    /\b(certainly!|of course!|absolutely!|sure thing!|happy to help!|i'd be delighted)/i,
    /\b(desigur!|cu mare plăcere!|sigur că|firește|cu siguranță!)/i,
    /^\s*(great question|excelentă întrebare)/i,
];

function findFiller(text) {
    const hits = [];
    for (const p of FILLER_PATTERNS) {
        const m = (text || "").match(p);
        if (m) hits.push(m[0]);
    }
    return hits;
}

// Invented-memory claim — only meaningful when there is no prior context
// in this thread (i.e. category E single-turn items, where setup_turns = 0).
const INVENTED_MEMORY_PATTERNS = [
    /\b(i remember|as you (mentioned|told me|said) earlier|you told me|from our previous|in our prior|recall (from )?(our|the) (previous|earlier))/i,
    /\b(îmi amintesc|cum (ai|mi-ai) (menționat|spus|zis)|mi-ai spus (mai devreme|anterior|deja)|conform a ceea ce|în conversațiile noastre anterioare|în memoria mea (este|am))/i,
];

function findInventedMemory(text) {
    const hits = [];
    for (const p of INVENTED_MEMORY_PATTERNS) {
        const m = (text || "").match(p);
        if (m) hits.push(m[0]);
    }
    return hits;
}

// ---------------------------------------------------------------------------
// Per-item rule derivation
//
// For each item we look at:
//   - setup turns (multi)  / setup_a + setup_b (two_threads)  — extract
//     explicit constraints like "Nu folosi emoji" / "no emoji" / language preferences
//   - category (E gets the invented-memory check; all get filler)
// ---------------------------------------------------------------------------

function deriveRules(item) {
    const rules = [];

    const setupTexts = [
        ...(item.setup || []),
        ...(item.setup_a || []),
        ...(item.setup_b || []),
    ].map(s => String(s).toLowerCase());

    // no_emoji rule
    if (setupTexts.some(t => /\bemoji/i.test(t) && /\b(nu|no|without|don't|do not|fără)\b/i.test(t))) {
        rules.push({ rule: "no_emoji", source: "setup mentions 'no emoji' preference" });
    }

    // language rules
    if (setupTexts.some(t => /\b(răspund|response).*(în|in)\s+(român|romanian|engl|english)/i.test(t))) {
        rules.push({ rule: "language_preference", source: "setup mentions language preference" });
    }
    // Strong default rule: response language should match the language of the user query.
    rules.push({ rule: "language_match_query", source: "default — response should match query language" });

    // invented memory rule for hallucination guard category E
    if (item.category === "E") {
        rules.push({ rule: "no_invented_memory", source: "category E: no prior context, must not claim to remember" });
    }

    // universal filler check
    rules.push({ rule: "no_filler", source: "universal — flag obsequious filler" });

    // hard constraint bypass — for items with must_negative_intent or must_refuse
    if (item.expected?.must_negative_intent || item.expected?.must_refuse) {
        rules.push({ rule: "must_not_bypass_constraint", source: "item declares hard refusal/negative-intent" });
    }

    return rules;
}

function scoreCompliance(item, response, rules) {
    const violations = [];

    const r = String(response || "");

    for (const rule of rules) {
        switch (rule.rule) {
            case "no_emoji": {
                const emojis = findEmoji(r);
                if (emojis.length > 0) {
                    violations.push({
                        rule: "no_emoji",
                        severity: "high",
                        evidence: `emoji codepoints found: ${[...new Set(emojis)].slice(0, 10).join(" ")} (n=${emojis.length})`,
                    });
                }
                break;
            }
            case "language_match_query": {
                const qLang = detectLanguage(item.query || "");
                const rLang = detectLanguage(r);
                if (qLang !== "unknown" && rLang !== "unknown" && qLang !== rLang) {
                    violations.push({
                        rule: "language_match_query",
                        severity: "medium",
                        evidence: `query=${qLang}, response=${rLang}`,
                    });
                }
                break;
            }
            case "no_invented_memory": {
                const hits = findInventedMemory(r);
                if (hits.length > 0) {
                    violations.push({
                        rule: "no_invented_memory",
                        severity: "high",
                        evidence: `phrases: ${hits.slice(0, 3).join(" / ")}`,
                    });
                }
                break;
            }
            case "no_filler": {
                const hits = findFiller(r);
                if (hits.length > 0) {
                    violations.push({
                        rule: "no_filler",
                        severity: "low",
                        evidence: `filler: ${hits.join(" / ")}`,
                    });
                }
                break;
            }
            case "must_not_bypass_constraint":
                // covered indirectly by must_refuse / must_negative_intent in primary scorer
                break;
            // language_preference rule could be added with deeper parsing of which
            // language was preferred. For now we treat it as advisory; the
            // language_match_query rule covers the main case.
        }
    }

    // Map violations to a 0-5 compliance score.
    // No violation         -> 5
    // Only low severity    -> 4
    // Medium severity      -> 3
    // High severity        -> 1
    // High + others        -> 0
    let score = 5;
    const hasHigh = violations.some(v => v.severity === "high");
    const hasMedium = violations.some(v => v.severity === "medium");
    const hasLow = violations.some(v => v.severity === "low");
    if (hasHigh && (hasMedium || hasLow)) score = 0;
    else if (hasHigh) score = 1;
    else if (hasMedium) score = 3;
    else if (hasLow) score = 4;

    return { score, violations };
}

// ---------------------------------------------------------------------------
// Test bank — import from the benchmark script so item rules stay in sync.
// We import lazily so this script works even when the benchmark script
// changes (we only need .setup, .setup_a, .setup_b, .expected, .query).
// ---------------------------------------------------------------------------

let TEST_BANK = null;
async function loadTestBank() {
    if (TEST_BANK) return TEST_BANK;
    const mod = await import("./byon-industrial-ab-benchmark.mjs").catch(() => null);
    if (mod?.TEST_BANK) {
        TEST_BANK = mod.TEST_BANK;
        return TEST_BANK;
    }
    // Fallback: parse the file to get TEST_BANK. We do a constrained eval —
    // the file is part of this codebase so the trust boundary is the same as
    // running it directly. If the import shape changes, the benchmark itself
    // would have to expose TEST_BANK explicitly; we rely on that path first.
    throw new Error("Could not import TEST_BANK from byon-industrial-ab-benchmark.mjs. Ensure it is exported.");
}

function findItem(testBank, category, id) {
    return (testBank[category] || []).find(it => it.id === id) || null;
}

// ---------------------------------------------------------------------------
// JSONL ingestion
// ---------------------------------------------------------------------------

function loadRaw() {
    if (!fs.existsSync(RAW_PATH)) {
        console.error(`FATAL: missing raw outputs at ${RAW_PATH}`);
        process.exit(2);
    }
    const lines = fs.readFileSync(RAW_PATH, "utf-8").split("\n").filter(Boolean);
    return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function loadSummary() {
    if (!fs.existsSync(SUMMARY_PATH)) {
        console.error(`FATAL: missing summary at ${SUMMARY_PATH}`);
        process.exit(2);
    }
    return JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf-8"));
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

function fmt(n, d = 2) { return n === null || n === undefined ? "n/a" : Number(n).toFixed(d); }

async function main() {
    const raw = loadRaw();
    const summary = loadSummary();
    const testBank = await loadTestBank();

    const perCategory = {};
    const flatRows = [];

    for (const entry of raw) {
        // Skip judge-only entries (they don't have a.reply / b.reply at top level).
        if (!entry.category || !entry.id || !entry.a || !entry.b) continue;
        const item = findItem(testBank, entry.category, entry.id);
        if (!item) continue;
        // Attach category for rule derivation
        const itemWithCat = { ...item, category: entry.category };
        const rules = deriveRules(itemWithCat);
        const cA = scoreCompliance(itemWithCat, entry.a.reply, rules);
        const cB = scoreCompliance(itemWithCat, entry.b.reply, rules);
        perCategory[entry.category] = perCategory[entry.category] || [];
        perCategory[entry.category].push({
            id: entry.id,
            rules: rules.map(r => r.rule),
            a_compliance: cA,
            b_compliance: cB,
            // Keep the semantic scores for side-by-side comparison
            a_semantic: entry.score_a?.score ?? null,
            b_semantic: entry.score_b?.score ?? null,
        });
        flatRows.push({ category: entry.category, id: entry.id, a: cA, b: cB });
    }

    // Aggregate
    const catAgg = {};
    for (const [cat, items] of Object.entries(perCategory)) {
        const n = items.length;
        if (!n) continue;
        const avgA = items.reduce((s, it) => s + it.a_compliance.score, 0) / n;
        const avgB = items.reduce((s, it) => s + it.b_compliance.score, 0) / n;
        const violationsA = items.flatMap(it => it.a_compliance.violations);
        const violationsB = items.flatMap(it => it.b_compliance.violations);
        catAgg[cat] = {
            n,
            avgA, avgB,
            delta: avgB - avgA,
            violations_a_count: violationsA.length,
            violations_b_count: violationsB.length,
            violations_a_by_rule: tally(violationsA, "rule"),
            violations_b_by_rule: tally(violationsB, "rule"),
        };
    }

    // Write standalone compliance JSON + MD, and append to main MD report.
    fs.writeFileSync(
        path.join(RESULTS_DIR, "byon-industrial-ab-compliance.json"),
        JSON.stringify({ generated_at: new Date().toISOString(), categories: catAgg, perCategory }, null, 2),
        "utf-8",
    );

    const md = renderComplianceMarkdown(catAgg, perCategory);
    fs.writeFileSync(path.join(RESULTS_DIR, "byon-industrial-ab-compliance.md"), md, "utf-8");

    // Append Section 13 to the main report
    if (fs.existsSync(REPORT_PATH)) {
        const existing = fs.readFileSync(REPORT_PATH, "utf-8");
        const appendix = `\n\n## 13. Style / Preference Compliance (post-hoc)\n\n` + md.split("\n").slice(2).join("\n");
        // Replace any prior Section 13 (idempotent)
        const cleaned = existing.replace(/\n\n## 13\. Style \/ Preference Compliance[\s\S]*$/, "");
        fs.writeFileSync(REPORT_PATH, cleaned + appendix, "utf-8");
        console.log(`[compliance] Section 13 appended to ${REPORT_PATH}`);
    }

    // Also update the JSON summary with a compliance block
    summary.compliance = { categories: catAgg };
    fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2), "utf-8");

    console.log(`[compliance] done. ${flatRows.length} items rescored across ${Object.keys(catAgg).length} categories.`);
}

function tally(arr, key) {
    const out = {};
    for (const it of arr) out[it[key]] = (out[it[key]] || 0) + 1;
    return out;
}

function renderComplianceMarkdown(catAgg, perCategory) {
    const lines = [];
    lines.push(`# BYON A/B — Style/Preference Compliance Report`);
    lines.push("");
    lines.push("This is a **separate metric** from the primary auto-scorer.");
    lines.push("");
    lines.push("- The primary scorer measures **semantic recall**: does the response *mention* the rule (e.g. \"no emoji\")?");
    lines.push("- This scorer measures **behavioral compliance**: does the response *actually obey* the rule (e.g. zero emoji codepoints in output)?");
    lines.push("");
    lines.push("A response can score high on semantic recall and low on behavioral compliance — that gap is itself a real finding about whether structured memory is being *applied* to generation, not just *retrieved*.");
    lines.push("");
    lines.push("**Severity tiers:** high (hard rule, e.g. emoji when forbidden, invented memory) → score 0–1; medium (e.g. language mismatch) → score 3; low (e.g. filler) → score 4; clean → score 5.");
    lines.push("");
    lines.push("## Per-category compliance scores");
    lines.push("");
    lines.push("| Category | n | avg A compliance | avg B compliance | delta | A violations | B violations |");
    lines.push("|---|---:|---:|---:|---:|---:|---:|");
    for (const cat of Object.keys(catAgg).sort()) {
        const a = catAgg[cat];
        lines.push(`| ${cat} | ${a.n} | ${fmt(a.avgA)} | ${fmt(a.avgB)} | ${a.delta >= 0 ? "+" : ""}${fmt(a.delta)} | ${a.violations_a_count} | ${a.violations_b_count} |`);
    }
    lines.push("");
    lines.push("## Violation breakdown by rule");
    lines.push("");
    for (const cat of Object.keys(catAgg).sort()) {
        const a = catAgg[cat];
        if (!a.violations_a_count && !a.violations_b_count) continue;
        lines.push(`### Category ${cat}`);
        lines.push("");
        const rules = new Set([
            ...Object.keys(a.violations_a_by_rule),
            ...Object.keys(a.violations_b_by_rule),
        ]);
        if (!rules.size) { lines.push("_(no violations)_"); lines.push(""); continue; }
        lines.push("| rule | A count | B count |");
        lines.push("|---|---:|---:|");
        for (const r of rules) {
            lines.push(`| ${r} | ${a.violations_a_by_rule[r] || 0} | ${a.violations_b_by_rule[r] || 0} |`);
        }
        lines.push("");
    }
    lines.push("## Concrete violation examples (top 20 across both conditions)");
    lines.push("");
    const allViolations = [];
    for (const [cat, items] of Object.entries(perCategory)) {
        for (const it of items) {
            for (const v of it.a_compliance.violations) allViolations.push({ cat, id: it.id, side: "A", ...v });
            for (const v of it.b_compliance.violations) allViolations.push({ cat, id: it.id, side: "B", ...v });
        }
    }
    const sev = { high: 0, medium: 1, low: 2 };
    allViolations.sort((x, y) => sev[x.severity] - sev[y.severity]);
    for (const v of allViolations.slice(0, 20)) {
        lines.push(`- **${v.cat}/${v.id}** [${v.side}, ${v.severity}] ${v.rule}: ${v.evidence}`);
    }
    if (!allViolations.length) lines.push("_(no violations detected across any category)_");
    lines.push("");
    lines.push("## Headline finding");
    lines.push("");
    lines.push("If A's compliance and B's compliance are roughly equal, the gap between semantic-recall scores and compliance scores is *systemic* — both LLMs ignore the rule equally despite retrieval. If B's compliance is significantly higher than A's, BYON's memory does shape generation behavior, not just retrieval. If B's compliance is *lower* than A's, the memory is being recalled but the prompt construction is letting the LLM ignore it — that's an actionable defect in the system-prompt scaffolding, not in the memory layer itself.");
    lines.push("");
    lines.push("## Limitation of the initial auto-scorer (acknowledged)");
    lines.push("");
    lines.push("The Section 4 scores (semantic recall) reward responses that *cite* a rule by keyword. The A1 emoji case illustrates this: B mentioned the user's \"no emoji\" preference (high semantic recall) and at the same time used emoji glyphs in its formatted headings (compliance violation). This is **not a memory failure — it is a behavioral-application failure**: the rule was recalled into the prompt but the model's generation did not honor it. That is exactly the kind of finding this benchmark is designed to surface.");
    return lines.join("\n");
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
