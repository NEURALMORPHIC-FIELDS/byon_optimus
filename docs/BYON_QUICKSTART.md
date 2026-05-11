# BYON Optimus Quick Start Guide

**Patent: EP25216372.0 — Omni-Qube-Vault — Vasile Lucian Borbeleac**

> **v0.6.4 banner.** Memory backend is now hybrid FAISS + FCE-M v0.6.0 (not the legacy FHRSS+FCPE described in some older paragraphs). For the up-to-date architecture and operational status see [RESEARCH_PROGRESS_v0.6.md](RESEARCH_PROGRESS_v0.6.md). For setup of the WhatsApp bridge (Baileys, replaces OpenClaw locally) see [`test-results/whatsapp-setup.md`](../test-results/whatsapp-setup.md).

## Prerequisites

- Docker and docker-compose
- Node.js 18+ (for development)
- Python 3.9+ (for memory service)
- OpenSSL (for Ed25519 key generation)
- 4GB RAM minimum

## Installation

### 1. Clone and Setup

```bash
cd byon_optimus

# Copy environment template
cp .env.example .env

# Edit .env with your API keys
nano .env
```

Required environment variables:
```bash
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
MEMORY_SERVICE_URL=http://memory-service:8000
```

### 2. Generate Keys

```bash
./scripts/setup-keys.sh
```

This creates:
- `keys/auditor.private.pem` - Private key (Auditor only)
- `keys/auditor.public.pem` - Public key (Executor reads)

### 3. Start System

```bash
# Start all services
./scripts/start-byon.sh

# Or with build
./scripts/start-byon.sh --build

# Development mode (hot-reload)
./scripts/start-byon.sh --dev
```

### 4. Verify Health

```bash
./scripts/health-check.sh
```

Expected output:
```
╔════════════════════════════════════════════╗
║     BYON Optimus - Health Status           ║
╚════════════════════════════════════════════╝

Services:
  ● Memory Service      healthy (45ms)
  ● BYON Worker         healthy
  ● BYON Auditor        healthy
  ● BYON Executor       running (air-gapped)
  ● OpenClaw Gateway    healthy
  ● Redis               healthy
```

## Usage

### Via OpenClaw Web UI

1. Open http://localhost:3000
2. Send message in chat
3. For medium/high risk actions, approve in Approval Panel

### Via CLI

```bash
# Check status
docker exec byon-worker byon status

# List pending approvals
docker exec byon-auditor byon approve list

# Approve by ID
docker exec byon-auditor byon approve PLAN-123

# Watch real-time activity
docker exec byon-worker byon watch

# View audit history
docker exec byon-worker byon history --today
```

### Via API

```bash
# Send message
curl -X POST http://localhost:3000/api/message \
  -H "Content-Type: application/json" \
  -d '{"content": "Create a new utility function", "channel": "api"}'

# Check memory health
curl http://localhost:8000/health

# Search memory
curl "http://localhost:8000/search?query=authentication&type=code&top_k=5"
```

## Development

### Run Orchestrator Locally

```bash
cd byon-orchestrator

# Install dependencies
npm install

# Run in development
npm run dev

# Run tests
npm test

# Run specific test suite
npm test -- --grep "security"
```

### Memory Service Only

```bash
cd byon-orchestrator/memory-service

# Install Python dependencies
pip install -r requirements.txt

# Run server
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

## Configuration

### Auto-Approve Settings

In `byon-config.ts`:

```typescript
byon: {
    auto_approve_risk_level: "low",  // "low" | "medium" | "none"
}
```

- `low`: Auto-approve only low-risk plans
- `medium`: Auto-approve low and medium risk
- `none`: Always require user approval

### Resource Limits

```typescript
limits_by_risk: {
    low: { max_iterations: 10, timeout_minutes: 30 },
    medium: { max_iterations: 5, timeout_minutes: 15 },
    high: { max_iterations: 3, timeout_minutes: 10 }
}
```

## Common Commands

```bash
# Start system
./scripts/start-byon.sh

# Stop system
./scripts/stop-byon.sh

# Stop and clean volumes
./scripts/stop-byon.sh --clean

# View logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f byon-worker

# Health check
./scripts/health-check.sh

# Health check JSON output
./scripts/health-check.sh --json

# Continuous health monitoring
./scripts/health-check.sh --watch
```

## Troubleshooting

### Memory Service Not Starting

```bash
# Check logs
docker-compose logs memory-service

# Verify FHRSS+FCPE mount
ls -la INFINIT_MEMORYCONTEXT/fhrss_fcpe_unified.py

# Manual test
curl http://localhost:8000/health
```

### Executor Signature Errors

```bash
# Regenerate keys
./scripts/setup-keys.sh --force

# Verify keys
./scripts/setup-keys.sh --verify

# Restart services
./scripts/stop-byon.sh && ./scripts/start-byon.sh
```

### Handoff Directory Permissions

```bash
# Fix permissions (Linux/Mac)
chmod -R 777 handoff/

# Windows: ensure Docker has access to project folder
```

### Worker Not Processing Messages

1. Check inbox: `ls handoff/inbox/`
2. Check worker logs: `docker-compose logs byon-worker`
3. Verify memory connection: `curl http://localhost:8000/health`

## Ports

| Service | Port |
|---------|------|
| OpenClaw Gateway | 3000 |
| OpenClaw API | 8080 |
| Memory Service | 8000 |
| Redis | 6379 |
| Redis Commander (dev) | 8082 |

## Next Steps

1. Read [BYON_ARCHITECTURE.md](BYON_ARCHITECTURE.md) for system design
2. Read [BYON_SECURITY.md](BYON_SECURITY.md) for security model
3. Read [BYON_API.md](BYON_API.md) for API reference
