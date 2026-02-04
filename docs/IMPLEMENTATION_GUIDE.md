# BYON Worker AI Integration - Implementation Guide

**Obiectiv:** Adaugă procesare AI reală în Worker pentru generare cod, analiză date, și trading queries.

---

## 🚀 Quick Start (30-45 min)

### Prerequisites

- Node.js 22+ (✅ ai deja)
- Docker running (✅ ai deja)
- Anthropic API Key (obține de la https://console.anthropic.com)

---

## STEP 1: Adaugă Dependențe (5 min)

```bash
cd "c:\Users\Lucian\Desktop\byon_optimus\byon-orchestrator"

# Adaugă Anthropic SDK
npm install @anthropic-ai/sdk --save

# Adaugă axios pentru trading API
npm install axios --save

# Verifică package.json
cat package.json | grep -E "@anthropic|axios"
```

**Expected output:**
```
"@anthropic-ai/sdk": "^0.20.0",
"axios": "^1.6.0"
```

---

## STEP 2: Configurare API Key (2 min)

```bash
# Adaugă în .env sau docker-compose.yml
echo 'ANTHROPIC_API_KEY=sk-ant-api03-...' >> .env
```

**SAU** modifică `docker-compose.yml`:

```yaml
services:
  byon-worker:
    environment:
      # Existing...
      - ANTHROPIC_API_KEY=sk-ant-api03-...  # <-- ADD THIS
```

---

## STEP 3: Modifică plan-generator.ts (15 min)

**Locație:** `byon-orchestrator/src/agents/worker/plan-generator.ts`

### 3.1 Adaugă imports (sus în fișier)

```typescript
import Anthropic from '@anthropic-ai/sdk';

// Configurare Claude client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || ''
});
```

### 3.2 Adaugă funcții noi (după imports)

**Copiază din `worker-ai-integration.ts` (generat mai sus):**

```typescript
// Paste here:
// - generateAIPlan()
// - requiresAI()
// - extractUserRequest()
// - generateFallbackPlan()
```

### 3.3 Modifică export principal

**Găsește funcția existentă:**
```typescript
export function generatePlan(evidence: EvidencePack): PlanDraft {
  // Existing code...
}
```

**Replace cu:**
```typescript
export async function generatePlan(evidence: EvidencePack): Promise<PlanDraft> {
  if (requiresAI(evidence) && process.env.ANTHROPIC_API_KEY) {
    console.log('[Worker] Using AI plan generation');
    return await generateAIPlan(evidence, evidence.task_type);
  } else {
    console.log('[Worker] Using generic plan generation');
    return generateGenericPlan(evidence); // Funcția existentă
  }
}
```

### 3.4 Rename old function

```typescript
// Old:
export function generatePlan(evidence: EvidencePack): PlanDraft { ... }

// Rename to:
function generateGenericPlan(evidence: EvidencePack): PlanDraft { ... }
```

---

## STEP 4: Adaugă Trading API Support (10 min)

### 4.1 Creează fișier nou

```bash
cd byon-orchestrator/src/agents/executor
touch trading-client.ts
```

### 4.2 Copiază conținut

**Paste în `trading-client.ts`:**
```typescript
// Copiază tot din trading-api-integration.ts
```

### 4.3 Modifică executor/index.ts

**Adaugă import:**
```typescript
import { CoinGeckoClient } from './trading-client';
```

**În funcția `executeAction()`, adaugă cases:**
```typescript
async function executeAction(action: any): Promise<ActionResult> {
  switch (action.type) {
    case 'file_write':
      // Existing...
      break;

    case 'api_call':  // <-- NEW
      return await executeAPICall(action);

    case 'trading_query':  // <-- NEW
      return await executeTradingQuery(action);

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}
```

**Adaugă funcțiile noi (la final de fișier):**
```typescript
// Paste here:
// - executeAPICall()
// - executeTradingQuery()
```

---

## STEP 5: Update Types (5 min)

**În `byon-orchestrator/byon-config.ts` sau `types.ts`:**

```typescript
// Add new action types
export type ActionType = 
  | 'file_write'
  | 'file_read'
  | 'run_command'
  | 'api_call'        // <-- NEW
  | 'trading_query'   // <-- NEW
  | 'code_exec';      // <-- NEW (optional)
```

---

## STEP 6: Rebuild & Restart (5 min)

```bash
cd "c:\Users\Lucian\Desktop\byon_optimus"

# Rebuild Worker
docker-compose build byon-worker

# Rebuild Executor
docker-compose build byon-executor

# Restart both
docker-compose up -d byon-worker byon-executor

# Check logs
docker logs byon-worker --tail 20
```

**Expected output:**
```
[Worker] Loaded Anthropic SDK
[Worker] Worker agent started
```

---

## 🧪 TEST 1: AI Code Generation

### Create test message

```bash
cat > "c:\Users\Lucian\Desktop\byon_optimus\handoff\inbox\test_ai_code.json" << 'EOF'
{
  "id": "test-ai-quicksort",
  "channel": "manual",
  "from": "capability_test",
  "content": "Scrie o funcție Python pentru quicksort cu type hints și docstring. Include și câteva teste.",
  "timestamp": "2026-02-04T03:00:00Z"
}
EOF
```

### Wait & check

```bash
sleep 10

# Check Worker processed
curl -s http://localhost:3000/api/worker/status | grep processed_count

# Check plan generated
ls -lt "c:\Users\Lucian\Desktop\byon_optimus\handoff\worker_to_auditor" | head -3

# Read latest plan
cat "c:\Users\Lucian\Desktop\byon_optimus\handoff\worker_to_auditor\plan_*.json" | tail -1
```

**Expected:** Plan cu cod Python real generat de Claude

---

## 🧪 TEST 2: Trading API Query

### Create test message

```bash
cat > "c:\Users\Lucian\Desktop\byon_optimus\handoff\inbox\test_trading.json" << 'EOF'
{
  "id": "test-trading-bitcoin",
  "channel": "manual",
  "from": "capability_test",
  "content": "Fetch current Bitcoin price and market cap from CoinGecko API. Save results to /project/bitcoin_data.json",
  "timestamp": "2026-02-04T03:05:00Z"
}
EOF
```

### Wait & approve

```bash
sleep 10

# Get approval request
LATEST_APPROVAL=$(ls -t "c:\Users\Lucian\Desktop\byon_optimus\handoff\auditor_to_user"/*.json | head -1)
REQUEST_ID=$(grep -oP '"request_id":\s*"\K[^"]+' "$LATEST_APPROVAL")

# Approve
curl -s -X POST "http://localhost:3000/api/approve/$REQUEST_ID" \
  -H "Content-Type: application/json" \
  -d '{"decision": "approve", "decided_by": "test", "reason": "Trading test"}'

# Wait for execution
sleep 5

# Check result
cat "c:\Users\Lucian\Desktop\byon_optimus\handoff\..\project\bitcoin_data.json"
```

**Expected:** JSON cu date Bitcoin reale

---

## 🧪 TEST 3: Data Processing

### Create test message

```bash
cat > "c:\Users\Lucian\Desktop\byon_optimus\handoff\inbox\test_data_analysis.json" << 'EOF'
{
  "id": "test-data-sort",
  "channel": "manual",
  "from": "capability_test",
  "content": "Generează un fișier JSON cu numere prime de la 1 la 100, suma lor, și media aritmetică. Salvează în /project/primes_analysis.json",
  "timestamp": "2026-02-04T03:10:00Z"
}
EOF
```

**Expected:** Claude generează cod Python care calculează primele, apoi Executor rulează codul.

---

## 🎯 Capabilities After Integration

| Feature | Before | After |
|---------|--------|-------|
| Code generation | ❌ Generic | ✅ AI-powered (Python, JS) |
| Data analysis | ❌ No | ✅ Yes (sorting, stats) |
| API integration | ❌ No | ✅ Yes (REST calls) |
| Trading queries | ❌ No | ✅ Yes (CoinGecko) |
| Security | ✅ Ed25519 | ✅ Maintained |
| Approval flow | ✅ Working | ✅ Maintained |

---

## 🔧 Troubleshooting

### Issue: "ANTHROPIC_API_KEY not found"

**Fix:**
```bash
# Check env var
docker exec byon-worker env | grep ANTHROPIC

# If missing, restart with env:
docker-compose down byon-worker
docker-compose up -d byon-worker
```

### Issue: "Module '@anthropic-ai/sdk' not found"

**Fix:**
```bash
cd byon-orchestrator
npm install @anthropic-ai/sdk
docker-compose build byon-worker
docker-compose up -d byon-worker
```

### Issue: Worker log shows "Using generic plan generation"

**Cause:** `requiresAI()` nu detectează keywords sau API key lipsește

**Fix:**
```bash
# Check keywords in message
cat "c:\Users\Lucian\Desktop\byon_optimus\handoff\inbox\test_*.json"

# Should contain: "scrie", "cod", "functie", etc.
```

---

## 📊 Performance Impact

- **Latență adăugată:** +500-2000ms (Claude API call)
- **Cost:** ~$0.003 per request (Sonnet 4.5)
- **Memory:** +50MB (Anthropic SDK)

---

## ✅ Validation Checklist

- [ ] `npm install` successful
- [ ] API key in environment
- [ ] Worker rebuild successful
- [ ] Executor rebuild successful
- [ ] TEST 1 generates real Python code
- [ ] TEST 2 fetches Bitcoin data
- [ ] TEST 3 processes data correctly
- [ ] Approval flow still works
- [ ] Executor signature verification OK

---

## 🚀 Production Checklist

Before deploying to production:

- [ ] Rate limiting on Claude API (cost control)
- [ ] Error handling for API failures
- [ ] Timeout configuration (max 30s per AI call)
- [ ] Logging AI responses for audit
- [ ] Whitelist allowed APIs (security)
- [ ] Test with invalid API key (graceful degradation)

---

**Estimated total time:** 30-45 minutes

**Dificultate:** Medium (requires TypeScript knowledge)

**Alternativă rapidă:** Folosește OpenClaw UI direct pentru AI tasks (0 min setup)
