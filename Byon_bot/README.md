# Byon Bot - Multi-Agent System

A secure multi-agent bot system implementing MACP v1.1 (Multi-Agent Control Protocol) with air-gapped code execution via Jupyter Kernel.

[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

Byon Bot implements a secure multi-agent architecture where three isolated agents collaborate through file-based communication. The key innovation is the **air-gapped executor** - an agent that can execute code with absolutely no network access, ensuring maximum security.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          USER                                        │
│                           │                                          │
│    ┌──────────────────────┼──────────────────────┐                  │
│    │                      │                      │                   │
│    ▼                      ▼                      │                   │
│ ┌──────────┐      ┌──────────────┐      ┌───────▼──────┐           │
│ │  WORKER  │─────▶│   AUDITOR    │─────▶│   EXECUTOR   │           │
│ │   (A)    │      │     (B)      │      │     (C)      │           │
│ └──────────┘      └──────────────┘      └──────────────┘           │
│      │                   │                     │                    │
│      │ evidence_pack     │ approval_request    │ AIR-GAPPED        │
│      │ plan_draft        │ execution_order     │ network: none     │
│      │                   │                     │                    │
│      └───────────────────┴─────────────────────┘                   │
│                          │                                          │
│                   johnson_receipt                                    │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Features

- **3 Isolated Agents**: Worker, Auditor, Executor - no direct communication
- **Air-Gap Security**: Executor has NO network access (`network_mode: none`)
- **Ed25519 Signing**: All execution orders are cryptographically signed
- **User Approval**: Every code change requires explicit user approval
- **Jupyter Kernel**: Autonomous code execution and testing
- **FHRSS+FCPE Memory**: Fractal memory system for semantic context retention (Patent EP25216372.0)
- **Immutable Audit Trail**: Calendar-indexed, hash-chained audit log with integrity verification
- **BYON Style Contract**: Enforces strict output style (no psychology/empathy/stories/meta)
- **Web UI**: Real-time dashboard for monitoring, approvals, and audit history
- **CLI Interface**: Full-featured command-line interface for monitoring and approval

## Quick Start

### Prerequisites

- **Node.js 22+** - [Download](https://nodejs.org/)
- **pnpm** - `npm install -g pnpm`
- **Docker Desktop** - [Download](https://docker.com/)
- **Python 3.10+** - [Download](https://python.org/) **(REQUIRED for FHRSS+FCPE memory!)**

> ⚠️ **IMPORTANT**: Python is **REQUIRED**, not optional! The FHRSS+FCPE memory system
> is what makes Byon Bot different from other bots that lose context or over-summarize.
> Without it, the agents **will not start**.

### One-Line Setup

```bash
node scripts/setup-first-run.js
```

### Manual Installation

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Generate Ed25519 keys
node scripts/generate-keys.js

# Setup handoff directories
node scripts/setup-handoff.js

# Create .env from example
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

### Running

```bash
# Docker mode (recommended)
pnpm docker:up

# Development mode with hot-reload
pnpm dev

# View logs
pnpm docker:logs
```

### First Test

```bash
# Terminal 1: Start services
pnpm docker:up

# Terminal 2: Watch activity
npx byon watch --verbose

# Terminal 3: Send test message
npx byon inbox "Hello, this is a test"

# Terminal 3: Approve request
npx byon approve
```

## Documentation

| Document | Description |
|----------|-------------|
| [QUICKSTART.md](docs/QUICKSTART.md) | Step-by-step setup guide |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design and data flow |
| [SECURITY.md](docs/SECURITY.md) | Security model and threat analysis |
| [JOHNSON_STATUS.json](./JOHNSON_STATUS.json) | Development progress tracker |

## Project Structure

```
byon-bot/
├── agent-worker/          # Agent A - Reads inbox, creates plans
│   ├── AGENTS.md          # Agent master instructions
│   ├── agent_docs/        # Detailed documentation
│   └── src/               # Source code
├── agent-auditor/         # Agent B - Validates, signs orders
│   ├── AGENTS.md
│   ├── agent_docs/
│   └── src/
├── agent-executor/        # Agent C - Executes code (AIR-GAPPED)
│   ├── AGENTS.md
│   ├── agent_docs/
│   └── src/
├── shared/                # Shared libraries
│   ├── types/             # TypeScript protocol types
│   ├── crypto/            # Ed25519 signing
│   ├── policy/            # Whitelist & security rules
│   ├── memory/            # FHRSS+FCPE memory system
│   ├── audit/             # Immutable audit trail system
│   ├── style/             # BYON Style Contract validator
│   └── schemas/           # JSON validation schemas
├── cli/                   # Command-line interface
│   └── src/commands/      # approve, watch, status, inbox, history, delete
├── ui/                    # Web interface
│   ├── src/server.ts      # Express + WebSocket server
│   └── public/            # HTML, CSS, JS (dashboard, approvals, history)
├── tests/                 # Test suites
│   ├── unit/              # Unit tests
│   ├── integration/       # Integration tests
│   └── security/          # Security tests
├── docs/                  # Documentation
├── scripts/               # Setup and utility scripts
├── handoff/               # Inter-agent communication (runtime)
└── docker-compose.yml     # Docker orchestration
```

## CLI Commands

```bash
npx byon status          # Show system status
npx byon watch           # Real-time activity monitor
npx byon watch --verbose # Verbose monitoring

npx byon approve         # Interactive approval UI
npx byon approve --auto  # Auto-approve low-risk actions
npx byon approve --watch # Watch for new requests

npx byon inbox "message" # Send message to system

npx byon history         # View audit trail
npx byon history --today # Today's entries only
npx byon history --week  # This week's entries
npx byon history --verify # Verify chain integrity

npx byon delete <id>     # Mark document as deleted (soft delete)
```

## Web UI

Access the web interface at `http://localhost:3456`:

```bash
# Start the web UI server
cd ui && pnpm start

# Or via Docker
pnpm docker:up  # Includes UI service
```

**Dashboard Features:**
- Real-time agent status monitoring via WebSocket
- Pending approvals queue with approve/reject
- Execution receipts viewer
- Audit trail history with filters

## Protocol Files

| File | Direction | Contents |
|------|-----------|----------|
| `evidence_pack.json` | Worker → Auditor | Facts, quotes, codebase context |
| `plan_draft.json` | Worker → Auditor | Proposed actions with rationale |
| `approval_request.json` | Auditor → User | Summary for human approval |
| `execution_order.json` | Auditor → Executor | Ed25519-signed actions |
| `johnson_receipt.json` | Executor → Worker | Execution results and output |

## Security Model

| Layer | Protection |
|-------|------------|
| **Isolation** | Agents cannot communicate directly, only via files |
| **Air-Gap** | Executor runs with `network_mode: none` in Docker |
| **Signing** | All execution orders signed with Ed25519 |
| **Approval** | User must approve every plan before execution |
| **Whitelist** | Only approved action types allowed |
| **Limits** | Resource limits enforced (CPU, memory, iterations) |
| **Validation** | JSON schema validation on all protocol files |

See [SECURITY.md](docs/SECURITY.md) for detailed security analysis.

## Testing

```bash
# Run all tests
pnpm test

# Run specific suites
pnpm test:unit        # Unit tests
pnpm test:integration # Integration tests
pnpm test:security    # Security tests
pnpm test:memory      # Python memory tests

# Watch mode
pnpm test:watch
```

## FHRSS+FCPE Memory System

The system uses the patented FHRSS+FCPE memory architecture:

- **FCPE (Fractal-Chaotic Persistent Encoding)**: 73,000x compression ratio
- **FHRSS (Fractal-Holographic Redundant Storage)**: 100% recovery at 40% data loss
- **Capabilities**: Code embeddings, conversation memory, semantic search

```typescript
// Example: Store and retrieve code context
await memory.storeCode(code, 'src/utils.ts', 42, ['auth', 'login']);
const results = await memory.searchCode('authentication flow');
```

## Development Status

**ALL 12 PHASES COMPLETE!** ✅

- ✅ Phase 1-6: Core System (Agents, Protocol, Policy)
- ✅ Phase 7: FHRSS+FCPE Memory (HARD-WIRED, REQUIRED - fully integrated in agents)
- ✅ Phase 8: Web UI (Dashboard, Approvals, History)
- ✅ Phase 9: Testing & Hardening
- ✅ Phase 10: Deployment & Documentation
- ✅ Phase 11: Immutable Audit Trail System
- ✅ Phase 12: BYON Style Contract

See [JOHNSON_STATUS.json](./JOHNSON_STATUS.json) for detailed progress.

## BYON Style Contract

Enforces strict output formatting for agent responses. Rejects:
- Psychology/therapy patterns ("anxiety", "stress", "cope")
- Empathy patterns ("I understand", "with pleasure")
- Story patterns ("imagine", "let me tell you")
- Meta patterns ("as an AI", "my limitations")

```typescript
import { validate_or_regenerate } from '@byon-bot/style';

const result = await validate_or_regenerate(
  doc,
  async (ctx) => regenerateWithLLM(ctx),
  { minScore: 85, maxAttempts: 3, hardFail: true }
);
```

## Immutable Audit Trail

All protocol documents are stored in an immutable, hash-chained audit trail:

```typescript
import { AuditService } from '@byon-bot/audit';

const audit = new AuditService();
await audit.store(evidencePack);

// Query by date
const docs = await audit.queryByDate('2026-02-01');

// Verify integrity
const valid = await audit.verifyChain();
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Run tests (`pnpm test`)
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- **FHRSS+FCPE**: Patent EP25216372.0 by Vasile Lucian Borbeleac
- **OpenClaw**: MIT licensed base architecture
