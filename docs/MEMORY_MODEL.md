# BYON Optimus — memory model

This document describes the trust tiers and memory categories BYON Optimus uses in production, and how each one interacts with the conversational pipeline. It does **not** describe a future or proposed system; everything below corresponds to code that is on `main` and exercised by the 100-item full-organism capability benchmark.

## Trust hierarchy (highest → lowest)

| Tier | Name | Source | What it does in the prompt |
| ---: | --- | --- | --- |
| 1 | `SYSTEM_CANONICAL` | operator-curated, 18-entry corpus in `byon-orchestrator/scripts/lib/byon-system-facts.mjs` | Always injected; never suppressed; always wins on contradiction |
| 2 | `VERIFIED_PROJECT_FACT` | written by operator via fact-management tooling | High-priority recall; beats user claims and conversation excerpts |
| 3 | `DOMAIN_VERIFIED` | external domain facts with jurisdiction | Conditional recall; jurisdiction must match |
| 4 | `USER_PREFERENCE` | extracted from user turns (style, language, etc.) | Recalled by Contextual Pathway Stabilization when relevant |
| 5 | `EXTRACTED_USER_CLAIM` | other claims extracted by the fact extractor | Recalled with low priority; cannot self-promote |
| 6 | `DISPUTED_OR_UNSAFE` | flagged via compliance / adversarial detection | Always visible to the rail; used to refuse, not to obey |

These tiers are produced by `formatFactsForPrompt(...)` in `byon-orchestrator/scripts/byon-industrial-ab-benchmark.mjs` and tallied by `tallyTrustTiers(...)`. Both functions are active in `runConditionB` — the production Condition B pipeline used by the benchmark.

## Memory categories distinguished by the runtime

| Category | Persistence | Recall scope | Tier source |
| --- | --- | --- | --- |
| **Conversation memory** | persistent (FAISS `conversation` index) | thread-scoped by default (v0.6.1) | not a tier; recalled as excerpts |
| **Conversation excerpt** | derived from `conversation` hits | thread-scoped; warm-phase compaction limits how many appear | not authoritative — never beats a tier-1 / tier-2 fact |
| **Extracted user claim** | persistent (FAISS `fact` index, tier 5) | thread or system depending on extractor route | tier 5 |
| **User preference** | persistent, tier 4 | thread or system | tier 4 |
| **Verified project fact** | persistent, tier 2 | thread or system | tier 2 |
| **Domain verified fact** | persistent, tier 3, jurisdiction-bound | thread or system | tier 3 |
| **Disputed / unsafe memory** | persistent, tier 6 | visible to the rail | tier 6 |
| **Structural reference memory** | persistent via the commit-17 `/level3/persist-structural-reference` endpoint (operator-seeded, never endogenous) | thread-scoped (`level3_full_organism_*`) | tier 1 (`SYSTEM_CANONICAL`) |
| **Derivative candidate** | runner-side classification (5-tier) of how a model response treats a structural seed | not persisted as a tier; classified into `lexical_*`, `behavioral_*`, `memory_persisted_*`, `structurally_retrieved_*`, `endogenous_derivative_candidate` | n/a |
| **Omega** | future / not declared | future / not declared | future / not declared |

## Hard rule

> `operator_seeded structural reference != endogenous Omega`

A structural reference seeded via the operator's seven-seed corpus stays with `origin=operator_seeded` for its entire lifetime. There is no codepath that promotes an operator-seeded structural reference to an endogenous Omega anchor, and no codepath that creates an Omega anchor manually. `theta_s = 0.28` and `tau_coag = 12` are the operator-locked coagulation thresholds; they are read by `byon-orchestrator/memory-service/level3_experimental_endpoints.py` and `byon-orchestrator/scripts/byon-coagulation-harness.mjs` but never assigned.

The five-tier derivative-candidate classification (in `byon-orchestrator/scripts/lib/structural-reference.mjs`) is *evidence about model behaviour*, not a memory tier. Promoting a derivative candidate to a tier or to Omega status would require an explicit operator decision and would not be performed automatically.

## Contextual Pathway Stabilization

Trust-ranked recall is filtered per-turn by Contextual Pathway Stabilization (v0.6.9, see `docs/CONTEXTUAL_PATHWAY_STABILIZATION_v0.6.9.md`). The four phases are:

| Phase | Behaviour |
| --- | --- |
| `cold` | all routes open, all tiers visible |
| `stabilizing` | preliminary narrowing |
| `warm` | per-tier hit caps; conversation excerpts only when directly relevant or carrying a correction |
| `drift` | adversarial reopen / topic switch handling |

The 8-item Category G in the capability benchmark (BYON +48.8 %) specifically tests this loop; the corresponding source paths are `byon-orchestrator/scripts/lib/context-state.mjs` and `byon-orchestrator/scripts/byon-industrial-ab-benchmark.mjs` (`ctxUpdate` / `ctxPlan` / `applyDirectlyRelevantUnsuppression` / `filterHitsByPlan` / `applyPerTierCaps`).

## Fact extractor routing

The `byon-orchestrator/scripts/lib/fact-extractor.mjs` LLM-driven extractor classifies user turns into:

- **sync** ("memorează: X" / "remember: X" / explicit storage commands) — block recall until the fact is stored
- **async** — fire-and-forget so latency is not blocked
- **skip** — trivial token / ack

Architecture / security / identity facts route to system-scope. User preferences and project facts route thread-scoped (v0.6.2).

## What is NOT in this model

- No "self-evolving identity"
- No `is_omega_anchor` flag (forbidden token in source-level guarantees)
- No automatic promotion of any extracted memory to `SYSTEM_CANONICAL`
- No bypass of the Auditor approval flow by any memory tier — FCE-M advisory included
