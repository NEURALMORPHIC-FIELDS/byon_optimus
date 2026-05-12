# Level 3 Research Synthesis — Surrogate vs Real FCE Divergence

> ADVISORY ONLY. Research synthesis artifact. Does NOT declare Level 3,
> does NOT create OmegaRecord, does NOT touch production. Aggregates
> the findings of commits 2–12 on `research/level-3-natural-omega`.

- Report version: `level3-synthesis-after-real-fce.v1`
- Branch: `research/level-3-natural-omega`
- As of commit: **`5bd9f1f`** (commit 12, isolated real-FCE-M adapter)
- `origin/main`: `15a7c47` — unchanged
- Operational classification on main: **Level 2 of 4** (Morphogenetic
  Advisory Memory)
- Operator-locked thresholds: `theta_s = 0.28`, `tau_coag = 12` — both
  unchanged throughout this research line.

## 1. What was demonstrated

The research branch landed nine sequential commits (2 → 10) before
commit 11 introduced the controlled coagulation observation and
commit 12 wired the isolated real-FCE-M adapter. Across those
commits the following research-internal facts are now grounded by
tests:

- **Z_active semantics works.** Every cycle's `z_active` is reduced by
  applying a `SummaryEvent` and `z_total` is preserved. Conservation
  invariant `z_active + z_resolved + z_archived == z_total` holds in
  both 500-row replays (Transcript A and B) with `audit_flags = []`.
- **Summaries preserve `Z_total` and reduce `Z_active`.** A: 105
  summaries reduce z_active to 34.75 / 151.40 total (≈23 %); B: 130
  summaries reduce z_active to 22.30 / 144.40 total (≈15 %). The
  archived buffer rows remain recoverable (test_11 of the harness
  suite).
- **PotentialOmega surrogate signals reproduce across A and B.**
  Common signal buckets observed in both runs:
  `byon::general::factual`, `byon::macp_pipeline::factual`,
  `byon::security_boundary::security_boundary`,
  `byon::trust_hierarchy::factual`,
  `byon::unsafe_memory::security_boundary`. All 125 signals
  (49 A + 76 B) carry `advisory_only = True`.
- **Surrogate temporal rule passes on every candidate bucket.** Commit
  11's controlled observation showed `WOULD_COAGULATE` on all six
  (bucket × transcript) pairs using `s_t_surrogate = (ar+kappa+b)/3`.
  Final verdict was `ISOLATED_RULE_OBSERVED_NO_OMEGA_CREATED`.
- **Real FCE math does NOT coagulate.** Commit 12's adapter, which
  feeds the production `Agent` and `self_index` formulas via the
  vendored FCE-M source, produced `REAL_FCE_NO_COAGULATION` on every
  candidate bucket in both transcripts. No `OmegaRecord` was created,
  no `OmegaRegistry` write occurred, no `ReferenceField` was created,
  `agent.check_coagulation` was never called.

## 2. Real result (commit 12)

| metric                              | A (seed 42) | B (seed 1337) |
|---|---:|---:|
| candidate buckets all return        | `REAL_FCE_NO_COAGULATION` | `REAL_FCE_NO_COAGULATION` |
| max real S_t observed (across 3 buckets) | 0.1383 | 0.1380 |
| mean real S_t observed (across 3 buckets) | 0.0125 | 0.0147 |
| longest_run_above_theta             | 0           | 0             |
| `theta_s` used                      | 0.28 (unchanged) | 0.28 (unchanged) |
| `tau_coag` used                     | 12 (unchanged)   | 12 (unchanged)   |
| FCE-M vendor mutation               | none        | none          |
| production config mutation          | none        | none          |
| `agent.check_coagulation` calls     | 0           | 0             |
| `OmegaRegistry.register` calls      | 0           | 0             |
| `OmegaRecord` instances created     | 0           | 0             |
| `ReferenceField` instances created  | 0           | 0             |
| `agent.Omega` final state           | 0 (verified) | 0 (verified) |

Final verdict (commit 12): **`REAL_FCE_NO_COAGULATION`**

## 3. Technical cause (probable)

The real FCE formula for the self-index is multiplicative:

    S_t = AR * kappa * I_t * B_t

with each factor in `[0, 1]`. Commit 12's adapter feeds the production
`Agent` deterministic field vectors derived as SHA-256 hashes of the
research cycle ids, scaled by `z_active`, with anchor =
`0.5 * s_t_surrogate + 0.5 * b_t_surrogate`.

Hash-derived field vectors are deterministic and reproducible, but
they have NO semantic alignment with the agent's internal direction
`Phi_s`. The components that depend on alignment with `Phi_s` —
specifically the assimilation term `I_t = ||E|| / (||delta_X|| + eps)`,
where `E` is the projected (Φ_s-aligned) excitation — therefore stay
small. With AR and B_t each near their default values, the product
`AR * kappa * I_t * B_t` collapses to ≈ 0.13 max, ≈ 0.01 mean.

This is the same mathematical reason the surrogate metric (an
arithmetic *mean* of three [0, 1]-bounded quantities) and the real
metric (a *product* of four [0, 1]-bounded quantities) diverge so
sharply: a mean of three near-1 values stays high; a product of four
values where one is ≈ 0.1 (because alignment is absent) drops near
zero. The product form is more conservative by design, and FCE-M
intends this conservatism — it is the production safeguard against
declaring coagulation on alignment-free noise.

The hash vectors are the smallest deviation from production we could
make while keeping the experiment isolated and free of LLM /
embedding imports. The divergence between the surrogate `WOULD_PASS`
and the real `REAL_FCE_NO_COAGULATION` is therefore most plausibly an
artifact of the missing semantic encoder, not a property of the data.

## 4. What CANNOT be claimed

Strictly, on the basis of commits 2–12, the operator MUST NOT claim
any of the following:

- **No Level 3.** The operational classification on `main` remains
  Level 2 of 4. Nothing in this research line escalates that.
- **No natural Omega.** No `OmegaRecord` exists. The surrogate
  temporal rule passing on commit 11 does not constitute Omega
  creation; the real FCE math on commit 12 explicitly does not even
  approach the threshold.
- **No `ReferenceField`.** The reference-field projection path runs
  only in the production observer after `OmegaRegistry.register(...)`
  succeeds. Both are forbidden on this branch and were never invoked.
- **No production-loop proof.** No production conversational input
  has been driven through `FceOmegaObserver.step(...)` to observe
  coagulation in the real loop. This adapter is isolated by design.
- **No claim that the thresholds are wrong.** `theta_s = 0.28` and
  `tau_coag = 12` remain operator-locked. The fact that hash-derived
  field vectors fail to produce sufficient `S_t` says nothing about
  the validity of those thresholds; it says the inputs lack semantic
  fidelity.

## 5. What comes next

The next valid experiment is the **Semantic Vector Observation
Adapter**. Its purpose is to determine whether replacing hash-derived
field vectors with real semantic vectors raises `I_t` enough for the
real FCE `S_t` to approach the operator-locked threshold.

Constraints carried over from commit 12 (still binding):

- No `OmegaRegistry.register(...)` call.
- No `OmegaRecord` creation.
- No `ReferenceField` creation.
- No `is_omega_anchor` identifier.
- No `agent.check_coagulation(...)` call (use the local audit rule).
- No mutation of the FCE-M vendor source.
- No mutation of production config.
- No declaration of Level 3 on `main`.
- No tag, no GitHub Release.

New constraint specific to the Semantic Vector Adapter:

- Field vectors must come from a real semantic encoder. Either
  - the production embedding pipeline (sentence-transformers
    `all-MiniLM-L6-v2`, 384-dim) imported read-only with the same
    isolation guarantees as the FCE-M import in commit 12, OR
  - an equivalent semantic encoder loaded only in the research
    process, with the divergence from production explicitly marked.
- Vectors must be derived from the actual transcript turn texts, not
  from cycle metadata.
- The temporal rule remains the local audit re-implementation; the
  production `check_coagulation` remains untouched.

Goal: observe whether semantic alignment is the missing factor that
makes `I_t` (and thus the real FCE `S_t`) approach `theta_s` under the
unchanged production rule.

If the Semantic Vector Adapter shows the same `REAL_FCE_NO_COAGULATION`
verdict, the research line concludes that the surrogate-vs-real gap is
fundamental to FCE-M's product form on these workloads and a different
adapter design or new transcripts would be required.

If the Semantic Vector Adapter shows `REAL_FCE_TEMPORAL_RULE_OBSERVED_NO_OMEGA_CREATED`,
it is then the operator's prerogative to design a separate
production-loop test that decides whether Level 3 escalation is
warranted. That test is out of scope for the current branch.

## 6. L3 gate status after commit 12

| Gate | Status | Notes |
|---|---|---|
| L3-G1 | **PASS** | Conservation invariant + z_active < z_total on both runs. |
| L3-G2 | **PARTIAL** | Within-run b_t recovery observed; controlled coagulation experiment performed at surrogate level (commit 11) and real-FCE level (commit 12); the real-FCE side did not recover above threshold, so PARTIAL stays. |
| L3-G3 | **PASS** | Every summary preserves non-empty `source_event_ids` across both transcripts. |
| L3-G4 | **PASS** | `CenterEventBuffer.archive_event` marks events archived but never deletes them; raw events remain recoverable. |
| L3-G5 | **PASS** | 125 PotentialOmega signals (49 A + 76 B) all carry `advisory_only = True`. |
| L3-G6 | **PASS** | Harness and adapters never call `check_coagulation`; AST-verified. The conditional "no Omega unless check_coagulation fires" is vacuously satisfied. |
| L3-G7 | **NOT_TESTED_YET** | No `OmegaRecord` → `ReferenceField` path is intentionally not exercised. |
| L3-G8 | **NOT_TESTED_YET** | No Omega exists to be contested post-coagulation. |
| L3-G9 | **NOT_TESTED_YET** | D / E / F / M / N benchmark suites belong on `main`; the research branch is zero-diff for production paths (`git diff origin/main -- src/ scripts/ memory-service/{server.py,handlers.py,vendor/}` is empty). |
| L3-G10 | **PARTIAL / BLOCKED_BY_REAL_FCE_NO_COAGULATION** | Two independent transcripts (A seed=42, B seed=1337) replay successfully with comparable surrogate signal distributions. Surrogate temporal rule passes on both. Real-FCE rule does NOT pass on either. Without a real-FCE coagulation event, the "second independent run reproduces an Omega" criterion cannot be evaluated. Operator approval is a separate gating step. |

Status tally (10 gates): **PASS=5, PARTIAL=2, NOT_TESTED_YET=3, BLOCKED=1 (L3-G10)**.

The BLOCKED status on L3-G10 is operator-marked rather than failed:
the gate's prerequisite (Omega coagulation under real FCE math) was
not observed. Unblocking requires the Semantic Vector Observation
Adapter described in §5.

## 7. Final conclusion

> **Positive research infrastructure; Level 3 not reached; next
> bottleneck is semantic assimilation fidelity `I_t`.**

Eleven research commits established:

- a deterministic projection / metabolism / summary / detector / harness
  pipeline (commits 2 – 7) with 122 + 21 = 143 tests passing,
- two 500-row hand-authored transcripts (commits 8 – 9),
- a formal A/B comparison + L3 gate audit (commit 10),
- a surrogate-level controlled coagulation observation (commit 11),
- and an isolated real-FCE-M observation adapter (commit 12).

All eleven commits leave `origin/main` untouched. The research branch
has 227 tests passing. `theta_s` is 0.28 and `tau_coag` is 12 in every
single artifact that ships in this commit chain.

The path from "surrogate would coagulate" (commit 11) to "real FCE
math does not coagulate" (commit 12) is the most important finding so
far: it shows the surrogate metric is a feasibility geometry, not a
production rule pass. The real FCE product form is more conservative
by design, and on hash-derived field vectors it stays well below
threshold.

The next bottleneck is identified: `I_t` (assimilation fidelity)
under semantic alignment. The Semantic Vector Observation Adapter is
the experiment that decides whether semantic-encoder field vectors
recover enough `I_t` to reach the operator-locked threshold under
the unchanged production rule.

Level 3 is NOT declared. Natural Omega is NOT proven. The research
infrastructure is healthy and ready for the next, semantically-faithful
observation. Main remains Level 2 of 4.
