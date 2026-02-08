<div align="center">
  <img src="WFP%20logo.png" alt="BYON Optimus" width="400" />

  # BYON Optimus - Multi-Agent Orchestration System

  [![CI](https://github.com/NEURALMORPHIC-FIELDS/byon_optimus/actions/workflows/ci.yml/badge.svg)](https://github.com/NEURALMORPHIC-FIELDS/byon_optimus/actions/workflows/ci.yml)
  [![License](https://img.shields.io/badge/license-Proprietary-red.svg)](LICENSE)
  [![Patent](https://img.shields.io/badge/Patent-EP25216372.0-blue.svg)](LICENSE)
  [![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
  [![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](docker-compose.yml)

  **Patent: EP25216372.0 - Omni-Qube-Vault - Vasile Lucian Borbeleac**
</div>

> Semantic Intelligence + Kernel Performance = Autonomous Execution with Infinite Memory

| Documentation | Description |
|---------------|-------------|
| [INSTALL.md](INSTALL.md) | Detailed installation guide |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
| [SECURITY.md](SECURITY.md) | Security policy |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [JOHNSON_PLAN.md](JOHNSON_PLAN.md) | Protocol specification |

---

## Quick Start

### Windows (One-Click Install)
```
Double-click: INSTALL-CLICK-HERE.bat
```
This will:
- Check prerequisites (Docker)
- Build all containers
- Configure OpenClaw with proper authentication
- Initialize memory with BYON system knowledge
- Open the UI in your browser

### Manual Start
```bash
docker compose up -d
```

### Access the UI
```
http://localhost:3000/?token=987ad2399f0e70b75238d2b3dd586545e2635b8a92572e0e6e9fb70b7fb2a5d5
```

### API Endpoints
| Endpoint | Purpose |
|----------|---------|
| `http://localhost:3000/api/worker/status` | Worker agent status |
| `http://localhost:3000/api/auditor/status` | Auditor agent status |
| `http://localhost:3000/api/memory/stats` | Memory statistics |
| `http://localhost:3000/api/memory/search?query=BYON` | Semantic search |

---

## Configure WhatsApp (Remote Control)

After installation, you can control BYON from your phone via WhatsApp:

1. Open `http://localhost:3000`
2. Go to **Settings → Channels**
3. Click **Add WhatsApp**
4. **Scan QR code** with WhatsApp on your phone (Settings → Linked Devices)
5. Done! Send messages to control your PC remotely

### Security Flow:
```
Your Phone → WhatsApp → Worker → Auditor → [YOU APPROVE] → Executor → Results
```

The Executor runs in an **air-gapped container** (no network) for maximum security.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BYON OPTIMUS SYSTEM                          │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    COMMUNICATION LAYER                          │ │
│  │   Telegram | Discord | WhatsApp | Slack | Signal | 20+ more    │ │
│  │                         ↓                                       │ │
│  │                   OpenClaw Gateway (:3000)                      │ │
│  └────────────────────────────┬───────────────────────────────────┘ │
│                               │                                      │
│  ┌────────────────────────────▼───────────────────────────────────┐ │
│  │                    WORKER AGENT (A)                             │ │
│  │  • Reads inbox messages                                         │ │
│  │  • Consults FHRSS+FCPE Memory (73,000x compression)            │ │
│  │  • Builds EvidencePack + PlanDraft                             │ │
│  │  • Does NOT execute - only plans                                │ │
│  └────────────────────────────┬───────────────────────────────────┘ │
│                               │                                      │
│  ┌────────────────────────────▼───────────────────────────────────┐ │
│  │                    AUDITOR AGENT (B)                            │ │
│  │  • Validates plans against policies                             │ │
│  │  • Checks security (forbidden paths, patterns)                  │ │
│  │  • Requests user approval if needed                             │ │
│  │  • Signs ExecutionOrder with Ed25519                           │ │
│  └────────────────────────────┬───────────────────────────────────┘ │
│                               │                                      │
│  ┌────────────────────────────▼───────────────────────────────────┐ │
│  │                    EXECUTOR AGENT (C)                           │ │
│  │  ╔═══════════════════════════════════════════════════════════╗ │ │
│  │  ║  AIR-GAPPED - NO NETWORK ACCESS - network_mode: none      ║ │ │
│  │  ╚═══════════════════════════════════════════════════════════╝ │ │
│  │  • Verifies Ed25519 signature                                   │ │
│  │  • Executes approved actions only                               │ │
│  │  • Produces JohnsonReceipt                                      │ │
│  │  • All errors go back to Worker                                 │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │              FHRSS+FCPE MEMORY SERVICE (:8001)                  │ │
│  │  • 73,000x compression ratio                                    │ │
│  │  • 100% recovery at 40% data loss                               │ │
│  │  • Semantic search for code/conversations/facts                 │ │
│  │  • REQUIRED - System won't start without it                     │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │              WFP SEMANTIC GUARD (Future)                        │ │
│  │  • Kernel-level enforcement (Windows WFP)                       │ │
│  │  • Translates semantic intents to firewall rules                │ │
│  │  • The "Physical Gate" alongside BYON "Information Gate"       │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
byon_optimus/
├── CITESTE.md                    # This file
├── INSTALL.md                    # Installation guide
├── JOHNSON_PLAN.md               # Master plan document
├── BYON_EXECUTION_PLAN.json      # Implementation phases (all complete)
├── docker-compose.yml            # Main orchestration
├── .env                          # Configuration (API keys, etc.)
│
├── byon-orchestrator/            # Core TypeScript orchestrator
│   ├── src/
│   │   ├── agents/
│   │   │   ├── worker/           # Agent A - Evidence & Planning
│   │   │   ├── auditor/          # Agent B - Validation & Signing
│   │   │   └── executor/         # Agent C - Air-gapped Execution
│   │   ├── protocol/             # MACP v1.1 protocol types
│   │   ├── policy/               # Security policies & whitelists
│   │   ├── memory/               # Memory client & GMV
│   │   ├── vault/                # 🔐 Secure Vault (encrypted secrets)
│   │   ├── handoff/              # File-based inter-agent communication
│   │   ├── audit/                # Immutable audit trail
│   │   └── cli/                  # CLI commands
│   ├── memory-service/           # Python FHRSS+FCPE service
│   └── Dockerfile                # Multi-stage build
│
├── Byon_bot/openclaw-main/       # OpenClaw communication platform
│   └── ...                       # 20+ channel adapters
│
├── INFINIT_MEMORYCONTEXT/        # FHRSS+FCPE Python implementation
│   └── fhrss_fcpe_unified.py     # Core memory system
│
├── WFP-Semantic-Guard/           # Kernel enforcement (future)
│
├── handoff/                      # Inter-agent file exchange
│   ├── inbox/                    # Incoming messages
│   ├── worker_to_auditor/        # EvidencePack + PlanDraft
│   ├── auditor_to_user/          # ApprovalRequest
│   ├── auditor_to_executor/      # ExecutionOrder (signed)
│   └── executor_to_worker/       # JohnsonReceipt
│
├── keys/                         # Ed25519 keys for signing
│   ├── auditor.private.pem       # Auditor's signing key
│   ├── auditor.public.pem        # Verification key
│   └── public/                   # Keys for executor
│
├── memory/                       # FHRSS+FCPE persistent storage
├── project/                      # Executor workspace
├── vault/                        # 🔐 Secure Vault (encrypted secrets)
│   ├── credentials/              # API keys, passwords, tokens
│   ├── keys/                     # SSH, GPG, crypto keys
│   ├── financial/                # Banking, wallets, trading
│   ├── documents/                # Legal, medical, personal
│   └── secrets/                  # Generic secrets
└── scripts/                      # Utility scripts
```

---

## Core Components

### 1. Memory Service (FHRSS+FCPE)

**REQUIRED** - The system will NOT start without memory service.

| Feature | Specification |
|---------|---------------|
| Compression | **73,000x** (2M tokens → 27KB) |
| Recovery | **100%** at 40% data loss |
| Embedding | 384-dimensional vectors |
| Storage | Fractal-Holographic with XOR parity |

```bash
# Health check
curl http://localhost:8001/health

# Store code
curl -X POST http://localhost:8001/store/code \
  -H "Content-Type: application/json" \
  -d '{"code": "function hello() {}", "file": "test.js"}'

# Search
curl "http://localhost:8001/search/code?query=hello&top_k=5"
```

### 2. Worker Agent (A)

- Watches `/handoff/inbox/` for messages
- Extracts facts and builds evidence
- Generates execution plans
- Stores context in memory
- **Does NOT execute** - only plans

### 3. Auditor Agent (B)

- Validates plans against security policies
- Checks forbidden paths and patterns
- Assesses risk level (low/medium/high)
- Requests user approval when needed
- Signs approved orders with **Ed25519**

### 4. Executor Agent (C)

- **AIR-GAPPED** (`network_mode: none`)
- Verifies Ed25519 signatures before execution
- Executes actions in isolated environment
- Produces JohnsonReceipt with results
- All errors reported back to Worker

---

## Protocol Types (MACP v1.1)

### EvidencePack
```json
{
  "document_type": "EVIDENCE_PACK",
  "evidence_id": "EVD-xxx",
  "timestamp": "2026-02-02T...",
  "task_type": "coding|scheduling|messaging|general",
  "sources": [...],
  "extracted_facts": [...],
  "memory_context": {
    "conversation_ctx_id": 123,
    "relevant_code_ctx_ids": [1, 2, 3]
  },
  "hash": "sha256..."
}
```

### PlanDraft
```json
{
  "document_type": "PLAN_DRAFT",
  "plan_id": "PLAN-xxx",
  "based_on_evidence": "EVD-xxx",
  "intent": "Create a function to...",
  "actions": [...],
  "risk_level": "low|medium|high",
  "estimated_iterations": 3
}
```

### ExecutionOrder (Signed)
```json
{
  "document_type": "EXECUTION_ORDER",
  "order_id": "ORD-xxx",
  "based_on_plan": "PLAN-xxx",
  "approved_by": "user",
  "approved_at": "2026-02-02T...",
  "actions": [...],
  "constraints": {
    "max_iterations": 10,
    "timeout_minutes": 30
  },
  "signature": "Ed25519..."
}
```

### JohnsonReceipt
```json
{
  "document_type": "JOHNSON_RECEIPT",
  "receipt_id": "RCPT-xxx",
  "based_on_order": "ORD-xxx",
  "execution_summary": {
    "status": "success|partial|failed",
    "actions_completed": 5,
    "duration_ms": 12345
  },
  "action_results": [...],
  "changes_made": {
    "files_created": ["src/new.ts"],
    "files_modified": ["src/old.ts"]
  }
}
```

---

## Secure Vault 🔐

BYON includes a **Secure Vault** for storing sensitive data with human-in-the-loop approval.

### Features
| Feature | Description |
|---------|-------------|
| **Encryption** | GPG (if available) or AES-256-GCM fallback |
| **Access Policy** | Ask-always: every access requires explicit approval |
| **Timeout** | 30-second approval timeout |
| **Notifications** | Desktop notifications for access requests |
| **Audit Trail** | Complete log of all vault operations |
| **Rate Limiting** | Max 10 accesses per hour per category |

### Categories
- `credentials` - API keys, passwords, tokens
- `keys` - SSH, GPG, crypto private keys
- `financial` - Banking, crypto wallets, trading data
- `documents` - Legal, medical, personal documents
- `secrets` - Generic sensitive data

### Vault CLI
```bash
# Initialize vault
byon vault init

# Store a secret
byon vault store my-api-key credentials

# List entries
byon vault list [category]

# Get secret (requires approval!)
byon vault get <entry-id>

# Show vault status
byon vault status

# Handle access requests
byon vault pending
byon vault approve <request-id>
byon vault deny <request-id>
```

### Security Flow
```
Agent Request → Desktop Notification → User Approval (30s) → Decrypt → Return
                     ↓                        ↓
               [Audit Log]              [Rate Limit Check]
```

---

## Security Model

### Dual Gate Architecture

1. **Information Gate** (BYON Auditor)
   - Validates logic and signatures
   - Enforces policies
   - Requires user approval

2. **Execution Gate** (WFP Semantic Guard - future)
   - Kernel-level packet filtering
   - Translates semantic intents to firewall rules
   - Physical enforcement of approved actions

### Forbidden Paths
- `/etc`, `/usr`, `C:\Windows`
- `.env*`, `credentials*`, `secrets*`
- `.git`, `.ssh`, `node_modules`
- `package-lock.json`, `pnpm-lock.yaml`

### Forbidden Patterns
- Network: `fetch(`, `http.request`, `axios`
- Process: `exec(`, `spawn(`, `child_process`
- Dangerous: `eval(`, `new Function(`, `../`

---

## Docker Services

| Service | Container | Network | Ports |
|---------|-----------|---------|-------|
| memory-service | byon-memory | byon-network | 8001:8000 |
| byon-worker | byon-worker | byon-network | - |
| byon-auditor | byon-auditor | byon-network | - |
| byon-executor | byon-executor | **none** (air-gapped) | - |
| openclaw-gateway | openclaw-gateway | byon-network | 3000, 8080 |
| byon-ui | byon-ui | byon-network | 3001 |
| redis | byon-redis | byon-network | - |

```bash
# Start all
docker compose up -d

# View logs
docker compose logs -f byon-worker

# Stop all
docker compose down
```

---

## CLI Commands

```bash
# Check system status
docker exec byon-worker node dist/src/cli/index.js status

# List pending approvals
docker exec byon-auditor node dist/src/cli/index.js approve list

# Approve a plan
docker exec byon-auditor node dist/src/cli/index.js approve PLAN-xxx

# Watch real-time activity
docker exec byon-worker node dist/src/cli/index.js watch

# View audit history
docker exec byon-worker node dist/src/cli/index.js history --today

# Send test message to inbox
echo '{"message_id":"test","payload":{"content":"Hello"}}' > handoff/inbox/test.json

# === VAULT COMMANDS ===
# Initialize secure vault
byon vault init

# Store sensitive data
byon vault store "github-token" credentials

# List vault entries
byon vault list credentials

# Get secret (requires approval)
byon vault get <entry-id>

# Approve/deny access requests
byon vault approve <request-id>
byon vault deny <request-id>
```

---

## OpenClaw Channels (20+)

All channels are configured through `.env`:

| Category | Channels |
|----------|----------|
| **Core** | Telegram, Discord, WhatsApp, Slack, Signal, iMessage |
| **Corporate** | Microsoft Teams, Google Chat, Mattermost, Nextcloud Talk |
| **Asian** | LINE, Zalo |
| **Decentralized** | Matrix, Nostr, Tlon |
| **Media** | Twitch, Voice Call |
| **System** | Web Chat, CLI, Webhook, Email |

---

## Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-api03-...

# Optional - Channels
TELEGRAM_BOT_TOKEN=
DISCORD_TOKEN=
SLACK_TOKEN=

# Optional - Configuration
LOG_LEVEL=info
OPENCLAW_GATEWAY_TOKEN=your-secure-token
```

---

## Troubleshooting

### Memory Service Won't Start
```bash
docker logs byon-memory
ls INFINIT_MEMORYCONTEXT/fhrss_fcpe_unified.py
```

### Worker Not Processing Messages
```bash
docker logs byon-worker
ls handoff/inbox/
```

### Executor Signature Errors
```bash
ls keys/
# Regenerate keys
bash scripts/setup-keys.sh --force
```

### Reset Everything
```bash
docker compose down -v
docker system prune -f
docker compose build --no-cache
docker compose up -d
```

---

## Implementation Status

All 9 phases are **COMPLETE**:

- [x] Phase 1: Foundation Setup
- [x] Phase 2: Memory System Integration (FHRSS+FCPE)
- [x] Phase 3: MACP Protocol Implementation
- [x] Phase 4: Security & Policy Layer
- [x] Phase 5: Audit Trail & Indexing
- [x] Phase 6: BYON Orchestrator Core
- [x] Phase 7: OpenClaw Integration
- [x] Phase 8: Docker & Deployment
- [x] Phase 9: Testing & Documentation

See `BYON_EXECUTION_PLAN.json` for detailed task breakdown.

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Service orchestration |
| `.env` | Configuration & secrets |
| `byon-orchestrator/src/agents/worker/index.ts` | Worker agent |
| `byon-orchestrator/src/agents/auditor/index.ts` | Auditor agent |
| `byon-orchestrator/src/agents/executor/index.ts` | Executor agent |
| `byon-orchestrator/src/types/protocol.ts` | MACP types |
| `byon-orchestrator/src/vault/service.ts` | 🔐 Secure Vault service |
| `byon-orchestrator/src/vault/encryption.ts` | GPG/AES encryption layer |
| `byon-orchestrator/src/vault/policy.ts` | Ask-always access policy |
| `byon-orchestrator/memory-service/server.py` | Memory API |
| `INFINIT_MEMORYCONTEXT/fhrss_fcpe_unified.py` | Core memory system |

---

## AI Capabilities

BYON Optimus includes AI-powered task processing via Claude API:

| Capability | Status | Output |
|------------|--------|--------|
| **Coding** | ✅ Active | Python, JavaScript, TypeScript generation |
| **Analysis** | ✅ Active | Data analysis with structured reports |
| **Planning** | ✅ Active | Implementation plans with architecture diagrams |
| **Trading** | ✅ Active | Cryptocurrency data via CoinGecko API |
| **General** | ✅ Active | Q&A, explanations, translations |

See [CAPABILITY_REPORT.md](docs/CAPABILITY_REPORT.md) for detailed test results.

---

## License & Patent

This project is protected by:
- **Patent**: EP25216372.0 -FHRSS Omni-Qube-Vault
- **Technology**: FHRSS+FCPE (Fractal-Holographic Redundant Storage System)
- **License**: Proprietary - See [LICENSE](LICENSE)

Copyright (c) 2025-2026 Vasile Lucian Borbeleac. All rights reserved.

---

## Contributing

We welcome contributions! Please read:
- [CONTRIBUTING.md](CONTRIBUTING.md) - Development setup and guidelines
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) - Community standards
- [SECURITY.md](SECURITY.md) - Vulnerability reporting

---

*For detailed installation instructions, see [INSTALL.md](INSTALL.md)*
*For the complete implementation plan, see [JOHNSON_PLAN.md](JOHNSON_PLAN.md)*
