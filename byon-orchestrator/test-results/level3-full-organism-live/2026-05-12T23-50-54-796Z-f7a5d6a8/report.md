# Level 3 Full Organism Live Runner — Report

> ADVISORY ONLY. Research artifact from the full-organism live experiment. Does NOT declare Level 3, does NOT create OmegaRecord manually, does NOT write to OmegaRegistry, does NOT create ReferenceField, does NOT modify FCE-M vendor. `theta_s=0.28`, `tau_coag=12` unchanged.

- Schema: `level3-full-organism-runner.v1`
- Branch: `research/level3-full-organism-runtime`
- Run id: `2026-05-12T23-50-54-796Z-f7a5d6a8`
- Generated at: 2026-05-12T23:52:32.719Z
- Dry run: **false**
- Claude model: `claude-sonnet-4-6`
- Memory service: `http://localhost:8000`

## Pre-flight

- Level 3 flag enabled: **true**
- ANTHROPIC_API_KEY present: **true**
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
- relation events emitted: 56
- relation types seen: `constrains, stabilizes, protects, contradicts, routes_to`

## Per-scenario

### scenario-2-adversarial — 

- turns: 0
- thread_id: `undefined`
- omega: undefined -> undefined (delta=undefined)
- reference_field: undefined -> undefined (delta=undefined)
- ERROR: memory-service HTTP 429: {"success":false,"error":"Rate limit exceeded. Please try again later.","retry_after":60}

## Final verdict

**`INCONCLUSIVE_NEEDS_LONGER_RUN`**

## Confirmations

- Level 3 is **NOT declared** by this runner.
- `theta_s = 0.28` unchanged.
- `tau_coag = 12` unchanged.
- No manual OmegaRegistry write.
- No manual OmegaRecord creation.
- No manual ReferenceField creation.
- All experiment writes carry `is_level3_experiment=true` and `run_id`.

