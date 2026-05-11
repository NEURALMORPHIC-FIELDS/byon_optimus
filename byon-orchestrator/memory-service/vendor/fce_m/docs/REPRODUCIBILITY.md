# Reproducibility

This document describes how to reproduce the v0.6.0 result of 268
passing tests + R10b integrated coagulation on a fresh checkout.

## Environment

- Python 3.13 (tested), 3.11+ should work
- numpy (≥1.26)
- pytest (≥7)
- pytest-cov (optional)
- scipy (used by the vendored FCE-Ω regimes module)

A `requirements.txt` is provided. `pyproject.toml` declares the
`dev` extra group which installs pytest and cov plugins.

## ⚠️ External source dependency (legacy UFME passthroughs)

The 140 legacy UFME tests (and the `unified_fragmergent_memory.sources.*`
passthrough wrappers for `d_cortex`, `tf_engine`,
`memory_engine_runtime`) currently reference three external source
projects via absolute paths in
`unified_fragmergent_memory/sources/*/__init__.py`:

```
unified_fragmergent_memory/sources/d_cortex/__init__.py
    SOURCE_ROOT = "c:/Users/Lucian/Desktop/D_CORTEX_ULTIMATE"

unified_fragmergent_memory/sources/memory_engine_runtime/__init__.py
    _SOURCE_ROOT = "c:/Users/Lucian/Desktop/fragmergent-memory-engine"

unified_fragmergent_memory/sources/tf_engine/__init__.py
    _ORIGINAL_SOURCE_FOLDER = "c:/Users/Lucian/Desktop/fragmergent-tf-engine"
```

These paths are PROVENANCE markers — they document where the source
projects lived on the original development machine — and they are
used at import time by the passthrough wrappers. On the author's
machine the paths resolve and all 268 tests pass.

For external reproduction:

- **The FCE-M-specific tests** (`tests/fce_omega/` and
  `tests/fce_omega_functional/`, 128 tests total) depend only on the
  vendored `vendor/fce_omega_source/`. They DO NOT require the three
  external Desktop folders. These 128 tests reproduce on any clean
  checkout and validate the v0.4.0 → v0.6.0 evolution line.
- **The 140 legacy UFME tests** (`tests/passthrough/`, `tests/facade/`,
  `tests/bridges/`, `tests/cross_substrate/`,
  `tests/natural_branch_flip/`, `tests/natural_coupling/`,
  `tests/organism_driven/`, `tests/auto_registration/`,
  `tests/async_coupling/`) currently require the three external
  Desktop folders to be present at the hardcoded paths above.
  Refactoring the wrappers to use a config-driven path or vendored
  copies of the three source projects is a planned cleanup
  (slated for v0.7.0).

A future commit will likely add support for environment variables
(`UFME_DCORTEX_PATH`, `UFME_MEMORY_ENGINE_PATH`, `UFME_TF_ENGINE_PATH`)
with sensible fallbacks, so the entire 268-test suite can run on a
fresh clone without external dependencies.

For now, to reproduce the **FCE-M validation subset** (128 tests) on
any clean machine:

```bash
python -m pytest tests/fce_omega/ tests/fce_omega_functional/ -q
```

To reproduce the **full 268-test suite**, the three external Desktop
folders must exist at the hardcoded paths above, or
`unified_fragmergent_memory/sources/*` need to be patched accordingly.

## Step 1 — clone

```bash
git clone https://github.com/NEURALMORPHIC-FIELDS/fragmergent-causal-exponentiation-memory.git
cd fragmergent-causal-exponentiation-memory
```

## Step 2 — install

Editable install with dev extras:

```bash
python -m pip install -e ".[dev]"
```

Alternatively, install from `requirements.txt` if your tooling is
pip-only:

```bash
python -m pip install -r requirements.txt
```

## Step 3 — run the test suite

```bash
python -m pytest -q
```

**Expected:** `268 passed in ~15s`.

The suite covers:

- 140 legacy UFME tests
- 20 FCE-Ω unit tests (`tests/fce_omega/`)
- 108 FCE-M functional tests (`tests/fce_omega_functional/`)

If any test fails, see `tests/fce_omega_functional/conftest.py` for
shared helpers and the per-stage transcripts under `results/` for
the expected output.

## Step 4 — run the R10b reproduction experiment

```bash
python experiments/r10b_integrated_phoenix.py
```

**Expected output:** a coagulation report ending with

```
Omega produced by RULE (check_coagulation): True
Was Omega set synthetically? False
Coagulated at episode=3 cycle=3
S_t_at_coagulation=0.10227263408038409
kappa_at_coagulation=0.45762860150420276
AR_at_coagulation=0.6768090295332438
sine_type=integrative
```

The full trajectory is written to:

```
results/etapa_02_v0_4_2_r10b_integrated/r10b_trajectory.json
results/etapa_02_v0_4_2_r10b_integrated/r10b_trajectory.txt
```

These should match the frozen committed copies bit-for-bit (the
experiment is fully deterministic with `seed=42`).

## Step 5 — regenerate the functional report

```bash
python tools/fce_functional_report.py \
    --out results/fce_functional_report.txt \
    --json results/fce_functional_report.json
```

**Expected:** all eight capability flags `True`:

```
observer active/passive invariance: True
residue detected:                   True
Omega irreversibility:              True
advisory no-truth-override:         True
multiperspectival normalization:    True
provenance complete:                True
persistence roundtrip:              True
vendor layout clean:                True
```

## Step 6 — (optional) reproduce.sh

The legacy reproduce script preserved from earlier UFME versions:

```bash
bash reproduce.sh --no-demo
```

This runs `pip install -e ".[dev]"` and then `pytest`. Use
`--no-tests` to skip pytest or `--no-demo` to skip the older
end-to-end demos.

## Determinism

All randomness in the project is seeded:

- `FCEOmegaObserver._get_or_create_agent` uses SHA-256 of the
  `center_key` plus `_rng_seed` for per-center deterministic Agent
  initialization. This is process-stable (not affected by
  `PYTHONHASHSEED`).
- The bridge's `_hash_to_unit_vector` uses SHA-256 directly.
- `agent.Agent` accepts an `rng=` parameter; the observer always
  passes a seeded `numpy.random.default_rng(...)`.

This means: same workload, same Python version, same numpy version
→ bit-identical results across runs.

## Per-stage reproduction

Each stage's results live under `results/etapa_<NN>_<version>_<short>/`.
To verify a specific stage's transcript:

```bash
diff results/etapa_05_v0_6_0_native_memory_reference_field/pytest_summary.txt \
    <(python -m pytest -q --tb=no 2>&1 | tail -3)
```

The summary lines should match (modulo absolute time taken).

## Adding new tests

Follow the staging discipline in
[`docs/EVOLUTION_PROTOCOL.md`](EVOLUTION_PROTOCOL.md):

1. baseline lock — run pytest, confirm previous total stays
2. implement the focused change
3. add failure-mode + non-regression tests
4. run pytest; expect previous total + new tests
5. run `python tools/stage_finalize.py --etapa <N> --version <v> --short-name <slug> ...`
6. report to user; STOP for confirmation before next stage

## Reporting issues

If you cannot reproduce 268 passing on a fresh checkout, please open
a GitHub issue with:

- Python version (`python --version`)
- numpy version (`python -c "import numpy; print(numpy.__version__)"`)
- pytest version (`python -m pytest --version`)
- OS / platform
- Full pytest output (`python -m pytest -v --tb=long`)
- Output of `python tools/fce_functional_report.py`
