# Level 3 Full Organism Live Runner — Report

> ADVISORY ONLY. Research artifact from the full-organism live experiment. Does NOT declare Level 3, does NOT create OmegaRecord manually, does NOT write to OmegaRegistry, does NOT create ReferenceField, does NOT modify FCE-M vendor. `theta_s=0.28`, `tau_coag=12` unchanged.

- Schema: `level3-full-organism-runner.v1`
- Branch: `research/level3-full-organism-runtime`
- Run id: `2026-05-13T00-19-32-945Z-784d9d67`
- Generated at: 2026-05-13T00:28:51.772Z
- Dry run: **false**
- Claude model: `claude-sonnet-4-6`
- Memory service: `http://localhost:8000`

## Pre-flight

- Level 3 flag enabled: **true**
- ANTHROPIC_API_KEY present: **true**
- memory-service live: **true**
- FAISS live: **true**
- production embeddings live: **true** (embedder: `?`)
- FCE-M live: **true**
- Ready: **true**

## Run summary

- Scenarios run: 2
- Total turns: 60
- Total live Claude calls: 60
- Total input tokens: 25652
- Total output tokens: 19393
- Total estimated cost USD: `0.367851`
- Mean latency ms (Claude): `7700.8`
- Max observed S_t: `0.15136927622838203`
- Mean observed S_t: `0.09782118639166971`
- Max observed AR: `0.9999999999990008`
- Mean observed AR: `0.9571649492683115`
- Longest run above threshold: `0`
- Production embeddings live: **true** (class=`ProductionEmbedder` name=`all-MiniLM-L6-v2` dim=`384`)
- FCE metrics exposed: **false**
- OmegaRegistry before/after: `0 -> 0` (delta=0)
- ReferenceField before/after: `0 -> 0` (delta=0)
- relation events emitted: 200
- relation types seen: `constrains, stabilizes, routes_to, protects, contradicts`

## Per-scenario

### scenario-1-byon-arch — BYON architecture deep-dive

- turns: 30
- thread_id: `level3_full_organism_2026-05-13T00-19-32-945Z-784d9d67__scenario-1-byon-arch`
- omega: 0 -> 0 (delta=0)
- reference_field: 0 -> 0 (delta=0)

### scenario-2-adversarial — adversarial trust-boundary stress

- turns: 30
- thread_id: `level3_full_organism_2026-05-13T00-19-32-945Z-784d9d67__scenario-2-adversarial`
- omega: 0 -> 0 (delta=0)
- reference_field: 0 -> 0 (delta=0)

## Final verdict

**`INCONCLUSIVE_FCE_METRICS_NOT_EXPOSED`**

## Confirmations

- Level 3 is **NOT declared** by this runner.
- `theta_s = 0.28` unchanged.
- `tau_coag = 12` unchanged.
- No manual OmegaRegistry write.
- No manual OmegaRecord creation.
- No manual ReferenceField creation.
- All experiment writes carry `is_level3_experiment=true` and `run_id`.

