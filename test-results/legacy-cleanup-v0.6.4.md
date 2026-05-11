# Legacy Cleanup Report — v0.6.4 Pre-Tag

**Date:** 2026-05-11
**Scope:** Repository-wide cleanup of pre-v0.6 architectural claims before tagging `v0.6.4-level2-advisory-memory`.
**Driver:** Public README was clean, but auxiliary documents and source comments still presented FHRSS+FCPE / 73,000x / Claude 3 Haiku / Claude Sonnet 4.5 / "All 9 phases complete" as the *current* architecture, contradicting the v0.6.4 hybrid FAISS + FCE-M state.

## Summary

| Verification | Pre-cleanup | Post-cleanup |
|---|---|---|
| `git grep "token=[a-f0-9]{30,}"`  (real tokens) | 0 | **0** ✓ |
| `git grep "987ad"` (specific exposed token) | 2 hits (UNIFIED_UI_PLAN.md) | **0** ✓ |
| `git grep "73,000"` as **current** memory claim (excluding historical-banner contexts) | many | bounded to historical-banner contexts only |
| `git grep "claude-3-haiku"` as **current** model | 2 hits (CAPABILITY_REPORT.md current header) | wrapped in historical banner |
| `git grep "Sonnet 4\.5"` as **current** model | 4 hits (COMPREHENSIVE_CAPABILITY_REPORT.md, EXECUTIVE_SUMMARY.md) | wrapped in historical banner / EXECUTIVE_SUMMARY table fixed to 4.6 |
| `git grep "All 9 phases"` / "phases complete" as **current** status | 4 hits (planning JSONs + JOHNSON_PLAN.md header) | reframed as historical milestone |

## Classification

Following the user's three buckets:

- **REMOVE** — secrets, real tokens, current-tense claims that contradict v0.6.4
- **LEGACY_OK** — historical entries in CHANGELOG and explicitly-marked historical reports
- **CONDITIONAL_OK** — OpenClaw described as optional runtime, install scripts using `$variable` templates

## File / term / action / reason table

| File | Term(s) | Classification | Action | Reason |
|---|---|---|---|---|
| `docs/planning/UNIFIED_UI_PLAN.md` (×2) | `987ad2399f...` exposed token | **REMOVE** | Replaced with `<LOCAL_UI_TOKEN>` placeholder + redaction note | Real gateway token previously checked into repo history |
| `INSTALL.md` line 703 | "73,000x compression • 100% recovery" in current ASCII diagram | **REMOVE** | Replaced with "thread-scoped recall • morphogenetic advisory" | Current architecture is hybrid FAISS + FCE-M |
| `byon-orchestrator/README.md` line 220 | "Compression: 73,000x ratio" in current memory description | **REMOVE** | Rewritten Memory section; added v0.6.4 banner | Memory backend changed in v0.6.0 |
| `byon-orchestrator/docs/ARCHITECTURE.md` line 216 | "Compression: 73,000x" in performance block | **REMOVE** | Replaced with v0.6.4 hybrid backend performance characteristics | Current performance profile differs |
| `byon-orchestrator/src/agents/worker/memory-handler.ts` line 19 | "FHRSS+FCPE", "73,000x compression" in code header | **REMOVE** | Rewrote header to describe hybrid FAISS + FCE-M responsibilities | Source documentation should match runtime |
| `byon-orchestrator/src/integration/memory-bridge.ts` line 18 | "FHRSS+FCPE (Primary) - Infinite memory with 73,000x compression" | **REMOVE** | Rewrote provider list: FAISS + FCE-M primary, FHRSS+FCPE as legacy reference | Bridge wires v0.6.4 memory |
| `byon-orchestrator/src/manifest/project-manifest.ts` line 207 | "Python Flask service providing FHRSS+FCPE semantic search… 73,000x compression…" | **REMOVE** | Rewrote service entry as `Memory Service (FAISS + FCE-M v0.6.0 hybrid)` | Manifest is consumed by tooling to describe current architecture |
| `byon-orchestrator/ui/public/index.html` lines 577, 637, 692, 1428 | "Compression: 73,000x (FCPE)", "FHRSS+FCPE Memory", inline JSON `compression: "73,000x"` | **REMOVE** | UI integrations table and integrity panel rewritten for hybrid backend | UI is current product surface |
| `docs/CAPABILITY_REPORT.md` lines 6, 171 | "AI Model: claude-3-haiku-20240307" as current header | **REMOVE** as current claim, **LEGACY_OK** with banner | Added historical banner + "(at the time of this snapshot)" framing | Pre-v0.6.0 capability report |
| `docs/COMPREHENSIVE_CAPABILITY_REPORT.md` lines 15, 99, 103, 612 | "Claude Sonnet 4.5", "FHRSS+FCPE 73,000x" as current bullets | **LEGACY_OK** with banner | Added historical banner at top; inline historical strikethrough on first occurrences | Pre-v0.6.0 v3.0 / Phase 13 capability snapshot |
| `docs/EXECUTIVE_SUMMARY.md` line 27 | "Native Claude Sonnet 4.5" in differentiator table | **REMOVE** as current claim | Updated to "Claude Sonnet 4.6 (v0.6.4 default)" and "Hybrid FAISS + FCE-M v0.6.0" | Top-level summary must reflect current state |
| `docs/BYON_ARCHITECTURE.md` lines 37, 195 | "FHRSS+FCPE Memory System / 73,000x compression / 100% recovery" as current diagram + section | **REMOVE** as current claim | Memory Layer ASCII redrawn for hybrid backend; "Memory Architecture" section split into current (FAISS + FCE-M) + Legacy (historical) | Document carries v0.6.4 banner at top; specific lines updated to match |
| `docs/GDPR_COMPLIANCE.md` line 87 | "FCPE provides 73,000x compression" in retention argument | **LEGACY_OK** with banner | Added historical banner clarifying compliance principles still hold against v0.6.4 backend | GDPR text remains valid; numbers reframed |
| `docs/IMPLEMENTATION_SUMMARY.md` lines 108, 139 | "73,000x compression claim: VALIDATED" in validation summary | **LEGACY_OK** with banner | Added "(historical, v0.2)" banner | This document validates the pre-v0.6 implementation |
| `docs/IMPLEMENTATION_GUIDE.md` lines 5, 11, 375 | "Claude Sonnet 4.5", "Cost: ~$0.003 per request (Sonnet 4.5)" | **LEGACY_OK** with banner | Already carried v0.6.4 banner from prior commit pointing readers at current ai-processor.ts default `claude-sonnet-4-6` | Implementation tutorial preserved as historical reference |
| `docs/planning/JOHNSON_PLAN.md` line 17 | "All 9 phases complete" as live status | **LEGACY_OK** with banner | Reframed as "historical snapshot; superseded by v0.6.4 research line" + link to RESEARCH_PROGRESS_v0.6.md | Planning header was misleading about live status |
| `docs/planning/JOHNSON_STATUS.json` line 7 | `"byon_optimus_integration": "COMPLETE - All 9 phases implemented"` | **LEGACY_OK** with note | Added `_v0_6_4_status_note` field; rephrased fields to "historical" | JSON consumed by tooling needed correction |
| `docs/planning/BYON_PROGRESSION.json` lines 39–46 | "next_action: PROJECT COMPLETE - All 9 phases implemented" | **LEGACY_OK** with note | Added `_v0_6_4_note`; rephrased status block to point at research line | Same — tooling-readable status |
| `INFINIT_MEMORYCONTEXT/README.md` | Entire folder presented as the current memory system | **LEGACY_OK** banner | Added "Reference-only legacy module" banner at top, pointing at the v0.6.4 hybrid backend | Useful as scientific reference and patent record, but not the active substrate |
| `Byon_bot/README.md` (and its docs/sources) | Pre-v0.6 parallel pnpm workspace claims | **LEGACY_OK** banner | Added "Pre-v0.6 parallel workspace" banner | Workspace preserved as reference; current orchestrator is `byon-orchestrator/` |
| `Byon_bot/*` (deep files: docker-compose, agent code, docs) | Same FHRSS+FCPE/Haiku/73,000 claims | **LEGACY_OK** | Not edited individually; covered by parent README banner | Banner on top-level Byon_bot/README scopes the historical framing |
| `CHANGELOG.md` lines 123, 143, 187 | Historical v0.1 / v0.2 entries mentioning FHRSS+FCPE / 73,000:1 / Claude 3 Haiku | **LEGACY_OK** intentional | Untouched (history must be preserved) | Standard changelog convention |
| `test-results/fcem-integration-report.md` line 71 | Mentions "claude-3-haiku-20240307 → claude-sonnet-4-6" as the v0.6.0 wiring step | **LEGACY_OK** intentional | Untouched | This *is* the v0.6.0 historical record |
| `install-byon-v2.ps1` lines 670, 672, 712 | `http://localhost:3000/?token=$gatewayToken` (PowerShell template) | **CONDITIONAL_OK** | Untouched | Uses runtime variable, not a baked-in real token |
| Source `OpenClaw` references in integration code (e.g. `openclaw-bridge.ts`, `memory-bridge.ts`) | OpenClaw integration symbols | **CONDITIONAL_OK** | Untouched | Code integration points; current docs frame OpenClaw runtime as optional / when bundled |

## Verification commands

After cleanup, the following must hold:

```bash
# 1) Zero exposed real tokens
git grep -nE "token=[a-f0-9]{30,}|987ad"
# expect: empty

# 2) README clean (already verified, see fcem-deep-v0.6.4a-report.md)
grep -nE "token=|987ad|FHRSS|FCPE|73,000|73000|claude-3-haiku|sonnet-4-5|All 9 phases|phases complete" README.md
# expect: only line 238 (the explicit single legacy-note paragraph) for FHRSS/FCPE/Haiku, plus 3 OpenClaw mentions (2 conditional + 1 on line 238)
```

## Files committed in this cleanup

- `INSTALL.md`
- `byon-orchestrator/README.md`
- `byon-orchestrator/docs/ARCHITECTURE.md`
- `byon-orchestrator/src/agents/worker/memory-handler.ts`
- `byon-orchestrator/src/integration/memory-bridge.ts`
- `byon-orchestrator/src/manifest/project-manifest.ts`
- `byon-orchestrator/ui/public/index.html`
- `docs/CAPABILITY_REPORT.md`
- `docs/COMPREHENSIVE_CAPABILITY_REPORT.md`
- `docs/EXECUTIVE_SUMMARY.md`
- `docs/BYON_ARCHITECTURE.md`
- `docs/GDPR_COMPLIANCE.md`
- `docs/IMPLEMENTATION_SUMMARY.md`
- `docs/planning/UNIFIED_UI_PLAN.md` *(token redacted)*
- `docs/planning/JOHNSON_PLAN.md`
- `docs/planning/JOHNSON_STATUS.json`
- `docs/planning/BYON_PROGRESSION.json`
- `INFINIT_MEMORYCONTEXT/README.md`
- `Byon_bot/README.md`
- `test-results/legacy-cleanup-v0.6.4.md` *(this file)*

No source-of-truth claims about the current v0.6.4 architecture were softened or relaxed during this cleanup. Every remaining FHRSS+FCPE / 73,000x / Haiku / Sonnet 4.5 / "All 9 phases" reference is now either historical (CHANGELOG entries, dated reports, explicit banners) or describes optional/legacy components (INFINIT_MEMORYCONTEXT/, Byon_bot/, OpenClaw when present).
