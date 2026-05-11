# BYON Optimus Production Deployment Runbook

**Document Version:** 1.0 (with v0.6.4 memory backend addendum)
**Date:** 2026-02-02 (original); **v0.6.4 addendum:** 2026-05-11
**Status:** Level 2 (Morphogenetic Advisory Memory) — production-ready; Level 3 research-in-progress

> **v0.6.4 memory backend addendum.** The memory service runs a hybrid backend:
> - **FAISS `IndexFlatIP`** (semantic retrieval) — preserves all legacy actions (`ping`, `store`, `search`, `search_all`, `stats`, `test_recovery`).
> - **FCE-M v0.6.0** (morphogenetic advisory) — exposes `fce_state`, `fce_advisory`, `fce_priority_recommendations`, `fce_omega_registry`, `fce_reference_fields`, `fce_consolidate`, `fce_morphogenesis_report`, `fce_assimilate_receipt`.
>
> **Deployment health check:** after `docker compose up -d`, verify both layers:
> ```bash
> curl -s http://localhost:8001/health         # FAISS+FCE-M health
> curl -s -XPOST http://localhost:8001/ \
>      -H 'Content-Type: application/json' \
>      -d '{"action":"fce_state"}'           # expect enabled=true
> curl -s -XPOST http://localhost:8001/ \
>      -H 'Content-Type: application/json' \
>      -d '{"action":"stats"}'                # legacy compatibility
> ```
> System facts (18-entry canonical corpus) are seeded automatically by the WhatsApp bridge and the deep test suite on startup; they can be re-seeded idempotently via `scripts/lib/byon-system-facts.mjs::seedSystemFacts(mem)`. State persists to `byon-orchestrator/memory-service/memory_storage/` (`faiss_*.bin`, `meta_*.pkl`, `fcem/fcem_snapshot.json`).
>
> See [`RESEARCH_PROGRESS_v0.6.md`](RESEARCH_PROGRESS_v0.6.md) for the operational classification and known coagulation limits.

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [GMV (Global Memory Vitalizer) Decision](#gmv-decision)
3. [Deployment Steps](#deployment-steps)
4. [Backup & Recovery Procedures](#backup--recovery-procedures)
5. [Monitoring & Alerting Setup](#monitoring--alerting-setup)
6. [Maintenance Procedures](#maintenance-procedures)
7. [Troubleshooting Guide](#troubleshooting-guide)
8. [Incident Response](#incident-response)
9. [Rollback Procedures](#rollback-procedures)
10. [Performance Tuning](#performance-tuning)

---

## Pre-Deployment Checklist

### Security Requirements (CRITICAL)

- [ ] **Rotate OPENCLAW_GATEWAY_TOKEN**
  ```bash
  openssl rand -hex 32
  # Update .env only, remove from all config files
  ```

- [ ] **Rotate Anthropic API Key**
  - Revoke old key (COMPROMISED - now redacted)
  - Generate new key in Anthropic Console
  - Update `.env` with new key
  - Set spending limits and alerts

- [ ] **Generate Proper Ed25519 Keys**
  ```bash
  cd Byon_bot
  npm install @noble/ed25519
  node scripts/generate-keys.js
  # Backup keys to secure location
  ```

- [ ] **Set Strong Redis Password**
  ```bash
  # Generate password
  openssl rand -base64 32
  # Add to .env
  echo "REDIS_PASSWORD=<generated_password>" >> .env
  ```

- [ ] **Set BYON Bridge Secret**
  ```bash
  openssl rand -hex 32
  echo "BYON_BRIDGE_SECRET=<generated_secret>" >> .env
  ```

- [ ] **Verify .gitignore**
  ```bash
  # Ensure sensitive files are ignored
  grep -E "^\.env$|^keys/private" .gitignore
  ```

### Infrastructure Requirements

- [ ] **Minimum Hardware Requirements**
  - CPU: 8 cores (12+ recommended)
  - RAM: 16GB (24GB+ recommended)
  - Disk: 100GB SSD (500GB+ recommended for production)
  - Network: 1Gbps (stable connection required)

- [ ] **Docker & Docker Compose**
  ```bash
  docker --version  # >= 24.0
  docker-compose --version  # >= 2.20
  ```

- [ ] **Required Ports Available**
  - 3000: OpenClaw Gateway (HTTPS recommended)
  - 8080: OpenClaw Gateway Alt
  - 8001: Memory Service (internal only)
  - 6379: Redis (internal only)

- [ ] **File System Setup**
  ```bash
  # Create necessary directories
  mkdir -p handoff/{inbox,outbox,worker_to_auditor,auditor_to_executor,executor_to_worker,auditor_to_user}
  mkdir -p memory
  mkdir -p keys/public
  mkdir -p backups
  ```

### Configuration Requirements

- [ ] **Complete .env File**
  - All required environment variables set
  - No placeholder values
  - Secrets properly configured

- [ ] **Validate Environment**
  ```bash
  bash scripts/validate-env.sh
  ```

- [ ] **Channel Credentials** (configure at least one)
  - Telegram, Discord, or other channel
  - Test credentials before deployment

### Testing Requirements

- [ ] **Run Unit Tests**
  ```bash
  npm test
  ```

- [ ] **Run FHRSS+FCPE Tests**
  ```bash
  cd tests/fhrss_fcpe
  pytest test_compression_recovery.py -v
  ```

- [ ] **Run Load Tests**
  ```bash
  cd tests/load
  python load_test.py --profile default
  ```

- [ ] **Verify Signature System**
  ```bash
  # Test Ed25519 signing/verification
  npm test -- --grep "Ed25519"
  ```

---

## GMV (Global Memory Vitalizer) Decision

### What is GMV?

The Global Memory Vitalizer (GMV) is an optional daemon that:
- Generates periodic memory metadata summaries
- Creates Attractors (thematic clusters)
- Provides GlobalMemorySummary (system-wide insights)
- Read-only access to FHRSS+FCPE memory
- Runs every 60 seconds (configurable)

**File**: `byon-orchestrator/src/memory/vitalizer/daemon.ts`

### Decision Matrix

| Scenario | Recommendation | Rationale |
|----------|---------------|-----------|
| **Minimal MVP** | Disable | Reduces complexity, fewer moving parts |
| **Enhanced Experience** | Enable | Better memory insights, improved context awareness |
| **High Volume** | Disable | Reduces CPU/memory overhead |
| **Development** | Enable | Better debugging and visibility |
| **Production (Standard)** | **Enable** | Provides valuable insights with minimal overhead |

### Our Recommendation: **ENABLE GMV**

**Reasoning:**
1. ✅ Provides enhanced memory insights
2. ✅ Minimal performance overhead (read-only, 60s interval)
3. ✅ Improves system observability
4. ✅ Helps with debugging and monitoring
5. ✅ Can be disabled later if needed

### Configuration

#### To Enable GMV (Recommended)
```bash
# In .env (or leave unset - enabled by default)
DISABLE_GMV_DAEMON=false
GMV_UPDATE_INTERVAL_SEC=60
```

#### To Disable GMV
```bash
# In .env
DISABLE_GMV_DAEMON=true
```

### Monitoring GMV

```bash
# Check GMV status
docker logs byon-worker | grep "GMV"

# Expected output:
# [GMV] Daemon started, interval: 60s
# [GMV] Generated summary: 47 contexts, 3 attractors
```

---

## Deployment Steps

### Step 1: Pre-Deployment Setup

```bash
# 1. Clone repository (if not already)
git clone <repository-url>
cd byon_optimus

# 2. Create .env from template
cp .env.example .env

# 3. Edit .env with production values
nano .env
# - Set all API keys and tokens (rotated, secure)
# - Configure channel credentials
# - Set production URLs
# - Enable/disable GMV (recommend: enable)

# 4. Generate Ed25519 keys
cd Byon_bot
npm install @noble/ed25519
node scripts/generate-keys.js

# 5. Validate environment
cd ..
bash scripts/validate-env.sh
```

### Step 2: Build Docker Images

```bash
# Build all images
docker-compose build --no-cache

# Verify images
docker images | grep byon
```

### Step 3: Initialize Storage

```bash
# Create volumes and directories
docker-compose up -d redis
sleep 10

# Initialize memory service
docker-compose up -d memory-service
sleep 30

# Verify memory service health
curl http://localhost:8001/health
```

### Step 4: Start Core Services

```bash
# Start all services
docker-compose up -d

# Wait for services to be healthy
sleep 30

# Verify all services
docker-compose ps
```

### Step 5: Post-Deployment Verification

```bash
# 1. Check service health
docker-compose ps
# All services should show "Up" and "healthy"

# 2. Test OpenClaw Gateway
curl http://localhost:3000/health

# 3. Test Memory Service
curl -X POST http://localhost:8001/ \
  -H "Content-Type: application/json" \
  -d '{"action":"ping"}'

# 4. Check logs for errors
docker-compose logs --tail=100

# 5. Send test message
# Use configured channel (e.g., Telegram) to send "Hello BYON"

# 6. Monitor processing
docker logs -f byon-worker
```

---

## Backup & Recovery Procedures

### What to Backup

1. **Critical Data** (Daily)
   - Redis data: `/var/lib/docker/volumes/redis-data`
   - Memory storage: `./memory/`
   - Keys: `./keys/` (SECURE LOCATION ONLY)
   - Configuration: `.env` (SECURE LOCATION ONLY)

2. **Audit Logs** (Weekly)
   - Worker logs: `./audit_logs/worker/`
   - Auditor logs: `./audit_logs/auditor/`
   - Executor logs: `./audit_logs/executor/`

3. **Handoff State** (Optional)
   - Pending messages: `./handoff/inbox/`
   - Processing state: `./handoff/*/`

### Automated Backup Script

Create `scripts/backup-production.sh`:

```bash
#!/bin/bash
set -e

BACKUP_DIR="/secure/backups/byon-optimus"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="$BACKUP_DIR/$TIMESTAMP"

echo "🔄 Starting BYON Optimus backup..."

# Create backup directory
mkdir -p "$BACKUP_PATH"

# 1. Backup Redis data
echo "📦 Backing up Redis data..."
docker exec byon-redis redis-cli BGSAVE
sleep 5
docker cp byon-redis:/data/dump.rdb "$BACKUP_PATH/redis-dump.rdb"

# 2. Backup Memory storage
echo "🧠 Backing up memory storage..."
tar -czf "$BACKUP_PATH/memory-storage.tar.gz" ./memory/

# 3. Backup Keys (ENCRYPTED!)
echo "🔐 Backing up keys (encrypted)..."
tar -czf - ./keys/ | openssl enc -aes-256-cbc -salt -pbkdf2 \
  -out "$BACKUP_PATH/keys-encrypted.tar.gz.enc" \
  -pass file:/secure/backup-password.txt

# 4. Backup Configuration (ENCRYPTED!)
echo "⚙️  Backing up configuration (encrypted)..."
openssl enc -aes-256-cbc -salt -pbkdf2 \
  -in .env \
  -out "$BACKUP_PATH/env-encrypted.enc" \
  -pass file:/secure/backup-password.txt

# 5. Backup Audit logs
echo "📋 Backing up audit logs..."
tar -czf "$BACKUP_PATH/audit-logs.tar.gz" ./audit_logs/ 2>/dev/null || true

# 6. Create backup manifest
cat > "$BACKUP_PATH/manifest.json" <<EOF
{
  "timestamp": "$TIMESTAMP",
  "backup_date": "$(date -Iseconds)",
  "version": "$(git rev-parse HEAD 2>/dev/null || echo 'unknown')",
  "files": {
    "redis": "redis-dump.rdb",
    "memory": "memory-storage.tar.gz",
    "keys": "keys-encrypted.tar.gz.enc",
    "config": "env-encrypted.enc",
    "audit_logs": "audit-logs.tar.gz"
  }
}
EOF

# 7. Calculate checksums
echo "🔍 Calculating checksums..."
cd "$BACKUP_PATH"
sha256sum * > checksums.sha256

# 8. Cleanup old backups (keep last 30 days)
echo "🧹 Cleaning up old backups..."
find "$BACKUP_DIR" -type d -mtime +30 -exec rm -rf {} + 2>/dev/null || true

echo "✅ Backup complete: $BACKUP_PATH"
du -sh "$BACKUP_PATH"
```

### Backup Schedule (Cron)

```bash
# Edit crontab
crontab -e

# Add backup jobs
# Daily backup at 2 AM
0 2 * * * /path/to/scripts/backup-production.sh >> /var/log/byon-backup.log 2>&1

# Weekly full backup at Sunday 3 AM
0 3 * * 0 /path/to/scripts/backup-production-full.sh >> /var/log/byon-backup-full.log 2>&1
```

### Restoration Procedure

```bash
#!/bin/bash
# scripts/restore-production.sh

BACKUP_PATH="$1"

if [ -z "$BACKUP_PATH" ]; then
  echo "Usage: $0 <backup_path>"
  exit 1
fi

echo "🔄 Restoring from: $BACKUP_PATH"

# 1. Stop services
docker-compose down

# 2. Restore Redis data
echo "📦 Restoring Redis data..."
docker cp "$BACKUP_PATH/redis-dump.rdb" byon-redis:/data/dump.rdb

# 3. Restore Memory storage
echo "🧠 Restoring memory storage..."
rm -rf ./memory/*
tar -xzf "$BACKUP_PATH/memory-storage.tar.gz"

# 4. Restore Keys (DECRYPT!)
echo "🔐 Restoring keys..."
openssl enc -d -aes-256-cbc -pbkdf2 \
  -in "$BACKUP_PATH/keys-encrypted.tar.gz.enc" \
  -pass file:/secure/backup-password.txt | tar -xz

# 5. Restore Configuration (DECRYPT!)
echo "⚙️  Restoring configuration..."
openssl enc -d -aes-256-cbc -pbkdf2 \
  -in "$BACKUP_PATH/env-encrypted.enc" \
  -out .env \
  -pass file:/secure/backup-password.txt

# 6. Verify checksums
echo "🔍 Verifying checksums..."
cd "$BACKUP_PATH"
sha256sum -c checksums.sha256

# 7. Restart services
echo "🚀 Restarting services..."
cd -
docker-compose up -d

# 8. Verify restoration
sleep 30
docker-compose ps
curl http://localhost:8001/health

echo "✅ Restoration complete"
```

---

## Monitoring & Alerting Setup

### Prometheus Metrics

**Status**: ✅ Enabled (registry collision fixed)

#### Metrics Endpoint
```bash
curl http://localhost:8001/metrics
```

#### Key Metrics to Monitor

| Metric | Description | Alert Threshold |
|--------|-------------|----------------|
| `memory_service_requests_total` | Total requests | N/A |
| `memory_service_request_duration_seconds` | Request latency | P95 > 1s |
| `memory_service_search_operations_total` | Search operations | N/A |
| `memory_service_search_duration_seconds` | Search latency | P95 > 500ms |
| `memory_service_contexts_total` | Total contexts | N/A |
| `memory_service_uptime_seconds` | Service uptime | < 60s (restart) |
| `memory_service_rate_limit_exceeded_total` | Rate limit hits | > 100/hour |

### Grafana Dashboard

Create `monitoring/grafana-dashboard.json`:

```json
{
  "dashboard": {
    "title": "BYON Optimus Production",
    "panels": [
      {
        "title": "Message Throughput",
        "targets": [
          {
            "expr": "rate(memory_service_requests_total[5m])",
            "legendFormat": "{{method}} {{endpoint}}"
          }
        ]
      },
      {
        "title": "Request Latency (P95)",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(memory_service_request_duration_seconds_bucket[5m]))",
            "legendFormat": "P95"
          }
        ]
      },
      {
        "title": "Memory Contexts",
        "targets": [
          {
            "expr": "memory_service_contexts_total",
            "legendFormat": "{{memory_type}}"
          }
        ]
      },
      {
        "title": "Error Rate",
        "targets": [
          {
            "expr": "rate(memory_service_requests_total{status=~\"5..\"}[5m])",
            "legendFormat": "5xx errors"
          }
        ]
      }
    ]
  }
}
```

### Alerting Rules

Create `monitoring/alerts.yml`:

```yaml
groups:
  - name: byon_optimus
    interval: 30s
    rules:
      # Service Health
      - alert: ServiceDown
        expr: up{job="byon-memory"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "BYON service is down"
          description: "{{ $labels.job }} has been down for more than 1 minute"

      # High Latency
      - alert: HighLatency
        expr: histogram_quantile(0.95, rate(memory_service_request_duration_seconds_bucket[5m])) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High request latency detected"
          description: "P95 latency is {{ $value }}s"

      # High Error Rate
      - alert: HighErrorRate
        expr: rate(memory_service_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }}"

      # Rate Limiting
      - alert: RateLimitExceeded
        expr: increase(memory_service_rate_limit_exceeded_total[1h]) > 100
        labels:
          severity: warning
        annotations:
          summary: "Rate limit frequently exceeded"
          description: "{{ $value }} rate limit hits in last hour"

      # Signature Failures
      - alert: SignatureVerificationFailures
        expr: increase(executor_signature_verification_failed[10m]) > 5
        labels:
          severity: critical
        annotations:
          summary: "Multiple signature verification failures"
          description: "{{ $value }} signature failures in 10 minutes - possible security issue"

      # Disk Space
      - alert: LowDiskSpace
        expr: (node_filesystem_avail_bytes / node_filesystem_size_bytes) < 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Low disk space"
          description: "Only {{ $value | humanizePercentage }} disk space remaining"

      # Memory Usage
      - alert: HighMemoryUsage
        expr: container_memory_usage_bytes{name=~"byon-.*"} / container_spec_memory_limit_bytes > 0.9
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage"
          description: "{{ $labels.name }} using {{ $value | humanizePercentage }} of memory limit"
```

### Log Aggregation

#### Recommended: ELK Stack or Loki

**ELK Stack Setup**:
```yaml
# docker-compose.monitoring.yml
services:
  elasticsearch:
    image: elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
    ports:
      - "9200:9200"

  logstash:
    image: logstash:8.11.0
    volumes:
      - ./monitoring/logstash.conf:/usr/share/logstash/pipeline/logstash.conf

  kibana:
    image: kibana:8.11.0
    ports:
      - "5601:5601"
```

#### Simple Log Monitoring
```bash
# Monitor all BYON logs
docker-compose logs -f --tail=100 | grep -i "error\|fail\|critical"

# Monitor specific service
docker logs -f byon-worker | jq -r '.level,.message'
```

### Health Checks

Create `scripts/health-check.sh`:

```bash
#!/bin/bash

echo "🏥 BYON Optimus Health Check"
echo "=============================="

# Check Docker services
echo -e "\n📦 Docker Services:"
docker-compose ps | grep -E "Up|healthy"

# Check OpenClaw Gateway
echo -e "\n🌐 OpenClaw Gateway:"
curl -s http://localhost:3000/health | jq .

# Check Memory Service
echo -e "\n🧠 Memory Service:"
curl -s http://localhost:8001/health | jq .

# Check Worker
echo -e "\n👷 Worker Service:"
curl -s http://localhost:3002/health | jq . 2>/dev/null || echo "Not accessible (expected)"

# Check Redis
echo -e "\n🗄️  Redis:"
docker exec byon-redis redis-cli ping

# Check disk space
echo -e "\n💾 Disk Space:"
df -h | grep -E "Filesystem|/var/lib/docker"

# Check memory usage
echo -e "\n🔢 Memory Usage:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"

echo -e "\n✅ Health check complete"
```

### Email Alerts (Simple)

Create `scripts/alert-email.sh`:

```bash
#!/bin/bash

ALERT_EMAIL="ops@yourcompany.com"
SUBJECT="$1"
BODY="$2"

# Using sendmail (requires postfix or similar)
echo -e "Subject: [BYON ALERT] $SUBJECT\n\n$BODY" | sendmail "$ALERT_EMAIL"

# Or using mail command
# echo "$BODY" | mail -s "[BYON ALERT] $SUBJECT" "$ALERT_EMAIL"
```

### Webhook Alerts (Slack/Discord)

```bash
#!/bin/bash
# scripts/alert-webhook.sh

WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
MESSAGE="$1"

if [ -n "$WEBHOOK_URL" ]; then
  curl -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "{\"text\": \"🚨 BYON Alert: $MESSAGE\"}"
fi
```

---

## Maintenance Procedures

### Daily Tasks

```bash
# scripts/daily-maintenance.sh

# 1. Check service health
bash scripts/health-check.sh

# 2. Review logs for errors
docker-compose logs --since 24h | grep -i "error\|critical" > /tmp/byon-errors.log

# 3. Monitor disk usage
df -h | grep -E "/var/lib/docker|./memory"

# 4. Check Redis memory
docker exec byon-redis redis-cli INFO memory | grep used_memory_human

# 5. Verify backups completed
ls -lh /secure/backups/byon-optimus/ | tail -5
```

### Weekly Tasks

```bash
# scripts/weekly-maintenance.sh

# 1. Rotate audit logs
find ./audit_logs -name "*.log" -mtime +30 -delete

# 2. Review performance metrics
# (Access Grafana dashboard)

# 3. Test backup restoration (on staging)
bash scripts/restore-production.sh <latest-backup>

# 4. Review rate limiting stats
curl http://localhost:8001/metrics | grep rate_limit

# 5. Update dependencies (security patches)
docker-compose pull
docker-compose up -d
```

### Monthly Tasks

```bash
# scripts/monthly-maintenance.sh

# 1. Rotate API keys (if policy requires)
# Follow security remediation guide

# 2. Review and update .env
# Check for deprecated configurations

# 3. Performance audit
cd tests/load
python load_test.py --profile sustained --output monthly-results.json

# 4. Security audit
bash scripts/security-scan.sh

# 5. Update documentation
# Review and update runbook based on incidents
```

---

## Troubleshooting Guide

### Service Won't Start

**Symptoms**: Container exits immediately

**Diagnosis**:
```bash
# Check logs
docker-compose logs <service-name>

# Check configuration
docker-compose config

# Verify environment
bash scripts/validate-env.sh
```

**Common Causes**:
- Missing required environment variables
- Invalid configuration values
- Port already in use
- Insufficient disk space
- Missing dependencies

### High CPU Usage

**Symptoms**: Container using > 80% CPU

**Diagnosis**:
```bash
# Identify culprit
docker stats

# Check process details
docker exec <container> ps aux

# Profile Python services
docker exec byon-memory py-spy top --pid 1
```

**Solutions**:
- Reduce concurrent workers
- Optimize embeddings batch size
- Check for infinite loops in logs
- Increase CPU limits if appropriate

### Memory Leaks

**Symptoms**: Memory usage grows over time

**Diagnosis**:
```bash
# Monitor memory over time
watch -n 5 'docker stats --no-stream'

# Check for memory leaks in Node.js
docker exec byon-worker node --expose-gc --trace-gc index.js
```

**Solutions**:
- Restart affected service
- Review recent code changes
- Enable memory profiling
- Adjust memory limits

### Slow Performance

**Symptoms**: High latency, low throughput

**Diagnosis**:
```bash
# Run load test
cd tests/load
python load_test.py --profile minimal

# Check bottlenecks
docker stats

# Review Redis performance
docker exec byon-redis redis-cli --latency
```

**Solutions**:
- Optimize FHRSS+FCPE settings
- Increase Redis memory limit
- Add caching layer
- Scale horizontally

---

## Incident Response

### Severity Levels

| Level | Response Time | Escalation |
|-------|--------------|------------|
| **Critical** | 15 minutes | Immediate |
| **High** | 1 hour | If unresolved in 2 hours |
| **Medium** | 4 hours | If unresolved in 8 hours |
| **Low** | 24 hours | If unresolved in 48 hours |

### Incident Response Checklist

1. **Assess** (5 minutes)
   - [ ] Identify affected services
   - [ ] Estimate impact (users affected, data loss)
   - [ ] Determine severity level

2. **Communicate** (10 minutes)
   - [ ] Notify on-call team
   - [ ] Update status page
   - [ ] Alert affected users (if applicable)

3. **Mitigate** (30 minutes)
   - [ ] Apply immediate fixes (restart, rollback)
   - [ ] Enable additional monitoring
   - [ ] Document actions taken

4. **Resolve** (varies)
   - [ ] Implement permanent fix
   - [ ] Verify resolution
   - [ ] Monitor for recurrence

5. **Post-Mortem** (within 48 hours)
   - [ ] Document root cause
   - [ ] Identify prevention measures
   - [ ] Update runbook
   - [ ] Implement improvements

---

## Rollback Procedures

### Quick Rollback (< 5 minutes)

```bash
# 1. Stop current version
docker-compose down

# 2. Restore previous version
git checkout <previous-commit>

# 3. Rebuild (if needed)
docker-compose build

# 4. Start services
docker-compose up -d

# 5. Verify
bash scripts/health-check.sh
```

### Full Rollback with Restore (< 15 minutes)

```bash
# 1. Stop services
docker-compose down

# 2. Restore from backup
bash scripts/restore-production.sh /secure/backups/byon-optimus/<timestamp>

# 3. Revert code
git checkout <stable-commit>

# 4. Rebuild and restart
docker-compose build
docker-compose up -d

# 5. Verify
bash scripts/health-check.sh
```

---

## Performance Tuning

### Memory Service Optimization

```bash
# .env configuration
MEMORY_CACHE_TTL=600  # 10 minutes (default: 5)
RATE_LIMIT_REQUESTS=200  # Increase if needed
RATE_LIMIT_WINDOW=60
```

### Redis Optimization

```ini
# config/redis.conf
maxmemory 512mb  # Adjust based on available RAM
maxmemory-policy allkeys-lru
save ""  # Disable RDB (AOF only)
appendonly yes
appendfsync everysec
```

### Docker Resource Limits

```yaml
# docker-compose.yml
services:
  memory-service:
    deploy:
      resources:
        limits:
          cpus: '4'  # Increase for high load
          memory: 8G
```

---

## Contact Information

**Production Support**:
- Email: ops@yourcompany.com
- Slack: #byon-ops
- On-Call: [PagerDuty/OpsGenie]

**Security Issues**:
- Email: security@yourcompany.com
- Emergency: [Phone number]

**Escalation Path**:
1. On-Call Engineer
2. Lead Engineer
3. Engineering Manager
4. CTO

---

## Appendix

### Useful Commands

```bash
# View all logs
docker-compose logs -f

# Restart single service
docker-compose restart <service>

# Scale service
docker-compose up -d --scale byon-worker=3

# Execute command in container
docker exec -it byon-worker bash

# Export metrics
curl http://localhost:8001/metrics > metrics.txt

# Test signature verification
npm test -- --grep "signature"
```

### Configuration Files

- `.env` - Environment variables
- `docker-compose.yml` - Service configuration
- `config/redis.conf` - Redis configuration
- `keys/` - Ed25519 keys (secure!)
- `monitoring/` - Prometheus/Grafana configs

---

**Document Owner**: DevOps Team  
**Last Updated**: 2026-02-02  
**Next Review**: 2026-03-02 (monthly)
