# BYON Optimus — runtime guide

Practical, minimal commands for getting BYON Optimus to a green state on a development machine. This guide *does not* automatically call the Claude API and *does not* automatically rerun the canonical benchmark. Both are explicit user actions.

## Prerequisites

- Node.js ≥ 18 (tested on v24.13)
- npm ≥ 10 (tested on 11.6.2)
- Python ≥ 3.10 (for `memory-service`)
- Docker (optional, for the full multi-service stack)

## Install

```bash
# Repository root
cd byon-orchestrator
npm ci
```

Python (memory-service) is installed on first run via the vendored FCE-M; no global install is required for the test surface to be green.

## Run the test suite

```bash
cd byon-orchestrator
npm test            # vitest run — 586 / 586 tests should pass
npm run build       # tsc -p tsconfig.json — should exit 0
npx tsc --noEmit    # type-check only — should exit 0
```

The full Vitest suite covers unit, integration, security, and campaign tests. Memory-service is **not** required to be running for these tests to pass.

## Start memory-service (only when needed)

```bash
cd byon-orchestrator/memory-service
python server.py
# default: http://127.0.0.1:8000
```

Environment variables that affect memory-service:

| Var | Default | Meaning |
| --- | --- | --- |
| `MEMORY_SERVICE_HOST` | `0.0.0.0` | bind address |
| `MEMORY_SERVICE_PORT` | `8000` | bind port |
| `MEMORY_SERVICE_RELOAD` | `false` | uvicorn auto-reload |
| `MEMORY_BACKEND` | `hybrid` | `hybrid` / `faiss` / `fcem` |
| `FCEM_ENABLED` | `true` | enable FCE-M advisory layer |
| `FCEM_ADVISORY_MODE` | `priority_only` | advisory mode |
| `FCEM_REFERENCE_FIELDS_ENABLED` | `true` | ReferenceField surface |
| `BYON_LEVEL3_FULL_ORGANISM_EXPERIMENT` | `false` | gates the commit-17 `/level3/*` endpoints; default OFF |

The Level 3 experimental endpoints are inert unless `BYON_LEVEL3_FULL_ORGANISM_EXPERIMENT=true` is set. They never modify `theta_s`, `tau_coag`, or any FCE-M parameter.

## Run the canonical benchmark (only when explicitly requested)

The canonical run is already on disk at:
`byon-orchestrator/test-results/full-organism-capability-benchmark/2026-05-13T09-57-20-343Z-b39uv/`

The runner is `byon-orchestrator/scripts/byon-full-organism-capability-benchmark.mjs`. A fresh run will call the Claude API and persist 100 items × 2 conditions × 1 judge ≈ 200+ requests. **Do not run this automatically.** It is a deliberate human-initiated action.

```bash
# Make sure ANTHROPIC_API_KEY is set in .env (loaded by scripts/lib/_env-bootstrap.mjs)
# Start memory-service first (see above)

cd byon-orchestrator
node scripts/byon-full-organism-capability-benchmark.mjs

# Smoke mode (3 items, < 1 minute):
FOBENCH_ITEM_LIMIT=3 node scripts/byon-full-organism-capability-benchmark.mjs
```

Output lands in `byon-orchestrator/test-results/full-organism-capability-benchmark/<run_id>/`. The canonical run is **not** to be overwritten. New runs are timestamp-suffixed automatically.

## Environment variables for the orchestrator + benchmark

| Var | Required | Meaning |
| --- | :---: | --- |
| `ANTHROPIC_API_KEY` | yes (for live runs) | LLM key. Loaded from `.env` by `scripts/lib/_env-bootstrap.mjs`. |
| `LLM_MODEL` | no | defaults to `claude-sonnet-4-6` |
| `LLM_PROVIDER` | no | defaults to `anthropic` |
| `BYON_BRIDGE_SECRET` | yes (for full stack) | bridge auth |
| `OPENCLAW_GATEWAY_TOKEN` | yes (for full stack) | gateway auth |
| `REDIS_PASSWORD` | yes (Docker) | Redis auth |
| `GRAFANA_PASSWORD` | yes (Docker) | Grafana auth |
| `FOBENCH_ITEM_LIMIT` | no | smoke-mode item limit for capability benchmark |

## Docker (optional, full stack)

```bash
docker compose up -d
docker compose logs -f byon-memory
docker compose down
```

Executor runs `network_mode: none` (air-gapped). All other services share `byon-network`.

## What the runtime will NOT do automatically

- ❌ rerun the canonical benchmark
- ❌ call the Claude API outside an explicitly invoked command
- ❌ start memory-service from `npm test`
- ❌ alter `theta_s` or `tau_coag`
- ❌ create an Omega anchor
- ❌ create a `ReferenceField` without an underlying `OmegaRecord`
- ❌ declare Level 3
- ❌ delete branches or tags
- ❌ create releases

## Where to look when something breaks

| Symptom | First place to look |
| --- | --- |
| Vitest "Invalid or unexpected token" on a `.mjs` test import | `byon-orchestrator/vitest.config.ts` — the `stripShebangPlugin` must be present (PR #4) |
| `ANTHROPIC_API_KEY` reported missing inside a benchmark | `byon-orchestrator/scripts/lib/_env-bootstrap.mjs` — verify `.env` exists and is readable |
| memory-service refuses `/level3/*` endpoints | confirm `BYON_LEVEL3_FULL_ORGANISM_EXPERIMENT=true` and `thread_id` starts with `level3_full_organism_` |
| 489 / 489 tests passing but 3 test files not loading | confirm the shebang plugin in `vitest.config.ts`; see `docs/validation/POST_MERGE_TEST_HARNESS_STABILIZATION.md` |
| Benchmark reports B-cost = $0 | env not loaded; check the `_env-bootstrap` side-effect import is the FIRST import in the runner |
