# Level 3 Full Organism Live Runner — Report

> ADVISORY ONLY. Research artifact from the full-organism live experiment. Does NOT declare Level 3, does NOT create OmegaRecord manually, does NOT write to OmegaRegistry, does NOT create ReferenceField, does NOT modify FCE-M vendor. `theta_s=0.28`, `tau_coag=12` unchanged.

- Schema: `level3-full-organism-runner.v1`
- Branch: `research/level3-full-organism-runtime`
- Run id: `2026-05-12T23-21-52-796Z-07105aa1`
- Generated at: 2026-05-12T23:21:52.949Z
- Dry run: **true**
- Claude model: `—`
- Memory service: `http://localhost:8000`

## Pre-flight

- Level 3 flag enabled: **true**
- ANTHROPIC_API_KEY present: **false**
- memory-service live: **true**
- FAISS live: **true**
- production embeddings live: **false** (embedder: `?`)
- FCE-M live: **true**
- Ready: **true**

## Run summary

- Scenarios run: 0
- Total turns: 0
- Total live Claude calls: 0
- Total input tokens: 0
- Total output tokens: 0
- Total estimated cost USD: `0.000000`
- Mean latency ms (Claude): `—`
- Max observed S_t: `—`
- Mean observed S_t: `—`
- Longest run above threshold: `0`
- OmegaRegistry before/after: `0 -> 0` (delta=0)
- ReferenceField before/after: `0 -> 0` (delta=0)
- relation events emitted: 0
- relation types seen: `—`

## Per-scenario

## Final verdict

**`FULL_ORGANISM_LEVEL2_CONFIRMED`**

## Confirmations

- Level 3 is **NOT declared** by this runner.
- `theta_s = 0.28` unchanged.
- `tau_coag = 12` unchanged.
- No manual OmegaRegistry write.
- No manual OmegaRecord creation.
- No manual ReferenceField creation.
- All experiment writes carry `is_level3_experiment=true` and `run_id`.

