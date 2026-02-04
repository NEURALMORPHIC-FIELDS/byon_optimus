# Failure Recovery Guide
**BYON Optimus v1.0** | Patent: EP25216372.0

---

## Quick Reference: Severity Levels

| Level | Description | Response Time | Example |
|-------|-------------|---------------|---------|
| **P1** | System down, pipeline halted, data at risk | Immediate (< 5 min) | Memory service crash, key compromise, all agents down |
| **P2** | Major degradation, pipeline partially functional | < 30 min | Single agent crash, Redis down, signature failures |
| **P3** | Minor degradation, workaround available | < 2 hours | Gateway channel disconnect, watcher stale, Grafana down |
| **P4** | Cosmetic or non-blocking | Next business day | Sentinel offline (optional), metrics gap, stale heartbeat |

---

## Table of Contents

1. [Agent Failures](#1-agent-failures)
2. [Memory Service Failures](#2-memory-service-failures)
3. [Handoff Directory Corruption](#3-handoff-directory-corruption)
4. [Signature Verification Failures](#4-signature-verification-failures)
5. [Redis Failures](#5-redis-failures)
6. [Gateway (OpenClaw) Failures](#6-gateway-openclaw-failures)
7. [WFP Sentinel Failures](#7-wfp-sentinel-failures)
8. [Docker/Container Failures](#8-dockercontainer-failures)
9. [Complete System Recovery](#9-complete-system-recovery)
10. [Monitoring and Detection](#10-monitoring-and-detection)

---

## 1. Agent Failures

### Severity: P1 (all agents) / P2 (single agent)

The pipeline requires all three agents to process work end-to-end:
- **Worker** (byon-worker, port 3002): reads inbox, builds EvidencePack + PlanDraft
- **Auditor** (byon-auditor, port 3003): validates plans, signs ExecutionOrders (Ed25519)
- **Executor** (byon-executor, no network): executes signed orders, produces JohnsonReceipts

All containers use `restart: unless-stopped`, so Docker will auto-restart crashed agents.

### Symptoms

| Agent | Symptoms |
|-------|----------|
| Worker | Messages accumulate in `handoff/inbox/`, no new files in `handoff/worker_to_auditor/` |
| Auditor | PlanDrafts accumulate in `handoff/worker_to_auditor/`, no ExecutionOrders produced |
| Executor | Signed orders accumulate in `handoff/auditor_to_executor/`, no JohnsonReceipts |

### Diagnosis

```bash
# Check container status
docker compose ps

# Check specific agent health
docker inspect --format='{{.State.Health.Status}}' byon-worker
docker inspect --format='{{.State.Health.Status}}' byon-auditor
docker inspect --format='{{.State.Health.Status}}' byon-executor

# View agent logs (last 100 lines)
docker compose logs --tail=100 byon-worker
docker compose logs --tail=100 byon-auditor
docker compose logs --tail=100 byon-executor

# Check health endpoints (Worker and Auditor only; Executor has no network)
curl -s http://localhost:3002/health | jq .
curl -s http://localhost:3003/health | jq .
```

### Recovery Steps

**Single agent crash (auto-recovered by Docker):**
```bash
# Verify the agent restarted
docker compose ps byon-worker

# If stuck in restart loop, check logs for the root cause
docker compose logs --tail=200 byon-worker

# Force restart
docker compose restart byon-worker
```

**Agent stuck (running but not processing):**
```bash
# Stop and recreate the container
docker compose up -d --force-recreate byon-worker
```

**Executor-specific recovery:**

The Executor runs with `network_mode: none` and uses a file-based healthcheck (`/tmp/healthy`). If the healthcheck fails:
```bash
# Check the healthcheck file
docker exec byon-executor test -f /tmp/healthy && echo "OK" || echo "MISSING"

# Force recreate (executor has no persistent state beyond handoff files)
docker compose up -d --force-recreate byon-executor
```

**All agents down:**
```bash
# Restart the entire agent stack (memory-service must be healthy first)
docker compose restart memory-service
docker compose up -d byon-worker byon-auditor byon-executor
```

### Post-Recovery Verification

After any agent recovery, verify that the pipeline is flowing:
```bash
# Watch for new files appearing in handoff directories
ls -lt handoff/inbox/
ls -lt handoff/worker_to_auditor/
ls -lt handoff/auditor_to_executor/
ls -lt handoff/executor_to_worker/
```

### Important Notes

- The Worker depends on `memory-service` (healthy) and `redis` (started). If memory-service is down, Worker will not start.
- The Auditor depends on `memory-service` (healthy) and `byon-worker` (started).
- The Executor has **no** dependencies in Docker (it is air-gapped), but it needs valid Ed25519 public keys in `/keys` to verify orders.
- All agents run as non-root user `1001:1001`. Permission issues on handoff directories will cause failures.
- Resource limits apply: Worker/Auditor/Executor each have 2 CPU, 2GB RAM limits. OOM kills will show in `docker compose logs`.

---

## 2. Memory Service Failures

### Severity: P1

The FHRSS+FCPE memory service is **required**. All agents depend on it (via `condition: service_healthy`). If memory-service is unhealthy, agents will not start.

- **Container**: `byon-memory`
- **Port**: 8001 (host) mapped to 8000 (container)
- **Healthcheck**: `http://localhost:8000/health` (10s interval, 5 retries, 30s start period)
- **Resource limits**: 2 CPU, 4GB RAM

### Symptoms

- Agents fail to start with dependency errors
- `docker compose ps` shows memory-service as `unhealthy`
- `/api/memory/stats` returns errors via the gateway
- Semantic search returns no results

### Diagnosis

```bash
# Check memory service status
docker inspect --format='{{.State.Health.Status}}' byon-memory

# Check logs
docker compose logs --tail=200 memory-service

# Test health endpoint directly
curl -s http://localhost:8001/health | jq .

# Check memory storage volume
ls -la memory/

# Check Redis connectivity (memory-service uses Redis for caching)
docker exec byon-redis redis-cli -a "$REDIS_PASSWORD" ping
```

### Recovery Steps

**Service crash (auto-restart):**
```bash
docker compose restart memory-service

# Wait for healthcheck to pass (up to 30s start period + 5 retries * 10s)
docker compose ps memory-service

# Once healthy, restart dependent agents
docker compose restart byon-worker byon-auditor
```

**Data corruption / storage issues:**

FHRSS provides **100% recovery at up to 50% data loss** via XOR-based parity and fractal redundancy. However, if the storage directory is completely destroyed:

```bash
# Stop all services
docker compose down

# Back up existing storage (if salvageable)
cp -r memory/ memory_backup_$(date +%Y%m%d)/

# Clear corrupted storage
rm -rf memory/*

# Restart (memory-service will reinitialize)
docker compose up -d memory-service

# Wait for healthy state
docker compose ps memory-service

# Restart agents
docker compose up -d
```

**Python environment issues:**
```bash
# Rebuild the memory-service image
docker compose build --no-cache memory-service

# Restart
docker compose up -d memory-service
```

### FHRSS Recovery Capabilities

| Data Loss Level | Recovery | Notes |
|-----------------|----------|-------|
| 0-50% | 100% automatic | FHRSS parity reconstruction |
| 50-70% | Partial, degraded | Some semantic context lost |
| 70-100% | Requires backup | Reinitialize from backup or start fresh |

### Post-Recovery Verification

```bash
# Verify health
curl -s http://localhost:8001/health | jq .

# Verify semantic search works
curl -s "http://localhost:8001/search?query=test" | jq .

# Verify agents can reach memory service
docker compose logs --tail=20 byon-worker | grep -i memory
```

---

## 3. Handoff Directory Corruption

### Severity: P2

The pipeline communicates exclusively through JSON files in the `handoff/` directory tree. Each subdirectory serves a specific purpose.

### Directory Map

| Directory | Writer | Reader | Purpose |
|-----------|--------|--------|---------|
| `handoff/inbox/` | OpenClaw Gateway | Worker | Incoming messages from channels |
| `handoff/worker_to_auditor/` | Worker | Auditor | EvidencePacks + PlanDrafts |
| `handoff/worker_to_auditor/archive/` | Auditor | - | Processed plans (archived) |
| `handoff/auditor_to_user/` | Auditor | Gateway | Approval requests for users |
| `handoff/auditor_to_executor/` | Auditor | Executor | Signed ExecutionOrders |
| `handoff/executor_to_worker/` | Executor | Worker | JohnsonReceipts (results) |
| `handoff/auditor_state/` | Auditor | Auditor | Internal auditor state |
| `handoff/sentinel/` | Sentinel Bridge | Auditor/Gateway | WFP Sentinel status and events |
| `handoff/outbox/` | Worker | Gateway | Outgoing responses |
| `handoff/user_to_auditor/` | Gateway | Auditor | User approval responses |

### Symptoms

- Pipeline stalls at a specific stage
- JSON parse errors in agent logs
- `ENOENT` or `EACCES` errors in logs
- Watcher events stop for specific directories

### Diagnosis

```bash
# Check all handoff directories exist
for dir in inbox outbox worker_to_auditor auditor_to_user auditor_to_executor executor_to_worker auditor_state sentinel user_to_auditor; do
  echo -n "$dir: "
  test -d "handoff/$dir" && echo "EXISTS" || echo "MISSING"
done

# Check permissions (should be writable by uid 1001)
ls -la handoff/

# Check for corrupted JSON files
for f in $(find handoff/ -name "*.json" -type f); do
  python -c "import json; json.load(open('$f'))" 2>/dev/null || echo "CORRUPT: $f"
done

# Check disk space
df -h .
```

### Recovery Steps

**Missing directories:**
```bash
# Recreate the full handoff directory tree
mkdir -p handoff/{inbox,outbox,worker_to_auditor/archive,auditor_to_user,auditor_to_executor,executor_to_worker,auditor_state,sentinel/events,user_to_auditor}

# Fix ownership (Docker containers run as 1001:1001)
# On Linux:
chown -R 1001:1001 handoff/
# On Windows (Docker Desktop): permissions are handled by Docker volume mounts
```

**Corrupted JSON files:**
```bash
# Move corrupted files aside for investigation
mkdir -p handoff/_corrupted
for f in $(find handoff/ -name "*.json" -type f); do
  python -c "import json; json.load(open('$f'))" 2>/dev/null || mv "$f" handoff/_corrupted/
done

# Restart affected agents
docker compose restart byon-worker byon-auditor byon-executor
```

**Stale files blocking the pipeline:**

If old files are preventing new processing (e.g., already-processed files not archived):
```bash
# Archive old inbox messages (older than 1 hour)
find handoff/inbox/ -name "*.json" -mmin +60 -exec mv {} handoff/inbox/archive/ \;

# Archive old worker output
find handoff/worker_to_auditor/ -name "*.json" -mmin +60 -exec mv {} handoff/worker_to_auditor/archive/ \;
```

**Complete handoff reset (caution -- destroys in-flight work):**
```bash
# Stop agents
docker compose stop byon-worker byon-auditor byon-executor

# Back up current state
cp -r handoff/ handoff_backup_$(date +%Y%m%d)/

# Clear all handoff directories
find handoff/ -name "*.json" -type f -delete

# Recreate directory structure
mkdir -p handoff/{inbox,outbox,worker_to_auditor/archive,auditor_to_user,auditor_to_executor,executor_to_worker,auditor_state,sentinel/events,user_to_auditor}

# Restart agents
docker compose up -d byon-worker byon-auditor byon-executor
```

### Important Notes

- The Watcher service (`byon-watcher`) monitors handoff directories and publishes events to Redis. If directories are recreated, restart the watcher: `docker compose restart watcher`.
- The Executor mounts `auditor_to_executor` as **read-only** and `executor_to_worker` as **read-write**. Permission errors on these will silently stall the Executor.
- Volume mounts in Docker specify read/write access explicitly (`:ro` or `:rw`). Check `docker-compose.yml` if a container cannot write to its expected directory.

---

## 4. Signature Verification Failures

### Severity: P2

The Auditor signs ExecutionOrders with Ed25519. The Executor verifies signatures before executing any order. A key mismatch or corruption means **no orders can be executed**.

### How Signing Works

1. Auditor computes SHA256 hash of the order content (sorted JSON keys)
2. Auditor signs the hash with its Ed25519 private key
3. Signature is stored as `Ed25519Signature` object: `{ algorithm, public_key, signature }`
4. Executor recalculates the hash, then verifies the signature against its trusted public keys
5. Executor also checks: order age (max 60 minutes), constraint limits, and optionally required signer

### Symptoms

- Executor logs: `Invalid signature - not signed by trusted key`
- Executor logs: `Hash mismatch - order may have been tampered`
- Executor logs: `Order too old: N minutes`
- Executor logs: `No trusted keys configured`
- ExecutionOrders accumulate in `handoff/auditor_to_executor/` with no receipts produced

### Diagnosis

```bash
# Check Executor logs for verification errors
docker compose logs --tail=100 byon-executor | grep -i "signature\|hash\|key\|verify"

# Check Auditor logs for signing errors
docker compose logs --tail=100 byon-auditor | grep -i "sign\|key"

# Verify key files exist
ls -la keys/

# Check key file contents are valid base64
cat keys/auditor_public.key | base64 -d | wc -c   # Should be 44 bytes (SPKI DER) or 32 bytes (raw)
cat keys/auditor_private.key | base64 -d | wc -c   # Should be 48 bytes (PKCS8 DER) or 32 bytes (raw)
```

### Recovery Steps

**Key mismatch (Auditor and Executor have different keys):**
```bash
# Stop agents
docker compose stop byon-auditor byon-executor

# Regenerate key pair
pnpm keygen
# OR
bash scripts/setup-keys.sh

# Verify both agents mount the same keys/ directory
grep -A2 "keys" docker-compose.yml

# Clear any in-flight signed orders (they used the old key)
rm -f handoff/auditor_to_executor/*.json

# Restart agents
docker compose up -d byon-auditor byon-executor
```

**Emergency key generation (no `pnpm keygen` available):**
```bash
# Generate Ed25519 key pair using Node.js
node -e "
const crypto = require('crypto');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pubB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const privB64 = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
require('fs').writeFileSync('keys/auditor_public.key', pubB64);
require('fs').writeFileSync('keys/auditor_private.key', privB64);
console.log('Keys generated successfully');
console.log('Public key fingerprint:', crypto.createHash('sha256').update(pubB64).digest('hex').substring(0,16));
"
```

**Key rotation procedure:**

1. Generate new key pair (see above)
2. Stop Auditor and Executor
3. Replace key files in `keys/`
4. Clear `handoff/auditor_to_executor/` (old signatures are invalid)
5. Start Auditor, then Executor
6. Verify the first new order is processed successfully

```bash
# Full key rotation sequence
docker compose stop byon-auditor byon-executor
pnpm keygen
rm -f handoff/auditor_to_executor/*.json
docker compose up -d byon-auditor byon-executor

# Verify
docker compose logs -f byon-executor | head -20
```

**Order age expiration:**

The Executor rejects orders older than 60 minutes (configurable via `max_order_age_minutes`). If the Executor was down for a long time:
```bash
# Clear stale orders
rm -f handoff/auditor_to_executor/*.json

# Restart Executor to process fresh orders
docker compose restart byon-executor
```

### Important Notes

- The Auditor's private key is in `keys/auditor_private.key`. Protect this file. Only the Auditor container should have access.
- The Executor only needs the public key. It mounts `keys/` as read-only.
- The Worker also mounts `keys/` as read-only (for verification purposes).
- Key format: The signer handles both raw Ed25519 (32 bytes) and SPKI/PKCS8 DER formats automatically.
- Executor constraint limits are hardcoded: max 20 iterations, 60 min timeout, 4096 MB memory, 2048 MB disk.

---

## 5. Redis Failures

### Severity: P2

Redis serves as the message queue for real-time events (SSE to the UI) and caching for the memory service. The Watcher publishes file events to Redis channel `byon:events`.

- **Container**: `byon-redis`
- **Image**: `redis:7-alpine`
- **Authentication**: `REDIS_PASSWORD` (required)
- **Healthcheck**: `redis-cli -a $REDIS_PASSWORD ping` (10s interval, 5 retries)
- **Volume**: `redis-data` (named volume, persistent)

### Symptoms

- SSE events stop in the UI (dashboard does not update in real-time)
- Memory service caching degrades (slower queries)
- Watcher logs: `Redis client error` or `Redis publish failed`
- Gateway logs: Redis connection errors

### Diagnosis

```bash
# Check Redis container status
docker inspect --format='{{.State.Health.Status}}' byon-redis

# Test Redis connectivity from host
docker exec byon-redis redis-cli -a "$REDIS_PASSWORD" ping

# Check Redis memory usage
docker exec byon-redis redis-cli -a "$REDIS_PASSWORD" info memory

# Check Redis logs
docker compose logs --tail=100 redis
```

### Recovery Steps

**Redis crash (auto-restart):**
```bash
# Usually Docker handles this. Verify:
docker compose ps redis

# If stuck, force restart
docker compose restart redis

# Reconnect dependent services
docker compose restart watcher memory-service openclaw-gateway
```

**Redis data corruption:**
```bash
# Stop Redis
docker compose stop redis

# Clear Redis data volume
docker volume rm byon_optimus_redis-data

# Restart Redis (starts fresh)
docker compose up -d redis

# Restart dependents
docker compose restart memory-service watcher openclaw-gateway
```

**Redis memory exhaustion:**

Redis is limited to 1536MB in Docker. The `redis.conf` sets `maxmemory 1gb` with eviction policy.
```bash
# Check current memory usage
docker exec byon-redis redis-cli -a "$REDIS_PASSWORD" info memory | grep used_memory_human

# Flush non-essential cache (preserves pub/sub subscriptions)
docker exec byon-redis redis-cli -a "$REDIS_PASSWORD" flushdb

# If memory is still high, restart
docker compose restart redis
```

**Password mismatch:**

If `REDIS_PASSWORD` in `.env` does not match what Redis was started with:
```bash
# Stop everything
docker compose down

# Remove Redis volume to clear old password
docker volume rm byon_optimus_redis-data

# Restart with correct password
docker compose up -d
```

### Impact of Redis Downtime

| Component | Impact | Degradation |
|-----------|--------|-------------|
| Watcher | Cannot publish file events | SSE stops; pipeline still works |
| Memory Service | Cache misses; falls back to disk | Slower but functional |
| Gateway | Cannot relay real-time events | Dashboard does not auto-refresh |
| Worker/Auditor | Minimal | File-based handoff continues |
| Executor | None | Air-gapped; no Redis dependency |

The pipeline **continues to function** without Redis. Only real-time UI updates and caching are affected.

---

## 6. Gateway (OpenClaw) Failures

### Severity: P2 (gateway down) / P3 (channel disconnect)

The OpenClaw Gateway is the unified entry point for all user interaction: UI at port 3000, browser relay at port 8080, and all channel integrations (Telegram, Discord, WhatsApp, etc.).

- **Container**: `openclaw-gateway`
- **Ports**: 3000 (UI + API), 8080 (browser relay), 18792 (Chrome extension)
- **Healthcheck**: `http://localhost:3000/health` (30s interval, 3 retries, 30s start period)
- **Resource limits**: 2 CPU, 3GB RAM

### Symptoms

- Cannot access `http://localhost:3000`
- Channel messages not reaching inbox
- Approval requests not delivered to users
- Dashboard shows "disconnected"

### Diagnosis

```bash
# Check gateway status
docker inspect --format='{{.State.Health.Status}}' openclaw-gateway

# Check logs
docker compose logs --tail=200 openclaw-gateway

# Test health endpoint
curl -s http://localhost:3000/health | jq .

# Check port binding
docker compose port openclaw-gateway 3000

# Test API proxy
curl -s http://localhost:3000/api/worker/status | jq .
curl -s http://localhost:3000/api/auditor/status | jq .
curl -s http://localhost:3000/api/memory/stats | jq .
```

### Recovery Steps

**Gateway crash (auto-restart):**
```bash
docker compose restart openclaw-gateway
```

**Port conflict (3000 already in use):**
```bash
# Find what is using port 3000
# Linux:
lsof -i :3000
# Windows:
netstat -ano | findstr :3000

# Kill the conflicting process, then restart
docker compose restart openclaw-gateway
```

**Channel disconnects:**

Channels are managed by OpenClaw plugins. Each channel can fail independently.

```bash
# Check channel status via API
curl -s http://localhost:3000/api/worker/status | jq '.channels'

# Restart the gateway to reinitialize channels
docker compose restart openclaw-gateway
```

**WhatsApp re-pairing:**

WhatsApp uses session credentials stored in `openclaw-config/credentials/whatsapp/default/`. If the session expires:

1. Stop the gateway: `docker compose stop openclaw-gateway`
2. Delete the stale session files:
   ```bash
   rm -f openclaw-config/credentials/whatsapp/default/creds.json
   rm -f openclaw-config/credentials/whatsapp/default/session-*.json
   ```
3. Restart the gateway: `docker compose up -d openclaw-gateway`
4. Scan the new QR code displayed in the gateway logs:
   ```bash
   docker compose logs -f openclaw-gateway | grep -A 20 "QR"
   ```
5. Verify pairing:
   ```bash
   cat openclaw-config/devices/paired.json
   ```

**UI rebuild required:**

The Optimus UI is a Lit web component compiled by Vite at Docker build time. If UI changes are not visible:
```bash
docker compose build openclaw-gateway
docker compose up -d openclaw-gateway
```

**Circuit breaker tripped (bridge):**

The OpenClaw Bridge has a circuit breaker (5 failures = open, 30s reset timeout). If it trips:
```bash
# Check bridge status in auditor logs
docker compose logs --tail=50 byon-auditor | grep -i "circuit"

# Restart auditor to reset circuit breaker
docker compose restart byon-auditor
```

### Important Notes

- The Gateway proxies all `/api/*` requests to internal services. Rate limiting applies: 60 req/min general, 10 req/min for approval endpoints.
- HMAC authentication (`BYON_BRIDGE_SECRET`) protects the approval endpoint. A mismatch between gateway and auditor secrets will block approvals.
- Gateway stores OpenClaw data in `Byon_bot/openclaw-main/data/` (mounted as volume). Corruption here affects chat history, not the BYON pipeline.

---

## 7. WFP Sentinel Failures

### Severity: P4 (sentinel is optional)

The WFP Sentinel is an **optional** kernel-level network guard. The entire BYON pipeline operates identically with or without it. The Sentinel Bridge gracefully no-ops when sentinel is not installed.

### Architecture

```
Auditor signs ExecutionOrder
    |
    v
sentinel-bridge.ts generates EXECUTION_INTENT (*.intent.json)
    |
    v
C# ByonWfpBridge picks up intent files, verifies Ed25519 signature
    |
    v
C# bridge pushes WFP rules to kernel via IOCTL
```

### Safety Guarantees

- **G1**: All intents have TTL (max 3600 seconds). Kernel auto-expires stale rules.
- **G2**: Human freeze always wins. Freeze command bypasses all intents.
- **G3**: Bridge failure = fail-safe deny. No intent = kernel blocks.
- **G4**: Zero mandatory dependency. Pipeline runs without sentinel.

### Symptoms

| Issue | Symptom |
|-------|---------|
| Sentinel offline | `handoff/sentinel/status.json` shows `installed: false` or is missing |
| Emergency freeze stuck | `status.json` shows `frozen: true`, no network traffic allowed |
| Bridge disconnected | `*.intent.json` files accumulate, not picked up by C# bridge |
| Expired intents | Kernel blocks traffic that should be allowed |

### Diagnosis

```bash
# Check sentinel status file
cat handoff/sentinel/status.json | jq .

# Check for stuck freeze
cat handoff/sentinel/freeze-command.json | jq .

# Check intent file accumulation
ls -la handoff/auditor_to_executor/*.intent.json 2>/dev/null | wc -l

# Check sentinel events
ls -lt handoff/sentinel/events/ | head -10
```

### Recovery Steps

**Emergency freeze stuck:**

If the sentinel is frozen and you cannot unfreeze through the UI:
```bash
# Write unfreeze command directly
cat > handoff/sentinel/freeze-command.json << 'EOF'
{
  "command": "unfreeze",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "source": "manual-recovery",
  "reason": "Manual unfreeze via recovery procedure"
}
EOF

# Update status
cat handoff/sentinel/status.json | jq '.frozen = false | del(.frozenAt, .frozenBy)' > /tmp/status.json
mv /tmp/status.json handoff/sentinel/status.json
```

**Bridge disconnected (C# side not running):**
```bash
# Clean up accumulated intent files (they have TTLs and are expired anyway)
rm -f handoff/auditor_to_executor/*.intent.json
rm -f handoff/auditor_to_executor/*.revoke.json

# The pipeline continues without sentinel. No action required.
```

**Kernel driver crash (Windows host):**

This requires host-level intervention:
1. Open an elevated PowerShell on the Windows host
2. Check driver status: `sc query WfpGuard`
3. Restart the driver: `sc stop WfpGuard && sc start WfpGuard`
4. If driver fails to load, reboot the host (WFP drivers cannot be hot-reloaded safely)
5. Verify: `sc query WfpGuard` should show `RUNNING`

**IPC HMAC mismatch:**

The bridge uses HMAC-SHA256 to authenticate intent files to the C# bridge. If the shared secret (`ipcHmacSecret`) is wrong:
```bash
# Check if HMAC is configured
grep SENTINEL_HMAC .env

# Update the secret in both the TS bridge and C# bridge configuration
# Then restart the sentinel bridge container (if enabled)
docker compose restart sentinel-bridge
```

### Important Notes

- Sentinel is commented out in `docker-compose.yml` by default. It requires explicit opt-in.
- Intent files have a default TTL of 300 seconds (5 minutes), hard-capped at 3600 seconds (1 hour).
- The `cleanupExpiredIntents()` method runs periodically to remove stale intent files.
- Essential services (DNS, DHCP) remain accessible even during freeze.

---

## 8. Docker/Container Failures

### Severity: P1 (networking) / P2 (individual containers) / P3 (resources)

### Network Issues

All services share `byon-network` (bridge, subnet `172.28.0.0/16`) except the Executor which has `network_mode: none`.

```bash
# Check network exists
docker network inspect byon-network

# Check which containers are connected
docker network inspect byon-network --format='{{range .Containers}}{{.Name}} {{end}}'

# Recreate network if corrupted
docker compose down
docker network rm byon_optimus_byon-network
docker compose up -d
```

**Container cannot resolve other containers:**
```bash
# Test DNS resolution within a container
docker exec byon-worker ping -c 1 memory-service
docker exec byon-worker ping -c 1 redis

# If DNS fails, restart Docker daemon or recreate the network
docker compose down
docker compose up -d
```

### Volume Mount Problems

```bash
# Check volume mounts for a specific container
docker inspect byon-worker --format='{{range .Mounts}}{{.Source}} -> {{.Destination}} ({{.Mode}}){{"\n"}}{{end}}'

# Verify host directories exist
ls -la handoff/ keys/ memory/

# Check for permission issues (containers run as 1001:1001)
# Linux:
stat handoff/inbox/
# Windows: check Docker Desktop file sharing settings
```

**Common volume issues and fixes:**

| Issue | Symptom | Fix |
|-------|---------|-----|
| Host dir missing | Container logs: `ENOENT` | Create the directory, restart container |
| Permission denied | Container logs: `EACCES` | `chown -R 1001:1001 <dir>` (Linux) |
| Read-only mount vs write needed | Container logs: `EROFS` | Check `:ro`/`:rw` in docker-compose.yml |
| Docker Desktop file sharing | Container cannot see host files | Add project path in Docker Desktop Settings > Resources > File Sharing |

### Resource Exhaustion

Resource limits per container are defined in `docker-compose.yml`:

| Service | CPU Limit | Memory Limit | Memory Reservation |
|---------|-----------|--------------|-------------------|
| memory-service | 2 | 4GB | 1GB |
| byon-worker | 2 | 2GB | 512MB |
| byon-auditor | 2 | 2GB | 512MB |
| byon-executor | 2 | 2GB | 512MB |
| openclaw-gateway | 2 | 3GB | 1GB |
| redis | 1 | 1.5GB | 512MB |
| watcher | 0.25 | 128MB | 64MB |
| prometheus | 1 | 1GB | 256MB |
| grafana | 1 | 512MB | 128MB |

```bash
# Check current resource usage
docker stats --no-stream

# Check for OOM kills
docker inspect byon-worker --format='{{.State.OOMKilled}}'

# Check system-wide Docker disk usage
docker system df

# Clean up unused images and volumes
docker system prune -f
docker volume prune -f
```

**OOM killed containers:**
```bash
# Increase memory limit temporarily (requires restart)
# Edit docker-compose.yml deploy.resources.limits.memory
# Then:
docker compose up -d <service>
```

**Disk full:**
```bash
# Check Docker disk usage
docker system df -v

# Prune old images
docker image prune -a -f

# Prune build cache
docker builder prune -f

# Check handoff directory size (old files accumulating)
du -sh handoff/*
```

---

## 9. Complete System Recovery

### Severity: P1

Use this as a last resort when individual recovery steps have failed or the system state is too corrupted to diagnose.

### Prerequisites

Before proceeding, ensure you have:
- [ ] Access to the project directory
- [ ] `.env` file with all required secrets (`ANTHROPIC_API_KEY`, `BYON_BRIDGE_SECRET`, `REDIS_PASSWORD`, `OPENCLAW_GATEWAY_TOKEN`, `GRAFANA_PASSWORD`)
- [ ] Docker and Docker Compose installed and running
- [ ] Ed25519 key pair (or ability to generate one)

### Full Teardown and Rebuild

```bash
# ============================================
# STEP 1: Stop everything and preserve data
# ============================================

# Stop all containers
docker compose down

# Back up critical data
mkdir -p recovery_backup_$(date +%Y%m%d)
cp -r keys/ recovery_backup_$(date +%Y%m%d)/keys/ 2>/dev/null
cp -r memory/ recovery_backup_$(date +%Y%m%d)/memory/ 2>/dev/null
cp -r handoff/ recovery_backup_$(date +%Y%m%d)/handoff/ 2>/dev/null
cp .env recovery_backup_$(date +%Y%m%d)/.env 2>/dev/null
cp -r openclaw-config/ recovery_backup_$(date +%Y%m%d)/openclaw-config/ 2>/dev/null

# ============================================
# STEP 2: Clean Docker state
# ============================================

# Remove containers, networks, and optionally volumes
docker compose down -v  # -v removes named volumes (redis-data, prometheus-data, grafana-data)

# Remove old images to force rebuild
docker compose down --rmi local

# Prune system
docker system prune -f

# ============================================
# STEP 3: Rebuild directory structure
# ============================================

# Recreate handoff directories
mkdir -p handoff/{inbox,outbox,worker_to_auditor/archive,auditor_to_user,auditor_to_executor,executor_to_worker,auditor_state,sentinel/events,user_to_auditor}

# Recreate memory storage
mkdir -p memory/

# Recreate keys directory
mkdir -p keys/

# Recreate project directory (for Executor mount)
mkdir -p project/

# ============================================
# STEP 4: Regenerate keys
# ============================================

# Option A: Use pnpm keygen
pnpm keygen

# Option B: Generate manually
node -e "
const crypto = require('crypto');
const fs = require('fs');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync('keys/auditor_public.key', publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
fs.writeFileSync('keys/auditor_private.key', privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'));
console.log('Ed25519 keys generated in keys/');
"

# ============================================
# STEP 5: Verify environment
# ============================================

# Check .env exists and has required variables
grep -c "ANTHROPIC_API_KEY" .env
grep -c "BYON_BRIDGE_SECRET" .env
grep -c "REDIS_PASSWORD" .env
grep -c "OPENCLAW_GATEWAY_TOKEN" .env
grep -c "GRAFANA_PASSWORD" .env

# ============================================
# STEP 6: Build and start
# ============================================

# Full rebuild (no cache)
docker compose build --no-cache

# Start all services
docker compose up -d

# ============================================
# STEP 7: Verify
# ============================================

# Wait 60 seconds for all healthchecks to stabilize
sleep 60

# Check all services
docker compose ps

# Verify health endpoints
curl -s http://localhost:8001/health | jq .   # Memory service
curl -s http://localhost:3000/health | jq .   # Gateway
curl -s http://localhost:9090/-/healthy        # Prometheus

# Check agent health
docker inspect --format='{{.State.Health.Status}}' byon-memory
docker inspect --format='{{.State.Health.Status}}' byon-worker
docker inspect --format='{{.State.Health.Status}}' byon-auditor
docker inspect --format='{{.State.Health.Status}}' byon-executor
docker inspect --format='{{.State.Health.Status}}' openclaw-gateway
docker inspect --format='{{.State.Health.Status}}' byon-redis

echo "Recovery complete. Access UI at http://localhost:3000"
```

### Post-Recovery Checklist

- [ ] All containers show `healthy` or `running` in `docker compose ps`
- [ ] Memory service responds at `http://localhost:8001/health`
- [ ] Gateway UI loads at `http://localhost:3000`
- [ ] Optimus dashboard accessible at `http://localhost:3000` (Optimus tab)
- [ ] Prometheus accessible at `http://localhost:9090`
- [ ] Grafana accessible at `http://localhost:3001`
- [ ] Redis responds to PING
- [ ] Watcher heartbeat file is recent (`/tmp/watcher-heartbeat` inside watcher container)
- [ ] Test message flows through pipeline (send via any channel, verify receipt)
- [ ] WhatsApp re-paired (if applicable)
- [ ] Ed25519 signature verification works (check Executor logs)

---

## 10. Monitoring and Detection

### Health Check Summary

| Service | Method | Endpoint/Check | Interval | Retries |
|---------|--------|----------------|----------|---------|
| memory-service | HTTP | `http://localhost:8000/health` | 10s | 5 |
| byon-worker | HTTP | `http://localhost:3002/health` | 30s | 3 |
| byon-auditor | HTTP | `http://localhost:3003/health` | 30s | 3 |
| byon-executor | File | `/tmp/healthy` exists | 30s | 3 |
| openclaw-gateway | HTTP | `http://localhost:3000/health` | 30s | 3 |
| redis | CLI | `redis-cli ping` | 10s | 5 |
| watcher | File | `/tmp/watcher-heartbeat` (< 1 min old) | 30s | 3 |
| prometheus | HTTP | `http://localhost:9090/-/healthy` | 30s | 3 |
| grafana | HTTP | `http://localhost:3000/api/health` (internal port) | 30s | 3 |

### Prometheus Metrics

Prometheus scrapes metrics from all services at the `/metrics` endpoint:

| Job | Target | Scrape Interval |
|-----|--------|-----------------|
| prometheus | localhost:9090 | 15s |
| memory-service | memory-service:8000 | 10s |
| byon-worker | byon-worker:3002 | 30s |
| byon-auditor | byon-auditor:3003 | 30s |
| openclaw-gateway | openclaw-gateway:3000 | 30s |

Access Prometheus at `http://localhost:9090` to query metrics and view targets.

### Key Metrics to Monitor

| Metric | Source | Alert Threshold | Severity |
|--------|--------|-----------------|----------|
| Service health status | Docker healthcheck | `unhealthy` | P1 |
| Memory service response time | Prometheus | > 5s | P2 |
| Handoff directory file count | Watcher | > 50 files in any directory | P2 |
| Redis memory usage | Redis INFO | > 80% of maxmemory | P3 |
| Watcher heartbeat age | File mtime | > 60 seconds | P3 |
| Container restart count | Docker | > 3 in 5 minutes | P2 |
| Gateway error rate | Prometheus | > 10% | P2 |
| Executor order age rejection | Executor logs | Any occurrence | P3 |
| Signature verification failure | Executor logs | Any occurrence | P2 |
| Circuit breaker state | Auditor logs | `open` | P2 |

### Quick Health Check Script

Run this to get a snapshot of system health:

```bash
#!/bin/bash
echo "=== BYON Optimus Health Check ==="
echo ""

echo "--- Container Status ---"
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Health}}"
echo ""

echo "--- Health Endpoints ---"
echo -n "Memory Service (8001): "
curl -s -o /dev/null -w "%{http_code}" http://localhost:8001/health 2>/dev/null || echo "UNREACHABLE"
echo ""
echo -n "Gateway (3000): "
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health 2>/dev/null || echo "UNREACHABLE"
echo ""
echo -n "Prometheus (9090): "
curl -s -o /dev/null -w "%{http_code}" http://localhost:9090/-/healthy 2>/dev/null || echo "UNREACHABLE"
echo ""

echo ""
echo "--- Handoff Directory Counts ---"
for dir in inbox worker_to_auditor auditor_to_user auditor_to_executor executor_to_worker; do
  count=$(find handoff/$dir -name "*.json" -type f 2>/dev/null | wc -l)
  echo "  $dir: $count files"
done
echo ""

echo "--- Redis ---"
docker exec byon-redis redis-cli -a "$REDIS_PASSWORD" ping 2>/dev/null || echo "Redis: UNREACHABLE"
echo ""

echo "--- Resource Usage ---"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"
```

### Grafana Dashboards

Access Grafana at `http://localhost:3001` (default credentials: `admin` / value of `GRAFANA_PASSWORD` in `.env`).

Recommended dashboard panels:
- Container uptime and restart frequency
- Memory service query latency
- Redis memory and connection count
- Handoff file throughput (events from watcher)
- Gateway request rate and error rate
- Prometheus target health

### Log Aggregation

All services output structured JSON logs. To search across all services:

```bash
# Search all logs for errors in the last hour
docker compose logs --since 1h 2>&1 | grep -i error

# Follow all logs in real-time
docker compose logs -f

# Follow a specific service
docker compose logs -f byon-worker

# Export logs for analysis
docker compose logs --no-color > byon_logs_$(date +%Y%m%d_%H%M%S).log
```

### Alerting

Prometheus AlertManager is configured but commented out in `config/prometheus.yml`. To enable alerting:

1. Uncomment the `alerting` and `rule_files` sections in `config/prometheus.yml`
2. Create alert rules in `config/prometheus/rules/`
3. Deploy AlertManager as an additional Docker service
4. Configure notification channels (email, Slack, PagerDuty)

---

## Appendix: Common Error Messages

| Error Message | Source | Meaning | Resolution |
|---------------|--------|---------|------------|
| `BYON_BRIDGE_SECRET must be set` | Docker Compose | Missing env var | Set `BYON_BRIDGE_SECRET` in `.env` |
| `REDIS_PASSWORD must be set` | Docker Compose | Missing env var | Set `REDIS_PASSWORD` in `.env` |
| `Invalid signature - not signed by trusted key` | Executor | Key mismatch | Regenerate keys (Section 4) |
| `Hash mismatch - order may have been tampered` | Executor | Order corrupted in transit | Check handoff file integrity |
| `No trusted keys configured` | Executor | Missing public key | Verify `keys/` directory mount |
| `Order too old: N minutes` | Executor | Stale order (> 60 min) | Clear old orders, restart |
| `Circuit breaker: open` | Bridge | Gateway unreachable | Restart auditor and gateway |
| `Redis client error` | Watcher | Redis connection lost | Restart Redis, then watcher |
| `BYON_VAULT_KEY environment variable must be set` | Vault | Missing encryption key | Set `BYON_VAULT_KEY` in `.env` |
| `Checksum verification failed` | Vault | Encrypted data corrupted | Restore vault from backup |
| `[Sentinel] System is FROZEN` | Sentinel Bridge | Emergency freeze active | Unfreeze via UI or manual recovery (Section 7) |
