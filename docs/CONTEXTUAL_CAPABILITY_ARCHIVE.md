# Contextual Capability Archive

**Status:** v0.7 infrastructure — **not** a finished v0.7 capability suite.
**Branch of origin:** `feat/contextual-capability-archive`.
**This document deliberately does NOT claim** that coding (or any other domain) is "solved." It only describes the architectural layer that will make domain-specialised cognition possible.

## Why BYON needs contextually-activated capabilities

The v0.6 full-organism capability bench proved BYON's value on **Q&A-style work**: BYON Optimus beat Claude Sonnet 4.6 direct by **+34.94 %** weighted across 12 categories. The same pipeline, retargeted at **multi-file iterative coding** (PR #6, `coding-benchmark/policy-gated-workflow-engine`), **lost by −46.32 %**.

The judge's rationale on the coding bench was specific: BYON's Condition B repo had "serious fragmentation problems" — two `AuditLog` classes, two `WorkflowDefinition` dataclasses, two `PolicyEngine` classes. Native chat history (Condition A) preserves byte-exact prior code; **similarity-based retrieval** loses the exact prior file contents and the model regenerates partially incompatible versions.

The conclusion is not "BYON failed at coding." It is:

> Coding requires a specialised `software_engineer` capability pack with exact workspace memory, symbol awareness, patch memory, requirements ledger and a workspace diff guard — none of which a similarity-based conversational memory can provide.

This document specifies the layer that makes capability packs first-class.

## Memory routing vs capability routing

| Layer | Decision | Status |
| --- | --- | --- |
| Contextual Pathway Stabilization (v0.6.9.1) | which **memory routes** to open / suppress in this turn; current phase cold / stabilizing / warm / drift | shipped, untouched |
| Capability Router (this doc) | which **cognitive capability pack** drives the turn (software_engineer, novelist, philosopher, …) | **new, additive** |

The two are complementary, not competing. Capability routing decides *who* answers; memory routing decides *what they're allowed to look at*. Both run before the prompt builder.

## Pipeline (v0.7 intent)

```
user prompt
     │
     ▼
context-state.mjs        ── classifies phase (cold/warm/drift), domain hints
     │
     ▼
capability-router.mjs    ── chooses primary + secondary capability packs
     │
     ▼
memory-route-planner     ── intersects pack's memory_routes with phase routes
     │
     ▼
prompt / context builder
     │
     ▼
Claude Sonnet 4.6
     │
     ▼
compliance guard + post-generation checker + receipt assimilation
```

Until v0.7 lands, only the **first two** layers exist. The rest is the v0.6 production pipeline unchanged.

## Manifest schema

Each capability is a JSON file under `byon-orchestrator/config/capabilities/`. Required fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string, `lower_snake_case` | stable globally-unique id |
| `version` | semver string | manifest version |
| `status` | `active` \| `planned` \| `deprecated` \| `research` | router only considers `active` |
| `description` | string | human-readable purpose |
| `domains` | string[] | topical surface (e.g. `code`, `security`, `philosophy`) |
| `intents` | string[] | verbs the capability covers (`implement`, `audit`, `write-scene`) |
| `roles` | string[] | user roles this capability serves |
| `activation_keywords` | string[] | positive-match vocabulary |
| `negative_keywords` | string[] | strong anti-match vocabulary |
| `required_modules` | string[] | modules that MUST exist for full capability |
| `optional_modules` | string[] | additive modules |
| `memory_routes` | string[] | which memory tiers the capability expects |
| `context_builder` | string | id of the prompt/context builder strategy |
| `output_contract` | string | expected output shape (fenced code, citation+jurisdiction, …) |
| `guards` | string[] | post-generation guards specific to this capability |
| `experience_log` | boolean | whether router decisions should be logged |

Plus the operator-required negative invariant `level3_claim: false` (validated by the registry; any manifest with `level3_claim: true` is rejected) and an optional `module_status` map that marks each `required_module` as `active` | `planned` | `required_not_implemented`.

## Capability packs shipped in this commit

All 9 manifests are valid and load. **None are "complete capability packs" — most of their required_modules are status `planned`.** The router surfaces those gaps honestly via `missing_required_modules` and a `MISSING_REQUIRED_MODULE` reason code. The point of this PR is the *layer*, not the modules.

| id | what it routes to | required_modules currently `planned` |
| --- | --- | --- |
| `software_engineer` | multi-file repo work, refactors, debugging, tests | 9 / 9 |
| `project_manager` | release coordination, prioritisation, status | 3 / 4 |
| `security_auditor` | threat modelling, policy-bypass detection | 1 / 6 |
| `domain_analyst` | norms / standards / jurisdictional citations | 2 / 4 |
| `novelist` | scene / character / canon / plot continuity | 4 / 4 |
| `philosopher` | ontology / epistemology / argument structure | 3 / 3 |
| `construction_advisor` | civil / building codes / site safety | 2 / 3 |
| `legal_analyst` | statutory / contractual / case-law analysis | 3 / 4 |
| `pharmacology_safety_analyst` | drug interactions / pharmacokinetics / safety | 3 / 4 |

The remaining shipped pieces (`verified_project_fact`, `structural_reference_memory`, `domain_verified_facts`, `disputed_or_unsafe_rail`, `trust_ranked_formatter`, `auditor_authority_boundary`) are already active in the v0.6 pipeline and are referenced by the manifests where relevant.

## How the router scores

`capability-router.mjs::routeCapability(prompt, ctx, registry)`:

1. For each `active` manifest, score the prompt:
   - +1.0 per `activation_keyword` hit (word-boundary match for short tokens, substring for multi-word phrases)
   - +1.5 per `domain` hit (against `ctx.domains` if provided, else substring of prompt)
   - +1.2 per `intent` hit (against `ctx.intents`)
   - +1.4 if `ctx.role` matches one of the manifest's `roles`
   - −1.5 per `negative_keyword` hit
2. The highest-scoring manifest becomes `primary_capability`.
3. Any other manifest scoring ≥ 45 % of primary AND ≥ 1.5 absolute becomes `secondary`.
4. `confidence = min(1, primary_score / 6.0)`.
5. The plan unions `required_modules`, `memory_routes`, `guards` across selected packs.
6. Any `required_module` whose `module_status` is not `active` is reported in `missing_required_modules` and surfaces a `MISSING_REQUIRED_MODULE` reason code.

The output is a `CapabilityActivationPlan` (see `capability-router.mjs` JSDoc) with:

```
{
  primary_capability:        "software_engineer",
  secondary_capabilities:    ["project_manager"],
  selected_capabilities:     ["software_engineer", "project_manager"],
  confidence:                0.83,
  scores:                    { software_engineer: 7.5, project_manager: 4.2, ... },
  matched_domains:           [...],
  matched_intents:           [...],
  required_modules:          [...],
  missing_required_modules:  ["code_workspace_memory", "exact_file_state_store", ...],
  memory_routes:             [...],
  context_builder:           "coding_context_builder",
  guards:                    [...],
  reason_codes:              [...],
}
```

## What is intentionally NOT in this PR

- `code_workspace_memory`, `exact_file_state_store`, `symbol_index`, `requirements_ledger`, `patch_memory`, `test_failure_memory`, `architecture_map`, `workspace_diff_guard`, `coding_context_builder` — declared as `required` for `software_engineer` but their `module_status` is `planned`. They do not exist yet. **Coding is not solved by this PR.**
- No rerun of the coding benchmark.
- No new Claude API calls.
- No change to `theta_s` / `tau_coag`.
- No manual Omega.
- No Level 3 declaration.
- No cleanup, no branch deletion, no tag, no release.

The capability router will faithfully tell any future call site: "I would route this to `software_engineer`, but 9 of its 9 required modules are still planned." Until those modules exist, the runtime cannot pretend coding is fixed.

## Experience log

`capability-experience-log.mjs::CapabilityExperienceLog` appends one JSON line per routing decision to `test-results/capability-routing/<YYYY-MM-DD>.jsonl`:

```jsonc
{
  "ts": "2026-05-13T...",
  "prompt_id": "...",
  "primary_capability": "software_engineer",
  "secondary_capabilities": ["project_manager"],
  "confidence": 0.83,
  "reason_codes": ["keyword_match", "multi_capability_selected", "missing_required_module"],
  "modules_active": ["claude_api_live", "memory_service_live", "..."],
  "modules_missing": ["code_workspace_memory", "..."],
  "verdict": "...",
  "failures": [],
  "gaps": []
}
```

This is the substrate the v0.7 work will use to demonstrate whether each capability pack actually closes its gaps over time.

## Adding a new capability

1. Drop a new file at `byon-orchestrator/config/capabilities/<your_id>.json`.
2. Honour the required schema (see above) and keep `level3_claim: false`.
3. `npx vitest run tests/unit/capability-archive.test.ts` will catch malformed schemas, duplicate ids, or forbidden tokens.
4. No code change is required. The registry picks up the new file via directory scan.

## Tests

`byon-orchestrator/tests/unit/capability-archive.test.ts` covers the 14 operator-mandated acceptance items:

1. all 9 manifests load
2. schema is validated (missing fields, snake-case id, status enum, array fields)
3. duplicate id is rejected
4. coding prompt → `software_engineer` primary
5. fiction prompt → `novelist` primary
6. ontology / metaethics prompt → `philosopher` primary
7. norms / GDPR / jurisdiction prompt → `domain_analyst` or `legal_analyst`
8. router can select multiple capabilities (two scenarios: coding+release, security+coding)
9. coding prompt surfaces the 9 mandated coding modules in `required_modules`
10. missing required modules are reported (in plan and via `registry.missingRequiredModules()`)
11. router does not crash on a `contextual_pathway_state` and does not mutate it (v0.6.9.1 passthrough)
12. no manifest has `level3_claim: true`; no forbidden token (`LEVEL_3_REACHED`, `OMEGA_CREATED_MANUALLY`, `SYNTHETIC_OMEGA`, `THRESHOLD_LOWERED`) appears in any manifest
13. router and registry source code do not assign `theta_s` or `tau_coag`
14. registering a new in-memory manifest works (archive is extensible)

Plus one ExperienceLog smoke test for the per-day JSONL append.

## Hard isolation reaffirmed

- `theta_s = 0.28` unchanged
- `tau_coag = 12` unchanged
- no manual Omega
- no ReferenceField
- all operator-seeded structural references remain `origin=operator_seeded`
- `level_3_declared = false`
- `FULL_LEVEL3_NOT_DECLARED` continues to apply

The Contextual Capability Archive is **infrastructure**. The next concrete step is implementing the `software_engineer` capability pack — the 9 currently-`planned` modules — and only after that retrying the coding benchmark. **Coding is not declared solved.**
