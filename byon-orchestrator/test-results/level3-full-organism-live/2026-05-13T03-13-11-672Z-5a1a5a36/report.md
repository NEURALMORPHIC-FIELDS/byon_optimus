# Level 3 Full Organism Live Runner — Report

> ADVISORY ONLY. Research artifact from the full-organism live experiment. Does NOT declare Level 3, does NOT create OmegaRecord manually, does NOT write to OmegaRegistry, does NOT create ReferenceField, does NOT modify FCE-M vendor. `theta_s=0.28`, `tau_coag=12` unchanged.

- Schema: `level3-full-organism-runner.v1`
- Branch: `research/level3-full-organism-runtime`
- Run id: `2026-05-13T03-13-11-672Z-5a1a5a36`
- Generated at: 2026-05-13T03:22:17.758Z
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
- Total input tokens: 24657
- Total output tokens: 19035
- Total estimated cost USD: `0.359496`
- Mean latency ms (Claude): `7487.3`
- Max observed S_t: `0.15136927622838203`
- Mean observed S_t: `0.09488768425459228`
- Max observed AR: `0.9999999999990008`
- Mean observed AR: `0.9649094609559434`
- Longest run above threshold: `0`
- Production embeddings live: **true** (class=`ProductionEmbedder` name=`all-MiniLM-L6-v2` dim=`384`)
- FCE metrics exposed: **true**
- OmegaRegistry before/after: `0 -> 0` (delta=0)
- ReferenceField before/after: `0 -> 0` (delta=0)
- relation events emitted: 200
- relation types seen: `constrains, stabilizes, routes_to, protects, contradicts`

## Per-scenario

### scenario-1-byon-arch — BYON architecture deep-dive

- turns: 30
- thread_id: `level3_full_organism_2026-05-13T03-13-11-672Z-5a1a5a36__scenario-1-byon-arch`
- omega: 0 -> 0 (delta=0)
- reference_field: 0 -> 0 (delta=0)

### scenario-2-adversarial — adversarial trust-boundary stress

- turns: 30
- thread_id: `level3_full_organism_2026-05-13T03-13-11-672Z-5a1a5a36__scenario-2-adversarial`
- omega: 0 -> 0 (delta=0)
- reference_field: 0 -> 0 (delta=0)

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

