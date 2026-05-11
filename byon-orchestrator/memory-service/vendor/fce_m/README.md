<p align="center">
  <img src="assets/logo_fragmergent_causal_exponentiation_memory.png" alt="FCE-M — Fragmergent Causal Exponentiation Memory" width="480">
</p>

# FCE-M — Fragmergent Causal Exponentiation Memory

> **Native Morphogenetic Memory Layer over UFME**
>
> | | |
> |---|---|
> | **Version** | v0.6.0 |
> | **Status** | Native Memory Prototype — PASS |
> | **Tests** | 268 / 268 passing |
> | **Layer** | UFME + multiperspectival observer + semi-active priority + ReferenceField |
> | **Repository** | https://github.com/NEURALMORPHIC-FIELDS/fragmergent-causal-exponentiation-memory |

BSD-3-Clause source license. Patent EP25216372.0 (related, separately held).
Author: Vasile Lucian Borbeleac, FRAGMERGENT TECHNOLOGY S.R.L., Cluj-Napoca,
Romania.

---

## Abstract

**FCE-M** is a prototype implementation of a *native morphogenetic memory
layer* in which past coagulated events do not remain inert historical
records — they become internal *reference fields* that shape how future
events are interpreted, without ever overriding epistemic truth.

The system layers the **FCE-Ω** (Fragmergent Causal Exponentiation with
Omega-Coagulation) morphogenetic dynamics on top of the **UFME**
(Unified Fragmergent Memory Engine) cognitive substrate. The result is
a memory architecture in which:

- a coherent input sequence drives a semantic center's `S_t` above a
  threshold `θ_s` for `τ_coag` consecutive cycles;
- the rule-based mechanism `check_coagulation` flips `Ω = 1`,
  registering an irreversible `OmegaRecord`;
- a `ReferenceField` is then projected from that record, with a frozen
  field signature derived from the coagulating dynamics;
- subsequent observations on the same center are classified
  morphogenetically (`aligned`, `expression_reinforcing`, `tensioned`,
  `orthogonal`, `contested_expression`, `residue_amplifying`) against
  the reference field, while the runtime's epistemic verdicts
  (committed / provisional / disputed / rejected) remain authoritative
  and unchanged.

`OmegaRecord` is the irreversible historical fact; `ReferenceField` is
the fluctuating functional field. Their separation is the central
contribution of FCE-M.

---

## What problem does FCE-M solve

Conventional vector stores treat memory as an archive: past events sit
in an index, queried when needed. They do not *shape* how new inputs
are processed. Symbolic memory engines verify truth; they decide what
gets committed, provisional, or disputed, but they do not have a notion
of *coagulated identity* that survives across episodes.

FCE-M asks a different question: what if some events *crystallize* —
producing an irreversible identity-like marker (`Ω`) — and what if
that marker, once crystallized, becomes a *reference frame* against
which subsequent inputs are read?

This is not a question about retrieval. It is a question about
morphogenetic structure: memory as **becoming**, not memory as
archive.

---

## Central formula

The FCE-Ω self-index is computed at each step of an agent:

```
S_t = AR_t · κ_t · I_t · B_t
```

where:

- `AR_t = |Φ_s^T · Π_s · Φ_s| / ‖Φ_s‖²` is the autoreferential coupling,
- `κ_t ∈ [0.01, 1]` is internal coherence,
- `I_t = ‖E_t‖ / (‖ΔX_t‖ + ε)` is the integration ratio,
- `B_t = 1 / (1 + ‖Z_t‖)` is the residue stability factor.

Coagulation fires when `S_t ≥ θ_s` for `τ_coag` consecutive cycles.
At that point an `OmegaRecord` is registered and (if enabled) a
`ReferenceField` is projected.

In the perspective-exponentiation reading of FCE, the causal effect of
a perspective `P` modulated by a dynamic field `Φ` produces the
self-index:

```
S = P^Φ
```

— causality as asymmetric contextual exponentiation over shared
dynamic fields.

---

## Relation to FCE-Ω and UFME

| Component | Role |
|---|---|
| **UFME** | Unified Fragmergent Memory Engine — read-only fused substrate over `D_CORTEX_ULTIMATE`, `fragmergent-tf-engine`, `fragmergent-memory-engine`. Manages memory: write, read, propagate, consolidate, audit. |
| **D_Cortex** | Verifies epistemic truth. Slot zones (committed / provisional / disputed / rejected) are its authoritative output. |
| **FCE-Ω** | Morphogenetic observer over UFME. Measures assimilation, residue, coagulation, reference. Code vendored at [`vendor/fce_omega_source/`](vendor/fce_omega_source/). |
| **Omega Registry** | Preserves the irreversible historical fact of each coagulation. |
| **ReferenceField** | Transforms coagulated Omega into a functional field that shapes interpretation of future events. New in v0.6.0. |
| **Advisory** | Read-only suggestions in `read_only` mode; bounded priority metadata in `priority_only` mode. Never overrides UFME or D_Cortex. |

---

## Current status

| | |
|---|---|
| **Version** | v0.6.0 |
| **Verdict** | Native Memory Prototype — PASS |
| **Tests** | 268 / 268 passing in `python -m pytest -q` |
| **Mode** | Passive integration with optional semi-active priority channel; reference-field reading of future events |
| **Truth authority** | Runtime / D_Cortex (unchanged) |

The full per-stage audit trail of how the project reached v0.6.0 lives
in [`results/etapa_*/`](results/). Each stage carries
`pytest_full.txt`, `pytest_summary.txt`, `report.txt`, `report.json`,
`manifest.json`, and a `CHANGELOG_slice.md`.

---

## Evolution line

| Etapă | Versiune | Capability | Tests | Verdict |
|---|---|---|---|---|
| 0 | v0.4.0 | passive integration baseline lock | 213 | PASS |
| 1 | v0.4.1 | center-isolated anchor | 222 | PASS |
| 2 | v0.4.2 | integrated R10b coagulation by rule | 231 | PASS |
| 3 | v0.5.0 | multiperspectival observer (passive) | 241 | PASS |
| 4 | v0.5.1 | semi-active advisory priority feedback | 254 | PASS |
| 5 | v0.6.0 | native memory prototype (ReferenceField) | **268** | **PASS** |

Detailed per-stage results: [`docs/RESULTS.md`](docs/RESULTS.md).
Staging discipline: [`docs/EVOLUTION_PROTOCOL.md`](docs/EVOLUTION_PROTOCOL.md).
Mission specification driving the integration: [`misiunea.txt`](misiunea.txt).

---

## Repository structure

```
fragmergent-causal-exponentiation-memory/
├── assets/                              project assets (logo)
├── unified_fragmergent_memory/          integrated package
│   ├── facade/                            UnifiedMemoryStore + Config
│   ├── runtime/                           observer, omega_registry,
│   │                                      reference_field, orchestrators
│   ├── sources/                           passthrough namespaces
│   │   ├── d_cortex/
│   │   ├── tf_engine/
│   │   ├── memory_engine_runtime/
│   │   └── fce_omega/                     FCE-Ω wrapper
│   └── bridges/                           shape, convention,
│                                          cross-substrate, fce_translator
├── vendor/
│   └── fce_omega_source/                  vendored FCE-Ω source, frozen
├── experiments/
│   └── r10b_integrated_phoenix.py         R10b reproduction experiment
├── tests/                               268 tests across the suite
│   ├── fce_omega/                         v0.4.0 unit (20)
│   ├── fce_omega_functional/              v0.4.0–v0.6.0 functional (62)
│   └── ...                                pre-v0.4.0 UFME tests (140)
├── tools/
│   ├── fce_functional_report.py           emits results/...report.{txt,json}
│   └── stage_finalize.py                  per-stage artifact orchestrator
├── results/
│   ├── etapa_00_v0_4_0_baseline/
│   ├── etapa_01_v0_4_1_center_isolated_anchor/
│   ├── etapa_02_v0_4_2_r10b_integrated/
│   ├── etapa_03_v0_5_0_multiperspectival_observer/
│   ├── etapa_04_v0_5_1_semi_active_priority_feedback/
│   └── etapa_05_v0_6_0_native_memory_reference_field/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── METHODOLOGY.md
│   ├── RESULTS.md
│   ├── FUNCTIONAL_VALIDATION.md
│   ├── NATIVE_MEMORY_MODEL.md
│   ├── LIMITATIONS.md
│   ├── REPRODUCIBILITY.md
│   └── EVOLUTION_PROTOCOL.md
├── README.md       (this file)
├── PAPER.md        mini-paper
├── CHANGELOG.md
├── CITATION.cff
├── LICENSE
├── misiunea.txt    mission specification driving the integration
├── pyproject.toml
├── requirements.txt
└── reproduce.sh
```

---

## Quickstart

```bash
# 1. Clone
git clone https://github.com/NEURALMORPHIC-FIELDS/fragmergent-causal-exponentiation-memory.git
cd fragmergent-causal-exponentiation-memory

# 2. Install (editable) with dev extras
python -m pip install -e ".[dev]"

# 3. Run the test suite — expect 268 passed
python -m pytest -q

# 4. Run the R10b coagulation experiment
python experiments/r10b_integrated_phoenix.py
```

The R10b experiment produces a trajectory artifact at
`results/etapa_02_v0_4_2_r10b_integrated/r10b_trajectory.{json,txt}`
documenting the full germinal-incubation → coagulation → perturbation
cycle.

---

## Reproducibility

Full reproducibility instructions: [`docs/REPRODUCIBILITY.md`](docs/REPRODUCIBILITY.md).

Short form: install, run `python -m pytest -q`, expect **268 passed**.
Every stage of the evolution has frozen artifacts in
[`results/etapa_*/`](results/) that can be diffed against a fresh
run.

---

## Main results

1. **R10b coagulation reproduced inside the integrated runtime**:
   `phoenix::identity` coagulates at episode 3, cycle 3, with
   `S_t = 0.10227`, `κ = 0.458`, `AR = 0.677`, classified as an
   `integrative` self. Coagulation is produced by the
   `check_coagulation` rule, not by manual injection.
   ([test_17](tests/fce_omega_functional/test_17_r10b_integrated_reproduction.py),
   [r10b_trajectory.txt](results/etapa_02_v0_4_2_r10b_integrated/r10b_trajectory.txt))

2. **Omega irreversibility under perturbation**: 8 disputed events
   post-coagulation drive `S_t` from 0.026 to 0.003 and `κ` from 0.31
   to 0.09, but the OmegaRecord's `omega_id`,
   `coagulated_at_episode`, and `S_t_at_coagulation` remain immutable.
   ([test_05](tests/fce_omega_functional/test_05_omega_irreversibility.py))

3. **Truth-status preserved**: across all stages, the runtime adapter's
   `slot_event_log` is byte-identical between observer-off and
   observer-on runs; disputed events post-coagulation still report
   `zone_after = DISPUTED`.
   ([test_06](tests/fce_omega_functional/test_06_omega_not_truth.py))

4. **Per-center isolation (v0.4.1)**: anchor is computed strictly from
   a center's own zone counts. Disputed writes on B no longer
   modulate `disrupt_eff` for A. ([test_16](tests/fce_omega_functional/test_16_center_isolated_anchor.py))

5. **Multiperspectival bounded normalization (v0.5.0)**: directional
   interactions normalized by `N(N-1)`, shared coagulation candidates
   by `N(N-1)/2`. Total directional norm stays bounded for `N ∈
   {1, 4, 8, 16}`. ([test_18](tests/fce_omega_functional/test_18_multiperspectival_observer.py))

6. **ReferenceField from OmegaRecord (v0.6.0)**: created only when
   `Ω = 1` is registered. Cannot exist for non-coagulated centers.
   Future events on the same center receive a morphogenetic
   classification (`aligned`, `tensioned`, etc.) without altering
   slot zones or OmegaRecord history.
   ([test_20](tests/fce_omega_functional/test_20_reference_field_native_memory.py))

---

## Limitations

Honest accounting of what FCE-M v0.6.0 does NOT yet do:

- No self-application loop: advisory feedback is still consumed by
  callers, not by the observer itself.
- No first-class `RelationRegistry`: relation candidates remain
  ephemeral `RelationCandidate` items.
- `field_vector` is a heuristic blend of `Phi_s` and `delta_X`, not a
  learned semantic embedding.
- Inter-Omega-field interactions fire only for co-active pairs in the
  same consolidate pass; there is no temporal cross-episode
  aggregation of Omega-field signal.
- In-episode aggregation collapses multiple within-episode events on
  the same center into a single `delta_X` before agent step.

Full discussion: [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md).

---

## Documents

- [`PAPER.md`](PAPER.md) — mini-paper academic write-up
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architectural formula and component diagram
- [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) — what each test category validates
- [`docs/RESULTS.md`](docs/RESULTS.md) — per-stage results and metrics
- [`docs/FUNCTIONAL_VALIDATION.md`](docs/FUNCTIONAL_VALIDATION.md) — what is concretely validated and how
- [`docs/NATIVE_MEMORY_MODEL.md`](docs/NATIVE_MEMORY_MODEL.md) — ReferenceField and the OmegaRecord → ReferenceField distinction
- [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) — honest limitations and out-of-scope items
- [`docs/REPRODUCIBILITY.md`](docs/REPRODUCIBILITY.md) — step-by-step reproduction
- [`docs/EVOLUTION_PROTOCOL.md`](docs/EVOLUTION_PROTOCOL.md) — staging discipline used to build the project
- [`misiunea.txt`](misiunea.txt) — original mission text driving the integration
- [`CHANGELOG.md`](CHANGELOG.md) — per-version changes

---

## Citation

If you use FCE-M in a paper or downstream project, please cite the
[`CITATION.cff`](CITATION.cff) file, or use the following BibTeX-style
entry as a starting point:

```
@software{borbeleac_fcem_2026,
  author  = {Vasile Lucian Borbeleac},
  title   = {FCE-M: Fragmergent Causal Exponentiation Memory},
  version = {v0.6.0},
  year    = {2026},
  url     = {https://github.com/NEURALMORPHIC-FIELDS/fragmergent-causal-exponentiation-memory},
  note    = {Native morphogenetic memory layer over UFME}
}
```
