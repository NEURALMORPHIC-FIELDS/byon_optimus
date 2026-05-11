## 0.4.2 (2026-05-11) — Integrated R10b Reproduction

Reproduces the central FCE-Ω event end-to-end inside the integrated
runtime: a coherent committed sequence on a single semantic center
drives S_t above theta_s for tau_coag consecutive cycles, and the
observer's `check_coagulation` flips `Ω=1` **by rule**, not by
manual injection.

Under the realistic thresholds picked in this release (`theta_s=0.10`,
`tau_coag=3`, `D=16`, `seed=42`), the `phoenix::identity` center
coagulates at episode 3 / cycle 3 with `S_t=0.1023`, `κ=0.458`,
`AR=0.677`. The agent's classification at coagulation is
`integrative` (κ_coag ≥ 0.40 per Agent.sine_type).

After coagulation, an 8-cycle disputed perturbation phase drives S_t
from 0.026 down to 0.003 and AR from 0.56 to 0.32, while:

  - `Ω` remains 1 (irreversibility);
  - `omega_id`, `coagulated_at_episode`, `S_t_at_coagulation`,
    `kappa_at_coagulation` are immutable in the OmegaRecord;
  - the runtime adapter's `slot_event_log` continues to report
    `zone_after=DISPUTED` for the last write (truth status preserved);
  - `source_episodes` and `source_events` provenance are complete;
  - persist / load roundtrip preserves the OmegaRecord.

### Added

- `experiments/r10b_integrated_phoenix.py` — driveable R10b experiment
  that emits `results/etapa_02_v0_4_2_r10b_integrated/r10b_trajectory.{json,txt}`
  (full cycle-by-cycle trajectory of S_t / AR / κ / Z / Omega across
  germinal + perturbation phases, plus the post-experiment invariant
  flags).
- `experiments/__init__.py` so the experiment module is importable
  from tests.
- `tests/fce_omega_functional/test_17_r10b_integrated_reproduction.py`
  — 9 functional tests pinning the contract:
  - Omega emerges from `check_coagulation`, not from a synthetic
    `agent.Omega = 1` flip nor a direct `registry.register` call;
  - thresholds are realistic (theta_s ≥ 0.05, tau_coag ≥ 2);
  - S_t / AR / κ at coagulation are meaningful (S_t crosses θ, AR > 0.5);
  - irreversibility after disputed perturbation;
  - runtime log zone preserved as DISPUTED;
  - provenance complete (source_episodes + source_events);
  - persist / load roundtrip preserves Omega;
  - artifact files written to disk;
  - no auto-coagulation on other centers.

### Changed

- `CHANGELOG.md` status block bumped to v0.4.2; verdict updated to
  reflect that integrated coagulation is now demonstrated, not just
  observed.

### Invariants preserved (mission §6)

- Omega is produced by the threshold rule, never set manually.
- D_Cortex / runtime stays the truth authority — disputed writes
  remain disputed in `slot_event_log` even when the same center has
  Ω=1.
- Advisory channel still read-only; observer still passive.
- All 222 v0.4.1 tests still PASS; +9 new R10b tests → 231 total.
