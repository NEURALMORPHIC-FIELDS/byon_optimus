#!/usr/bin/env node
/**
 * BYON-FCE-M v0.6.4b — Center-Coherent Coagulation Harness
 * =========================================================
 *
 * Tests whether Omega coagulation is reachable on a SINGLE morphogenetic
 * center with semantically coherent but textually varied events.
 *
 * Strategy:
 *   - Pick one center: `byon::execution_boundary` or `fce-m::truth_attention_boundary`.
 *   - Generate 60 events: paraphrases of the same architectural rule.
 *   - Drive consolidate after every event to capture per-cycle metrics.
 *   - Track S_t, AR_t, κ_t, Z_norm, omega per cycle.
 *   - Detect coagulation events; otherwise diagnose the bottleneck.
 *
 * Output:
 *   test-results/fcem-coagulation-harness-v0.6.4b.md
 *   test-results/fcem-coagulation-harness-v0.6.4b.json
 *
 * Usage:
 *   node --env-file=../.env scripts/byon-coagulation-harness.mjs
 *   node --env-file=../.env scripts/byon-coagulation-harness.mjs --center fce-m::truth_attention_boundary
 *   node --env-file=../.env scripts/byon-coagulation-harness.mjs --events 100
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedSystemFacts } from "./lib/byon-system-facts.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ORCHESTRATOR_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ORCHESTRATOR_ROOT, "..");

const MEMORY_URL = process.env.MEMORY_SERVICE_URL || "http://localhost:8000";

const argv = process.argv.slice(2);
function argFlag(name, defaultVal) {
    const idx = argv.indexOf(name);
    if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
    return defaultVal;
}

const CENTER = argFlag("--center", "byon::execution_boundary");
const NUM_EVENTS = parseInt(argFlag("--events", "60"), 10);
const CONSOLIDATE_EVERY_N = parseInt(argFlag("--consolidate-every", "1"), 10);

// Pool of coherent paraphrases for the boundary rule
const COHERENT_POOL = {
    "byon::execution_boundary": [
        "Execution authority belongs exclusively to the Auditor.",
        "The Auditor is the only entity authorized to approve actions.",
        "Auditor approval is required before any ExecutionOrder is signed.",
        "Auditor signs ExecutionOrders with Ed25519; nothing else can.",
        "FCE-M cannot approve execution; that authority is Auditor's alone.",
        "Worker plans; Auditor approves; Executor executes signed orders only.",
        "The execution boundary in BYON is the signed ExecutionOrder.",
        "Without an Auditor-signed ExecutionOrder, the Executor refuses to run.",
        "ReferenceField never substitutes for Auditor approval.",
        "Even aligned ReferenceFields cannot bypass Auditor approval gates.",
        "High residue advisory raises review priority but never approves.",
        "Contested expression demands review; it never authorizes execution.",
        "The execution boundary protects against unsigned or stale orders.",
        "Auditor verdicts on EvidencePack precede ExecutionOrder signature.",
        "The Executor air-gap is part of the execution boundary protection.",
        "Network isolation reinforces Auditor authority over execution.",
        "MACP execution flow: Worker → Auditor → Executor with signed orders.",
        "Authorization to execute lives in Auditor's Ed25519 signature.",
        "FCE-M provides risk advisory; Auditor decides; Executor runs.",
        "Cross-boundary leaks would weaken the Auditor approval authority.",
    ],
    "fce-m::truth_attention_boundary": [
        "FCE-M modifies attention, never truth verdicts.",
        "Epistemic truth is the Auditor's domain; FCE-M cannot override it.",
        "ReferenceField guides interpretation; it does not issue verdicts.",
        "Morphogenetic advisory feeds attention; epistemic logic stays separate.",
        "FCE-M can flag uncertainty; the Auditor decides what is true.",
        "Aligned reference fields suggest stability, not factual correctness.",
        "Contested expression raises attention; it does not change truth state.",
        "FCE-M can prioritize; it cannot determine factual correctness.",
        "Residue and high attention never overwrite committed truths.",
        "The truth/attention boundary is the heart of FCE-M safety design.",
        "FCE-M is a perspective layer over a truth-preserving substrate.",
        "Morphogenetic state is descriptive; truth state is normative.",
        "BYON keeps truth and attention strictly separated by design.",
        "FCE-M output is advisory metadata, not authoritative content.",
        "ReferenceField projection never re-writes prior epistemic state.",
        "Even after Omega coagulation, truth verdicts remain Auditor-owned.",
        "FCE-M observes; it does not decide.",
        "The truth/attention boundary keeps the Auditor as the verifier.",
        "Risk advisory can escalate review without changing facts.",
        "Attention shape evolves; epistemic truth remains the Auditor's call.",
    ],
};

async function mem(payload, timeoutMs = 30000) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const r = await fetch(MEMORY_URL + "/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (r.status === 429) {
                await new Promise(res => setTimeout(res, 1500 * (attempt + 1)));
                continue;
            }
            return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
        } catch (e) {
            if (attempt === 2) return { ok: false, body: { error: e.message } };
            await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
        }
    }
}

async function memHealth() {
    try {
        const r = await fetch(MEMORY_URL + "/health", { signal: AbortSignal.timeout(5000) });
        return { ok: r.ok, body: await r.json() };
    } catch (e) { return { ok: false, body: { error: e.message } }; }
}

// ---------------------------------------------------------------------------
// Run harness
// ---------------------------------------------------------------------------

async function runHarness() {
    const startedAt = new Date().toISOString();
    console.log("================================================================");
    console.log("  BYON-FCE-M v0.6.4b — Coagulation Feasibility Harness");
    console.log("================================================================");
    console.log(`  Memory:               ${MEMORY_URL}`);
    console.log(`  Target center:        ${CENTER}`);
    console.log(`  Events:               ${NUM_EVENTS}`);
    console.log(`  Consolidate every N:  ${CONSOLIDATE_EVERY_N}`);
    console.log("================================================================\n");

    const h = await memHealth();
    if (!h.ok) {
        console.error("FATAL: memory-service not reachable. Start it first.");
        process.exit(2);
    }

    const pool = COHERENT_POOL[CENTER];
    if (!pool) {
        console.error(`FATAL: unknown center "${CENTER}". Choose one of: ${Object.keys(COHERENT_POOL).join(", ")}`);
        process.exit(2);
    }

    // Optional: seed canonical facts so system context is rich.
    await seedSystemFacts(mem, { verbose: false }).catch(() => null);

    // Use a custom thread_id so the FCE entity_id = thread_id (per v0.6.2 routing).
    // This makes the FCE center_key match our target CENTER.
    const threadId = CENTER;

    // Pre-snapshot of FCE state
    const before = await mem({ action: "fce_state" });
    const beforeReg = (await mem({ action: "fce_omega_registry" })).body.omega_registry;
    const beforeRefs = (await mem({ action: "fce_reference_fields" })).body.reference_fields;

    console.log("Initial FCE state:");
    console.log(`  omega: ${JSON.stringify(beforeReg)}`);
    console.log(`  reference_fields: ${(beforeRefs || []).length}`);
    console.log();

    const cycleTrace = []; // [{ event_n, content, S_t, AR, kappa, alpha, rho, Z_norm, omega, newly_coagulated, omega_id }]
    let consolidateAccum = 0;
    let lastReports = [];

    for (let i = 0; i < NUM_EVENTS; i++) {
        const content = pool[i % pool.length] + ` (variant=${Math.floor(i / pool.length)}.${i % pool.length})`;
        await mem({
            action: "store",
            type: "conversation",
            data: { content, role: "user", thread_id: threadId, channel: "coag-harness" },
        });

        consolidateAccum++;
        if (consolidateAccum >= CONSOLIDATE_EVERY_N) {
            consolidateAccum = 0;
            const c = await mem({ action: "fce_consolidate" });
            const rep = c.body?.report || {};
            const fo = rep.fce_omega_report || {};
            lastReports.push(rep);
            for (const rec of fo.records || []) {
                if (rec.semantic_center === CENTER || (rec.semantic_center || "").includes(threadId)) {
                    cycleTrace.push({
                        event_n: i + 1,
                        cycle: rec.cycle,
                        S_t: rec.S_t,
                        AR: rec.AR,
                        kappa: rec.kappa,
                        alpha: rec.alpha,
                        rho: rec.rho,
                        Z_norm: rec.Z_norm,
                        delta_X_norm: rec.delta_X_norm,
                        omega: rec.omega,
                        newly_coagulated: rec.newly_coagulated,
                        omega_id: rec.omega_id,
                    });
                }
            }
            if (i % 10 === 9 || i === NUM_EVENTS - 1) {
                const lastRec = cycleTrace[cycleTrace.length - 1];
                if (lastRec) {
                    console.log(
                        `event ${i + 1}: S_t=${lastRec.S_t?.toFixed(4)} AR=${lastRec.AR?.toFixed(3)} κ=${lastRec.kappa?.toFixed(3)} Z=${lastRec.Z_norm?.toFixed(3)} ΔX=${lastRec.delta_X_norm?.toFixed(3)} Ω=${lastRec.omega} new=${lastRec.newly_coagulated}`
                    );
                } else {
                    console.log(`event ${i + 1}: (no record for center yet)`);
                }
            }
        }
    }

    // Final state
    const afterReg = (await mem({ action: "fce_omega_registry" })).body.omega_registry;
    const afterRefs = (await mem({ action: "fce_reference_fields" })).body.reference_fields;

    // Compute metrics
    const sts = cycleTrace.map(r => r.S_t).filter(v => typeof v === "number");
    const ARs = cycleTrace.map(r => r.AR).filter(v => typeof v === "number");
    const kappas = cycleTrace.map(r => r.kappa).filter(v => typeof v === "number");
    const Zs = cycleTrace.map(r => r.Z_norm).filter(v => typeof v === "number");
    const dXs = cycleTrace.map(r => r.delta_X_norm).filter(v => typeof v === "number");

    const summarize = arr => {
        if (!arr.length) return { n: 0 };
        const sorted = [...arr].sort((a, b) => a - b);
        return {
            n: arr.length,
            min: sorted[0],
            mean: arr.reduce((a, b) => a + b, 0) / arr.length,
            max: sorted[sorted.length - 1],
            p50: sorted[Math.floor(0.5 * (sorted.length - 1))],
            p95: sorted[Math.floor(0.95 * (sorted.length - 1))],
        };
    };

    const stStats = summarize(sts);
    const arStats = summarize(ARs);
    const kStats = summarize(kappas);
    const zStats = summarize(Zs);
    const dxStats = summarize(dXs);

    const coagulated = cycleTrace.filter(r => r.newly_coagulated).length;
    const omegaDelta = (afterReg?.count || 0) - (beforeReg?.count || 0);
    const rfDelta = (afterRefs?.length || 0) - (beforeRefs?.length || 0);

    // Coagulation criterion analysis
    const theta_s = 0.28;
    const tau_coag = 12;
    const aboveThreshold = sts.filter(s => s >= theta_s).length;
    let longestStreak = 0, currentStreak = 0;
    for (const s of sts) {
        if (s >= theta_s) {
            currentStreak++;
            longestStreak = Math.max(longestStreak, currentStreak);
        } else {
            currentStreak = 0;
        }
    }

    // Diagnose bottleneck factor: which of (AR, κ, I_t·B_t) drags S_t down?
    // S_t = AR · κ · (I_t · B_t). We don't have I_t and B_t separately but
    // ||Z|| and ||ΔX|| give us proxies: I_t ∝ 1/||ΔX||, B_t ∝ 1/(1+||Z||).
    const factorsTrace = cycleTrace.map(r => {
        const ar = r.AR || 0;
        const k = r.kappa || 0;
        const z = r.Z_norm || 0;
        const dx = r.delta_X_norm || 0;
        const B = 1 / (1 + z);
        const remaining = ar > 0 && k > 0 ? (r.S_t || 0) / (ar * k) : 0; // ≈ I·B
        const Iapprox = remaining > 0 && B > 0 ? remaining / B : 0;
        return { ar, k, z, dx, B, Iapprox, st: r.S_t || 0 };
    });
    const factorsSummary = {
        AR_mean: arStats.mean,
        kappa_mean: kStats.mean,
        Z_norm_mean: zStats.mean,
        delta_X_mean: dxStats.mean,
        B_t_proxy_mean: factorsTrace.reduce((a, b) => a + b.B, 0) / Math.max(1, factorsTrace.length),
        I_t_proxy_mean: factorsTrace.reduce((a, b) => a + b.Iapprox, 0) / Math.max(1, factorsTrace.length),
        S_t_mean: stStats.mean,
    };

    const finishedAt = new Date().toISOString();

    // ---- print summary ----
    console.log("\n================================================================");
    console.log("  Run summary");
    console.log("================================================================");
    console.log(`  Events written:                ${NUM_EVENTS}`);
    console.log(`  Cycles captured on center:     ${cycleTrace.length}`);
    console.log(`  Omega NEW coagulation events:  ${coagulated}`);
    console.log(`  Omega registry delta:          ${omegaDelta}`);
    console.log(`  Reference fields delta:        ${rfDelta}`);
    console.log(`  S_t:    min=${stStats.min?.toFixed(4)} p50=${stStats.p50?.toFixed(4)} mean=${stStats.mean?.toFixed(4)} p95=${stStats.p95?.toFixed(4)} max=${stStats.max?.toFixed(4)}`);
    console.log(`  AR:     min=${arStats.min?.toFixed(3)} mean=${arStats.mean?.toFixed(3)} max=${arStats.max?.toFixed(3)}`);
    console.log(`  κ:      min=${kStats.min?.toFixed(3)} mean=${kStats.mean?.toFixed(3)} max=${kStats.max?.toFixed(3)}`);
    console.log(`  Z_norm: min=${zStats.min?.toFixed(3)} mean=${zStats.mean?.toFixed(3)} max=${zStats.max?.toFixed(3)}`);
    console.log(`  ΔX:     min=${dxStats.min?.toFixed(3)} mean=${dxStats.mean?.toFixed(3)} max=${dxStats.max?.toFixed(3)}`);
    console.log(`  S_t ≥ θ_s (=${theta_s}):           ${aboveThreshold}/${sts.length} cycles  (longest_streak=${longestStreak}, τ_coag=${tau_coag})`);
    console.log("================================================================");

    // ---- bottleneck verdict ----
    let bottleneck = "indeterminate";
    if (cycleTrace.length === 0) {
        bottleneck = "no cycles captured on center (measurement gap)";
    } else if (factorsSummary.AR_mean < 0.5) {
        bottleneck = "AR (autoreferential coupling) — field signature insufficient";
    } else if (factorsSummary.kappa_mean < 0.4) {
        bottleneck = "κ (internal coherence) — events too inconsistent semantically";
    } else if (factorsSummary.B_t_proxy_mean < 0.5) {
        bottleneck = "B_t (residue stability) — Z accumulates";
    } else if (factorsSummary.I_t_proxy_mean < 0.5) {
        bottleneck = "I_t (integration ratio) — ΔX dominates over E";
    } else {
        bottleneck = "all factors healthy individually but product still under θ_s";
    }
    console.log(`Bottleneck diagnosis: ${bottleneck}`);
    if (coagulated === 0 && aboveThreshold > 0 && longestStreak < tau_coag) {
        console.log(`Note: S_t crossed θ_s ${aboveThreshold} times, longest streak ${longestStreak}/${tau_coag} cycles → not enough sustained coherence for coagulation.`);
    }

    // ---- write report ----
    const outDir = path.join(REPO_ROOT, "test-results");
    fs.mkdirSync(outDir, { recursive: true });
    const jsonPath = path.join(outDir, "fcem-coagulation-harness-v0.6.4b.json");
    const json = {
        started_at: startedAt,
        finished_at: finishedAt,
        config: { center: CENTER, num_events: NUM_EVENTS, consolidate_every_n: CONSOLIDATE_EVERY_N, theta_s, tau_coag },
        before_state: { omega: beforeReg, reference_fields_count: (beforeRefs || []).length },
        after_state: { omega: afterReg, reference_fields_count: (afterRefs || []).length },
        omega_delta: omegaDelta,
        reference_fields_delta: rfDelta,
        cycles_captured: cycleTrace.length,
        coagulation_events: coagulated,
        coagulation_criterion: {
            theta_s,
            tau_coag,
            cycles_above_threshold: aboveThreshold,
            longest_streak: longestStreak,
            met: longestStreak >= tau_coag,
        },
        metrics: {
            S_t: stStats,
            AR: arStats,
            kappa: kStats,
            Z_norm: zStats,
            delta_X: dxStats,
            factor_proxies: factorsSummary,
        },
        bottleneck,
        cycle_trace: cycleTrace,
    };
    fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2));

    const md = [];
    md.push(`# BYON-FCE-M v0.6.4b — Coagulation Feasibility Harness Report`);
    md.push(``);
    md.push(`**Run:** ${startedAt} → ${finishedAt}`);
    md.push(`**Center:** \`${CENTER}\``);
    md.push(`**Events:** ${NUM_EVENTS}, consolidate every ${CONSOLIDATE_EVERY_N} event(s)`);
    md.push(``);
    md.push(`## Verdict`);
    md.push(``);
    md.push(`- **Coagulation events:** ${coagulated}`);
    md.push(`- **Omega registry delta:** ${omegaDelta}`);
    md.push(`- **ReferenceFields delta:** ${rfDelta}`);
    md.push(`- **S_t ≥ θ_s (=${theta_s})** in ${aboveThreshold}/${sts.length} cycles, longest streak = ${longestStreak} (need ${tau_coag} for coagulation).`);
    md.push(`- **Bottleneck diagnosis:** ${bottleneck}`);
    md.push(``);
    md.push(`## Metrics`);
    md.push(``);
    md.push(`| Metric | min | p50 | mean | p95 | max |`);
    md.push(`|---|---|---|---|---|---|`);
    for (const [name, s] of Object.entries({ "S_t": stStats, "AR": arStats, "κ": kStats, "Z_norm": zStats, "ΔX": dxStats })) {
        md.push(`| ${name} | ${(s.min ?? 0).toFixed(4)} | ${(s.p50 ?? 0).toFixed(4)} | ${(s.mean ?? 0).toFixed(4)} | ${(s.p95 ?? 0).toFixed(4)} | ${(s.max ?? 0).toFixed(4)} |`);
    }
    md.push(``);
    md.push(`## Factor decomposition (proxies)`);
    md.push(``);
    md.push(`S_t = AR · κ · I_t · B_t`);
    md.push(``);
    md.push(`- AR mean: **${factorsSummary.AR_mean.toFixed(3)}** (max=1.0)`);
    md.push(`- κ mean: **${factorsSummary.kappa_mean.toFixed(3)}** (range 0.01–1.0)`);
    md.push(`- B_t proxy (= 1/(1+Z)) mean: **${factorsSummary.B_t_proxy_mean.toFixed(3)}**`);
    md.push(`- I_t proxy (= S_t / (AR · κ · B_t)) mean: **${factorsSummary.I_t_proxy_mean.toFixed(3)}**`);
    md.push(`- Z_norm mean: ${factorsSummary.Z_norm_mean.toFixed(3)} (residue accumulation)`);
    md.push(`- ΔX mean: ${factorsSummary.delta_X_mean.toFixed(3)} (state change per event)`);
    md.push(``);
    md.push(`## Cycle trace (first 20 + last 5)`);
    md.push(``);
    md.push(`| event | cycle | S_t | AR | κ | Z_norm | ΔX | Ω | new_coag |`);
    md.push(`|---|---|---|---|---|---|---|---|---|`);
    const show = [...cycleTrace.slice(0, 20), ...cycleTrace.slice(-5)];
    const seenEvents = new Set();
    for (const r of show) {
        const key = r.event_n + "-" + r.cycle;
        if (seenEvents.has(key)) continue;
        seenEvents.add(key);
        md.push(`| ${r.event_n} | ${r.cycle} | ${(r.S_t ?? 0).toFixed(4)} | ${(r.AR ?? 0).toFixed(3)} | ${(r.kappa ?? 0).toFixed(3)} | ${(r.Z_norm ?? 0).toFixed(3)} | ${(r.delta_X_norm ?? 0).toFixed(3)} | ${r.omega} | ${r.newly_coagulated} |`);
    }
    md.push(``);
    md.push(`## Files`);
    md.push(``);
    md.push(`- JSON: \`test-results/fcem-coagulation-harness-v0.6.4b.json\``);
    md.push(`- MD:   \`test-results/fcem-coagulation-harness-v0.6.4b.md\``);

    const mdPath = path.join(outDir, "fcem-coagulation-harness-v0.6.4b.md");
    fs.writeFileSync(mdPath, md.join("\n"));

    console.log(`\nReport:`);
    console.log(`  ${mdPath}`);
    console.log(`  ${jsonPath}`);
}

runHarness().catch(e => {
    console.error("FATAL:", e);
    process.exit(1);
});
