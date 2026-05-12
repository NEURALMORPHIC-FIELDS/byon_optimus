# Level 3 — Natural Omega Research

**Branch:** `research/level-3-natural-omega` (this directory is on this branch only).
**Status:** Research skeleton — first code commit. No Omega creation. No `check_coagulation` modifications. No production imports.
**Operational classification of `main`:** stays **Level 2 of 4 — Morphogenetic Advisory Memory** until §8 L3-G10 of the design doc holds AND operator approves.

This directory is the research workspace for testing whether a natural `OmegaRecord` can form under the operator-locked thresholds (`θ_s = 0.28`, `τ_coag = 12`) via the existing `check_coagulation` path, by changing only the *information shape* that feeds the coagulation rule — never the rule itself, never the thresholds.

For the full design rationale, see [`../../docs/LEVEL3_NATURAL_OMEGA_RESEARCH.md`](../../docs/LEVEL3_NATURAL_OMEGA_RESEARCH.md).

---

## Isolation policy

This package **MUST NOT** be imported by production code on `main`. Specifically:

- No `from level3_research import ...` in production modules.
- No `import level3_research` in any path under `byon-orchestrator/src/`, `byon-orchestrator/scripts/`, or `byon-orchestrator/memory-service/`.
- No FCE-M facade hooks. No feature-flagged production code paths.
- No mutation of `OmegaRegistry` from anywhere in this directory.

`__init__.py` emits a `UserWarning` at import time if the caller's file path suggests production usage (best-effort guard — does not raise).

The research package re-uses FCE-M numerics and embeddings via documented public APIs (read-only) when it needs them; it never reaches around the public surface.

---

## Operator-locked decisions (Q1–Q8, 2026-05-12)

These eight decisions are the gate for any work in this directory. They are committed to [`../../docs/LEVEL3_NATURAL_OMEGA_RESEARCH.md`](../../docs/LEVEL3_NATURAL_OMEGA_RESEARCH.md) §0.1 Decision Log. Recap:

| # | Topic | Decision |
|---|---|---|
| Q1 | Harness domain | **BYON-architecture deep-dive** |
| Q2 | Transcript length / author | **500 turns, hand-authored / curated, fixed five-phase structure** (100 + 100 + 100 + 100 + 100) |
| Q3 | LLM summaries in v1 | **Not allowed.** v1 is deterministic only |
| Q4 | Fan-out depth | **4 perspectives**: `factual`, `project_state`, `domain_verified`, `security_boundary` |
| Q5 | `PotentialOmegaCenter` window K | **K = 12** (aligned with `τ_coag = 12`) |
| Q6 | Independent reproduction | Run 1 = Transcript A + seed 42; Run 2 = Transcript B + seed 1337; same code, same gates |
| Q7 | Harness location | **Local first.** Optional `workflow_dispatch` CI later, gated on runtime / cost data |
| Q8 | Branch isolation | **Parallel directory** (this directory). No production imports |

---

## Directory layout

```
byon-orchestrator/level3-research/
├── README.md                              ← this file
├── __init__.py                            ← isolation guard + version
├── schemas/
│   ├── __init__.py
│   ├── perspective.py                     ← 4-perspective enum (Q4)
│   ├── memory_event.py                    ← raw MemoryEvent + ProvenanceRecord
│   ├── center_event_buffer.py             ← per-center ring buffer schema
│   ├── rolling_summary.py                 ← RollingCenterSummary + SummaryEvent + TombstoneRef
│   └── z_counters.py                      ← Z_total / Z_active / Z_resolved / Z_archived
├── transcripts/
│   ├── README.md                          ← transcript format spec + phase plan
│   ├── transcript_A_byon_arch.jsonl       ← Run 1 (seed 42) — SKELETON, sample turns per phase
│   └── transcript_B_byon_arch.jsonl       ← Run 2 (seed 1337) — SKELETON, sample turns per phase
└── tests/
    └── (empty for first commit — schemas only, no behaviour to test yet)
```

For this **first commit**:

- Schemas are Python `@dataclass(frozen=True)` records with full field-level documentation. They describe shapes; they do not yet drive behaviour.
- Transcripts are JSONL skeletons with sample rows per phase. The full 500-turn hand-authored transcripts are a separate, larger task (operator authorship).
- No Z metabolism logic. No summary policy. No `check_coagulation` interaction. No fan-out runtime. No `PotentialOmegaCenter` detector. Those land in subsequent commits, each gated on a separate operator confirmation.

---

## What this commit does NOT touch

- `byon-orchestrator/memory-service/` (FCE-M production layer untouched)
- `byon-orchestrator/scripts/` (orchestrator scripts untouched)
- `byon-orchestrator/src/` (TypeScript orchestrator untouched)
- `OmegaRegistry`, `check_coagulation`, FCE-M Config, `θ_s`, `τ_coag` — all untouched
- `main` branch — not merged into, not modified

---

## Reproducibility

Every artefact in this directory MUST be reproducible from the seed values declared in the operator decision log (Q6):

- Run 1 seed: 42 (matches FCE-M R10b family)
- Run 2 seed: 1337

The schemas and transcripts in this commit do not yet exercise reproducibility. They define the *shape* that subsequent commits will enforce.

---

## Hard constraints (restated for the implementer of subsequent commits)

| # | Constraint |
|---|---|
| C1 | `theta_s = 0.28` unchanged |
| C2 | `tau_coag = 12` unchanged |
| C3 | OmegaRecord only via `check_coagulation` |
| C4 | No LLM-created Omega |
| C5 | No manual `registry.register(...)` outside `check_coagulation` |
| C6 | No `is_omega_anchor=True` |
| C7 | Rolling summaries do NOT create Omega |
| C8 | Raw events archived, never deleted |
| C9 | Full provenance mandatory |
| C10 | `main` stays Level 2 until §8 L3-G10 holds AND operator approves |
| C11 | Prior `research/level-3` branch (if any) untouched |

Patent: EP25216372.0 — Omni-Qube-Vault — Vasile Lucian Borbeleac / FRAGMERGENT TECHNOLOGY S.R.L.
