# BYON Optimus — Internal Communication Baseline Report

**Date:** 2026-05-11
**Pre-integration baseline** (before FCE-M vendoring).

## Environment

- **Node** v24.13.0
- **npm** 11.6.2
- **pnpm** 11.0.9 (installed during setup)
- **Python** 3.13.13
- **pip** 26.0.1
- **Docker** NOT installed → all baseline tests run locally, not in containers
- **Visual Studio Build Tools** NOT installed → `better-sqlite3` cannot be compiled; installed with `--ignore-scripts` (native module unused by current tests)

## byon-orchestrator (TypeScript)

### Build

`npm run build` → success, zero errors.

### Test suite (Vitest)

```
numTotalTestSuites:  184
numFailedTestSuites: 0
numTotalTests:       435
numPassedTests:      435
numFailedTests:      0
numPendingTests:     0
Success: true
```

All 435 tests pass on first install. Suite includes:
- `tests/unit/`: protocol, policy, memory, crypto
- `tests/integration/`: handoff-system, worker-auditor, executor-flow, full-flow, memory-system
- `tests/security/`: hash chain, signature, path traversal, policy enforcement
- `tests/campaign/`: 100-test usage campaign (10 domains × 10 scenarios)

### Internal communication coverage (already exercised in tests)

| Channel | Test | Coverage |
|---|---|---|
| `handoff/inbox/` → Worker | `inbox-watcher` tests | poll, parse, archive |
| Worker → `handoff/worker_to_auditor/` | `worker-auditor.test.ts` | EvidencePack + PlanDraft with SHA256 hash |
| Auditor → `handoff/auditor_to_user/` | `worker-auditor.test.ts` | ApprovalRequest |
| Auditor → `handoff/auditor_to_executor/` | `executor-flow.test.ts` | ExecutionOrder + Ed25519 signature |
| Executor → `handoff/executor_to_worker/` | `executor-flow.test.ts` | JohnsonReceipt |
| Worker ↔ memory-service | `memory-system.test.ts` | store/search/stats roundtrip |

## memory-service (Python FastAPI)

### Smoke test (live)

```
GET  /health     → {"status":"healthy","backend":"FAISS-IndexFlatIP","uptime_seconds":13.0}
POST / action=ping  → {"success":true,"version":"4.0.0-faiss"}
POST / action=stats → {"success":true,"num_contexts":0,"fcpe_dim":384,"fhrss_profile":"FAISS-IndexFlatIP"}
POST / action=store (code) → {"success":true,"ctx_id":0}
POST / action=search (query="hello function") → similarity=0.634, FAISS IndexFlatIP working
```

### Components verified at runtime

- FastAPI server starts and binds to 0.0.0.0:8000
- Prometheus metrics registered (custom registry)
- `sentence-transformers/all-MiniLM-L6-v2` downloaded from HuggingFace (~80 MB)
- 384-dim L2-normalized embeddings via SentenceTransformer
- Per-type `FAISS IndexFlatIP` created for code/conversation/fact
- Real cosine similarity search confirmed end-to-end

## Known fragility points (from architectural audit)

| Risk | Location | Action |
|---|---|---|
| File race condition during consume() | `handoff/manager.ts` | Tests pass; will re-run after FCE integration |
| No JSON schema validation at deserialization | `handoff/serializer.ts` | Hash check catches tampering; schema gap is medium-priority |
| Memory client silent fallback | `agents/worker/memory-handler.ts` | Log present; health check surfaces failure |
| Hardcoded 60-min order age | `agents/executor/signature-verifier.ts` | Acceptable for current pipeline |

## Decision

**Communication baseline is healthy.** Proceed with FCE-M integration (Faza 2).
