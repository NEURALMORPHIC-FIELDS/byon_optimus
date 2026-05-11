# BYON Optimus - Architecture

## Main Components

| Service | Port | Role |
|----------|------|-----|
| Worker Agent | 3002 | Processes messages from channels (Telegram, Discord), builds evidence and plans |
| Auditor Agent | 3003 | Validates plans, signs with Ed25519, verifies GMV compliance |
| Memory Service | 8000/8001 | FHRSS+FCPE - 73,000x compression, 100% recovery at 40% data loss |
| OpenClaw Gateway | 3000 | Unified UI, proxy for all services |

## Data Flow

```
Channels (Telegram/Discord)
         ↓
Worker Agent (processing, evidence)
         ↓
Auditor Agent (validation, signing)
         ↓
Executor (air-gapped, network_mode: none)
         ↓
Receipts → Worker → User
```

## API Endpoints (via Gateway)

- `/api/worker/status` - Worker status
- `/api/auditor/status` - Auditor status
- `/api/memory/stats` - FHRSS+FCPE statistics
- `/api/memory/search?query=...` - Semantic search

## Key Technologies

| Technology | Description |
|------------|-----------|
| **FHRSS** | Fractal-Holographic Redundant Storage System - Fractal redundancy |
| **FCPE** | Fractal-Chaotic Persistent Encoding - 73,000:1 compression |
| **GMV** | Global Memory Vectors - Global conversation context |
| **MACP v1.1** | Machine Agent Communication Protocol |

## Notes

- Executor runs air-gapped (network_mode: none) for security
- Memory service provides 100% data recovery even at 40% data loss
- All services are accessible through Gateway as a unified proxy
