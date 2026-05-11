# BYON-FCE-M v0.6.4b — Coagulation Feasibility Harness Report

**Run:** 2026-05-11T20:33:33.936Z → 2026-05-11T20:33:35.287Z
**Center:** `byon::execution_boundary`
**Events:** 20, consolidate every 1 event(s)

## Verdict

- **Coagulation events:** 0
- **Omega registry delta:** 0
- **ReferenceFields delta:** 0
- **S_t ≥ θ_s (=0.28)** in 0/20 cycles, longest streak = 0 (need 12 for coagulation).
- **Bottleneck diagnosis:** κ (internal coherence) — events too inconsistent semantically

## Metrics

| Metric | min | p50 | mean | p95 | max |
|---|---|---|---|---|---|
| S_t | 0.0147 | 0.0253 | 0.0429 | 0.1119 | 0.1530 |
| AR | 0.6976 | 0.7664 | 0.7591 | 0.7813 | 0.7826 |
| κ | 0.1716 | 0.2666 | 0.3112 | 0.5129 | 0.5325 |
| Z_norm | 0.6668 | 4.6581 | 4.1833 | 5.7204 | 5.7553 |
| ΔX | 2.0025 | 2.0025 | 2.0025 | 2.0025 | 2.0025 |

## Factor decomposition (proxies)

S_t = AR · κ · I_t · B_t

- AR mean: **0.759** (max=1.0)
- κ mean: **0.311** (range 0.01–1.0)
- B_t proxy (= 1/(1+Z)) mean: **0.225**
- I_t proxy (= S_t / (AR · κ · B_t)) mean: **0.723**
- Z_norm mean: 4.183 (residue accumulation)
- ΔX mean: 2.002 (state change per event)

## Cycle trace (first 20 + last 5)

| event | cycle | S_t | AR | κ | Z_norm | ΔX | Ω | new_coag |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 0.1530 | 0.698 | 0.532 | 0.667 | 2.002 | 0 | false |
| 2 | 2 | 0.1119 | 0.715 | 0.513 | 1.287 | 2.002 | 0 | false |
| 3 | 3 | 0.0879 | 0.728 | 0.491 | 1.867 | 2.002 | 0 | false |
| 4 | 4 | 0.0717 | 0.737 | 0.466 | 2.404 | 2.002 | 0 | false |
| 5 | 5 | 0.0599 | 0.745 | 0.438 | 2.898 | 2.002 | 0 | false |
| 6 | 6 | 0.0506 | 0.751 | 0.408 | 3.345 | 2.002 | 0 | false |
| 7 | 7 | 0.0430 | 0.756 | 0.375 | 3.744 | 2.002 | 0 | false |
| 8 | 8 | 0.0370 | 0.760 | 0.344 | 4.094 | 2.002 | 0 | false |
| 9 | 9 | 0.0323 | 0.763 | 0.315 | 4.398 | 2.002 | 0 | false |
| 10 | 10 | 0.0284 | 0.766 | 0.290 | 4.658 | 2.002 | 0 | false |
| 11 | 11 | 0.0253 | 0.769 | 0.267 | 4.880 | 2.002 | 0 | false |
| 12 | 12 | 0.0228 | 0.771 | 0.246 | 5.067 | 2.002 | 0 | false |
| 13 | 13 | 0.0207 | 0.773 | 0.229 | 5.224 | 2.002 | 0 | false |
| 14 | 14 | 0.0190 | 0.775 | 0.214 | 5.354 | 2.002 | 0 | false |
| 15 | 15 | 0.0177 | 0.776 | 0.201 | 5.461 | 2.002 | 0 | false |
| 16 | 16 | 0.0166 | 0.777 | 0.191 | 5.548 | 2.002 | 0 | false |
| 17 | 17 | 0.0158 | 0.779 | 0.183 | 5.619 | 2.002 | 0 | false |
| 18 | 18 | 0.0152 | 0.780 | 0.177 | 5.676 | 2.002 | 0 | false |
| 19 | 19 | 0.0149 | 0.781 | 0.173 | 5.720 | 2.002 | 0 | false |
| 20 | 20 | 0.0147 | 0.783 | 0.172 | 5.755 | 2.002 | 0 | false |

## Files

- JSON: `test-results/fcem-coagulation-harness-v0.6.4b.json`
- MD:   `test-results/fcem-coagulation-harness-v0.6.4b.md`