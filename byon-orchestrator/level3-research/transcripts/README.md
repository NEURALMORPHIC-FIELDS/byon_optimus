# Transcripts — Level 3 Natural Omega Research

Operator decision Q2 (2026-05-12): **500 turns, hand-authored / curated, fixed five-phase structure.**
Operator decision Q6 (2026-05-12): **Run 1 = Transcript A + seed 42; Run 2 = Transcript B + seed 1337.** Same code, same gates.

The two transcripts in this directory are the inputs to the
`LongNaturalTranscriptHarness` (see [`../../../docs/LEVEL3_NATURAL_OMEGA_RESEARCH.md`](../../../docs/LEVEL3_NATURAL_OMEGA_RESEARCH.md) §7). They are JSONL files with one row per turn.

## Phase plan (operator-locked, fixed for v1)

| Phase | Turns | Role |
|---|---:|---|
| 1 — `arch_recap` | 100 | Architecture recap / stable center formation. Repeated mentions of Worker / Auditor / Executor / Ed25519 / MACP / air-gap. Forms strong factual + project_state centers. |
| 2 — `trust_hierarchy` | 100 | Trust hierarchy / verified facts / domain facts. Heavy on SYSTEM_CANONICAL, VERIFIED_PROJECT_FACT, DOMAIN_VERIFIED. Forms domain_verified + factual centers. |
| 3 — `contradictions` | 100 | Contradictions, adversarial claims, corrections. Stress-tests the residue accounting: tensioned + contested + correction-chain events. Forms security_boundary centers + tensioned-events on existing centers. |
| 4 — `receipts` | 100 | Receipts, benchmark results, release decisions. `receipt_success` events resolve prior tensioned events on the same centers, exercising the deterministic v1 summary policy (§3.3 design doc). |
| 5 — `return_to_centers` | 100 | Re-touching the same centers after drift. Recurring references to centers established in phases 1-2. The phase that should let `S_t` actually clear `θ_s = 0.28` for `τ_coag = 12` consecutive cycles, if a natural Omega can form at all. |

Phase order is **fixed** for v1. Re-ordering or swapping phases requires an
amendment to the design doc.

## Row schema (JSONL)

Each row in `transcript_A_byon_arch.jsonl` / `transcript_B_byon_arch.jsonl`
is a JSON object on a single line. Fields:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `turn_index` | int | yes | 0-based, contiguous across all 500 turns of the transcript |
| `phase` | str | yes | one of `arch_recap` / `trust_hierarchy` / `contradictions` / `receipts` / `return_to_centers` |
| `text` | str | yes | the raw user turn text (hand-authored; ≤2000 chars per turn) |
| `expected_kind` | str | yes | one of the values in `schemas.memory_event.EventKind` (`aligned` / `tensioned` / `contested` / `correction` / `receipt_success` / `receipt_partial` / `receipt_failure` / `security_rejected`) |
| `expected_perspective_hits` | list[str] | yes | subset of `["factual", "project_state", "domain_verified", "security_boundary"]` — which perspectives the harness expects this turn to project into. May be empty (no projection — chit-chat). |
| `notes` | str | no | optional human note for audit (not consumed by the harness) |

The harness honours `expected_kind` and `expected_perspective_hits` only as
**audit baselines**. The actual classification at run time comes from the
deterministic projection policy (subsequent commit) — and the harness
reports any mismatch so the operator can review.

## What this commit ships

The first code commit on this branch ships **skeleton transcripts only** —
a small number of sample rows per phase, not the full 500 hand-authored
turns. The skeleton:

- Demonstrates the JSONL row schema and phase tagging.
- Provides enough rows for schema-parsing tests in subsequent commits.
- Is **not** a runnable harness input. A full run requires the complete
  500-turn hand-authored transcript (operator authorship task).

## Reproducibility

- `transcript_A_byon_arch.jsonl` is paired with seed **42** for Run 1.
- `transcript_B_byon_arch.jsonl` is paired with seed **1337** for Run 2.
- Both transcripts are static files in this repo. They are NOT generated;
  they are hand-authored.
- The two transcripts share the phase structure but differ in turn content,
  vocabulary, and recurring-center identities. They are distinct workloads.

L3-G10 (independent reproduction) is satisfied only when at least one
natural Omega forms under BOTH runs, each subject to the same gate matrix.

## Out of scope for this commit

- Authoring the full 500-turn transcripts (separate, operator-authored task).
- Harness runner code (replay loop, deterministic projection policy,
  embedding calls, Z metabolism, summary policy, PotentialOmegaCenter
  detector). Each is a separate commit gated on a separate operator
  confirmation.
- Comparison report generator (audits Run 1 vs Run 2 telemetry).
