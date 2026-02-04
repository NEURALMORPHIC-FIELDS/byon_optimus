# Byon Bot - Quick Start Guide

## Prerequisites

Before starting, ensure you have:

- **Node.js 22+** - [Download](https://nodejs.org/)
- **pnpm** - `npm install -g pnpm`
- **Docker Desktop** - [Download](https://www.docker.com/products/docker-desktop)
- **Python 3.10+** - [Download](https://python.org/) **(REQUIRED!)**

> ⚠️ **CRITICAL**: Python is **REQUIRED**, not optional!
>
> The FHRSS+FCPE memory system is what makes Byon Bot different from other bots
> that lose context or over-summarize and destroy projects.
>
> **Without Python, the agents WILL NOT START.**

## Installation

### 1. Clone and Install

```bash
# Clone the repository
git clone <your-repo-url> byon-bot
cd byon-bot

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### 2. Generate Cryptographic Keys

```bash
# Generate Ed25519 keypair for signing
node scripts/generate-keys.js
```

This creates:
- `keys/auditor.public.pem` - Public key (shared with executor)
- `keys/auditor.private.pem` - Private key (auditor only)

### 3. Setup Environment

```bash
# Copy environment template
cp .env.example .env

# Edit .env and add your API key
# ANTHROPIC_API_KEY=sk-ant-xxx
```

### 4. Create Handoff Directories

```bash
# Setup inter-agent communication directories
node scripts/setup-handoff.js
```

### 5. Install Python Dependencies (REQUIRED!)

FHRSS+FCPE memory system is **REQUIRED** - agents will not start without it:

```bash
# Install Python dependencies
cd shared/memory
pip install -r requirements.txt
cd ../..

# Verify installation
python -c "import sentence_transformers; print('OK')"
```

> ⚠️ If this fails, the system **WILL NOT FUNCTION**.
> FHRSS+FCPE provides:
> - 73,000x compression ratio
> - 100% recovery at 40% data loss
> - Semantic code and conversation memory

## Running

### Development Mode

```bash
# Start all services with hot-reload
pnpm dev
```

### Docker Mode

```bash
# Build containers
pnpm docker:build

# Start services
pnpm docker:up

# View logs
pnpm docker:logs

# Stop services
pnpm docker:down
```

### CLI Only

```bash
# Build CLI
cd cli && pnpm build && cd ..

# Run CLI commands
npx byon status
npx byon approve --watch
```

### Web UI

```bash
# Start web UI (separate terminal)
cd ui && pnpm start

# Access at http://localhost:3456
```

Features:
- **Dashboard**: Real-time agent status, pending approvals, receipts
- **Approvals**: Review and approve/reject pending requests
- **History**: Browse audit trail with date filters

## First Test Run

### 1. Start the System

```bash
# Terminal 1: Start Docker services
pnpm docker:up

# Terminal 2: Watch activity
npx byon watch --verbose
```

### 2. Send a Test Message

```bash
# Terminal 3: Send test message
npx byon inbox "Hello, this is a test message"
```

### 3. Approve the Request

```bash
# Terminal 3: Approve pending requests
npx byon approve
```

### 4. Verify the Flow

```bash
# Check status
npx byon status
```

## Common Operations

### Monitoring

```bash
# Real-time activity monitor
npx byon watch

# System status
npx byon status

# Docker logs
pnpm docker:logs
```

### Approval Workflow

```bash
# Interactive approval (recommended)
npx byon approve

# Auto-approve low-risk actions
npx byon approve --auto

# Watch for new requests
npx byon approve --watch
```

### Audit Trail

```bash
# View all history
npx byon history

# Filter by date
npx byon history --today
npx byon history --week

# Verify chain integrity
npx byon history --verify

# Soft delete a document
npx byon delete <document-id>
```

### Testing

```bash
# Run all tests
pnpm test

# Run specific test suites
pnpm test:unit
pnpm test:security
pnpm test:integration

# Run Python memory tests
pnpm test:memory
```

## Troubleshooting

### Docker Issues

```bash
# Rebuild containers
pnpm docker:down
docker system prune -f
pnpm docker:build
pnpm docker:up
```

### Permission Issues

```bash
# Fix handoff directory permissions
chmod -R 777 handoff/
```

### Key Generation Issues

```bash
# Regenerate keys
rm -rf keys/
node scripts/generate-keys.js
```

### Memory Service Issues

```bash
# Test Python memory service
cd shared/memory
python memory_service.py --mode=cli --action=ping
```

## Next Steps

1. **Read the Architecture Guide**: `docs/ARCHITECTURE.md`
2. **Explore Agent Documentation**: Each agent has `AGENTS.md` and `agent_docs/`
3. **Customize Policies**: Edit `shared/policy/whitelist.ts`
4. **Add Channel Integrations**: Extend Worker agent for your platforms
5. **Access Web UI**: Open `http://localhost:3456` for dashboard
6. **Review Audit Trail**: Use `npx byon history` to see all operations

## Support

- Issues: https://github.com/your-repo/issues
- Documentation: `docs/` directory
